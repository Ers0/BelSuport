'use strict';
/**
 * routes/phone-auth.js — Phone + Password Authentication
 *
 * Registration flow:
 *   1. POST /register   — name + email + phone + password → sends OTP to verify phone
 *   2. POST /verify-otp — verify OTP → creates pending phone_users row
 *   3. Admin approves in "Usuários Telefone" tab
 *   4. User can now login with phone + password
 *
 * Login flow:
 *   POST /login — phone/email + password → session token
 *               → if temp_password=true → forces password change on client
 *
 * Admin routes (master + admin only):
 *   GET  /admin/users          — list all phone users
 *   POST /admin/approve/:id    — approve or reject registration
 *   POST /admin/reset-password/:id — set temp password (notifies user)
 *   PUT  /admin/role/:id       — change role
 *
 * User routes (authenticated):
 *   POST /change-password      — change own password (required after temp reset)
 *
 * Password security: PBKDF2-SHA512, 100k iterations, random 32-byte salt per user.
 * Admins NEVER see passwords — only set temp ones which are immediately hashed.
 */

const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const { supabaseAdmin } = require('../services/db');

// ── Password hashing (PBKDF2-SHA512, no external deps) ───────────────────────
function generateSalt() {
  return crypto.randomBytes(32).toString('hex');
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
}

function verifyPassword(password, salt, hash) {
  return hashPassword(password, salt) === hash;
}

// ── OTP helpers ───────────────────────────────────────────────────────────────
function generateOTP() { return String(Math.floor(100000 + Math.random() * 900000)); }
function hashOTP(otp)  { return crypto.createHash('sha256').update(otp).digest('hex'); }

function normalizePhone(raw) {
  let phone = (raw || '').replace(/\D/g, '');
  if (phone.startsWith('0')) phone = phone.slice(1);
  if (!phone.startsWith('55') && phone.length <= 11) phone = '55' + phone;
  if (!phone.startsWith('+')) phone = '+' + phone;
  if (phone.length < 12 || phone.length > 15) throw new Error('Número de telefone inválido');
  return phone;
}

// ── OTP sender ────────────────────────────────────────────────────────────────
/**
 * WhatsApp delivery via Meta Cloud API (100% free, no trial, no credit card).
 *
 * Setup (5 minutes):
 *   1. Go to developers.meta.com → Create App → Business → Add WhatsApp
 *   2. In WhatsApp > Getting Started: get Phone Number ID + Temporary Token
 *   3. For permanent token: Meta Business Suite → System Users → Generate token
 *   4. Add to Vercel env vars:
 *        WHATSAPP_TOKEN    = your_permanent_access_token
 *        WHATSAPP_PHONE_ID = your_phone_number_id
 *
 * Free tier: 1,000 conversations/month (24h windows). For 4 techs → ~20-30 OTPs/month = zero cost.
 * Docs: developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages
 */
async function sendWhatsAppMeta(phone, message) {
  const token   = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) return false;

  const fetch = (await import('node-fetch')).default;
  const to    = phone.replace('+', '');

  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method:  'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { preview_url: false, body: message },
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (res.ok) return true;
  const err = await res.json().catch(() => ({}));
  console.error('[WhatsApp] Meta API error:', err?.error?.message || res.status);
  return false;
}


/**
 * Send OTP via email — reuses the existing nodemailer setup from sheets.js.
 * No external service needed. Works with Gmail OAuth2 or any SMTP already configured.
 */
async function sendOTPEmail(email, otp, name) {
  if (!email) throw new Error('Email não fornecido');

  const firstName = (name || '').split(' ')[0] || 'Técnico';
  const html = '<div style="font-family:Arial,sans-serif;padding:24px;max-width:400px">'
    + '<h2 style="color:#333">Belenergy Support Pro</h2>'
    + '<p>Olá, ' + firstName + '!</p>'
    + '<p>Seu código de verificação:</p>'
    + '<div style="font-size:36px;font-weight:bold;letter-spacing:10px;background:#f5f5f5;padding:16px;text-align:center;border-radius:8px;margin:16px 0">'
    + otp
    + '</div>'
    + '<p style="color:#666;font-size:12px">Válido por 5 minutos. Não compartilhe.</p>'
    + '</div>';
  const subject = otp + ' — Código de verificação Belenergy';

  // 1. Resend.com (preferred — free 3k/month, no Gmail needed)
  if (process.env.RESEND_API_KEY) {
    const fetch = (await import('node-fetch')).default;
    const from  = process.env.RESEND_FROM || 'Belenergy Support Pro <noreply@' + (process.env.RESEND_DOMAIN || 'belenergy.com.br') + '>';
    const res   = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ from, to: [email], subject, html }),
      signal:  AbortSignal.timeout(10_000),
    });
    if (res.ok) { console.log('[OTP] Sent via Resend to', email); return true; }
    const err = await res.json().catch(() => ({}));
    console.warn('[OTP] Resend failed:', err?.message || res.status, '— trying fallback');
  }

  // 2. sheets.js sendEmail (existing Gmail / SMTP config)
  try {
    const mod = require('./sheets');
    if (typeof mod.sendEmail === 'function') {
      await mod.sendEmail({ to: email, subject, html });
      console.log('[OTP] Sent via sheets.sendEmail to', email);
      return true;
    }
  } catch (e) {
    console.warn('[OTP] sheets.sendEmail failed:', e.message);
  }

  // 3. Direct nodemailer SMTP fallback
  const user = process.env.GMAIL_USER;
  const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s/g, '');
  if (user && pass) {
    const nodemailer = require('nodemailer');
    const t = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 587, secure: false, requireTLS: true,
      auth: { user, pass },
    });
    await t.sendMail({ from: '"Belenergy" <' + user + '>', to: email, subject, html });
    console.log('[OTP] Sent via direct SMTP to', email);
    return true;
  }

  throw new Error('Nenhum provedor de email configurado. Defina RESEND_API_KEY ou GMAIL_USER + GMAIL_APP_PASSWORD no .env');
}

async function sendOTP(phone, otp, name, email) {
  // Primary: email — reuses existing Gmail/SMTP from sheets.js (no new config needed)
  if (email && await sendOTPEmail(email, otp, name)) return 'email';

  // Fallback: Meta WhatsApp Cloud API (only if WHATSAPP_TOKEN + WHATSAPP_PHONE_ID configured)
  const msg = 'Belenergy Support Pro - Codigo de verificacao: ' + otp + ' - Valido por 5 minutos.';
  if (await sendWhatsAppMeta(phone, msg)) return 'whatsapp';

  // Last resort: log to console (dev only — set up email in production)
  console.warn('[PhoneAuth] No email or WhatsApp configured. OTP:', otp, 'for', phone);
  return 'console';
}


async function notifyUser(email, phone, msg) {
  try {
    if (email) {
      const { sendEmail } = require('./sheets');
      await sendEmail({ to: email, subject: 'Belenergy Support Pro', html: '<p style="font-family:sans-serif">' + msg + '</p>' });
    } else {
      await sendWhatsAppMeta(phone, msg);
    }
  } catch (e) { console.warn('[Notify]', e.message); }
}

// ── Validate password strength ────────────────────────────────────────────────
function validatePassword(password) {
  if (!password || password.length < 8) return 'Senha deve ter pelo menos 8 caracteres';
  if (!/[0-9]/.test(password))          return 'Senha deve conter pelo menos um número';
  if (!/[a-zA-Z]/.test(password))       return 'Senha deve conter pelo menos uma letra';
  return null; // valid
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// ── POST /api/phone-auth/register — step 1: validate + send OTP to email ──────
// OTP verifies the email is real before creating the account.
// Registration data is re-submitted with the OTP on /verify-email.
router.post('/register', async (req, res) => {
  try {
    const { phone: rawPhone, name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    }
    if (!email.includes('@')) {
      return res.status(400).json({ error: 'Email inválido' });
    }

    const pwErr = validatePassword(password);
    if (pwErr) return res.status(400).json({ error: pwErr });

    // Check if already registered and approved
    const { data: existing } = await supabaseAdmin
      .from('phone_users').select('id, approved, phone_verified').ilike('email', email).maybeSingle();

    if (existing?.approved) {
      return res.status(409).json({ error: 'Este email já possui acesso. Use o login.' });
    }
    if (existing?.phone_verified) {
      return res.status(409).json({
        error: 'Cadastro já registrado e aguardando aprovação.',
        pending: true,
      });
    }

    // Rate limit: 1 OTP per minute per email
    const { data: recent } = await supabaseAdmin
      .from('phone_auth_requests')
      .select('created_at')
      .eq('phone', 'email:' + email.toLowerCase())
      .eq('used', false)
      .gte('created_at', new Date(Date.now() - 60_000).toISOString())
      .limit(1);

    if (recent?.length) {
      return res.status(429).json({ error: 'Aguarde 1 minuto antes de solicitar novo código.' });
    }

    // Generate 6-digit OTP
    const otp      = generateOTP();
    const expires  = new Date(Date.now() + 5 * 60_000);

    // Store OTP (phone field stores 'email:xxx' for email-based OTPs)
    await supabaseAdmin.from('phone_auth_requests').insert([{
      phone:      'email:' + email.toLowerCase(),
      email:      email,
      name:       name,
      otp_hash:   hashOTP(otp),
      expires_at: expires.toISOString(),
    }]);

    // Email OTP temporarily disabled — account restoration pending
    // TODO: re-enable sendOTPEmail() once Gmail account is restored
    console.log('[PhoneAuth] OTP (email disabled):', otp, '→', email);

    // Skip OTP step while email is down — go straight to pending admin approval
    return res.json({ success: true, pending: true });
  } catch (err) {
    console.error('[PhoneAuth] register error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/phone-auth/verify-email — step 2: verify OTP + create account ──
router.post('/verify-email', async (req, res) => {
  try {
    const { name, email, phone: rawPhone, password, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email e código obrigatórios' });

    // Find valid OTP for this email
    const { data: requests } = await supabaseAdmin
      .from('phone_auth_requests')
      .select('*')
      .eq('phone', 'email:' + email.toLowerCase())
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1);

    const req_ = requests?.[0];
    if (!req_) return res.status(400).json({ error: 'Código expirado. Clique em "Reenviar código".' });
    if ((req_.attempts || 0) >= 3) return res.status(400).json({ error: 'Muitas tentativas. Solicite novo código.' });

    if (req_.otp_hash !== hashOTP(String(otp).trim())) {
      await supabaseAdmin.from('phone_auth_requests')
        .update({ attempts: (req_.attempts || 0) + 1 }).eq('id', req_.id);
      const left = 3 - (req_.attempts || 0) - 1;
      return res.status(400).json({ error: `Código incorreto. ${left} tentativa(s) restante(s).` });
    }

    // Mark OTP as used
    await supabaseAdmin.from('phone_auth_requests').update({ used: true }).eq('id', req_.id);

    // Use name/password from OTP record or from request body
    const finalName     = name || req_.name || email.split('@')[0];
    const finalPassword = password;

    if (!finalPassword) return res.status(400).json({ error: 'Senha obrigatória' });

    const phone  = rawPhone ? normalizePhone(rawPhone) : ('email_' + email.replace(/[^a-z0-9]/gi, '_'));
    const salt   = generateSalt();
    const pwHash = hashPassword(finalPassword, salt);

    // Create user (phone_verified=true, approved=false — awaits admin)
    const { error: insertErr } = await supabaseAdmin.from('phone_users').upsert([{
      id:             phone,
      phone,
      email:          email.toLowerCase(),
      name:           finalName,
      password_hash:  pwHash,
      password_salt:  salt,
      phone_verified: true,
      approved:       false,
      updated_at:     new Date(),
    }], { onConflict: 'id' });

    if (insertErr) throw insertErr;

    // Send confirmation email
    try {
      const { sendEmail } = require('./sheets');
      await sendEmail({
        to:      email,
        subject: 'Cadastro recebido — Belenergy Support Pro',
        html: `<div style="font-family:sans-serif;max-width:440px;margin:0 auto;padding:32px 24px;background:#0C0E16;border-radius:16px;color:#EEF0F8">
          <div style="text-align:center;font-size:40px;margin-bottom:16px">⚡</div>
          <h2 style="color:#FFD700;text-align:center">Email verificado!</h2>
          <p style="color:#C4C9DC;line-height:1.6">Seu email foi confirmado. Um administrador irá aprovar seu acesso em breve.</p>
          <p style="color:#C4C9DC;line-height:1.6">Você receberá um email assim que for aprovado.</p>
        </div>`,
      });
    } catch {}

    return res.json({ success: true, pending: true });
  } catch (err) {
    console.error('[PhoneAuth] verify-email error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/phone-auth/resend-otp — resend verification OTP ────────────────
router.post('/resend-otp', async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ error: 'Email obrigatório' });

    // Rate limit
    const { data: recent } = await supabaseAdmin
      .from('phone_auth_requests')
      .select('created_at').eq('phone', 'email:' + email.toLowerCase()).eq('used', false)
      .gte('created_at', new Date(Date.now() - 60_000).toISOString()).limit(1);
    if (recent?.length) return res.status(429).json({ error: 'Aguarde 1 minuto.' });

    const otp = generateOTP();
    await supabaseAdmin.from('phone_auth_requests').insert([{
      phone: 'email:' + email.toLowerCase(), email, name: name || '',
      otp_hash: hashOTP(otp),
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    }]);

    const { sendEmail } = require('./sheets');
    const first = (name || email).split(' ')[0].split('@')[0];
    await sendEmail({
      to: email,
      subject: `${otp} — Novo código Belenergy`,
      html: `<div style="font-family:sans-serif;padding:24px;background:#0C0E16;border-radius:12px;color:#EEF0F8;max-width:400px;margin:0 auto">
        <p style="color:#C4C9DC">Olá ${first}! Seu novo código:</p>
        <div style="text-align:center;padding:20px;background:#1C1F2E;border-radius:8px;margin:16px 0">
          <span style="font-size:40px;letter-spacing:12px;color:#FFD700;font-weight:900;font-family:monospace">${otp}</span>
        </div>
        <p style="color:#6B7694;font-size:12px;text-align:center">Válido por 5 minutos.</p>
      </div>`,
    });

    return res.json({ success: true, expiresIn: 300 });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/phone-auth/verify-otp — step 2: confirm OTP ────────────────────
router.post('/verify-otp', async (req, res) => {
  try {
    const { phone: rawPhone, otp } = req.body;
    if (!rawPhone || !otp) return res.status(400).json({ error: 'Telefone e código obrigatórios' });

    const phone = normalizePhone(rawPhone);

    const { data: requests } = await supabaseAdmin
      .from('phone_auth_requests')
      .select('*')
      .eq('phone', phone)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1);

    const req_ = requests?.[0];
    if (!req_) return res.status(400).json({ error: 'Código expirado. Solicite um novo.' });
    if (req_.attempts >= 3) return res.status(400).json({ error: 'Muitas tentativas. Solicite novo código.' });

    if (req_.otp_hash !== hashOTP(String(otp))) {
      await supabaseAdmin.from('phone_auth_requests')
        .update({ attempts: (req_.attempts || 0) + 1 }).eq('id', req_.id);
      const left = 3 - (req_.attempts || 0) - 1;
      return res.status(400).json({ error: `Código incorreto. ${left} tentativa(s) restante(s).` });
    }

    // Mark OTP used + mark phone as verified
    await supabaseAdmin.from('phone_auth_requests').update({ used: true }).eq('id', req_.id);
    await supabaseAdmin.from('phone_users')
      .update({ phone_verified: true, updated_at: new Date() })
      .eq('phone', phone);

    // Check if admin needs to approve (always required)
    return res.json({
      success: true,
      pending: true,
      message: 'Número verificado! Sua conta será ativada após aprovação do administrador.',
    });
  } catch (err) {
    console.error('[PhoneAuth] verify-otp error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/phone-auth/send-otp — resend OTP ────────────────────────────────
router.post('/send-otp', async (req, res) => {
  try {
    const { phone: rawPhone } = req.body;
    const phone = normalizePhone(rawPhone);
    const { data: pu } = await supabaseAdmin.from('phone_users').select('name').eq('phone', phone).maybeSingle();
    if (!pu) return res.status(404).json({ error: 'Número não cadastrado. Faça o registro primeiro.' });

    // Rate limit
    const { data: recent } = await supabaseAdmin
      .from('phone_auth_requests').select('created_at').eq('phone', phone).eq('used', false)
      .gte('created_at', new Date(Date.now() - 60_000).toISOString()).limit(1);
    if (recent?.length) return res.status(429).json({ error: 'Aguarde 1 minuto.' });

    const otp = generateOTP();
    await supabaseAdmin.from('phone_auth_requests').insert([{
      phone: 'email:' + (pu.email || '').toLowerCase(),
      email: pu.email || null,
      name:  pu.name  || null,
      otp_hash: hashOTP(otp),
      expires_at: new Date(Date.now() + 5*60_000).toISOString(),
    }]);

    // Pass email as 4th arg so sendOTP uses email (not WhatsApp)
    const emailSent = pu.email ? await sendOTPEmail(pu.email, otp, pu.name) : false;
    if (!emailSent) {
      return res.status(500).json({ error: 'Falha ao enviar email. Verifique a configuração do Gmail no servidor.' });
    }
    const masked = (pu.email || '').replace(/(.{2})(.*)(@.*)/, '$1***$3');
    return res.json({ success: true, via: 'email', maskedEmail: masked, expiresIn: 300 });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/phone-auth/login ────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { phone: rawInput, email: emailInput, password } = req.body;
    if (!password) return res.status(400).json({ error: 'Senha obrigatória' });

    let pu;
    // Try email first (primary login method)
    const lookupEmail = emailInput || rawInput;
    if (lookupEmail && lookupEmail.includes('@')) {
      const { data } = await supabaseAdmin.from('phone_users').select('*')
        .ilike('email', lookupEmail.trim()).maybeSingle();
      pu = data;
    }
    // Fallback: try phone if input looks like a number
    if (!pu && rawInput && !rawInput.includes('@')) {
      try {
        const phone = normalizePhone(rawInput);
        const { data } = await supabaseAdmin.from('phone_users').select('*').eq('phone', phone).maybeSingle();
        pu = data;
      } catch {}
    }

    if (!pu) return res.status(401).json({ error: 'Número/email não encontrado.' });
    if (!pu.phone_verified) return res.status(401).json({ error: 'Número de telefone não verificado. Verifique seu WhatsApp.' });
    if (!pu.approved) return res.status(401).json({ error: 'Conta aguardando aprovação do administrador.', pending: true });

    if (!verifyPassword(password, pu.password_salt, pu.password_hash)) {
      return res.status(401).json({ error: 'Senha incorreta.' });
    }

    // Create session
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const user = {
      id:         pu.phone,
      phone:      pu.phone,
      email:      pu.email || '',
      name:       pu.name,
      picture:    null,
      authMethod: 'phone',
    };

    await supabaseAdmin.from('persistent_sessions').insert([{
      token: sessionToken, user_id: pu.phone, user_data: JSON.stringify(user),
    }]);

    // settings_user row for permissions
    const { data: su } = await supabaseAdmin.from('settings_user').select('user_id').eq('user_id', pu.phone).maybeSingle();
    if (!su) {
      await supabaseAdmin.from('settings_user').insert([{ user_id: pu.phone, role_id: pu.role_id || 3 }]);
    }

    // Update last_login
    await supabaseAdmin.from('phone_users').update({ last_login: new Date() }).eq('id', pu.phone);

    const isCloud = process.env.CLOUD_MODE === 'true';
    res.cookie('session_token', sessionToken, {
      httpOnly: true, secure: isCloud, sameSite: isCloud ? 'none' : 'lax',
      maxAge: 30 * 24 * 3600 * 1000,
    });

    return res.json({
      success:      true,
      token:        sessionToken,
      user,
      tempPassword: pu.temp_password || false, // client must force change
    });
  } catch (err) {
    console.error('[PhoneAuth] login error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/phone-auth/change-password — change own password ────────────────
router.post('/change-password', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Campos obrigatórios' });

    const pwErr = validatePassword(newPassword);
    if (pwErr) return res.status(400).json({ error: pwErr });

    const { data: pu } = await supabaseAdmin.from('phone_users').select('*').eq('id', userId).maybeSingle();
    if (!pu) return res.status(404).json({ error: 'Usuário não encontrado' });

    if (!verifyPassword(currentPassword, pu.password_salt, pu.password_hash)) {
      return res.status(401).json({ error: 'Senha atual incorreta' });
    }

    const salt   = generateSalt();
    const pwHash = hashPassword(newPassword, salt);

    await supabaseAdmin.from('phone_users').update({
      password_hash: pwHash,
      password_salt: salt,
      temp_password: false,
      updated_at:    new Date(),
    }).eq('id', userId);

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ROUTES — require admin or master role
// ─────────────────────────────────────────────────────────────────────────────

async function isAdminOrMaster(req) {
  if (!req.user?.id) return false;
  const { data: su } = await supabaseAdmin
    .from('settings_user').select('role_id').eq('user_id', req.user.id).maybeSingle();
  return su?.role_id === 1 || su?.role_id === 2;
}

// ── GET /api/phone-auth/admin/users ──────────────────────────────────────────
router.get('/admin/users', async (req, res) => {
  try {
    if (!await isAdminOrMaster(req)) return res.status(403).json({ error: 'Acesso negado' });
    const { data, error } = await supabaseAdmin
      .from('phone_users_admin')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/phone-auth/admin/approve/:id ────────────────────────────────────
router.post('/admin/approve/:id', async (req, res) => {
  try {
    if (!await isAdminOrMaster(req)) return res.status(403).json({ error: 'Acesso negado' });

    const { action, role_id = 3 } = req.body; // action: 'approve' | 'reject'
    const userId = decodeURIComponent(req.params.id);

    if (action === 'approve') {
      await supabaseAdmin.from('phone_users').update({
        approved:    true,
        role_id:     Number(role_id),
        approved_by: req.user.id,
        approved_at: new Date(),
        updated_at:  new Date(),
      }).eq('id', userId);

      // Create settings_user row for RBAC
      await supabaseAdmin.from('settings_user').upsert([{
        user_id:    userId,
        role_id:    Number(role_id),
        updated_at: new Date(),
      }], { onConflict: 'user_id' });

      // Notify user via WhatsApp
      try {
        const { data: pu } = await supabaseAdmin.from('phone_users').select('phone, name').eq('id', userId).maybeSingle();
        if (pu) {
          const msg = `✅ Belenergy Support Pro\n\nOlá ${pu.name.split(' ')[0]}! Seu acesso foi aprovado. Faça login agora.`;
          await notifyUser(pu.email || null, pu.phone, msg);
        }
      } catch {}

    } else if (action === 'reject') {
      await supabaseAdmin.from('phone_users').delete().eq('id', userId);
    }

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/phone-auth/admin/reset-password/:id ────────────────────────────
// Admin sets a temporary password. Never sees current password.
router.post('/admin/reset-password/:id', async (req, res) => {
  try {
    if (!await isAdminOrMaster(req)) return res.status(403).json({ error: 'Acesso negado' });

    const { tempPassword } = req.body;
    if (!tempPassword) return res.status(400).json({ error: 'Senha temporária obrigatória' });

    const pwErr = validatePassword(tempPassword);
    if (pwErr) return res.status(400).json({ error: pwErr });

    const userId = decodeURIComponent(req.params.id);

    const salt   = generateSalt();
    const pwHash = hashPassword(tempPassword, salt);

    await supabaseAdmin.from('phone_users').update({
      password_hash: pwHash,
      password_salt: salt,
      temp_password: true,  // forces change on next login
      updated_at:    new Date(),
    }).eq('id', userId);

    // Notify user
    try {
      const { data: pu } = await supabaseAdmin.from('phone_users').select('phone, name').eq('id', userId).maybeSingle();
      if (pu) {
        const msg = `🔐 Belenergy Support Pro\n\nOlá ${pu.name.split(' ')[0]}! Sua senha foi redefinida pelo administrador.\n\nSenha temporária: ${tempPassword}\n\nVocê será solicitado a criar uma nova senha no próximo login.`;
        await notifyUser(pu.email || null, pu.phone, msg);
      }
    } catch {}

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/phone-auth/admin/role/:id ────────────────────────────────────────
router.put('/admin/role/:id', async (req, res) => {
  try {
    if (!await isAdminOrMaster(req)) return res.status(403).json({ error: 'Acesso negado' });
    const userId = decodeURIComponent(req.params.id);
    const { role_id } = req.body;
    await supabaseAdmin.from('phone_users').update({ role_id: Number(role_id), updated_at: new Date() }).eq('id', userId);
    await supabaseAdmin.from('settings_user').upsert([{ user_id: userId, role_id: Number(role_id), updated_at: new Date() }], { onConflict: 'user_id' });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/phone-auth/callmebot-key — save user's Callmebot apikey ──────────
// After user activates Callmebot (messages +34 644 43 26 75 on WhatsApp),
// they receive an apikey. They submit it here so OTPs use Callmebot.
router.post('/callmebot-key', async (req, res) => {
  try {
    const { phone: rawPhone, apikey } = req.body;
    if (!rawPhone || !apikey) return res.status(400).json({ error: 'Telefone e apikey obrigatórios' });
    const phone = normalizePhone(rawPhone);
    await supabaseAdmin.from('phone_users')
      .update({ callmebot_apikey: apikey, updated_at: new Date() })
      .eq('phone', phone);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;

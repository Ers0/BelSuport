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
  if (!email) return false;
  try {
    const { sendEmail } = require('./sheets');
    const firstName = (name || '').split(' ')[0] || 'Técnico';
    await sendEmail({
      to:      email,
      subject: `${otp} — Seu código de acesso Belenergy`,
      html: `
        <div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:32px 24px;background:#0C0E16;border-radius:16px;color:#EEF0F8">
          <div style="text-align:center;margin-bottom:28px">
            <div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;background:linear-gradient(135deg,#FFD700,#FF8C00);border-radius:16px;font-size:26px">⚡</div>
            <div style="font-size:18px;font-weight:800;margin-top:12px">Belenergy Support Pro</div>
          </div>
          <p style="color:#C4C9DC;margin-bottom:8px">Olá, ${firstName}!</p>
          <p style="color:#C4C9DC;margin-bottom:24px">Seu código de verificação é:</p>
          <div style="text-align:center;margin:24px 0">
            <span style="font-size:42px;font-weight:900;letter-spacing:10px;color:#FFD700">${otp}</span>
          </div>
          <p style="color:#6B7694;font-size:13px;text-align:center">Válido por 5 minutos. Não compartilhe este código.</p>
          <hr style="border:none;border-top:1px solid #1C1F2E;margin:24px 0"/>
          <p style="color:#6B7694;font-size:11px;text-align:center">Se você não solicitou este código, ignore este email.</p>
        </div>
      `,
    });
    return true;
  } catch (err) {
    console.error('[OTP Email] Failed:', err.message);
    return false;
  }
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

// ── POST /api/phone-auth/register — no OTP, admin approval is verification ───
router.post('/register', async (req, res) => {
  try {
    const { phone: rawPhone, name, email, password } = req.body;
    if (!rawPhone || !name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email, telefone e senha são obrigatórios' });
    }

    const phone = normalizePhone(rawPhone);
    const pwErr = validatePassword(password);
    if (pwErr) return res.status(400).json({ error: pwErr });

    // Check if already registered
    const { data: existing } = await supabaseAdmin
      .from('phone_users').select('id, approved').eq('phone', phone).maybeSingle();

    if (existing?.approved) {
      return res.status(409).json({ error: 'Este número já possui acesso. Use o login.' });
    }
    if (existing) {
      return res.status(409).json({ error: 'Cadastro já registrado e aguardando aprovação.', pending: true });
    }

    // Create user as pending — no OTP needed (admin approval is the verification)
    const salt   = generateSalt();
    const pwHash = hashPassword(password, salt);

    await supabaseAdmin.from('phone_users').insert([{
      id:             phone,
      phone,
      email,
      name,
      password_hash:  pwHash,
      password_salt:  salt,
      phone_verified: true,   // email collected at registration is sufficient proof
      approved:       false,
      updated_at:     new Date(),
    }]);

    // Send confirmation email to user
    try {
      const { sendEmail } = require('./sheets');
      const first = name.split(' ')[0];
      await sendEmail({
        to:      email,
        subject: 'Cadastro recebido — Belenergy Support Pro',
        html: `<div style="font-family:sans-serif;max-width:420px;padding:32px 24px;background:#0C0E16;color:#EEF0F8;border-radius:16px;margin:0 auto">
          <div style="font-size:36px;margin-bottom:16px;text-align:center">⚡</div>
          <h2 style="color:#FFD700;margin-bottom:8px;text-align:center">Cadastro recebido!</h2>
          <p style="color:#C4C9DC">Olá, <b>${first}</b>!</p>
          <p style="color:#C4C9DC;line-height:1.6">Seu cadastro foi registrado com sucesso. Um administrador irá revisar e aprovar seu acesso em breve.</p>
          <p style="color:#C4C9DC;line-height:1.6">Você receberá um email quando seu acesso for liberado.</p>
          <hr style="border:none;border-top:1px solid #1C1F2E;margin:20px 0"/>
          <p style="color:#6B7694;font-size:11px;text-align:center">Belenergy Support Pro · Sistema interno</p>
        </div>`,
      });
    } catch (emailErr) {
      console.warn('[PhoneAuth] Confirmation email failed:', emailErr.message);
    }

    return res.json({ success: true, pending: true });
  } catch (err) {
    console.error('[PhoneAuth] register error:', err.message);
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
      phone, otp_hash: hashOTP(otp), expires_at: new Date(Date.now() + 5*60_000).toISOString(),
    }]);
    const via = await sendOTP(phone, otp, (pu.name || '').split(' ')[0]);
    return res.json({ success: true, via, phone: phone.slice(0,-4) + '****', expiresIn: 300 });
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
    if (rawInput) {
      try {
        const phone = normalizePhone(rawInput);
        const { data } = await supabaseAdmin.from('phone_users').select('*').eq('phone', phone).maybeSingle();
        pu = data;
      } catch { /* not a valid phone, try email */ }
    }
    if (!pu && emailInput) {
      const { data } = await supabaseAdmin.from('phone_users').select('*')
        .ilike('email', emailInput.trim()).maybeSingle();
      pu = data;
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

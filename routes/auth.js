const express  = require('express');
const router   = express.Router();
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const { google } = require('googleapis');
const { supabase, supabaseAdmin } = require('../services/db');

const IS_CLOUD   = process.env.CLOUD_MODE === 'true' || process.env.NODE_ENV === 'production';
const BASE_PATH  = path.resolve(__dirname, '..');
const PORT       = process.env.PORT || 3000;
const APP_URL    = process.env.APP_URL || `http://localhost:${PORT}`;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `${APP_URL}/api/auth/callback`;
const SESSION_SECRET = process.env.SESSION_SECRET || 'belenergy-dev-secret-change-in-production';

// ── OAuth2 client — env vars first (Vercel), file fallback (local) ────────────
function getCredentials() {
  if (process.env.GOOGLE_CLIENT_ID) {
    return {
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uris: [REDIRECT_URI],
    };
  }
  const credPath = path.resolve(process.env.GOOGLE_CREDENTIALS_PATH || path.join(BASE_PATH, 'credentials.json'));
  if (!fs.existsSync(credPath)) {
    console.error('ERRO: credentials.json não encontrado e GOOGLE_CLIENT_ID não definido!');
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  return raw.installed || raw.web;
}

const creds = getCredentials();
const oauth2Client = creds
  ? new google.auth.OAuth2(creds.client_id, creds.client_secret, REDIRECT_URI)
  : null;

// ── Cookie helpers ────────────────────────────────────────────────────────────

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}

function setSessionCookie(res, token) {
  res.cookie('session_token', token, {
    httpOnly: true,
    secure:   IS_CLOUD,   // true on Vercel (HTTPS), false on localhost
    sameSite: IS_CLOUD ? 'none' : 'lax',
    maxAge:   30 * 24 * 60 * 60 * 1000,
  });
}

async function saveTokenToSupabase(userId, tokens) {
    // supabaseAdmin already imported at top of file

    console.log("📤 Enviando token para o Supabase...");
    
    const { error } = await supabaseAdmin
        .from('settings_user')
        .upsert({
            user_id: userId,
            google_token: tokens, // O objeto completo (access_token, refresh_token, etc)
            updated_at: new Date()
        });

    if (error) {
        console.error("❌ Erro ao salvar token na nuvem:", error.message);
    } else {
        console.log("✅ Token salvo com sucesso no Supabase! Você já pode fechar este terminal.");
    }
}

// ── Middleware: attach user to req if logged in ───────────────────────────────

async function authMiddleware(req, res, next) {
    // 1. Libera arquivos estáticos e rotas que não são da API
    if (!req.path.startsWith('/api')) return next();
    
    // 🚨 CORREÇÃO: Todos os "includes" precisam ficar DENTRO dos parênteses do if
    if (
        req.path.includes('/auth/login') || 
        req.path.includes('/auth/callback') || 
        req.path.includes('/drive/callback')
    ) {
        return next();
    }

    const authHeader = req.headers.authorization || '';
    // Also accept token from query param — needed for EventSource (SSE) which
    // cannot set custom headers via the browser EventSource API
    const token = (authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null)
               || req.query.token
               || null;

    if (!token || token === 'null' || token === 'undefined') {
        return res.status(401).json({ authenticated: false, error: 'Token necessário' });
    }

    try {
        // 🔍 Busca a sessão. Importante: usamos .maybeSingle() para evitar erros se não achar
        const { data, error } = await supabaseAdmin
            .from('persistent_sessions')
            .select('user_data')
            .eq('token', token)
            .maybeSingle();

        if (error) {
            console.error("❌ Erro ao consultar Supabase:", error.message);
            return res.status(401).json({ error: 'Erro de validação de sessão' });
        }

        if (data && data.user_data) {
            // Sucesso! Decodifica o usuário e autoriza
            const sessionUser = typeof data.user_data === 'string' ? JSON.parse(data.user_data) : data.user_data;
    
            // Any authenticated Google user can access the app.
            // Admin-only actions (products, global settings) are guarded
            // per-route via the isAdmin middleware in products.js / settings.js.
            req.user = sessionUser;
            return next();
        }

        // Se chegou aqui, o token não foi achado no banco
        console.warn(`⚠️ Token não encontrado no banco de dados.`);
        return res.status(401).json({ authenticated: false, error: 'Sessão inválida' });

    } catch (err) {
        console.error("🚨 Falha crítica no Middleware:", err.message);
        return res.status(401).json({ error: 'Erro interno de autenticação' });
    }
}
// ── GET /api/auth/login ───────────────────────────────────────────────────────

router.get('/login', (req, res) => {
  if (!oauth2Client) return res.status(500).send('Google OAuth não configurado.');
  try {
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt:      'select_account consent',
      scope: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/youtube',
      ],
    });
    console.log('Iniciando fluxo de login Google...');
    res.redirect(url);
  } catch (err) {
    console.error('Erro ao gerar URL do Google:', err);
    res.status(500).send('Auth error: ' + err.message);
  }
});

// ── GET /api/auth/callback ────────────────────────────────────────────────────
router.get('/callback', async (req, res) => {
  console.log("1. Callback recebido do Google...");
  const { code, error } = req.query;

  if (error) {
    console.error("Erro no callback do Google:", error);
    return res.redirect('/?auth_error=' + encodeURIComponent(error));
  }

  try {
    // 2. Troca o código pelo Token do Google
    console.log("2. Trocando código por tokens...");
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // 3. Pega os dados do usuário
    console.log("3. Buscando perfil do usuário...");
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const profile = await oauth2.userinfo.get();
    
    const user = {
      id: profile.data.id,
      email: profile.data.email,
      name: profile.data.name,
      picture: profile.data.picture,
      tokens: tokens
    };


    // ── Approval check ────────────────────────────────────────────────────────
    // 1. Check if user already has a settings_user row with a role
    const { data: existingUser } = await supabaseAdmin
      .from('settings_user')
      .select('user_id, role_id')
      .eq('user_id', user.id)
      .maybeSingle();

    // ── Check pre-approval FIRST (handles re-approval after revoke) ─────────────
    // Always check pre-approvals before blocking — admins may have re-granted access
    const { data: approval } = await supabaseAdmin
      .from('user_approvals')
      .select('role_id, id')
      .ilike('email', user.email)
      .eq('used', false)
      .maybeSingle();

    if (approval) {
      // Pre-approved (new or previously revoked user getting re-access)
      await supabaseAdmin.from('settings_user').upsert({
        user_id:    user.id,
        role_id:    approval.role_id,
        updated_at: new Date(),
      });
      await supabaseAdmin.from('user_approvals')
        .update({ used: true, used_at: new Date(), google_id: user.id })
        .eq('id', approval.id);
      console.log(`✅ [Auth] Pre-approved login: ${user.email} → role_id ${approval.role_id}`);
      // Fall through to normal session creation below
    } else if (existingUser && existingUser.role_id === null) {
      // Revoked AND no new pre-approval — hard block
      console.warn(`[Auth] BLOCKED revoked user: ${user.email} (${user.id})`);
      return res.send(`
        <html>
          <head><title>Belenergy — Acesso Negado</title></head>
          <body style="font-family:sans-serif;background:#0f111a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
            <div style="text-align:center;max-width:420px;background:#1a1d2e;border:1px solid rgba(239,68,68,.3);border-radius:16px;padding:48px">
              <div style="font-size:52px;margin-bottom:20px">🚫</div>
              <h2 style="color:#EF4444;margin:0 0 12px;font-size:22px">Acesso Revogado</h2>
              <p style="color:#9aa0b8;line-height:1.7;margin:0 0 28px">Seu acesso ao sistema foi removido pelo administrador. Entre em contato se achar que isso é um engano.</p>
              <a href="/" style="display:inline-block;padding:11px 28px;background:#FFD700;color:#000;border-radius:8px;text-decoration:none;font-weight:700">← Voltar</a>
            </div>
          </body>
        </html>
      `);
    }

    if (!existingUser && !approval) {
      // Completely new user with no pre-approval — request access
      {
        // Unknown user — log access request and notify admins/masters
        const { data: existing } = await supabaseAdmin
          .from('access_requests')
          .select('id')
          .ilike('email', user.email)
          .maybeSingle();

        if (!existing) {
          await supabaseAdmin.from('access_requests').insert([{
            email:        user.email,
            name:         user.name,
            picture:      user.picture,
            google_id:    user.id,
            requested_at: new Date(),
          }]);

          const { data: admins } = await supabaseAdmin
            .from('settings_user')
            .select('user_id')
            .in('role_id', [1, 2]);

          if (admins?.length) {
            const notifs = admins.map(a => ({
              user_id:   a.user_id,
              type:      'access_request',
              title:     'Novo pedido de acesso',
              message:   `${user.name} (${user.email}) tentou entrar no sistema. Vá em Configurações → Aprovações para aceitar ou negar.`,
              read:      false,
              created_at: new Date(),
            }));
            try { await supabaseAdmin.from('notifications').insert(notifs); } catch (_) {}

            // Also send email to all admin/master users
            try {
              const { sendEmail, accessRequestEmailHtml } = require('./sheets');
              const appUrl = process.env.APP_URL || 'http://localhost:3000';
              // Get admin emails from their session data
              const { data: adminSessions } = await supabaseAdmin
                .from('persistent_sessions').select('user_data');
              const adminEmails = new Set();
              for (const s of adminSessions || []) {
                try {
                  const ud = typeof s.user_data === 'string' ? JSON.parse(s.user_data) : s.user_data;
                  if (admins.some(a => a.user_id === ud?.id)) adminEmails.add(ud.email);
                } catch (_) {}
              }
              for (const adminEmail of adminEmails) {
                await sendEmail({
                  to:      adminEmail,
                  subject: `🔔 Novo pedido de acesso — ${user.name}`,
                  html:    accessRequestEmailHtml(user.name, user.email, appUrl),
                }).catch(() => {});
              }
            } catch (_) {}
          }
          console.warn(`⚠️  [Auth] Unknown login: ${user.email} — access request created, admins notified`);
        } else {
          console.warn(`⚠️  [Auth] Repeated unknown login attempt: ${user.email} (request already pending)`);
        }

        // ── NO SESSION CREATED — return pending page immediately ──────────────
        return res.send(`
          <html>
            <head><title>Belenergy — Aguardando Aprovação</title></head>
            <body style="font-family:sans-serif;background:#0f111a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
              <div style="text-align:center;max-width:440px;background:#1a1d2e;border:1px solid rgba(255,215,0,.2);border-radius:16px;padding:48px">
                <div style="font-size:52px;margin-bottom:20px">⏳</div>
                <h2 style="color:#FFD700;margin:0 0 12px;font-size:22px">Acesso Pendente</h2>
                <p style="color:#9aa0b8;line-height:1.7;margin:0 0 8px">Sua solicitação foi registrada com o email:</p>
                <p style="color:#e2e8f0;font-weight:700;margin:0 0 20px">${user.email}</p>
                <p style="color:#9aa0b8;line-height:1.7;margin:0 0 28px">O administrador foi notificado e liberará seu acesso em breve. Tente novamente depois.</p>
                <a href="/" style="display:inline-block;padding:11px 28px;background:#FFD700;color:#000;border-radius:8px;text-decoration:none;font-weight:700">← Voltar ao login</a>
              </div>
            </body>
          </html>
        `);
      }
    }
    // ── End approval check ────────────────────────────────────────────────────

    // 4. Gera o token da SUA sessão (o que vai no persistent_sessions)
    console.log("4. Gerando token de sessão...");
    const sessionToken = crypto.randomBytes(32).toString('hex');

    // 5. SALVA NO SUPABASE
    console.log("5. Tentando salvar no Supabase...");
    const { data, error: dbError } = await supabaseAdmin
      .from('persistent_sessions')
      .insert([
        { 
          token: sessionToken, 
          user_data: JSON.stringify(user) 
        }
      ]);

    if (dbError) {
      console.error("ERRO CRÍTICO NO SUPABASE:", dbError.message);
      throw dbError;
    }

    console.log("6. Sucesso! Enviando ponte de autenticação para o navegador...");

    // Enviamos um HTML temporário que o navegador executa e depois se auto-destrói
    return res.send(`
      <html>
        <head><title>Autenticando Belenergy...</title></head>
        <body>
          <script>
            // 1. O servidor "carimba" o token no navegador aqui
            localStorage.setItem('session_token', '${sessionToken}');
            
            // 2. Agora que o token está salvo no 'bolso', vamos para o App
            window.location.href = '/';
          </script>
          <div style="font-family: sans-serif; text-align: center; padding-top: 50px;">
            <h2>Autenticado!</h2>
            <p>Preparando seu painel de controle...</p>
          </div>
        </body>
      </html>
    `);

  } catch (err) {
    console.error('Falha total no login:', err);
    // Show a friendly page instead of exposing the raw error in the URL
    return res.send(`
      <html>
        <head>
          <title>Belenergy — Acesso Pendente</title>
          <style>
            body { font-family: 'Segoe UI', sans-serif; background:#0f111a; color:#e2e8f0;
                   display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
            .card { background:#1a1d2e; border:1px solid #2d3148; border-radius:16px;
                    padding:48px 56px; text-align:center; max-width:480px; }
            .icon { font-size:52px; margin-bottom:20px; }
            h2 { font-size:22px; font-weight:700; margin:0 0 12px; color:#fff; }
            p  { font-size:14px; color:#9aa0b8; line-height:1.7; margin:0 0 28px; }
            a  { display:inline-block; padding:11px 28px; background:#FFD700; color:#000;
                 border-radius:8px; text-decoration:none; font-weight:700; font-size:14px; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon">⏳</div>
            <h2>Acesso Pendente de Aprovação</h2>
            <p>Sua solicitação de acesso foi registrada e o administrador foi notificado.<br>
               Você receberá acesso assim que sua conta for aprovada.</p>
            <a href="/">← Voltar ao login</a>
          </div>
        </body>
      </html>
    `);
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────

router.get('/me', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ authenticated: false });
  }

  try {
    // Hard gate: check role_id directly — bypasses cache
    const { data: su } = await supabaseAdmin
      .from('settings_user')
      .select('role_id')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (su && su.role_id === null) {
      // Explicitly revoked — never let them through
      return res.status(403).json({
        authenticated: false,
        blocked: true,
        message: 'Seu acesso foi revogado. Entre em contato com o administrador.',
      });
    }

    const { fetchUserPermissions } = require('../services/permissions');
    const { role, permissions } = await fetchUserPermissions(req.user.id, req.user.email);
    console.log(`[/me] user=${req.user.email} id=${req.user.id} role=${role} perms=${permissions.length}`);

    // If role is null (revoked), block access immediately
    if (!role || role === 'revoked') {
      return res.status(403).json({
        authenticated: false,
        blocked: true,
        message: 'Seu acesso foi revogado. Entre em contato com o administrador.',
      });
    }

    return res.json({
      authenticated: true,
      id:          req.user.id,
      email:       req.user.email,
      name:        req.user.name,
      picture:     req.user.picture,
      role,
      permissions,
    });
  } catch (_) {
    // Fallback — never block the user entirely
    return res.json({
      authenticated: true,
      id:          req.user.id,
      email:       req.user.email,
      name:        req.user.name,
      picture:     req.user.picture,
      role:        'technician',
      permissions: ['create_case','view_own_cases','edit_own_case','view_basic_status','export_pdf'],
    });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────

router.post('/logout', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (token) {
    try {
      // Remove a sessão do banco de dados na nuvem
      await supabaseAdmin.from('persistent_sessions').delete().eq('token', token);
    } catch (err) {
      console.error('Erro ao deletar sessão:', err);
    }
  }
  res.json({ success: true });
});

// Exportamos apenas o router (que agora contém o middleware dentro dele)
module.exports = {
  router: router,
  authMiddleware: authMiddleware // Exporte a função explicitamente
};
// ── GET /api/auth/approvals — list pre-approved emails (master + admin) ───────
router.get('/approvals', authMiddleware, async (req, res) => {
  try {
    const { data } = await supabaseAdmin
      .from('user_approvals')
      .select('id, email, role_id, approved_by, approved_at, used, used_at')
      .order('approved_at', { ascending: false });
    const { data: roles } = await supabaseAdmin.from('roles').select('id, name');
    const roleMap = Object.fromEntries((roles||[]).map(r => [r.id, r.name]));
    res.json((data||[]).map(a => ({ ...a, role: roleMap[a.role_id] || 'unknown' })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/auth/approvals — add a pre-approved email ──────────────────────
router.post('/approvals', authMiddleware, async (req, res) => {
  const { email, role_id } = req.body;
  if (!email || !role_id) return res.status(400).json({ error: 'email e role_id obrigatórios' });

  // Role restriction: admin can only pre-approve technicians (role_id=3)
  // Master can approve admins (2) and technicians (3)
  const { fetchUserPermissions } = require('../services/permissions');
  const { role } = await fetchUserPermissions(req.user.id, req.user.email);
  if (role !== 'master' && Number(role_id) <= 2) {
    return res.status(403).json({ error: 'Apenas o Master pode aprovar Admins' });
  }

  try {
    await supabaseAdmin.from('user_approvals').upsert({
      email: email.trim().toLowerCase(),
      role_id: Number(role_id),
      approved_by: req.user.id,
      approved_at: new Date(),
      used: false,
    });

    // If the user already exists in settings_user, update their role immediately
    const { data: existing } = await supabaseAdmin
      .from('persistent_sessions').select('user_data').limit(100);
    const match = (existing||[]).find(s => {
      try { const u = JSON.parse(s.user_data); return u.email?.toLowerCase() === email.trim().toLowerCase(); }
      catch { return false; }
    });
    if (match) {
      const ud = JSON.parse(match.user_data);
      await supabaseAdmin.from('settings_user').upsert({ user_id: ud.id, role_id: Number(role_id), updated_at: new Date() });
    }

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/auth/approvals/:id — REVOKE access completely ────────────────
router.delete('/approvals/:id', authMiddleware, async (req, res) => {
  try {
    // 1. Get the approval to find the email
    const { data: approval } = await supabaseAdmin
      .from('user_approvals').select('email, google_id').eq('id', req.params.id).maybeSingle();

    if (approval?.email) {
      const targetEmail = approval.email.toLowerCase();

      // Strategy 0: use google_id stored directly in user_approvals (most reliable)
      if (approval.google_id) {
        // Will be added below to userIds
      }

      // Strategy 1: find user_id from active persistent_sessions
      const { data: sessions } = await supabaseAdmin
        .from('persistent_sessions').select('token, user_data');

      const userIds = approval.google_id ? [approval.google_id] : [];
      const tokensToKill = [];
      for (const s of sessions || []) {
        try {
          const ud = typeof s.user_data === 'string' ? JSON.parse(s.user_data) : s.user_data;
          if (ud?.email?.toLowerCase() === targetEmail) {
            if (ud.id) userIds.push(ud.id);
            tokensToKill.push(s.token);
          }
        } catch (_) {}
      }

      // Strategy 2: find google_id from access_requests (covers logged-out users)
      if (userIds.length === 0) {
        const { data: req_ } = await supabaseAdmin
          .from('access_requests')
          .select('google_id')
          .ilike('email', targetEmail)
          .maybeSingle();
        if (req_?.google_id) userIds.push(req_.google_id);
      }

      // Strategy 3: scan ALL persistent_sessions (not just active) to find google_id
      // This catches admins who logged in before access_requests system existed
      if (userIds.length === 0) {
        for (const s of sessions || []) {
          try {
            const ud = typeof s.user_data === 'string' ? JSON.parse(s.user_data) : s.user_data;
            if (ud?.email?.toLowerCase() === targetEmail && ud?.id && !userIds.includes(ud.id)) {
              userIds.push(ud.id);
            }
          } catch (_) {}
        }
      }

      // Strategy 4: directly update settings_user by matching google_id stored 
      // in any session token — covers the case where user has no approval row at all
      // The nuclear option: update settings_user for ALL matching emails we found
      if (userIds.length === 0) {
        // Last resort: pull all sessions and brute-force match
        const { data: allSessions } = await supabaseAdmin
          .from('persistent_sessions').select('user_data');
        for (const s of allSessions || []) {
          try {
            const ud = typeof s.user_data === 'string' ? JSON.parse(s.user_data) : s.user_data;
            if (ud?.email?.toLowerCase() === targetEmail && ud?.id) {
              userIds.push(ud.id);
            }
          } catch (_) {}
        }
      }

      // 3. Nullify role_id in settings_user — blocks RBAC lookup
      for (const uid of userIds) {
        await supabaseAdmin.from('settings_user')
          .update({ role_id: null, updated_at: new Date() })
          .eq('user_id', uid);
        try { const { invalidateCache } = require('../services/permissions'); invalidateCache(uid); } catch (_) {}
      }

      // 4. Kill all active sessions
      for (const token of tokensToKill) {
        await supabaseAdmin.from('persistent_sessions').delete().eq('token', token);
      }

      console.log(`[Auth] Revoked ${targetEmail} — ${userIds.length} user(s) blocked, ${tokensToKill.length} session(s) killed`);
    }

    // 5. Remove the pre-approval record
    await supabaseAdmin.from('user_approvals').delete().eq('id', req.params.id);

    res.json({ success: true, message: 'Acesso revogado e sessões encerradas.' });
  } catch (e) {
    console.error('[Auth] Revoke error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/auth/access-requests — pending login requests ───────────────────
router.get('/access-requests', authMiddleware, async (req, res) => {
  try {
    const { data } = await supabaseAdmin
      .from('access_requests')
      .select('*')
      .eq('status', 'pending')
      .order('requested_at', { ascending: false });
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/auth/access-requests/:id — approve or deny ─────────────────────
router.post('/access-requests/:id', authMiddleware, async (req, res) => {
  const { action, role_id } = req.body; // action: 'approve' | 'deny'
  try {
    const { data: req_ } = await supabaseAdmin
      .from('access_requests').select('*').eq('id', req.params.id).single();
    if (!req_) return res.status(404).json({ error: 'Solicitação não encontrada' });

    await supabaseAdmin.from('access_requests').update({
      status: action === 'approve' ? 'approved' : 'denied',
      reviewed_by: req.user.id,
      reviewed_at: new Date(),
    }).eq('id', req.params.id);

    if (action === 'approve' && role_id && req_.google_id) {
      // Grant the role immediately
      await supabaseAdmin.from('settings_user').upsert({
        user_id:    req_.google_id,
        role_id:    Number(role_id),
        updated_at: new Date(),
      });
      // Pre-approve for future logins too
      await supabaseAdmin.from('user_approvals').upsert({
        email:       req_.email.toLowerCase(),
        role_id:     Number(role_id),
        google_id:   req_.google_id,
        approved_by: req.user.id,
        used:        true,
        used_at:     new Date(),
      });

      // Send approval email to the user
      try {
        const { sendEmail, approvedEmailHtml } = require('./sheets');
        const { data: roles } = await supabaseAdmin.from('roles').select('id,name');
        const roleName = (roles||[]).find(r => r.id === Number(role_id))?.name || 'technician';
        await sendEmail({
          to:      req_.email,
          subject: '✅ Seu acesso ao Belenergy Support Pro foi aprovado',
          html:    approvedEmailHtml(req_.name || req_.email, roleName),
        });
      } catch (_) {}

      console.log(`✅ [Auth] Access granted: ${req_.email} → role_id ${role_id}`);
    }

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

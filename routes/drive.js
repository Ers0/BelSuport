const express  = require('express');
const router   = express.Router();
const authMiddleware = require('../middlewares/auth');
const path     = require('path');
const fs       = require('fs');
const { google } = require('googleapis');
const db = require('../services/db');
console.log("🕵️ O que o Drive enxerga no banco:", Object.keys(db));
// Resolve paths
const BASE_PATH        = path.resolve(__dirname, '..');
const CREDENTIALS_PATH = path.resolve(process.env.GOOGLE_CREDENTIALS_PATH || path.join(BASE_PATH, 'credentials.json'));

// ── Auth ─────────────────────────────────────────────────────────────────────

async function getDriveService(userId) {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(`credentials.json não encontrado.`);
  }

  const raw   = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const creds = raw.installed || raw.web;
  const { client_id, client_secret, redirect_uris } = creds;
  
  // Usamos o primeiro redirect_uri do credentials ou o padrão do sistema
  const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris ? redirect_uris[0] : 'http://localhost:3333/callback');

  // 🚀 BUSCA O TOKEN PESSOAL DO USUÁRIO
  const { data: settings, error } = await db.supabaseAdmin
    .from('settings_user')
    .select('google_token')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !settings || !settings.google_token) {
    throw new Error('Google Drive não autenticado. Vá em Configurações e faça o login.');
  }

  auth.setCredentials(settings.google_token);

  // 🔄 Auto-refresh: Salva o novo token quando o Google renovar
  auth.on('tokens', async (tokens) => {
    const updatedTokens = { ...settings.google_token, ...tokens };
    await db.supabaseAdmin
      .from('settings_user')
      .update({ google_token: updatedTokens })
      .eq('user_id', userId);
    console.log('🔄 Google token renovado e salvo no Supabase para o usuário:', userId);
  });

  return google.drive({ version: 'v3', auth });
}

// ── Recursive folder walker ───────────────────────────────────────────────────

function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const dirs    = entries.filter(e => e.isDirectory()).map(e => e.name);
  const files   = entries.filter(e => e.isFile()).map(e => e.name);
  yield [dir, dirs, files];
  for (const d of dirs) yield* walk(path.join(dir, d));
}

async function uploadFolderToDrive(drive, localPath, driveParentId) {
  const folderMap = { [localPath]: driveParentId };

  for (const [root, dirs, files] of walk(localPath)) {
    for (const dir of dirs) {
      const localDir = path.join(root, dir);
      const res = await drive.files.create({
        resource: {
          name:     dir,
          mimeType: 'application/vnd.google-apps.folder',
          parents:  [folderMap[root]]
        },
        fields: 'id'
      });
      folderMap[localDir] = res.data.id;
    }

    for (const file of files) {
      const filePath = path.join(root, file);
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await drive.files.create({
            resource:   { name: file, parents: [folderMap[root]] },
            media:      { body: fs.createReadStream(filePath) }
          });
          break;
        } catch (err) {
          console.warn(`Retry ${attempt + 1}/5 for ${file}: ${err.message}`);
          if (attempt === 4) throw err;
          await new Promise(r => setTimeout(r, 2_000));
        }
      }
    }
  }
}

// ── POST /api/drive/upload ────────────────────────────────────────────────────

router.post('/upload', authMiddleware, async (req, res) => {
  const { caseId, folderName, folderPath, caseData, userId: bodyUserId } = req.body;
  const userId = req.user?.id || bodyUserId; // 🆔 ID do usuário logado (Google ID)

  try {
    // --- 🛡️ BLOCO DE SEGURANÇA DO NOME (Mudei para dentro do try) ---
    let nomeDatela = caseData?.tecnico_nome || caseData?.tecnio || "Admin"; // Nome padrão contra falhas
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (userId && uuidRegex.test(userId)) {
      // Só faz a busca no Supabase se o ID for um UUID de verdade
      const { data: userData, error: userError } = await db.supabase.auth.admin.getUserById(userId);
      if (nomeDatela === "Eros Costa" || nomeDatela === "Admin") {
          const { data: userData, error: userError } = await db.supabase.auth.admin.getUserById(userId);
          if (!userError && userData?.user) {
            nomeDatela = userData.user.user_metadata?.full_name || 
                            userData.user.user_metadata?.name || 
                            nomeDatela;
          }}
    } else {
      console.warn("⚠️ userId ignorado no Auth (Não é UUID):", userId);
    }
    // -----------------------------------------------------------------

    // 1. BUSCA O DRIVE_ID (MASTER) DO USUÁRIO NO BANCO
    const { data: userSettings, error: sErr } = await db.supabaseAdmin
      .from('settings_user')
      .select('drive_id')
      .eq('user_id', userId)
      .maybeSingle();

    const DRIVE_MASTER_ID = userSettings?.drive_id;

    if (!DRIVE_MASTER_ID) {
      return res.status(400).json({ 
        error: 'ID da pasta do Google Drive não configurado. Vá em Configurações.' 
      });
    }

    // 2. RESOLVE O CAMINHO LOCAL DA PASTA
    const { ORGANIZADOS, PENDENTES } = require('../services/watcher');
    let resolvedPath = folderPath;
    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      const name = caseData?.pasta_original || path.basename(resolvedPath || '');
      const inOrg = path.join(ORGANIZADOS, name);
      const inPen = path.join(PENDENTES, name);
      if (fs.existsSync(inOrg))      resolvedPath = inOrg;
      else if (fs.existsSync(inPen)) resolvedPath = inPen;
      else throw new Error('Pasta local não encontrada.');
    }

    // 3. AUTENTICA E INICIA UPLOAD
    const drive = await getDriveService(userId);
    const fabricante = (caseData?.fabricante || 'Outros').trim();

    // Busca ou cria pasta do Fabricante
    const listRes = await drive.files.list({
      q: `name='${fabricante}' and '${DRIVE_MASTER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id,name)'
    });

    let fabricanteId;
    if (listRes.data.files && listRes.data.files.length > 0) {
      fabricanteId = listRes.data.files[0].id;
    } else {
      const fabRes = await drive.files.create({
        resource: {
          name: fabricante,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [DRIVE_MASTER_ID]
        },
        fields: 'id'
      });
      fabricanteId = fabRes.data.id;
    }

    // Cria pasta do chamado: ClienteFinal - Integrador TEL - SN
    const tel    = (caseData?.tel_integrador || caseData?.contato || '00').replace(/\D/g,'').slice(-8);
    const nomeFormatadoDrive = [
      (caseData?.cliente_final || caseData?.integrador || 'Cliente').replace(/[\\/:*?"<>|]/g,'_').trim(),
      (caseData?.integrador || '').replace(/[\\/:*?"<>|]/g,'_').trim() || null,
      tel || null,
      caseData?.sn || 'SemSN',
    ].filter(Boolean).join(' - ');
    const rootRes = await drive.files.create({
      resource: {
        name: nomeFormatadoDrive,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [fabricanteId]
      },
      fields: 'id'
    });
    const driveId = rootRes.data.id;

    // Upload recursivo
    await uploadFolderToDrive(drive, resolvedPath, driveId);

    // 4. SALVA NO BANCO E DELETA PASTA LOCAL
    const now = new Date();
    const dataStr = now.toLocaleDateString('pt-BR');
    const horaStr = `${String(now.getHours()).padStart(2, '0')}:00`;

    if (caseId) {
      await db.supabaseAdmin.from('chamados').delete().eq('id', caseId);
    }

    const { data: inserted } = await db.supabaseAdmin.from('chamados').insert([{
      user_id:   userId,
      data:      dataStr,
      hora:      horaStr,
      nome:      nomeDatela,
      contato:   caseData?.contato || caseData?.tel_integrador || '',
      integrador: caseData?.integrador || 'Integrador Não Informado',
      sn:        caseData?.sn,
      modelo:    caseData?.modelo || '',
      categoria: caseData?.categoria,
      fabricante: caseData?.fabricante,
      relato:    caseData?.relato,
      status:    'Aguardando Protocolo',
      ven:       caseData?.ven,
      drive_id:  driveId
    }]).select('id').single();

    fs.rmSync(resolvedPath, { recursive: true, force: true });

    res.json({
      success: true,
      caseId:  inserted?.id || null,
      driveId,
      driveUrl: `https://drive.google.com/drive/folders/${driveId}`
    });

  } catch (err) {
    console.error('Finalize case error:', err);
    res.status(500).json({ error: err.message });
  }
});
router.get('/auth-url', authMiddleware, async (req, res) => {
  try {
    const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
    const { client_id, client_secret, redirect_uris } = raw.installed || raw.web;
    
    const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline', // Garante que receberemos o refresh_token
      prompt: 'consent',      // Força o Google a nos dar o refresh_token toda vez
      scope: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/youtube',
        'https://www.googleapis.com/auth/spreadsheets',
      ],
      state: req.user.id
    });

    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ROTA: Callback do Google (Onde o Google devolve o código) ────────────────
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  const userId = state; // Pegamos o ID do usuário logado na sessão

  try {
    const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
    const { client_id, client_secret, redirect_uris } = raw.installed || raw.web;
    const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    // Troca o código pelo Token
    const { tokens } = await oauth2Client.getToken(code);

    // 🔥 SALVA NO SUPABASE
    const { error } = await db.supabaseAdmin
      .from('settings_user')
      .upsert({
        user_id: userId,
        google_token: tokens,
        updated_at: new Date()
      });

    if (error) throw error;

    // Redireciona de volta para a aba de configurações com sucesso
    res.send(`
      <script>
        window.opener.postMessage('google-auth-success', '*');
        window.close();
      </script>
      <h1>Autenticado com sucesso! Pode fechar esta janela.</h1>
    `);
  } catch (err) {
    res.status(500).send("Erro na autenticação: " + err.message);
  }
});

// ── POST /api/drive/attach-pending ───────────────────────────────────────────
// Uploads a file to Drive in a /Pendentes subfolder linked to the case
router.post('/attach-pending', authMiddleware, async (req, res) => {
  const multer  = require('multer');
  const os      = require('os');
  const upload  = multer({ dest: os.tmpdir() }).single('file');

  upload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const userId = req.user?.id;
    const caseId = req.body?.caseId;
    const tmpPath = req.file.path;
    const originalName = req.file.originalname;

    try {
      // Build OAuth with same pattern as rest of drive.js
      const raw    = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
      const creds  = raw.installed || raw.web;
      const oauth2 = new google.auth.OAuth2(creds.client_id, creds.client_secret, creds.redirect_uris[0]);

      const { data: su } = await db.supabaseAdmin.from('settings_user').select('google_token, drive_id').eq('user_id', userId).maybeSingle();
      if (!su?.google_token) { fs.unlink(tmpPath, ()=>{}); return res.status(400).json({ error: 'Drive não autenticado' }); }
      oauth2.setCredentials(su.google_token);
      const drive = google.drive({ version: 'v3', auth: oauth2 });

      // Find or create a Pendentes subfolder inside user's Drive root
      const rootFolderId = su.drive_id || null;
      let pendFolderId = null;

      if (rootFolderId) {
        // Look for existing Pendentes folder
        const search = await drive.files.list({
          q: `name='Pendentes' and '${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
          fields: 'files(id)',
        });
        pendFolderId = search.data.files?.[0]?.id;

        if (!pendFolderId) {
          const created = await drive.files.create({
            requestBody: { name:'Pendentes', mimeType:'application/vnd.google-apps.folder', parents:[rootFolderId] },
            fields: 'id',
          });
          pendFolderId = created.data.id;
        }
      }

      // Upload file
      const parents = pendFolderId ? [pendFolderId] : (rootFolderId ? [rootFolderId] : []);
      const uploaded = await drive.files.create({
        requestBody: { name: originalName, parents },
        media: { mimeType: req.file.mimetype, body: fs.createReadStream(tmpPath) },
        fields: 'id, webViewLink',
      });

      fs.unlink(tmpPath, () => {});

      // Log to case events if caseId given
      if (caseId) {
        await db.supabaseAdmin.from('case_events').insert([{
          case_id:      parseInt(caseId),
          user_id:      userId,
          user_name:    req.user?.name || req.user?.email || 'Sistema',
          event_type:   'file_attached',
          description:  `Arquivo anexado: ${originalName}`,
          metadata:     { drive_id: uploaded.data.id, url: uploaded.data.webViewLink },
        }]).catch(() => {});
      }

      res.json({ success:true, driveId: uploaded.data.id, url: uploaded.data.webViewLink });
    } catch (e) {
      fs.unlink(tmpPath, () => {});
      console.error('[attach-pending]', e.message);
      res.status(500).json({ error: e.message });
    }
  });
});

module.exports = router;
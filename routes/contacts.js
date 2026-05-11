// routes/contacts.js — Tentativas de Contato
const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../services/db');
const { encryptFields, decryptRows, keyFromReq, ENCRYPTED_FIELDS } = require('../services/crypto');
const EF_ENT = ENCRYPTED_FIELDS.contact_entities;
const EF_ATT = ENCRYPTED_FIELDS.contact_attempts;

// ── GET /api/contacts — list entities
router.get('/', async (req, res) => {
  try {
    const userId = req.user?.id;
    const { category, q } = req.query;
    let query = supabaseAdmin
      .from('contact_entities')
      .select(`*, sessions:contact_sessions(id, title, status, chamado_id, created_at, updated_at, attempts:contact_attempts(id, result, attempted_at))`)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (category) query = query.eq('category', category);
    if (q)        query = query.ilike('name', `%${q}%`);
    const { data, error } = await query;
    if (error) throw error;
    res.json(decryptRows(data || [], EF_ENT, keyFromReq(req)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/contacts — create entity
router.post('/', async (req, res) => {
  try {
    const key = keyFromReq(req);
    const { data, error } = await supabaseAdmin
      .from('contact_entities')
      .insert([encryptFields({ ...req.body, user_id: req.user?.id, updated_at: new Date() }, EF_ENT, key)])
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/contacts/:id
router.put('/:id', async (req, res) => {
  try {
    const key = keyFromReq(req);
    const { data, error } = await supabaseAdmin
      .from('contact_entities')
      .update(encryptFields({ ...req.body, updated_at: new Date() }, EF_ENT, key))
      .eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/contacts/:id
router.delete('/:id', async (req, res) => {
  try {
    await supabaseAdmin.from('contact_entities').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/contacts/:id/sessions — list sessions for entity
router.get('/:id/sessions', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('contact_sessions')
      .select(`*, chamado:chamados(id, sn, fabricante, integrador, cliente_final, status), attempts:contact_attempts(*)`)
      .eq('entity_id', req.params.id)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/contacts/:id/sessions — create session
router.post('/:id/sessions', async (req, res) => {
  try {
    const { title, chamado_id, notes } = req.body;
    const { data, error } = await supabaseAdmin
      .from('contact_sessions')
      .insert([{
        entity_id:  req.params.id,
        user_id:    req.user?.id,
        title:      title || 'Nova sessão de contato',
        chamado_id: chamado_id || null,
        notes:      notes || null,
        updated_at: new Date(),
      }])
      .select(`*, chamado:chamados(id, sn, fabricante, integrador, cliente_final, status)`)
      .single();
    if (error) throw error;

    // bump entity updated_at
    await supabaseAdmin.from('contact_entities').update({ updated_at: new Date() }).eq('id', req.params.id);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/contacts/sessions/:id — update session
router.put('/sessions/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('contact_sessions')
      .update({ ...req.body, updated_at: new Date() })
      .eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/contacts/sessions/:id
router.delete('/sessions/:id', async (req, res) => {
  try {
    await supabaseAdmin.from('contact_sessions').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/contacts/sessions/:id/attempts
router.get('/sessions/:id/attempts', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('contact_attempts')
      .select('*')
      .eq('session_id', req.params.id)
      .order('attempted_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/contacts/sessions/:id/attempts — log attempt in session
router.post('/sessions/:id/attempts', async (req, res) => {
  try {
    const { result, notes, attempted_at } = req.body;
    const author = req.user?.name || req.user?.email || 'Sistema';

    // Get session to find entity_id
    const { data: session } = await supabaseAdmin
      .from('contact_sessions').select('entity_id').eq('id', req.params.id).single();

    const key = keyFromReq(req);
    const { data, error } = await supabaseAdmin
      .from('contact_attempts')
      .insert([encryptFields({
        session_id:   req.params.id,
        entity_id:    session?.entity_id,
        user_id:      req.user?.id,
        author,
        result:       result || 'no_answer',
        notes:        notes || null,
        attempted_at: attempted_at || new Date().toISOString(),
      }, EF_ATT, key)])
      .select().single();
    if (error) throw error;

    // Bump session + entity updated_at
    await supabaseAdmin.from('contact_sessions').update({ updated_at: new Date() }).eq('id', req.params.id);
    if (session?.entity_id) {
      await supabaseAdmin.from('contact_entities').update({ updated_at: new Date() }).eq('id', session.entity_id);
    }
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/contacts/attempts/:id
router.delete('/attempts/:id', async (req, res) => {
  try {
    await supabaseAdmin.from('contact_attempts').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// ── POST /api/contacts/attempts/:id/attach — upload screenshot to Drive ───────
router.post('/attempts/:id/attach', async (req, res) => {
  const multer = require('multer');
  const os     = require('os');
  const fs     = require('fs');
  const { google } = require('googleapis');
  const path   = require('path');

  const TMP    = process.env.CLOUD_MODE === 'true' ? '/tmp' : path.join(process.cwd(), '_tmp_uploads');
  if (TMP !== '/tmp') fs.mkdirSync(TMP, { recursive: true });

  const upload = multer({ dest: TMP, limits: { fileSize: 20 * 1024 * 1024 } }).single('file');

  upload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file' });

    const userId  = req.user?.id;
    const tmpPath = req.file.path;
    const origName = req.file.originalname;

    try {
      // Get attempt to find entity + session
      const { data: attempt } = await supabaseAdmin
        .from('contact_attempts')
        .select('*, session:contact_sessions(entity_id, title)')
        .eq('id', req.params.id)
        .single();

      // Get user Drive token
      const { data: su } = await supabaseAdmin
        .from('settings_user')
        .select('google_token, drive_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (!su?.google_token) {
        fs.unlink(tmpPath, ()=>{});
        return res.status(400).json({ error: 'Drive não autenticado' });
      }

      // Build Drive client
      const CREDS_PATH = process.env.GOOGLE_CREDENTIALS_PATH ||
        require('path').join(process.cwd(), 'credentials.json');
      const raw  = process.env.GOOGLE_CREDENTIALS_JSON
        ? JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON)
        : JSON.parse(require('fs').readFileSync(CREDS_PATH));
      const creds = raw.installed || raw.web;
      const oauth2 = new google.auth.OAuth2(creds.client_id, creds.client_secret, creds.redirect_uris[0]);
      oauth2.setCredentials(su.google_token);
      const drive = google.drive({ version: 'v3', auth: oauth2 });

      // Find or create Tentativas de Contato folder inside Drive root
      let parentId = su.drive_id || null;
      if (parentId) {
        const search = await drive.files.list({
          q: `name='Tentativas de Contato' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
          fields: 'files(id)',
        });
        let contFolder = search.data.files?.[0]?.id;
        if (!contFolder) {
          const created = await drive.files.create({
            requestBody: { name:'Tentativas de Contato', mimeType:'application/vnd.google-apps.folder', parents:[parentId] },
            fields: 'id',
          });
          contFolder = created.data.id;
        }
        parentId = contFolder;
      }

      // Upload file
      const uploaded = await drive.files.create({
        requestBody: { name: origName, parents: parentId ? [parentId] : [] },
        media: { mimeType: req.file.mimetype, body: fs.createReadStream(tmpPath) },
        fields: 'id, webViewLink',
      });
      fs.unlink(tmpPath, ()=>{});

      const driveUrl = uploaded.data.webViewLink;

      // Save attachment URL to attempt metadata
      const { data: current } = await supabaseAdmin
        .from('contact_attempts').select('metadata').eq('id', req.params.id).single();
      const attachments = [...(current?.metadata?.attachments||[]), { name: origName, url: driveUrl, at: new Date().toISOString() }];
      await supabaseAdmin.from('contact_attempts')
        .update({ metadata: { ...(current?.metadata||{}), attachments } })
        .eq('id', req.params.id);

      res.json({ success: true, url: driveUrl, name: origName });
    } catch(e) {
      fs.unlink(tmpPath, ()=>{});
      console.error('[contacts attach]', e.message);
      res.status(500).json({ error: e.message });
    }
  });
});


// ── GET /api/contacts/search — search by protocol, jira key, chamado id, entity name
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) return res.json([]);
    const userId = req.user?.id;
    const term   = q.trim();

    // Search sessions by protocol, title, or linked chamado
    const { data: sessions, error } = await supabaseAdmin
      .from('contact_sessions')
      .select(`
        *,
        entity:contact_entities(id, name, category, phone),
        chamado:chamados(id, sn, integrador, cliente_final, status, adb_number, jira_key),
        attempts:contact_attempts(id, result, attempted_at, author, notes)
      `)
      .or([
        `protocol.ilike.%${term}%`,
        `title.ilike.%${term}%`,
      ].join(','))
      .order('updated_at', { ascending: false })
      .limit(20);
    if (error) throw error;

    // Also search by chamado number / jira key — find chamados first
    let chamadoSessions = [];
    if (/^\d+$/.test(term) || /^[A-Z]+-\d+$/i.test(term)) {
      const { data: chamados } = await supabaseAdmin
        .from('chamados')
        .select('id, sn, integrador, cliente_final, status, adb_number, jira_key')
        .or([
          `id.eq.${/^\d+$/.test(term) ? term : 0}`,
          `adb_number.ilike.%${term}%`,
          `jira_key.ilike.%${term}%`,
          `sn.ilike.%${term}%`,
        ].join(','))
        .limit(10);

      if (chamados?.length) {
        const chamadoIds = chamados.map(c => c.id);
        const { data: linked } = await supabaseAdmin
          .from('contact_sessions')
          .select(`
            *,
            entity:contact_entities(id, name, category, phone),
            chamado:chamados(id, sn, integrador, cliente_final, status, adb_number, jira_key),
            attempts:contact_attempts(id, result, attempted_at, author, notes)
          `)
          .in('chamado_id', chamadoIds)
          .order('updated_at', { ascending: false })
          .limit(20);
        chamadoSessions = linked || [];
      }
    }

    // Merge and deduplicate by id
    const all  = [...(sessions||[]), ...chamadoSessions];
    const seen = new Set();
    const result = all.filter(s => { if (seen.has(s.id)) return false; seen.add(s.id); return true; });

    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

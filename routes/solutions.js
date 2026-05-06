// routes/solutions.js
// Self-contained — no dependency on services/embeddings or services/permissions
// Media: images → Drive (Supabase stores driveId+url), videos → YouTube (fallback to Drive)

'use strict';

const express    = require('express');
const router     = express.Router();
const fs         = require('fs');
const path       = require('path');
const multer     = require('multer');
const https      = require('https');
const http       = require('http');
const { google } = require('googleapis');
const { supabaseAdmin } = require('../services/db');

// ── Multer ────────────────────────────────────────────────────────────────────
const TMP = path.join(process.cwd(), '_tmp_uploads');
fs.mkdirSync(TMP, { recursive: true });

const upload = multer({
  dest: TMP,
  limits: { fileSize: 512 * 1024 * 1024 },
});

// ─────────────────────────────────────────────────────────────────────────────
// EMBED — Ollama nomic-embed-text, gracefully returns null if unavailable
// ─────────────────────────────────────────────────────────────────────────────
async function embed(text) {
  const OLLAMA_URL  = process.env.OLLAMA_URL  || 'http://localhost:11434';
  const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';
  const body        = JSON.stringify({ model: EMBED_MODEL, prompt: text });

  return new Promise(resolve => {
    try {
      const u   = new URL(OLLAMA_URL + '/api/embeddings');
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.request(
        { hostname:u.hostname, port:u.port||11434, path:u.pathname, method:'POST',
          headers:{ 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) } },
        res => {
          let raw = '';
          res.on('data', c => { raw += c; });
          res.on('end', () => {
            try { resolve(JSON.parse(raw).embedding || null); }
            catch { resolve(null); }
          });
        }
      );
      req.setTimeout(15000, () => { req.destroy(); resolve(null); });
      req.on('error', () => resolve(null));
      req.write(body); req.end();
    } catch { resolve(null); }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GROQ helpers
// ─────────────────────────────────────────────────────────────────────────────
async function groqComplete(prompt, maxTokens = 600) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  const body = JSON.stringify({
    model: 'llama-3.1-8b-instant', max_tokens: maxTokens, temperature: 0.35,
    messages: [{ role:'user', content: prompt }],
  });
  return new Promise(resolve => {
    const req = https.request({
      hostname:'api.groq.com', path:'/openai/v1/chat/completions', method:'POST',
      headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${key}`, 'Content-Length':Buffer.byteLength(body) },
    }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw).choices?.[0]?.message?.content || null); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(20000, () => { req.destroy(); resolve(null); });
    req.write(body); req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DRIVE / YOUTUBE auth — mirrors routes/drive.js exactly
// Uses credentials.json + settings_user.google_token (same as drive.js)
// ─────────────────────────────────────────────────────────────────────────────
const CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH
  || path.join(process.cwd(), 'credentials.json');

async function buildOAuth(userId) {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error('credentials.json não encontrado');
  }

  const raw   = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const creds = raw.installed || raw.web;
  const { client_id, client_secret, redirect_uris } = creds;

  const oauth2 = new google.auth.OAuth2(
    client_id, client_secret,
    redirect_uris ? redirect_uris[0] : 'http://localhost:3333/callback'
  );

  // Same column drive.js uses: settings_user.google_token
  const { data: settings, error } = await supabaseAdmin
    .from('settings_user')
    .select('google_token')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !settings?.google_token) {
    throw new Error('Google Drive não autenticado. Vá em Configurações e faça o login.');
  }

  oauth2.setCredentials(settings.google_token);

  // Auto-refresh: persist rotated tokens
  oauth2.on('tokens', async tokens => {
    await supabaseAdmin
      .from('settings_user')
      .update({ google_token: { ...settings.google_token, ...tokens } })
      .eq('user_id', userId);
  });

  return oauth2;
}

// ─────────────────────────────────────────────────────────────────────────────
// UPLOAD MEDIA — Drive for images, YouTube (→ Drive fallback) for videos
// Returns a media record to store in Supabase
// ─────────────────────────────────────────────────────────────────────────────
async function uploadImageToDrive(userId, filePath, originalName, mimeType) {
  const oauth2 = await buildOAuth(userId);
  const drive  = google.drive({ version:'v3', auth:oauth2 });

  // Priority: DB solutions_drive_id → env SOLUTIONS_DRIVE_FOLDER_ID → DB drive_id → env DRIVE_FOLDER_ID
  const { data: su } = await supabaseAdmin.from('settings_user').select('drive_id, solutions_drive_id').eq('user_id', userId).maybeSingle();
  const folderId = su?.solutions_drive_id
    || process.env.SOLUTIONS_DRIVE_FOLDER_ID
    || su?.drive_id
    || process.env.DRIVE_FOLDER_ID
    || null;

  const res = await drive.files.create({
    requestBody: {
      name:    `sol_${Date.now()}_${originalName}`,
      parents: folderId ? [folderId] : [],
    },
    media: { mimeType, body: fs.createReadStream(filePath) },
    fields: 'id, name, webViewLink',
  });

  // Make publicly readable (embeddable)
  await drive.permissions.create({
    fileId: res.data.id,
    requestBody: { role:'reader', type:'anyone' },
  });

  return {
    type:      'image',
    provider:  'drive',
    ref_id:    res.data.id,                              // stored in Supabase
    name:      originalName,
    url:       `https://drive.google.com/uc?id=${res.data.id}&export=view`,  // embeddable
    thumb_url: `https://drive.google.com/thumbnail?id=${res.data.id}&sz=w400`,
    view_link: res.data.webViewLink,
  };
}

async function uploadVideoToYouTube(userId, filePath, title, tags) {
  const oauth2   = await buildOAuth(userId);
  const youtube  = google.youtube({ version:'v3', auth:oauth2 });

  const res = await youtube.videos.insert({
    part: ['snippet','status'],
    requestBody: {
      snippet: {
        title:       title.slice(0, 100),
        description: `Solução técnica publicada via Belenergy Support Pro`,
        tags:        ['belenergy','solar', ...(tags||[])].slice(0,10),
        categoryId:  '28',
      },
      status: { privacyStatus:'unlisted' },
    },
    media: { body: fs.createReadStream(filePath) },
  });

  return {
    type:      'video',
    provider:  'youtube',
    ref_id:    res.data.id,
    name:      title,
    url:       `https://www.youtube.com/watch?v=${res.data.id}`,
    thumb_url: `https://img.youtube.com/vi/${res.data.id}/mqdefault.jpg`,
    embed_url: `https://www.youtube.com/embed/${res.data.id}`,
  };
}

async function uploadVideoToDrive(userId, filePath, originalName, mimeType) {
  // Fallback when YouTube quota exhausted
  const oauth2   = await buildOAuth(userId);
  const drive    = google.drive({ version:'v3', auth:oauth2 });
  const folderId = process.env.SOLUTIONS_DRIVE_FOLDER_ID || process.env.DRIVE_FOLDER_ID || null;

  const res = await drive.files.create({
    requestBody: {
      name:    `vid_${Date.now()}_${originalName}`,
      parents: folderId ? [folderId] : [],
    },
    media: { mimeType, body: fs.createReadStream(filePath) },
    fields: 'id, name, webViewLink',
  });

  await drive.permissions.create({
    fileId: res.data.id,
    requestBody: { role:'reader', type:'anyone' },
  });

  return {
    type:      'video',
    provider:  'drive',
    ref_id:    res.data.id,
    name:      originalName,
    url:       `https://drive.google.com/file/d/${res.data.id}/view`,
    thumb_url: null,
    embed_url: `https://drive.google.com/file/d/${res.data.id}/preview`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH middleware (lightweight — just attaches user from JWT)
// ─────────────────────────────────────────────────────────────────────────────
// Uses the same auth middleware already set in server.js — req.user is already populated.
// This module doesn't need to re-require permissions.

// ── Normalize brand name: "deye" → "Deye", "FOXESS" → "Foxess" ───────────────
function normalizeBrand(brand) {
  if (!brand) return null;
  return brand.trim()
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());  // Title Case each word
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// ── GET /api/solutions/meta/tags  (MUST be before /:id) ──────────────────────
router.get('/meta/tags', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('solutions')
      .select('brand, tags');
    if (error) throw error;

    const brands = [...new Set((data||[]).map(s => s.brand).filter(Boolean))].sort();
    const tags   = [...new Set((data||[]).flatMap(s => s.tags || []))].sort();
    res.json({ brands, tags });
  } catch (err) {
    console.error('[Solutions] meta/tags error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/solutions ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { brand, tag, limit = 20, offset = 0 } = req.query;

    let q = supabaseAdmin
      .from('solutions')
      .select('id, title, brand, tags, media, author_name, created_at, updated_at, helpful_up, helpful_down')
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (brand) q = q.ilike('brand', brand);
    if (tag)   q = q.contains('tags', [tag]);

    const { data, error } = await q;
    if (error) throw error;

    // Attach images/videos from media JSONB for backward compat
    const enriched = (data || []).map(s => ({
      ...s,
      images: (s.media || []).filter(m => m.type === 'image'),
      videos: (s.media || []).filter(m => m.type === 'video'),
    }));

    res.json(enriched);
  } catch (err) {
    console.error('[Solutions] GET / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/solutions/:id ────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('solutions')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    res.json({
      ...data,
      images: (data.media || []).filter(m => m.type === 'image'),
      videos: (data.media || []).filter(m => m.type === 'video'),
    });
  } catch (err) {
    console.error('[Solutions] GET /:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/solutions ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { title, content, brand, tags } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'title e content obrigatórios' });

  try {
    const userId     = req.user?.id;
    const authorName = req.user?.name || req.user?.email || 'Técnico';
    const embText    = `${title}\n\n${content}`;
    const vec        = await embed(embText); // null if Ollama unavailable

    const { data, error } = await supabaseAdmin
      .from('solutions')
      .insert([{
        title, content,
        brand:       normalizeBrand(brand),
        tags:        Array.isArray(tags) ? tags : (tags ? String(tags).split(',').map(t=>t.trim()).filter(Boolean) : []),
        embedding:   vec,
        media:       [],
        created_by:  userId,
        author_name: authorName,
        helpful_up:  0,
        helpful_down:0,
        updated_at:  new Date(),
      }])
      .select('id, title, brand, tags, created_at')
      .single();

    if (error) throw error;
    console.log(`[Solutions] Created #${data.id} "${title}" embed=${!!vec}`);
    res.json(data);
  } catch (err) {
    console.error('[Solutions] POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/solutions/:id ────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const { title, content, brand, tags } = req.body;
    const patch = { updated_at: new Date() };

    if (title   !== undefined) patch.title   = title;
    if (content !== undefined) patch.content = content;
    if (brand   !== undefined) patch.brand   = normalizeBrand(brand);
    if (tags    !== undefined) patch.tags    = Array.isArray(tags) ? tags : String(tags).split(',').map(t=>t.trim()).filter(Boolean);

    // Re-embed if content changed
    if (title || content) {
      const { data: cur } = await supabaseAdmin.from('solutions').select('title,content').eq('id', req.params.id).single();
      const vec = await embed(`${title || cur?.title}\n\n${content || cur?.content}`);
      if (vec) patch.embedding = vec;
    }

    const { data, error } = await supabaseAdmin
      .from('solutions').update(patch).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ ...data, images:(data.media||[]).filter(m=>m.type==='image'), videos:(data.media||[]).filter(m=>m.type==='video') });
  } catch (err) {
    console.error('[Solutions] PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/solutions/:id ─────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await supabaseAdmin.from('solutions').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/solutions/:id/helpful ──────────────────────────────────────────
router.post('/:id/helpful', async (req, res) => {
  const { vote } = req.body; // 'up' | 'down'
  if (!['up','down'].includes(vote)) return res.status(400).json({ error: 'vote must be up or down' });
  try {
    const field = vote === 'up' ? 'helpful_up' : 'helpful_down';
    const { data: cur } = await supabaseAdmin.from('solutions').select(field).eq('id', req.params.id).single();
    await supabaseAdmin.from('solutions').update({ [field]: (cur?.[field]||0)+1 }).eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/solutions/:id/upload ───────────────────────────────────────────
// Unified upload endpoint — detects type from mimetype
// Stores provider+ref_id in solutions.media JSONB
router.post('/:id/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const tmpPath = req.file.path;
  const mime    = req.file.mimetype || '';
  const isVideo = mime.startsWith('video/');
  const userId  = req.user?.id;

  try {
    let mediaRecord;

    if (isVideo) {
      // Auto-generate title via Groq
      const { data: sol } = await supabaseAdmin.from('solutions').select('title,brand,tags').eq('id', req.params.id).single();
      let title = `${sol?.title || 'Solução'} — Belenergy`;
      const generated = await groqComplete(`Crie um título curto (máx 70 chars) para um vídeo técnico de energia solar sobre: "${sol?.title}". Apenas o título, sem aspas.`, 30);
      if (generated && generated.length < 80) title = generated.trim();

      try {
        // Try YouTube first
        mediaRecord = await uploadVideoToYouTube(userId, tmpPath, title, sol?.tags||[]);
        console.log(`[Solutions] Video uploaded to YouTube: ${mediaRecord.ref_id}`);
      } catch (ytErr) {
        const isScope   = ytErr.message?.includes('scope') || ytErr.message?.includes('authentication');
        const isQuota   = ytErr.message?.includes('quota') || ytErr.code === 403;
        const reason    = isScope ? 'sem permissão YouTube (re-autentique o Drive em Configurações)' : isQuota ? 'cota esgotada' : ytErr.message;
        console.warn(`[Solutions] YouTube failed (${reason}) — falling back to Drive`);
        mediaRecord = await uploadVideoToDrive(userId, tmpPath, req.file.originalname, mime);
        console.log(`[Solutions] Video uploaded to Drive (fallback): ${mediaRecord.ref_id}`);
        // Attach reason to response so frontend can show a helpful message
        mediaRecord._ytFallbackReason = isScope
          ? 'youtube_scope'
          : isQuota ? 'youtube_quota' : 'youtube_error';
      }
    } else {
      // Image → Drive
      mediaRecord = await uploadImageToDrive(userId, tmpPath, req.file.originalname, mime);
      console.log(`[Solutions] Image uploaded to Drive: ${mediaRecord.ref_id}`);
    }

    // Append to solutions.media JSONB
    const { data: sol } = await supabaseAdmin.from('solutions').select('media').eq('id', req.params.id).single();
    const media = [...(sol?.media || []), { ...mediaRecord, id: `media_${Date.now()}` }];
    await supabaseAdmin.from('solutions').update({ media }).eq('id', req.params.id);

    res.json({ media: mediaRecord, allMedia: media });
  } catch (err) {
    console.error('[Solutions] upload error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    fs.unlink(tmpPath, () => {});
  }
});

// ── DELETE /api/solutions/:id/media/:mediaId ──────────────────────────────────
router.delete('/:id/media/:mediaId', async (req, res) => {
  try {
    const { data: sol } = await supabaseAdmin.from('solutions').select('media').eq('id', req.params.id).single();
    const media = (sol?.media || []).filter(m => m.id !== req.params.mediaId);
    await supabaseAdmin.from('solutions').update({ media }).eq('id', req.params.id);
    res.json({ success: true, allMedia: media });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/solutions/search ────────────────────────────────────────────────
router.post('/search', async (req, res) => {
  const { query, brand, tag, limit = 5 } = req.body;
  if (!query?.trim()) return res.status(400).json({ error: 'query required' });

  try {
    const vec = await embed(query);
    let solutions = [];

    if (vec) {
      const { data, error } = await supabaseAdmin.rpc('match_solutions', {
        query_embedding: vec,
        match_count:     Number(limit),
        filter_brand:    brand || null,
        filter_tag:      tag   || null,
      });
      if (!error) solutions = data || [];
    }

    if (!solutions.length) {
      // Full-text fallback
      let q = supabaseAdmin.from('solutions')
        .select('id,title,content,brand,tags,media,author_name,created_at')
        .limit(Number(limit));
      if (brand) q = q.ilike('brand', brand);
      if (tag)   q = q.contains('tags', [tag]);
      const { data } = await q;
      solutions = (data || []).map(s => ({ ...s, similarity: null }));
    }

    // Groq synthesis
    let answer = null;
    if (solutions.length) {
      const context = solutions.map((s,i) => `[${i+1}] ${s.title}\n${(s.content||'').slice(0,500)}`).join('\n\n---\n\n');
      answer = await groqComplete(
        `Você é especialista em sistemas fotovoltaicos.\n\nDúvida do técnico: "${query}"\n\nSoluções disponíveis:\n${context}\n\nResponda em português, de forma direta. Referencie [1][2]... quando relevante.`,
        700
      );
    }

    res.json({
      answer,
      solutions: solutions.map(s => ({
        ...s,
        images: (s.media||[]).filter(m=>m.type==='image'),
        videos: (s.media||[]).filter(m=>m.type==='video'),
      })),
      embeddingAvailable: !!vec,
    });
  } catch (err) {
    console.error('[Solutions] search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

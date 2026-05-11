'use strict';
/**
 * services/manual-rag.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Manual & Datasheet RAG — Google Drive Edition
 *
 * Drive folder structure:
 *   [MANUALS_DRIVE_FOLDER_ID]/
 *     Deye/
 *       Inversor/
 *         SUN-12K_Manual.pdf
 *       BESS/
 *         BOS-G_Manual.pdf
 *     Sungrow/
 *       Inversor/
 *         ...
 *
 * The folder ID is stored in settings_global.manuals_drive_id.
 *
 * Indexing:
 *   1. Walk Drive folder tree (brand → category → files)
 *   2. Download each PDF to /tmp
 *   3. Extract text via OCR server or Drive text export
 *   4. Chunk, embed (Ollama nomic-embed-text), store in manual_chunks
 *
 * Querying:
 *   - All queries hit manual_chunks table (DB only, no Drive at query time)
 *   - Works identically in local and cloud modes
 */

const fs   = require('fs');
const path = require('path');
const http = require('http');
const { supabaseAdmin } = require('./db');
const { google } = require('googleapis');

const EMBED_MODEL      = process.env.EMBED_MODEL || 'nomic-embed-text';
const OLLAMA_URL       = process.env.OLLAMA_URL  || 'http://localhost:11434';
const CHUNK_SIZE       = 900;   // chars per chunk
const CHUNK_OVERLAP    = 120;   // overlap between chunks
const MANUAL_THRESHOLD = 0.25;  // lower than solution centre — manuals are denser text
const TMP_DIR          = '/tmp/manual_index';

// ── Get Drive client using master user's token ────────────────────────────────
async function getDriveClient() {
  // Find any master (role_id=1) or admin (role_id=2) with a Drive token
  const { data: users } = await supabaseAdmin
    .from('settings_user')
    .select('user_id, google_token, role_id')
    .not('google_token', 'is', null)
    .in('role_id', [1, 2])
    .order('role_id', { ascending: true }) // master first
    .limit(1);

  const su = users?.[0];
  if (!su?.google_token) throw new Error('Nenhum usuário admin com Drive autenticado. Configure o Drive em Configurações.');

  // Decrypt token if encrypted
  let tokenObj = su.google_token;
  try {
    const { decryptField, getMasterKey } = require('./crypto');
    const mk = getMasterKey();
    if (mk && typeof tokenObj === 'string' && tokenObj.startsWith('enc:')) {
      const dec = decryptField(tokenObj, mk);
      tokenObj = JSON.parse(dec);
    } else if (typeof tokenObj === 'string') {
      tokenObj = JSON.parse(tokenObj);
    }
  } catch {}

  // Build OAuth2 client
  const { client_id, client_secret } = await getOAuthCreds();
  const auth = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3000/api/drive/callback');
  auth.setCredentials(tokenObj);

  // Auto-save refreshed token
  auth.on('tokens', async (tokens) => {
    try {
      const { encryptField, getMasterKey } = require('./crypto');
      const mk = getMasterKey();
      const updated = { ...tokenObj, ...tokens };
      const stored  = mk ? encryptField(JSON.stringify(updated), mk) : JSON.stringify(updated);
      await supabaseAdmin.from('settings_user').update({ google_token: stored }).eq('user_id', su.user_id);
    } catch {}
  });

  return google.drive({ version: 'v3', auth });
}

// ── Read OAuth credentials ────────────────────────────────────────────────────
async function getOAuthCreds() {
  // Try env vars first, fall back to credentials.json
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    return { client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET };
  }
  const credPath = process.env.GOOGLE_CREDENTIALS_PATH || path.join(process.cwd(), 'credentials.json');
  const creds    = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  const web      = creds.web || creds.installed;
  return { client_id: web.client_id, client_secret: web.client_secret };
}

// ── Get the root manuals folder ID from settings_global ──────────────────────
async function getManualsFolderId() {
  // Check env override first
  if (process.env.MANUALS_DRIVE_FOLDER_ID) return process.env.MANUALS_DRIVE_FOLDER_ID;

  const { data: g } = await supabaseAdmin
    .from('settings_global')
    .select('manuals_drive_id')
    .eq('id', 1)
    .maybeSingle();

  if (!g?.manuals_drive_id) {
    throw new Error(
      'ID da pasta de manuais não configurado. ' +
      'Configure em Configurações → AI → Pasta de Manuais Drive, ' +
      'ou defina MANUALS_DRIVE_FOLDER_ID no .env.'
    );
  }
  return g.manuals_drive_id;
}

// ── List files in a Drive folder ──────────────────────────────────────────────
async function listDriveFolder(drive, folderId) {
  const res = await drive.files.list({
    q:        `'${folderId}' in parents and trashed = false`,
    fields:   'files(id, name, mimeType, size)',
    pageSize: 500,
  });
  return res.data.files || [];
}

// ── Download a Drive file to /tmp ─────────────────────────────────────────────
async function downloadFile(drive, fileId, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const dest = fs.createWriteStream(destPath);
  const res  = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );
  await new Promise((resolve, reject) => {
    res.data.pipe(dest);
    res.data.on('end',   resolve);
    res.data.on('error', reject);
  });
  return destPath;
}

// ── Export Google Docs/Slides/Sheets as plain text ────────────────────────────
async function exportAsText(drive, fileId, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const dest = fs.createWriteStream(destPath);
  const res  = await drive.files.export(
    { fileId, mimeType: 'text/plain' },
    { responseType: 'stream' }
  );
  await new Promise((resolve, reject) => {
    res.data.pipe(dest);
    res.data.on('end',   resolve);
    res.data.on('error', reject);
  });
  return destPath;
}

// ── Extract text from PDF via OCR server ─────────────────────────────────────
async function extractPdfText(filePath) {
  const ocrBase = process.env.TESS_OCR_URL || 'http://localhost:8001';
  try {
    const fetch = (await import('node-fetch')).default;
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), {
      filename:    path.basename(filePath),
      contentType: 'application/pdf',
    });
    const res = await fetch(`${ocrBase}/ocr-pdf`, {
      method: 'POST', body: form,
      timeout: 120_000,
    });
    if (!res.ok) throw new Error('OCR server returned ' + res.status);
    const data = await res.json();
    return data.text || '';
  } catch (err) {
    console.warn('[ManualRAG] OCR server unavailable, trying Drive text export:', err.message);
    return ''; // caller will try Google Docs export fallback
  }
}

// ── Embed via Ollama ──────────────────────────────────────────────────────────
async function embed(text) {
  const body = JSON.stringify({ model: EMBED_MODEL, prompt: text });
  return new Promise((resolve) => {
    const url = new URL('/api/embeddings', OLLAMA_URL);
    const req = http.request({
      hostname: url.hostname, port: parseInt(url.port) || 11434,
      path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw).embedding || null); } catch { resolve(null); }
      });
    });
    req.setTimeout(45_000, () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.write(body); req.end();
  });
}

// ── Chunk text with overlap ───────────────────────────────────────────────────
function chunkText(text) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const chunk = text.slice(i, i + CHUNK_SIZE).trim();
    if (chunk.length >= 60) chunks.push(chunk);
    i += CHUNK_SIZE - CHUNK_OVERLAP;
    if (i + CHUNK_OVERLAP >= text.length) break;
  }
  if (i < text.length) {
    const last = text.slice(i).trim();
    if (last.length >= 60) chunks.push(last);
  }
  return chunks;
}

// ── Index a single Drive file ─────────────────────────────────────────────────
async function indexDriveFile(drive, file, brand, category) {
  const filename = file.name;
  const isPdf    = filename.toLowerCase().endsWith('.pdf') || file.mimeType === 'application/pdf';
  const isGDoc   = file.mimeType?.includes('google-apps');
  const isTxt    = filename.toLowerCase().match(/\.(txt|md)$/);

  if (!isPdf && !isGDoc && !isTxt) {
    return { skipped: true, reason: 'unsupported format: ' + file.mimeType };
  }

  // Skip already-indexed files (same brand + category + filename)
  const { data: existing } = await supabaseAdmin
    .from('manual_chunks')
    .select('id')
    .eq('brand',    brand)
    .eq('category', category)
    .eq('filename', filename)
    .limit(1);

  if (existing?.length) return { skipped: true, reason: 'already indexed' };

  console.log(`[ManualRAG] Indexing: ${brand}/${category}/${filename}`);

  // Download to /tmp
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const tmpPath = path.join(TMP_DIR, `${Date.now()}_${filename}`);

  let text = '';
  try {
    if (isGDoc) {
      await exportAsText(drive, file.id, tmpPath + '.txt');
      text = fs.readFileSync(tmpPath + '.txt', 'utf8');
      fs.unlinkSync(tmpPath + '.txt');
    } else {
      await downloadFile(drive, file.id, tmpPath);
      if (isPdf) {
        text = await extractPdfText(tmpPath);
        // If OCR unavailable, use filename as minimal context
        if (!text.trim()) text = `Documento: ${filename} | Fabricante: ${brand} | Categoria: ${category}`;
      } else {
        text = fs.readFileSync(tmpPath, 'utf8');
      }
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  } catch (err) {
    console.error('[ManualRAG] Download/extract failed:', err.message);
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    return { skipped: true, reason: err.message };
  }

  if (!text.trim()) return { skipped: true, reason: 'no text extracted' };

  // Chunk + embed + store
  const chunks  = chunkText(text);
  let   indexed = 0;

  for (let i = 0; i < chunks.length; i++) {
    // Prefix with metadata so embedding is context-aware
    const embedText = `${brand} ${category} ${filename}: ${chunks[i]}`;
    const vec = await embed(embedText);

    if (!vec) { console.warn('[ManualRAG] Embed failed chunk', i); continue; }

    await supabaseAdmin.from('manual_chunks').insert([{
      brand, category, filename,
      page:        Math.floor(i / 3) + 1,
      chunk_index: i,
      content:     chunks[i],
      embedding:   vec,
      updated_at:  new Date(),
    }]);
    indexed++;

    await new Promise(r => setTimeout(r, 80)); // throttle Ollama
  }

  console.log(`[ManualRAG] ✓ ${filename}: ${indexed}/${chunks.length} chunks`);
  return { indexed, total: chunks.length, filename };
}

// ── Main: index from Google Drive ─────────────────────────────────────────────
async function indexManuals(opts) {
  opts = opts || {};
  const results = [];

  let drive, rootFolderId;
  try {
    drive        = await getDriveClient();
    rootFolderId = await getManualsFolderId();
  } catch (err) {
    return { error: err.message };
  }

  // Walk: root → brand folders → category folders → files
  const brandFolders = await listDriveFolder(drive, rootFolderId);

  for (const brandFolder of brandFolders) {
    if (brandFolder.mimeType !== 'application/vnd.google-apps.folder') continue;
    const brand = brandFolder.name;
    if (opts.brand && brand.toLowerCase() !== opts.brand.toLowerCase()) continue;

    const categoryFolders = await listDriveFolder(drive, brandFolder.id);

    for (const catFolder of categoryFolders) {
      if (catFolder.mimeType !== 'application/vnd.google-apps.folder') continue;
      const category = catFolder.name;
      if (opts.category && category.toLowerCase() !== opts.category.toLowerCase()) continue;

      const files = await listDriveFolder(drive, catFolder.id);

      for (const file of files) {
        const result = await indexDriveFile(drive, file, brand, category);
        results.push({ brand, category, file: file.name, ...result });
      }
    }
  }

  return {
    results,
    indexed: results.filter(r => r.indexed > 0).length,
    skipped: results.filter(r => r.skipped).length,
    total:   results.length,
  };
}

// ── List what's indexed in the DB ─────────────────────────────────────────────
async function listIndexed() {
  const { data } = await supabaseAdmin
    .from('manual_chunks')
    .select('brand, category, filename');

  const map = {};
  (data || []).forEach(c => {
    const key = `${c.brand}|${c.category}`;
    if (!map[key]) map[key] = { brand: c.brand, category: c.category, files: new Set(), chunks: 0 };
    map[key].chunks++;
    map[key].files.add(c.filename);
  });

  return Object.values(map).map(v => ({ ...v, files: Array.from(v.files) }));
}

// ── Vector search ─────────────────────────────────────────────────────────────
async function searchManuals(query, opts) {
  opts = opts || {};
  const t0  = Date.now();
  const vec = await embed(query);
  if (!vec) return { chunks: [], embedMs: Date.now() - t0, retrieveMs: 0, topScore: 0 };

  const embedMs = Date.now() - t0;
  const t1 = Date.now();

  const { data, error } = await supabaseAdmin.rpc('match_manual_chunks', {
    query_embedding:  vec,
    match_count:      opts.topK       || 4,
    match_threshold:  opts.threshold  || MANUAL_THRESHOLD,
    filter_brand:     opts.brand      || null,
    filter_category:  opts.category   || null,
  });

  const retrieveMs = Date.now() - t1;
  if (error) { console.error('[ManualRAG] Search error:', error.message); return { chunks: [], embedMs, retrieveMs, topScore: 0 }; }

  const chunks = (data || []).map(r => ({ ...r, score: r.similarity }));
  return { chunks, embedMs, retrieveMs, topScore: chunks[0]?.score || 0 };
}

// ── Build prompt block from chunks ────────────────────────────────────────────
function buildManualPrompt(chunks) {
  if (!chunks.length) return '';
  const lines = [
    '=== MANUAIS E FICHAS TECNICAS (fallback — fonte secundaria) ===',
    'Informacoes extraidas de manuais oficiais dos fabricantes no Google Drive.',
    '',
  ];
  chunks.forEach((c, i) => {
    const pct = Math.round((c.score || 0) * 100);
    lines.push(`--- MANUAL ${i+1}: ${c.brand} ${c.category} — ${c.filename} p.${c.page||'?'} [${pct}%] ---`);
    lines.push(c.content);
    lines.push('');
  });
  lines.push('=== FIM DOS MANUAIS ===');
  return lines.join('\n');
}

// ── Delete indexed chunks for a brand/category/file ──────────────────────────
async function deleteIndexed(opts) {
  let query = supabaseAdmin.from('manual_chunks').delete();
  if (opts.brand)    query = query.eq('brand',    opts.brand);
  if (opts.category) query = query.eq('category', opts.category);
  if (opts.filename) query = query.eq('filename', opts.filename);
  const { error } = await query;
  if (error) throw new Error(error.message);
  return { deleted: true };
}

module.exports = {
  indexManuals,
  searchManuals,
  buildManualPrompt,
  listIndexed,
  deleteIndexed,
  embed,
};

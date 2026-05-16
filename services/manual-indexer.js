'use strict';
/**
 * services/manual-indexer.js  v2
 *
 * Indexes ALL technical knowledge from Drive manuals/datasheets using Groq Vision.
 * Each PDF page → Groq extracts 1–5 compact knowledge entries.
 * Stored in `solutions` table — immediately searchable by text tier.
 * After indexing, run Gemini Reindexar for hot tier embeddings.
 *
 * Storage estimate: 200-page manual → ~400 entries → ~200KB (tiny).
 */

const { supabaseAdmin } = require('./db');

const GROQ_KEY = process.env.GROQ_API_KEY;
const SUPPORTED = ['.pdf','.jpg','.jpeg','.png','.webp'];

// ── Prompt: extract ALL technical knowledge from a page ───────────────────────
function buildPrompt(brand, filename) {
  return (
    `You are analyzing a page from a "${filename}" manual/datasheet for ${brand} solar equipment.\n` +
    `Extract ALL useful technical knowledge from this page into compact entries.\n` +
    `Cover EVERYTHING: alarm codes, error codes, configurations, settings, specifications,\n` +
    `connection procedures, network setup, troubleshooting steps, wiring diagrams text,\n` +
    `parameter values, default passwords, button sequences, LED meanings, etc.\n\n` +
    `Output a JSON array of objects. Each object must have EXACTLY these keys:\n` +
    `"title"    → what this knowledge is about (max 80 chars)\n` +
    `"content"  → the actual technical info, CONCISE but complete (max 400 chars)\n` +
    `"category" → one of: alarme | configuração | especificação | procedimento | conexão | rede | geral\n` +
    `"keywords" → array of search terms (model numbers, feature names, codes, etc.)\n\n` +
    `Rules:\n` +
    `- Max 6 entries per page. Pick the most important info.\n` +
    `- Skip: table of contents, blank pages, decorative pages, legal disclaimers.\n` +
    `- Be CONCISE. Compress but keep all key values (voltages, passwords, steps).\n` +
    `- If truly nothing useful: output []\n` +
    `Output ONLY the JSON array. No markdown. No explanation.`
  );
}

// ── Groq Vision (images / scanned PDFs) ───────────────────────────────────────
async function groqVision(imageBase64, mimeType, brand, filename) {
  const fetch = (await import('node-fetch')).default;
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + GROQ_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens: 2048, temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          { type: 'text', text: buildPrompt(brand, filename) },
        ],
      }],
    }),
    signal: AbortSignal.timeout(50_000),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error('Groq Vision ' + res.status + ': ' + (e?.error?.message || res.status));
  }
  const data = await res.json();
  return parseGroqResponse(data.choices?.[0]?.message?.content || '');
}

// ── Groq Text (text-based PDFs — faster + cheaper) ────────────────────────────
async function groqText(pageText, brand, filename) {
  const fetch = (await import('node-fetch')).default;
  const prompt = buildPrompt(brand, filename) + '\n\nPAGE TEXT:\n' + pageText.slice(0, 5000);
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + GROQ_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 2048, temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error('Groq text error: ' + res.status);
  const data = await res.json();
  return parseGroqResponse(data.choices?.[0]?.message?.content || '');
}

function parseGroqResponse(raw) {
  try {
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

// ── Extract text pages from PDF ───────────────────────────────────────────────
async function extractPdfPages(buffer) {
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    // Split into ~3000-char chunks (approx 1 page worth)
    const fullText = data.text || '';
    if (!fullText.trim()) return null; // scanned PDF
    const pages = [];
    for (let i = 0; i < fullText.length; i += 3000) {
      const chunk = fullText.slice(i, i + 3000).trim();
      if (chunk.replace(/\s/g, '').length > 100) pages.push(chunk); // skip blank
    }
    return pages;
  } catch { return null; }
}

// ── Convert PDF to images (for scanned PDFs) ──────────────────────────────────
async function pdfToImages(buffer) {
  try {
    const converter = require('pdf-img-convert');
    const pages = await converter.convert(buffer, { width: 1400 });
    return pages.map(p => Buffer.from(p).toString('base64'));
  } catch { return []; }
}

// ── Download file from Google Drive ───────────────────────────────────────────
async function driveDownload(auth, fileId, mimeType) {
  const { google } = require('googleapis');
  const drive = google.drive({ version: 'v3', auth });
  if (mimeType?.includes('google-apps')) {
    const res = await drive.files.export(
      { fileId, mimeType: 'application/pdf' },
      { responseType: 'arraybuffer' }
    );
    return { buffer: Buffer.from(res.data), mime: 'application/pdf' };
  }
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  return { buffer: Buffer.from(res.data), mime: mimeType || 'application/octet-stream' };
}

// ── Save entries to solutions table ───────────────────────────────────────────
async function saveEntries(brand, filename, entries, userId) {
  let saved = 0, skipped = 0;
  const VALID_CATS = ['alarme','configuração','especificação','procedimento','conexão','rede','geral'];

  for (const e of entries) {
    if (!e.title || !e.content) continue;
    const title = String(e.title).slice(0, 200);
    const cat   = VALID_CATS.includes(e.category) ? e.category : 'geral';
    const tags  = Array.isArray(e.keywords) ? e.keywords.slice(0, 8).map(String) : [];
    if (!tags.includes(brand)) tags.unshift(brand);
    if (!tags.includes('manual')) tags.push('manual');

    const content = `${e.content}\n\n*Fonte: ${filename}*`.slice(0, 2000);

    // Check duplicate by title + brand
    const { data: existing } = await supabaseAdmin
      .from('solutions').select('id')
      .eq('brand', brand).eq('title', title).limit(1);
    if (existing?.length) { skipped++; continue; }

    const { error } = await supabaseAdmin.from('solutions').insert([{
      title,
      content,
      brand,
      tags,
      author_id:    userId,
      author_name:  'Manual Indexer',
      source:       'manual',
      manual_origem: filename,
      category:     cat,
    }]);

    if (error) { console.warn('[Indexer] Insert error:', error.message); skipped++; }
    else saved++;
  }
  return { saved, skipped };
}

// ── Detect brand from filename ────────────────────────────────────────────────
function detectBrand(filename) {
  const f = filename.toLowerCase();
  const map = [
    ['hoymiles','Hoymiles'], ['deye','Deye'], ['huawei','Huawei'],
    ['sungrow','Sungrow'],   ['foxess','FoxESS'], ['goodwe','GoodWe'],
    ['fronius','Fronius'],   ['growatt','Growatt'], ['sma','SMA'],
    ['abb','ABB'],           ['solax','Solax'], ['solis','Solis'],
    ['canadian','Canadian Solar'], ['jinko','Jinko'], ['longi','LONGi'],
    ['risen','Risen'], ['byd','BYD'], ['pylontech','Pylontech'],
    ['tsun','TSUN'], ['afore','Afore'], ['saj','SAJ'],
  ];
  for (const [key, name] of map) if (f.includes(key)) return name;
  return 'Geral';
}

// ── Main indexer ──────────────────────────────────────────────────────────────
async function indexManualsFolder(folderId, userId, onProgress) {
  if (!folderId) throw new Error('ID da pasta de Manuais não configurado em Configurações → Google Drive');
  if (!GROQ_KEY)  throw new Error('GROQ_API_KEY não configurado no .env');

  onProgress = onProgress || ((ev) => console.log('[Indexer]', ev.msg || ev));

  // Auth
  const path = require('path'), fs = require('fs');
  const { google } = require('googleapis');
  const credPath = process.env.GOOGLE_CREDENTIALS_PATH
    || path.join(process.env.BASE_DIR || process.cwd(), 'credentials.json');
  const raw = JSON.parse(fs.readFileSync(credPath));
  const creds = raw.installed || raw.web;

  const { data: master } = await supabaseAdmin
    .from('settings_user').select('google_token, user_id')
    .eq('user_id', userId).maybeSingle();
  if (!master?.google_token) throw new Error('Faça autenticação no Google Drive em Configurações primeiro');

  const oauth2 = new google.auth.OAuth2(creds.client_id, creds.client_secret, creds.redirect_uris[0]);
  oauth2.setCredentials(master.google_token);

  const drive = google.drive({ version: 'v3', auth: oauth2 });

  // List files
  onProgress({ type:'info', msg:'📂 Listando arquivos no Drive...' });
  const listRes = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id, name, mimeType)',
    pageSize: 200,
  });
  const files = (listRes.data.files || []).filter(f => {
    const ext = '.' + f.name.split('.').pop().toLowerCase();
    return SUPPORTED.includes(ext) || f.mimeType === 'application/pdf' || f.mimeType?.startsWith('image/');
  });
  onProgress({ type:'info', msg:`📋 ${files.length} arquivo(s) encontrado(s)` });

  // Already indexed?
  const { data: logged } = await supabaseAdmin.from('manual_index_log').select('drive_file_id');
  const indexedIds = new Set((logged || []).map(r => r.drive_file_id));

  const results = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress({ type:'progress', current: i+1, total: files.length, filename: file.name });

    if (indexedIds.has(file.id)) {
      onProgress({ type:'skip', msg:`⏭ Já indexado: ${file.name}` });
      results.push({ filename: file.name, status: 'skipped' });
      continue;
    }

    try {
      const brand = detectBrand(file.name);
      onProgress({ type:'processing', msg:`🔍 ${file.name} → ${brand}` });

      const { buffer, mime } = await driveDownload(oauth2, file.id, file.mimeType);
      const isPdf = mime === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const isImg = mime?.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(file.name);

      let totalSaved = 0, totalSkipped = 0, pagesProcessed = 0;

      if (isPdf) {
        const pages = await extractPdfPages(buffer);

        if (pages && pages.length > 0) {
          // Text PDF — process each text chunk
          onProgress({ type:'processing', msg:`  📄 PDF texto: ${pages.length} página(s)` });
          for (const pageText of pages) {
            const entries = await groqText(pageText, brand, file.name);
            const { saved, skipped } = await saveEntries(brand, file.name, entries, userId);
            totalSaved += saved; totalSkipped += skipped; pagesProcessed++;
            await new Promise(r => setTimeout(r, 300)); // rate limit
          }
        } else {
          // Scanned PDF — convert to images
          onProgress({ type:'processing', msg:`  🖼 PDF escaneado: convertendo páginas...` });
          const images = await pdfToImages(buffer);
          if (images.length === 0) throw new Error('Não foi possível converter PDF em imagens. Instale pdf-img-convert.');
          onProgress({ type:'processing', msg:`  🖼 ${images.length} página(s) para visão` });
          for (const imgBase64 of images) {
            const entries = await groqVision(imgBase64, 'image/jpeg', brand, file.name);
            const { saved, skipped } = await saveEntries(brand, file.name, entries, userId);
            totalSaved += saved; totalSkipped += skipped; pagesProcessed++;
            await new Promise(r => setTimeout(r, 400));
          }
        }
      } else if (isImg) {
        const imgBase64 = buffer.toString('base64');
        const entries = await groqVision(imgBase64, mime || 'image/jpeg', brand, file.name);
        const { saved, skipped } = await saveEntries(brand, file.name, entries, userId);
        totalSaved += saved; totalSkipped += skipped; pagesProcessed = 1;
      }

      // Log as indexed
      try {
        await supabaseAdmin.from('manual_index_log').upsert([{
          drive_file_id: file.id,
          filename:      file.name,
          brand,
          codes_found:   totalSaved,
          indexed_by:    userId,
          indexed_at:    new Date(),
        }], { onConflict: 'drive_file_id' });
      } catch (_) {}

      results.push({ filename: file.name, brand, entries: totalSaved, pages: pagesProcessed, status:'ok' });
      onProgress({ type:'done', msg:`✅ ${file.name}: ${totalSaved} entradas extraídas de ${pagesProcessed} página(s)` });

    } catch (err) {
      console.error('[Indexer]', file.name, err.message);
      results.push({ filename: file.name, status:'error', error: err.message });
      onProgress({ type:'error', msg:`❌ ${file.name}: ${err.message}` });
    }
  }

  return results;
}

module.exports = { indexManualsFolder };

// services/nfSearch.js
//
// NF search strategy for /testes folder:
//   1. Scan /testes for image files <= 300 KB
//   2. Try Tesseract OCR on each (via ocr_server.exe)
//   3. If OCR finds an NF pattern → done
//   4. Only then fall back to Ollama vision (expensive, slow)
//
// Exported:
//   searchNfInTestes(folderPath) → { found, value, method, file }

'use strict';

const fs      = require('fs');
const path    = require('path');
const fetch   = require('node-fetch');

const OCR_URL    = process.env.TESS_OCR_URL    || 'http://localhost:8001';
const OLLAMA_URL = process.env.OLLAMA_URL       || 'http://localhost:11434';
const VIS_MODEL  = process.env.OLLAMA_VISION_MODEL || 'llava-phi3';

const MAX_BYTES = 300 * 1024; // 300 KB hard limit

const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif']);

// NF patterns — matches "NF 123456", "NF-e 1234", "Nota Fiscal 000123", etc.
const NF_PATTERNS = [
  /\bNF[-\s]?e?\s*[:\-]?\s*(\d{3,12})\b/i,
  /\bnota\s+fiscal\s*[:\-]?\s*(\d{3,12})\b/i,
  /\bNFe\s*[:\-]?\s*(\d{3,12})\b/i,
  /\bn[uú]mero\s+(?:da\s+)?nota\s*[:\-]?\s*(\d{3,12})\b/i,
  // bare long numeric that looks like an NF number (43-44 digit access key or 6-12 digit NF number)
  /\b(\d{44})\b/,   // NFe access key
  /\b(\d{6,12})\b/, // plain NF number (last resort)
];

function extractNfFromText(text) {
  if (!text) return null;
  for (const re of NF_PATTERNS) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return null;
}

// ── List candidate files in /testes ─────────────────────────────────────────
function getCandidates(folderPath) {
  const testesDir = path.join(folderPath, 'testes');
  if (!fs.existsSync(testesDir)) return [];

  return fs.readdirSync(testesDir)
    .filter(f => {
      const ext  = path.extname(f).toLowerCase();
      const full = path.join(testesDir, f);
      if (!IMG_EXTS.has(ext)) return false;
      try {
        const { size } = fs.statSync(full);
        return size <= MAX_BYTES;
      } catch { return false; }
    })
    .map(f => path.join(testesDir, f));
}

// ── Step 1: OCR via ocr_server.exe ───────────────────────────────────────────
async function ocrFile(filePath) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    const r = await fetch(`${OCR_URL}/ocr-image`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ file_path: filePath }),
      signal:  controller.signal,
    });
    clearTimeout(timer);

    if (!r.ok) return null;
    const data = await r.json();
    return data.text || null;
  } catch (err) {
    console.warn(`  OCR failed for ${path.basename(filePath)}: ${err.message}`);
    return null;
  }
}

// ── Step 2: Ollama vision fallback ───────────────────────────────────────────
async function ollamaReadNf(filePath) {
  try {
    const buf    = fs.readFileSync(filePath);
    const b64    = buf.toString('base64');
    const http   = require('http');

    return await new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model:    VIS_MODEL,
        stream:   false,
        messages: [{
          role:    'user',
          content: 'This is a photo of a fiscal note (Nota Fiscal / NF-e). Find and return ONLY the NF number or access key printed on it. Reply with just the number, nothing else.',
          images:  [b64],
        }],
      });

      const url = new URL('/api/chat', OLLAMA_URL);
      const req = http.request({
        hostname: url.hostname,
        port:     parseInt(url.port) || 11434,
        path:     url.pathname,
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, res => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw);
            resolve(parsed?.message?.content?.trim() || null);
          } catch { resolve(null); }
        });
      });

      req.setTimeout(60_000, () => { req.destroy(); reject(new Error('Ollama timeout')); });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  } catch (err) {
    console.warn(`  Ollama NF failed for ${path.basename(filePath)}: ${err.message}`);
    return null;
  }
}

// ── Main export ───────────────────────────────────────────────────────────────
async function searchNfInTestes(folderPath) {
  const candidates = getCandidates(folderPath);

  if (candidates.length === 0) {
    console.log('  NF /testes: no image candidates (empty or all > 300 KB)');
    return { found: false, value: null, method: null, file: null };
  }

  console.log(`  NF /testes: checking ${candidates.length} file(s) <= 300 KB`);

  // ── Pass 1: OCR only ──────────────────────────────────────────────────────
  for (const filePath of candidates) {
    const name = path.basename(filePath);
    const kb   = Math.round(fs.statSync(filePath).size / 1024);
    console.log(`  [OCR] ${name} (${kb} KB)`);

    const text = await ocrFile(filePath);
    if (text) {
      const nf = extractNfFromText(text);
      if (nf) {
        console.log(`  [OCR] ✓ NF encontrada: ${nf} em ${name}`);
        return { found: true, value: nf, method: 'ocr', file: name };
      }
      console.log(`  [OCR] texto extraído mas sem padrão NF em ${name}`);
    }
  }

  console.log('  [OCR] nenhum NF encontrado — tentando Ollama...');

  // ── Pass 2: Ollama fallback (only files that passed the 300 KB check) ─────
  for (const filePath of candidates) {
    const name = path.basename(filePath);
    const kb   = Math.round(fs.statSync(filePath).size / 1024);
    console.log(`  [Ollama] ${name} (${kb} KB)`);

    const text = await ollamaReadNf(filePath);
    if (text) {
      const nf = extractNfFromText(text) || (text.match(/\d{6,44}/) ? text.match(/\d{6,44}/)[0] : null);
      if (nf) {
        console.log(`  [Ollama] ✓ NF encontrada: ${nf} em ${name}`);
        return { found: true, value: nf, method: 'ollama', file: name };
      }
      console.log(`  [Ollama] resposta sem padrão NF: "${text.slice(0,80)}"`);
    }
  }

  console.log('  NF /testes: não encontrada após OCR + Ollama');
  return { found: false, value: null, method: null, file: null };
}

module.exports = { searchNfInTestes };

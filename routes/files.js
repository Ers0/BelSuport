const express  = require('express');
const router   = express.Router();
const path     = require('path');
const fs       = require('fs');
const fetch    = require('node-fetch');
const { extractVen }                    = require('../services/ocr');
const { lerEtiqueta } = require('../services/visionService'); // Para ler as fotos das etiquetas
const { BASE_DIR, ORGANIZADOS, PENDENTES } = require('../services/watcher');

const OCR_URL = process.env.TESS_OCR_URL || 'http://localhost:8001';

// ── GET /api/files/folders ────────────────────────────────────────────────────
// Returns arrays of folder names from ORGANIZADOS and PENDENTES

router.get('/folders', (req, res) => {
  function listDirs(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => fs.statSync(path.join(dir, f)).isDirectory())
      .sort()
      .reverse();
  }

  res.json({
    organized: listDirs(ORGANIZADOS),
    pending:   listDirs(PENDENTES)
  });
});

// ── POST /api/files/audit ─────────────────────────────────────────────────────
// Writes or removes edit_mode.tmp so the watcher knows where to drop new files

router.post('/audit', (req, res) => {
  const { folderName } = req.body;
  const tmpFile = path.join(BASE_DIR, 'edit_mode.tmp');

  if (!folderName || folderName === 'Nenhuma') {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    return res.json({ success: true, folderPath: null });
  }

  const inOrganized = path.join(ORGANIZADOS, folderName);
  const inPending   = path.join(PENDENTES, folderName);
  const folderPath  = fs.existsSync(inOrganized) ? inOrganized : inPending;

  if (!fs.existsSync(folderPath)) {
    return res.status(404).json({ error: 'Folder not found' });
  }

  fs.writeFileSync(tmpFile, folderPath, 'utf8');
  res.json({ success: true, folderPath });
});

// ── POST /api/files/ven ───────────────────────────────────────────────────────
// Delegates to the Python OCR microservice

router.post('/ven', async (req, res) => {
  const { folderPath } = req.body;
  const ven = await extractVen(folderPath);
  res.json({ ven });
});

// ── POST /api/files/ficha ─────────────────────────────────────────────────────
// Extracts form data from the Deye warranty ficha PDF

router.post('/ficha', async (req, res) => {
  const { folderPath } = req.body;
  if (!folderPath) return res.status(400).json({ error: 'folderPath required' });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    const r = await fetch(`${OCR_URL}/extract-ficha`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ folder_path: folderPath }),
      signal:  controller.signal,
    });
    clearTimeout(timer);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error('Ficha extraction error:', err.message);
    res.status(500).json({ status: 'error', error: err.message });
  }
});


// Moves a folder from ORGANIZADOS → PENDENTES

router.post('/move-to-pending', (req, res) => {
  const { folderName, newFolderName } = req.body;

  // Resolve source — can be in ORGANIZADOS or already in PENDENTES
  let src = path.join(ORGANIZADOS, folderName);
  if (!fs.existsSync(src)) {
    src = path.join(PENDENTES, folderName);
  }

  // Destination name: use newFolderName if provided, otherwise keep original name
  const destName = (newFolderName || folderName).replace(/[\\/:*?"<>|]/g, '_').trim();
  const dest = path.join(PENDENTES, destName);

  try {
    if (fs.existsSync(src)) {
      fs.renameSync(src, dest);
      res.json({ success: true, newFolderName: destName });
    } else {
      res.json({ success: true, newFolderName: destName, note: 'folder not found, skipped move' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── POST /api/files/unlock ────────────────────────────────────────────────────
// Calls OCR service to remove PDF restrictions from the ficha

router.post('/unlock', async (req, res) => {
  const { folderPath } = req.body;
  if (!folderPath) return res.status(400).json({ error: 'folderPath required' });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000); // unlock can take time
    const r = await fetch(`${OCR_URL}/unlock-ficha`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ folder_path: folderPath }),
      signal:  controller.signal,
    });
    clearTimeout(timer);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error('Unlock error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

  // ── GET /api/files/events ── SSE push for folder list changes ─────────────────

  const { notifyClients, sseClients } = require('../services/watcher');


  router.get('/events', (req, res) => {

  req.socket.setTimeout(0);
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true);

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform'); // no-transform impede proxies de segurar o dado
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // 3. O APERTO DE MÃO IMEDIATO (A Bala de Prata)
  // Mande algo no exato milissegundo em que a conexão abre para o navegador não surtar.
  res.write(': connected\n\n');

  // Heartbeat a cada 25s
  const heartbeat = setInterval(() => {
    try { 
      res.write(': heartbeat\n\n'); 
      // 4. FORÇA A DESCARGA: Se houver middleware de compressão, isso empurra o dado à força
      if (res.flush) res.flush(); 
    } catch (_) {}
  }, 25_000);

  // Adiciona o cliente na lista do Watcher
  if (sseClients && typeof sseClients.add === 'function') {
      sseClients.add(res);
  } else {
      console.error("❌ ERRO: sseClients não é um Set/Array válido!");
  }

  // Limpeza quando o navegador fechar a aba ou trocar de página
  req.on('close', () => {
    clearInterval(heartbeat);
    if (sseClients) sseClients.delete(res);
  });
});


// ── POST /api/files/list-folder ───────────────────────────────────────────────
// Lists files in a local ORGANIZADOS/PENDENTES folder for the checklist Step 3
router.post('/list-folder', (req, res) => {
  const { folderPath } = req.body;
  if (!folderPath) return res.json({ files: [] });

  try {
    const files = [];
    // Scan the folder recursively (max 2 levels: folder/Doc, folder/Testes)
    function scan(dir, depth = 0) {
      if (depth > 2 || !fs.existsSync(dir)) return;
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) { scan(full, depth + 1); }
        else if (!/^\.|^~/.test(name)) {
          files.push({ name, size: stat.size, path: full });
        }
      }
    }
    scan(folderPath);
    res.json({ files });
  } catch (err) {
    res.json({ files: [], error: err.message });
  }
});

module.exports = router;

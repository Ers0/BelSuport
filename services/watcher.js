const chokidar = require('chokidar');
const path     = require('path');
const fs       = require('fs');

// ── Directory setup ──────────────────────────────────────────────────────────
const BASE_DIR   = process.env.BASE_DIR
  ? path.resolve(process.env.BASE_DIR)
  : path.join(__dirname, '..');

const ARQUIVOS   = path.join(BASE_DIR, 'arquivos');
const ENTRADA    = path.join(ARQUIVOS, 'ENTRADA');
const ORGANIZADOS = path.join(ARQUIVOS, 'ORGANIZADOS');
const PENDENTES  = path.join(ARQUIVOS, 'PENDENTES');

[ARQUIVOS, ENTRADA, ORGANIZADOS, PENDENTES].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ── Queue state ──────────────────────────────────────────────────────────────
let fileQueue     = [];
let lastEventTime = 0;
let processing    = false;

// SSE clients waiting for folder list updates
const sseClients = new Set();

function notifyClients(event = 'folders-updated') {
  for (const client of sseClients) {
    try { client.write('data: ' + event + '\n\n'); }
    catch (_) { sseClients.delete(client); }
  }
}

module.exports.sseClients   = sseClients;
module.exports.notifyClients = notifyClients;

const SKIP_EXTS = new Set(['.tmp', '.crdownload', '.ini', '.db', '.lnk']);

// ── Helpers ──────────────────────────────────────────────────────────────────

function getTargetFolder() {
  const tmpFile = path.join(BASE_DIR, 'edit_mode.tmp');
  if (fs.existsSync(tmpFile)) {
    const saved = fs.readFileSync(tmpFile, 'utf8').trim();
    if (saved && fs.existsSync(saved)) return saved;
  }
  // Default: new AGUARDANDO_* folder
  const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '_');
  return path.join(ORGANIZADOS, `AGUARDANDO_${ts}`);
}

async function waitUntilWritten(filePath, tries = 10) {
  for (let i = 0; i < tries; i++) {
    try {
      const s1 = fs.statSync(filePath).size;
      await new Promise(r => setTimeout(r, 200));
      const s2 = fs.statSync(filePath).size;
      if (s1 === s2) return true;
    } catch {
      return false;
    }
  }
  return false;
}

// ── Batch processor (runs every second, waits for 10s of silence) ─────────────
async function processBatch() {
  if (processing || fileQueue.length === 0) return;
  if (Date.now() - lastEventTime < 10_000) return;

  processing = true;
  const batch = [...fileQueue];
  fileQueue   = [];

  console.log(`📦 Processing batch of ${batch.length} file(s)...`);

  const target = getTargetFolder();
  fs.mkdirSync(target, { recursive: true });

  for (const srcPath of batch) {
    if (!fs.existsSync(srcPath)) continue;

    const ext     = path.extname(srcPath).toLowerCase();
    const subDir  = (ext === '.pdf' || ext === '.zip') ? 'Doc' : 'Testes';
    const destDir = path.join(target, subDir);
    fs.mkdirSync(destDir, { recursive: true });

    // Strip " (1)" and "- Copia" suffixes from filename
    const cleanName = path.basename(srcPath).replace(/\s\(\d+\)|- Copia/g, '');
    const destPath  = path.join(destDir, cleanName);

    try {
      fs.renameSync(srcPath, destPath);
      console.log(`  ✓ Moved: ${cleanName}`);
    } catch (err) {
      console.warn(`  ⚠ Could not move ${cleanName}: ${err.message}`);
    }
  }

  // Clear edit_mode.tmp after processing
  const tmpFile = path.join(BASE_DIR, 'edit_mode.tmp');
  if (fs.existsSync(tmpFile)) {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }

  // Push notification to all connected browser clients
  notifyClients('folders-updated');

  console.log('Batch complete');
  processing = false;
}

// ── Watcher ──────────────────────────────────────────────────────────────────
function startWatcher() {
  const watcher = chokidar.watch(ENTRADA, {
    persistent:       true,
    ignoreInitial:    true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
  });

  watcher.on('add', async (filePath) => {
    const ext  = path.extname(filePath).toLowerCase();
    const base = path.basename(filePath);

    if (SKIP_EXTS.has(ext) || base.startsWith('~') || base.startsWith('.')) return;

    const ready = await waitUntilWritten(filePath);
    if (!ready) return;

    if (!fileQueue.includes(filePath)) {
      fileQueue.push(filePath);
      console.log(`📥 Queued: ${base}`);
    }
    lastEventTime = Date.now();
  });

  watcher.on('error', err => console.error('Watcher error:', err));

  // Check every second — same logic as Python batch_worker
  setInterval(processBatch, 1_000);

  console.log(`👁️  Watching: ${ENTRADA}`);
}

module.exports = { startWatcher, sseClients, BASE_DIR, ARQUIVOS, ENTRADA, ORGANIZADOS, PENDENTES };

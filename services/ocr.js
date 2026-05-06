const fetch   = require('node-fetch');
const path    = require('path');
const fs      = require('fs');
const { execFile } = require('child_process');

const OCR_URL  = process.env.TESS_OCR_URL || 'http://localhost:8001';
let _ocrStarted = false;

// Try to start ocr_server.exe if it lives next to server.js
function _tryStartOcr() {
  if (_ocrStarted) return;
  _ocrStarted = true;

  const candidates = [
    path.join(__dirname, '..', 'ocr_server.exe'),
    path.join(__dirname, '..', 'ocr-service', 'ocr_server.py'),
  ];

  for (const c of candidates) {
    if (!fs.existsSync(c)) continue;
    const cmd  = c.endsWith('.py') ? 'python' : c;
    const args = c.endsWith('.py') ? [c] : [];
    try {
      const proc = execFile(cmd, args, { windowsHide: true, detached: true });
      proc.unref();
      console.log('OCR service auto-started:', c);
    } catch (e) {
      console.warn('Could not auto-start OCR service:', e.message);
    }
    return;
  }
}

async function extractVen(folderPath) {
  if (!folderPath) return '---';

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);

      const res = await fetch(`${OCR_URL}/extract-ven`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        // Paths are resolved locally in ocr_server.py at startup
        // No need to pass them per-request from Supabase
        body:    JSON.stringify({ folder_path: folderPath }),
        signal:  controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        console.error(`⚠️ Python recusou o pacote. Status: ${res.status}`);
        return '⚠️ VEN NAO LOCALIZADO';
      }
      
      const body = await res.json();
      return body.ven || '⚠️ VEN NAO LOCALIZADO';

    } catch (err) {
      if (attempt === 0) {
        console.warn('OCR offline, attempting auto-start...');
        _tryStartOcr();
        await new Promise(r => setTimeout(r, 3000));
      } else {
        console.error('OCR service error:', err.message);
        return '⚠️ SERVICO OCR INDISPONIVEL';
      }
    }
  }
  return '⚠️ SERVICO OCR INDISPONIVEL';
}

module.exports = { extractVen };
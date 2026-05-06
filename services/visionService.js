// services/visionService.js
//
// ── GOOGLE VISION (COMMENTED OUT) ────────────────────────────────────────────
// const vision = require('@google-cloud/vision');
// const path   = require('path');
// const client = new vision.ImageAnnotatorClient({
//     keyFilename: path.join(__dirname, '../config/google-cloud-key.json')
// });
// ─────────────────────────────────────────────────────────────────────────────
//
// FREE LOCAL BACKUP — llama3.2-vision via Ollama
//
// Uses /api/chat (NOT /api/generate) — llama3.2-vision requires the chat
// endpoint for reliable responses. /api/generate returns empty strings.
//
// Optional env vars:
//   OLLAMA_URL           default: http://localhost:11434
//   OLLAMA_VISION_MODEL  default: llama3.2-vision
//
// Only images <= 300 KB are passed here (enforced by calling routes).

const fs   = require('fs');
const path = require('path');
const http = require('http');

const OLLAMA_URL   = process.env.OLLAMA_URL          || 'http://localhost:11434';
const VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'llava-phi3';

// ── Smart dictionary ──────────────────────────────────────────────────────────
const smartDictionary = {
    brands: {
        'deye':       'Deye',
        'sungrow':    'Sungrow',
        'huawei':     'Huawei',
        'canadian':   'Canadian Solar',
        'fox':        'FoxESS',
        'foxess':     'FoxESS',
        'growatt':    'Growatt',
        'solax':      'SolaX',
        'saj':        'SAJ',
        'sofar':      'Sofar',
        'goodwe':     'GoodWe',
        'solis':      'Solis',
        'abb':        'ABB',
        'fronius':    'Fronius',
        'sma':        'SMA',
        'enphase':    'Enphase',
        'delta':      'Delta',
        'schneider':  'Schneider Electric',
        'byd':        'BYD',
        'pylontech':  'Pylontech',
        'wattsonic':  'WattSonic',
    },
    categories: {
        'inverter':      'Inversor',
        'inversor':      'Inversor',
        'bess':          'BESS / Bateria',
        'battery':       'BESS / Bateria',
        'bateria':       'BESS / Bateria',
        'storage':       'BESS / Bateria',
        'string':        'Inversor',
        'hybrid':        'Inversor Híbrido',
        'hibrido':       'Inversor Híbrido',
        'híbrido':       'Inversor Híbrido',
        'microinverter': 'Microinversor',
        'microinversor': 'Microinversor',
        'optimizer':     'Otimizador',
        'otimizador':    'Otimizador',
        'tracker':       'Tracker',
        'combiner':      'String Box',
        'string box':    'String Box',
        'datalogger':    'Datalogger',
        'meter':         'Medidor',
        'medidor':       'Medidor',
    }
};

// ── Detect MIME type from file magic bytes ────────────────────────────────────
// Multer strips the file extension on temp files — we detect the format
// from the raw bytes so the model gets the right image type hint.
function detectMimeType(buffer) {
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) return 'image/jpeg';   // JPEG / JFIF
    if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';    // PNG
    if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp';   // WEBP (RIFF)
    if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif';    // GIF
    return 'image/jpeg'; // safe fallback
}

// ── Ollama /api/chat call ─────────────────────────────────────────────────────
// llama3.2-vision requires /api/chat — /api/generate returns empty responses.
function ollamaChat(messages) {
    return new Promise((resolve, reject) => {
        const body    = JSON.stringify({
            model:    VISION_MODEL,
            messages: messages,
            stream:   false
        });
        const url     = new URL('/api/chat', OLLAMA_URL);
        const options = {
            hostname: url.hostname,
            port:     parseInt(url.port) || 11434,
            path:     url.pathname,
            method:   'POST',
            headers:  {
                'Content-Type':   'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = http.request(options, (res) => {
            let raw = '';
            res.on('data', chunk => { raw += chunk; });
            res.on('end', () => {
                // Log truncated raw response for debugging
                console.log(`  ↳ Raw Ollama (${raw.length} chars): ${raw.slice(0, 200).replace(/\n/g, ' ')}`);
                try {
                    const parsed = JSON.parse(raw);
                    // /api/chat response: { message: { role, content } }
                    resolve(parsed?.message?.content || '');
                } catch (e) {
                    reject(new Error('Ollama parse error: ' + raw.slice(0, 300)));
                }
            });
        });

        req.on('error', e => reject(new Error('Ollama connection error: ' + e.message)));

        // llama3.2-vision first inference can be slow — 90s timeout
        req.setTimeout(90_000, () => {
            req.destroy();
            reject(new Error('Ollama timed out (90s). Is ollama.exe running and model loaded?'));
        });

        req.write(body);
        req.end();
    });
}

// ── Phase 1: match raw text against our dictionary (no model reasoning needed) ─
// The model just dumps text; we do the smart matching ourselves — same logic
// the original Google Vision version used on its extracted text blob.
function matchFromText(texto) {
    const t = texto.toLowerCase();

    let fabricante = null;
    for (const [k, v] of Object.entries(smartDictionary.brands)) {
        if (t.includes(k)) { fabricante = v; break; }
    }

    let categoria = null;
    for (const [k, v] of Object.entries(smartDictionary.categories)) {
        if (t.includes(k)) { categoria = v; break; }
    }

    // S/N regex — covers common label field names in PT and EN
    let sn = null;
    const snMatch = texto.match(
        /(?:s\/n|sn|serial(?:\s*no\.?)?|n[oº°]\.?\s*s[eé]rie)\s*[:\-]?\s*([A-Z0-9]{6,25})/i
    );
    if (snMatch) sn = snMatch[1].toUpperCase();

    return { fabricante, categoria, sn };
}

// ── Phase 1 Ollama call: "dump all text you see" ──────────────────────────────
// Simple task → small models are far more accurate here than at structured output.
async function extractRawText(base64Image) {
    const text = await ollamaChat([{
        role:    'user',
        content: 'Read this image and write out ALL text you can see, exactly as printed. Include every word, number, and code visible on the label.',
        images:  [base64Image]
    }]);
    console.log(`  ↳ [Phase 1] texto bruto: "${text.slice(0, 200).replace(/\n/g, ' | ')}"`);
    return text;
}

// ── Phase 2 fallback: single focused question (only if brand still unknown) ───
async function askBrandDirectly(base64Image) {
    const answer = await ollamaChat([{
        role:    'user',
        content: 'What is the manufacturer or brand name shown on this product label? Reply with only the brand name, nothing else.',
        images:  [base64Image]
    }]);
    console.log(`  ↳ [Phase 2] marca direta: "${answer.trim()}"`);
    return answer.trim();
}

// ── Main exported function (same signature as the original Google Vision version)
async function lerEtiqueta(caminhoImagem) {
    try {
        const basename = path.basename(caminhoImagem);
        console.log(`🤖 Ollama (${VISION_MODEL}): Analisando ${basename}`);

        const imageBuffer = fs.readFileSync(caminhoImagem);
        const mimeType    = detectMimeType(imageBuffer);
        const base64Image = imageBuffer.toString('base64');

        console.log(`  ↳ Tipo detectado: ${mimeType} | ${Math.round(imageBuffer.length / 1024)} KB`);

        // ── Phase 1: raw text → dictionary match ─────────────────────────────
        const rawText = await extractRawText(base64Image);
        let { fabricante, categoria, sn } = matchFromText(rawText);

        console.log(`  ↳ [Phase 1] fabricante: ${fabricante} | categoria: ${categoria} | sn: ${sn}`);

        // ── Phase 2: only if brand still unknown after dictionary match ───────
        if (!fabricante) {
            const brandRaw = await askBrandDirectly(base64Image);
            if (brandRaw) {
                // Try dictionary first
                const key = brandRaw.toLowerCase();
                for (const [k, v] of Object.entries(smartDictionary.brands)) {
                    if (key.includes(k)) { fabricante = v; break; }
                }
                // Keep raw model answer if still no match and it looks like a brand name
                if (!fabricante && brandRaw.length < 40) fabricante = brandRaw;
            }
            console.log(`  ↳ [Phase 2] fabricante: ${fabricante}`);
        }

        const isLabel = !!(fabricante || sn);

        return {
            isLabel,
            fabricante:     fabricante || null,
            categoria:      categoria  || null,
            sn:             sn         || null,
            isConfident:    !!(fabricante && sn),
            confiancaTotal: isLabel ? '100% (local)' : '0%'
        };

    } catch (error) {
        console.error('🔥 Erro no visionService (Ollama):', error.message);
        throw error;
    }
}

module.exports = { lerEtiqueta };
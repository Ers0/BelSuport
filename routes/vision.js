// routes/vision.js
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const { lerEtiqueta } = require('../services/visionService');

console.log('🕵️ visionService.lerEtiqueta carregado:', typeof lerEtiqueta);

// Multer — salva upload temporariamente
const upload = multer({ dest: 'uploads/' });

// ── POST /api/vision/ler-etiqueta ─────────────────────────────────────────────
// Manual upload: user picks an image from the form.
// Limit: 300 KB (images larger than that are likely full photos, not tight label
// crops — and Ollama works best on small, focused images anyway).

router.post('/ler-etiqueta', upload.single('imagemEtiqueta'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'Nenhuma imagem enviada.' });
        }

        // 300 KB safety filter
        const MAX_BYTES = 300 * 1024;
        if (file.size > MAX_BYTES) {
            fs.unlinkSync(file.path);
            return res.status(400).json({
                error: `Arquivo muito grande (${Math.round(file.size / 1024)} KB). Máximo: 300 KB.`
            });
        }

        console.log(`Lendo etiqueta: ${file.originalname} (${Math.round(file.size / 1024)} KB)`);

        // Call the local Ollama vision service
        const resultadoOCR = await lerEtiqueta(file.path);

        // Clean up temp file
        fs.unlinkSync(file.path);

        res.json(resultadoOCR);

    } catch (error) {
        console.error('Erro na rota ler-etiqueta:', error);
        res.status(500).json({ error: error.message });
    }
});

// ── POST /api/vision/autoscan-folder ─────────────────────────────────────────
// Called automatically when a folder is selected in the UI.
// Scans the most recent image in <folderPath>/Testes.
// Skips images > 300 KB — those are full photos, not label crops.

router.post('/autoscan-folder', async (req, res) => {
    try {
        const { folderPath } = req.body;

        if (!folderPath) {
            return res.json({ isLabel: false, message: 'Caminho da pasta não fornecido' });
        }

        const testesDir = path.join(folderPath, 'Testes');

        if (!fs.existsSync(testesDir)) {
            return res.json({ isLabel: false, message: 'Pasta Testes não encontrada' });
        }

        const MAX_BYTES = 300 * 1024; // 300 KB

        // List images, attach size, filter > 300 KB, sort newest first
        const files = fs.readdirSync(testesDir)
            .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
            .map(f => {
                const full = path.join(testesDir, f);
                const stat = fs.statSync(full);
                return { name: f, full, time: stat.mtime.getTime(), size: stat.size };
            })
            .filter(f => {
                if (f.size > MAX_BYTES) {
                    console.log(`  ⏭ Ignorado (${Math.round(f.size / 1024)} KB > 300 KB): ${f.name}`);
                    return false;
                }
                return true;
            })
            .sort((a, b) => b.time - a.time);

        if (files.length === 0) {
            return res.json({
                isLabel: false,
                message: 'Nenhuma imagem válida na pasta Testes (ou todas > 300 KB)'
            });
        }

        const latest = files[0];
        console.log(`🔍 Autoscan: ${latest.name} (${Math.round(latest.size / 1024)} KB)`);

        // Call local Ollama vision service
        const result = await lerEtiqueta(latest.full);

        return res.json(result || { isLabel: false });

    } catch (error) {
        console.error('🔥 Erro no Autoscan Backend:', error);
        return res.status(500).json({ isLabel: false, error: error.message });
    }
});

module.exports = router;

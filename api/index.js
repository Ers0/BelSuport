// api/index.js — Vercel serverless entry point
// Wraps the Express app as a single serverless function.
// Local-only features (watcher, OCR, Ollama) are automatically
// disabled via CLOUD_MODE=true set in vercel.json

require('dotenv').config();
process.env.CLOUD_MODE = 'true';

const express      = require('express');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const path         = require('path');
const authRoutes   = require('../routes/auth');
const driveRoutes  = require('../routes/drive');

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Auth middleware on every request
app.use(authRoutes.authMiddleware);

// Debug logger
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.path} | ${req.user?.email || 'anon'}`);
  next();
});

// ── Routes available in cloud mode ───────────────────────────────────────────
app.use('/api/auth',     authRoutes.router);
app.use('/api/drive',    driveRoutes);
app.use('/api/cases',         require('../routes/cases'));
app.use('/api/products',      require('../routes/products'));
app.use('/api/settings',      require('../routes/settings'));
app.use('/api/jira',          require('../routes/jira'));
app.use('/api/sheets',        require('../routes/sheets'));
app.use('/api/reports',       require('../routes/reports'));
app.use('/api/solutions',     require('../routes/solutions'));
app.use('/api/reminders',     require('../routes/reminders'));
app.use('/api/notifications', require('../routes/notifications'));
app.use('/api/clients',       require('../routes/clients'));
app.use('/api/events',        require('../routes/events'));
app.use('/api/equipment',     require('../routes/equipment'));
app.use('/api/analysis',      require('../routes/analysis'));
app.use('/api/knowledge',     require('../routes/knowledge'));
app.use('/api/contacts',      require('../routes/contacts'));

// ── Routes DISABLED in cloud mode ────────────────────────────────────────────
// /api/files  — local folder scanning (no filesystem on Vercel)
// watcher     — no persistent process on serverless
// OCR server  — Tesseract runs locally only
// Ollama      — local AI model only
app.use('/api/files', (req, res) => {
  res.status(503).json({
    error:       'Não disponível no modo cloud',
    cloud_mode:  true,
    message:     'O processamento OCR e leitura de arquivos locais requer a versão desktop do Belenergy.',
  });
});

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

// Error handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ error: err.message });
});

module.exports = app;

// api/index.js — Vercel serverless entry point
require('dotenv').config();
process.env.CLOUD_MODE = 'true';

const express      = require('express');
const cors         = require('cors');
const cookieParser = require('cookie-parser');

const app = express();

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// safeRoute — loads a route module; returns a 503 handler if it fails to load
// This prevents ONE broken route from crashing ALL routes
function safeRoute(p) {
  try {
    return require(p);
  } catch (err) {
    console.error('[index.js] Route load failed:', p, '|', err.message);
    const r = express.Router();
    r.all('*', (req, res) =>
      res.status(503).json({ error: 'Servico temporariamente indisponivel', detail: err.message })
    );
    return r;
  }
}

// Auth and Drive loaded separately (they export named properties)
const authRoutes  = safeRoute('../routes/auth');
const driveRoutes = safeRoute('../routes/drive');

// Auth middleware — must run before all routes
app.use((req, res, next) => {
  try {
    if (typeof authRoutes.authMiddleware === 'function') {
      return authRoutes.authMiddleware(req, res, next);
    }
    next();
  } catch (err) {
    console.error('[Auth middleware crash]', err.message);
    next();
  }
});

// Request logger
app.use((req, res, next) => {
  if (req.path.startsWith('/api'))
    console.log(`[${req.method}] ${req.path} | ${req.user?.email || 'anon'}`);
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',          authRoutes.router || authRoutes);
app.use('/api/drive',         driveRoutes.router || driveRoutes);
app.use('/api/cases',         safeRoute('../routes/cases'));
app.use('/api/products',      safeRoute('../routes/products'));
app.use('/api/settings',      safeRoute('../routes/settings'));
app.use('/api/jira',          safeRoute('../routes/jira'));
app.use('/api/sheets',        safeRoute('../routes/sheets'));
app.use('/api/reports',       safeRoute('../routes/reports'));
app.use('/api/solutions',     safeRoute('../routes/solutions'));
app.use('/api/reminders',     safeRoute('../routes/reminders'));
app.use('/api/notifications', safeRoute('../routes/notifications'));
app.use('/api/clients',       safeRoute('../routes/clients'));
app.use('/api/events',        safeRoute('../routes/events'));
app.use('/api/equipment',     safeRoute('../routes/equipment'));
app.use('/api/analysis',      safeRoute('../routes/analysis'));
app.use('/api/knowledge',     safeRoute('../routes/knowledge'));
app.use('/api/ai-obs',        safeRoute('../routes/ai-obs'));
app.use('/api/contacts',      safeRoute('../routes/contacts'));

// Files disabled in cloud
app.use('/api/files', (req, res) =>
  res.status(503).json({ error: 'Nao disponivel no modo cloud', cloud_mode: true })
);

// 404
app.use((req, res) => res.status(404).json({ error: 'Rota nao encontrada' }));

// Error handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ error: err.message });
});

module.exports = app;

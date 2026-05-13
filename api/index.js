// api/index.js — Vercel serverless entry point
// NOTE: require() paths MUST be string literals for Vercel's bundler.
// Dynamic require(variable) paths are not resolved at build time.
require('dotenv').config();
process.env.CLOUD_MODE = 'true';

const express      = require('express');
const cors         = require('cors');
const cookieParser = require('cookie-parser');

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// ── Load auth (required for middleware — must succeed) ────────────────────────
let authRouter, authMiddleware;
try {
  const auth = require('../routes/auth');
  authRouter     = auth.router;
  authMiddleware = auth.authMiddleware;
} catch (err) {
  console.error('[CRITICAL] auth route failed to load:', err.message);
  authMiddleware = (req, res, next) => next(); // passthrough — let routes handle auth themselves
  authRouter     = express.Router();
  authRouter.all('*', (req, res) => res.status(503).json({ error: 'Auth service unavailable' }));
}

app.use(authMiddleware);

app.use((req, res, next) => {
  if (req.path.startsWith('/api'))
    console.log(`[${req.method}] ${req.path} | ${req.user?.email || 'anon'}`);
  next();
});

// ── Route loader — static literal paths so Vercel bundler resolves them ───────
function mountRoute(path, loader) {
  let handler;
  try   { handler = loader(); }
  catch (err) {
    console.error('[Route load failed]', path, '|', err.message);
    handler = express.Router();
    handler.all('*', (req, res) =>
      res.status(503).json({ error: 'Rota temporariamente indisponivel', detail: err.message })
    );
  }
  app.use(path, handler);
}

// Each loader is an arrow function with a LITERAL require() — bundler can resolve these
mountRoute('/api/auth',          () => authRouter);
mountRoute('/api/drive',         () => require('../routes/drive'));
mountRoute('/api/cases',         () => require('../routes/cases'));
mountRoute('/api/products',      () => require('../routes/products'));
mountRoute('/api/settings',      () => require('../routes/settings'));
mountRoute('/api/jira',          () => require('../routes/jira'));
mountRoute('/api/sheets',        () => require('../routes/sheets'));
mountRoute('/api/reports',       () => require('../routes/reports'));
mountRoute('/api/solutions',     () => require('../routes/solutions'));
mountRoute('/api/reminders',     () => require('../routes/reminders'));
mountRoute('/api/notifications', () => require('../routes/notifications'));
mountRoute('/api/clients',       () => require('../routes/clients'));
mountRoute('/api/events',        () => require('../routes/events'));
mountRoute('/api/equipment',     () => require('../routes/equipment'));
mountRoute('/api/analysis',      () => require('../routes/analysis'));
mountRoute('/api/knowledge',     () => require('../routes/knowledge'));
mountRoute('/api/ai-obs',        () => require('../routes/ai-obs'));
mountRoute('/api/phone-auth',     () => require('../routes/phone-auth'));
mountRoute('/api/janitor',        () => require('../routes/janitor-routes'));
mountRoute('/api/contacts',      () => require('../routes/contacts'));

// Files disabled in cloud
app.use('/api/files/events', (req, res) => {
  // Return a proper SSE stream that closes immediately — stops browser error logs
  res.set({
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'close',
    'X-Cloud-Mode':  'true',
  });
  res.write('data: {"type":"cloud_mode"}\n\n');
  res.end();
});

app.use('/api/files', (req, res) =>
  res.status(200).json({ cloud_mode: true, organized: [], pending: [], message: 'Nao disponivel no modo cloud' })
);

app.use((req, res) => res.status(404).json({ error: 'Rota nao encontrada' }));

app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ error: err.message });
});

module.exports = app;

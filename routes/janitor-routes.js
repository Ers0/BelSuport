'use strict';
/**
 * routes/janitor.js — Janitor Admin API
 * Master-only routes for managing the cold archive service
 */

const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../services/db');

async function isMaster(req) {
  if (!req.user?.id) return false;
  const { data } = await supabaseAdmin.from('settings_user').select('role_id').eq('user_id', req.user.id).maybeSingle();
  return data?.role_id === 1;
}

// ── GET /api/janitor/settings ─────────────────────────────────────────────────
router.get('/settings', async (req, res) => {
  try {
    if (!await isMaster(req)) return res.status(403).json({ error: 'Apenas master pode acessar' });
    const { getSettings } = require('../services/janitor');
    const settings = await getSettings();

    // Also get GitHub config (mask token)
    const { data: g } = await supabaseAdmin
      .from('settings_global')
      .select('github_archive_repo, github_archive_branch, github_archive_token')
      .eq('id', 1).maybeSingle();

    return res.json({
      ...settings,
      githubRepo:   g?.github_archive_repo   || process.env.GITHUB_ARCHIVE_REPO  || '',
      githubBranch: g?.github_archive_branch || process.env.GITHUB_ARCHIVE_BRANCH || 'main',
      githubTokenSet: !!(g?.github_archive_token || process.env.GITHUB_ARCHIVE_TOKEN),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/janitor/settings ─────────────────────────────────────────────────
router.put('/settings', async (req, res) => {
  try {
    if (!await isMaster(req)) return res.status(403).json({ error: 'Apenas master pode alterar' });
    const { days, enabled, tables, githubRepo, githubToken, githubBranch } = req.body;
    const patch = {};
    if (days     !== undefined) patch.janitor_days    = Math.max(7, parseInt(days) || 90);
    if (enabled  !== undefined) patch.janitor_enabled = Boolean(enabled);
    if (tables   !== undefined) patch.janitor_tables  = tables;
    if (githubRepo   ) patch.github_archive_repo   = githubRepo;
    if (githubToken  ) patch.github_archive_token  = githubToken;
    if (githubBranch ) patch.github_archive_branch = githubBranch;

    await supabaseAdmin.from('settings_global').update(patch).eq('id', 1);
    return res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/janitor/preview ──────────────────────────────────────────────────
router.get('/preview', async (req, res) => {
  try {
    if (!await isMaster(req)) return res.status(403).json({ error: 'Apenas master pode visualizar' });
    const { previewArchive } = require('../services/janitor');
    const result = await previewArchive({ days: parseInt(req.query.days) || undefined });
    return res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/janitor/log ──────────────────────────────────────────────────────
router.get('/log', async (req, res) => {
  try {
    if (!await isMaster(req)) return res.status(403).json({ error: 'Apenas master pode visualizar' });
    const { data } = await supabaseAdmin.from('janitor_log')
      .select('*').order('run_at', { ascending: false }).limit(100);
    return res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/janitor/run ─────────────────────────────────────────────────────
router.post('/run', async (req, res) => {
  try {
    if (!await isMaster(req)) return res.status(403).json({ error: 'Apenas master pode executar' });
    const { dryRun, days, tables } = req.body;
    const { runJanitor } = require('../services/janitor');
    const result = await runJanitor({ dryRun: dryRun ?? true, days, tables, userId: req.user.id });
    return res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

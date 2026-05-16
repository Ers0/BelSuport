'use strict';
/**
 * routes/ai-obs.js — AI Observability Dashboard API
 * Master-only routes
 */

const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../services/db');
const { requirePermission } = require('../services/permissions');

const masterOnly = requirePermission('manage_roles');

// ── GET /api/ai-obs/stats ─────────────────────────────────────────────────────
router.get('/stats', masterOnly, async (req, res) => {
  try {
    const range = req.query.range || '7d';
    const since = {
      '24h': '24 hours', '7d':  '7 days',
      '30d': '30 days',  'all': '100 years',
    }[range] || '7 days';

    const { data: stats } = await supabaseAdmin
      .rpc('ai_obs_stats_range', { since_interval: since })
      .maybeSingle();

    // Fallback: manual query if RPC not found
    if (!stats) {
      const { data: raw } = await supabaseAdmin
        .from('ai_requests')
        .select('*')
        .gte('created_at', new Date(Date.now() - parseDuration(since)).toISOString());

      const rows = raw || [];
      return res.json(buildStats(rows));
    }

    return res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/ai-obs/timeline ──────────────────────────────────────────────────
router.get('/timeline', masterOnly, async (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 24;
    const since = new Date(Date.now() - hours * 3600_000).toISOString();

    const { data: rows } = await supabaseAdmin
      .from('ai_requests')
      .select('created_at, provider, total_ms, status, voice')
      .gte('created_at', since)
      .order('created_at', { ascending: true });

    // Group by hour
    const buckets = {};
    (rows || []).forEach(r => {
      const h = new Date(r.created_at);
      h.setMinutes(0, 0, 0);
      const key = h.toISOString();
      if (!buckets[key]) buckets[key] = { time: key, total: 0, groq: 0, gemini: 0, errors: 0, voice: 0, latency: [] };
      buckets[key].total++;
      if (r.provider === 'groq')   buckets[key].groq++;
      if (r.provider === 'gemini') buckets[key].gemini++;
      if (r.status === 'error')    buckets[key].errors++;
      if (r.voice)                 buckets[key].voice++;
      if (r.total_ms)              buckets[key].latency.push(r.total_ms);
    });

    const timeline = Object.values(buckets).map(b => ({
      ...b,
      avg_latency: b.latency.length
        ? Math.round(b.latency.reduce((s, v) => s + v, 0) / b.latency.length)
        : 0,
      latency: undefined,
    }));

    return res.json({ timeline, hours });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/ai-obs/errors ────────────────────────────────────────────────────
router.get('/errors', masterOnly, async (req, res) => {
  try {
    const { data: errors } = await supabaseAdmin
      .from('ai_requests')
      .select('id, created_at, provider, feature, error_msg, fallback_reason, total_ms')
      .eq('status', 'error')
      .order('created_at', { ascending: false })
      .limit(50);

    return res.json({ errors: errors || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/ai-obs/top-queries ───────────────────────────────────────────────
router.get('/top-queries', masterOnly, async (req, res) => {
  try {
    const { data: rows } = await supabaseAdmin
      .from('ai_requests')
      .select('query_preview, feature, provider, status')
      .not('query_preview', 'is', null)
      .order('created_at', { ascending: false })
      .limit(200);

    // Count query frequencies (hash by first 60 chars)
    const counts = {};
    (rows || []).forEach(r => {
      const key = (r.query_preview || '').slice(0, 60).toLowerCase().trim();
      if (!key) return;
      if (!counts[key]) counts[key] = { query: r.query_preview, count: 0, features: new Set() };
      counts[key].count++;
      counts[key].features.add(r.feature);
    });

    const top = Object.values(counts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)
      .map(c => ({ ...c, features: Array.from(c.features) }));

    return res.json({ topQueries: top });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/ai-obs/health ────────────────────────────────────────────────────
router.get('/health', masterOnly, async (req, res) => {
  try {
    const health = await checkHealth();
    return res.json(health);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/ai-obs/manuals ───────────────────────────────────────────────────
router.get('/manuals', masterOnly, async (req, res) => {
  try {
    // Count indexed chunks per brand/category
    const { data: chunks } = await supabaseAdmin
      .from('manual_chunks')
      .select('brand, category, filename');

    const indexed = {};
    (chunks || []).forEach(c => {
      const key = `${c.brand}|${c.category}`;
      if (!indexed[key]) indexed[key] = { brand: c.brand, category: c.category, files: new Set(), chunks: 0 };
      indexed[key].chunks++;
      indexed[key].files.add(c.filename);
    });

    const indexedList = Object.values(indexed).map(v => ({ ...v, files: Array.from(v.files) }));

    return res.json({ indexed: indexedList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/ai-obs/index-manuals — SSE streaming progress ─────────────────
// Returns Server-Sent Events so UI can show live progress per file
router.post('/index-manuals', masterOnly, async (req, res) => {
  res.set({
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
  });

  function send(data) {
    res.write('data: ' + JSON.stringify(data) + '\n\n');
  }

  try {
    const { indexManualsFolder } = require('../services/manual-indexer');
    const { data: cfg } = await supabaseAdmin
      .from('settings_global').select('manuals_drive_id').eq('id', 1).maybeSingle();
    const folderId = cfg?.manuals_drive_id || process.env.MANUALS_DRIVE_ID;

    if (!folderId) {
      send({ type: 'error', msg: 'ID da pasta de Manuais não configurado em Configurações → Google Drive' });
      return res.end();
    }

    send({ type: 'start', msg: 'Iniciando indexação de manuais...' });

    const results = await indexManualsFolder(folderId, req.user.id, (progress) => {
      send(progress);
    });

    send({ type: 'complete', results, msg: `Indexação concluída! ${results.filter(r=>r.status==='ok').length} arquivo(s) processado(s).` });
  } catch (err) {
    send({ type: 'error', msg: err.message });
  }
  res.end();
});

// ── GET /api/ai-obs/index-log — list indexed files ────────────────────────────
router.get('/index-log', masterOnly, async (req, res) => {
  try {
    const { data } = await supabaseAdmin
      .from('manual_index_log')
      .select('*')
      .order('indexed_at', { ascending: false })
      .limit(100);
    return res.json(data || []);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/ai-obs/index-log/:fileId — re-index a specific file ───────────
router.delete('/index-log/:fileId', masterOnly, async (req, res) => {
  try {
    await supabaseAdmin.from('manual_index_log').delete().eq('drive_file_id', req.params.fileId);
    return res.json({ success: true, msg: 'Arquivo removido do índice — será re-indexado na próxima execução.' });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ── POST /api/ai-obs/reindex-manuals (legacy stub — use /index-manuals) ─────
router.post('/reindex-manuals', masterOnly, async (req, res) => {
  return res.json({ message: 'Use POST /api/ai-obs/index-manuals for SSE progress.' });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseDuration(str) {
  const match = str.match(/(\d+)\s*(hour|day|year)/);
  if (!match) return 7 * 86400_000;
  const n = parseInt(match[1]);
  const unit = { hour: 3600_000, day: 86400_000, year: 365 * 86400_000 }[match[2]];
  return n * unit;
}

function buildStats(rows) {
  const total    = rows.length;
  const groq     = rows.filter(r => r.provider === 'groq').length;
  const gemini   = rows.filter(r => r.provider === 'gemini').length;
  const manual   = rows.filter(r => r.provider === 'manual_rag').length;
  const fallback = rows.filter(r => r.fallback_from).length;
  const voice    = rows.filter(r => r.voice).length;
  const errors   = rows.filter(r => r.status === 'error').length;
  const success  = rows.filter(r => r.status === 'ok').length;
  const latencies = rows.filter(r => r.total_ms).map(r => r.total_ms);
  const avg_ms    = latencies.length
    ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length) : 0;

  return { total, groq_count: groq, gemini_count: gemini, manual_rag_count: manual,
    fallback_count: fallback, voice_count: voice, error_count: errors,
    success_count: success, avg_latency_ms: avg_ms,
    groq_avg_ms:   Math.round(rows.filter(r=>r.provider==='groq'   &&r.total_ms).reduce((s,r)=>s+r.total_ms,0)/Math.max(groq,1)),
    gemini_avg_ms: Math.round(rows.filter(r=>r.provider==='gemini' &&r.total_ms).reduce((s,r)=>s+r.total_ms,0)/Math.max(gemini,1)),
    avg_rag_score: null, manual_fallbacks: rows.filter(r=>r.rag_fallback).length,
  };
}

// ── POST /api/ai-obs/invalidate-cold-cache — clear GitHub JSON cache ─────────
router.post('/invalidate-cold-cache', masterOnly, async (req, res) => {
  try {
    const { invalidateColdCache } = require('../services/janitor');
    invalidateColdCache(req.body?.brand || null);
    return res.json({ success: true, message: 'Cache do cold tier limpo' });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

module.exports = router;

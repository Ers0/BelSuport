'use strict';
/**
 * services/janitor.js — Data Archival + Query Preprocessing
 *
 * TWO responsibilities:
 * 1. ARCHIVAL: moves old Supabase records → GitHub JSON (called by /api/janitor/run)
 * 2. QUERY PREP: brand normalization + Groq expansion (called by rag.js)
 */

const { supabaseAdmin } = require('./db');

// ═══════════════════════════════════════════════════════════════════
// PART 1 — QUERY PREPROCESSING (used by services/rag.js)
// ═══════════════════════════════════════════════════════════════════

const BRAND_ALIASES = {
  'roy miles':'Hoymiles','roimiles':'Hoymiles','hoy miles':'Hoymiles',
  'hoymile':'Hoymiles','hoymilles':'Hoymiles','heimyles':'Hoymiles',
  'deie':'Deye','daie':'Deye','dei':'Deye','dye':'Deye',
  'howei':'Huawei','huawi':'Huawei','huwai':'Huawei',
  'sun grow':'Sungrow','sungrou':'Sungrow',
  'fox es':'FoxESS','foxes':'FoxESS',
  'good we':'GoodWe','gody':'GoodWe',
  'groat':'Growatt','growat':'Growatt',
  'micro':'microinversor','inversor de ir':'microinversor',
};

function normalizeBrands(query) {
  if (!query) return query;
  let q = query;
  for (const [alias, brand] of Object.entries(BRAND_ALIASES)) {
    if (q.toLowerCase().includes(alias))
      q = q.replace(new RegExp(alias, 'gi'), brand);
  }
  return q;
}

function detectBrand(query) {
  if (!query) return null;
  const lq = query.toLowerCase();
  return ['Hoymiles','Deye','Huawei','Sungrow','FoxESS','GoodWe',
    'Fronius','Growatt','SMA','ABB','Solis','Solax']
    .find(b => lq.includes(b.toLowerCase())) || null;
}

const _expandCache = new Map();
async function expandQuery(rawQuery) {
  if (!rawQuery || rawQuery.length > 400) return rawQuery;
  if (_expandCache.has(rawQuery)) return _expandCache.get(rawQuery);
  const key = process.env.GROQ_API_KEY;
  if (!key || rawQuery.length < 25) return rawQuery;
  try {
    const fetch = (await import('node-fetch')).default;
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant', max_tokens: 60, temperature: 0,
        messages: [{ role: 'user',
          content: 'Extraia APENAS termos tecnicos de energia solar. ' +
            'Corrija marcas (Roy Miles->Hoymiles, deie->Deye). Max 12 palavras.\nFrase: ' + rawQuery,
        }],
      }),
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return rawQuery;
    const data = await res.json();
    const exp = (data.choices?.[0]?.message?.content || '').trim();
    if (exp && exp.length > 2 && exp.length < 200) {
      _expandCache.set(rawQuery, exp);
      if (_expandCache.size > 300)
        Array.from(_expandCache.keys()).slice(0, 150).forEach(k => _expandCache.delete(k));
      return exp;
    }
  } catch {}
  return rawQuery;
}

async function preprocessQuery(rawQuery, opts) {
  opts = opts || {};
  const normalized = normalizeBrands(rawQuery);
  const expanded   = await expandQuery(normalized);
  const brand      = opts.brand || detectBrand(expanded) || detectBrand(normalized);
  return { original: rawQuery, normalized, expanded, brand };
}

// ═══════════════════════════════════════════════════════════════════
// PART 2 — COLD TIER SEARCH (GitHub JSON — used by rag.js)
// ═══════════════════════════════════════════════════════════════════

const COLD_CACHE = new Map();
const COLD_TTL   = 5 * 60 * 1000; // 5 min

async function fetchColdFile(brand) {
  const repo   = process.env.GITHUB_COLD_REPO;
  const branch = process.env.GITHUB_COLD_BRANCH || 'main';
  const token  = process.env.GITHUB_COLD_TOKEN;
  if (!repo) return null;

  const key    = (brand || 'general').toLowerCase();
  const cached = COLD_CACHE.get(key);
  if (cached && Date.now() - cached.ts < COLD_TTL) return cached.data;

  const fetch   = (await import('node-fetch')).default;
  const headers = { 'User-Agent': 'belenergy-support-pro' };
  if (token) headers['Authorization'] = 'Bearer ' + token;

  for (const fn of [brand + '.json', (brand || '').toLowerCase() + '.json', 'general.json']) {
    if (!fn || fn === '.json') continue;
    try {
      const url = `https://raw.githubusercontent.com/${repo}/${branch}/cold/${fn}`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8_000) });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data)) {
        COLD_CACHE.set(key, { data, ts: Date.now() });
        return data;
      }
    } catch {}
  }
  return null;
}

function scoreEntry(entry, tokens) {
  const fields = [
    entry.title, entry.problem, entry.cause, entry.solution,
    (entry.keywords || []).join(' '), (entry.tags || []).join(' '),
  ].join(' ').toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (t.length < 3) continue;
    if (fields.includes(t)) {
      score += (entry.keywords || []).some(k => k.toLowerCase().includes(t)) ? 3 : 1;
    }
  }
  return score;
}

async function coldSearch(query, opts) {
  opts = opts || {};
  const t0    = Date.now();
  const brand = opts.brand || detectBrand(query) || 'general';
  const data  = await fetchColdFile(brand);

  if (!data) return { chunks: [], retrieveMs: Date.now() - t0, source: 'cold' };

  const tokens = (query || '').toLowerCase().replace(/[^a-z0-9\s]/gi, ' ').split(/\s+/).filter(t => t.length >= 2);

  const chunks = data
    .filter(e => !opts.brand || !e.brand || e.brand.toLowerCase() === opts.brand.toLowerCase())
    .map(e => ({ entry: e, score: scoreEntry(e, tokens) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.topK || 5)
    .map(s => ({
      id:         'cold_' + (s.entry.id || Math.random().toString(36).slice(2)),
      title:      s.entry.title || 'Sem título',
      content:    [s.entry.problem && 'Problema: ' + s.entry.problem,
                   s.entry.cause   && 'Causa: '    + s.entry.cause,
                   s.entry.solution&& 'Solução: '  + s.entry.solution]
                  .filter(Boolean).join('\n'),
      brand:      s.entry.brand || brand,
      tags:       s.entry.tags || s.entry.keywords || [],
      similarity: Math.min(0.44, 0.20 + s.score / 10),
      source:     'cold',
    }));

  console.log('[Janitor] Cold search:', chunks.length + '/' + data.length, 'in', Date.now() - t0 + 'ms');
  return { chunks, retrieveMs: Date.now() - t0, source: 'cold' };
}

function invalidateColdCache(brand) {
  if (brand) COLD_CACHE.delete(brand.toLowerCase());
  else COLD_CACHE.clear();
  console.log('[Janitor] Cold cache cleared');
}

// ═══════════════════════════════════════════════════════════════════
// PART 3 — FALLBACK LOGGING + CURATION (used by rag.js)
// ═══════════════════════════════════════════════════════════════════

async function logFallback(queryInfo, opts) {
  opts = opts || {};
  try {
    await supabaseAdmin.from('pending_curation').insert([{
      query:          queryInfo.original || queryInfo.query || '',
      query_expanded: queryInfo.expanded !== queryInfo.original ? queryInfo.expanded : null,
      brand:          queryInfo.brand  || opts.brand    || null,
      category:       opts.category    || null,
      top_score:      opts.topScore    || null,
      source:         opts.source      || 'rag',
      user_id:        opts.userId      || null,
    }]);
  } catch (err) {
    console.warn('[Janitor] logFallback failed:', err.message);
  }
}

async function getPendingCuration(opts) {
  opts = opts || {};
  const { data } = await supabaseAdmin
    .from('pending_curation')
    .select('*')
    .eq('resolved', false)
    .order('created_at', { ascending: false })
    .limit(opts.limit || 50);
  return data || [];
}

async function resolveCuration(id, resolvedBy) {
  await supabaseAdmin.from('pending_curation').update({
    resolved: true, resolved_by: resolvedBy, resolved_at: new Date(),
  }).eq('id', id);
}

// ═══════════════════════════════════════════════════════════════════
// PART 4 — PROMOTION: cold → hot (used by analysis.js)
// ═══════════════════════════════════════════════════════════════════

async function promoteToHot(solutionId) {
  const { data: sol } = await supabaseAdmin
    .from('solutions').select('id, title, content, brand, tags').eq('id', solutionId).maybeSingle();
  if (!sol) throw new Error('Solution not found: ' + solutionId);

  const { embed } = require('./rag');
  const text = [sol.title, sol.brand || '', (sol.tags || []).join(' '), (sol.content || '').slice(0, 800)].join('. ');
  const vec  = await embed(text);
  if (!vec) throw new Error('Embedding failed (Ollama/Gemini offline)');

  await supabaseAdmin.from('solutions').update({ embedding: vec }).eq('id', solutionId);
  return { promoted: true, id: solutionId, title: sol.title };
}

// ═══════════════════════════════════════════════════════════════════
// PART 5 — ARCHIVAL SERVICE (Supabase → GitHub JSON)
// ═══════════════════════════════════════════════════════════════════

const TABLE_CONFIG = {
  chamados:         { label:'Chamados',           dateField:'updated_at', dateAlt:'created_at', statusField:'status',   archiveStatus:['Concluído'],       filePattern:'quarterly', selectFields:'*' },
  reminders:        { label:'Lembretes',          dateField:'updated_at', dateAlt:'created_at', statusField:'status',   archiveStatus:['done','contacted'], filePattern:'quarterly', selectFields:'*' },
  contact_attempts: { label:'Tentativas Contato', dateField:'attempted_at',dateAlt:'created_at',statusField:null,       archiveStatus:null,                filePattern:'quarterly', selectFields:'*' },
  ai_requests:      { label:'Logs de IA',         dateField:'created_at', dateAlt:'created_at', statusField:null,       archiveStatus:null,                filePattern:'monthly',   selectFields:'id,created_at,provider,model,feature,total_ms,status' },
  pending_curation: { label:'Curadoria',          dateField:'created_at', dateAlt:'created_at', statusField:'resolved', archiveStatus:[true],              filePattern:'yearly',    selectFields:'*' },
};

async function getGithubConfig() {
  if (process.env.GITHUB_ARCHIVE_REPO) {
    return {
      repo:   process.env.GITHUB_ARCHIVE_REPO,
      token:  process.env.GITHUB_ARCHIVE_TOKEN,
      branch: process.env.GITHUB_ARCHIVE_BRANCH || 'main',
    };
  }
  const { data } = await supabaseAdmin
    .from('settings_global').select('github_archive_repo,github_archive_token,github_archive_branch').eq('id', 1).maybeSingle();
  if (!data?.github_archive_repo) throw new Error('GitHub archive repo not configured. Set GITHUB_ARCHIVE_REPO or configure in Settings → Janitor.');
  return { repo: data.github_archive_repo, token: data.github_archive_token, branch: data.github_archive_branch || 'main' };
}

function archivePath(tableName, date, pattern) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0');
  const q = 'Q' + Math.ceil((d.getMonth()+1)/3);
  const s = pattern === 'monthly' ? `${y}-${m}` : pattern === 'quarterly' ? `${y}-${q}` : `${y}`;
  return `archive/${tableName}/${s}.json`;
}

async function githubGetFile(cfg, path) {
  const fetch = (await import('node-fetch')).default;
  const res = await fetch(`https://api.github.com/repos/${cfg.repo}/contents/${path}`, {
    headers: { 'Authorization': 'Bearer ' + cfg.token, 'Accept': 'application/vnd.github+json', 'User-Agent': 'belenergy-support-pro' },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('GitHub GET ' + path + ': ' + res.status);
  const data = await res.json();
  return { sha: data.sha, records: JSON.parse(Buffer.from(data.content, 'base64').toString('utf8')) };
}

async function githubPutFile(cfg, path, records, sha, message) {
  const fetch = (await import('node-fetch')).default;
  const body  = { message: message || 'Janitor archive', content: Buffer.from(JSON.stringify(records, null, 2)).toString('base64'), branch: cfg.branch };
  if (sha) body.sha = sha;
  const res = await fetch(`https://api.github.com/repos/${cfg.repo}/contents/${path}`, {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + cfg.token, 'Accept': 'application/vnd.github+json', 'User-Agent': 'belenergy-support-pro', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) { const e = await res.json().catch(()=>{}); throw new Error('GitHub PUT ' + path + ': ' + res.status + ' ' + (e?.message||'')); }
  return res.json();
}

async function getSettings() {
  const { data } = await supabaseAdmin
    .from('settings_global').select('janitor_days,janitor_enabled,janitor_last_run,janitor_tables').eq('id', 1).maybeSingle();
  return {
    days:    data?.janitor_days    ?? 90,
    enabled: data?.janitor_enabled ?? false,
    lastRun: data?.janitor_last_run || null,
    tables:  data?.janitor_tables  || Object.keys(TABLE_CONFIG),
  };
}

async function updateSettings(patch) {
  await supabaseAdmin.from('settings_global').update({ ...patch, updated_at: new Date() }).eq('id', 1);
}

async function previewArchive(opts) {
  opts = opts || {};
  const settings = await getSettings();
  const days     = opts.days || settings.days;
  const cutoff   = new Date(Date.now() - days * 86400_000);
  const tables   = opts.tables || settings.tables;
  const preview  = {};
  for (const tableName of tables) {
    const cfg = TABLE_CONFIG[tableName];
    if (!cfg) continue;
    try {
      let q = supabaseAdmin.from(tableName).select('id', { count: 'exact' }).lt(cfg.dateField, cutoff.toISOString());
      if (cfg.statusField && cfg.archiveStatus) q = q.in(cfg.statusField, cfg.archiveStatus.map(String));
      const { count } = await q;
      preview[tableName] = { label: cfg.label, count: count || 0, cutoffDate: cutoff.toISOString() };
    } catch (err) {
      preview[tableName] = { label: cfg?.label || tableName, count: 0, error: err.message };
    }
  }
  return { preview, cutoffDate: cutoff.toISOString(), days };
}

async function archiveTable(tableName, cutoff, githubCfg, dryRun) {
  const cfg = TABLE_CONFIG[tableName];
  if (!cfg) throw new Error('Unknown table: ' + tableName);
  let q = supabaseAdmin.from(tableName).select(cfg.selectFields).lt(cfg.dateField, cutoff.toISOString()).order(cfg.dateField, { ascending: true }).limit(1000);
  if (cfg.statusField && cfg.archiveStatus) q = q.in(cfg.statusField, cfg.archiveStatus.map(String));
  const { data: records, error } = await q;
  if (error) throw error;
  if (!records?.length) return { archived: 0, deleted: 0 };
  if (dryRun) return { archived: records.length, deleted: 0, dryRun: true };

  const groups = {};
  for (const rec of records) {
    const dateVal  = rec[cfg.dateField] || rec[cfg.dateAlt] || new Date().toISOString();
    const filePath = archivePath(tableName, dateVal, cfg.filePattern);
    if (!groups[filePath]) groups[filePath] = [];
    groups[filePath].push(rec);
  }

  let totalArchived = 0, totalDeleted = 0, archivedIds = [];
  for (const [filePath, groupRecs] of Object.entries(groups)) {
    const existing = await githubGetFile(githubCfg, filePath);
    const merged   = existing ? [...existing.records, ...groupRecs] : groupRecs;
    await githubPutFile(githubCfg, filePath, merged, existing?.sha,
      `Janitor: archive ${groupRecs.length} ${tableName} (cutoff ${cutoff.toLocaleDateString('pt-BR')})`);
    totalArchived += groupRecs.length;
    archivedIds.push(...groupRecs.map(r => r.id).filter(Boolean));
  }

  for (let i = 0; i < archivedIds.length; i += 100) {
    const { error: delErr } = await supabaseAdmin.from(tableName).delete().in('id', archivedIds.slice(i, i + 100));
    if (delErr) { console.error('[Janitor] Delete error (data safe in GitHub):', delErr.message); break; }
    totalDeleted += Math.min(100, archivedIds.length - i);
  }
  return { archived: totalArchived, deleted: totalDeleted };
}

async function runJanitor(opts) {
  opts = opts || {};
  const settings    = await getSettings();
  const days        = opts.days   || settings.days;
  const tables      = opts.tables || settings.tables;
  const dryRun      = opts.dryRun ?? false;
  const cutoff      = new Date(Date.now() - days * 86400_000);
  let githubCfg;
  try { githubCfg = await getGithubConfig(); } catch (err) { return { success: false, error: err.message }; }

  const results = {}; let totalArchived = 0, totalDeleted = 0;
  for (const tableName of tables) {
    if (!TABLE_CONFIG[tableName]) continue;
    try {
      const r = await archiveTable(tableName, cutoff, githubCfg, dryRun);
      results[tableName] = r; totalArchived += r.archived || 0; totalDeleted += r.deleted || 0;
      await supabaseAdmin.from('janitor_log').insert([{ triggered_by: opts.userId, table_name: tableName, records_archived: r.archived || 0, records_deleted: r.deleted || 0, status: 'ok', dry_run: dryRun }]).catch(() => {});
    } catch (err) {
      results[tableName] = { error: err.message };
      await supabaseAdmin.from('janitor_log').insert([{ triggered_by: opts.userId, table_name: tableName, status: 'error', error_msg: err.message.slice(0, 300), dry_run: dryRun }]).catch(() => {});
    }
  }
  if (!dryRun) await updateSettings({ janitor_last_run: new Date() });
  return { success: true, dryRun, cutoffDate: cutoff.toISOString(), days, totalArchived, totalDeleted, results };
}

// ═══════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════
module.exports = {
  // Query preprocessing
  normalizeBrands, detectBrand, expandQuery, preprocessQuery, BRAND_ALIASES,
  // Cold tier
  coldSearch, invalidateColdCache,
  // Curation
  logFallback, getPendingCuration, resolveCuration,
  // Promotion
  promoteToHot,
  // Archival
  runJanitor, previewArchive, getSettings, updateSettings, TABLE_CONFIG,
};

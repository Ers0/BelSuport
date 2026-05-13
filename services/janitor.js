'use strict';
/**
 * services/janitor.js — Auto Data Archival Service
 *
 * Moves old records from Supabase (hot) → GitHub JSON repo (cold archive)
 * then deletes them from Supabase. Keeps storage lean indefinitely.
 *
 * Archive structure in GitHub repo:
 *   archive/
 *     chamados/
 *       2025-Q1.json        ← quarterly files
 *       2025-Q2.json
 *     reminders/
 *       2025-Q1.json
 *     contact_attempts/
 *       2025-Q1.json
 *     ai_requests/
 *       2025-01.json        ← monthly files (high volume)
 *
 * Each JSON file is an append-only array of archived records.
 *
 * Env vars (can also be set via Settings UI):
 *   GITHUB_ARCHIVE_REPO   = "owner/belenergy-archive"
 *   GITHUB_ARCHIVE_TOKEN  = "ghp_xxxx"  (needs repo write access)
 *   GITHUB_ARCHIVE_BRANCH = "main"
 */

const { supabaseAdmin } = require('./db');

// ── Table configuration ────────────────────────────────────────────────────────
// Each entry defines how a table is archived
const TABLE_CONFIG = {
  chamados: {
    label:       'Chamados',
    dateField:   'updated_at',          // field used for age calculation
    dateAlt:     'created_at',          // fallback if updated_at not available
    statusField: 'status',              // optional: only archive certain statuses
    archiveStatus: ['Concluído'],        // only archive these statuses (null = archive all)
    filePattern: 'quarterly',           // 'monthly' | 'quarterly' | 'yearly'
    selectFields: '*',
  },
  reminders: {
    label:       'Lembretes',
    dateField:   'updated_at',
    dateAlt:     'created_at',
    statusField: 'status',
    archiveStatus: ['done', 'contacted'], // only archive completed reminders
    filePattern: 'quarterly',
    selectFields: '*',
  },
  contact_attempts: {
    label:       'Tentativas de Contato',
    dateField:   'attempted_at',
    dateAlt:     'created_at',
    statusField: null,
    archiveStatus: null,
    filePattern: 'quarterly',
    selectFields: '*',
  },
  ai_requests: {
    label:       'Logs de IA',
    dateField:   'created_at',
    dateAlt:     'created_at',
    statusField: null,
    archiveStatus: null,
    filePattern: 'monthly',             // high volume → monthly files
    selectFields: 'id,created_at,provider,model,feature,total_ms,status,tokens_est,fallback_from,voice',
  },
  pending_curation: {
    label:       'Curadoria Pendente',
    dateField:   'created_at',
    dateAlt:     'created_at',
    statusField: 'resolved',
    archiveStatus: [true],              // only archive resolved entries
    filePattern: 'yearly',
    selectFields: '*',
  },
};

// ── GitHub API helpers ────────────────────────────────────────────────────────
async function getGithubConfig() {
  // Priority: env vars > settings_global
  if (process.env.GITHUB_ARCHIVE_REPO) {
    return {
      repo:   process.env.GITHUB_ARCHIVE_REPO,
      token:  process.env.GITHUB_ARCHIVE_TOKEN,
      branch: process.env.GITHUB_ARCHIVE_BRANCH || 'main',
    };
  }
  const { data } = await supabaseAdmin
    .from('settings_global')
    .select('github_archive_repo, github_archive_token, github_archive_branch')
    .eq('id', 1)
    .maybeSingle();
  if (!data?.github_archive_repo) throw new Error('GitHub archive repo not configured. Set in Settings → Janitor.');
  return {
    repo:   data.github_archive_repo,
    token:  data.github_archive_token,
    branch: data.github_archive_branch || 'main',
  };
}

function archivePath(tableName, date, pattern) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const q = 'Q' + Math.ceil((d.getMonth() + 1) / 3);
  const suffix = pattern === 'monthly'  ? `${y}-${m}`
               : pattern === 'quarterly' ? `${y}-${q}`
               :                           `${y}`;
  return `archive/${tableName}/${suffix}.json`;
}

async function githubGetFile(cfg, path) {
  const fetch = (await import('node-fetch')).default;
  const url   = `https://api.github.com/repos/${cfg.repo}/contents/${path}`;
  const res   = await fetch(url, {
    headers: {
      'Authorization': 'Bearer ' + cfg.token,
      'Accept':        'application/vnd.github+json',
      'User-Agent':    'belenergy-support-pro',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;           // file doesn't exist yet
  if (!res.ok) throw new Error('GitHub GET ' + path + ': ' + res.status);
  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  return { sha: data.sha, records: JSON.parse(content) };
}

async function githubPutFile(cfg, path, records, existingSha, message) {
  const fetch   = (await import('node-fetch')).default;
  const url     = `https://api.github.com/repos/${cfg.repo}/contents/${path}`;
  const content = Buffer.from(JSON.stringify(records, null, 2)).toString('base64');
  const body    = { message: message || 'Janitor archive', content, branch: cfg.branch };
  if (existingSha) body.sha = existingSha;       // required for updates

  const res = await fetch(url, {
    method:  'PUT',
    headers: {
      'Authorization': 'Bearer ' + cfg.token,
      'Accept':        'application/vnd.github+json',
      'User-Agent':    'belenergy-support-pro',
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error('GitHub PUT ' + path + ': ' + res.status + ' ' + (err.message || ''));
  }
  return await res.json();
}

// ── Get Janitor settings ──────────────────────────────────────────────────────
async function getSettings() {
  const { data } = await supabaseAdmin
    .from('settings_global')
    .select('janitor_days, janitor_enabled, janitor_last_run, janitor_tables')
    .eq('id', 1)
    .maybeSingle();
  return {
    days:     data?.janitor_days    ?? 90,
    enabled:  data?.janitor_enabled ?? false,
    lastRun:  data?.janitor_last_run || null,
    tables:   data?.janitor_tables  || Object.keys(TABLE_CONFIG),
  };
}

async function updateSettings(patch) {
  await supabaseAdmin.from('settings_global').update({
    ...patch,
    updated_at: new Date(),
  }).eq('id', 1);
}

// ── Preview: what WOULD be archived ──────────────────────────────────────────
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
      let query = supabaseAdmin
        .from(tableName)
        .select('id', { count: 'exact' })
        .lt(cfg.dateField, cutoff.toISOString());

      if (cfg.statusField && cfg.archiveStatus) {
        query = query.in(cfg.statusField, cfg.archiveStatus.map(String));
      }
      const { count } = await query;
      preview[tableName] = { label: cfg.label, count: count || 0, cutoffDate: cutoff.toISOString() };
    } catch (err) {
      preview[tableName] = { label: cfg.label, count: 0, error: err.message };
    }
  }
  return { preview, cutoffDate: cutoff.toISOString(), days };
}

// ── Archive a single table ────────────────────────────────────────────────────
async function archiveTable(tableName, cutoff, cfg, githubCfg, dryRun, triggeredBy) {
  const tableCfg = TABLE_CONFIG[tableName];
  if (!tableCfg) throw new Error('Unknown table: ' + tableName);

  // 1. Fetch records to archive
  let query = supabaseAdmin
    .from(tableName)
    .select(tableCfg.selectFields)
    .lt(tableCfg.dateField, cutoff.toISOString())
    .order(tableCfg.dateField, { ascending: true })
    .limit(1000); // process in batches of 1000

  if (tableCfg.statusField && tableCfg.archiveStatus) {
    query = query.in(tableCfg.statusField, tableCfg.archiveStatus.map(String));
  }

  const { data: records, error: fetchErr } = await query;
  if (fetchErr) throw fetchErr;
  if (!records?.length) return { archived: 0, deleted: 0 };

  if (dryRun) {
    console.log('[Janitor] DRY RUN:', tableName, '→', records.length, 'records would be archived');
    return { archived: records.length, deleted: 0, dryRun: true };
  }

  // 2. Group by archive file (quarterly/monthly/yearly)
  const groups = {};
  for (const record of records) {
    const dateVal = record[tableCfg.dateField] || record[tableCfg.dateAlt] || new Date().toISOString();
    const filePath = archivePath(tableName, dateVal, tableCfg.filePattern);
    if (!groups[filePath]) groups[filePath] = [];
    groups[filePath].push(record);
  }

  let totalArchived = 0;
  let totalDeleted  = 0;
  const archivedIds = [];

  // 3. For each file group: fetch existing → append → push to GitHub
  for (const [filePath, groupRecords] of Object.entries(groups)) {
    console.log('[Janitor] Archiving', groupRecords.length, 'records →', filePath);

    // Get existing file or null
    const existing = await githubGetFile(githubCfg, filePath);
    const merged   = existing ? [...existing.records, ...groupRecords] : groupRecords;

    // Push updated file
    const commitMsg = `Janitor: archive ${groupRecords.length} ${tableName} records (cutoff: ${cutoff.toLocaleDateString('pt-BR')})`;
    await githubPutFile(githubCfg, filePath, merged, existing?.sha, commitMsg);

    totalArchived += groupRecords.length;
    archivedIds.push(...groupRecords.map(r => r.id).filter(Boolean));
  }

  // 4. Delete from Supabase (only AFTER successful GitHub push)
  if (archivedIds.length) {
    // Delete in chunks of 100 to avoid URL length limits
    for (let i = 0; i < archivedIds.length; i += 100) {
      const chunk = archivedIds.slice(i, i + 100);
      const { error: delErr } = await supabaseAdmin
        .from(tableName)
        .delete()
        .in('id', chunk);
      if (delErr) {
        console.error('[Janitor] Delete error (data is safe in GitHub):', delErr.message);
        break;
      }
      totalDeleted += chunk.length;
    }
  }

  console.log('[Janitor]', tableName, '→ archived:', totalArchived, '| deleted from DB:', totalDeleted);
  return { archived: totalArchived, deleted: totalDeleted };
}

// ── MAIN: Run the janitor ─────────────────────────────────────────────────────
async function runJanitor(opts) {
  opts = opts || {};
  const settings    = await getSettings();
  const days        = opts.days    || settings.days;
  const tables      = opts.tables  || settings.tables;
  const dryRun      = opts.dryRun  ?? false;
  const triggeredBy = opts.userId  || 'system';
  const cutoff      = new Date(Date.now() - days * 86400_000);

  console.log('[Janitor] Starting run | days:', days, '| cutoff:', cutoff.toISOString(), '| dry:', dryRun);

  let githubCfg;
  try {
    githubCfg = await getGithubConfig();
  } catch (err) {
    return { success: false, error: err.message };
  }

  const results = {};
  let totalArchived = 0;
  let totalDeleted  = 0;

  for (const tableName of tables) {
    if (!TABLE_CONFIG[tableName]) { console.warn('[Janitor] Unknown table:', tableName); continue; }
    try {
      const result = await archiveTable(tableName, cutoff, TABLE_CONFIG[tableName], githubCfg, dryRun, triggeredBy);
      results[tableName] = result;
      totalArchived += result.archived || 0;
      totalDeleted  += result.deleted  || 0;

      // Log each table run
      await supabaseAdmin.from('janitor_log').insert([{
        triggered_by:     triggeredBy,
        table_name:       tableName,
        records_archived: result.archived || 0,
        records_deleted:  result.deleted  || 0,
        status:           'ok',
        dry_run:          dryRun,
      }]).catch(() => {});

    } catch (err) {
      console.error('[Janitor] Error archiving', tableName, ':', err.message);
      results[tableName] = { error: err.message };
      await supabaseAdmin.from('janitor_log').insert([{
        triggered_by: triggeredBy,
        table_name:   tableName,
        status:       'error',
        error_msg:    err.message.slice(0, 300),
        dry_run:      dryRun,
      }]).catch(() => {});
    }
  }

  // Update last run time
  if (!dryRun) {
    await updateSettings({ janitor_last_run: new Date() });
  }

  return {
    success:      true,
    dryRun,
    cutoffDate:   cutoff.toISOString(),
    days,
    totalArchived,
    totalDeleted,
    results,
  };
}

module.exports = {
  runJanitor,
  previewArchive,
  getSettings,
  updateSettings,
  TABLE_CONFIG,
};

// services/offline-queue.js
//
// Simple write queue for when Supabase is unavailable.
// Pending writes survive server restarts via queue.json.
// On reconnect, flushes automatically.
//
// Usage:
//   const { enqueue, isOnline } = require('./services/offline-queue');
//
//   // Instead of:
//   await supabase.from('chamados').insert(...)
//
//   // Do:
//   if (isOnline()) { await supabase... } else { enqueue('insert', 'chamados', data) }

'use strict';

const fs   = require('fs');
const path = require('path');

const QUEUE_FILE    = path.join(process.cwd(), '_offline_queue.json');
const CHECK_INTERVAL = 30_000; // check connectivity every 30s
const MAX_QUEUE_SIZE = 200;    // hard cap — prevent unbounded growth

// ── State ─────────────────────────────────────────────────────────────────────
let _online   = true;   // last known Supabase status
let _queue    = [];     // in-memory queue (also persisted to disk)
let _supabase = null;   // injected on init

// ── Persistence ───────────────────────────────────────────────────────────────
function loadQueue() {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      _queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
      if (_queue.length > 0) {
        console.log(`[Queue] Loaded ${_queue.length} pending action(s) from disk`);
      }
    }
  } catch (_) { _queue = []; }
}

function saveQueue() {
  try { fs.writeFileSync(QUEUE_FILE, JSON.stringify(_queue, null, 2)); }
  catch (_) {}
}

// ── Enqueue a write ───────────────────────────────────────────────────────────
function enqueue(operation, table, payload, meta = {}) {
  if (_queue.length >= MAX_QUEUE_SIZE) {
    console.warn(`[Queue] Full (${MAX_QUEUE_SIZE} items) — dropping oldest`);
    _queue.shift();
  }
  const action = {
    id:        `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    operation, // 'insert' | 'update' | 'delete'
    table,
    payload,
    meta,
    queuedAt:  new Date().toISOString(),
    attempts:  0,
  };
  _queue.push(action);
  saveQueue();
  console.log(`[Queue] Enqueued ${operation} on ${table} (queue size: ${_queue.length})`);
  return action.id;
}

// ── Flush queue on reconnect ──────────────────────────────────────────────────
async function flush() {
  if (!_supabase || _queue.length === 0) return;

  console.log(`[Queue] Flushing ${_queue.length} pending action(s)...`);
  const failed = [];

  for (const action of _queue) {
    try {
      action.attempts++;
      let result;
      if (action.operation === 'insert') {
        result = await _supabase.from(action.table).insert([action.payload]);
      } else if (action.operation === 'update') {
        result = await _supabase.from(action.table)
          .update(action.payload.data)
          .eq('id', action.payload.id);
      } else if (action.operation === 'delete') {
        result = await _supabase.from(action.table).delete().eq('id', action.payload.id);
      }

      if (result?.error) throw result.error;
      console.log(`[Queue] ✓ Replayed ${action.operation} on ${action.table} (${action.id})`);
    } catch (err) {
      console.warn(`[Queue] ✗ Failed ${action.id}: ${err.message} (attempt ${action.attempts})`);
      if (action.attempts < 5) failed.push(action); // retry up to 5 times
      else console.warn(`[Queue] Dropping ${action.id} after 5 failed attempts`);
    }
  }

  _queue = failed;
  saveQueue();
  if (_queue.length === 0) console.log('[Queue] All actions flushed ✓');
  else console.warn(`[Queue] ${_queue.length} action(s) still pending`);
}

// ── Health check ──────────────────────────────────────────────────────────────
async function checkHealth() {
  if (!_supabase) return;
  try {
    const { error } = await _supabase.from('settings_global').select('id').eq('id', 1).single();
    const wasOnline = _online;
    _online = !error;
    if (!wasOnline && _online) {
      console.log('[Queue] Supabase back online — flushing queue');
      await flush();
    }
    if (wasOnline && !_online) {
      console.warn('[Queue] Supabase OFFLINE — writes will be queued');
    }
  } catch (_) {
    _online = false;
  }
}

// ── Express middleware — attaches queue helpers to req ────────────────────────
// Usage: app.use(offlineMiddleware)
// Then in routes: req.isOnline() / req.enqueue(...)
function middleware(req, res, next) {
  req.isOnline  = isOnline;
  req.enqueue   = enqueue;
  req.queueSize = () => _queue.length;
  next();
}

// ── Init — call once in server.js ─────────────────────────────────────────────
function init(supabaseClient) {
  _supabase = supabaseClient;
  loadQueue();
  checkHealth(); // immediate check
  setInterval(checkHealth, CHECK_INTERVAL);
  console.log('[Queue] Offline queue initialized');
}

const isOnline  = () => _online;
const queueSize = () => _queue.length;

module.exports = { init, enqueue, flush, isOnline, queueSize, middleware };

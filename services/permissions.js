'use strict';
/**
 * services/permissions.js
 * Fetches user role directly from settings_user (no view dependency).
 * The user_permissions view is optional; this works without it.
 */
const { supabaseAdmin } = require('./db');

const ROLE_MAP = { 1: 'master', 2: 'admin', 3: 'technician' };
const _cache   = new Map();
const TTL_MS   = 60_000; // 1 min cache

async function fetchUserPermissions(userId) {
  if (!userId) return { role: 'technician', permissions: [] };

  const cached = _cache.get(userId);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.data;

  // Query settings_user directly — no view needed
  const { data: su } = await supabaseAdmin
    .from('settings_user')
    .select('role_id')
    .eq('user_id', userId)
    .maybeSingle();

  const role_id    = su?.role_id ?? 3;
  const role       = ROLE_MAP[role_id] || 'technician';
  const permissions = buildPermissions(role);

  const result = { role, role_id, permissions };
  _cache.set(userId, { data: result, ts: Date.now() });
  return result;
}

function buildPermissions(role) {
  const base = ['create_case', 'view_own_cases', 'edit_own_case', 'view_basic_status', 'export_pdf'];
  if (role === 'technician') return base;
  const admin = [...base, 'view_all_cases', 'edit_case', 'manage_reminders', 'view_reports', 'view_ai_obs'];
  if (role === 'admin') return admin;
  return [...admin, 'manage_roles', 'manage_settings', 'run_janitor']; // master
}

function invalidateCache(userId) {
  if (userId) _cache.delete(userId);
  else _cache.clear();
}

/**
 * requirePermission(permission) — middleware factory
 *
 * Usage: router.post('/route', requirePermission('manage_roles'), handler)
 *
 * Returns a middleware function (req, res, next) => {}
 * NEVER call with (req, res, permission) — that was the v1 bug.
 */
function requirePermission(permission) {
  return async (req, res, next) => {
    try {
      const perms = await fetchUserPermissions(req.user?.id);
      if (!perms.permissions.includes(permission)) {
        return res.status(403).json({ error: 'Permissão insuficiente: ' + permission });
      }
      next();
    } catch (err) {
      return res.status(500).json({ error: 'Erro ao verificar permissão: ' + err.message });
    }
  };
}


// ── Compatibility shims for older routes (knowledge.js, etc.) ─────────────────

/**
 * enrichUser — Express middleware that attaches role+permissions to req.user.
 * Use as: router.use(enrichUser)
 */
async function enrichUser(req, res, next) {
  if (req.user?.id) {
    try {
      const perms = await fetchUserPermissions(req.user.id);
      req.user.role        = perms.role;
      req.user.role_id     = perms.role_id;
      req.user.permissions = perms.permissions;
    } catch {}
  }
  next();
}

/**
 * hasPermission(user, permission) — synchronous check against user.permissions array.
 * Works after enrichUser has run.
 */
function hasPermission(user, permission) {
  if (!user) return false;
  const role = user.role || 'technician';
  if (role === 'master') return true; // master has all permissions
  if (role === 'admin' && permission !== 'run_janitor') return true;
  return (user.permissions || []).includes(permission);
}

module.exports = { fetchUserPermissions, requirePermission, invalidateCache, buildPermissions, enrichUser, hasPermission };

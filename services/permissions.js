// services/permissions.js
// Three-tier RBAC: master > admin > technician

'use strict';

const { supabaseAdmin } = require('./db');

const _cache = new Map();
const TTL_MS = 60 * 1000; // 1 min — role changes reflect quickly

// ── Permission sets by role (used as safe fallback if DB is misconfigured) ───
const GOVERNANCE_ONLY = ['manage_roles', 'assign_roles', 'override_permissions', 'delete_any_case'];

const ALL_PERMISSIONS = [
  'manage_roles','assign_roles','manage_settings','manage_integrations',
  'override_permissions','delete_any_case','view_audit',
  'view_all_cases','edit_case','assign_case','change_case_status',
  'approve_technician','upload_drive','trigger_ocr','export_pdf',
  'view_products_insights','manage_categories','reopen_case',
  'create_case','view_own_cases','edit_own_case',
  'upload_files','trigger_manual_ocr','complete_case','view_basic_status',
];

const ROLE_DEFAULTS = {
  master:     ALL_PERMISSIONS,
  admin:      ALL_PERMISSIONS.filter(p => !GOVERNANCE_ONLY.includes(p)),
  technician: [
    'create_case','view_own_cases','edit_own_case',
    'upload_files','trigger_manual_ocr','complete_case',
    'view_basic_status','export_pdf',
  ],
};

async function fetchUserPermissions(userId, userEmail) {
  const cached = _cache.get(userId);
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return { role: cached.role, permissions: cached.permissions };
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('user_permissions')
      .select('role, permissions')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) console.error('[RBAC] view query error:', error.message);

    if (!data) {
      // user_permissions view missing or returned nothing — read directly from settings_user
      const { data: su } = await supabaseAdmin
        .from('settings_user')
        .select('user_id, role_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (!su) {
        console.warn(`[RBAC] No settings_user row for user_id="${userId}" (${userEmail})`);
        return { role: 'technician', permissions: ROLE_DEFAULTS.technician };
      }

      if (su.role_id === null) {
        console.warn(`[RBAC] Access REVOKED for user_id="${userId}" (${userEmail})`);
        return { role: 'revoked', permissions: [] };
      }

      // Map role_id directly — works even without user_permissions view
      const ROLE_MAP = { 1: 'master', 2: 'admin', 3: 'technician' };
      const role = ROLE_MAP[su.role_id] || 'technician';
      const permissions = ROLE_DEFAULTS[role] || ROLE_DEFAULTS.technician;

      console.log(`[RBAC] Direct fallback: user_id="${userId}" role_id=${su.role_id} → role="${role}"`);
      const result = { role, permissions };
      _cache.set(userId, { ...result, ts: Date.now() });
      return result;
    }

    // Ensure the permissions array is always complete — merge DB perms with role defaults
    // This guards against missing role_permissions rows
    const dbPerms     = Array.isArray(data.permissions) ? data.permissions : [];
    const roleDefaults = ROLE_DEFAULTS[data.role] || ROLE_DEFAULTS.technician;
    // Use DB perms as source of truth; fall back to defaults if empty
    const permissions = dbPerms.length > 0 ? dbPerms : roleDefaults;

    const result = { role: data.role, permissions };
    _cache.set(userId, { ...result, ts: Date.now() });
    return result;

  } catch (err) {
    console.error('[RBAC] fetchUserPermissions error:', err.message);
    return { role: 'technician', permissions: ROLE_DEFAULTS.technician };
  }
}

function invalidateCache(userId) {
  if (userId) _cache.delete(userId);
  else _cache.clear();
}

function hasPermission(user, action) {
  if (!user || !Array.isArray(user.permissions)) return false;
  // Master always has everything
  if (user.role === 'master') return true;
  return user.permissions.includes(action);
}

function requirePermission(action) {
  return async (req, res, next) => {
    try {
      if (!req.user?.id) return res.status(401).json({ error: 'Não autenticado' });
      if (!req.user.permissions) {
        const { role, permissions } = await fetchUserPermissions(req.user.id, req.user.email);
        req.user.role        = role;
        req.user.permissions = permissions;
      }
      if (!hasPermission(req.user, action)) {
        console.warn(`[RBAC] DENIED user=${req.user.id} role=${req.user.role} action=${action}`);
        return res.status(403).json({ error: `Permissão negada: "${action}"` });
      }
      next();
    } catch (err) {
      console.error('[RBAC] middleware error:', err.message);
      res.status(500).json({ error: 'Erro de autenticação' });
    }
  };
}

async function enrichUser(req, res, next) {
  try {
    if (req.user?.id && !req.user.permissions) {
      const { role, permissions } = await fetchUserPermissions(req.user.id, req.user.email);
      req.user.role        = role;
      req.user.permissions = permissions;
    }
    next();
  } catch (_) { next(); }
}

module.exports = {
  hasPermission, requirePermission, enrichUser,
  fetchUserPermissions, invalidateCache, ROLE_DEFAULTS,
};

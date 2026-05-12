// routes/reminders.js
const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../services/db');

// Graceful crypto — works even if crypto.js not yet deployed
let _crypto = null;
try {
  _crypto = require('../services/crypto');
} catch (_) { console.warn('[Reminders] crypto service not available — running without encryption'); }

const EF = _crypto?.ENCRYPTED_FIELDS?.reminders || [];
const encryptFields  = (obj, fields, key) => _crypto ? _crypto.encryptFields(obj, fields, key)   : obj;
const decryptFields  = (obj, fields, key) => _crypto ? _crypto.decryptFields(obj, fields, key)   : obj;
const keyFromReq     = (req)              => _crypto ? _crypto.keyFromReq(req)                    : null;
const getMasterKey   = ()                 => _crypto ? _crypto.getMasterKey()                     : null;

// ── GET /api/reminders ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const userId = req.user?.id;

    // req.user only has Google profile (id, email, name, picture) — no role.
    // Must look up role from settings_user directly.
    let canViewAll = false;
    if (req.query.all === 'true' && userId) {
      const { data: su } = await supabaseAdmin
        .from('settings_user')
        .select('role_id')
        .eq('user_id', userId)
        .maybeSingle();
      // role_id: 1=master, 2=admin, 3=technician
      canViewAll = su?.role_id === 1 || su?.role_id === 2;
    }
    const { status, month, year } = req.query;

    let query = supabaseAdmin
      .from('reminders')
      .select('*')
      .order('return_date', { ascending: true, nullsFirst: false });

    if (!canViewAll) query = query.eq('user_id', userId);

    if (status) query = query.eq('status', status);

    if (month && year) {
      const from = `${year}-${String(month).padStart(2,'0')}-01`;
      const to   = new Date(year, month, 0).toISOString().split('T')[0];
      query = query.gte('return_date', from).lte('return_date', to);
    }

    const { data, error } = await query;
    if (error) throw error;

    let rows = data || [];

    // Enrich with technician name for admin/master view
    if (canViewAll && rows.length) {
      try {
        const userIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
        const nameMap = {};

        // persistent_sessions has NO user_id column — only token + user_data JSON.
        // Must scan all sessions and match by user_data.id (= Google user id).
        const { data: sessions } = await supabaseAdmin
          .from('persistent_sessions')
          .select('user_data')
          .limit(500); // cap to avoid loading entire table

        (sessions||[]).forEach(s => {
          try {
            const ud = typeof s.user_data === 'string' ? JSON.parse(s.user_data) : s.user_data;
            const uid = ud?.id;
            if (uid && userIds.includes(uid) && !nameMap[uid]) {
              nameMap[uid] = (ud.name || ud.email || '').split(' ')[0].split('@')[0] || null;
            }
          } catch {}
        });

        // Fallback: access_requests.google_id == reminders.user_id (Google ID)
        const missing = userIds.filter(id => !nameMap[id]);
        if (missing.length) {
          const { data: reqs } = await supabaseAdmin
            .from('access_requests')
            .select('google_id, name, email')
            .in('google_id', missing);
          (reqs||[]).forEach(req => {
            if (!req.google_id) return;
            // access_requests.name may or may not be encrypted — decryptField handles both
            const mk = getMasterKey();
            const rawName  = _crypto ? _crypto.decryptField(req.name,  mk) : req.name;
            const rawEmail = _crypto ? _crypto.decryptField(req.email, mk) : req.email;
            const name = (rawName || rawEmail || 'Técnico').split(' ')[0].split('@')[0];
            nameMap[req.google_id] = name;
          });
        }

        // Last resort: use first letter of user_id as placeholder
        rows = rows.map(r => ({
          ...r,
          _userName: nameMap[r.user_id] || null,
        }));
      } catch (nameErr) {
        console.warn('[Reminders] name enrichment failed:', nameErr.message);
      }
    }

    // Each record was encrypted with deriveKey(owner_userId, 'technician').
    // Even master cannot use raw master key — must re-derive per owner.
    if (_crypto) {
      const keyCache = {};
      rows = rows.map(r => {
        const ownerId = r.user_id || userId;
        if (!keyCache[ownerId]) keyCache[ownerId] = _crypto.deriveKey(ownerId, 'technician');
        return { ...decryptFields(r, EF, keyCache[ownerId]), _userName: r._userName };
      });
    }

    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/reminders ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const userId = req.user?.id;
    const { client_name, phone, note, return_date, priority } = req.body;
    if (!client_name) return res.status(400).json({ error: 'client_name required' });

    // Derive key for the creating user (always a technician encrypting own data)
    const key = _crypto ? _crypto.deriveKey(userId, 'technician') : null;
    const { data, error } = await supabaseAdmin
      .from('reminders')
      .insert([encryptFields({
        user_id: userId, client_name, phone, note,
        return_date: return_date || null,
        priority:    priority || 'normal',
        status:      'pending',
        updated_at:  new Date(),
      }, EF, key)])
      .select().single();
    if (error) throw error;
    res.json(decryptFields(data, EF, key));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/reminders/:id ────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    const { data: suPut } = await supabaseAdmin
      .from('settings_user').select('role_id').eq('user_id', userId).maybeSingle();
    const canEditAll = suPut?.role_id === 1 || suPut?.role_id === 2;

    // Fetch the reminder's actual owner to derive the correct encryption key.
    // Admin editing tech's reminder must encrypt with tech's key (not admin's key).
    const { data: existingRem } = await supabaseAdmin
      .from('reminders').select('user_id').eq('id', req.params.id).maybeSingle();
    const ownerId = existingRem?.user_id || userId;
    const key = _crypto ? _crypto.deriveKey(ownerId, 'technician') : null;
    const encBody = encryptFields({ ...req.body, updated_at: new Date() }, EF, key);

    let query = supabaseAdmin
      .from('reminders')
      .update(encBody)
      .eq('id', req.params.id);

    if (!canEditAll) query = query.eq('user_id', userId);

    const { data, error } = await query.select().single();
    if (error) throw error;
    res.json(decryptFields(data, EF, key));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/reminders/:id ─────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    await supabaseAdmin.from('reminders').delete()
      .eq('id', req.params.id).eq('user_id', userId);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

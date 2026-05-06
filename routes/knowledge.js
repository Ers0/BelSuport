// routes/knowledge.js
const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../services/db');
const { hasPermission, enrichUser } = require('../services/permissions');
router.use(enrichUser);

function isAdmin(req) {
  return hasPermission(req.user, 'manage_roles') || hasPermission(req.user, 'view_all_cases');
}

// ── GET /api/knowledge?fabricante=Deye — get all entries, optionally filtered
router.get('/', async (req, res) => {
  try {
    let query = supabaseAdmin
      .from('alarm_knowledge')
      .select('*')
      .order('fabricante')
      .order('code');
    if (req.query.fabricante) query = query.eq('fabricante', req.query.fabricante);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/knowledge/fabricantes — list distinct fabricantes that have entries
router.get('/fabricantes', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('alarm_knowledge')
      .select('fabricante')
      .order('fabricante');
    if (error) throw error;
    const unique = [...new Set((data||[]).map(r => r.fabricante))];
    res.json(unique);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/knowledge — create entry (admin only)
router.post('/', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const { fabricante, code, description, cause, solution, severity } = req.body;
    if (!fabricante || !code || !description)
      return res.status(400).json({ error: 'fabricante, code e description são obrigatórios' });

    const { data, error } = await supabaseAdmin
      .from('alarm_knowledge')
      .upsert([{ fabricante, code, description, cause, solution, severity: severity||'medium', updated_at: new Date() }], { onConflict: 'fabricante,code' })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/knowledge/:id — update entry (admin only)
router.put('/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const { data, error } = await supabaseAdmin
      .from('alarm_knowledge')
      .update({ ...req.body, updated_at: new Date() })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/knowledge/:id (admin only)
router.delete('/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    await supabaseAdmin.from('alarm_knowledge').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/knowledge/import — bulk import from JSON (admin only)
router.post('/import', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const { entries } = req.body; // array of { fabricante, code, description, cause, solution, severity }
    if (!Array.isArray(entries) || !entries.length)
      return res.status(400).json({ error: 'entries array required' });

    const { data, error } = await supabaseAdmin
      .from('alarm_knowledge')
      .upsert(entries.map(e => ({ ...e, updated_at: new Date() })), { onConflict: 'fabricante,code' })
      .select();
    if (error) throw error;
    res.json({ imported: data?.length || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

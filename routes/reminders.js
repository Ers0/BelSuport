// routes/reminders.js
const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../services/db');

// ── GET /api/reminders ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const userId = req.user?.id;
    const { status, month, year } = req.query;

    let query = supabaseAdmin
      .from('reminders')
      .select('*')
      .eq('user_id', userId)
      .order('return_date', { ascending: true, nullsFirst: false });

    if (status) query = query.eq('status', status);

    if (month && year) {
      const from = `${year}-${String(month).padStart(2,'0')}-01`;
      const to   = new Date(year, month, 0).toISOString().split('T')[0]; // last day
      query = query.gte('return_date', from).lte('return_date', to);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/reminders ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const userId = req.user?.id;
    const { client_name, phone, note, return_date, priority } = req.body;
    if (!client_name) return res.status(400).json({ error: 'client_name required' });

    const { data, error } = await supabaseAdmin
      .from('reminders')
      .insert([{
        user_id: userId, client_name, phone, note,
        return_date: return_date || null,
        priority:    priority || 'normal',
        status:      'pending',
        updated_at:  new Date(),
      }])
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/reminders/:id ────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    const { data, error } = await supabaseAdmin
      .from('reminders')
      .update({ ...req.body, updated_at: new Date() })
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .select().single();
    if (error) throw error;
    res.json(data);
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

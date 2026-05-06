// routes/events.js
const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../services/db');

// ── GET /api/events/:caseId — get timeline for a case
router.get('/:caseId', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('case_events')
      .select('*')
      .eq('case_id', req.params.caseId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/events — add event to a case
router.post('/', async (req, res) => {
  try {
    const { case_id, event_type, description, metadata } = req.body;
    const user_name = req.user?.name || req.user?.email || 'Sistema';
    const user_id   = req.user?.id;

    const { data, error } = await supabaseAdmin
      .from('case_events')
      .insert([{ case_id, user_id, user_name, event_type, description, metadata }])
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/events/status-change — helper for automatic status events
router.post('/status-change', async (req, res) => {
  try {
    const { case_id, from_status, to_status } = req.body;
    const user_name = req.user?.name || req.user?.email || 'Sistema';
    const user_id   = req.user?.id;

    const { data, error } = await supabaseAdmin
      .from('case_events')
      .insert([{
        case_id,
        user_id,
        user_name,
        event_type:  'status_change',
        description: `Status alterado de "${from_status}" para "${to_status}"`,
        metadata:    { from_status, to_status }
      }])
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

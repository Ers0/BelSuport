// routes/notifications.js
const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../services/db');

// ── GET /api/notifications — get for current user + broadcasts
router.get('/', async (req, res) => {
  try {
    const userId = req.user?.id;
    // Fetch user-specific + broadcast notifications separately and merge
    const [{ data: mine }, { data: broadcast }] = await Promise.all([
      supabaseAdmin.from('notifications').select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }).limit(50),
      supabaseAdmin.from('notifications').select('*')
        .is('user_id', null)
        .order('created_at', { ascending: false }).limit(20),
    ]);
    // Merge, deduplicate by id, sort by date
    const all = [...(mine||[]), ...(broadcast||[])];
    const seen = new Set();
    const data = all.filter(n => { if (seen.has(n.id)) return false; seen.add(n.id); return true; })
      .sort((a,b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 50);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/notifications/:id/read — mark single as read
router.put('/:id/read', async (req, res) => {
  try {
    await supabaseAdmin.from('notifications').update({ read: true }).eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/notifications/read-all — mark all as read
router.put('/read-all', async (req, res) => {
  try {
    const userId = req.user?.id;
    await Promise.all([
      supabaseAdmin.from('notifications').update({ read: true }).eq('user_id', userId),
      supabaseAdmin.from('notifications').update({ read: true }).is('user_id', null),
    ]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/notifications/:id
router.delete('/:id', async (req, res) => {
  try {
    await supabaseAdmin.from('notifications').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

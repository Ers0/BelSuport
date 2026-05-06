// routes/clients.js
const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../services/db');

// ── GET /api/clients — list all, with search
router.get('/', async (req, res) => {
  try {
    const { q, tipo } = req.query;
    let query = supabaseAdmin.from('clients').select('*').order('nome');
    if (q)    query = query.ilike('nome', `%${q}%`);
    if (tipo) query = query.eq('tipo', tipo);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/clients/:id — single client with their cases and equipment
router.get('/:id', async (req, res) => {
  try {
    const id = req.params.id;

    const [{ data: client, error: cErr }, { data: cases, error: casesErr }, { data: equip, error: eErr }] = await Promise.all([
      supabaseAdmin.from('clients').select('*').eq('id', id).single(),
      supabaseAdmin.from('chamados').select('*').eq('client_id', id).order('created_at', { ascending: false }),
      supabaseAdmin.from('equipment').select('*').eq('client_id', id).order('created_at', { ascending: false }),
    ]);

    if (cErr) throw cErr;
    res.json({ ...client, cases: cases || [], equipment: equip || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/clients — create
router.post('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .insert([{ ...req.body, updated_at: new Date() }])
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/clients/:id — update
router.put('/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .update({ ...req.body, updated_at: new Date() })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/clients/:id
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from('clients').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

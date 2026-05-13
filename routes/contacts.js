'use strict';
/**
 * routes/contacts.js — Contact entities + attempt tracking
 * Used by Agenda → Tentativas de Contato tab
 */

const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../services/db');

// ── GET /api/contacts — list entities ─────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { category, q } = req.query;
    let query = supabaseAdmin
      .from('contact_entities')
      .select(`*, contact_attempts(id, result, attempted_at, notes, author)`)
      .order('name');

    if (category) query = query.eq('category', category);
    if (q) query = query.ilike('name', `%${q}%`);

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/contacts — create entity ────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const userId = req.user?.id;
    const { category, name, phone, email, notes,
            fabricante_contact_name, fabricante_contact_role, fabricante_contact_phone } = req.body;

    if (!name) return res.status(400).json({ error: 'Nome obrigatório' });

    const { data, error } = await supabaseAdmin.from('contact_entities').insert([{
      category: category || 'Clientes',
      name, phone: phone || null, email: email || null, notes: notes || null,
      fabricante_contact_name:  fabricante_contact_name  || null,
      fabricante_contact_role:  fabricante_contact_role  || null,
      fabricante_contact_phone: fabricante_contact_phone || null,
      created_by: userId,
    }]).select().single();

    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/contacts/:id — update entity ─────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('contact_entities')
      .update({ ...req.body, updated_at: new Date() })
      .eq('id', req.params.id)
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/contacts/:id — delete entity ──────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from('contact_entities').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/contacts/:id/attempts — list attempts ────────────────────────────
router.get('/:id/attempts', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('contact_attempts')
      .select(`*, chamado:chamado_id(id, sn, status, integrador, cliente_final)`)
      .eq('entity_id', req.params.id)
      .order('attempted_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/contacts/:id/attempts — create attempt ─────────────────────────
router.post('/:id/attempts', async (req, res) => {
  try {
    const userId = req.user?.id;
    const user   = req.user;
    const { result, notes, chamado_id, attempted_at } = req.body;

    if (!result) return res.status(400).json({ error: 'Resultado obrigatório' });

    const { data, error } = await supabaseAdmin.from('contact_attempts').insert([{
      entity_id:    req.params.id,
      chamado_id:   chamado_id ? Number(chamado_id) : null,
      result,
      notes:        notes || null,
      attempted_at: attempted_at || new Date().toISOString(),
      author_id:    userId,
      author:       user?.name || user?.email?.split('@')[0] || 'Técnico',
    }]).select(`*, chamado:chamado_id(id, sn, status)`).single();

    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/contacts/attempts/:id — delete attempt ───────────────────────
router.delete('/attempts/:id', async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from('contact_attempts').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

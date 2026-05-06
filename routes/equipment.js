// routes/equipment.js
const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../services/db');

// ── GET /api/equipment?sn=xxx — lookup by serial number
router.get('/', async (req, res) => {
  try {
    const { sn, q } = req.query;
    let query = supabaseAdmin
      .from('equipment')
      .select('*, client:clients(id,nome,telefone,tipo)')
      .order('created_at', { ascending: false });

    if (sn) query = query.ilike('sn', `%${sn}%`);
    if (q)  query = query.or(`sn.ilike.%${q}%,modelo.ilike.%${q}%,fabricante.ilike.%${q}%`);

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/equipment/:id — single equipment with full case history
router.get('/:id', async (req, res) => {
  try {
    const { data: equip, error: eErr } = await supabaseAdmin
      .from('equipment')
      .select('*, client:clients(id,nome,telefone)')
      .eq('id', req.params.id)
      .single();
    if (eErr) throw eErr;

    const { data: cases } = await supabaseAdmin
      .from('chamados')
      .select('*')
      .eq('sn', equip.sn)
      .order('created_at', { ascending: false });

    // Warranty status
    const warrantyEnd = equip.data_compra
      ? new Date(new Date(equip.data_compra).setMonth(new Date(equip.data_compra).getMonth() + (equip.garantia_meses || 12)))
      : null;
    const warrantyStatus = !warrantyEnd ? 'unknown'
      : warrantyEnd > new Date() ? 'active' : 'expired';

    res.json({ ...equip, cases: cases || [], warrantyEnd, warrantyStatus });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/equipment — upsert by SN
router.post('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('equipment')
      .upsert([{ ...req.body, updated_at: new Date() }], { onConflict: 'sn' })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/equipment/:id
router.put('/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('equipment')
      .update({ ...req.body, updated_at: new Date() })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

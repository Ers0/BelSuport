const express = require('express');
const router  = express.Router();
const { supabase, supabaseAdmin } = require('../services/db');
const { encryptFields, decryptFields, decryptRows, keyFromReq, getMasterKey, ENCRYPTED_FIELDS } = require('../services/crypto');
const EF = ENCRYPTED_FIELDS.chamados;

function nowPtBr() {
  const d = new Date();
  return { data: d.toLocaleDateString('pt-BR'), hora: `${String(d.getHours()).padStart(2,'0')}:00` };
}

// All routes are scoped to req.user.id so each user only sees their own cases

router.get('/', async (req, res) => {
  try {
    const userId   = req.user?.id;
    const userRole = req.user?.role || 'technician';
    const canViewAll = ['admin','master'].includes(userRole) || (req.user?.permissions||[]).includes('view_all_cases');
    const { status } = req.query;
    let query = supabaseAdmin.from('chamados').select('*').order('id', { ascending: false });
    if (!canViewAll) query = query.eq('user_id', userId);
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    const key = keyFromReq(req);
    res.json(decryptRows(data, EF, key));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { data: dateStr, hora } = nowPtBr();
  const userId = req.user?.id;
  const { nome, contato, sn, categoria, fabricante, relato, status, pasta_original,
          f_nf, f_un, f_et, v_cc, v_ca, f_fi, f_va, ven,
          cliente_final, modelo, integrador, tel_integrador } = req.body;
  try {
    const key = keyFromReq(req);
    const rawRow = {
      user_id: userId, user_name: req.user?.name || req.user?.email || 'Desconhecido',
      data: dateStr, hora, nome, contato, sn, categoria, fabricante, relato, status, pasta_original,
      f_nf: f_nf?1:0, f_un: f_un?1:0, f_et: f_et?1:0, v_cc: v_cc?1:0, v_ca: v_ca?1:0,
      f_fi: f_fi?1:0, f_va: f_va?1:0, ven,
      cliente_final: cliente_final||'', modelo: modelo||'', integrador: integrador||'', tel_integrador: tel_integrador||''
    };
    const { data: inserted, error } = await supabaseAdmin.from('chamados').insert([encryptFields(rawRow, EF, key)]).select('id').single();
    if (error) throw error;
    res.json({ id: inserted.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  const fields = req.body;
  const userId = req.user?.id;
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'No fields' });
  try {
    // Only update records belonging to this user
    const key = keyFromReq(req);
    const { error } = await supabaseAdmin.from('chamados').update(encryptFields(fields, EF, key))
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  const userId = req.user?.id;
  try {
    const { error } = await supabaseAdmin.from('chamados').delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/cases/stats - collective stats for dashboard leaderboard (all users)
router.get('/stats', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('chamados')
      .select('id, user_id, nome, fabricante, categoria, status, data, hora, integrador, cliente_final, contato, tel_integrador, sn, modelo, relato, adb_number, jira_key, assigned_to, created_at')
      .order('id', { ascending: false })
      .limit(500);
    if (error) throw error;
    res.json(decryptRows(data || [], EF, getMasterKey()));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
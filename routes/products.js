const express = require('express');
const router  = express.Router();
const { supabase, supabaseAdmin } = require('../services/db');

const ADMIN_EMAILS = ['eros.belenergy@gmail.com'];

function isAdmin(req, res, next) {
  if (req.user && ADMIN_EMAILS.includes(req.user.email)) return next();
  return res.status(403).json({ error: 'Acesso negado: apenas administradores podem alterar produtos.' });
}

router.get('/', async (req, res) => {
  try {
    const { data: cats, error: err1 } = await supabaseAdmin.from('categorias').select('*').order('nome');
    const { data: fabs, error: err2 } = await supabaseAdmin.from('fabricantes').select('*').order('nome');
    if (err1 || err2) throw (err1 || err2);
    const result = (cats || []).map(c => ({
      ...c, fabricantes: (fabs || []).filter(f => f.categoria_id === c.id)
    }));
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/categoria', isAdmin, async (req, res) => {
  const { nome } = req.body;
  if (!nome) return res.status(400).json({ error: 'Nome obrigatorio' });
  const { data, error } = await supabaseAdmin.from('categorias').insert([{ nome: nome.trim() }]).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.post('/fabricante', isAdmin, async (req, res) => {
  const { nome, categoria_id } = req.body;
  if (!nome || !categoria_id) return res.status(400).json({ error: 'Nome e categoria_id obrigatorios' });
  const { data, error } = await supabaseAdmin.from('fabricantes').insert([{ nome: nome.trim(), categoria_id }]).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/categoria/:id', isAdmin, async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from('categorias').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/fabricante/:id', isAdmin, async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from('fabricantes').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

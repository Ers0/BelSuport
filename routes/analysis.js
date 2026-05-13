// routes/analysis.js
// Alarm pattern analysis — clusters relato text by fabricante,
// ranks most common issues, optionally calls Claude API for root cause summary.

const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../services/db');

// ── RAG pipeline — graceful load (Ollama may not be running in cloud) ─────────
let _ragQuery = null, _buildQuery = null;
try {
  const rag = require('../services/rag');
  _ragQuery  = rag.ragQuery;
  _buildQuery = rag.buildQuery;
} catch (e) {
  console.warn('[Analysis] RAG service not available:', e.message);
}

// ── Text clustering helpers ───────────────────────────────────────────────────

// Stop words to ignore when building keyword frequency
const STOP_WORDS = new Set([
  'de','da','do','em','no','na','com','sem','para','por','que','uma','um',
  'os','as','se','ao','ou','e','a','o','é','foi','está','não','sim',
  'mais','muito','também','mas','já','como','este','esse','isso',
]);

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-záéíóúâêîôûãõàèìòùç\s]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

// Group cases into clusters based on shared keywords
// Returns array of { label, keywords, count, pct, cases }
function clusterCases(cases) {
  // 1. Build keyword frequency map across all cases
  const kwFreq = {};
  cases.forEach(c => {
    const tokens = [...new Set(tokenize(c.relato))]; // unique per case
    tokens.forEach(t => { kwFreq[t] = (kwFreq[t] || 0) + 1; });
  });

  // 2. Keep only keywords appearing in ≥2 cases and ≤80% of cases
  const minOccur = Math.max(2, Math.floor(cases.length * 0.05));
  const maxOccur = Math.floor(cases.length * 0.8);
  const sigKws = Object.entries(kwFreq)
    .filter(([, v]) => v >= minOccur && v <= maxOccur)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([k]) => k);

  // 3. For each significant keyword, collect matching cases as a cluster
  const used = new Set();
  const clusters = [];

  for (const kw of sigKws) {
    const matching = cases.filter(c => {
      const tokens = tokenize(c.relato);
      return tokens.includes(kw);
    });

    if (matching.length < 2) continue;

    // Build a richer label from the 2-3 most common co-occurring keywords
    const coKws = {};
    matching.forEach(c => {
      tokenize(c.relato).forEach(t => {
        if (t !== kw && sigKws.includes(t)) coKws[t] = (coKws[t] || 0) + 1;
      });
    });
    const topCoKws = Object.entries(coKws).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([k])=>k);
    const label    = [kw, ...topCoKws].join(' + ');

    clusters.push({
      label,
      keywords:   [kw, ...topCoKws],
      count:      matching.length,
      sampleRelatos: matching.slice(0, 3).map(c => c.relato?.slice(0, 120) || ''),
      caseIds:    matching.map(c => c.id),
    });

    matching.forEach(c => used.add(c.id));
  }

  // 4. Catch-all cluster for unclustered cases
  const unclustered = cases.filter(c => !used.has(c.id));
  if (unclustered.length > 0) {
    clusters.push({
      label:    'Outros',
      keywords: [],
      count:    unclustered.length,
      sampleRelatos: unclustered.slice(0, 3).map(c => c.relato?.slice(0, 120) || ''),
      caseIds:  unclustered.map(c => c.id),
    });
  }

  // 5. Sort and add percentages
  const total = cases.length;
  return clusters
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map(cl => ({ ...cl, pct: Math.round((cl.count / total) * 100) }));
}

// ── GET /api/analysis — run analysis on all cases ────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { data: cases, error } = await supabaseAdmin
      .from('chamados')
      .select('id, fabricante, categoria, relato, status, data')
      .not('relato', 'is', null)
      .neq('relato', '');
    if (error) throw error;

    // Group by fabricante
    const byFab = {};
    (cases || []).forEach(c => {
      const fab = c.fabricante || 'Desconhecido';
      if (!byFab[fab]) byFab[fab] = [];
      byFab[fab].push(c);
    });

    // Cluster each fabricante's cases
    const results = Object.entries(byFab)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([fabricante, fabCases]) => ({
        fabricante,
        total:    fabCases.length,
        clusters: clusterCases(fabCases),
        aiSummary: null, // populated on demand
      }));

    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/analysis/ai-summary — Groq (free) root cause analysis
router.post('/ai-summary', async (req, res) => {
  const { fabricante, clusters, total } = req.body;
  if (!fabricante || !clusters?.length) return res.status(400).json({ error: 'Missing data' });

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return res.status(400).json({ error: 'GROQ_API_KEY not set in .env — obtenha grátis em console.groq.com' });

  try {
    // Load knowledge base for this fabricante
    const { supabaseAdmin } = require('../services/db');
    const { data: knowledge } = await supabaseAdmin
      .from('alarm_knowledge')
      .select('code, description, cause, solution, severity')
      .eq('fabricante', fabricante)
      .order('code');

    // Build knowledge base section for prompt
    const knowledgeSection = knowledge?.length
      ? `\nBASE DE CONHECIMENTO PARA ${fabricante.toUpperCase()}:
Códigos de alarme e falhas conhecidos:
${knowledge.map(k =>
  `• ${k.code}: ${k.description}` +
  (k.cause    ? `\n  Causa: ${k.cause}`    : '') +
  (k.solution ? `\n  Solução: ${k.solution}` : '') +
  (k.severity ? `\n  Severidade: ${k.severity}` : '')
).join('\n')}

Use esta base de conhecimento para correlacionar os relatos com códigos de alarme conhecidos.
`
      : '\n(Nenhuma base de conhecimento cadastrada para este fabricante ainda.)\n';

    const prompt = `Você é um especialista técnico em inversores solares e sistemas fotovoltaicos.
${knowledgeSection}
Analise os seguintes dados de chamados de suporte para o fabricante "${fabricante}" (${total} chamados no total):

${clusters.map((cl, i) => `
Problema #${i + 1}: "${cl.label}" (${cl.count} casos — ${cl.pct}%)
Palavras-chave: ${cl.keywords.join(', ')}
Exemplos de relatos reais:
${cl.sampleRelatos.map(r => `  - "${r}"`).join('\n')}
`).join('\n')}

Responda em português com:

1. **Causa raiz provável** de cada problema (correlacione com a base de conhecimento quando possível)
2. **Checklist de diagnóstico** (5 passos práticos no campo, ordenados por probabilidade)
3. **Alerta de padrão**: existe indício de defeito de lote, firmware ou instalação sistemática?
4. **Recomendação geral** para a equipe de suporte

Seja direto e técnico. Mencione códigos de alarme específicos quando relevante.`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`,
      },
      body: JSON.stringify({
        model:       'llama-3.1-8b-instant',
        max_tokens:  1800,
        temperature: 0.3,
        messages:    [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    const text = data.choices?.[0]?.message?.content || 'Sem resposta';
    res.json({ summary: text, knowledgeCount: knowledge?.length || 0 });

  } catch (err) {
    console.error('Groq analysis error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ── POST /api/analysis/rag — Full RAG pipeline ───────────────────────────────
router.post('/rag', async (req, res) => {
  try {
    if (!_ragQuery) return res.status(503).json({ error: 'RAG service not available — check services/rag.js' });
    const { userMessage, fabricante, modelo, categoria, sn, relato, alarmCode, ocrText, brand } = req.body;
    if (!userMessage && !relato && !alarmCode && !ocrText)
      return res.status(400).json({ error: 'Forneca userMessage, relato ou alarmCode' });
    const query = _buildQuery({ userMessage, fabricante, modelo, categoria, sn, relato, alarmCode, ocrText });
    const result = await _ragQuery(query, { brand: brand || fabricante, fabricante });
    return res.json(result);
  } catch (err) {
    console.error('[RAG route] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/analysis/suggest-title ─────────────────────────────────────────
router.post('/suggest-title', async (req, res) => {
  try {
    const { content, fabricante, categoria } = req.body;
    if (!content) return res.status(400).json({ error: 'content obrigatorio' });
    const GROQ_KEY = process.env.GROQ_API_KEY;
    if (!GROQ_KEY) return res.status(400).json({ error: 'GROQ_API_KEY nao configurada' });
    const prompt = 'Crie um titulo conciso (max 80 chars) para esta solucao tecnica de energia solar.\n' +
      (fabricante ? 'Fabricante: ' + fabricante + '\n' : '') +
      (categoria  ? 'Categoria: '  + categoria  + '\n' : '') +
      'Conteudo:\n' + content.slice(0, 500) +
      '\n\nRetorne APENAS o titulo, sem aspas.';
    const fetch = (await import('node-fetch')).default;
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + GROQ_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama-3.1-8b-instant', max_tokens: 60, temperature: 0.4,
        messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await r.json();
    return res.json({ title: (data.choices?.[0]?.message?.content || '').trim() });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ── POST /api/analysis/reindex — rebuild embeddings for solutions without one ─
router.post('/reindex', async (req, res) => {
  try {
    if (!_ragQuery) return res.status(503).json({ error: 'RAG not available' });
    const { embed } = require('../services/rag');
    const { data: missing } = await supabaseAdmin.from('solutions').select('id,title,content,brand,tags').is('embedding', null).order('id');
    if (!missing?.length) return res.json({ message: 'Todas as solucoes ja tem embedding.', indexed: 0 });
    let indexed = 0, failed = 0;
    for (const sol of missing) {
      try {
        const text = [sol.title, sol.brand ? 'Marca: ' + sol.brand : '', (sol.tags||[]).join(' '), (sol.content||'').slice(0,800)].filter(Boolean).join('. ');
        const vec = await embed(text);
        if (!vec) { failed++; continue; }
        await supabaseAdmin.from('solutions').update({ embedding: vec }).eq('id', sol.id);
        indexed++;
        await new Promise(r => setTimeout(r, 100));
      } catch { failed++; }
    }
    return res.json({ message: indexed + ' indexadas, ' + failed + ' com falha.', indexed, failed });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});


// ── POST /api/analysis/alarm-knowledge/import — bulk import from JSON ─────────
// Accepts array of alarm objects. Maps common field names automatically.
// Supports: { code/alarme/alarm_code, description/descricao, cause/causa,
//             solution/solucao, severity/severidade, fabricante/brand, category }
router.post('/alarm-knowledge/import', async (req, res) => {
  try {
    const { data: rawData, fabricante: defaultFabricante } = req.body;
    if (!Array.isArray(rawData) || !rawData.length) {
      return res.status(400).json({ error: 'Envie um array JSON com os alarmes' });
    }

    const FIELD_MAP = {
      code:        ['code', 'codigo', 'alarme', 'alarm_code', 'alarm', 'cod'],
      description: ['description', 'descricao', 'desc', 'nome', 'name', 'title', 'titulo'],
      cause:       ['cause', 'causa', 'reason', 'motivo'],
      solution:    ['solution', 'solucao', 'fix', 'correcao', 'resolucao', 'action'],
      severity:    ['severity', 'severidade', 'level', 'nivel', 'priority', 'prioridade'],
      fabricante:  ['fabricante', 'brand', 'marca', 'manufacturer'],
      category:    ['category', 'categoria', 'type', 'tipo'],
    };

    function getField(obj, keys) {
      for (const k of keys) {
        if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return String(obj[k]).trim();
      }
      return null;
    }

    const rows = rawData.map(item => ({
      fabricante:  getField(item, FIELD_MAP.fabricante) || defaultFabricante || 'Geral',
      code:        getField(item, FIELD_MAP.code)        || null,
      description: getField(item, FIELD_MAP.description) || '',
      cause:       getField(item, FIELD_MAP.cause)       || null,
      solution:    getField(item, FIELD_MAP.solution)    || null,
      severity:    getField(item, FIELD_MAP.severity)    || 'medium',
      category:    getField(item, FIELD_MAP.category)    || null,
      updated_at:  new Date(),
    })).filter(r => r.code); // skip rows without a code

    if (!rows.length) {
      return res.status(400).json({
        error: 'Nenhum alarme com código válido encontrado.',
        hint:  'Verifique se os objetos têm um campo: code, codigo, alarme, alarm_code',
        sample: rawData[0],
      });
    }

    // Upsert — update existing codes, insert new ones
    const { data, error } = await supabaseAdmin
      .from('alarm_knowledge')
      .upsert(rows, { onConflict: 'fabricante,code', ignoreDuplicates: false })
      .select('id');

    if (error) throw error;

    return res.json({
      success:  true,
      imported: rows.length,
      skipped:  rawData.length - rows.length,
      message:  rows.length + ' alarmes importados para ' + [...new Set(rows.map(r => r.fabricante))].join(', '),
    });
  } catch (err) {
    console.error('[Alarm import] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/analysis/alarm-knowledge — list all entries ─────────────────────
router.get('/alarm-knowledge', async (req, res) => {
  try {
    const { fabricante } = req.query;
    let query = supabaseAdmin.from('alarm_knowledge').select('*').order('fabricante').order('code');
    if (fabricante) query = query.eq('fabricante', fabricante);
    const { data, error } = await query;
    if (error) throw error;
    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/analysis/alarm-knowledge/:id ──────────────────────────────────
router.delete('/alarm-knowledge/:id', async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from('alarm_knowledge').delete().eq('id', req.params.id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});


// ── GET /api/analysis/curation — pending curation queue (admin) ───────────────
router.get('/curation', async (req, res) => {
  try {
    const { getPendingCuration } = require('../services/janitor');
    const items = await getPendingCuration({ limit: parseInt(req.query.limit) || 50 });
    return res.json(items);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ── POST /api/analysis/curation/:id/resolve ───────────────────────────────────
router.post('/curation/:id/resolve', async (req, res) => {
  try {
    const { resolveCuration } = require('../services/janitor');
    await resolveCuration(req.params.id, req.user?.id);
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ── POST /api/analysis/promote/:id — promote cold solution to hot tier ────────
router.post('/promote/:id', async (req, res) => {
  try {
    const { promoteToHot } = require('../services/janitor');
    const result = await promoteToHot(req.params.id);
    return res.json(result);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

module.exports = router;

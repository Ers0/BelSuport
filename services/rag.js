'use strict';
/**
 * services/rag.js — Belenergy Semantic Retrieval Pipeline (RAG v301)
 */

const http = require('http');
const { supabaseAdmin } = require('./db');

const OLLAMA_URL   = process.env.OLLAMA_URL  || 'http://localhost:11434';
const EMBED_MODEL  = process.env.EMBED_MODEL || 'nomic-embed-text';
const GROQ_MODEL   = 'llama-3.1-8b-instant';
const GROQ_URL     = 'https://api.groq.com/openai/v1/chat/completions';

const SIMILARITY_THRESHOLD = 0.30;
const FALLBACK_THRESHOLD   = 0.45;
const TOP_K      = 5;
const CONTEXT_K  = 3;
const MAX_SNIPPET = 600;

// ── 1. EMBED ──────────────────────────────────────────────────────────────────
async function embed(text) {
  const body = JSON.stringify({ model: EMBED_MODEL, prompt: text });
  return new Promise((resolve) => {
    const url = new URL('/api/embeddings', OLLAMA_URL);
    const req = http.request({
      hostname: url.hostname,
      port:     parseInt(url.port) || 11434,
      path:     url.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw).embedding || null); }
        catch { resolve(null); }
      });
    });
    req.setTimeout(30_000, () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

// ── 2. RETRIEVE ───────────────────────────────────────────────────────────────
async function retrieveChunks(queryEmbedding) {
  if (!queryEmbedding) return [];
  try {
    const { data, error } = await supabaseAdmin.rpc('match_solutions', {
      query_embedding: queryEmbedding,
      match_count:     TOP_K,
      match_threshold: SIMILARITY_THRESHOLD,
      filter_brand:    null,
      filter_tag:      null,
    });
    if (error) { console.error('[RAG] RPC error:', error.message); return []; }
    return (data || []).map(row => ({
      id:         row.id,
      title:      row.title,
      content:    row.content,
      brand:      row.brand,
      tags:       row.tags || [],
      similarity: row.similarity || 0,
    }));
  } catch (err) {
    console.error('[RAG] retrieve error:', err.message);
    return [];
  }
}

// ── 3. FILTER + RANK ──────────────────────────────────────────────────────────
function rankAndFilter(chunks, queryMeta) {
  return chunks
    .filter(c => c.similarity >= SIMILARITY_THRESHOLD)
    .map(c => {
      let boost = 0;
      if (queryMeta.brand && c.brand &&
          c.brand.toLowerCase() === queryMeta.brand.toLowerCase()) boost += 0.10;
      return Object.assign({}, c, { score: Math.min(1, c.similarity + boost) });
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, CONTEXT_K);
}

// ── 4. AUGMENT ────────────────────────────────────────────────────────────────
function buildSystemPrompt(chunks) {
  const today = new Date().toLocaleDateString('pt-BR');

  const lines = [
    'Voce e o assistente tecnico senior da Belenergy, especializado em inversores solares e BESS.',
    'Data: ' + today,
    '',
    'REGRAS ABSOLUTAS:',
    '1. Use SOMENTE o conteudo das solucoes verificadas abaixo. ZERO conhecimento externo.',
    '2. NAO invente fabricantes, modelos, codigos de erro, valores ou procedimentos.',
    '3. Se a solucao nao cobrir a pergunta: escreva "informacao nao disponivel na base".',
    '4. NAO elabore alem do que esta escrito. Reestruture - nao crie.',
    '5. Cite sempre: "conforme Solucao 1", "de acordo com Solucao 2", etc.',
    '6. Responda em Portugues, formato Markdown.',
    '',
    '=== SOLUCOES VERIFICADAS ===',
  ];

  chunks.forEach(function(c, i) {
    var snippet = (c.content || '');
    if (snippet.length > MAX_SNIPPET) snippet = snippet.slice(0, MAX_SNIPPET) + '...';
    var pct = Math.round((c.score || 0) * 100);
    lines.push('--- SOLUCAO ' + (i + 1) + ' (relevancia: ' + pct + '%) ---');
    lines.push('Titulo: ' + c.title);
    lines.push('Marca: ' + (c.brand || 'Geral'));
    lines.push('Conteudo:');
    lines.push(snippet);
    lines.push('');
  });

  lines.push('=== FIM DAS SOLUCOES — NAO USE NADA ALEM DESTE BLOCO ===',
    'LEMBRETE: Apenas o que esta escrito acima pode ser usado na resposta.',
    '');
  lines.push('');
  lines.push('TEMPLATE DE RESPOSTA:');
  lines.push('## Diagnostico Tecnico');
  lines.push('[Analise baseada nas solucoes - cite a fonte]');
  lines.push('');
  lines.push('## Procedimento de Resolucao');
  lines.push('[Passos EXATOS das solucoes - nao adicione]');
  lines.push('');
  lines.push('## Resposta para o Cliente');
  lines.push('[Resumo em linguagem acessivel]');
  lines.push('');
  lines.push('## Fonte');
  lines.push('[Titulos das solucoes utilizadas]');

  return lines.join('\n');
}

// ── 5. GENERATE ───────────────────────────────────────────────────────────────
async function callGroq(systemPrompt, userQuery) {
  var key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY nao configurada');

  var fetch = function() {
    return import('node-fetch').then(function(m) {
      return m.default.apply(null, arguments);
    });
  };

  var res = await (await import('node-fetch')).default(GROQ_URL, {
    method:  'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:       GROQ_MODEL,
      max_tokens:  1200,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userQuery },
      ],
    }),
  });

  if (!res.ok) {
    var txt = await res.text();
    throw new Error('Groq ' + res.status + ': ' + txt.slice(0, 200));
  }

  var data = await res.json();
  return {
    text:       (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '',
    tokensUsed: (data.usage && data.usage.total_tokens) || 0,
  };
}

// ── ragQuery ──────────────────────────────────────────────────────────────────
async function ragQuery(query, opts) {
  opts = opts || {};
  var t0 = Date.now();

  var vec = await embed(query);
  var rawChunks = vec ? await retrieveChunks(vec) : [];
  var queryMeta = { brand: opts.brand || opts.fabricante || '' };
  var topChunks = rankAndFilter(rawChunks, queryMeta);
  var topScore  = topChunks.length > 0 ? topChunks[0].score : 0;
  var isFallback = topChunks.length === 0 || topScore < FALLBACK_THRESHOLD;

  var answer, tokensUsed = 0;

  if (isFallback) {
    var brand = opts.brand || opts.fabricante || '';
    var fallbackLines = [
      '## Nenhuma solucao verificada encontrada',
      '',
      brand
        ? 'Nao ha solucoes indexadas para **' + brand + '** com relevancia suficiente.'
        : 'Nao ha solucoes indexadas com relevancia suficiente para esta consulta.',
      '',
      '**O que fazer:**',
      '- Verifique se ha solucoes no Centro de Solucoes para este fabricante.',
      '- Use **Reindexar** (admin) para gerar embeddings das solucoes existentes.',
      '- Adicione uma nova solucao tecnica para este problema.',
      '',
      '_Resposta nao gerada por IA para evitar informacoes incorretas._',
    ];
    answer = fallbackLines.join('\n');
    console.log('[RAG] fallback — score=' + topScore.toFixed(2) + ' chunks=' + topChunks.length);
  } else {
    var systemPrompt = buildSystemPrompt(topChunks);
    var result = await callGroq(systemPrompt, query);
    answer     = result.text;
    tokensUsed = result.tokensUsed;
  }

  var elapsed = Date.now() - t0;
  console.log('[RAG] ' + elapsed + 'ms | chunks=' + topChunks.length + ' score=' + topScore.toFixed(2) + ' tokens=' + tokensUsed + ' fallback=' + isFallback);

  return {
    answer:     answer,
    sources:    topChunks.map(function(c) {
      return { id: c.id, title: c.title, brand: c.brand, score: parseFloat(c.score.toFixed(3)) };
    }),
    fallback:   isFallback,
    similarity: topScore,
    tokensUsed: tokensUsed,
    elapsedMs:  elapsed,
  };
}

// ── buildQuery ────────────────────────────────────────────────────────────────
function buildQuery(ticketData) {
  ticketData = ticketData || {};
  var parts = [];
  if (ticketData.relato)      parts.push('Problema: ' + ticketData.relato);
  if (ticketData.fabricante)  parts.push('Fabricante: ' + ticketData.fabricante);
  if (ticketData.modelo)      parts.push('Modelo: ' + ticketData.modelo);
  if (ticketData.categoria)   parts.push('Tipo: ' + ticketData.categoria);
  if (ticketData.sn)          parts.push('SN: ' + ticketData.sn);
  if (ticketData.alarmCode)   parts.push('Alarme: ' + ticketData.alarmCode);
  if (ticketData.ocrText)     parts.push('Etiqueta: ' + ticketData.ocrText);
  if (ticketData.userMessage) parts.push(ticketData.userMessage);
  return parts.join('. ');
}

module.exports = { ragQuery, buildQuery, embed, SIMILARITY_THRESHOLD, FALLBACK_THRESHOLD };

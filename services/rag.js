'use strict';
/**
 * services/rag.js — Retrieval Augmented Generation Pipeline v303
 *
 * Hot Tier  (pgvector):   Primary search. Verified solutions with embeddings.
 *                          Threshold: configurable, default 0.72
 * Cold Tier (tsvector):   Fallback. Full-text search across all solutions.
 *                          Triggered when Hot returns zero results.
 * Janitor:                 Pre-processes all queries before embedding.
 *                          Logs fallbacks to pending_curation for review.
 */

const http = require('http');
const { supabaseAdmin } = require('./db');

const OLLAMA_URL   = process.env.OLLAMA_URL  || 'http://localhost:11434';
const EMBED_MODEL  = process.env.EMBED_MODEL || 'nomic-embed-text';
const IS_CLOUD     = process.env.CLOUD_MODE === 'true';
const GROQ_URL     = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL   = 'llama-3.1-8b-instant';
const GEMINI_EMBED = 'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent';

// ── Thresholds ────────────────────────────────────────────────────────────────
const HOT_THRESHOLD      = parseFloat(process.env.RAG_HOT_THRESHOLD  || '0.72'); // high-confidence
const COLD_THRESHOLD     = parseFloat(process.env.RAG_COLD_THRESHOLD || '0.20'); // accept from cold tier
const FALLBACK_THRESHOLD = parseFloat(process.env.RAG_FALLBACK_THRESHOLD || '0.25'); // below = no answer
const TOP_K_RETRIEVE     = 7;   // retrieve more candidates
const TOP_K_CONTEXT      = 3;   // inject top-3 into prompt (no context noise)
const MAX_SNIPPET        = 800;

// ── 1. Embeddings ─────────────────────────────────────────────────────────────
async function embedGemini(text) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const fetch = (await import('node-fetch')).default;
    const res = await fetch(GEMINI_EMBED + '?key=' + key, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'models/text-embedding-004', content: { parts: [{ text: text.slice(0, 2000) }] } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const v = data?.embedding?.values;
    return v && v.length === 768 ? v : null;
  } catch { return null; }
}

async function embedOllama(text) {
  const body = JSON.stringify({ model: EMBED_MODEL, prompt: text });
  return new Promise((resolve) => {
    const url = new URL('/api/embeddings', OLLAMA_URL);
    const req = http.request({
      hostname: url.hostname, port: parseInt(url.port) || 11434,
      path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw).embedding || null); } catch { resolve(null); } });
    });
    req.setTimeout(20_000, () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.write(body); req.end();
  });
}

async function embed(text) {
  if (IS_CLOUD) {
    const v = await embedGemini(text);
    return v || await embedOllama(text);
  }
  const v = await embedOllama(text);
  return v || await embedGemini(text);
}

// ── 2. Hot Tier — pgvector ────────────────────────────────────────────────────
async function hotSearch(queryEmbedding, opts) {
  opts = opts || {};
  const threshold = opts.threshold || HOT_THRESHOLD;
  if (!queryEmbedding) return [];
  try {
    const { data, error } = await supabaseAdmin.rpc('match_solutions', {
      query_embedding: queryEmbedding,
      match_count:     TOP_K_RETRIEVE,
      match_threshold: COLD_THRESHOLD, // retrieve broadly, filter below
      filter_brand:    null,
      filter_tag:      null,
    });
    if (error) { console.error('[RAG] Hot search error:', error.message); return []; }
    return (data || []).map(r => ({
      id: r.id, title: r.title, content: r.content,
      brand: r.brand, tags: r.tags || [],
      similarity: r.similarity || 0, source: 'hot',
    }));
  } catch (err) { console.error('[RAG] Hot search exception:', err.message); return []; }
}

// ── 3. Rank + filter ──────────────────────────────────────────────────────────
function rankChunks(chunks, queryMeta) {
  queryMeta = queryMeta || {};
  return chunks
    .filter(c => c.similarity >= COLD_THRESHOLD)
    .map(c => {
      let boost = 0;
      const brand = (queryMeta.brand || '').toLowerCase();
      if (brand && c.brand && c.brand.toLowerCase() === brand) boost += 0.15;
      if (c.source === 'hot') boost += 0.05; // slight preference for hot tier
      return Object.assign({}, c, { score: Math.min(1, c.similarity + boost) });
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K_CONTEXT);
}

// ── 4. System prompt — grounded, cites sources ────────────────────────────────
function buildSystemPrompt(chunks) {
  const today = new Date().toLocaleDateString('pt-BR');
  const blocks = chunks.map((c, i) => {
    const tier   = c.source === 'hot' ? '🔥 HOT' : '❄️ COLD';
    const pct    = Math.round((c.score || 0) * 100);
    const snip   = (c.content || '').slice(0, MAX_SNIPPET);
    return [
      `╔═ SOLUCAO ${i+1} [${tier} | relevancia: ${pct}%] ═══`,
      `ID: ${c.id} | Titulo: "${c.title}"`,
      `Marca: ${c.brand || 'Geral'}`,
      `─────────────────────────────────────────`,
      snip,
      `╚═══════════════════════════════════════`,
    ].join('\n');
  }).join('\n\n');

  return [
    `Voce e o assistente tecnico da Belenergy. Data: ${today}`,
    ``,
    `INSTRUCOES ABSOLUTAS:`,
    `1. Use EXCLUSIVAMENTE o conteudo das solucoes abaixo. Zero conhecimento externo.`,
    `2. Em cada afirmacao tecnica, cite o ID da solucao: "(ver Solucao 1)", "(ver Solucao 2)".`,
    `3. NAO invente fabricantes, codigos de erro, valores ou passos que nao estejam nas solucoes.`,
    `4. Se a solucao nao cobrir completamente: cite o que tiver e adicione`,
    `   "⚠️ Informacao parcial — consulte o fabricante para detalhes adicionais."`,
    `5. Solucoes marcadas ❄️ COLD vem de busca textual — prefira as 🔥 HOT quando disponiveis.`,
    ``,
    `=== SOLUCOES VERIFICADAS ===`,
    blocks,
    `=== FIM — USE APENAS O QUE ESTA ACIMA ===`,
    ``,
    `FORMATO OBRIGATORIO (nao adicione secoes extras):`,
    `## Diagnóstico`,
    `[Copie a causa da solucao — cite "(ver Solucao N)". Se nao houver causa: "Causa nao especificada na solucao."]`,
    ``,
    `## Procedimento`,
    `[Copie os passos EXATAMENTE como estao na solucao. Numere. Nao parafraseie.]`,
    ``,
    `## Observações`,
    `[Copie as observacoes da solucao. Se nao houver: OMITA esta secao completamente.]`,
    ``,
    `## Fonte`,
    `[Nome da solucao utilizada]`,
    ``,
    `LANGUAGE RULE: Detect the language of the user's query and respond in that same language.`,
    `If query is in English → answer in English. Se a query for em Português → responder em Português.`,
    `Brand names (Hoymiles, Deye, Huawei, Sungrow, etc.) stay unchanged regardless of language.`,
    ``,
    `REGRA FINAL / FINAL RULE:`,
    `If you cannot find the information in the solutions above, write ONLY:`,
    `"⚠️ Esta informação não consta nas soluções cadastradas. Consulte o fabricante." (PT)`,
    `or "⚠️ This information is not in the registered solutions. Please consult the manufacturer." (EN)`,
    `NEVER add content not present in the solutions above.`,
  ].join('\n');
}

// ── 5. Groq call ──────────────────────────────────────────────────────────────
async function callGroq(system, user) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY nao configurada');
  const fetch = (await import('node-fetch')).default;
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL, max_tokens: 1400, temperature: 0.1,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) { const t = await res.text(); throw new Error('Groq ' + res.status + ': ' + t.slice(0, 150)); }
  const data = await res.json();
  return { text: data.choices?.[0]?.message?.content || '', tokens: data.usage?.total_tokens || 0 };
}


// ── Text Search Tier — Solution Centre (no embeddings needed) ─────────────────
// Searches solutions table by keywords in title + content + brand + tags.
// Bilingual: works with English and Portuguese queries.
// This ensures Solution Centre is ALWAYS searched even before Reindexar runs.
async function textSearchSolutions(query, opts) {
  opts = opts || {};
  try {
    // Build search terms from query
    const terms = query.toLowerCase()
      .replace(/[^a-z0-9àáâãéêíóôõúüç\s]/gi, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 3)
      .slice(0, 8); // max 8 terms

    if (!terms.length) return [];

    // Fetch solutions and score them in JS (avoids needing tsvector migration)
    const { data, error } = await supabaseAdmin
      .from('solutions')
      .select('id, title, content, brand, tags, author_name')
      .order('id', { ascending: false })
      .limit(200);

    if (error || !data?.length) return [];

    const brand = (opts.brand || '').toLowerCase();

    return data
      .map(sol => {
        const haystack = [
          sol.title   || '',
          sol.content || '',
          sol.brand   || '',
          (sol.tags   || []).join(' '),
        ].join(' ').toLowerCase();

        let score = 0;
        let termHits = 0;
        for (const term of terms) {
          if (haystack.includes(term)) {
            termHits++;
            // Title matches score higher
            if ((sol.title || '').toLowerCase().includes(term)) score += 4;
            // Brand match scores high
            else if ((sol.brand || '').toLowerCase().includes(term)) score += 3;
            // Tags match
            else if ((sol.tags || []).some(t => t.toLowerCase().includes(term))) score += 2;
            else score += 1;
          }
        }

        // Require at least 1 term hit
        if (termHits === 0) return null;

        // Brand boost
        if (brand && (sol.brand || '').toLowerCase() === brand) score += 5;

        // Normalize to similarity-like score (0.30 - 0.68 range — below hot threshold)
        const normalized = Math.min(0.68, 0.30 + (score / (terms.length * 5)));

        return {
          id:         sol.id,
          title:      sol.title,
          content:    (sol.content || '').slice(0, 800),
          brand:      sol.brand,
          tags:       sol.tags || [],
          similarity: normalized,
          source:     'text',
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, opts.topK || 5);
  } catch (err) {
    console.warn('[RAG] Text search error:', err.message);
    return [];
  }
}


// ── Alarm Knowledge Tier — indexed manual alarm codes ─────────────────────────
// Searches alarm_knowledge table populated by the manual indexer.
// Tiny footprint: only codes + brief descriptions, no full manual content.
async function alarmKnowledgeSearch(query, opts) {
  opts = opts || {};
  try {
    const terms = query.toLowerCase()
      .replace(/[^a-z0-9\s]/gi, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2)
      .slice(0, 8);

    if (!terms.length) return [];

    // Brand filter if detected
    const brand = opts.brand;
    let q = supabaseAdmin
      .from('alarm_knowledge')
      .select('id, fabricante, code, description, cause, solution, severity, source_file')
      .limit(150);

    if (brand) q = q.ilike('fabricante', `%${brand}%`);

    const { data, error } = await q;
    if (error || !data?.length) return [];

    return data
      .map(row => {
        const haystack = [row.code, row.fabricante, row.description, row.cause, row.solution]
          .join(' ').toLowerCase();
        let score = 0;
        for (const t of terms) {
          if (row.code?.toLowerCase() === t) score += 10; // exact code match
          else if (row.code?.toLowerCase().includes(t)) score += 5;
          else if (haystack.includes(t)) score += 1;
        }
        if (!score) return null;
        if (brand && row.fabricante?.toLowerCase() === brand.toLowerCase()) score += 4;

        const normalized = Math.min(0.69, 0.35 + score / 15);
        return {
          id:         'alarm_' + row.id,
          title:      `${row.code ? row.code + ' — ' : ''}${row.description}`,
          content:    [
            row.cause    && '**Causa:** ' + row.cause,
            row.solution && '**Solução:** ' + row.solution,
            row.source_file && `*Fonte: ${row.source_file}*`,
          ].filter(Boolean).join('\n'),
          brand:      row.fabricante,
          tags:       [row.fabricante?.toLowerCase(), row.code, 'alarme'].filter(Boolean),
          similarity: normalized,
          source:     'alarm',
          severity:   row.severity,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, opts.topK || 5);
  } catch (err) {
    console.warn('[RAG] Alarm knowledge search error:', err.message);
    return [];
  }
}

// ── MAIN: ragQuery ────────────────────────────────────────────────────────────
async function ragQuery(rawQuery, opts) {
  opts = opts || {};
  const t0 = Date.now();

  // ── Step 1: Pre-process via Janitor ──────────────────────────────────────
  const janitor = require('./janitor');
  const queryInfo = await janitor.preprocessQuery(rawQuery, { brand: opts.brand || opts.fabricante });
  const searchQuery = queryInfo.expanded || queryInfo.normalized || rawQuery;
  const brand       = queryInfo.brand || opts.brand || opts.fabricante || '';

  if (searchQuery !== rawQuery) {
    console.log('[RAG] Pre-processed:', JSON.stringify(rawQuery.slice(0, 60)), '→', JSON.stringify(searchQuery.slice(0, 60)));
  }

  // ── Step 2: Embed ─────────────────────────────────────────────────────────
  const vec = await embed(searchQuery);
  if (!vec) console.warn('[RAG] Embedding failed — both Gemini and Ollama offline');

  // ── Step 3: Hot tier — pgvector (Solution Centre with embeddings) ───────────
  const hotChunks         = vec ? await hotSearch(vec) : [];
  const hotAboveThreshold = hotChunks.filter(c => c.similarity >= HOT_THRESHOLD);

  let allChunks = [...hotChunks];
  let usedText  = false;
  let usedCold  = false;

  // ── Step 4: Text Search tier — Solution Centre (always, no embeddings needed)
  // Runs when hot tier finds nothing above threshold OR embeddings not available.
  // This is the PRIORITY fallback — searches the same solutions table by keywords.
  if (hotAboveThreshold.length === 0) {
    console.log('[RAG] Hot tier below threshold — searching Solution Centre by text');
    const textChunks = await textSearchSolutions(searchQuery, {
      topK: TOP_K_RETRIEVE,
      brand: brand || null,
    });
    if (textChunks.length > 0) {
      // Merge: hot results + text results (deduplicate by id)
      const seenIds = new Set(hotChunks.map(c => String(c.id)));
      const newTextChunks = textChunks.filter(c => !seenIds.has(String(c.id)));
      allChunks = hotChunks.concat(newTextChunks);
      usedText  = true;
      console.log('[RAG] Text search found', newTextChunks.length, 'Solution Centre entries');
    }
  }

  // ── Step 5: Alarm Knowledge tier — indexed manual alarm codes ───────────────
  // Searches alarm_knowledge table (populated by Drive manual indexer).
  const alarmChunks = await alarmKnowledgeSearch(searchQuery, { brand, topK: 5 });
  if (alarmChunks.length > 0) {
    const seenIds = new Set(allChunks.map(c => String(c.id)));
    allChunks = allChunks.concat(alarmChunks.filter(c => !seenIds.has(String(c.id))));
    console.log('[RAG] Alarm KB found', alarmChunks.length, 'entries');
  }

  // ── Step 6: Cold tier — GitHub JSON (historical knowledge base) ───────────
  // Only runs if BOTH hot AND text search found nothing useful.
  const bestSoFar = allChunks.filter(c => c.similarity >= FALLBACK_THRESHOLD);
  if (bestSoFar.length === 0) {
    console.log('[RAG] Solution Centre empty — trying cold tier (GitHub JSON)');
    const cold = await janitor.coldSearch(searchQuery, { topK: TOP_K_RETRIEVE, brand: brand || null });
    if (cold.chunks.length > 0) {
      allChunks = allChunks.concat(cold.chunks);
      usedCold  = true;
    }
  }

  // ── Step 7: Rank ──────────────────────────────────────────────────────────
  const topChunks = rankChunks(allChunks, { brand });
  const topScore  = topChunks.length > 0 ? topChunks[0].score : 0;
  const isFallback = topChunks.length === 0 || topScore < FALLBACK_THRESHOLD;

  console.log(
    '[RAG]', Date.now() - t0 + 'ms |',
    'hot=' + hotChunks.length,
    'text=' + (usedText ? 'yes' : 'no'),
    'cold=' + (usedCold ? 'yes' : 'no'),
    'top=' + topChunks.length,
    'score=' + topScore.toFixed(2),
    'fallback=' + isFallback
  );

  // ── Step 6: Log fallback for curation ────────────────────────────────────
  if (isFallback) {
    await janitor.logFallback(
      { original: rawQuery, expanded: searchQuery, brand },
      { topScore, source: opts.source || 'rag', userId: opts.userId }
    );
  }

  // ── Step 7: Generate ──────────────────────────────────────────────────────
  let answer, tokensUsed = 0;

  if (isFallback) {
    answer = [
      '## Nenhuma solução verificada encontrada',
      '',
      brand
        ? `Não encontrei soluções no Centro de Soluções para **${brand}**.`
        : 'Não encontrei soluções cadastradas no Centro de Soluções para esta consulta.',
      '',
      '**O que fazer:**',
      '- Adicione uma solução para este problema no **Centro de Soluções**.',
      '- Se já há soluções: clique em **Reindexar** no AI Obs para gerar embeddings.',
      '- Sua consulta foi salva em **Curadoria Pendente** para revisão.',
      '',
      '_Resposta não gerada por IA — consulta registrada para revisão._',
    ].join('\n');
  } else {
    const systemPrompt = buildSystemPrompt(topChunks);
    try {
      const result = await callGroq(systemPrompt, searchQuery);
      answer     = result.text;
      tokensUsed = result.tokens;
    } catch (err) {
      console.error('[RAG] Groq error:', err.message);
      throw err;
    }
  }

  return {
    answer,
    sources:       topChunks.map(c => ({ id: c.id, title: c.title, brand: c.brand, score: parseFloat(c.score.toFixed(3)), tier: c.source })),
    fallback:      isFallback,
    similarity:    topScore,
    usedTextTier:  usedText,
    usedColdTier:  usedCold,
    tokensUsed,
    elapsedMs:     Date.now() - t0,
    queryExpanded: searchQuery !== rawQuery ? searchQuery : undefined,
  };
}

function buildQuery(ticketData) {
  ticketData = ticketData || {};
  const parts = [];
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

module.exports = { ragQuery, buildQuery, embed, HOT_THRESHOLD, FALLBACK_THRESHOLD };

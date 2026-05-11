'use strict';
/**
 * services/ai-provider.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AI Provider Abstraction Layer
 * Primary: Groq (llama-3.1-8b-instant) — ultra-fast
 * Fallback: Gemini (gemini-1.5-flash)  — reliable, large context
 *
 * Every call is logged to ai_requests table for observability.
 * Usage:
 *   const { ask, providers } = require('./ai-provider');
 *   const result = await ask({ system, user, feature, userId, voice });
 */

const { supabaseAdmin } = require('./db');

const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

const GROQ_MODEL   = 'llama-3.1-8b-instant';
const GEMINI_MODEL = 'gemini-1.5-flash';

// Timeouts
const GROQ_TIMEOUT_MS   = 12_000;
const GEMINI_TIMEOUT_MS = 30_000;

// ── fetch with timeout ────────────────────────────────────────────────────────
async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await (await import('node-fetch')).default(url, { ...opts, signal: ctrl.signal });
    clearTimeout(tid);
    return res;
  } catch (err) {
    clearTimeout(tid);
    throw err;
  }
}

// ── Groq call ─────────────────────────────────────────────────────────────────
async function callGroq(system, user, maxTokens) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY not set');

  const t0  = Date.now();
  const res = await fetchWithTimeout(GROQ_URL, {
    method:  'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:       GROQ_MODEL,
      max_tokens:  maxTokens || 1200,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user   },
      ],
    }),
  }, GROQ_TIMEOUT_MS);

  if (res.status === 429) throw Object.assign(new Error('rate_limit'), { code: 'rate_limit' });
  if (!res.ok) {
    const txt = await res.text();
    throw Object.assign(new Error('api_error: ' + txt.slice(0, 120)), { code: 'api_error' });
  }

  const data = await res.json();
  return {
    text:      data.choices?.[0]?.message?.content || '',
    tokens:    data.usage?.total_tokens || 0,
    latencyMs: Date.now() - t0,
    provider:  'groq',
    model:     GROQ_MODEL,
  };
}

// ── Gemini call ───────────────────────────────────────────────────────────────
async function callGemini(system, user, maxTokens) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not set');

  const t0  = Date.now();
  const res = await fetchWithTimeout(`${GEMINI_URL}?key=${key}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{ text: system + '\n\n' + user }],
      }],
      generationConfig: {
        maxOutputTokens: maxTokens || 1200,
        temperature:     0.2,
      },
    }),
  }, GEMINI_TIMEOUT_MS);

  if (!res.ok) {
    const txt = await res.text();
    throw Object.assign(new Error('gemini_error: ' + txt.slice(0, 120)), { code: 'api_error' });
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const tokens = (data.usageMetadata?.totalTokenCount) || Math.round(text.length / 4);

  return {
    text,
    tokens,
    latencyMs: Date.now() - t0,
    provider:  'gemini',
    model:     GEMINI_MODEL,
  };
}

// ── Log to DB (non-fatal) ─────────────────────────────────────────────────────
async function logRequest(entry) {
  try {
    await supabaseAdmin.from('ai_requests').insert([{
      user_id:        entry.userId,
      session_id:     entry.sessionId,
      provider:       entry.provider,
      model:          entry.model,
      fallback_from:  entry.fallbackFrom  || null,
      fallback_reason:entry.fallbackReason || null,
      feature:        entry.feature       || 'unknown',
      query_preview:  entry.query         ? entry.query.slice(0, 120) : null,
      voice:          entry.voice         || false,
      rag_chunks:     entry.ragChunks     || 0,
      rag_top_score:  entry.ragTopScore   || null,
      rag_source:     entry.ragSource     || null,
      rag_fallback:   entry.ragFallback   || false,
      embed_ms:       entry.embedMs       || null,
      retrieve_ms:    entry.retrieveMs    || null,
      llm_ms:         entry.llmMs         || null,
      total_ms:       entry.totalMs       || null,
      status:         entry.status        || 'ok',
      tokens_est:     entry.tokens        || null,
      error_msg:      entry.error         ? entry.error.slice(0, 200) : null,
      created_at:     new Date(),
    }]);
  } catch (err) {
    console.error('[AI-OBS] Log failed:', err.message);
  }
}

// ── Main: ask() ───────────────────────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {string}  opts.system        - System prompt
 * @param {string}  opts.user          - User query
 * @param {string}  [opts.feature]     - 'solution_centre'|'analysis'|'voice'|'diagnose'
 * @param {string}  [opts.userId]      - For logging
 * @param {string}  [opts.sessionId]   - Voice conversation grouping
 * @param {boolean} [opts.voice]       - Is this a voice request?
 * @param {number}  [opts.maxTokens]   - Override max tokens
 * @param {object}  [opts.ragMeta]     - RAG metadata for logging
 * @returns {{ text, provider, model, tokens, latencyMs, fallback, fallbackReason }}
 */
async function ask(opts) {
  const t0 = Date.now();
  const { system, user, feature, userId, sessionId, voice, maxTokens, ragMeta } = opts;

  const logBase = {
    userId, sessionId, feature,
    query:       user,
    voice:       voice || false,
    ragChunks:   ragMeta?.chunks  || 0,
    ragTopScore: ragMeta?.topScore || null,
    ragSource:   ragMeta?.source  || null,
    ragFallback: ragMeta?.fallback || false,
    embedMs:     ragMeta?.embedMs  || null,
    retrieveMs:  ragMeta?.retrieveMs || null,
  };

  // ── Try Groq first ────────────────────────────────────────────────────────
  try {
    const result = await callGroq(system, user, maxTokens);
    const totalMs = Date.now() - t0;
    await logRequest({ ...logBase, ...result, llmMs: result.latencyMs, totalMs, status: 'ok' });
    console.log(`[AI] groq ${totalMs}ms ${result.tokens}tok ${feature || ''}`);
    return { ...result, fallback: false, fallbackReason: null };

  } catch (groqErr) {
    const fallbackReason = groqErr.code || (groqErr.name === 'AbortError' ? 'timeout' : 'api_error');
    console.warn(`[AI] Groq failed (${fallbackReason}) — trying Gemini`);

    // ── Fallback: Gemini ──────────────────────────────────────────────────
    try {
      const result = await callGemini(system, user, maxTokens);
      const totalMs = Date.now() - t0;
      await logRequest({
        ...logBase, ...result,
        fallbackFrom:   'groq',
        fallbackReason,
        llmMs:          result.latencyMs,
        totalMs,
        status:         'fallback',
      });
      console.log(`[AI] gemini fallback ${totalMs}ms ${result.tokens}tok reason=${fallbackReason}`);
      return { ...result, fallback: true, fallbackReason };

    } catch (geminiErr) {
      const totalMs = Date.now() - t0;
      await logRequest({
        ...logBase,
        provider:       'gemini',
        model:          GEMINI_MODEL,
        fallbackFrom:   'groq',
        fallbackReason,
        totalMs,
        status:         'error',
        error:          geminiErr.message,
      });
      console.error(`[AI] Both providers failed. Groq: ${groqErr.message} | Gemini: ${geminiErr.message}`);
      throw new Error('AI unavailable: ' + geminiErr.message);
    }
  }
}

// ── Provider health check ─────────────────────────────────────────────────────
async function checkHealth() {
  const health = { groq: 'unknown', gemini: 'unknown', checkedAt: new Date().toISOString() };

  // Check Groq
  try {
    const t0 = Date.now();
    const result = await callGroq('You are a test assistant.', 'Reply: OK', 5);
    health.groq = { status: 'ok', latencyMs: Date.now() - t0, model: GROQ_MODEL };
  } catch (err) {
    health.groq = { status: 'error', error: err.message.slice(0, 80) };
  }

  // Check Gemini
  try {
    const t0 = Date.now();
    const result = await callGemini('You are a test assistant.', 'Reply: OK', 5);
    health.gemini = { status: 'ok', latencyMs: Date.now() - t0, model: GEMINI_MODEL };
  } catch (err) {
    health.gemini = { status: 'error', error: err.message.slice(0, 80) };
  }

  return health;
}

module.exports = { ask, checkHealth, logRequest, GROQ_MODEL, GEMINI_MODEL };

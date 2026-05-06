// services/embeddings.js
//
// Generates 768-dim embeddings using Ollama (nomic-embed-text).
// Ollama is already installed for vision (moondream).
// Pull the model once: ollama pull nomic-embed-text
//
// Falls back gracefully if Ollama is unavailable.

'use strict';

const http = require('http');

const OLLAMA_URL   = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBED_MODEL  = process.env.EMBED_MODEL || 'nomic-embed-text';

/**
 * Generate a single embedding vector for text.
 * @param {string} text
 * @returns {Promise<number[]>} 768-dim float array, or null on failure
 */
async function embed(text) {
  const body = JSON.stringify({ model: EMBED_MODEL, prompt: text });

  return new Promise((resolve) => {
    const url  = new URL('/api/embeddings', OLLAMA_URL);
    const req  = http.request({
      hostname: url.hostname,
      port:     parseInt(url.port) || 11434,
      path:     url.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          resolve(parsed.embedding || null);
        } catch {
          resolve(null);
        }
      });
    });

    req.setTimeout(30_000, () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

/**
 * Embed multiple texts in parallel (max 5 concurrent).
 */
async function embedBatch(texts) {
  const results = [];
  for (let i = 0; i < texts.length; i += 5) {
    const batch = texts.slice(i, i + 5);
    const vecs  = await Promise.all(batch.map(embed));
    results.push(...vecs);
  }
  return results;
}

module.exports = { embed, embedBatch };

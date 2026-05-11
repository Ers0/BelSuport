// src/hooks/useRag.js
// ──────────────────────────────────────────────────────────────────────────────
// Hook React para o pipeline RAG — usado no SolutionCentre e no Registro.
//
// Usage:
//   const { ask, answer, sources, fallback, loading, error, similarity } = useRag();
//   await ask({ userMessage: 'F01 no Deye', fabricante: 'Deye', modelo: 'SUN-12K' });
// ──────────────────────────────────────────────────────────────────────────────

import { useState, useCallback } from 'react';
import api from '../api';

// Componentes de renderização de markdown simples (sem dependência externa)
// Suporta: ## headers, **bold**, `code`, listas com -, parágrafos
function renderMarkdown(text) {
  if (!text) return null;

  const lines = text.split('\n');
  const elements = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // H2
    if (line.startsWith('## ')) {
      elements.push(
        <h3 key={key++} style={{ color: 'var(--y)', fontSize: 13, fontWeight: 700,
          marginTop: 14, marginBottom: 6, borderBottom: '1px solid var(--b1)', paddingBottom: 4 }}>
          {line.slice(3)}
        </h3>
      );
      continue;
    }

    // H3
    if (line.startsWith('### ')) {
      elements.push(
        <h4 key={key++} style={{ color: 'var(--bl)', fontSize: 12, fontWeight: 700, marginTop: 10, marginBottom: 4 }}>
          {line.slice(4)}
        </h4>
      );
      continue;
    }

    // Lista
    if (line.match(/^[-*•]\s/)) {
      elements.push(
        <div key={key++} style={{ display: 'flex', gap: 6, marginBottom: 3, paddingLeft: 8 }}>
          <span style={{ color: 'var(--y)', flexShrink: 0, marginTop: 1 }}>•</span>
          <span style={{ color: 'var(--ts)', fontSize: 12, lineHeight: 1.5 }}>
            {inlineFormat(line.slice(2))}
          </span>
        </div>
      );
      continue;
    }

    // Lista numerada
    if (line.match(/^\d+\.\s/)) {
      const num = line.match(/^(\d+)\./)[1];
      elements.push(
        <div key={key++} style={{ display: 'flex', gap: 8, marginBottom: 4, paddingLeft: 8 }}>
          <span style={{ color: 'var(--y)', fontWeight: 700, minWidth: 18, fontSize: 12 }}>{num}.</span>
          <span style={{ color: 'var(--ts)', fontSize: 12, lineHeight: 1.5 }}>
            {inlineFormat(line.replace(/^\d+\.\s/, ''))}
          </span>
        </div>
      );
      continue;
    }

    // Linha em branco = espaçamento
    if (!line.trim()) {
      elements.push(<div key={key++} style={{ height: 6 }} />);
      continue;
    }

    // Parágrafo normal
    elements.push(
      <p key={key++} style={{ color: 'var(--ts)', fontSize: 12, lineHeight: 1.6, margin: '0 0 6px' }}>
        {inlineFormat(line)}
      </p>
    );
  }

  return elements;
}

// Formatação inline: **bold**, `code`, _italic_
function inlineFormat(text) {
  const parts = [];
  let rest = text;
  let k = 0;

  // Bold
  rest = rest.replace(/\*\*(.+?)\*\*/g, (_, m) =>
    `__BOLD_${k++}__${m}__END__`
  );

  const segments = rest.split(/(__BOLD_\d+__)(.+?)(__END__)/g);

  let isBold = false;
  return segments.map((seg, i) => {
    if (seg.startsWith('__BOLD_')) { isBold = true; return null; }
    if (seg === '__END__')         { isBold = false; return null; }
    if (!seg) return null;

    // Code inline
    if (seg.includes('`')) {
      return seg.split(/`(.+?)`/g).map((s, j) =>
        j % 2 === 1
          ? <code key={`${i}-${j}`} style={{ background: 'var(--s3)', color: '#7dd3fc',
              padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace', fontSize: 11 }}>{s}</code>
          : <span key={`${i}-${j}`} style={{ fontWeight: isBold ? 700 : 400 }}>{s}</span>
      );
    }

    return <span key={i} style={{ fontWeight: isBold ? 700 : 400 }}>{seg}</span>;
  }).filter(Boolean);
}

// ── Similarity badge ──────────────────────────────────────────────────────────
function SimilarityBadge({ score }) {
  const pct = Math.round(score * 100);
  const clr = pct >= 70 ? 'var(--gr)' : pct >= 45 ? 'var(--y)' : 'var(--or)';
  return (
    <span style={{ fontSize: 10, background: clr + '22', color: clr, border: `1px solid ${clr}44`,
      borderRadius: 6, padding: '1px 7px', fontWeight: 700 }}>
      {pct}% relevante
    </span>
  );
}

// ── Source chip ────────────────────────────────────────────────────────────────
function SourceChip({ source, onClick }) {
  return (
    <button
      onClick={() => onClick?.(source.id)}
      style={{ background: 'var(--s3)', border: '1px solid var(--b2)', color: 'var(--ts)',
        borderRadius: 8, padding: '3px 10px', fontSize: 10, cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 5 }}>
      📄 {source.title.length > 35 ? source.title.slice(0, 35) + '…' : source.title}
      <SimilarityBadge score={source.score} />
    </button>
  );
}

// ── useRag hook ───────────────────────────────────────────────────────────────
export function useRag() {
  const [answer,     setAnswer]     = useState('');
  const [sources,    setSources]    = useState([]);
  const [fallback,   setFallback]   = useState(false);
  const [similarity, setSimilarity] = useState(0);
  const [tokensUsed, setTokensUsed] = useState(0);
  const [elapsedMs,  setElapsedMs]  = useState(0);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');

  const ask = useCallback(async (params = {}) => {
    if (!params.userMessage && !params.relato && !params.alarmCode) return;

    setLoading(true);
    setError('');
    setAnswer('');
    setSources([]);
    setFallback(false);

    try {
      const result = await api('/api/analysis/rag', {
        method: 'POST',
        body: JSON.stringify(params),
      });

      if (!result) throw new Error('Sem resposta do servidor');

      setAnswer(result.answer     || '');
      setSources(result.sources   || []);
      setFallback(result.fallback ?? false);
      setSimilarity(result.similarity ?? 0);
      setTokensUsed(result.tokensUsed ?? 0);
      setElapsedMs(result.elapsedMs   ?? 0);

    } catch (err) {
      setError(err.message || 'Erro ao consultar o pipeline RAG');
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setAnswer(''); setSources([]); setFallback(false);
    setSimilarity(0); setError('');
  }, []);

  return { ask, reset, answer, sources, fallback, similarity, tokensUsed, elapsedMs, loading, error };
}

// ── RagBanner — componente completo para SolutionCentre ──────────────────────
// Substitui o AIBanner existente.
export function RagBanner({ fabricante, categoria, onViewSource }) {
  const { ask, reset, answer, sources, fallback, similarity, tokensUsed, elapsedMs, loading, error } = useRag();
  const [input, setInput] = React.useState('');

  function handleSubmit() {
    if (!input.trim()) return;
    ask({ userMessage: input.trim(), fabricante, categoria });
  }

  return (
    <div style={{ background: 'var(--s2)', border: '1px solid var(--b2)', borderRadius: 'var(--r)',
      padding: 16, marginBottom: 16 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 18 }}>🧠</span>
        <span style={{ color: 'var(--y)', fontWeight: 700, fontSize: 13 }}>
          Assistente Técnico Belenergy
        </span>
        <span style={{ fontSize: 10, color: 'var(--tm)', marginLeft: 'auto' }}>
          RAG v301 · Llama 3.1 · pgvector
        </span>
      </div>

      {/* Input */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSubmit()}
          placeholder={
            fabricante
              ? `Descreva o problema com ${fabricante}... (ex: alarme F01, sem comunicação)`
              : 'Descreva o problema técnico ou código de alarme...'
          }
          style={{ flex: 1, background: 'var(--s3)', border: '1px solid var(--b2)', color: 'var(--tx)',
            borderRadius: 'var(--rs)', padding: '8px 12px', fontSize: 12, fontFamily: 'inherit',
            outline: 'none' }}
        />
        <button
          onClick={handleSubmit}
          disabled={loading || !input.trim()}
          style={{ background: loading ? 'var(--s3)' : 'var(--y)', color: '#000',
            border: 'none', borderRadius: 'var(--rs)', padding: '8px 16px',
            fontWeight: 700, fontSize: 12, cursor: loading ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap', minWidth: 80 }}>
          {loading ? '⟳ Buscando...' : '🔍 Consultar'}
        </button>
        {(answer || error) && (
          <button onClick={reset} style={{ background: 'var(--s3)', border: '1px solid var(--b2)',
            color: 'var(--tm)', borderRadius: 'var(--rs)', padding: '8px 12px',
            fontSize: 11, cursor: 'pointer' }}>
            ✕
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--re)22',
          border: '1px solid var(--re)44', borderRadius: 'var(--rs)', color: 'var(--re)', fontSize: 12 }}>
          ⚠️ {error}
        </div>
      )}

      {/* Loading shimmer */}
      {loading && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[100, 80, 90, 60].map((w, i) => (
            <div key={i} style={{ height: 12, width: `${w}%`, background: 'var(--s3)',
              borderRadius: 4, animation: 'pulse 1.5s infinite', opacity: 0.6 }} />
          ))}
          <style>{`@keyframes pulse{0%,100%{opacity:.4}50%{opacity:.8}}`}</style>
        </div>
      )}

      {/* Answer */}
      {answer && !loading && (
        <div style={{ marginTop: 14 }}>

          {/* Fallback warning */}
          {fallback && (
            <div style={{ padding: '8px 12px', background: 'var(--or)18',
              border: '1px solid var(--or)44', borderRadius: 'var(--rs)',
              color: 'var(--or)', fontSize: 11, marginBottom: 10,
              display: 'flex', alignItems: 'center', gap: 6 }}>
              ⚠️ <b>Sem solução verificada na base.</b> Resposta baseada em conhecimento geral —
              verifique com o fabricante antes de aplicar.
            </div>
          )}

          {/* Answer content */}
          <div style={{ background: 'var(--s1)', border: '1px solid var(--b1)',
            borderRadius: 'var(--rs)', padding: '12px 14px', maxHeight: 400,
            overflowY: 'auto', lineHeight: 1.6 }}>
            {renderMarkdown(answer)}
          </div>

          {/* Sources */}
          {sources.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ color: 'var(--tm)', fontSize: 10, marginBottom: 6, fontWeight: 600,
                letterSpacing: '0.05em' }}>
                SOLUÇÕES UTILIZADAS
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {sources.map(s => (
                  <SourceChip key={s.id} source={s} onClick={onViewSource} />
                ))}
              </div>
            </div>
          )}

          {/* Meta */}
          <div style={{ display: 'flex', gap: 12, marginTop: 8, color: 'var(--tm)', fontSize: 10 }}>
            {!fallback && <SimilarityBadge score={similarity} />}
            <span>⚡ {elapsedMs}ms</span>
            <span>🔢 {tokensUsed} tokens</span>
            {sources.length > 0 && <span>📚 {sources.length} fonte(s)</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── RagDiagnosePanel — para uso no Registro/Diagnóstico ──────────────────────
// Componente compacto para diagnóstico direto a partir de dados do chamado.
export function RagDiagnosePanel({ ticketData, onClose }) {
  const { ask, answer, sources, fallback, similarity, loading, error } = useRag();
  const [alarmCode, setAlarmCode] = React.useState('');
  const [asked, setAsked] = React.useState(false);

  function handleDiagnose() {
    const params = {
      ...ticketData,
      alarmCode: alarmCode.trim() || undefined,
      userMessage: alarmCode.trim()
        ? `Código de alarme ${alarmCode} no ${ticketData?.fabricante || 'equipamento'}`
        : ticketData?.relato,
    };
    ask(params);
    setAsked(true);
  }

  return (
    <div style={{ background: 'var(--s2)', border: '1px solid var(--b2)', borderRadius: 'var(--r)', padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ color: 'var(--y)', fontWeight: 700, fontSize: 12 }}>🔬 Diagnóstico RAG</span>
        {onClose && <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--tm)',
          cursor:'pointer', fontSize:16 }}>✕</button>}
      </div>

      {ticketData?.fabricante && (
        <div style={{ color: 'var(--ts)', fontSize: 11, marginBottom: 8 }}>
          {ticketData.fabricante} {ticketData.modelo || ''} {ticketData.sn ? `· S/N: ${ticketData.sn}` : ''}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <input
          value={alarmCode}
          onChange={e => setAlarmCode(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleDiagnose()}
          placeholder="Código de alarme (ex: F01, Err-08)..."
          style={{ flex: 1, background: 'var(--s3)', border: '1px solid var(--b2)', color: 'var(--tx)',
            borderRadius: 'var(--rs)', padding: '7px 10px', fontSize: 11, fontFamily: 'inherit', outline: 'none' }}
        />
        <button
          onClick={handleDiagnose}
          disabled={loading}
          style={{ background: 'var(--y)', color: '#000', border: 'none', borderRadius: 'var(--rs)',
            padding: '7px 14px', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>
          {loading ? '⟳' : 'Diagnosticar'}
        </button>
      </div>

      {error && <div style={{ color: 'var(--re)', fontSize: 11, marginBottom: 8 }}>⚠️ {error}</div>}

      {loading && (
        <div style={{ color: 'var(--tm)', fontSize: 11, textAlign: 'center', padding: 12 }}>
          ⟳ Consultando base de conhecimento...
        </div>
      )}

      {asked && answer && !loading && (
        <div>
          {fallback && (
            <div style={{ color: 'var(--or)', fontSize: 10, marginBottom: 6, padding: '6px 8px',
              background: 'var(--or)18', borderRadius: 'var(--rs)' }}>
              ⚠️ Sem solução verificada — resposta baseada em conhecimento geral
            </div>
          )}
          <div style={{ background: 'var(--s1)', borderRadius: 'var(--rs)', padding: '10px 12px',
            maxHeight: 320, overflowY: 'auto', fontSize: 11, lineHeight: 1.6 }}>
            {renderMarkdown(answer)}
          </div>
          {sources.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
              {sources.map(s => (
                <span key={s.id} style={{ fontSize: 9, background: 'var(--s3)', color: 'var(--ts)',
                  borderRadius: 5, padding: '2px 7px', border: '1px solid var(--b1)' }}>
                  📄 {s.title.slice(0, 30)}
                </span>
              ))}
            </div>
          )}
          <div style={{ color: 'var(--tm)', fontSize: 9, marginTop: 6 }}>
            {!fallback && <SimilarityBadge score={similarity} />}
          </div>
        </div>
      )}
    </div>
  );
}

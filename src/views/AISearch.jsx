// src/views/AISearch.jsx
// AI Search tab — available to all users (techs + admins + master)
// RAG-powered, confidence meter, thumbs up/down feedback learning
import { useState, useRef, useCallback, useEffect } from 'react';
import { api } from '../api';

// ── Confidence meter ───────────────────────────────────────────────────────────
function ConfidenceMeter({ score, fallback }) {
  const pct   = Math.round((score || 0) * 100);
  const color = fallback     ? '#6B7694'
              : pct >= 70   ? '#22C55E'
              : pct >= 45   ? '#F59E0B'
              :                '#EF4444';
  const label = fallback     ? 'Sem resultado'
              : pct >= 70   ? 'Alta confiança'
              : pct >= 45   ? 'Confiança média'
              :                'Baixa confiança';

  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
      <div style={{ flex:1, height:6, background:'var(--b1)', borderRadius:99, overflow:'hidden' }}>
        <div style={{
          height:'100%', borderRadius:99, transition:'width .6s cubic-bezier(.4,0,.2,1)',
          width: fallback ? '0%' : pct + '%',
          background: `linear-gradient(90deg, ${color}99, ${color})`,
        }} />
      </div>
      <div style={{ fontSize:11, fontWeight:700, color, minWidth:110, textAlign:'right' }}>
        {fallback ? label : pct + '% — ' + label}
      </div>
    </div>
  );
}

// ── Source chips ──────────────────────────────────────────────────────────────
function SourceChips({ sources }) {
  if (!sources?.length) return null;
  const tierStyle = {
    hot:  { bg:'rgba(255,215,0,.1)',   color:'var(--y)',  border:'rgba(255,215,0,.25)',  icon:'🔥', label:'Centro de Soluções' },
    text: { bg:'rgba(34,197,94,.08)',  color:'var(--gr)', border:'rgba(34,197,94,.2)',   icon:'📚', label:'Centro de Soluções' },
    cold: { bg:'rgba(96,165,250,.1)',  color:'var(--bl)', border:'rgba(96,165,250,.2)',  icon:'❄️', label:'Base histórica' },
  };
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginBottom:10 }}>
      {sources.map((s, i) => {
        const t = tierStyle[s.tier] || tierStyle.cold;
        return (
          <span key={i} title={t.label} style={{
            fontSize:10, fontWeight:700, padding:'2px 9px', borderRadius:999,
            background: t.bg, color: t.color, border: `1px solid ${t.border}`,
          }}>
            {t.icon} {s.title}
            {s.score && <span style={{ opacity:.7 }}> · {Math.round(s.score * 100)}%</span>}
          </span>
        );
      })}
    </div>
  );
}

// ── Feedback buttons ──────────────────────────────────────────────────────────
function FeedbackBar({ result, query, onFeedback }) {
  const [voted, setVoted]       = useState(null); // null | 'up' | 'down'
  const [showNote, setShowNote] = useState(false);
  const [note, setNote]         = useState('');
  const [sending, setSending]   = useState(false);

  async function submit(helpful) {
    if (voted || sending) return;
    setSending(true);
    try {
      await api('/api/analysis/feedback', {
        method: 'POST',
        body: JSON.stringify({
          query,
          answer:     result.answer,
          helpful,
          sources:    result.sources,
          similarity: result.similarity,
          note:       note || null,
        }),
      });
      setVoted(helpful ? 'up' : 'down');
      if (!helpful) setShowNote(true);
      onFeedback?.(helpful);
    } finally { setSending(false); }
  }

  return (
    <div style={{ marginTop:12 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ fontSize:11, color:'var(--tm)' }}>Esta resposta foi útil?</span>
        <button onClick={() => submit(true)} disabled={!!voted} style={{
          padding:'4px 12px', border:`1px solid ${voted==='up'?'var(--gr)':'var(--b2)'}`,
          background: voted==='up' ? 'rgba(34,197,94,.12)' : 'var(--s2)',
          borderRadius:999, fontSize:13, cursor: voted ? 'default' : 'pointer',
          color: voted==='up' ? 'var(--gr)' : 'var(--tm)', fontFamily:'inherit',
        }}>👍{voted==='up' && ' Obrigado!'}</button>
        <button onClick={() => { submit(false); }} disabled={!!voted} style={{
          padding:'4px 12px', border:`1px solid ${voted==='down'?'var(--re)':'var(--b2)'}`,
          background: voted==='down' ? 'rgba(239,68,68,.1)' : 'var(--s2)',
          borderRadius:999, fontSize:13, cursor: voted ? 'default' : 'pointer',
          color: voted==='down' ? 'var(--re)' : 'var(--tm)', fontFamily:'inherit',
        }}>👎{voted==='down' && ' Registrado'}</button>
      </div>
      {showNote && voted==='down' && (
        <div style={{ marginTop:8, display:'flex', gap:6 }}>
          <input
            value={note} onChange={e => setNote(e.target.value)}
            placeholder="O que estava errado? (opcional)"
            style={{ flex:1, background:'var(--s2)', border:'1px solid var(--b2)', color:'var(--tx)',
              borderRadius:'var(--rs)', padding:'7px 10px', fontSize:12, fontFamily:'inherit', outline:'none' }}
          />
          <button onClick={() => api('/api/analysis/feedback', {
            method:'POST',
            body: JSON.stringify({ query, helpful: false, sources: result.sources, note, similarity: result.similarity }),
          }).then(() => setShowNote(false))} style={{
            padding:'7px 12px', background:'var(--s2)', border:'1px solid var(--b2)',
            borderRadius:'var(--rs)', fontSize:12, cursor:'pointer', fontFamily:'inherit', color:'var(--ts)',
          }}>Enviar</button>
        </div>
      )}
    </div>
  );
}

// ── Markdown-lite renderer ────────────────────────────────────────────────────
function Markdown({ text }) {
  if (!text) return null;
  const html = text
    .replace(/^## (.+)$/gm, '<h3 style="font-size:14px;font-weight:700;color:var(--tx);margin:14px 0 5px">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<li style="margin:3px 0;padding-left:4px">$1</li>')
    .replace(/(<li.*<\/li>)/gs, '<ul style="padding-left:16px;margin:6px 0">$1</ul>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
  return <div dangerouslySetInnerHTML={{ __html: html }} style={{ lineHeight:1.7, fontSize:13, color:'var(--ts)' }} />;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AISearch({ showToast, user }) {
  const [query,    setQuery]   = useState('');
  const [results,  setResults] = useState([]); // [{query, result, ts}]
  const [loading,  setLoading] = useState(false);
  const [listening,setListening]=useState(false);
  const inputRef = useRef(null);
  const bottomRef = useRef(null);
  const srRef    = useRef(null);

  useEffect(() => {
    if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior:'smooth' });
  }, [results]);

  async function search(q) {
    if (!q?.trim() || loading) return;
    const question = q.trim();
    setQuery('');
    setLoading(true);

    // Optimistic: show user question immediately
    setResults(prev => [...prev, { query: question, result: null, ts: Date.now() }]);

    try {
      const result = await api('/api/analysis/rag', {
        method: 'POST',
        body: JSON.stringify({
          userMessage: question,
          brand: extractBrand(question),
        }),
      });

      setResults(prev => prev.map((r, i) =>
        i === prev.length - 1 ? { ...r, result } : r
      ));
    } catch (err) {
      setResults(prev => prev.map((r, i) =>
        i === prev.length - 1 ? { ...r, result: { answer: '❌ Erro: ' + err.message, fallback: true, similarity: 0 } } : r
      ));
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function extractBrand(q) {
    const brands = ['Deye','Hoymiles','Sungrow','Huawei','FoxESS','GoodWe','Fronius','Growatt','SMA','ABB'];
    const found = brands.find(b => q.toLowerCase().includes(b.toLowerCase()));
    return found || null;
  }

  // Voice input
  function toggleVoice() {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      showToast('Reconhecimento de voz não suportado neste navegador', 'warn');
      return;
    }
    if (listening) { srRef.current?.stop(); setListening(false); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const sr = new SR();
    srRef.current = sr;
    sr.lang = 'pt-BR'; sr.continuous = false; sr.interimResults = false;
    sr.onstart  = () => setListening(true);
    sr.onend    = () => setListening(false);
    sr.onerror  = () => setListening(false);
    sr.onresult = (e) => {
      const text = e.results[0]?.[0]?.transcript || '';
      if (text) search(text);
    };
    sr.start();
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 60px)', padding:'0 0 0 0' }}>
      {/* Header */}
      <div style={{ padding:'24px 32px 16px', borderBottom:'1px solid var(--b1)', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:4 }}>
          <div style={{ width:40, height:40, borderRadius:12, background:'linear-gradient(135deg,var(--y),#FF8C00)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20 }}>🔍</div>
          <div>
            <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:'-.02em' }}>Busca IA</h1>
            <p style={{ fontSize:12, color:'var(--tm)' }}>Pesquise soluções, manuais e histórico técnico com IA</p>
          </div>
        </div>
      </div>

      {/* Chat area */}
      <div style={{ flex:1, overflowY:'auto', padding:'20px 32px' }}>
        {results.length === 0 && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:20, color:'var(--tm)', textAlign:'center' }}>
            <div style={{ fontSize:52 }}>🧠</div>
            <div>
              <div style={{ fontSize:16, fontWeight:700, color:'var(--ts)', marginBottom:6 }}>Como posso ajudar?</div>
              <div style={{ fontSize:13, color:'var(--tm)', maxWidth:360, lineHeight:1.6 }}>
                Faça perguntas técnicas sobre inversores, alarmes, configurações ou qualquer problema de energia solar.
              </div>
            </div>
            {/* Example questions */}
            <div style={{ display:'flex', flexDirection:'column', gap:8, width:'100%', maxWidth:500 }}>
              {[
                'DTU Hoymiles não conecta, senha errada',
                'Alarme F01 Deye — o que significa?',
                'Inversor Sungrow sem geração pela manhã',
                'Como configurar proteção de rede no GoodWe?',
              ].map((q, i) => (
                <button key={i} onClick={() => search(q)} style={{
                  padding:'10px 16px', background:'var(--s2)', border:'1px solid var(--b1)',
                  borderRadius:10, cursor:'pointer', fontFamily:'inherit', fontSize:13,
                  color:'var(--ts)', textAlign:'left', transition:'all .15s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor='var(--y)'; e.currentTarget.style.background='rgba(255,215,0,.05)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor='var(--b1)'; e.currentTarget.style.background='var(--s2)'; }}
                >{q}</button>
              ))}
            </div>
          </div>
        )}

        {results.map((item, idx) => (
          <div key={item.ts} style={{ marginBottom:24 }}>
            {/* User question bubble */}
            <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:12 }}>
              <div style={{
                maxWidth:'70%', padding:'10px 14px',
                background:'linear-gradient(135deg,var(--y),#FF8C00)',
                color:'#000', borderRadius:'16px 16px 4px 16px',
                fontSize:13, fontWeight:600,
              }}>{item.query}</div>
            </div>

            {/* AI response */}
            <div style={{
              background:'var(--s1)', border:'1px solid var(--b1)',
              borderRadius:'4px 16px 16px 16px', padding:'16px 18px',
              maxWidth:'85%',
            }}>
              {!item.result ? (
                <div style={{ display:'flex', alignItems:'center', gap:8, color:'var(--tm)', fontSize:13 }}>
                  <div style={{ width:16, height:16, border:'2px solid var(--y)', borderTop:'2px solid transparent', borderRadius:'50%', animation:'spin 1s linear infinite' }} />
                  Buscando na base de conhecimento...
                </div>
              ) : (
                <>
                  {/* Confidence meter */}
                  <ConfidenceMeter score={item.result.similarity} fallback={item.result.fallback} />

                  {/* Source chips */}
                  <SourceChips sources={item.result.sources} />

                  {/* Cold tier warning */}
                  {item.result.usedTextTier && !item.result.usedColdTier && (
                    <div style={{ padding:'6px 10px', background:'rgba(34,197,94,.07)', border:'1px solid rgba(34,197,94,.2)', borderRadius:7, marginBottom:10, fontSize:11, color:'var(--gr)' }}>
                      📚 Encontrado no Centro de Soluções por busca de texto — execute <b>Reindexar</b> no AI Obs para melhorar a precisão com embeddings.
                    </div>
                  )}
                  {item.result.usedColdTier && (
                    <div style={{ padding:'6px 10px', background:'rgba(96,165,250,.07)', border:'1px solid rgba(96,165,250,.2)', borderRadius:7, marginBottom:10, fontSize:11, color:'var(--bl)' }}>
                      ❄️ Resultado da base histórica (GitHub) — adicione a solução no Centro de Soluções para maior precisão.
                    </div>
                  )}

                  {/* Answer */}
                  <Markdown text={item.result.answer} />

                  {/* Tokens / timing */}
                  {item.result.elapsedMs && (
                    <div style={{ marginTop:10, fontSize:10, color:'var(--tm)', borderTop:'1px solid var(--b1)', paddingTop:8, display:'flex', gap:12 }}>
                      <span>⏱ {item.result.elapsedMs}ms</span>
                      {item.result.tokensUsed > 0 && <span>🔤 {item.result.tokensUsed} tokens</span>}
                      {item.result.queryExpanded && <span title={item.result.queryExpanded}>✨ Query expandida</span>}
                    </div>
                  )}

                  {/* Feedback — only for non-fallback responses */}
                  {!item.result.fallback && (
                    <FeedbackBar
                      result={item.result}
                      query={item.query}
                      onFeedback={(helpful) => {
                        if (helpful) showToast('👍 Obrigado! O sistema aprende com seu feedback.');
                        else showToast('👎 Registrado — vamos melhorar esta resposta.');
                      }}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding:'16px 32px', borderTop:'1px solid var(--b1)', background:'var(--bg)', flexShrink:0 }}>
        <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
          <div style={{ flex:1, position:'relative' }}>
            <textarea
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); search(query); } }}
              placeholder="Descreva o problema técnico... (Enter para buscar, Shift+Enter para nova linha)"
              rows={2}
              style={{
                width:'100%', background:'var(--s2)', border:'1.5px solid var(--b2)',
                color:'var(--tx)', borderRadius:12, padding:'12px 48px 12px 14px',
                fontSize:14, fontFamily:'inherit', outline:'none', resize:'none',
                boxSizing:'border-box', lineHeight:1.5,
              }}
              onFocus={e => e.target.style.borderColor='rgba(255,215,0,.4)'}
              onBlur={e => e.target.style.borderColor='var(--b2)'}
            />
            {/* Voice button */}
            <button onClick={toggleVoice} title="Busca por voz" style={{
              position:'absolute', right:12, top:'50%', transform:'translateY(-50%)',
              background: listening ? 'rgba(239,68,68,.15)' : 'none',
              border: listening ? '1px solid rgba(239,68,68,.4)' : 'none',
              borderRadius:8, padding:6, cursor:'pointer', fontSize:16,
              color: listening ? 'var(--re)' : 'var(--tm)',
            }}>{listening ? '⏹' : '🎤'}</button>
          </div>
          <button
            onClick={() => search(query)}
            disabled={!query.trim() || loading}
            style={{
              padding:'12px 20px', background:'var(--y)', color:'#000', border:'none',
              borderRadius:12, fontWeight:800, fontSize:14, cursor:'pointer',
              fontFamily:'inherit', opacity: (!query.trim() || loading) ? .5 : 1,
              flexShrink:0, height:52,
            }}
          >{loading ? '⟳' : '→'}</button>
        </div>
        <div style={{ marginTop:6, fontSize:11, color:'var(--tm)', textAlign:'center' }}>
          Powered by soluções indexadas + manuais · O feedback 👍👎 melhora os resultados ao longo do tempo
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

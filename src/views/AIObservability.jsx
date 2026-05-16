import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';

/* ── Design tokens (consistent with app theme) ─────────────────────────────── */
const C = {
  bg: '#0C0E16', s1: '#131621', s2: '#1C1F2E', s3: '#242840',
  b1: 'rgba(255,255,255,.06)', b2: 'rgba(255,255,255,.10)',
  y: '#FFD700', gr: '#22C55E', bl: '#60A5FA', re: '#EF4444',
  pu: '#A78BFA', or: '#FB923C', tm: '#6B7694', ts: '#C4C9DC', tx: '#EEF0F8',
  groq:   '#f97316',  // orange for Groq
  gemini: '#4285F4',  // Google blue for Gemini
  manual: '#8b5cf6',  // purple for manual RAG
};

/* ── Reusable UI pieces ─────────────────────────────────────────────────────── */
function Card({ children, style, glow }) {
  return (
    <div style={{
      background: C.s2, border: `1px solid ${glow ? glow + '33' : C.b2}`,
      borderRadius: 16, padding: 20,
      boxShadow: glow ? `0 0 20px ${glow}18` : 'none',
      ...style,
    }}>
      {children}
    </div>
  );
}

function Chip({ label, color, size }) {
  return (
    <span style={{
      fontSize: size || 10, fontWeight: 700,
      background: color + '20', color, border: `1px solid ${color}44`,
      borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

function Stat({ label, value, sub, color, icon, loading }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 11, color: C.tm, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}>
        {icon && <span style={{ marginRight: 5 }}>{icon}</span>}{label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: color || C.tx, lineHeight: 1 }}>
        {loading ? <span style={{ fontSize: 16, color: C.tm }}>...</span> : value}
      </div>
      {sub && <div style={{ fontSize: 11, color: C.tm }}>{sub}</div>}
    </div>
  );
}

function ProviderBadge({ provider }) {
  const map = { groq: [C.groq, '⚡ Groq'], gemini: [C.gemini, '✦ Gemini'], manual_rag: [C.manual, '📖 Manual'] };
  const [color, label] = map[provider] || [C.tm, provider];
  return <Chip label={label} color={color} size={10} />;
}

function HealthDot({ status }) {
  const color = status === 'ok' ? C.gr : status === 'error' ? C.re : C.or;
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8,
      borderRadius: '50%', background: color,
      boxShadow: `0 0 6px ${color}`,
      animation: status === 'ok' ? 'pulse-dot 2s infinite' : 'none',
    }} />
  );
}

/* ── Mini bar chart (no Plotly needed) ─────────────────────────────────────── */
function MiniBar({ data, height = 60, colorFn }) {
  if (!data?.length) return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.tm, fontSize: 11 }}>Sem dados</div>;
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <div
            title={d.label + ': ' + d.value}
            style={{
              width: '100%', borderRadius: '3px 3px 0 0',
              background: colorFn ? colorFn(d, i) : C.bl,
              height: Math.max(4, (d.value / max) * (height - 16)),
              transition: 'height .3s ease',
            }}
          />
          <div style={{ fontSize: 9, color: C.tm, overflow: 'hidden', maxWidth: '100%', textAlign: 'center' }}>
            {d.shortLabel || d.label}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Donut chart ───────────────────────────────────────────────────────────── */
function Donut({ segments, size = 100 }) {
  const r = 40, cx = 50, cy = 50;
  const total = segments.reduce((s, seg) => s + (seg.value || 0), 0) || 1;
  let angle = -90;
  const paths = segments.map(seg => {
    const pct    = (seg.value || 0) / total;
    const start  = angle;
    angle += pct * 360;
    if (pct === 0) return null;
    const largeArc = pct > 0.5 ? 1 : 0;
    const s = polarToCart(cx, cy, r, start);
    const e = polarToCart(cx, cy, r, angle - 0.01);
    return { ...seg, d: `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y} Z`, pct };
  }).filter(Boolean);

  return (
    <svg viewBox="0 0 100 100" width={size} height={size}>
      <circle cx={cx} cy={cy} r={r - 12} fill={C.s2} />
      {paths.map((p, i) => <path key={i} d={p.d} fill={p.color} opacity={.9} />)}
      <circle cx={cx} cy={cy} r={r - 25} fill={C.s2} />
      <text x={cx} y={cy - 3} textAnchor="middle" fontSize="12" fontWeight="800" fill={C.tx}>{total}</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fontSize="7" fill={C.tm}>requests</text>
    </svg>
  );
}

function polarToCart(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/* ── Latency sparkline ─────────────────────────────────────────────────────── */
function Sparkline({ data, color, height = 40, width = 200 }) {
  if (!data?.length) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  });
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".4" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   VOICE ASSISTANT COMPONENT
══════════════════════════════════════════════════════════════════════════════ */
function VoiceAssistant({ onClose }) {
  const [status,   setStatus]   = useState('idle');    // idle|listening|thinking|speaking
  const [messages, setMessages] = useState([]);
  const [provider, setProvider] = useState(null);
  const [transcript, setTranscript] = useState('');
  const [error,    setError]    = useState('');
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const sessionId  = useRef('voice-' + Date.now());
  const recogRef   = useRef(null);
  const synthRef   = useRef(null);
  const msgsEnd    = useRef(null);

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const TTS_OK = 'speechSynthesis' in window;

  useEffect(() => { msgsEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  function speak(text) {
    if (!TTS_OK || !ttsEnabled) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'pt-BR';
    utt.rate = 1.05;
    utt.pitch = 1;
    // Prefer a Brazilian Portuguese voice
    const voices = window.speechSynthesis.getVoices();
    const ptVoice = voices.find(v => v.lang.startsWith('pt')) || voices[0];
    if (ptVoice) utt.voice = ptVoice;
    utt.onstart = () => setStatus('speaking');
    utt.onend   = () => setStatus('idle');
    window.speechSynthesis.speak(utt);
    synthRef.current = utt;
  }

  async function sendQuery(text) {
    if (!text.trim()) return;
    setMessages(m => [...m, { role: 'user', text, ts: new Date() }]);
    setStatus('thinking');
    setError('');
    try {
      const res = await api('/api/analysis/rag', {
        method: 'POST',
        body: JSON.stringify({
          userMessage: text,
          sessionId:   sessionId.current,
          voice:       true,
        }),
      });
      if (!res) throw new Error('Sem resposta');
      const answer = res.answer || '';
      setProvider(res.provider || null);
      setMessages(m => [...m, {
        role:     'assistant',
        text:     answer,
        provider: res.provider,
        fallback: res.fallback,
        ts:       new Date(),
      }]);
      // TTS: strip markdown for speech
      const plain = answer.replace(/#{1,3}\s/g, '').replace(/\*\*/g, '').replace(/`/g, '');
      speak(plain);
    } catch (err) {
      setError(err.message);
      setStatus('idle');
    }
  }

  function startListening() {
    if (!SR) { setError('SpeechRecognition não suportado neste navegador. Use Chrome.'); return; }
    window.speechSynthesis.cancel();
    const recog = new SR();
    recog.lang           = 'pt-BR';
    recog.continuous     = false;
    recog.interimResults = true;
    recog.maxAlternatives = 1;

    recog.onstart  = ()  => { setStatus('listening'); setTranscript(''); };
    recog.onresult = (e) => {
      const t = Array.from(e.results).map(r => r[0].transcript).join('');
      setTranscript(t);
    };
    recog.onend    = ()  => {
      setStatus('idle');
      const t = recogRef.current?._lastTranscript;
      if (t?.trim()) sendQuery(t);
    };
    recog.onerror  = (e) => { setError('Erro: ' + e.error); setStatus('idle'); };

    // Hack to pass final transcript to onend
    const origOnResult = recog.onresult;
    recog.onresult = (e) => {
      const t = Array.from(e.results).map(r => r[0].transcript).join('');
      recogRef.current._lastTranscript = t;
      origOnResult(e);
    };

    recog.start();
    recogRef.current = recog;
    recogRef.current._lastTranscript = '';
  }

  function stopListening() {
    recogRef.current?.stop();
  }

  const statusConfig = {
    idle:      { color: C.bl,  icon: '🎤', label: 'Pressione para falar',   bg: C.bl + '20'  },
    listening: { color: C.re,  icon: '⏺',  label: 'Ouvindo... Solte para enviar', bg: C.re + '20' },
    thinking:  { color: C.y,   icon: '⟳',  label: 'Processando...',          bg: C.y  + '20'  },
    speaking:  { color: C.gr,  icon: '🔊', label: 'Reproduzindo resposta',   bg: C.gr + '20'  },
  };
  const sc = statusConfig[status];

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      zIndex: 9999, padding: 16,
    }}>
      <div style={{
        background: C.s1, border: `1px solid ${C.b2}`,
        borderRadius: 24, width: '100%', maxWidth: 480, maxHeight: '85vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.b1}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, background: C.bl + '20', border: `1px solid ${C.bl}33`, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🎙️</div>
          <div>
            <div style={{ fontWeight: 700, color: C.tx, fontSize: 14 }}>Assistente de Voz</div>
            <div style={{ fontSize: 11, color: C.tm }}>Centro de Soluções · Modo mãos-livres</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => setTtsEnabled(e => !e)} title={ttsEnabled ? 'Desativar fala' : 'Ativar fala'}
              style={{ background: 'none', border: `1px solid ${C.b2}`, color: ttsEnabled ? C.gr : C.tm, borderRadius: 8, padding: '4px 8px', fontSize: 14, cursor: 'pointer' }}>
              {ttsEnabled ? '🔊' : '🔇'}
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.tm, fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', color: C.tm, fontSize: 13, marginTop: 24 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🎙️</div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Pronto para ouvir</div>
              <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                Pergunte sobre alarmes, falhas ou procedimentos técnicos.<br />
                Ex: "Alarme F01 no inversor Deye" ou "Como resetar o BESS Sungrow"
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} style={{
              display: 'flex', flexDirection: 'column',
              alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
              gap: 4,
            }}>
              {/* Provider badge for assistant */}
              {msg.role === 'assistant' && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {msg.provider && <ProviderBadge provider={msg.provider} />}
                  {msg.fallback && <Chip label="⚠️ fallback" color={C.or} />}
                </div>
              )}
              <div style={{
                maxWidth: '85%',
                background: msg.role === 'user' ? C.bl + '20' : C.s2,
                border: `1px solid ${msg.role === 'user' ? C.bl + '33' : C.b1}`,
                borderRadius: msg.role === 'user' ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                padding: '10px 14px', fontSize: 13, color: C.tx, lineHeight: 1.6,
              }}>
                {msg.role === 'assistant' ? renderVoiceMd(msg.text) : msg.text}
              </div>
              <div style={{ fontSize: 10, color: C.tm }}>
                {msg.ts?.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          ))}

          {/* Interim transcript */}
          {status === 'listening' && transcript && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ background: C.re + '15', border: `1px solid ${C.re}22`, borderRadius: '16px 4px 16px 16px', padding: '10px 14px', fontSize: 13, color: C.ts, fontStyle: 'italic', maxWidth: '85%' }}>
                {transcript}…
              </div>
            </div>
          )}

          {error && (
            <div style={{ background: C.re + '15', border: `1px solid ${C.re}33`, borderRadius: 10, padding: '8px 12px', fontSize: 12, color: C.re }}>
              ⚠️ {error}
            </div>
          )}
          <div ref={msgsEnd} />
        </div>

        {/* Controls */}
        <div style={{ padding: '16px 20px', borderTop: `1px solid ${C.b1}`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 12, color: sc.color, fontWeight: 600 }}>{sc.label}</div>

          {/* Big push-to-talk button */}
          <button
            onMouseDown={startListening} onMouseUp={stopListening}
            onTouchStart={(e) => { e.preventDefault(); startListening(); }}
            onTouchEnd={(e)   => { e.preventDefault(); stopListening();  }}
            disabled={status === 'thinking' || status === 'speaking'}
            style={{
              width: 72, height: 72, borderRadius: '50%',
              background: status === 'listening' ? C.re : sc.bg,
              border: `3px solid ${sc.color}`,
              color: sc.color, fontSize: 28, cursor: 'pointer',
              boxShadow: `0 0 ${status === 'listening' ? '20px' : '8px'} ${sc.color}44`,
              transition: 'all .2s ease',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: status === 'listening' ? 'pulse-ring 1s infinite' : 'none',
            }}>
            {status === 'thinking' ? '⟳' : sc.icon}
          </button>

          {!SR && (
            <div style={{ fontSize: 11, color: C.or, textAlign: 'center' }}>
              ⚠️ Use Chrome para suporte a reconhecimento de voz
            </div>
          )}

          <div style={{ fontSize: 10, color: C.tm, textAlign: 'center' }}>
            Pressione e segure para falar · Solte para enviar
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse-ring {
          0%   { box-shadow: 0 0 0 0 ${C.re}66; }
          70%  { box-shadow: 0 0 0 16px ${C.re}00; }
          100% { box-shadow: 0 0 0 0 ${C.re}00; }
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50%       { opacity: .4; }
        }
      `}</style>
    </div>
  );
}

function renderVoiceMd(text) {
  return text.split('\n').map((line, i) => {
    if (line.startsWith('## ')) return <div key={i} style={{ fontWeight: 700, color: C.y, marginTop: 8, fontSize: 13 }}>{line.slice(3)}</div>;
    if (line.match(/^[-*]\s/)) return <div key={i} style={{ paddingLeft: 12, color: C.ts }}>• {line.slice(2)}</div>;
    if (!line.trim()) return <div key={i} style={{ height: 6 }} />;
    return <div key={i} style={{ color: C.ts }}>{line}</div>;
  });
}

/* ══════════════════════════════════════════════════════════════════════════════
   MAIN AI OBSERVABILITY DASHBOARD
══════════════════════════════════════════════════════════════════════════════ */

// ── Manual Indexer Panel ───────────────────────────────────────────────────────
function ManualIndexerPanel({ C, user, showToast }) {
  const [log,      setLog]      = useState([]);
  const [running,  setRunning]  = useState(false);
  const [indexed,  setIndexed]  = useState(null);
  const logRef = useRef(null);

  // Load index log on mount
  useEffect(() => {
    api('/api/ai-obs/index-log').then(setIndexed).catch(() => setIndexed([]));
  }, []);

  async function startIndexing() {
    setRunning(true);
    setLog([{ type:'info', msg:'Conectando ao Google Drive...' }]);

    try {
      const res = await fetch('/api/ai-obs/index-manuals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + localStorage.getItem('session_token') },
      });

      const reader = res.body.getReader();
      const dec    = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const ev = JSON.parse(line.slice(6));
              setLog(prev => [...prev, ev]);
              if (logRef.current) logRef.current.scrollTop = 9999;
              if (ev.type === 'complete') {
                api('/api/ai-obs/index-log').then(setIndexed).catch(() => {});
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      setLog(prev => [...prev, { type:'error', msg: err.message }]);
    } finally {
      setRunning(false);
    }
  }

  const logColor = { info:'var(--tm)', processing:'var(--ts)', done:'var(--gr)',
    error:'var(--re)', skip:'var(--tm)', complete:'var(--y)', start:'var(--bl)' };

  return (
    <div style={{ background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--rs)', padding:16, marginBottom:16 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:13 }}>📖 Indexar Manuais e Datasheets</div>
          <div style={{ fontSize:11, color:'var(--tm)', marginTop:2 }}>
            Groq Vision extrai códigos de alarme → armazena apenas palavras-chave no banco
          </div>
        </div>
        <button onClick={startIndexing} disabled={running} style={{
          padding:'8px 16px', borderRadius:'var(--rs)', fontSize:12, fontWeight:700,
          cursor: running ? 'default' : 'pointer', fontFamily:'inherit',
          background: running ? 'var(--s2)' : 'rgba(167,139,250,.15)',
          border:`1px solid ${running ? 'var(--b1)' : 'rgba(167,139,250,.4)'}`,
          color: running ? 'var(--tm)' : 'var(--pu)',
        }}>
          {running ? '⟳ Indexando...' : '🚀 Iniciar Indexação'}
        </button>
      </div>

      {/* Live log */}
      {log.length > 0 && (
        <div ref={logRef} style={{
          background:'var(--b0,#0a0c14)', borderRadius:8, padding:'10px 12px',
          maxHeight:200, overflowY:'auto', marginBottom:12, fontFamily:'monospace', fontSize:11,
        }}>
          {log.map((ev, i) => (
            <div key={i} style={{ color: logColor[ev.type] || 'var(--tm)', marginBottom:2 }}>
              {ev.type === 'progress' ? `[${ev.current}/${ev.total}] ${ev.filename}` : ev.msg}
            </div>
          ))}
        </div>
      )}

      {/* Indexed files */}
      {indexed !== null && (
        <div>
          <div style={{ fontSize:11, color:'var(--tm)', marginBottom:6 }}>
            {indexed.length} arquivo(s) indexado(s)
          </div>
          {indexed.length > 0 && (
            <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
              {indexed.map((f, i) => (
                <div key={i} style={{
                  padding:'4px 10px', background:'rgba(167,139,250,.08)',
                  border:'1px solid rgba(167,139,250,.2)', borderRadius:999, fontSize:10,
                  display:'flex', alignItems:'center', gap:6,
                }}>
                  <span style={{ color:'var(--pu)', fontWeight:700 }}>{f.brand}</span>
                  <span style={{ color:'var(--tm)' }}>{f.filename}</span>
                  <span style={{ color:'var(--gr)' }}>· {f.codes_found} códigos</span>
                </div>
              ))}
            </div>
          )}
          {indexed.length === 0 && (
            <div style={{ fontSize:12, color:'var(--tm)', padding:'8px 0' }}>
              Nenhum manual indexado ainda. Configure o ID da pasta em{' '}
              <b>Configurações → Google Drive → ID da pasta de Manuais</b> e clique em Iniciar Indexação.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AIObservability({ showToast, user }) {
  const [stats,      setStats]      = useState(null);
  const [timeline,   setTimeline]   = useState([]);
  const [errors,     setErrors]     = useState([]);
  const [topQueries, setTopQueries] = useState([]);
  const [health,     setHealth]     = useState(null);
  const [manuals,    setManuals]    = useState(null);
  const [range,      setRange]      = useState('7d');
  const [loading,    setLoading]    = useState(true);
  const [healthChk,  setHealthChk]  = useState(false);
  const [showVoice,  setShowVoice]  = useState(false);
  const [reindexing, setReindexing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t, e, q, m] = await Promise.allSettled([
        api(`/api/ai-obs/stats?range=${range}`),
        api('/api/ai-obs/timeline?hours=24'),
        api('/api/ai-obs/errors'),
        api('/api/ai-obs/top-queries'),
        api('/api/ai-obs/manuals'),
      ]);
      if (s.status === 'fulfilled') setStats(s.value);
      if (t.status === 'fulfilled') setTimeline(t.value?.timeline || []);
      if (e.status === 'fulfilled') setErrors(e.value?.errors   || []);
      if (q.status === 'fulfilled') setTopQueries(q.value?.topQueries || []);
      if (m.status === 'fulfilled') setManuals(m.value);
    } catch {}
    setLoading(false);
  }, [range]);

  useEffect(() => { load(); }, [load]);

  async function checkProviderHealth() {
    setHealthChk(true);
    try {
      const h = await api('/api/ai-obs/health');
      setHealth(h);
    } catch (err) { showToast?.('Erro ao verificar health: ' + err.message, 'warn'); }
    setHealthChk(false);
  }

  async function reindexManuals() {
    setReindexing(true);
    try {
      const res = await api('/api/ai-obs/reindex-manuals', { method: 'POST' });
      showToast?.(`✅ ${res.results?.length || 0} arquivos processados`);
      load();
    } catch (err) { showToast?.('Erro: ' + err.message, 'warn'); }
    setReindexing(false);
  }

  const totalReq    = stats?.total_requests     || 0;
  const groqCnt     = stats?.groq_count         || 0;
  const geminiCnt   = stats?.gemini_count       || 0;
  const manualCnt   = stats?.manual_rag_count   || 0;
  const fallbackCnt = stats?.fallback_count     || 0;
  const voiceCnt    = stats?.voice_count        || 0;
  const errorCnt    = stats?.error_count        || 0;
  const successRate = totalReq ? Math.round((1 - errorCnt / totalReq) * 100) : 100;

  // Timeline chart data
  const timelineData = timeline.map(t => ({
    label: new Date(t.time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    shortLabel: new Date(t.time).toLocaleTimeString('pt-BR', { hour: '2-digit' }) + 'h',
    value: t.total,
  }));

  const latencyData = timeline.map(t => ({
    label: new Date(t.time).toLocaleTimeString('pt-BR', { hour: '2-digit' }) + 'h',
    value: t.avg_latency || 0,
  }));

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div style={{ width: 40, height: 40, background: 'linear-gradient(135deg, #A78BFA22, #60A5FA22)', border: '1px solid #A78BFA44', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🧠</div>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: C.tx, margin: 0 }}>AI Observability</h1>
              <div style={{ fontSize: 11, color: C.tm }}>Monitor de IA · Acesso Master</div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Range selector */}
          {['24h','7d','30d','all'].map(r => (
            <button key={r} onClick={() => setRange(r)}
              style={{ padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                background: range === r ? C.pu + '22' : 'transparent',
                border: `1px solid ${range === r ? C.pu : C.b2}`,
                color: range === r ? C.pu : C.tm }}>
              {r}
            </button>
          ))}

          <button onClick={checkProviderHealth} disabled={healthChk}
            style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: C.s3, border: `1px solid ${C.b2}`, color: C.ts }}>
            {healthChk ? '⟳ Verificando...' : '🔌 Verificar Saúde'}
          </button>

          <button onClick={() => setShowVoice(true)}
            style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: C.bl + '20', border: `1px solid ${C.bl}44`, color: C.bl }}>
            🎙️ Testar Voz
          </button>

          <button onClick={load}
            style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer', background: C.s3, border: `1px solid ${C.b2}`, color: C.tm }}>
            ↻
          </button>
        </div>
      </div>

      {/* ── Provider Health ──────────────────────────────────────────────────── */}
      {health && (
        <Card style={{ marginBottom: 16, padding: '14px 20px' }}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.tm, letterSpacing: '.04em' }}>SAÚDE DOS PROVIDERS</div>
            {[
              { key: 'groq',   label: '⚡ Groq',   color: C.groq   },
              { key: 'gemini', label: '✦ Gemini', color: C.gemini },
            ].map(p => {
              const h = health[p.key];
              return (
                <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <HealthDot status={h?.status} />
                  <span style={{ fontSize: 12, color: p.color, fontWeight: 700 }}>{p.label}</span>
                  <span style={{ fontSize: 11, color: C.tm }}>
                    {h?.status === 'ok' ? `${h.latencyMs}ms` : h?.error || 'unknown'}
                  </span>
                </div>
              );
            })}
            <div style={{ marginLeft: 'auto', fontSize: 10, color: C.tm }}>
              {health.checkedAt ? new Date(health.checkedAt).toLocaleTimeString('pt-BR') : ''}
            </div>
          </div>
        </Card>
      )}

      {/* ── Hero stats ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total de Requisições', value: totalReq.toLocaleString(), icon: '📊', color: C.tx },
          { label: 'Taxa de Sucesso', value: successRate + '%', icon: '✅', color: successRate >= 95 ? C.gr : successRate >= 85 ? C.y : C.re, sub: `${errorCnt} erros` },
          { label: 'Latência Média', value: (stats?.avg_latency_ms || 0) + 'ms', icon: '⚡', color: (stats?.avg_latency_ms || 0) < 3000 ? C.gr : C.or },
          { label: 'Fallbacks Groq→Gemini', value: fallbackCnt.toString(), icon: '🔄', color: fallbackCnt > 0 ? C.or : C.gr, sub: 'Groq → Gemini' },
          { label: 'Interações de Voz', value: voiceCnt.toString(), icon: '🎙️', color: C.bl },
          { label: 'Manual RAG', value: manualCnt.toString(), icon: '📖', color: C.pu, sub: 'fallback para manuais' },
        ].map(s => (
          <Card key={s.label} glow={s.color !== C.tx && s.color}>
            <Stat {...s} loading={loading} />
          </Card>
        ))}
      </div>

      {/* ── Main grid ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>

        {/* Request timeline */}
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontWeight: 700, color: C.tx, fontSize: 13 }}>📈 Requisições — Últimas 24h</div>
          </div>
          <MiniBar
            data={timelineData.slice(-12)}
            height={80}
            colorFn={(d) => C.bl}
          />
        </Card>

        {/* Provider distribution */}
        <Card>
          <div style={{ fontWeight: 700, color: C.tx, fontSize: 13, marginBottom: 14 }}>🔀 Distribuição de Providers</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Donut segments={[
              { value: groqCnt,   color: C.groq   },
              { value: geminiCnt, color: C.gemini  },
              { value: manualCnt, color: C.manual  },
            ]} size={90} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { label: 'Groq',   count: groqCnt,   color: C.groq   },
                { label: 'Gemini', count: geminiCnt,  color: C.gemini },
                { label: 'Manual', count: manualCnt,  color: C.manual },
              ].map(p => (
                <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: C.ts, minWidth: 48 }}>{p.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: p.color }}>{p.count}</span>
                  <span style={{ fontSize: 10, color: C.tm }}>
                    ({totalReq ? Math.round(p.count / totalReq * 100) : 0}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

        {/* Latency chart */}
        <Card>
          <div style={{ fontWeight: 700, color: C.tx, fontSize: 13, marginBottom: 12 }}>⏱️ Latência Média por Hora (ms)</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3 }}>
            <MiniBar
              data={latencyData.slice(-12)}
              height={70}
              colorFn={(d) => d.value < 3000 ? C.gr : d.value < 8000 ? C.y : C.re}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
            <div style={{ fontSize: 11, color: C.tm }}>
              Groq avg: <span style={{ color: C.groq, fontWeight: 700 }}>{stats?.groq_avg_ms || 0}ms</span>
            </div>
            <div style={{ fontSize: 11, color: C.tm }}>
              Gemini avg: <span style={{ color: C.gemini, fontWeight: 700 }}>{stats?.gemini_avg_ms || 0}ms</span>
            </div>
          </div>
        </Card>

        {/* Top queries */}
        <Card>
          <div style={{ fontWeight: 700, color: C.tx, fontSize: 13, marginBottom: 12 }}>🔍 Consultas Mais Frequentes</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
            {topQueries.slice(0, 8).map((q, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 10, color: C.tm, minWidth: 16, fontWeight: 700 }}>#{i + 1}</div>
                <div style={{ flex: 1, fontSize: 11, color: C.ts, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {q.query}
                </div>
                <Chip label={q.count + 'x'} color={q.count > 5 ? C.or : C.bl} />
              </div>
            ))}
            {topQueries.length === 0 && <div style={{ fontSize: 11, color: C.tm }}>Sem dados ainda</div>}
          </div>
        </Card>
      </div>

      {/* ── Manual Indexer ───────────────────────────────────────────────────── */}
      <ManualIndexerPanel C={C} user={user} showToast={showToast} />

      {/* ── Recent errors ────────────────────────────────────────────────────── */}
      <Card>
        <div style={{ fontWeight: 700, color: C.tx, fontSize: 13, marginBottom: 14 }}>
          🚨 Erros Recentes
          {errorCnt > 0 && <Chip label={errorCnt + ' total'} color={C.re} size={10} />}
        </div>
        {errors.length === 0 ? (
          <div style={{ fontSize: 12, color: C.gr, display: 'flex', alignItems: 'center', gap: 6 }}>
            <HealthDot status="ok" /> Nenhum erro recente — sistema operando normalmente
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
            {errors.map(e => (
              <div key={e.id} style={{ background: C.s3, border: `1px solid ${C.re}22`, borderRadius: 8, padding: '8px 12px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <ProviderBadge provider={e.provider} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: C.re, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.error_msg || 'Unknown error'}
                  </div>
                  <div style={{ fontSize: 10, color: C.tm, marginTop: 2 }}>
                    {e.feature} · {e.total_ms}ms ·&nbsp;
                    {new Date(e.created_at).toLocaleString('pt-BR')}
                  </div>
                </div>
                {e.fallback_reason && <Chip label={e.fallback_reason} color={C.or} />}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Voice assistant modal */}
      {showVoice && <VoiceAssistant onClose={() => setShowVoice(false)} />}

      <style>{`
        @keyframes pulse-dot { 0%,100%{opacity:1} 50%{opacity:.4} }
      `}</style>
    </div>
  );
}

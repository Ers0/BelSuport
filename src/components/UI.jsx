import React, { useState, useEffect, useRef, useCallback } from 'react';

const ANIM_CSS = `
@keyframes toastIn  { from{opacity:0;transform:translateY(24px) scale(0.88)} to{opacity:1;transform:translateY(0) scale(1)} }
@keyframes toastOut { from{opacity:1;transform:translateY(0) scale(1)} to{opacity:0;transform:translateY(16px) scale(0.88)} }
@keyframes springIn { 0%{opacity:0;transform:scale(0.6) translateY(6px)} 60%{transform:scale(1.08) translateY(-2px)} 80%{transform:scale(0.97)} 100%{opacity:1;transform:scale(1) translateY(0)} }
@keyframes badgePop { 0%{transform:scale(1)} 35%{transform:scale(1.3)} 65%{transform:scale(0.9)} 100%{transform:scale(1)} }
@keyframes ripple   { 0%{transform:scale(0);opacity:.5} 100%{transform:scale(4);opacity:0} }
@keyframes checkDraw{ from{stroke-dashoffset:30} to{stroke-dashoffset:0} }
@keyframes slideRight{from{opacity:1;transform:translateX(0)} to{opacity:0;transform:translateX(110%)}}
@keyframes flashGreen{0%,100%{background:var(--s1)} 40%{background:rgba(34,197,94,.15)}}
@keyframes spinAnim { to{transform:rotate(360deg)} }
@keyframes driveStep{ from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:translateY(0)} }
`;
if (typeof document !== 'undefined' && !document.getElementById('bel-anims')) {
  const s = document.createElement('style');
  s.id = 'bel-anims';
  s.textContent = ANIM_CSS;
  document.head.appendChild(s);
}

// ── ToastStack ────────────────────────────────────────────────────────────────
export function ToastStack({ toasts }) {
  if (!toasts?.length) return null;
  const typeColor = { warn:'var(--re)', info:'var(--bl)', default:'var(--ts)' };
  return (
    <div style={{ position:'fixed', bottom:28, left:'50%', transform:'translateX(-50%)', zIndex:9999, pointerEvents:'none', display:'flex', flexDirection:'column', alignItems:'center' }}>
      {toasts.map((t, i) => (
        <div key={t.id} style={{
          background:'var(--s2)', border:'1px solid var(--b2)',
          color: typeColor[t.type] || typeColor.default,
          padding:'10px 22px', borderRadius:'var(--rs)',
          fontSize:13, fontWeight:500, whiteSpace:'nowrap',
          pointerEvents:'auto', marginTop: i === 0 ? 0 : -42,
          transform:`scale(${1 - i * 0.06}) translateY(${i * -10}px)`,
          transformOrigin:'bottom center',
          opacity: Math.max(0, 1 - i * 0.22),
          zIndex: 9999 - i,
          boxShadow:'0 8px 32px rgba(0,0,0,.4)',
          animation: t.leaving
            ? 'toastOut .28s ease forwards'
            : 'toastIn .35s cubic-bezier(0.34,1.56,0.64,1) forwards',
          transition:'transform .3s cubic-bezier(0.34,1.56,0.64,1), opacity .3s ease, margin .3s ease',
        }}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

export function Toast({ toast }) {
  if (!toast) return null;
  const typeColor = { warn:'var(--re)', info:'var(--bl)', default:'var(--ts)' };
  return (
    <div style={{
      position:'fixed', bottom:28, left:'50%', transform:'translateX(-50%)',
      background:'var(--s2)', border:'1px solid var(--b2)',
      color: typeColor[toast.type] || typeColor.default,
      padding:'10px 22px', borderRadius:'var(--rs)', fontSize:13, fontWeight:500,
      zIndex:9999, boxShadow:'0 8px 32px rgba(0,0,0,.4)', whiteSpace:'nowrap',
      animation:'toastIn .35s cubic-bezier(0.34,1.56,0.64,1) forwards',
    }}>{toast.msg}</div>
  );
}

// ── StatusBadge — morphs on change ────────────────────────────────────────────
export function StatusBadge({ status }) {
  const [animKey, setAnimKey] = useState(0);
  const prev = useRef(status);
  useEffect(() => {
    if (status !== prev.current) { setAnimKey(k=>k+1); prev.current = status; }
  }, [status]);
  const map = {
    'Pendente Itens': { bg:'rgba(245,158,11,.1)',  color:'#F59E0B' },
    'Aguardando Protocolo': { bg:'rgba(96,165,250,.1)',  color:'var(--bl)' },
    'Concluído':      { bg:'rgba(34,197,94,.1)',   color:'var(--gr)' },
  };
  const s = map[status] || { bg:'var(--s2)', color:'var(--tm)' };
  return (
    <span key={animKey} style={{
      fontSize:11, fontWeight:600, padding:'3px 10px', borderRadius:999,
      background:s.bg, color:s.color, whiteSpace:'nowrap', display:'inline-block',
      animation: animKey > 0 ? 'badgePop .4s cubic-bezier(0.34,1.56,0.64,1)' : 'none',
    }}>{status}</span>
  );
}

// ── DriveProgress — named steps + spinner→checkmark morph ────────────────────
const DRIVE_STEPS = [
  'Preparando arquivos...',
  'Compactando pasta...',
  'Autenticando com Drive...',
  'Criando pasta no Drive...',
  'Enviando arquivos...',
  'Finalizando...',
];

export function DriveProgress({ visible, step, pct, done }) {
  const [showCheck, setShowCheck] = useState(false);
  useEffect(() => {
    if (!visible) { setShowCheck(false); return; }
    if (pct >= 100 || done) setTimeout(() => setShowCheck(true), 400);
    else setShowCheck(false);
  }, [pct, done, visible]);

  if (!visible) return null;

  const stepIdx   = DRIVE_STEPS.indexOf(step);
  const effectPct = pct ?? (stepIdx >= 0 ? Math.round((stepIdx / DRIVE_STEPS.length) * 100) : 0);

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9998 }}>
      <div style={{ background:'var(--s1)', border:'1px solid var(--b2)', borderRadius:'var(--r)', padding:'40px 50px', minWidth:380, textAlign:'center', boxShadow:'0 24px 80px rgba(0,0,0,.5)' }}>
        <div style={{ position:'relative', width:52, height:52, margin:'0 auto 24px' }}>
          {!showCheck ? (
            <div style={{ width:52, height:52, border:'3px solid var(--b2)', borderTopColor:'var(--y)', borderRadius:'50%', animation:'spinAnim .8s linear infinite' }} />
          ) : (
            <svg width="52" height="52" viewBox="0 0 52 52">
              <circle cx="26" cy="26" r="24" fill="rgba(34,197,94,.1)" stroke="var(--gr)" strokeWidth="2" />
              <polyline points="14,26 22,34 38,18" fill="none" stroke="var(--gr)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                style={{ strokeDasharray:30, strokeDashoffset:30, animation:'checkDraw .5s .1s ease forwards' }} />
            </svg>
          )}
        </div>
        <div style={{ fontSize:15, fontWeight:700, marginBottom:20 }}>
          {showCheck ? '✓ Upload Concluído!' : '📤 Enviando para o Google Drive...'}
        </div>
        <div style={{ background:'var(--s2)', borderRadius:999, height:8, overflow:'hidden', marginBottom:14 }}>
          <div style={{
            height:'100%', borderRadius:999,
            background: showCheck ? 'var(--gr)' : 'linear-gradient(90deg,var(--y),var(--y2))',
            width:`${effectPct}%`,
            transition:'width 2.4s cubic-bezier(.4,0,.2,1), background .6s ease',
          }} />
        </div>
        <div style={{ textAlign:'left', marginTop:12 }}>
          {DRIVE_STEPS.map((s, i) => {
            const isDone    = i < stepIdx || showCheck;
            const isCurrent = i === stepIdx && !showCheck;
            return (
              <div key={s} style={{
                display:'flex', alignItems:'center', gap:8, padding:'4px 0', fontSize:12,
                color: isDone ? 'var(--gr)' : isCurrent ? 'var(--tx)' : 'var(--tm)',
                fontWeight: isCurrent ? 600 : 400,
                animation: isCurrent ? 'driveStep .3s ease' : 'none',
              }}>
                <span style={{ fontSize:11, minWidth:14 }}>{isDone ? '✓' : isCurrent ? '›' : '·'}</span>
                {s}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function Card({ children, style }) {
  return (
    <div style={{ background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--r)', ...style }}>
      {children}
    </div>
  );
}

export function Btn({ children, variant='primary', onClick, style, disabled, title }) {
  const base = { display:'inline-flex', alignItems:'center', gap:6, border:'none', borderRadius:'var(--rs)', fontFamily:'inherit', fontWeight:600, cursor: disabled ? 'not-allowed' : 'pointer', transition:'all .15s', opacity: disabled ? .5 : 1 };
  const variants = {
    primary:   { background:'var(--y)', color:'#000', padding:'10px 22px', fontSize:13 },
    secondary: { background:'var(--s2)', border:'1px solid var(--b2)', color:'var(--tx)', padding:'10px 18px', fontSize:13 },
    ghost:     { background:'transparent', border:'1px solid var(--b2)', color:'var(--tm)', padding:'8px 14px', fontSize:12 },
    danger:    { background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.2)', color:'var(--re)', padding:'7px 12px', fontSize:12 },
    success:   { background:'rgba(34,197,94,.08)', border:'1px solid rgba(34,197,94,.2)', color:'var(--gr)', padding:'7px 14px', fontSize:12 },
    icon:      { background:'var(--s2)', border:'1px solid var(--b2)', color:'var(--tm)', padding:'9px 11px', fontSize:15 },
  };
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      style={{ ...base, ...variants[variant], ...style }}>
      {children}
    </button>
  );
}

export function Field({ label, children, hint, style }) {
  return (
    <div style={{ marginBottom:10, ...style }}>
      {label && <label style={{ fontSize:11.5, fontWeight:600, color:'var(--ts)', display:'block', marginBottom:5 }}>{label}</label>}
      {children}
      {hint && <small style={{ fontSize:11, color:'var(--tm)', display:'block', marginTop:4 }}>{hint}</small>}
    </div>
  );
}

export function AutoTag() {
  return <span style={{ fontSize:9.5, background:'rgba(255,215,0,.1)', color:'var(--y)', padding:'1px 6px', borderRadius:999, fontWeight:700, marginLeft:4 }}>auto</span>;
}

const AVATAR_COLORS = ['#A78BFA','#22C55E','#FB923C','#60A5FA','#F472B6','#34D399','#FBBF24','#818CF8'];
export function Avatar({ name, size=28 }) {
  const idx = (name || '?').charCodeAt(0) % AVATAR_COLORS.length;
  const color = AVATAR_COLORS[idx];
  return (
    <div style={{
      width:size, height:size, borderRadius:'50%',
      background: color + '33', border:`2px solid ${color}55`,
      display:'flex', alignItems:'center', justifyContent:'center',
      fontSize: size * 0.4, fontWeight:700, color, flexShrink:0, textTransform:'uppercase',
    }}>
      {(name || '?')[0]}
    </div>
  );
}

export function Spinner() {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:8000 }}>
      <div style={{ width:36, height:36, border:'3px solid var(--b2)', borderTopColor:'var(--y)', borderRadius:'50%', animation:'spinAnim .7s linear infinite' }} />
    </div>
  );
}

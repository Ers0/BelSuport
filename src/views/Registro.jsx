import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import { Btn, Card, Field, AutoTag, Avatar, StatusBadge } from '../components/UI';
import CaseTimeline from '../components/CaseTimeline';

// ── Checklist config ──────────────────────────────────────────────────────────
const CHECKLIST = [
  { id:'f_nf',  icon:'📄', label:'NF',          required:true },
  { id:'f_un',  icon:'📐', label:'Unifilar',    required:true },
  { id:'f_et',  icon:'🏷️', label:'Etiqueta',    required:false },
  { id:'f_vcc', icon:'📏', label:'VCC',          required:true },
  { id:'f_vca', icon:'📹', label:'Vídeo CA',    required:true },
  { id:'f_va',  icon:'🎥', label:'Vídeo Amplo', required:false },
  { id:'f_fi',  icon:'📝', label:'Ficha',        required:true },
];

const emptyForm = () => ({
  sn:'', modelo:'', cliente_final:'', nome:'', contato:'',
  integrador:'', tel_integrador:'', categoria:'', fabricante:'',
  relato:'', assigned_to:'', ven:'',
  f_nf:false, f_un:false, f_et:false, f_vcc:false, f_vca:false, f_fi:false, f_va:false,
});

// ── Power/brand detection helpers ────────────────────────────────────────────
function parsePowerKw(model) {
  if (!model) return null;
  const m = model.toUpperCase();
  // "6K" → 6, "3.6K" → 3.6, "10K" → 10
  let match = m.match(/[^A-Z](\d+(?:[.,]\d+)?)\s*K[^A-Z]/);
  if (!match) match = m.match(/^(\d+(?:[.,]\d+)?)\s*K/); // starts with kW
  if (match) return parseFloat(match[1].replace(',', '.'));
  // "2500" or "2250" (watts as 4-digit number between dashes/underscores)
  const numMatch = m.match(/[-_](\d{3,4})[-_]/);
  if (numMatch) {
    const n = parseInt(numMatch[1]);
    if (n >= 500 && n <= 9999) return n / 1000;
  }
  return null;
}
function ConfBadge({ pct }) {
  if (!pct) return null;
  const color = pct >= 90 ? 'var(--gr)' : pct >= 70 ? '#F59E0B' : 'var(--re)';
  return (
    <span style={{ fontSize:10, fontWeight:700, color, marginLeft:6,
      background: color+'18', padding:'1px 6px', borderRadius:999 }}>{pct}%</span>
  );
}

// ── Field label with Auto badge (only shows if value is non-empty) ───────────
function FLabel({ children, auto, pct, value, loading }) {
  const hasValue = value !== undefined ? !!value : true;
  const showAuto = auto && hasValue && !loading;
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
      {children}
      {showAuto && <span style={{ fontSize:9.5, fontWeight:700, background:'rgba(255,215,0,.1)', color:'var(--y)', padding:'1px 6px', borderRadius:999 }}>Auto</span>}
      {showAuto && pct && <ConfBadge pct={pct} />}
    </span>
  );
}

// ── SLA indicator ─────────────────────────────────────────────────────────────
function SlaIndicator({ slaStatus, createdAt }) {
  if (!createdAt || slaStatus === 'ok') return null;
  const hours = Math.round((Date.now() - new Date(createdAt)) / 3_600_000);
  return (
    <span style={{ fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:999,
      background: slaStatus==='critical' ? 'rgba(239,68,68,.12)' : 'rgba(245,158,11,.12)',
      color: slaStatus==='critical' ? 'var(--re)' : '#F59E0B' }}>
      ⏱ {hours}h
    </span>
  );
}

// ── DrivePreview (compact) ────────────────────────────────────────────────────
function DrivePreview({ driveId }) {
  const [open, setOpen]   = useState(false);
  const [files, setFiles] = useState(null);
  async function toggle() {
    setOpen(v => !v);
    if (!files) {
      const d = await api(`/api/drive/folder-files/${driveId}`).catch(() => ({ files:[] }));
      setFiles(d.files || []);
    }
  }
  return (
    <div style={{ display:'inline-flex', flexDirection:'column' }}>
      <div style={{ display:'flex', gap:4 }}>
        <button onClick={toggle} style={{ padding:'6px 11px', background:'rgba(96,165,250,.08)', border:'1px solid rgba(96,165,250,.2)', color:'var(--bl)', borderRadius:'var(--rs)', fontSize:11.5, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
          ☁️ {open ? '▲' : '▼'}
        </button>
        <a href={`https://drive.google.com/drive/folders/${driveId}`} target="_blank" rel="noreferrer"
          style={{ padding:'6px 9px', background:'rgba(96,165,250,.05)', border:'1px solid rgba(96,165,250,.15)', color:'var(--ts)', borderRadius:'var(--rs)', fontSize:11.5, textDecoration:'none' }}>↗</a>
      </div>
      {open && files && (
        <div style={{ marginTop:4, width:260, background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', overflow:'hidden', zIndex:10 }}>
          {files.length === 0 && <div style={{ padding:'10px', fontSize:11.5, color:'var(--tm)' }}>Pasta vazia</div>}
          {files.map(f => (
            <a key={f.id} href={f.webViewLink} target="_blank" rel="noreferrer"
              style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 10px', borderBottom:'1px solid var(--b1)', textDecoration:'none' }}>
              <span style={{ fontSize:12 }}>{f.icon}</span>
              <span style={{ fontSize:11, color:'var(--tx)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.name}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Confetti (reuse global) ───────────────────────────────────────────────────
function confetti(x, y) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:99999';
  document.body.appendChild(canvas);
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  const COLORS = ['#FFD700','#22C55E','#60A5FA','#F472B6','#A78BFA','#FB923C'];
  const ps = Array.from({length:80}, () => ({
    x, y, vx:(Math.random()-.5)*14, vy:Math.random()*-14-4,
    size:Math.random()*7+3, color:COLORS[Math.floor(Math.random()*COLORS.length)],
    rot:Math.random()*360, rSpeed:(Math.random()-.5)*12, opacity:1,
  }));
  let raf;
  (function draw() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    let alive=false;
    ps.forEach(p => {
      p.x+=p.vx; p.y+=p.vy; p.vy+=.5; p.rot+=p.rSpeed; p.opacity-=.018;
      if (p.opacity<=0) return; alive=true;
      ctx.save(); ctx.globalAlpha=Math.max(0,p.opacity); ctx.translate(p.x,p.y);
      ctx.rotate(p.rot*Math.PI/180); ctx.fillStyle=p.color;
      ctx.fillRect(-p.size/2,-p.size/2,p.size,p.size*.5); ctx.restore();
    });
    if (alive) raf=requestAnimationFrame(draw);
    else { cancelAnimationFrame(raf); canvas.remove(); }
  })();
}

// ═══════════════════════════════════════════════════════════════════════════════
// WIZARD STEPS
// ═══════════════════════════════════════════════════════════════════════════════

const STEPS = [
  { id:1, label:'Dados do chamado', sub:'Preencha as informações' },
  { id:2, label:'Protocolo',        sub:'Dados do equipamento' },
  { id:3, label:'Checklist',        sub:'Itens e arquivos' },
  { id:4, label:'Revisão',          sub:'Revise e confirme' },
  { id:5, label:'Conclusão',        sub:'Salvar e finalizar' },
];

// ── Step indicator ────────────────────────────────────────────────────────────
function StepBar({ current, maxReached }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:0, flex:1, overflow:'hidden' }}>
      {STEPS.map((s, i) => {
        const done   = s.id < current;
        const active = s.id === current;
        const locked = s.id > maxReached;
        return (
          <React.Fragment key={s.id}>
            <div style={{ display:'flex', alignItems:'center', gap:8, opacity: locked ? .4 : 1 }}>
              <div style={{
                width:26, height:26, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center',
                flexShrink:0, fontSize:11, fontWeight:800, transition:'all .3s',
                background: done ? 'var(--gr)' : active ? 'var(--y)' : 'var(--s2)',
                color:      done ? '#fff'      : active ? '#000'    : 'var(--tm)',
                border: active ? '2px solid var(--y)' : done ? 'none' : '1px solid var(--b2)',
              }}>
                {done ? '✓' : s.id}
              </div>
              <div style={{ display:'flex', flexDirection:'column', lineHeight:1.2, minWidth:0 }}>
                <span style={{ fontSize:11.5, fontWeight: active ? 700 : 500, color: active ? 'var(--tx)' : done ? 'var(--gr)' : 'var(--tm)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                  {s.label}
                </span>
                <span style={{ fontSize:9.5, color:'var(--ts)' }}>{s.sub}</span>
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{ flex:1, height:2, background: done ? 'var(--gr)' : 'var(--b1)', margin:'0 8px', transition:'background .4s', minWidth:16 }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Confidence legend ─────────────────────────────────────────────────────────
function ConfLegend() {
  return (
    <div style={{ display:'flex', gap:16, fontSize:11, color:'var(--tm)' }}>
      <span><span style={{ color:'var(--gr)', fontWeight:700 }}>●</span> Alta (90–100%)</span>
      <span><span style={{ color:'#F59E0B', fontWeight:700 }}>●</span> Média (70–89%)</span>
      <span><span style={{ color:'var(--re)', fontWeight:700 }}>●</span> Baixa (&lt;70%)</span>
    </div>
  );
}

// ── Bottom bar ────────────────────────────────────────────────────────────────
function BottomBar({ step, onBack, onNext, onSavePending, nextLabel, nextDisabled, hint }) {
  return (
    <div style={{
      position:'sticky', bottom:0, left:0, right:0,
      background:'var(--bg)', borderTop:'1px solid var(--b1)',
      padding:'12px 28px', display:'flex', alignItems:'center', justifyContent:'space-between',
      zIndex:20,
    }}>
      <div style={{ display:'flex', gap:16, alignItems:'center' }}>
        <span style={{ fontSize:11.5, color:'var(--ts)' }}>
          <kbd style={{ background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:4, padding:'2px 6px', fontSize:10 }}>Tab</kbd> Use Tab para navegar entre campos
        </span>
        {hint && <span style={{ fontSize:11.5, color:'var(--ts)' }}>{hint}</span>}
      </div>
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <span style={{ fontSize:11, color:'var(--tm)' }}>
          <span style={{ color:'var(--y)', fontWeight:700 }}>Auto</span> preenchido automaticamente pelo OCR
        </span>
        {step > 1 && (
          <Btn variant="ghost" onClick={onBack} style={{ padding:'9px 18px' }}>← Voltar</Btn>
        )}
        {onSavePending && (
          <Btn variant="secondary" onClick={onSavePending} style={{ padding:'9px 18px', fontSize:12.5 }}>
            💾 Salvar em Pendentes
          </Btn>
        )}
        <Btn variant="primary" onClick={onNext} disabled={nextDisabled} style={{ padding:'9px 22px', fontSize:13 }}>
          {nextLabel || 'Continuar →'}
        </Btn>
      </div>
    </div>
  );
}

// ── Step 1: Dados do Chamado ──────────────────────────────────────────────────
function Step1({ form, set, cats, fabs, teamMembers, ocrConf, ocrLoading, dupWarning, snHistory,
                 clientSuggestions, onSnChange, onClientSearch, applyClient }) {
  return (
    <div style={{ padding:'24px 28px' }}>
      {import.meta.env.VITE_CLOUD_MODE === 'true' && (
        <div style={{ marginBottom:14, padding:'10px 16px', background:'rgba(96,165,250,.07)', border:'1px solid rgba(96,165,250,.2)', borderRadius:8, fontSize:12.5, color:'var(--bl)' }}>
          ☁️ <strong>Modo Cloud</strong> — Preencha os campos manualmente. OCR e leitura de fichas estão disponíveis apenas na versão desktop local.
        </div>
      )}

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18 }}>
        <div>
          <h2 style={{ fontSize:18, fontWeight:800, marginBottom:3 }}>Dados do Chamado</h2>
          <p style={{ fontSize:12.5, color:'var(--tm)' }}>Revise e complete as informações extraídas dos arquivos.</p>
        </div>
        <div style={{ textAlign:'right', fontSize:12, color:'var(--tm)' }}>
          {ocrLoading ? (
            <span style={{ display:'flex', alignItems:'center', gap:6, color:'var(--y)' }}>
              <span style={{ display:'inline-block', width:10, height:10, borderRadius:'50%', border:'2px solid var(--y)', borderTopColor:'transparent', animation:'spinAnim .7s linear infinite' }} />
              Lendo ficha OCR...
            </span>
          ) : (
            <>Confiança média: <span style={{ fontWeight:700, color: ocrConf>=90?'var(--gr)':ocrConf>=70?'#F59E0B':'var(--re)' }}>{ocrConf}%</span></>
          )}
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        <Field label={<FLabel auto pct={ocrConf} value={form.sn} loading={ocrLoading}>S/N Série</FLabel>}>
          <input value={form.sn} onChange={e => onSnChange(e.target.value)}
            placeholder="Número de série" autoFocus tabIndex={1} />
          {dupWarning && (
            <div style={{ marginTop:5, padding:'8px 10px', background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.25)', borderRadius:'var(--rs)', fontSize:11.5, color:'var(--re)' }}>
              ⚠️ S/N já possui {dupWarning.length} chamado(s) aberto(s)!
            </div>
          )}
        </Field>

        <Field label={<FLabel auto pct={95} value={form.modelo} loading={ocrLoading}>Modelo</FLabel>}>
          <input value={form.modelo} onChange={e => set('modelo',e.target.value)} placeholder="Ex: SUN-6K-SGD4LP3" tabIndex={2} />
        </Field>

        <Field label={<FLabel auto pct={ocrConf} value={form.cliente_final} loading={ocrLoading}>Cliente Final</FLabel>} style={{ gridColumn:'1/-1', position:'relative', zIndex:200 }}>
          <input value={form.cliente_final} onChange={e => onClientSearch(e.target.value,'cliente_final')} placeholder="Nome do cliente final" tabIndex={3} />
          {clientSuggestions.length > 0 && (
            <div style={{ position:'absolute', left:0, right:0, top:'100%', background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', zIndex:9500, boxShadow:'0 8px 24px rgba(0,0,0,.4)' }}>
              {clientSuggestions.map(cl => (
                <div key={cl.id} onClick={() => applyClient(cl)} style={{ padding:'9px 12px', cursor:'pointer', borderBottom:'1px solid var(--b1)', fontSize:12.5 }}
                  onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.05)'}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  <div style={{ fontWeight:600 }}>{cl.nome}</div>
                  <div style={{ fontSize:11, color:'var(--tm)' }}>{cl.tipo==='integrador'?'🔧':'👤'} {cl.telefone||''}</div>
                </div>
              ))}
            </div>
          )}
          {snHistory && (
            <div style={{ marginTop:5, padding:'7px 10px', background:'rgba(96,165,250,.07)', border:'1px solid rgba(96,165,250,.2)', borderRadius:'var(--rs)', fontSize:11, color:'var(--bl)' }}>
              📋 {snHistory.cases?.length||0} chamado(s) anteriores neste S/N
            </div>
          )}
        </Field>

        <Field label={<FLabel auto pct={92} value={form.nome} loading={ocrLoading}>Nome (Responsável)</FLabel>}>
          <input value={form.nome} onChange={e=>set('nome',e.target.value)} placeholder="Nome do responsável" tabIndex={4} />
        </Field>
        <Field label={<FLabel auto pct={95} value={form.contato} loading={ocrLoading}>WhatsApp</FLabel>}>
          <input value={form.contato} onChange={e=>set('contato',e.target.value)} placeholder="(11) 99999-0000" tabIndex={5} />
        </Field>

        <Field label={<FLabel auto pct={92} value={form.integrador} loading={ocrLoading}>Integrador</FLabel>}>
          <input value={form.integrador} onChange={e=>onClientSearch(e.target.value,'integrador')} placeholder="Nome do integrador" tabIndex={6} />
        </Field>
        <Field label={<FLabel auto pct={95} value={form.tel_integrador} loading={ocrLoading}>Tel. Integrador</FLabel>}>
          <input value={form.tel_integrador} onChange={e=>set('tel_integrador',e.target.value)} placeholder="(11) 98888-7777" tabIndex={7} />
        </Field>

        <Field label={<FLabel auto pct={96} value={form.categoria} loading={ocrLoading}>Categoria</FLabel>}>
          <select
            value={form.categoria}
            onChange={e => {
              const selectedNome = e.target.value;
              set('categoria', selectedNome);
              // Also update fabs immediately
              const cat = cats.find(c => c.nome === selectedNome);
              setFabs(cat?.fabricantes || []);
            }}
            tabIndex={8}
          >
            <option value="">Selecione...</option>
            {cats.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
          </select>
        </Field>
        <Field label={<FLabel auto pct={92} value={form.fabricante} loading={ocrLoading}>Fabricante</FLabel>}>
          <select value={form.fabricante} onChange={e=>set('fabricante',e.target.value)} tabIndex={9}>
            <option value="">Selecione...</option>
            {fabs.map(f => <option key={f.id} value={f.nome}>{f.nome}</option>)}
          </select>
        </Field>

        <Field label={<>Atribuir para <span style={{ fontSize:9.5, background:'rgba(255,215,0,.1)', color:'var(--y)', padding:'1px 6px', borderRadius:999, fontWeight:700 }}>Auto</span></>} style={{ gridColumn:'1/-1' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:'var(--rs)' }}>
            <Avatar name={form.assigned_to || form.nome || '?'} size={28} />
            <select value={form.assigned_to||''} onChange={e=>set('assigned_to',e.target.value)}
              style={{ flex:1, background:'transparent', border:'none', color:'var(--tx)', fontSize:13, outline:'none', fontFamily:'inherit' }} tabIndex={10}>
              <option value="">— Sem atribuição —</option>
              {teamMembers.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
            <button style={{ background:'none', border:'none', color:'var(--bl)', cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>Alterar responsável</button>
          </div>
        </Field>

        <Field label={<FLabel auto pct={80} value={form.relato} loading={ocrLoading}>Relato do problema</FLabel>} style={{ gridColumn:'1/-1' }}>
          <textarea value={form.relato} onChange={e=>set('relato',e.target.value)}
            placeholder="Descreva o problema relatado pelo cliente..."
            rows={4} maxLength={1000} tabIndex={11} />
          <div style={{ textAlign:'right', fontSize:10.5, color:'var(--ts)', marginTop:3 }}>{(form.relato||'').length}/1000</div>
        </Field>
      </div>
    </div>
  );
}

// ── Step 2: Protocolo ─────────────────────────────────────────────────────────
function Step2({ form, set, ven, caseId }) {
  return (
    <div style={{ padding:'24px 28px' }}>
      <h2 style={{ fontSize:18, fontWeight:800, marginBottom:4 }}>Protocolo</h2>
      <p style={{ fontSize:12.5, color:'var(--tm)', marginBottom:22 }}>Dados do equipamento e protocolo de atendimento.</p>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, maxWidth:700 }}>
        <Field label={<FLabel auto pct={97} value={form.ven || ven}>Código VEN</FLabel>}>
          <input value={form.ven || ven || ''} onChange={e=>set('ven',e.target.value)} placeholder="VEN-2024-0891" tabIndex={1} />
        </Field>
        {/* #8 — internal protocol number = case ID, same as PDF report */}
        <Field label="Número do Protocolo" hint="ID interno do chamado (igual ao relatório PDF)">
          <input
            value={caseId ? `#${caseId}` : ''}
            readOnly
            placeholder="Gerado ao salvar"
            style={{ color: caseId ? 'var(--tx)' : 'var(--ts)', cursor:'default' }}
            tabIndex={2}
          />
        </Field>
        <Field label="Data de Abertura">
          <input type="date" value={form.data_abertura || new Date().toISOString().slice(0,10)} onChange={e=>set('data_abertura',e.target.value)} tabIndex={3} />
        </Field>
        <Field label="Prioridade">
          <select value={form.priority||'normal'} onChange={e=>set('priority',e.target.value)} tabIndex={4}>
            <option value="low">Baixa</option>
            <option value="normal">Normal</option>
            <option value="high">Alta</option>
          </select>
        </Field>
      </div>
    </div>
  );
}

// ── Step 3: Checklist ─────────────────────────────────────────────────────────
function Step3({ form, set, ripples, setRipples, folderPath, folderFiles }) {
  const required = CHECKLIST.filter(c => c.required);
  const checked  = CHECKLIST.filter(c => form[c.id]).length;
  const reqDone  = required.filter(c => form[c.id]).length;
  const allReq   = reqDone === required.length;
  const progress = Math.round(checked / CHECKLIST.length * 100);

  // Auto-detect checklist items from actual files in the folder
  useEffect(() => {
    if (!folderFiles?.length) return;
    const names = folderFiles.map(f => f.name.toLowerCase());
    const updates = {};
    if (names.some(n => n.includes('nf') || n.includes('nota'))) updates.f_nf = true;
    if (names.some(n => n.includes('unif'))) updates.f_un = true;
    if (names.some(n => n.includes('etiq'))) updates.f_et = true;
    if (names.some(n => n.includes('vcc') || n.includes('v_cc'))) updates.f_vcc = true;
    if (names.some(n => n.includes('vca') || n.includes('video_ca') || n.includes('vídeo_ca'))) updates.f_vca = true;
    if (names.some(n => n.includes('amplo') || n.includes('video_a'))) updates.f_va = true;
    if (names.some(n => n.includes('ficha'))) { updates.f_fi = true; }
    Object.entries(updates).forEach(([k,v]) => set(k, v));
  }, [folderFiles]);

  return (
    <div style={{ padding:'24px 28px', display:'grid', gridTemplateColumns:'1fr 340px', gap:24 }}>
      {/* Left: checklist items */}
      <div>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
          <h2 style={{ fontSize:18, fontWeight:800 }}>Checklist de documentos</h2>
          <span style={{ fontSize:13, fontWeight:700, color: allReq ? 'var(--gr)' : 'var(--y)' }}>
            {checked}/{CHECKLIST.length}
          </span>
        </div>

        {/* Progress bar */}
        <div style={{ height:6, background:'var(--s2)', borderRadius:999, marginBottom:16, overflow:'hidden' }}>
          <div style={{
            height:'100%', borderRadius:999, width:`${progress}%`,
            background: allReq ? 'var(--gr)' : 'linear-gradient(90deg,var(--y),var(--y2))',
            transition:'width .4s cubic-bezier(0.34,1.56,0.64,1), background .5s',
          }} />
        </div>

        {/* Items */}
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {CHECKLIST.map((item) => {
            const on = form[item.id];
            const ripple = ripples[item.id];
            // Find matching files from real folder
            const matchingFiles = (folderFiles||[]).filter(f => {
              const n = f.name.toLowerCase();
              if (item.id==='f_nf')  return n.includes('nf') || n.includes('nota');
              if (item.id==='f_un')  return n.includes('unif');
              if (item.id==='f_et')  return n.includes('etiq');
              if (item.id==='f_vcc') return n.includes('vcc') || n.includes('v_cc');
              if (item.id==='f_vca') return n.includes('vca') || n.includes('video_ca');
              if (item.id==='f_va')  return n.includes('amplo') || n.includes('video_a');
              if (item.id==='f_fi')  return n.includes('ficha');
              return false;
            });
            return (
              <label key={item.id} style={{ cursor:'pointer', display:'block' }}>
                <input type="checkbox" checked={on} onChange={e => {
                  set(item.id, e.target.checked);
                  const rid = Date.now();
                  setRipples(r => ({...r,[item.id]:rid}));
                  setTimeout(() => setRipples(r => r[item.id]===rid?{...r,[item.id]:null}:r), 600);
                }} style={{ display:'none' }} />
                <div style={{
                  display:'flex', alignItems:'center', gap:12, padding:'12px 16px',
                  background: on ? 'rgba(34,197,94,.06)' : 'var(--s1)',
                  border:`1.5px solid ${on?'rgba(34,197,94,.35)':'var(--b2)'}`,
                  borderRadius:'var(--rs)', transition:'all .2s', position:'relative', overflow:'hidden',
                  animation: on ? 'springIn .35s cubic-bezier(0.34,1.56,0.64,1) both' : 'none',
                }}>
                  {ripple && <span style={{ position:'absolute', inset:0, background: on?'rgba(34,197,94,.15)':'rgba(255,255,255,.08)', animation:'ripple .5s ease-out', pointerEvents:'none' }} />}
                  <div style={{
                    width:22, height:22, borderRadius:'50%', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
                    background: on ? 'var(--gr)' : 'var(--s2)',
                    border: `2px solid ${on?'var(--gr)':'var(--b2)'}`,
                    transition:'all .2s',
                  }}>
                    {on && <span style={{ color:'#fff', fontSize:11, fontWeight:800 }}>✓</span>}
                  </div>
                  <span style={{ fontSize:14 }}>{item.icon}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:600, color: on ? 'var(--tx)' : 'var(--ts)' }}>{item.label}</div>
                    {matchingFiles.length > 0 && (
                      <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {matchingFiles[0].name}
                      </div>
                    )}
                  </div>
                  {!item.required && <span style={{ fontSize:10.5, background:'rgba(245,158,11,.1)', color:'#F59E0B', padding:'2px 7px', borderRadius:999, fontWeight:600 }}>Opcional</span>}
                  {on && <span style={{ fontSize:11, color:'var(--gr)', fontWeight:600 }}>{matchingFiles.length || 1} arquivo</span>}
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {/* Right: real files from folder */}
      <div>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
          <h3 style={{ fontSize:14, fontWeight:700 }}>Arquivos na pasta</h3>
          <span style={{ fontSize:12, color:'var(--tm)' }}>{(folderFiles||[]).length} arquivo{(folderFiles||[]).length!==1?'s':''}</span>
        </div>

        {folderFiles?.length === 0 && (
          <div style={{ textAlign:'center', color:'var(--tm)', fontSize:12.5, padding:'20px 0', fontStyle:'italic' }}>
            Nenhum arquivo encontrado na pasta selecionada.
          </div>
        )}

        <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight:380, overflowY:'auto' }}>
          {(folderFiles||[]).map(f => {
            const isVideo  = /\.(mp4|mov|avi|mkv)$/i.test(f.name);
            const isPdf    = /\.pdf$/i.test(f.name);
            const icon     = isVideo ? '🎥' : isPdf ? '📄' : '📁';
            const sizeMB   = f.size ? (f.size > 1024*1024 ? (f.size/1024/1024).toFixed(1)+' MB' : Math.round(f.size/1024)+' KB') : '';
            return (
              <a key={f.id||f.name} href={f.webViewLink||'#'} target="_blank" rel="noreferrer"
                style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 12px', background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--rs)', textDecoration:'none' }}>
                <span style={{ fontSize:16, flexShrink:0 }}>{icon}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:11.5, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'var(--tx)' }}>{f.name}</div>
                  {sizeMB && <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:1 }}>{sizeMB}</div>}
                </div>
                <span style={{ fontSize:10.5, color:'var(--bl)', flexShrink:0 }}>↗</span>
              </a>
            );
          })}
        </div>

        {folderPath && (
          <a href={`https://drive.google.com/drive/folders/${folderPath.split('/').pop()}`}
            target="_blank" rel="noreferrer"
            style={{ marginTop:10, display:'block', background:'none', border:'none', color:'var(--bl)', cursor:'pointer', fontSize:12, fontFamily:'inherit', textDecoration:'none', textAlign:'left' }}>
            Ver todos os arquivos no Drive →
          </a>
        )}
      </div>
    </div>
  );
}

// ── Step 4: Revisão ───────────────────────────────────────────────────────────
function Step4({ form, checked, cats }) {
  const missing = CHECKLIST.filter(c => c.required && !form[c.id]).length;

  // Resolve categoria ID → name
  const catName = (() => {
    const v = form.categoria;
    if (!v) return '—';
    if (/^\d+$/.test(String(v))) {
      const found = cats.find(c => String(c.id) === String(v));
      return found?.nome || v;
    }
    return v;
  })();

  const fields = [
    ['S/N SÉRIE',    form.sn],
    ['MODELO',       form.modelo],
    ['CLIENTE FINAL', form.cliente_final || form.integrador || '—'],
    ['RESPONSÁVEL',  form.nome],
    ['INTEGRADOR',   form.integrador],
    ['CATEGORIA',    catName],
    ['FABRICANTE',   form.fabricante],
    ['WHATSAPP',     form.contato],
  ];
  return (
    <div style={{ padding:'24px 28px' }}>
      <h2 style={{ fontSize:18, fontWeight:800, marginBottom:4 }}>Revisão do Chamado</h2>
      <p style={{ fontSize:12.5, color:'var(--tm)', marginBottom:20 }}>Confirme todos os dados antes de finalizar.</p>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
        {fields.map(([label, val]) => (
          <div key={label} style={{ padding:'13px 16px', background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--rs)' }}>
            <div style={{ fontSize:9.5, fontWeight:700, color:'var(--ts)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:5 }}>{label}</div>
            <div style={{ fontSize:13.5, fontWeight:600, color:'var(--tx)' }}>{val || '—'}</div>
          </div>
        ))}
      </div>

      {form.relato && (
        <div style={{ padding:'13px 16px', background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--rs)', marginBottom:14 }}>
          <div style={{ fontSize:9.5, fontWeight:700, color:'var(--ts)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:6 }}>RELATO</div>
          <div style={{ fontSize:13, color:'var(--tx)' }}>{form.relato}</div>
        </div>
      )}

      {missing > 0 ? (
        <div style={{ padding:'13px 16px', background:'rgba(245,158,11,.07)', border:'1px solid rgba(245,158,11,.3)', borderRadius:'var(--rs)', display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:16 }}>⚠️</span>
          <span style={{ fontSize:13, color:'#F59E0B', fontWeight:600 }}>Checklist incompleto — {missing} item(s) faltando.</span>
        </div>
      ) : (
        <div style={{ padding:'13px 16px', background:'rgba(34,197,94,.07)', border:'1px solid rgba(34,197,94,.25)', borderRadius:'var(--rs)', display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:16 }}>✅</span>
          <span style={{ fontSize:13, color:'var(--gr)', fontWeight:600 }}>Checklist completo — pronto para finalizar!</span>
        </div>
      )}
    </div>
  );
}

// ── Step 5: Conclusão ─────────────────────────────────────────────────────────
function Step5({ onNew, onHistory, result }) {
  return (
    <div style={{ padding:'60px 28px', textAlign:'center' }}>
      <div style={{
        width:80, height:80, borderRadius:'50%', margin:'0 auto 24px',
        background:'rgba(34,197,94,.12)', border:'2px solid rgba(34,197,94,.35)',
        display:'flex', alignItems:'center', justifyContent:'center', fontSize:36,
        animation:'springIn .6s cubic-bezier(0.34,1.56,0.64,1)',
      }}>✓</div>
      <h2 style={{ fontSize:28, fontWeight:800, marginBottom:8, color:'var(--gr)' }}>Chamado Registrado!</h2>
      <p style={{ fontSize:14, color:'var(--tm)', maxWidth:440, margin:'0 auto 24px' }}>
        O chamado foi salvo com sucesso e enviado ao Google Drive.
      </p>

      {/* Result links */}
      {result && (
        <div style={{ display:'flex', gap:10, justifyContent:'center', flexWrap:'wrap', marginBottom:28 }}>
          {result.jiraKey && (
            <a href={result.jiraUrl||'#'} target="_blank" rel="noreferrer" style={{
              display:'inline-flex', alignItems:'center', gap:8,
              padding:'10px 20px', borderRadius:'var(--rs)',
              background:'rgba(96,165,250,.1)', border:'1px solid rgba(96,165,250,.3)',
              color:'var(--bl)', textDecoration:'none', fontWeight:700, fontSize:14,
            }}>
              🔗 Jira: {result.jiraKey}
            </a>
          )}
          {result.driveUrl && (
            <a href={result.driveUrl} target="_blank" rel="noreferrer" style={{
              display:'inline-flex', alignItems:'center', gap:8,
              padding:'10px 20px', borderRadius:'var(--rs)',
              background:'rgba(34,197,94,.1)', border:'1px solid rgba(34,197,94,.3)',
              color:'var(--gr)', textDecoration:'none', fontWeight:700, fontSize:14,
            }}>
              ☁️ Pasta no Drive
            </a>
          )}
          {result.caseId && (
            <a href={`/api/reports/case/${result.caseId}?token=${localStorage.getItem('session_token')}`}
              target="_blank" rel="noreferrer" style={{
              display:'inline-flex', alignItems:'center', gap:8,
              padding:'10px 20px', borderRadius:'var(--rs)',
              background:'rgba(255,215,0,.08)', border:'1px solid rgba(255,215,0,.2)',
              color:'var(--y)', textDecoration:'none', fontWeight:700, fontSize:14,
            }}>
              📄 Relatório PDF
            </a>
          )}
        </div>
      )}

      <div style={{ display:'flex', gap:12, justifyContent:'center' }}>
        <Btn variant="secondary" onClick={onNew} style={{ padding:'12px 28px', fontSize:14 }}>Novo Chamado</Btn>
        <Btn variant="primary"   onClick={onHistory} style={{ padding:'12px 28px', fontSize:14 }}>Ver no Histórico →</Btn>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIST TABS (unchanged functionality)
// ═══════════════════════════════════════════════════════════════════════════════

function CaseListTabs({
  pendentes, adb, concluidos, activeTab, setTab,
  adbRefs, finalizingId, timelineOpen, setTimelineOpen,
  deleteCase, finalizeCard, loadLists,
}) {
  const TABS = [
    { id:'pendentes',  label:'🟠 Pendentes',  count: pendentes.length },
    { id:'adb',        label:'🔵 Protocolo',  count: adb.length },
    { id:'concluidos', label:'🟢 Concluídos', count: concluidos.length },
  ];

  return (
    <div>
      {/* Tab bar */}
      <div style={{ display:'flex', gap:4, marginBottom:14, borderBottom:'1px solid var(--b1)', paddingBottom:0 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding:'10px 18px', border:'none', background:'none', cursor:'pointer', fontFamily:'inherit',
            fontSize:13, fontWeight: activeTab===t.id ? 700 : 500,
            color: activeTab===t.id ? 'var(--tx)' : 'var(--tm)',
            borderBottom: activeTab===t.id ? '2px solid var(--y)' : '2px solid transparent',
            marginBottom:-1, transition:'all .15s',
          }}>
            {t.label} {t.count > 0 && <span style={{ fontSize:10.5, background:'var(--s2)', padding:'1px 6px', borderRadius:999, marginLeft:4 }}>{t.count}</span>}
          </button>
        ))}
      </div>

      {/* Pendentes */}
      {activeTab === 'pendentes' && (
        <div>
          {pendentes.length === 0 && <div style={{ textAlign:'center', color:'var(--tm)', padding:'28px 0', fontSize:13 }}>Nenhum chamado pendente</div>}
          {pendentes.map(c => (
            <div key={c.id} style={{
              background:'var(--s1)', border:`1px solid ${c.sla_status==='critical'?'rgba(239,68,68,.3)':c.sla_status==='warning'?'rgba(245,158,11,.2)':'var(--b1)'}`,
              borderRadius:'var(--rs)', padding:'12px 16px', marginBottom:7,
              animation: finalizingId===c.id ? 'flashGreen .3s ease, slideRight .5s .28s ease forwards' : 'none',
              overflow:'hidden',
            }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div style={{ display:'flex', alignItems:'center', gap:10, flex:1, minWidth:0 }}>
                  <div style={{ width:8, height:8, borderRadius:'50%', background:'#F59E0B', flexShrink:0 }} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:600, display:'flex', alignItems:'center', gap:7, flexWrap:'wrap' }}>
                      {c.integrador || c.cliente_final || c.nome}
                      <span style={{ color:'var(--tm)', fontWeight:400 }}>| {c.contato}</span>
                      <SlaIndicator slaStatus={c.sla_status} createdAt={c.created_at} />
                      {c.assigned_to && <span style={{ fontSize:10.5, background:'rgba(96,165,250,.1)', color:'var(--bl)', padding:'1px 7px', borderRadius:999, fontWeight:600 }}>👤 {c.assigned_to}</span>}
                      {c.jira_key && <span style={{ fontSize:10.5, background:'rgba(96,165,250,.08)', color:'var(--bl)', padding:'1px 7px', borderRadius:999, fontWeight:700, border:'1px solid rgba(96,165,250,.2)' }}>🔗 {c.jira_key}</span>}
                    </div>
                    <div style={{ fontSize:11.5, color:'var(--tm)', marginTop:2 }}>{c.fabricante} · {c.modelo||c.sn}</div>
                  </div>
                </div>
                <div style={{ display:'flex', gap:5, flexShrink:0 }}>
                  <Btn variant="ghost" style={{ fontSize:11, padding:'5px 9px' }} onClick={() => setTimelineOpen(timelineOpen===c.id?null:c.id)}>{timelineOpen===c.id?'▲':'💬'}</Btn>
                  <a href={`/api/reports/case/${c.id}?token=${localStorage.getItem('session_token')}`} target="_blank" rel="noreferrer"
                    style={{ display:'inline-flex', alignItems:'center', padding:'5px 9px', background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', fontSize:11, color:'var(--tm)', textDecoration:'none' }}>📄</a>
                  <Btn variant="danger" style={{ fontSize:11, padding:'5px 9px' }} onClick={() => deleteCase(c.id)}>✕</Btn>
                </div>
              </div>
              <CaseTimeline caseId={c.id} visible={timelineOpen===c.id} />
            </div>
          ))}
        </div>
      )}

      {/* Protocolo (ADB) */}
      {activeTab === 'adb' && (
        <div>
          {adb.length === 0 && <div style={{ textAlign:'center', color:'var(--tm)', padding:'28px 0', fontSize:13 }}>Nenhum chamado aguardando protocolo</div>}
          {adb.map(c => (
            <div key={c.id} style={{ background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--rs)', padding:'13px 16px', marginBottom:7 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                <div style={{ fontSize:13, fontWeight:600 }}>
                  {c.integrador || c.cliente_final || c.nome}
                  <span style={{ color:'var(--tm)', fontWeight:400 }}> | {c.sn}</span>
                  {c.assigned_to && <span style={{ fontSize:10.5, background:'rgba(96,165,250,.1)', color:'var(--bl)', padding:'1px 7px', borderRadius:999, fontWeight:600, marginLeft:8 }}>👤 {c.assigned_to}</span>}
                  {c.jira_key && <span style={{ fontSize:10.5, background:'rgba(96,165,250,.08)', color:'var(--bl)', padding:'1px 7px', borderRadius:999, fontWeight:700, border:'1px solid rgba(96,165,250,.2)', marginLeft:6 }}>🔗 {c.jira_key}</span>}
                </div>
                <a href={`/api/reports/case/${c.id}?token=${localStorage.getItem('session_token')}`} target="_blank" rel="noreferrer"
                  style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'5px 10px', background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', fontSize:11.5, color:'var(--tm)', textDecoration:'none', fontWeight:600 }}>📄 PDF</a>
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <input ref={el => adbRefs.current[c.id]=el} defaultValue={c.adb_number||c.jira_key||''} placeholder="Protocolo / Código ADB..." style={{ flex:1, fontSize:13 }} />
                <Btn variant="success" onClick={async () => {
                  const val = adbRefs.current[c.id]?.value || '';
                  await api(`/api/cases/${c.id}`, { method:'PUT', body: JSON.stringify({ status:'Concluído', adb_number:val }) });
                  loadLists();
                }}>✓ Concluir</Btn>
                {c.drive_id && <DrivePreview driveId={c.drive_id} />}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Concluídos */}
      {activeTab === 'concluidos' && (
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr>{['Data','Nome','S/N','Fabricante','Status',''].map(h => (
                <th key={h} style={{ textAlign:'left', padding:'10px 14px', background:'var(--s2)', color:'var(--tm)', fontSize:10.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', borderBottom:'1px solid var(--b1)' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {concluidos.map(c => (
                <tr key={c.id}>
                  <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--b1)', color:'var(--tm)' }}>{c.data}</td>
                  <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--b1)' }}>{c.nome}</td>
                  <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--b1)', fontFamily:'monospace', fontSize:12 }}>{c.sn}</td>
                  <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--b1)', color:'var(--tm)' }}>{c.fabricante}</td>
                  <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--b1)' }}><StatusBadge status={c.status} /></td>
                  <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--b1)' }}>
                    <a href={`/api/reports/case/${c.id}?token=${localStorage.getItem('session_token')}`} target="_blank" rel="noreferrer"
                      style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'4px 9px', background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', fontSize:11, color:'var(--tm)', textDecoration:'none', fontWeight:600 }}>📄 PDF</a>
                  </td>
                </tr>
              ))}
              {concluidos.length === 0 && <tr><td colSpan={6} style={{ padding:'28px', textAlign:'center', color:'var(--tm)' }}>Nenhum chamado concluído</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN REGISTRO COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function Registro({
  showToast, selectedFolder, folderPath, setFolderPath,
  allProducts, editCase, setEditCase, onRefresh,
  driveProgress, setDriveProgress, user, onNavigate, onFolderChange,
}) {
  const [form, setForm]   = useState(emptyForm());
  const [step, setStep]   = useState(1);
  const [maxReached, setMaxReached] = useState(1);
  const [ven, setVen]     = useState('---');
  const [ficha, setFicha]     = useState(null);
  const [ocrLoading, setOcrLoading] = useState(false); // true while ficha is being parsed
  const [cats, setCats]   = useState([]);
  const [fabs, setFabs]   = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [ocrConf, setOcrConf] = useState(92);

  // List state
  const [activeTab, setTab]         = useState('pendentes');
  const [pendentes, setPendentes]   = useState([]);
  const [adb, setAdb]               = useState([]);
  const [concluidos, setConcluidos] = useState([]);
  const [folderFiles, setFolderFiles] = useState([]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [savedCaseId, setSavedCaseId] = useState(null); // internal case ID for Step2 protocol

  // Animation / interaction state
  const adbRefs    = useRef({});
  const [snHistory, setSnHistory]       = useState(null);
  const [dupWarning, setDupWarning]     = useState(null);
  const [clientSuggestions, setClientSuggestions] = useState([]);
  const [timelineOpen, setTimelineOpen] = useState(null);
  const [finalizingId, setFinalizingId] = useState(null);
  const [ripples, setRipples]           = useState({});
  const prevChecked = useRef(0);
  const snTimer  = useRef(null);
  const cliTimer = useRef(null);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Products → categories/fabricantes
  useEffect(() => {
    if (!allProducts?.length) return;
    setCats(allProducts);
    if (!form.categoria) setFabs(allProducts[0]?.fabricantes || []);
  }, [allProducts]);

  useEffect(() => {
    // Match by name OR by id (handles both storage formats)
    const cat = cats.find(c => c.nome === form.categoria || String(c.id) === String(form.categoria));
    setFabs(cat?.fabricantes || []);
  }, [form.categoria, cats]);

  useEffect(() => { loadLists(); loadTeam(); }, []);

  async function loadLists() {
    const cases = await api('/api/cases').catch(() => []);
    const arr = Array.isArray(cases) ? cases : [];
    setPendentes(arr.filter(c => c.status === 'Pendente Itens'));
    setAdb(arr.filter(c => c.status === 'Aguardando Protocolo'));
    setConcluidos(arr.filter(c => c.status === 'Concluído').slice(0, 30));
  }

  async function loadTeam() {
    const cases = await api('/api/cases/stats').catch(() => []);
    const names = [...new Set((cases||[]).map(c => c.nome||c.user_name).filter(Boolean))].slice(0,20);
    setTeamMembers(names);
  }

  // SN lookup
  // SN duplicate check — fires on BOTH user input and auto-fill from ficha
  const snCheckTimer = useRef(null);
  useEffect(() => {
    const sn = form.sn;
    if (!sn || sn.length < 4) { setDupWarning(null); return; }
    clearTimeout(snCheckTimer.current);
    snCheckTimer.current = setTimeout(async () => {
      const allCases = await api('/api/cases').catch(() => []);
      const dups = (allCases || []).filter(c =>
        c.sn === sn &&
        c.status !== 'Concluído' &&
        (!editCase || c.id !== editCase.id)
      );
      setDupWarning(dups.length > 0 ? dups : null);
    }, 500);
    return () => clearTimeout(snCheckTimer.current);
  }, [form.sn, editCase]);

  async function onSnChange(val) {
    set('sn', val);
    // Also look up equipment history
    clearTimeout(snTimer.current);
    if (val.length < 4) { setSnHistory(null); return; }
    snTimer.current = setTimeout(async () => {
      const results = await api(`/api/equipment?sn=${encodeURIComponent(val)}`).catch(() => []);
      if (results.length > 0) {
        const detail = await api(`/api/equipment/${results[0].id}`).catch(() => null);
        setSnHistory(detail);
        setForm(f => ({
          ...f,
          equipment_id:  results[0].id,
          modelo:        detail?.modelo && !f.modelo ? detail.modelo : f.modelo,
          fabricante:    detail?.fabricante && !f.fabricante ? detail.fabricante : f.fabricante,
          cliente_final: detail?.client?.nome && !f.cliente_final ? detail.client.nome : f.cliente_final,
        }));
      } else setSnHistory(null);
    }, 600);
  }

  // Client autocomplete
  async function onClientSearch(val, field) {
    set(field, val);
    clearTimeout(cliTimer.current);
    if (val.length < 2) { setClientSuggestions([]); return; }
    cliTimer.current = setTimeout(async () => {
      const results = await api(`/api/clients?q=${encodeURIComponent(val)}`).catch(() => []);
      setClientSuggestions(results.slice(0, 5));
    }, 400);
  }

  function applyClient(cl) {
    setForm(f => ({
      ...f,
      cliente_final:  cl.nome || f.cliente_final,
      integrador:     cl.tipo==='integrador' ? cl.nome : f.integrador,
      contato:        cl.telefone || f.contato,
      tel_integrador: cl.telefone || f.tel_integrador,
      client_id:      cl.id,
    }));
    setClientSuggestions([]);
  }

  // Folder → VEN + ficha OCR auto-fill + file listing
  useEffect(() => {
    if (!selectedFolder || selectedFolder === 'Nenhuma' || selectedFolder === '') {
      setVen('---'); setFicha(null); setFolderPath(null); setFolderFiles([]); setOcrLoading(false); return;
    }
    const name = selectedFolder.replace(/^📌 /, '').trim();
    if (!name) return;

    api('/api/files/audit', { method:'POST', body: JSON.stringify({ folderName: name }) })
      .then(({ folderPath: fp }) => {
        if (!fp) return;
        setFolderPath(fp);

        // 1. VEN code detection
        api('/api/files/ven', { method:'POST', body: JSON.stringify({ folderPath: fp }) })
          .then(({ ven: v }) => {
            setVen(v || '---');
            if (v && !v.startsWith('⚠️') && v !== '---') {
              set('f_nf', true);
              showToast('✅ VEN detectado — NF marcada automaticamente', 'info', 2500);
            } else {
              // Fallback NF detection
              api('/api/files/nf-testes', { method:'POST', body: JSON.stringify({ folderPath: fp }) })
                .then(r => {
                  if (r.found) {
                    setVen(r.value); set('f_nf', true);
                    showToast(`✅ NF encontrada via ${r.method==='ocr'?'OCR':'IA'}: ${r.value}`, 'info', 3500);
                  }
                }).catch(() => {});
            }
          }).catch(() => {});

        // 2. Ficha OCR → auto-fill form
        setOcrLoading(true);
        api('/api/files/ficha', { method:'POST', body: JSON.stringify({ folderPath: fp }) })
          .then(data => {
            setOcrLoading(false);
            if (!data || data.error) return;
            setFicha(data);
            set('f_fi', true);

            setForm(f => {
              const u = { ...f };

              // #1 — model: OCR returns data.model (not data.modelo)
              const rawModel = data.model || data.modelo || '';
              if (rawModel && !f.modelo) u.modelo = rawModel;

              // Basic fields
              if (data.sn            && !f.sn)           u.sn            = data.sn;
              if (data.cliente_final && !f.cliente_final) u.cliente_final = data.cliente_final;
              if (data.cliente       && !f.cliente_final) u.cliente_final = data.cliente;
              if (data.integrador    && !f.integrador)    u.integrador    = data.integrador;
              if (data.tel_integrador && !f.tel_integrador) u.tel_integrador = data.tel_integrador;
              if (data.relato        && !f.relato)        u.relato        = data.relato;
              // #2 — do NOT fill nome (Responsável) or contato (WhatsApp) from ficha

              // #3 — Brand detection from ficha_name + model prefix
              if (!f.fabricante) {
                const fichaText = (data.ficha_name || '').toLowerCase();
                const modelText = (rawModel || '').toUpperCase();
                let brand = null;
                if (fichaText.includes('deye') || modelText.startsWith('SUN-') || modelText.includes('SGD') || modelText.includes('SG04'))
                  brand = 'Deye';
                else if (fichaText.includes('foxess') || modelText.startsWith('H3-') || modelText.startsWith('H5-') || modelText.startsWith('H7-'))
                  brand = 'FoxESS';
                else if (fichaText.includes('sungrow') || modelText.startsWith('SG') && modelText.includes('MWT'))
                  brand = 'Sungrow';
                else if (fichaText.includes('growatt') || modelText.startsWith('MIC') || modelText.startsWith('MAX-'))
                  brand = 'Growatt';
                else if (fichaText.includes('goodwe') || modelText.startsWith('GW'))
                  brand = 'GoodWe';
                else if (fichaText.includes('solis') || modelText.startsWith('S6-'))
                  brand = 'Solis';
                else if (fichaText.includes('hoymiles') || modelText.startsWith('HM-') || modelText.startsWith('HMS-'))
                  brand = 'Hoymiles';
                if (brand) u.fabricante = brand;
              }

              // #3 — Category from model power rating
              if (!f.categoria && rawModel) {
                const kw = parsePowerKw(rawModel);
                if (kw !== null) {
                  u.categoria = kw >= 2.5 ? 'Inversor' : 'Micro';
                }
              }

              return u;
            });

            const filled = [data.sn, data.model||data.modelo, data.cliente_final||data.cliente, data.integrador].filter(Boolean).length;
            if (filled > 0) showToast(`📋 Ficha lida — ${filled} campos preenchidos`, 'info', 3000);
          }).catch(() => {});

        // 3. List real files for Step3 right panel
        api('/api/files/list-folder', { method:'POST', body: JSON.stringify({ folderPath: fp }) })
          .then(res => { if (Array.isArray(res.files)) setFolderFiles(res.files); })
          .catch(() => {
            // Try alternate endpoint
            api(`/api/drive/folder-files/${encodeURIComponent(fp.split('\\').pop()||fp.split('/').pop())}`)
              .then(res => { if (Array.isArray(res.files)) setFolderFiles(res.files); })
              .catch(() => {});
          });

      }).catch(() => {});
  }, [selectedFolder]);

  // Restore edit case
  useEffect(() => {
    if (!editCase) return;
    setForm({
      ...emptyForm(), ...editCase,
      f_vcc: !!(editCase.v_cc || editCase.f_vcc),
      f_vca: !!(editCase.v_ca || editCase.f_vca),
    });
    setStep(1); setMaxReached(4);
    loadLists();
  }, [editCase]);

  // Checklist stats
  const checked    = CHECKLIST.filter(c => form[c.id]).length;
  const allChecked = checked === CHECKLIST.length;

  // Confetti on complete
  useEffect(() => {
    if (allChecked && prevChecked.current < CHECKLIST.length) {
      confetti(window.innerWidth/2, window.innerHeight/3);
    }
    prevChecked.current = checked;
  }, [allChecked, checked]);

  const [lastResult, setLastResult] = useState(null);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) goNext();
      // Ctrl+Shift+A = Rapid Audit (auto-fill from latest AGUARDANDO folder)
      if (e.key === 'A' && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        rapidAudit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [step, form]);

  function goNext() {
    if (step < 5) {
      const next = step + 1;
      setStep(next);
      setMaxReached(m => Math.max(m, next));
      window.scrollTo({ top:0, behavior:'smooth' });
    }
  }
  function goBack() {
    if (step > 1) { setStep(step - 1); window.scrollTo({ top:0, behavior:'smooth' }); }
  }
  function resetWizard() {
    setForm(emptyForm()); setEditCase?.(null); setStep(1); setMaxReached(1);
    setVen('---'); setFicha(null); setSnHistory(null); setDupWarning(null);
    loadLists();
  }

  async function rapidAudit() {
    try {
      showToast('⚡ Buscando última pasta...', 'info', 2000);

      // Get folders — sorted reverse chronological, so first AGUARDANDO is newest
      const folders = await api('/api/files/folders').catch(() => ({ organized:[] }));
      const aguardandoList = (folders.organized||[]).filter(f => f.startsWith('AGUARDANDO'));
      if (!aguardandoList.length) return showToast('Nenhuma pasta AGUARDANDO encontrada', 'warn');
      const aguardando = aguardandoList[0]; // first = latest (API returns reverse sorted)

      showToast(`⚡ Auditoria rápida: ${aguardando}`, 'info', 3000);

      // 1. Register audit folder (sets edit_mode.tmp)
      const auditRes = await api('/api/files/audit', {
        method: 'POST',
        body: JSON.stringify({ folderName: aguardando })
      }).catch(() => null);
      const fp = auditRes?.folderPath;
      if (!fp) return showToast('Erro ao acessar pasta — verifique se o servidor local está rodando', 'warn');

      // 2. Update both folderPath (for this component) and selectedFolder (for sidebar)
      setFolderPath(fp);
      onFolderChange?.(aguardando); // update App-level selectedFolder + sidebar

      // 3. Vision autoscan — read label
      const vision = await api('/api/vision/autoscan-folder', {
        method: 'POST',
        body: JSON.stringify({ folderPath: fp })
      }).catch(() => null);
      if (vision?.isLabel) {
        setForm(f => ({
          ...f,
          fabricante: vision.fabricante || f.fabricante,
          categoria:  vision.categoria  || f.categoria,
          sn:         vision.sn         || f.sn,
          modelo:     vision.modelo     || f.modelo,
        }));
        showToast(`🔍 Etiqueta lida: ${vision.fabricante || ''} ${vision.sn || ''}`, 'info', 3000);
      }

      // 4. VEN extraction
      const venRes = await api('/api/files/ven', {
        method: 'POST',
        body: JSON.stringify({ folderPath: fp })
      }).catch(() => null);
      if (venRes?.ven && venRes.ven !== '---' && venRes.ven !== '⚠️ VEN NAO LOCALIZADO') {
        setVen(venRes.ven);
      }

      // 5. Jump to step 2
      setStep(2); setMaxReached(m => Math.max(m, 2));
      showToast('✅ Pasta selecionada — verifique os campos e avance!', 'info', 4000);
    } catch(e) { showToast('❌ Auditoria rápida: ' + e.message, 'warn'); }
  }

  async function savePending() {
    const destName = `${form.integrador||form.cliente_final||form.nome||'Cliente'}_${form.sn||Date.now()}`.replace(/[/\\:*?"<>|]/g,'_');
    const catVal = form.categoria;
    const catResolved = (catVal && /^\d+$/.test(String(catVal)))
      ? (cats.find(c => String(c.id) === String(catVal))?.nome || catVal)
      : catVal;
    const payload = { ...form, categoria: catResolved, status:'Pendente Itens', pasta_original: destName };
    if ('f_vcc' in payload) { payload.v_cc = payload.f_vcc?1:0; delete payload.f_vcc; }
    if ('f_vca' in payload) { payload.v_ca = payload.f_vca?1:0; delete payload.f_vca; }
    try {
      const isCloud = window.location.hostname !== 'localhost';
      // Local mode: also move the folder to PENDENTES
      if (!isCloud && selectedFolder && selectedFolder !== 'Nenhuma') {
        const name = selectedFolder.replace(/^📌 /,'');
        await api('/api/files/move-to-pending', { method:'POST', body: JSON.stringify({ folderName:name, newFolderName:destName }) }).catch(() => {});
      }
      let result;
      if (editCase?.id) result = await api(`/api/cases/${editCase.id}`, { method:'PUT', body: JSON.stringify(payload) });
      else result = await api('/api/cases', { method:'POST', body: JSON.stringify(payload) });
      if (result?.id) setSavedCaseId(result.id);
      showToast('💾 Salvo em Pendentes!');
      resetWizard(); loadLists(); onRefresh?.();
    } catch(e) { showToast('Erro: ' + e.message, 'warn'); }
  }

  async function finalize() {
    if (!allChecked) return showToast('⚠️ Todos os itens obrigatórios devem estar marcados', 'warn');
    if (!selectedFolder || selectedFolder==='Nenhuma') return showToast('⚠️ Selecione uma pasta', 'warn');

    // SN duplicate check — re-query live so auto-filled SNs are always checked
    if (form.sn) {
      const liveCases = await api('/api/cases').catch(() => []);
      const liveDups = (liveCases || []).filter(c =>
        c.sn === form.sn &&
        c.status !== 'Concluído' &&
        (!editCase || c.id !== editCase.id)
      );
      if (liveDups.length > 0) {
        const openKeys = liveDups.map(c => c.jira_key || `#${c.id}`).join(', ');
        const proceed = window.confirm(
          `⚠️ REINCIDÊNCIA DETECTADA\n\nS/N: ${form.sn}\nChamados abertos: ${openKeys}\n\nDeseja registrar como REINCIDÊNCIA?`
        );
        if (!proceed) return;
      }
    }

    if (!confirm('A pasta local será removida após o upload. Continuar?')) return;

    // #6 — names must match DRIVE_STEPS in UI.jsx exactly for progressive animation
    const STEPS = [
      'Preparando arquivos...',
      'Compactando pasta...',
      'Autenticando com Drive...',
      'Criando pasta no Drive...',
      'Enviando arquivos...',
      'Finalizando...',
    ];
    const pcts = [5, 20, 40, 65, 85, 95];
    let s = 0;
    setDriveProgress({ visible:true, step:STEPS[0], pct:pcts[0] });
    const iv = setInterval(() => {
      s++;
      if (s < STEPS.length) {
        setDriveProgress({ visible:true, step:STEPS[s], pct:pcts[s] });
      }
    }, 2800);

    try {
      const name = selectedFolder.replace(/^📌 /,'');

      // Resolve categoria ID → name for storage
      const catVal = form.categoria;
      const catResolved = (catVal && /^\d+$/.test(String(catVal)))
        ? (cats.find(c => String(c.id) === String(catVal))?.nome || catVal)
        : catVal;
      const caseDataOut = { ...form, categoria: catResolved };

      const driveResult = await api('/api/drive/upload', {
        method: 'POST',
        body:   JSON.stringify({ caseId:editCase?.id||null, folderName:name, folderPath, caseData:caseDataOut }),
      });
      clearInterval(iv);
      const newCaseId = driveResult?.caseId || editCase?.id;

      // 2. Auto-create Jira — pass full case data + caseId so jira.js has everything
      setDriveProgress({ visible:true, step:'Finalizando...', pct:98 });
      let jiraResult = null;
      try {
        const jiraPayload = {
          ...form,
          id:      newCaseId,
          drive_id: driveResult?.driveId,
          contato: form.contato || form.tel_integrador || '',
        };
        jiraResult = await api('/api/jira/create-issue', {
          method: 'POST',
          body:   JSON.stringify(jiraPayload),
        });
        if (jiraResult?.key) {
          showToast(`✅ Jira criado: ${jiraResult.key}`, 'info', 5000);
        } else if (jiraResult?.warning) {
          showToast(`⚠️ ${jiraResult.warning}`, 'warn', 6000);
        }
      } catch(jiraErr) {
        const msg = jiraErr.message || '';
        if (msg.includes('board') || msg.includes('projeto')) {
          showToast(`⚠️ Sem board Jira para "${form.fabricante}" — chamado salvo no histórico.`, 'warn', 7000);
        } else {
          console.warn('[Jira]', msg);
          showToast(`⚠️ Jira não criado automaticamente: ${msg.slice(0,80)}`, 'warn', 5000);
        }
      }

      setDriveProgress({ visible:true, step:'Finalizando...', pct:100 });
      setTimeout(() => setDriveProgress({ visible:false }), 900);
      setLastResult({
        caseId:   newCaseId,
        driveId:  driveResult?.driveId,
        driveUrl: driveResult?.driveUrl,
        jiraKey:  jiraResult?.key || null,
        jiraUrl:  jiraResult?.issueUrl || null,
      });
      goNext(); // → Step 5 success screen
      loadLists(); onRefresh?.();
    } catch(e) {
      clearInterval(iv);
      setDriveProgress({ visible:false });
      showToast('❌ '+e.message, 'warn', 5000);
    }
  }

  async function deleteCase(id) {
    if (!confirm('Remover chamado?')) return;
    setFinalizingId(id);
    setTimeout(async () => {
      await api(`/api/cases/${id}`, { method:'DELETE' }).catch(() => {});
      setFinalizingId(null); loadLists();
    }, 580);
  }

  // OCR badge simulation (would come from OCR response in real use)
  const ocrDone = !!form.sn;

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100vh' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ background:'var(--s1)', borderBottom:'1px solid var(--b1)', padding:'12px 20px 0', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:16, marginBottom:14 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:2 }}>
              <span style={{ fontSize:15 }}>📋</span>
              <h1 style={{ fontSize:17, fontWeight:800 }}>{editCase ? `Editando Chamado #${editCase.id}` : 'Novo Registro de Chamado'}</h1>
              {ocrDone && (
                <span style={{ fontSize:10.5, fontWeight:700, background:'rgba(34,197,94,.1)', color:'var(--gr)', padding:'2px 9px', borderRadius:999, border:'1px solid rgba(34,197,94,.25)' }}>
                  ● OCR concluído
                </span>
              )}
            </div>
            <p style={{ fontSize:11.5, color:'var(--tm)' }}>Revise e complete as informações extraídas dos arquivos.</p>
          </div>
          <div style={{ display:'flex', gap:8, flexShrink:0 }}>
            <button onClick={() => setShowShortcuts(v => !v)} style={{ fontSize:11.5, padding:'7px 14px', background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', color:'var(--tm)', cursor:'pointer', fontFamily:'inherit' }}>
              ⌨️ Atalhos de teclado
            </button>
            {folderPath ? (
              <a href={`https://drive.google.com/drive/folders/${folderPath.split('\\').pop()||folderPath.split('/').pop()}`}
                target="_blank" rel="noreferrer"
                style={{ fontSize:11.5, padding:'7px 14px', background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', color:'var(--tm)', cursor:'pointer', fontFamily:'inherit', textDecoration:'none', display:'flex', alignItems:'center', gap:5 }}>
                📎 Visualizar arquivos {folderFiles.length > 0 ? folderFiles.length : ''}
              </a>
            ) : (
              <span style={{ fontSize:11.5, padding:'7px 14px', background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', color:'var(--ts)', fontFamily:'inherit', opacity:.5 }}>
                📎 Visualizar arquivos
              </span>
            )}
            <button onClick={() => { if (confirm('Limpar todos os campos?')) resetWizard(); }}
              title="Limpar formulário"
              style={{ background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.2)', color:'var(--re)', cursor:'pointer', fontSize:13, padding:'7px 10px', borderRadius:'var(--rs)', lineHeight:1, fontFamily:'inherit' }}>
              🗑
            </button>
          </div>
        </div>

        {/* Keyboard shortcuts modal */}
        {showShortcuts && (
          <div style={{ margin:'0 0 10px', padding:'12px 16px', background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px 24px', fontSize:12 }}>
            {[
              ['Tab',          'Próximo campo'],
              ['Shift+Tab',    'Campo anterior'],
              ['Ctrl+Enter',     'Continuar para próxima etapa'],
              ['Ctrl+Shift+A',   'Auditoria Rápida (última pasta)'],
              ['Enter',        'Finalizar (etapa 4)'],
            ].map(([k, v]) => (
              <div key={k} style={{ display:'flex', alignItems:'center', gap:8 }}>
                <kbd style={{ background:'var(--s1)', border:'1px solid var(--b2)', borderRadius:4, padding:'2px 8px', fontSize:11, fontFamily:'monospace', flexShrink:0 }}>{k}</kbd>
                <span style={{ color:'var(--tm)' }}>{v}</span>
              </div>
            ))}
          </div>
        )}

        {/* Step bar */}
        <div style={{ paddingBottom:14 }}>
          <StepBar current={step} maxReached={maxReached} />
        </div>
      </div>

      {/* ── Main content area ───────────────────────────────────────────────── */}
      <div style={{ flex:1, overflow:'auto' }}>

        {/* Wizard steps */}
        {step === 1 && (
          <Step1 form={form} set={set} cats={cats} fabs={fabs} teamMembers={teamMembers}
            ocrConf={ocrConf} ocrLoading={ocrLoading} dupWarning={dupWarning} snHistory={snHistory}
            clientSuggestions={clientSuggestions}
            onSnChange={onSnChange} onClientSearch={onClientSearch} applyClient={applyClient} />
        )}
        {step === 2 && <Step2 form={form} set={set} ven={ven} caseId={savedCaseId || editCase?.id} />}
        {step === 3 && <Step3 form={form} set={set} ripples={ripples} setRipples={setRipples} folderPath={folderPath} folderFiles={folderFiles} />}
        {step === 4 && <Step4 form={form} checked={checked} cats={cats} />}
        {step === 5 && <Step5 onNew={resetWizard} onHistory={() => { resetWizard(); onNavigate?.('historico'); }} result={lastResult} />}

        {/* Bottom nav bar (hidden on step 5) */}
        {step < 5 && (
          <BottomBar
            step={step}
            onBack={goBack}
            onNext={step === 4 ? finalize : goNext}
            onSavePending={step <= 3 ? savePending : null}
            nextLabel={step === 4 ? 'Finalizar → Atalho: Enter' : 'Continuar →'}
            nextDisabled={step === 4 && !allChecked}
            hint={step === 1 ? 'Shift + Tab para voltar' : null}
          />
        )}

        {/* Case lists — shown on step 1 below the form */}
        {step === 1 && (
          <div style={{ padding:'24px 28px 40px' }}>
            {/* ConfLegend inline — no more fixed positioning */}
            <div style={{ display:'flex', gap:16, fontSize:11, color:'var(--tm)', marginBottom:16 }}>
              <span><span style={{ color:'var(--gr)', fontWeight:700 }}>●</span> Alta (90–100%)</span>
              <span><span style={{ color:'#F59E0B', fontWeight:700 }}>●</span> Média (70–89%)</span>
              <span><span style={{ color:'var(--re)', fontWeight:700 }}>●</span> Baixa (&lt;70%)</span>
            </div>
            <div style={{ borderTop:'2px solid var(--b1)', paddingTop:24 }}>
              <CaseListTabs
                pendentes={pendentes} adb={adb} concluidos={concluidos}
                activeTab={activeTab} setTab={setTab}
                adbRefs={adbRefs} finalizingId={finalizingId}
                timelineOpen={timelineOpen} setTimelineOpen={setTimelineOpen}
                deleteCase={deleteCase} finalizeCard={() => {}} loadLists={loadLists}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

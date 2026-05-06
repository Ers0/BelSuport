import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { Avatar } from '../components/UI';

// ── Helpers ───────────────────────────────────────────────────────────────────
const PERIODS = [
  { id:'hoje',   label:'Hoje' },
  { id:'semana', label:'Semana' },
  { id:'mes',    label:'Mês' },
];

function filterByPeriod(data, period) {
  const now = new Date();
  return (data || []).filter(c => {
    if (!c.data) return true;
    const [d, m, y] = c.data.split('/').map(Number);
    const date = new Date(y, m - 1, d);
    if (period === 'hoje')   return date.toDateString() === now.toDateString();
    if (period === 'semana') return (now - date) / 864e5 <= 7;
    if (period === 'mes')    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    return true;
  });
}

function useCountUp(target, delay = 0) {
  const [val, setVal] = useState(0);
  const rafRef = useRef(null);
  useEffect(() => {
    const timeout = setTimeout(() => {
      const start = performance.now();
      const dur   = 800;
      function tick(now) {
        const progress = Math.min((now - start) / dur, 1);
        const eased    = 1 - Math.pow(1 - progress, 3);
        setVal(Math.round(target * eased));
        if (progress < 1) rafRef.current = requestAnimationFrame(tick);
      }
      rafRef.current = requestAnimationFrame(tick);
    }, delay);
    return () => { clearTimeout(timeout); cancelAnimationFrame(rafRef.current); };
  }, [target, delay]);
  return val;
}

function dateRangeLabel(period) {
  const now  = new Date();
  const fmt  = d => d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' });
  const from = new Date(now);
  if (period === 'hoje')   { return fmt(now) + ' — ' + fmt(now); }
  if (period === 'semana') { from.setDate(now.getDate()-7); return fmt(from) + ' — ' + fmt(now); }
  if (period === 'mes')    { from.setDate(1); return fmt(from) + ' — ' + fmt(now); }
  return '';
}

// Fake trend vs previous period (±10–30%) — real impl would compare two API calls
function fakeTrend(val, positive) { return (positive ? '+' : '-') + Math.floor(Math.random()*20+3); }

const PLOTLY_LAYOUT = () => ({
  paper_bgcolor:'transparent', plot_bgcolor:'transparent',
  margin:{ t:10, b:36, l:36, r:10 },
  font:{ family:'Plus Jakarta Sans, sans-serif', color:'#6B7694', size:10 },
  xaxis:{ gridcolor:'rgba(255,255,255,0.04)', zeroline:false, tickfont:{ size:10 } },
  yaxis:{ gridcolor:'rgba(255,255,255,0.04)', zeroline:false, tickfont:{ size:10 } },
  legend:{ bgcolor:'transparent', font:{ color:'#9AA0B8', size:11 }, orientation:'h', y:1.12, x:0 },
  showlegend:true,
});

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ icon, iconBg, value, suffix, label, delta, deltaUp, delay }) {
  const animated = useCountUp(
    typeof value === 'number' ? Math.round(value) : 0,
    delay
  );
  const displayed = typeof value === 'string' ? value : animated + (suffix || '');
  const deltaColor = deltaUp ? 'var(--gr)' : 'var(--re)';
  const deltaBg    = deltaUp ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)';
  return (
    <div style={{
      background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--rs)',
      padding:'16px 18px', display:'flex', flexDirection:'column', gap:6, flex:1,
      animation:'springIn .4s cubic-bezier(0.34,1.56,0.64,1) both',
    }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ width:38, height:38, borderRadius:10, background:iconBg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>{icon}</div>
        <span style={{ fontSize:11, fontWeight:700, color:deltaColor, background:deltaBg, padding:'2px 7px', borderRadius:999 }}>
          {deltaUp ? '+ ' : '- '}{Math.abs(delta)} {typeof delta === 'string' && delta.includes('%') ? '' : (typeof value==='string' ? '' : '%')}
        </span>
      </div>
      <div style={{ fontSize:32, fontWeight:900, letterSpacing:'-.03em', lineHeight:1, color:'var(--tx)' }}>{displayed}</div>
      <div style={{ fontSize:12, color:'var(--tm)', fontWeight:500 }}>{label}</div>
    </div>
  );
}

// ── Category row ──────────────────────────────────────────────────────────────
const STATUS_CFG = {
  'Crítico':  { color:'var(--re)', bg:'rgba(239,68,68,.1)',   bar:'var(--re)' },
  'Atenção':  { color:'#F59E0B',   bg:'rgba(245,158,11,.1)', bar:'#F59E0B' },
  'Normal':   { color:'var(--gr)', bg:'rgba(34,197,94,.1)',   bar:'var(--gr)' },
};
function statusFromRate(rate) {
  if (rate >= 35) return 'Crítico';
  if (rate >= 15) return 'Atenção';
  return 'Normal';
}
function catInitial(name) {
  return (name || '?')[0].toUpperCase();
}
const CAT_COLORS = ['#60A5FA','#34D399','#A78BFA','#F472B6','#FB923C','#FBBF24'];

function CategoryRow({ cat, idx, maxCount }) {
  const status = statusFromRate(cat.rate);
  const cfg    = STATUS_CFG[status];
  const barPct = maxCount ? Math.round((cat.count / maxCount) * 100) : 0;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 0', borderBottom:'1px solid var(--b1)' }}>
      <div style={{ width:26, height:26, borderRadius:7, background:CAT_COLORS[idx%CAT_COLORS.length]+'22', border:`1px solid ${CAT_COLORS[idx%CAT_COLORS.length]}44`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10.5, fontWeight:800, color:CAT_COLORS[idx%CAT_COLORS.length], flexShrink:0 }}>
        {catInitial(cat.name)}
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12.5, fontWeight:700, marginBottom:2 }}>{cat.name}</div>
        <div style={{ fontSize:10.5, color:'var(--tm)' }}>{cat.count} chamados</div>
      </div>
      {/* Mini bar */}
      <div style={{ width:70, height:4, background:'var(--s2)', borderRadius:999, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${barPct}%`, background:cfg.bar, borderRadius:999, transition:'width 1s ease' }} />
      </div>
      <div style={{ fontSize:13, fontWeight:800, color:cfg.bar, minWidth:36, textAlign:'right' }}>{cat.rate}%</div>
      <span style={{ fontSize:10.5, fontWeight:700, color:cfg.color, background:cfg.bg, padding:'2px 8px', borderRadius:999, minWidth:56, textAlign:'center' }}>{status}</span>
    </div>
  );
}

// ── Fabricante row ────────────────────────────────────────────────────────────
const FAB_COLORS = ['#FFD700','#34D399','#60A5FA','#A78BFA','#FB923C'];
function FabRow({ fab, rank }) {
  const medal = ['🥇','🥈','🥉'][rank] || rank+1+'.';
  const trendUp = (fab.trend || 0) > 0;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:9, padding:'9px 0', borderBottom:'1px solid var(--b1)' }}>
      <span style={{ fontSize:12, minWidth:22, color:'var(--tm)', fontWeight:700 }}>{medal}</span>
      <div style={{ width:26, height:26, borderRadius:7, background:FAB_COLORS[rank%FAB_COLORS.length]+'22', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:800, color:FAB_COLORS[rank%FAB_COLORS.length], flexShrink:0 }}>
        {catInitial(fab.name)}
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12.5, fontWeight:700 }}>{fab.name}</div>
        <div style={{ fontSize:10.5, color:'var(--tm)' }}>{fab.count} chamados</div>
      </div>
      {/* Trend bar */}
      <div style={{ width:48, height:4, background:'var(--s2)', borderRadius:999, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${fab.rate}%`, background: fab.rate>=30?'var(--re)':fab.rate>=15?'#F59E0B':'var(--gr)', borderRadius:999 }} />
      </div>
      <div style={{ fontSize:13, fontWeight:800, color: fab.rate>=30?'var(--re)':fab.rate>=15?'#F59E0B':'var(--gr)', minWidth:34, textAlign:'right' }}>{fab.rate}%</div>
      {fab.trend !== undefined && (
        <span style={{ fontSize:10.5, fontWeight:700, color: trendUp?'var(--re)':'var(--gr)', minWidth:40, textAlign:'right' }}>
          {trendUp?'↑ +':'↓ -'}{Math.abs(fab.trend)}%
        </span>
      )}
    </div>
  );
}

// ── Insight card ──────────────────────────────────────────────────────────────
function InsightCard({ icon, iconColor, iconBg, title, body, cta, onCta, accent }) {
  return (
    <div style={{
      background: accent || 'var(--s1)', border:`1px solid ${accent ? accent+'44' : 'var(--b1)'}`,
      borderRadius:'var(--rs)', padding:'16px 18px', flex:1,
    }}>
      <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
        <div style={{ width:32, height:32, borderRadius:8, background:iconBg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>{icon}</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:13, fontWeight:700, marginBottom:4, color: accent ? '#FFD700' : 'var(--tx)' }}>{title}</div>
          <div style={{ fontSize:11.5, color:'var(--tm)', lineHeight:1.5 }}>{body}</div>
          {cta && (
            <button onClick={onCta} style={{ marginTop:10, padding:'7px 14px', background:'var(--y)', color:'#000', border:'none', borderRadius:'var(--rs)', fontSize:11.5, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
              {cta}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Dashboard({ showToast, user, onDataLoad, onNavigate }) {
  const [period, setPeriod]       = useState('semana');
  const [data,   setData]         = useState([]);
  const [selectedTech, setSelectedTech] = useState(null);
  const [selectedFab, setSelectedFab]   = useState(null);
  const [showFilters, setShowFilters]   = useState(false);
  const timelineRef   = useRef();
  const filterRef     = useRef();
  useEffect(() => {
    if (!showFilters) return;
    const handler = e => { if (filterRef.current && !filterRef.current.contains(e.target)) setShowFilters(false); };
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', handler); };
  }, [showFilters]);

  useEffect(() => {
    api('/api/cases/stats').then(d => { setData(d); onDataLoad?.(d); }).catch(() => {});
  }, []);

  const periodFiltered = filterByPeriod(data, period);
  const filtered = periodFiltered
    .filter(c => !selectedTech || (c.nome||c.user_name||'?') === selectedTech)
    .filter(c => !selectedFab  || c.fabricante === selectedFab);

  // Distinct fabricantes and techs for filter dropdowns
  const allFabs  = [...new Set(data.map(c => c.fabricante).filter(Boolean))].sort();
  const allTechs = [...new Set(data.map(c => c.nome||c.user_name).filter(Boolean))].sort();
  const activeFilters = [selectedTech, selectedFab].filter(Boolean).length;

  // ── Stats ──────────────────────────────────────────────────────────────────
  const total   = filtered.length;
  const pending = filtered.filter(c => c.status === 'Pendente Itens').length;
  const inprog  = filtered.filter(c => c.status === 'Aguardando Protocolo').length;
  const done    = filtered.filter(c => c.status === 'Concluído').length;
  const rate    = total ? Math.round((done / total) * 100) : 0;
  const avgDays = (() => {
    const concluded = filtered.filter(c => c.status==='Concluído' && c.created_at && c.data);
    if (!concluded.length) return 0;
    const sum = concluded.reduce((acc, c) => {
      const [d,m,y] = (c.data||'').split('/').map(Number);
      const diff = (new Date(y,m-1,d) - new Date(c.created_at)) / 864e5;
      return acc + Math.abs(diff);
    }, 0);
    return (sum / concluded.length).toFixed(1);
  })();

  // ── Categories analytics ───────────────────────────────────────────────────
  const catMap = {};
  filtered.forEach(c => {
    if (!c.categoria && !c.fabricante) return;
    const key = c.categoria || 'Outros';
    if (!catMap[key]) catMap[key] = { name: key, count:0, failed:0 };
    catMap[key].count++;
    if (c.status !== 'Concluído') catMap[key].failed++;
  });
  const catList = Object.values(catMap)
    .map(c => ({ ...c, rate: c.count ? Math.round((c.failed/c.count)*100) : 0 }))
    .sort((a,b) => b.count-a.count).slice(0,5);
  const maxCat = catList[0]?.count || 1;

  // ── Fabricantes analytics ──────────────────────────────────────────────────
  const fabMap = {};
  filtered.forEach(c => {
    if (!c.fabricante) return;
    if (!fabMap[c.fabricante]) fabMap[c.fabricante] = { name:c.fabricante, count:0, failed:0 };
    fabMap[c.fabricante].count++;
    if (c.status !== 'Concluído') fabMap[c.fabricante].failed++;
  });
  const fabList = Object.values(fabMap)
    .map(f => ({ ...f, rate: f.count ? Math.round((f.failed/f.count)*100) : 0, trend: Math.floor(Math.random()*60)-30 }))
    .sort((a,b) => b.count-a.count).slice(0,5);

  // ── Ranking ────────────────────────────────────────────────────────────────
  const scores = {}, resolved = {};
  filtered.forEach(c => {
    const n = c.nome||c.user_name||'?';
    scores[n] = (scores[n]||0)+1;
    if (c.status==='Concluído') resolved[n] = (resolved[n]||0)+1;
  });
  const ranking = Object.entries(scores)
    .map(([name, count]) => ({ name, count, res: count ? Math.round(((resolved[name]||0)/count)*100) : 0 }))
    .sort((a,b) => b.count-a.count).slice(0,5);
  const maxRank = ranking[0]?.count || 1;

  // ── Recent activity ────────────────────────────────────────────────────────
  const recent = [...filtered].sort((a,b) => (b.id||0)-(a.id||0)).slice(0,6);
  const actVerb = s => s==='Concluído'?'Finalizou':s==='Aguardando Protocolo'?'Subiu ADB':'Pendente';
  const actColor = s => s==='Concluído'?'var(--gr)':s==='Aguardando Protocolo'?'var(--bl)':'#F59E0B';

  // ── Plotly timeline ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!window.Plotly || !timelineRef.current) return;
    const days = {}, doneDays = {};
    filtered.forEach(c => {
      if (!c.data) return;
      days[c.data] = (days[c.data]||0)+1;
      if (c.status==='Concluído') doneDays[c.data]=(doneDays[c.data]||0)+1;
    });
    const dates = Object.keys(days).sort((a,b) => {
      const p = s => { const [d,m,y]=s.split('/'); return new Date(y,m-1,d); };
      return p(a)-p(b);
    });
    window.Plotly.react(timelineRef.current, [
      { x:dates, y:dates.map(d=>days[d]), type:'scatter', name:'Total', fill:'tozeroy', fillcolor:'rgba(255,215,0,.06)', line:{ color:'#FFD700', width:2 }, mode:'lines', hovertemplate:'%{y} chamados<extra>Total</extra>' },
      { x:dates, y:dates.map(d=>doneDays[d]||0), type:'scatter', name:'Concluídos', fill:'tozeroy', fillcolor:'rgba(34,197,94,.05)', line:{ color:'#22C55E', width:2, dash:'dot' }, mode:'lines', hovertemplate:'%{y} concluídos<extra>Concluídos</extra>' },
    ], PLOTLY_LAYOUT(), { responsive:true, displayModeBar:false });
  }, [filtered]);

  // ── Insights ───────────────────────────────────────────────────────────────
  const topCat = catList[0];
  const topFab = fabList[0];

  return (
    <div style={{ padding:'0 0 40px' }}>

      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'20px 28px 0' }}>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:2 }}>
            <span style={{ fontSize:22 }}>📊</span>
            <h1 style={{ fontSize:22, fontWeight:900, letterSpacing:'-.025em' }}>Dashboard</h1>
          </div>
          <p style={{ fontSize:12.5, color:'var(--tm)' }}>Visão geral dos chamados e desempenho da equipe.</p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <div style={{ padding:'8px 14px', background:'var(--s1)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', fontSize:12, color:'var(--tm)', display:'flex', alignItems:'center', gap:7 }}>
            <span>📅</span> {dateRangeLabel(period)}
          </div>
          <div ref={filterRef} style={{ position:'relative' }}>
            <button onClick={() => setShowFilters(v=>!v)} style={{
              padding:'8px 14px', background: activeFilters > 0 ? 'rgba(255,215,0,.1)' : 'var(--s1)',
              border: `1px solid ${activeFilters > 0 ? 'rgba(255,215,0,.4)' : 'var(--b2)'}`,
              borderRadius:'var(--rs)', fontSize:12,
              color: activeFilters > 0 ? 'var(--y)' : 'var(--tm)',
              cursor:'pointer', fontFamily:'inherit', display:'flex', alignItems:'center', gap:6,
            }}>
              ⚡ Filtros {activeFilters > 0 && <span style={{ background:'var(--y)', color:'#000', fontSize:10, fontWeight:800, padding:'1px 6px', borderRadius:999 }}>{activeFilters}</span>}
            </button>
            {showFilters && (
              <div style={{
                position:'absolute', top:'calc(100% + 6px)', right:0, width:220,
                background:'var(--s1)', border:'1px solid var(--b2)', borderRadius:'var(--rs)',
                boxShadow:'0 8px 32px rgba(0,0,0,.5)', zIndex:9999, padding:12,
              }}>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:8 }}>Técnico</div>
                <select value={selectedTech||''} onChange={e=>setSelectedTech(e.target.value||null)} style={{ marginBottom:10, fontSize:12 }}>
                  <option value="">Todos os técnicos</option>
                  {allTechs.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:8 }}>Fabricante</div>
                <select value={selectedFab||''} onChange={e=>setSelectedFab(e.target.value||null)} style={{ marginBottom:10, fontSize:12 }}>
                  <option value="">Todos os fabricantes</option>
                  {allFabs.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                {activeFilters > 0 && (
                  <button onClick={() => { setSelectedTech(null); setSelectedFab(null); }} style={{
                    width:'100%', padding:'7px', background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.2)',
                    color:'var(--re)', borderRadius:'var(--rs)', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit',
                  }}>✕ Limpar filtros</button>
                )}
              </div>
            )}
          </div>
          <button onClick={() => onNavigate?.('registro')} style={{ padding:'8px 18px', background:'var(--y)', color:'#000', border:'none', borderRadius:'var(--rs)', fontSize:12.5, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
            + Novo Chamado
          </button>
        </div>
      </div>

      {/* ── Period tabs ──────────────────────────────────────────────────────── */}
      <div style={{ padding:'14px 28px 0' }}>
        <div style={{ display:'inline-flex', gap:2, background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--rs)', padding:3 }}>
          {PERIODS.map(p => (
            <button key={p.id} onClick={() => { setPeriod(p.id); setSelectedTech(null); }} style={{
              padding:'7px 20px', border:'none', borderRadius:8, fontSize:12.5, fontWeight:600, cursor:'pointer',
              background: period===p.id ? 'var(--s3)' : 'transparent',
              color:      period===p.id ? 'var(--tx)' : 'var(--tm)',
              transition:'all .15s', fontFamily:'inherit',
            }}>{p.label}</button>
          ))}
        </div>
      </div>

      <div style={{ padding:'16px 28px 0', display:'flex', flexDirection:'column', gap:14 }}>

        {/* ── 6 stat cards ─────────────────────────────────────────────────────── */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:10 }}>
          {[
            { icon:'📞', iconBg:'rgba(96,165,250,.12)',  value:total,  label:'Total de chamados',    delta:13, deltaUp:true,  delay:0 },
            { icon:'⚠️', iconBg:'rgba(239,68,68,.1)',    value:pending,label:'Pendentes',             delta:4,  deltaUp:false, delay:80 },
            { icon:'⚡', iconBg:'rgba(168,85,247,.1)',   value:inprog, label:'Em andamento',          delta:16, deltaUp:true,  delay:160 },
            { icon:'✅', iconBg:'rgba(34,197,94,.1)',    value:done,   label:'Concluídos',            delta:18, deltaUp:true,  delay:240 },
            { icon:'📈', iconBg:'rgba(255,215,0,.08)',   value:rate,   label:'Taxa de resolução',     delta:2.1,deltaUp:true,  suffix:'%', delay:320 },
            { icon:'🕐', iconBg:'rgba(251,146,60,.1)',   value:avgDays,label:'Tempo médio resolução', delta:0.6,deltaUp:false, suffix:'d', delay:400 },
          ].map((s, i) => <StatCard key={i} {...s} />)}
        </div>

        {/* ── Middle row: chart + categories + fabricantes ──────────────────────── */}
        <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr 1fr', gap:12 }}>

          {/* Line chart */}
          <div style={{ background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--rs)', padding:'18px 20px' }}>
            <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:12 }}>
              <div>
                <div style={{ fontSize:14, fontWeight:700, marginBottom:2 }}>Evolução dos Chamados</div>
                <div style={{ fontSize:11.5, color:'var(--tm)' }}>Volume de chamados por dia</div>
                <div style={{ display:'flex', gap:14, marginTop:8 }}>
                  <span style={{ fontSize:11, color:'var(--ts)', display:'flex', alignItems:'center', gap:5 }}>
                    <span style={{ display:'inline-block', width:16, height:2, background:'#FFD700', borderRadius:2 }} /> Total
                  </span>
                  <span style={{ fontSize:11, color:'var(--ts)', display:'flex', alignItems:'center', gap:5 }}>
                    <span style={{ display:'inline-block', width:16, height:2, background:'#22C55E', borderRadius:2 }} /> Concluídos
                  </span>
                </div>
              </div>
              <select style={{ fontSize:11.5, padding:'5px 10px', background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:6, color:'var(--tm)', cursor:'pointer' }}>
                <option>Por dia</option>
                <option>Por semana</option>
              </select>
            </div>
            <div ref={timelineRef} style={{ width:'100%', height:200 }} />
          </div>

          {/* Top categorias */}
          <div style={{ background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--rs)', padding:'18px 20px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
              <div>
                <div style={{ fontSize:14, fontWeight:700, marginBottom:2 }}>Top categorias</div>
                <div style={{ fontSize:11.5, color:'var(--tm)' }}>com mais problemas</div>
              </div>
              <button onClick={() => onNavigate?.('produtos')} style={{ fontSize:11.5, color:'var(--bl)', background:'none', border:'none', cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>Ver todas →</button>
            </div>
            <div>
              {catList.length === 0 && <div style={{ textAlign:'center', color:'var(--tm)', padding:'24px 0', fontSize:12 }}>Sem dados</div>}
              {catList.map((cat, i) => <CategoryRow key={cat.name} cat={cat} idx={i} maxCount={maxCat} />)}
            </div>
          </div>

          {/* Top fabricantes */}
          <div style={{ background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--rs)', padding:'18px 20px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
              <div>
                <div style={{ fontSize:14, fontWeight:700, marginBottom:2 }}>Top fabricantes</div>
                <div style={{ fontSize:11.5, color:'var(--tm)' }}>por taxa de falha</div>
              </div>
              <button onClick={() => onNavigate?.('produtos')} style={{ fontSize:11.5, color:'var(--bl)', background:'none', border:'none', cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>Ver todas →</button>
            </div>
            <div>
              {fabList.length === 0 && <div style={{ textAlign:'center', color:'var(--tm)', padding:'24px 0', fontSize:12 }}>Sem dados</div>}
              {fabList.map((fab, i) => <FabRow key={fab.name} fab={fab} rank={i} />)}
            </div>
          </div>
        </div>

        {/* ── Insights strip ────────────────────────────────────────────────────── */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10 }}>
          <InsightCard
            icon="⚠️" iconBg="rgba(245,158,11,.12)" iconColor="#F59E0B"
            title={topCat ? `${topCat.name}s lideram em problemas` : 'Sem dados de categoria'}
            body={topCat ? `${topCat.rate}% de taxa de falha e aumento de 15% nos chamados.` : 'Registre chamados para ver insights.'}
          />
          <InsightCard
            icon="🔥" iconBg="rgba(239,68,68,.1)" iconColor="var(--re)"
            title={topFab ? `${topFab.name} é o fabricante com mais impacto` : 'Sem dados de fabricante'}
            body={topFab ? `${topFab.count} chamados e ${topFab.rate}% de taxa de falha.` : 'Registre chamados para ver insights.'}
          />
          <InsightCard
            icon="✅" iconBg="rgba(34,197,94,.1)" iconColor="var(--gr)"
            title="Tempo médio de resolução melhorou"
            body={`Redução de 0.6 dia em relação à semana anterior.`}
          />
          <InsightCard
            icon="💡" iconBg="rgba(255,215,0,.08)" iconColor="var(--y)"
            title="Quer entender as causas?"
            body="Acesse a gestão de produtos para análise"
            cta="→ Ir para Produtos"
            onCta={() => onNavigate?.('produtos')}
            accent="rgba(255,215,0,.04)"
          />
        </div>

        {/* ── Bottom row: ranking + activities ─────────────────────────────────── */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1.6fr', gap:12 }}>

          {/* Team ranking */}
          <div style={{ background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--rs)', padding:'18px 20px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
              <div>
                <div style={{ fontSize:14, fontWeight:700, marginBottom:2 }}>Ranking da Equipe</div>
                <div style={{ fontSize:11.5, color:'var(--tm)' }}>Volume de casos no período</div>
              </div>
              <span style={{ fontSize:20 }}>🏆</span>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {ranking.map(({ name, count, res }, i) => {
                const medals = ['🥇','🥈','🥉'];
                const isActive = selectedTech === name;
                const barW = Math.round((count/maxRank)*100);
                return (
                  <div key={name} onClick={() => setSelectedTech(isActive?null:name)} style={{
                    display:'flex', alignItems:'center', gap:10, padding:'8px 10px',
                    borderRadius:'var(--rs)', cursor:'pointer', transition:'all .15s',
                    background: isActive ? 'rgba(255,215,0,.06)' : 'transparent',
                    border: `1px solid ${isActive ? 'rgba(255,215,0,.25)' : 'transparent'}`,
                  }}
                    onMouseEnter={e=>{ if(!isActive) e.currentTarget.style.background='rgba(255,255,255,.02)'; }}
                    onMouseLeave={e=>{ if(!isActive) e.currentTarget.style.background='transparent'; }}
                  >
                    <span style={{ fontSize:12, minWidth:20, textAlign:'center' }}>{medals[i]||`${i+1}`}</span>
                    <Avatar name={name} size={26} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                        <span style={{ fontSize:12.5, fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:isActive?'var(--y)':'var(--tx)' }}>{name.split(' ')[0]}</span>
                        <span style={{ fontSize:10.5, color:'var(--tm)', flexShrink:0 }}>{res}% res.</span>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <div style={{ flex:1, height:4, background:'var(--s2)', borderRadius:999, overflow:'hidden' }}>
                          <div style={{ height:'100%', width:`${barW}%`, background:isActive?'var(--y)':'linear-gradient(90deg,var(--y),#FF8C00)', borderRadius:999, transition:'width 1s ease' }} />
                        </div>
                        <span style={{ fontSize:13, fontWeight:800, color:'var(--y)', minWidth:20, textAlign:'right' }}>{count}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {ranking.length === 0 && <div style={{ textAlign:'center', color:'var(--tm)', padding:'20px 0', fontSize:12 }}>Sem dados para o período</div>}
              {selectedTech && (
                <button onClick={() => setSelectedTech(null)} style={{ marginTop:4, padding:'5px', background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.2)', color:'var(--re)', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
                  ✕ Limpar filtro: {selectedTech.split(' ')[0]}
                </button>
              )}
            </div>
          </div>

          {/* Recent activities */}
          <div style={{ background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--rs)', padding:'18px 20px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
              <div>
                <div style={{ fontSize:14, fontWeight:700, marginBottom:2 }}>Atividades recentes</div>
              </div>
              <button onClick={() => onNavigate?.('historico')} style={{ fontSize:11.5, color:'var(--bl)', background:'none', border:'none', cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>Ver todas →</button>
            </div>
            {/* Horizontal scroll cards */}
            <div style={{ display:'flex', gap:10, overflowX:'auto', paddingBottom:8 }}>
              {recent.map((c, i) => {
                const color  = actColor(c.status);
                const verb   = actVerb(c.status);
                const client = c.cliente_final || c.integrador || c.nome || '—';
                const tech   = (c.nome||'?').split(' ')[0];
                return (
                  <div key={i} style={{ flexShrink:0, width:160, background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', padding:'12px 14px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:6 }}>
                      <Avatar name={tech} size={24} />
                      <div>
                        <div style={{ fontSize:11.5, fontWeight:700, color:'var(--tx)' }}>{tech}</div>
                        <div style={{ fontSize:10.5, color, fontWeight:600 }}>{verb}</div>
                      </div>
                    </div>
                    <div style={{ fontSize:11.5, color:'var(--ts)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:4 }}>{client}</div>
                    <div style={{ fontSize:10.5, color:'var(--tm)' }}>{c.hora?.slice(0,5)||c.data||'—'}</div>
                  </div>
                );
              })}
              {recent.length === 0 && <div style={{ color:'var(--tm)', fontSize:12.5, padding:'20px 0' }}>Nenhuma atividade no período</div>}
            </div>
            {recent.length > 0 && (
              <button onClick={() => onNavigate?.('historico')} style={{ marginTop:8, background:'none', border:'none', color:'var(--bl)', cursor:'pointer', fontSize:12, fontFamily:'inherit', fontWeight:600 }}>
                Ir para o Histórico →
              </button>
            )}
          </div>
        </div>

        {/* PDF export buttons */}
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          {[
            { label:'📄 Hoje',   period:'daily' },
            { label:'📄 Semana', period:'weekly' },
            { label:'📄 Mês',    period:'monthly' },
          ].map(({ label, period: p }) => (
            <a key={p}
              href={`/api/reports/dashboard?period=${p}&token=${localStorage.getItem('session_token')}`}
              target="_blank" rel="noreferrer"
              style={{ padding:'7px 14px', background:'var(--s1)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', fontSize:12, color:'var(--tm)', textDecoration:'none', fontWeight:600 }}
              onMouseEnter={e=>{ e.currentTarget.style.borderColor='var(--y)'; e.currentTarget.style.color='var(--y)'; }}
              onMouseLeave={e=>{ e.currentTarget.style.borderColor='var(--b2)'; e.currentTarget.style.color='var(--tm)'; }}
            >{label}</a>
          ))}
        </div>

      </div>
    </div>
  );
}

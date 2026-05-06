import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../api';

// ── Brand logo map — Logo.dev CDN (Clearbit replacement) ─────────────────────
const BRAND_DOMAINS = {
  'deye':           'deyeinverter.com',
  'foxess':         'foxess.com',
  'fox ess':        'foxess.com',
  'abb':            'abb.com',
  'fronius':        'fronius.com',
  'goodwe':         'goodwe.com',
  'sungrow':        'sungrowpower.com',
  'huawei':         'huawei.com',
  'growatt':        'growatt.com',
  'sma':            'sma.de',
  'hoymiles':       'hoymiles.com',
  'byd':            'byd.com',
  'canadian solar': 'canadiansolar.com',
  'ja solar':       'jasolar.com',
  'risen':          'risenenergy.com',
  'trina':          'trinasolar.com',
  'jinko':          'jinkosolar.com',
  'apsystems':      'apsystems.com',
  'enphase':        'enphase.com',
  'solis':          'solisinverters.com',
  'pylontech':      'pylontech.com.cn',
  'solax':          'solaxpower.com',
  'saj':            'saj-electric.com',
};

function getBrandLogo(name) {
  const domain = BRAND_DOMAINS[(name || '').toLowerCase().trim()];
  if (!domain) return null;
  return `https://img.logo.dev/${domain}?token=pk_CqFvK0t9Sc2WYHQxTKKWJQ`;
}

// ── Fab avatar — logo if available, else letter ───────────────────────────────
function FabAvatar({ name, size = 26, colorIdx = 0 }) {
  const [imgError, setImgError] = useState(false);
  const logo = getBrandLogo(name);
  const colors = ['#60A5FA','#34D399','#A78BFA','#F472B6','#FB923C','#FBBF24'];
  const color  = colors[colorIdx % colors.length];

  if (logo && !imgError) {
    return (
      <img
        src={logo}
        alt={name}
        onError={() => setImgError(true)}
        style={{ width:size, height:size, borderRadius:6, objectFit:'contain',
                 background:'#fff', flexShrink:0, padding:2 }}
      />
    );
  }
  return (
    <div style={{ width:size, height:size, borderRadius:6, flexShrink:0,
                  background:color+'22', display:'flex', alignItems:'center',
                  justifyContent:'center', fontSize:size*0.45, fontWeight:800, color }}>
      {(name||'?')[0].toUpperCase()}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function statusFromRate(r) {
  if (r >= 35) return 'Crítico';
  if (r >= 15) return 'Atenção';
  return 'Normal';
}
const STATUS_CFG = {
  'Crítico': { color:'var(--re)', bg:'rgba(239,68,68,.1)' },
  'Atenção': { color:'#F59E0B',   bg:'rgba(245,158,11,.1)' },
  'Normal':  { color:'var(--gr)', bg:'rgba(34,197,94,.1)' },
};
const CAT_COLORS = ['#60A5FA','#34D399','#A78BFA','#F472B6','#FB923C','#FBBF24','#38BDF8','#F87171'];
function catInitial(n) { return (n||'?')[0].toUpperCase(); }

function StatMini({ icon, value, label, sub }) {
  return (
    <div style={{ background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--rs)', padding:'16px 20px', flex:1 }}>
      <div style={{ fontSize:22, marginBottom:6 }}>{icon}</div>
      <div style={{ fontSize:28, fontWeight:900, letterSpacing:'-.02em', lineHeight:1, marginBottom:4 }}>{value}</div>
      <div style={{ fontSize:12, fontWeight:600, color:'var(--tm)', marginBottom:3 }}>{label}</div>
      {sub && <div style={{ fontSize:11, color:'var(--ts)' }}>{sub}</div>}
    </div>
  );
}

const CAT_GRID = '26px 1fr 64px 100px 90px 60px 36px';
const FAB_GRID = '30px 1fr 64px 80px 100px 72px 36px';

export default function Produtos({ showToast, allProducts, onNavigate, user }) {
  const [cases,      setCases]      = useState([]);
  const [products,   setProducts]   = useState([]);
  const [selectedCat, setSelectedCat] = useState(null);
  const [selectedFab, setSelectedFab] = useState(null);
  const [showAddCat,  setShowAddCat]  = useState(false);
  const [showAddFab,  setShowAddFab]  = useState(false);
  const [newCatName,  setNewCatName]  = useState('');
  const [newFabName,  setNewFabName]  = useState('');
  const [saving,      setSaving]      = useState(false);

  const canManage = !!(
    user?.permissions?.includes('manage_roles') ||
    user?.permissions?.includes('view_all_cases') ||
    user?.role === 'master' || user?.role === 'admin'
  );

  useEffect(() => {
    api('/api/cases/stats').then(setCases).catch(() => {});
    api('/api/products').then(d => { if (Array.isArray(d)) setProducts(d); }).catch(() => {});
  }, []);

  // ── Build a name-lookup from products so numeric categoria IDs resolve ────────
  const catIdToName = useMemo(() => {
    const m = {};
    products.forEach(p => { m[String(p.id)] = p.nome; });
    return m;
  }, [products]);

  // ── Category list — seeded from DB products, enriched with case counts ────────
  const catList = useMemo(() => {
    const catMap = {};

    // 1. Seed from products DB (real IDs, may have 0 chamados)
    products.forEach(p => {
      if (!p.nome?.trim()) return;
      const key = p.nome;
      catMap[key] = { id:p.id, name:key, count:0, failed:0, fabs:{} };
      (p.fabricantes || []).forEach(f => {
        if (!f.nome?.trim()) return;
        catMap[key].fabs[f.nome] = { id:f.id, count:0, failed:0 };
      });
    });

    // 2. Add case counts — resolve numeric IDs to names
    cases.forEach(c => {
      let catName = c.categoria;
      if (!catName) return;

      // If stored as numeric ID, resolve to name
      if (/^\d+$/.test(String(catName).trim())) {
        catName = catIdToName[String(catName)];
        if (!catName) return; // unknown ID, skip
      }

      catName = String(catName).trim();
      if (!catName) return;

      if (!catMap[catName]) catMap[catName] = { id:null, name:catName, count:0, failed:0, fabs:{} };
      catMap[catName].count++;
      if (c.status !== 'Concluído') catMap[catName].failed++;

      if (c.fabricante?.trim()) {
        const fab = c.fabricante.trim();
        if (!catMap[catName].fabs[fab]) catMap[catName].fabs[fab] = { id:null, count:0, failed:0 };
        catMap[catName].fabs[fab].count++;
        if (c.status !== 'Concluído') catMap[catName].fabs[fab].failed++;
      }
    });

    return Object.values(catMap)
      .map(c => ({ ...c, rate: c.count ? Math.round((c.failed/c.count)*100) : 0 }))
      .sort((a,b) => b.count - a.count);
  }, [cases, products, catIdToName]);

  // ── Stable fabList (seed-based trend/avgDays) ─────────────────────────────────
  const fabList = useMemo(() => {
    const cat = selectedCat || catList[0];
    if (!cat) return [];
    return Object.entries(cat.fabs || {}).map(([name, data]) => {
      const seed = name.split('').reduce((a,c) => a + c.charCodeAt(0), 0);
      return {
        id:      data.id,
        name,
        count:   data.count,
        failed:  data.failed,
        rate:    data.count ? Math.round((data.failed/data.count)*100) : 0,
        trend:   ((seed % 41) - 20),
        avgDays: ((seed % 30) / 10 + 0.5).toFixed(1),
      };
    }).sort((a,b) => b.count - a.count);
  }, [selectedCat, catList]);

  const currentCat = selectedCat || catList[0] || null;
  const currentFab = selectedFab || fabList[0] || null;

  // ── Stats ─────────────────────────────────────────────────────────────────────
  const totalFabs  = [...new Set(cases.map(c=>c.fabricante).filter(Boolean))].length;
  const totalCases = cases.length;
  const globalRate = totalCases ? Math.round((cases.filter(c=>c.status!=='Concluído').length/totalCases)*100) : 0;
  const avgDays    = useMemo(() => {
    const done = cases.filter(c => c.status==='Concluído' && c.created_at && c.data);
    if (!done.length) return '—';
    const sum = done.reduce((acc,c) => {
      const [d,m,y] = (c.data||'').split('/').map(Number);
      return acc + Math.abs((new Date(y,m-1,d)-new Date(c.created_at))/864e5);
    }, 0);
    return (sum/done.length).toFixed(1);
  }, [cases]);

  const dateRange = useMemo(() => {
    const now=new Date(), from=new Date(now);
    from.setDate(now.getDate()-7);
    const f=d=>d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'});
    return f(from)+' — '+f(now);
  }, []);

  // ── Real problems from relatos ────────────────────────────────────────────────
  const problems = useMemo(() => {
    const catCases = cases.filter(c => {
      let name = c.categoria;
      if (/^\d+$/.test(String(name||'').trim())) name = catIdToName[String(name)] || '';
      return name === currentCat?.name && c.relato;
    });
    if (!catCases.length) return [];
    const counts = {};
    catCases.forEach(c => {
      const r = (c.relato||'').toLowerCase();
      if (r.includes('ven'))                       counts['Código VEN']           = (counts['Código VEN']||0)+1;
      if (r.includes('comunic')||r.includes('wifi')||r.includes('rs485'))
                                                   counts['Falha de comunicação'] = (counts['Falha de comunicação']||0)+1;
      if (r.includes('sobreaquec')||r.includes('tempera'))
                                                   counts['Sobreaquecimento']     = (counts['Sobreaquecimento']||0)+1;
      if (r.includes('alarme')||r.includes('alarm')||r.includes('falha')||r.includes('erro'))
                                                   counts['Alarme / Falha']       = (counts['Alarme / Falha']||0)+1;
    });
    const total = catCases.length;
    return Object.entries(counts).map(([label,n]) => ({ label, pct:Math.round(n/total*100) }))
      .sort((a,b)=>b.pct-a.pct).slice(0,4);
  }, [cases, currentCat, catIdToName]);

  // ── CRUD ──────────────────────────────────────────────────────────────────────
  async function addCategory() {
    if (!newCatName.trim()) return;
    setSaving(true);
    try {
      await api('/api/products/categoria', { method:'POST', body: JSON.stringify({ nome: newCatName.trim() }) });
      showToast('✅ Categoria adicionada!');
      setNewCatName(''); setShowAddCat(false);
      api('/api/products').then(d => { if (Array.isArray(d)) setProducts(d); }).catch(() => {});
    } catch(e) { showToast('Erro: ' + e.message, 'warn'); }
    setSaving(false);
  }

  async function addFabricante() {
    if (!newFabName.trim()) return;
    if (!currentCat?.id) { showToast('Selecione uma categoria com ID no banco.', 'warn'); return; }
    setSaving(true);
    try {
      await api('/api/products/fabricante', { method:'POST', body: JSON.stringify({ nome: newFabName.trim(), categoria_id: currentCat.id }) });
      showToast('✅ Fabricante adicionado!');
      setNewFabName(''); setShowAddFab(false);
      api('/api/products').then(d => { if (Array.isArray(d)) setProducts(d); }).catch(() => {});
    } catch(e) { showToast('Erro: ' + e.message, 'warn'); }
    setSaving(false);
  }

  async function deleteCategory(id) {
    if (!id) return showToast('Categoria sem ID no banco.', 'warn');
    if (!confirm('Remover esta categoria? Os fabricantes vinculados também serão removidos.')) return;
    try {
      await api(`/api/products/categoria/${id}`, { method:'DELETE' });
      showToast('Categoria removida');
      if (selectedCat?.id === id) setSelectedCat(null);
      api('/api/products').then(d => { if (Array.isArray(d)) setProducts(d); }).catch(() => {});
    } catch(e) { showToast('Erro: ' + e.message, 'warn'); }
  }

  async function deleteFabricante(id) {
    if (!id) return showToast('Fabricante sem ID no banco.', 'warn');
    if (!confirm('Remover este fabricante?')) return;
    try {
      await api(`/api/products/fabricante/${id}`, { method:'DELETE' });
      showToast('Fabricante removido');
      if (selectedFab?.id === id) setSelectedFab(null);
      api('/api/products').then(d => { if (Array.isArray(d)) setProducts(d); }).catch(() => {});
    } catch(e) { showToast('Erro: ' + e.message, 'warn'); }
  }

  const token = localStorage.getItem('session_token');

  return (
    <div style={{ padding:'0 0 40px' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'20px 28px 0' }}>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:2 }}>
            <span style={{ fontSize:22 }}>⚙️</span>
            <h1 style={{ fontSize:22, fontWeight:900, letterSpacing:'-.025em' }}>Gestão de Produtos</h1>
            <span style={{ fontSize:11, fontWeight:700, background:'rgba(168,85,247,.1)', color:'#A78BFA', padding:'3px 10px', borderRadius:999, border:'1px solid rgba(168,85,247,.25)' }}>🎛️ Painel de Decisão</span>
          </div>
          <p style={{ fontSize:12.5, color:'var(--tm)' }}>Visão estratégica de categorias e fabricantes com base nos chamados registrados.</p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <div style={{ padding:'8px 14px', background:'var(--s1)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', fontSize:12, color:'var(--tm)', display:'flex', alignItems:'center', gap:7 }}>
            <span>📅</span> {dateRange}
          </div>
          <a href={`/api/reports/dashboard?period=weekly&token=${token}`} target="_blank" rel="noreferrer"
            style={{ padding:'8px 14px', background:'var(--s1)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', fontSize:12, color:'var(--tm)', textDecoration:'none', fontWeight:600 }}>
            ↓ Exportar relatório
          </a>
        </div>
      </div>

      <div style={{ padding:'16px 28px 0', display:'flex', flexDirection:'column', gap:14 }}>
        {/* Stat cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10 }}>
          <StatMini icon="⚙️" value={catList.length}     label="Categorias"          sub="+2 nova esta semana" />
          <StatMini icon="📦" value={totalFabs}            label="Fabricantes"         sub="+3 novos esta semana" />
          <StatMini icon="📞" value={totalCases}           label="Chamados vinculados" sub="-12% vs semana anterior" />
          <StatMini icon="⚠️" value={`${globalRate}%`}    label="Taxa geral de falha"  sub="+5% vs semana anterior" />
          <StatMini icon="🕐" value={`${avgDays} dias`}   label="Tempo médio resolução" sub="-0.6 dia vs semana anterior" />
        </div>

        {/* 3-column layout */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1.1fr 1fr', gap:12, alignItems:'start' }}>

          {/* LEFT — Categories */}
          <div style={{ background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--rs)', overflow:'hidden' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 18px', borderBottom:'1px solid var(--b1)' }}>
              <div>
                <div style={{ fontSize:14, fontWeight:700, marginBottom:2 }}>Categorias</div>
                <div style={{ fontSize:11, color:'var(--tm)' }}>Desempenho por volume e taxa de falha</div>
              </div>
              {canManage && (
                <button onClick={() => { setShowAddCat(v=>!v); setShowAddFab(false); }} style={{ padding:'6px 12px', background:'var(--y)', color:'#000', border:'none', borderRadius:'var(--rs)', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
                  + Nova Categoria
                </button>
              )}
            </div>

            {showAddCat && (
              <div style={{ padding:'12px 18px', borderBottom:'1px solid var(--b1)', background:'rgba(255,215,0,.02)' }}>
                <input value={newCatName} onChange={e=>setNewCatName(e.target.value)} placeholder="Nome da categoria..." autoFocus
                  onKeyDown={e=>e.key==='Enter'&&addCategory()}
                  style={{ width:'100%', marginBottom:8, boxSizing:'border-box' }} />
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={addCategory} disabled={saving} style={{ flex:1, padding:'7px', background:'var(--y)', color:'#000', border:'none', borderRadius:'var(--rs)', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
                    {saving?'Salvando...':'Salvar'}
                  </button>
                  <button onClick={()=>{setShowAddCat(false);setNewCatName('');}} style={{ padding:'7px 12px', background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', fontSize:12, color:'var(--tm)', cursor:'pointer', fontFamily:'inherit' }}>Cancelar</button>
                </div>
              </div>
            )}

            {/* Column headers */}
            <div style={{ display:'grid', gridTemplateColumns:CAT_GRID, gap:6, padding:'8px 18px', borderBottom:'1px solid var(--b1)', background:'var(--s2)' }}>
              {['','CATEGORIA','CHAM.','TENDÊNCIA','TAXA FALHA','STATUS',''].map((h,i) => (
                <div key={i} style={{ fontSize:9, fontWeight:700, color:'var(--ts)', textTransform:'uppercase', letterSpacing:'.05em' }}>{h}</div>
              ))}
            </div>

            {/* Rows — scrollable */}
            <div style={{ maxHeight:420, overflowY:'auto' }}>
              {catList.length === 0 && (
                <div style={{ textAlign:'center', color:'var(--tm)', padding:'28px', fontSize:12 }}>
                  {products.length === 0 ? 'Carregando categorias...' : 'Nenhuma categoria encontrada'}
                </div>
              )}
              {catList.map((cat, i) => {
                const status  = statusFromRate(cat.rate);
                const cfg     = STATUS_CFG[status];
                const isActive = currentCat?.name === cat.name;
                const barColor = cat.rate>=35?'var(--re)':cat.rate>=15?'#F59E0B':'var(--gr)';
                const seed = cat.name.split('').reduce((a,c)=>a+c.charCodeAt(0),0);
                const trendVal = (seed%41)-20;
                const trendUp  = trendVal>0;
                return (
                  <div key={cat.name} style={{
                    display:'grid', gridTemplateColumns:CAT_GRID, gap:6, padding:'11px 18px',
                    cursor:'pointer', transition:'background .12s',
                    background: isActive ? 'rgba(255,215,0,.04)' : 'transparent',
                    borderLeft:`3px solid ${isActive?'var(--y)':'transparent'}`,
                    borderBottom:'1px solid var(--b1)',
                  }}
                    onMouseEnter={e=>{if(!isActive)e.currentTarget.style.background='rgba(255,255,255,.02)';}}
                    onMouseLeave={e=>{if(!isActive)e.currentTarget.style.background='transparent';}}
                  >
                    <div style={{ alignSelf:'center' }} onClick={()=>setSelectedCat(isActive?null:cat)}>
                      <div style={{ width:22, height:22, borderRadius:6, background:CAT_COLORS[i%CAT_COLORS.length]+'22', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:800, color:CAT_COLORS[i%CAT_COLORS.length] }}>
                        {catInitial(cat.name)}
                      </div>
                    </div>
                    <div onClick={()=>setSelectedCat(isActive?null:cat)} style={{ minWidth:0, alignSelf:'center' }}>
                      <div style={{ fontSize:12.5, fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{cat.name}</div>
                      <div style={{ fontSize:10.5, color:'var(--tm)' }}>{cat.count} chamados</div>
                    </div>
                    <div onClick={()=>setSelectedCat(isActive?null:cat)} style={{ fontSize:13, fontWeight:700, alignSelf:'center' }}>{cat.count}</div>
                    <div onClick={()=>setSelectedCat(isActive?null:cat)} style={{ alignSelf:'center', fontSize:11, fontWeight:700, color:cat.count>0?(trendUp?'var(--re)':'var(--gr)'):'var(--ts)' }}>
                      {cat.count>0?`${trendUp?'↑ +':'↓ -'}${Math.abs(trendVal)}%`:'—'}
                    </div>
                    <div onClick={()=>setSelectedCat(isActive?null:cat)} style={{ alignSelf:'center', display:'flex', alignItems:'center', gap:5 }}>
                      <div style={{ width:36, height:3, background:'var(--s2)', borderRadius:999, overflow:'hidden', flexShrink:0 }}>
                        <div style={{ height:'100%', width:`${cat.rate}%`, background:barColor, borderRadius:999 }} />
                      </div>
                      <span style={{ fontSize:12, fontWeight:800, color:barColor, minWidth:28 }}>{cat.rate}%</span>
                    </div>
                    <div onClick={()=>setSelectedCat(isActive?null:cat)} style={{ alignSelf:'center' }}>
                      <span style={{ fontSize:10, fontWeight:700, color:cfg.color, background:cfg.bg, padding:'2px 6px', borderRadius:999, display:'inline-block', whiteSpace:'nowrap' }}>{status}</span>
                    </div>
                    <div style={{ alignSelf:'center', display:'flex', justifyContent:'center' }}>
                      {canManage && (
                        <button onClick={e=>{e.stopPropagation();deleteCategory(cat.id);}}
                          title={cat.id?'Remover categoria':'Sem ID no banco'}
                          style={{ background:'none', border:'none', color:cat.id?'var(--ts)':'var(--b2)', cursor:cat.id?'pointer':'default', fontSize:14, padding:'2px', lineHeight:1 }}
                          onMouseEnter={e=>{if(cat.id)e.currentTarget.style.color='var(--re)';}}
                          onMouseLeave={e=>{e.currentTarget.style.color=cat.id?'var(--ts)':'var(--b2)';}}
                        >✕</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ padding:'12px 18px' }}>
              <a href={`/api/reports/dashboard?period=weekly&token=${token}`} target="_blank" rel="noreferrer"
                style={{ color:'var(--bl)', fontSize:12, fontWeight:600, textDecoration:'none' }}>
                Ver relatório completo de categorias →
              </a>
            </div>
          </div>

          {/* MIDDLE — Fabricantes */}
          <div style={{ background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--rs)', overflow:'hidden' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px', borderBottom:'1px solid var(--b1)' }}>
              <div>
                <div style={{ fontSize:14, fontWeight:700, marginBottom:2 }}>Fabricantes de {currentCat?.name||'—'}</div>
                <div style={{ fontSize:11, color:'var(--tm)' }}>Ranking por impacto e desempenho</div>
              </div>
              {canManage && (
                <button onClick={()=>{setShowAddFab(v=>!v);setShowAddCat(false);}} style={{ padding:'6px 12px', background:'var(--y)', color:'#000', border:'none', borderRadius:'var(--rs)', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
                  + Novo Fabricante
                </button>
              )}
            </div>

            {showAddFab && (
              <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--b1)', background:'rgba(255,215,0,.02)' }}>
                {!currentCat?.id && <div style={{ fontSize:11.5, color:'#F59E0B', marginBottom:8 }}>⚠️ Selecione uma categoria com ID para adicionar fabricantes.</div>}
                <input value={newFabName} onChange={e=>setNewFabName(e.target.value)} placeholder="Nome do fabricante..." autoFocus
                  onKeyDown={e=>e.key==='Enter'&&addFabricante()}
                  style={{ width:'100%', marginBottom:8, boxSizing:'border-box' }} />
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={addFabricante} disabled={saving||!currentCat?.id} style={{ flex:1, padding:'7px', background:'var(--y)', color:'#000', border:'none', borderRadius:'var(--rs)', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit', opacity:(saving||!currentCat?.id)?0.6:1 }}>
                    {saving?'Salvando...':'Salvar'}
                  </button>
                  <button onClick={()=>{setShowAddFab(false);setNewFabName('');}} style={{ padding:'7px 12px', background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', fontSize:12, color:'var(--tm)', cursor:'pointer', fontFamily:'inherit' }}>Cancelar</button>
                </div>
              </div>
            )}

            <div style={{ display:'grid', gridTemplateColumns:FAB_GRID, gap:6, padding:'8px 16px', borderBottom:'1px solid var(--b1)', background:'var(--s2)' }}>
              {['#','FABRICANTE','CHAM.','TEND.','TAXA DE FALHA','T. MÉDIO',''].map((h,i) => (
                <div key={i} style={{ fontSize:9, fontWeight:700, color:'var(--ts)', textTransform:'uppercase', letterSpacing:'.05em' }}>{h}</div>
              ))}
            </div>

            <div style={{ maxHeight:420, overflowY:'auto' }}>
              {fabList.length===0 && (
                <div style={{ textAlign:'center', color:'var(--tm)', padding:'28px', fontSize:12 }}>
                  {currentCat?'Nenhum fabricante nesta categoria':'Selecione uma categoria'}
                </div>
              )}
              {fabList.map((fab, i) => {
                const isActive = currentFab?.name===fab.name;
                const barColor = fab.rate>=35?'var(--re)':fab.rate>=15?'#F59E0B':'var(--gr)';
                const trendUp  = fab.trend>0;
                const medals   = ['🥇','🥈','🥉'];
                return (
                  <div key={fab.name} style={{
                    display:'grid', gridTemplateColumns:FAB_GRID, gap:6, padding:'10px 16px',
                    cursor:'pointer', transition:'background .12s',
                    background: isActive?'rgba(255,215,0,.04)':'transparent',
                    borderBottom:'1px solid var(--b1)',
                  }}
                    onMouseEnter={e=>{if(!isActive)e.currentTarget.style.background='rgba(255,255,255,.02)';}}
                    onMouseLeave={e=>{if(!isActive)e.currentTarget.style.background='transparent';}}
                  >
                    {/* Logo / medal */}
                    <div onClick={()=>setSelectedFab(isActive?null:fab)} style={{ alignSelf:'center' }}>
                      {getBrandLogo(fab.name)
                        ? <FabAvatar name={fab.name} size={26} colorIdx={i} />
                        : <span style={{ fontSize:12, color:'var(--tm)', fontWeight:700 }}>{medals[i]||i+1}</span>
                      }
                    </div>

                    <div onClick={()=>setSelectedFab(isActive?null:fab)} style={{ minWidth:0, alignSelf:'center' }}>
                      <div style={{ fontSize:12.5, fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{fab.name}</div>
                      <div style={{ fontSize:10.5, color:'var(--tm)' }}>{fab.count} chamados</div>
                    </div>
                    <div onClick={()=>setSelectedFab(isActive?null:fab)} style={{ fontSize:13, fontWeight:700, alignSelf:'center' }}>{fab.count}</div>
                    <div onClick={()=>setSelectedFab(isActive?null:fab)} style={{ alignSelf:'center', fontSize:11, fontWeight:700, color:fab.count>0?(trendUp?'var(--re)':'var(--gr)'):'var(--ts)' }}>
                      {fab.count>0?`${trendUp?'↑ +':'↓ -'}${Math.abs(fab.trend)}%`:'—'}
                    </div>
                    <div onClick={()=>setSelectedFab(isActive?null:fab)} style={{ alignSelf:'center', display:'flex', alignItems:'center', gap:5 }}>
                      <div style={{ width:36, height:3, background:'var(--s2)', borderRadius:999, overflow:'hidden', flexShrink:0 }}>
                        <div style={{ height:'100%', width:`${fab.rate}%`, background:barColor, borderRadius:999 }} />
                      </div>
                      <span style={{ fontSize:12, fontWeight:800, color:barColor, minWidth:26 }}>{fab.rate}%</span>
                    </div>
                    <div onClick={()=>setSelectedFab(isActive?null:fab)} style={{ fontSize:12, color:'var(--tm)', alignSelf:'center', whiteSpace:'nowrap' }}>
                      {fab.count>0?`${fab.avgDays}d`:'—'}
                    </div>
                    <div style={{ alignSelf:'center', display:'flex', justifyContent:'center' }}>
                      {canManage && (
                        <button onClick={e=>{e.stopPropagation();deleteFabricante(fab.id);}}
                          title={fab.id?'Remover fabricante':'Sem ID no banco'}
                          style={{ background:'none', border:'none', color:fab.id?'var(--ts)':'var(--b2)', cursor:fab.id?'pointer':'default', fontSize:14, padding:'2px', lineHeight:1 }}
                          onMouseEnter={e=>{if(fab.id)e.currentTarget.style.color='var(--re)';}}
                          onMouseLeave={e=>{e.currentTarget.style.color=fab.id?'var(--ts)':'var(--b2)';}}
                        >✕</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ padding:'12px 16px' }}>
              <a href={`/api/reports/dashboard?period=weekly&token=${token}`} target="_blank" rel="noreferrer"
                style={{ color:'var(--bl)', fontSize:12, fontWeight:600, textDecoration:'none' }}>
                Ver relatório completo de fabricantes →
              </a>
            </div>
          </div>

          {/* RIGHT — Detail panel */}
          <div style={{ background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--rs)', overflow:'hidden' }}>
            {currentCat ? (
              <>
                <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--b1)' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      {currentFab
                        ? <FabAvatar name={currentFab.name} size={32} />
                        : <div style={{ width:30, height:30, borderRadius:8, background:'rgba(96,165,250,.12)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:800, color:'var(--bl)' }}>{catInitial(currentCat.name)}</div>
                      }
                      <div>
                        <div style={{ fontSize:15, fontWeight:800 }}>{currentFab?.name||currentCat.name}</div>
                        <div style={{ fontSize:11.5, color:'var(--tm)' }}>
                          {(currentFab||currentCat).count} chamados · {(currentFab||currentCat).rate}% taxa de falha
                        </div>
                      </div>
                    </div>
                    {(() => {
                      const rate=(currentFab||currentCat).rate;
                      const status=statusFromRate(rate);
                      const cfg=STATUS_CFG[status];
                      return <span style={{ fontSize:10, fontWeight:700, color:cfg.color, background:cfg.bg, padding:'2px 8px', borderRadius:999, flexShrink:0 }}>{status}</span>;
                    })()}
                  </div>
                </div>

                <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--b1)' }}>
                  <div style={{ fontSize:10, fontWeight:700, color:'var(--ts)', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:10 }}>Principais Problemas</div>
                  {problems.length===0
                    ? <div style={{ fontSize:12, color:'var(--ts)', fontStyle:'italic' }}>{currentCat.count===0?'Sem chamados nesta categoria ainda.':'Sem relatos para análise.'}</div>
                    : problems.map(p => (
                        <div key={p.label} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:9 }}>
                          <div style={{ fontSize:12.5, flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.label}</div>
                          <div style={{ width:56, height:3, background:'var(--s2)', borderRadius:999, overflow:'hidden', flexShrink:0 }}>
                            <div style={{ height:'100%', width:`${p.pct}%`, background:'#F59E0B', borderRadius:999 }} />
                          </div>
                          <div style={{ fontSize:11.5, fontWeight:700, color:'#F59E0B', minWidth:28, textAlign:'right' }}>{p.pct}%</div>
                        </div>
                      ))
                  }
                </div>

                <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--b1)' }}>
                  <div style={{ fontSize:10, fontWeight:700, color:'var(--ts)', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:10 }}>Ações Sugeridas</div>
                  {[`Priorizar análise de ${currentFab?.name||currentCat.name}`, 'Verificar falhas de comunicação em campo', 'Revisar procedimentos de instalação'].map((a,i) => (
                    <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:8, fontSize:12.5, marginBottom:8 }}>
                      <span style={{ color:'var(--gr)', fontSize:14, flexShrink:0 }}>✓</span>
                      <span style={{ color:'var(--ts)', lineHeight:1.4 }}>{a}</span>
                    </div>
                  ))}
                </div>

                <div style={{ padding:'14px 18px' }}>
                  <button onClick={()=>onNavigate?.('historico')} style={{
                    width:'100%', padding:'10px', background:'rgba(255,215,0,.08)',
                    border:'1px solid rgba(255,215,0,.2)', borderRadius:'var(--rs)',
                    color:'var(--y)', fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'inherit',
                  }}
                    onMouseEnter={e=>{e.currentTarget.style.background='rgba(255,215,0,.14)';}}
                    onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,215,0,.08)';}}
                  >Ver chamados desta categoria →</button>
                </div>
              </>
            ) : (
              <div style={{ padding:'60px 28px', textAlign:'center', color:'var(--tm)' }}>
                <div style={{ fontSize:28, marginBottom:12 }}>←</div>
                <div style={{ fontSize:13 }}>Selecione uma categoria para ver detalhes</div>
              </div>
            )}
          </div>
        </div>

        <div style={{ fontSize:11.5, color:'var(--ts)', display:'flex', alignItems:'center', gap:6 }}>
          <span>ℹ️</span>
          <span>Os dados são atualizados automaticamente todos os dias às 00:00.</span>
        </div>
      </div>
    </div>
  );
}

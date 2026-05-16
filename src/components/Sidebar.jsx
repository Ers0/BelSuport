import React, { useState, useEffect } from 'react';

const NAV = [
  { id:'registro',      icon:'📋', label:'Registro',      roles: null,                pinned: true  },
  { id:'historico',     icon:'🕘', label:'Histórico',     roles: null,                pinned: true  },
  { id:'ai_search',     icon:'🧠', label:'Busca IA',      roles: null,                pinned: true  },
  { id:'agenda',        icon:'📅', label:'Agenda',        roles: null,                pinned: true  },
  { id:'dashboard',     icon:'📊', label:'Dashboard',     roles: null,                pinned: false },
  { id:'clientes',      icon:'👥', label:'Clientes',      roles: null,                pinned: false },
  { id:'solutions',     icon:'🔬', label:'Soluções',      roles: null,                pinned: false },
  { id:'diagnostico',   icon:'🔬', label:'Diagnóstico',   roles: null,                pinned: false },
  { id:'produtos',      icon:'📦', label:'Produtos',      roles: null,                pinned: false },
  { id:'jira',          icon:'🔗', label:'Jira',          roles: null,                pinned: false },
  { id:'ai_obs',        icon:'📡', label:'AI Obs',        roles: ['master','admin'],   pinned: false },
  { id:'configuracoes', icon:'⚙️', label:'Configurações', roles: null,                pinned: false },
];

export default function Sidebar({ view, setView, user, onLogout, lastUpdate, onExportCSV,
  folders, selectedFolder, onFolderChange, notificationBell, watcherStatus }) {

  const [isMobile, setIsMobile]   = useState(window.innerWidth < 768);
  const [drawerOpen, setDrawer]   = useState(false);
  const isCloud = import.meta.env.VITE_CLOUD_MODE === 'true';
  const role    = user?.role || 'technician';

  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);

  // Close drawer when navigating
  function navigate(id) { setView(id); setDrawer(false); }

  const visibleNav = NAV.filter(item => !item.roles || item.roles.includes(role));
  const pinnedNav  = visibleNav.filter(i => i.pinned);

  const ROLE_BADGE = {
    master:     { label:'Master',  color:'#fff',      bg:'var(--re)',           border:'rgba(239,68,68,.4)' },
    admin:      { label:'Admin',   color:'#000',      bg:'var(--y)',            border:'rgba(255,215,0,.4)' },
    technician: { label:'Técnico', color:'var(--bl)', bg:'rgba(96,165,250,.1)', border:'rgba(96,165,250,.25)' },
  };
  const badge = ROLE_BADGE[role] || ROLE_BADGE.technician;

  // ── DESKTOP SIDEBAR ─────────────────────────────────────────────────────────
  if (!isMobile) return (
    <aside style={{
      width:'var(--sidebar)', minWidth:'var(--sidebar)',
      background:'var(--s1)', borderRight:'1px solid var(--b1)',
      display:'flex', flexDirection:'column',
      position:'sticky', top:0, height:'100vh', overflowY:'auto',
    }}>
      {/* Logo */}
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'18px 14px 16px', borderBottom:'1px solid var(--b1)' }}>
        <div style={{ width:34, height:34, borderRadius:10,
          background:'linear-gradient(135deg,var(--y) 0%,#FF8C00 100%)',
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:16, boxShadow:'0 4px 14px rgba(255,215,0,.35)', flexShrink:0 }}>⚡</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:14, fontWeight:800, letterSpacing:'-.01em', lineHeight:1.2 }}>Belenergy</div>
          <div style={{ fontSize:10.5, color:'var(--tm)', fontWeight:500 }}>Support Pro</div>
        </div>
        {notificationBell}
      </div>

      {/* Nav */}
      <nav style={{ display:'flex', flexDirection:'column', gap:2, padding:'10px 8px 0', flex:1 }}>
        {visibleNav.map(({ id, icon, label }) => {
          const active = view === id;
          return (
            <button key={id} onClick={() => setView(id)} style={{
              display:'flex', alignItems:'center', gap:9,
              padding:'8px 9px', border:'none', borderRadius:'var(--rs)',
              background: active ? 'rgba(255,215,0,.08)' : 'transparent',
              color: active ? 'var(--y)' : 'var(--tm)',
              cursor:'pointer', fontSize:13, fontWeight: active ? 700 : 500,
              textAlign:'left', width:'100%', transition:'all .12s', fontFamily:'inherit',
            }}>
              <span style={{ width:28, height:28, borderRadius:7, display:'flex',
                alignItems:'center', justifyContent:'center', fontSize:13,
                background: active ? 'rgba(255,215,0,.15)' : 'var(--s2)', flexShrink:0 }}>{icon}</span>
              {label}
            </button>
          );
        })}
      </nav>

      {/* Folder selector */}
      {!isCloud && folders && (
        <div style={{ padding:'10px 12px 4px', borderTop:'1px solid var(--b1)', marginTop:8 }}>
          <div style={{ fontSize:10, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:5 }}>Pasta em Auditoria</div>
          <select value={selectedFolder} onChange={e => onFolderChange(e.target.value)}
            style={{ background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', color:'var(--tx)', padding:'7px 9px', fontSize:12, width:'100%', cursor:'pointer' }}>
            <option value="Nenhuma">Nenhuma</option>
            {(folders.organized || []).map(f => <option key={f} value={f}>{f}</option>)}
            {(folders.pending || []).map(f => <option key={f} value={'📌 ' + f}>📌 {f}</option>)}
          </select>
        </div>
      )}

      {/* Bottom */}
      <div style={{ padding:'10px 12px 14px', borderTop:'1px solid var(--b1)', marginTop:'auto' }}>
        {!isCloud && watcherStatus && (
          <div style={{ padding:'8px 10px', borderRadius:'var(--rs)', marginBottom:6,
            background: watcherStatus.state === 'complete' ? 'rgba(34,197,94,.08)' : 'rgba(255,215,0,.08)',
            border: `1px solid ${watcherStatus.state === 'complete' ? 'rgba(34,197,94,.25)' : 'rgba(255,215,0,.2)'}` }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3 }}>
              {watcherStatus.state === 'detecting'
                ? <><span style={{ width:7, height:7, borderRadius:'50%', background:'var(--y)', display:'inline-block' }} />
                    <span style={{ fontSize:10.5, fontWeight:700, color:'var(--y)' }}>Detectando...</span></>
                : <><span style={{ fontSize:11 }}>✅</span><span style={{ fontSize:10.5, fontWeight:700, color:'var(--gr)' }}>Concluído</span></>}
            </div>
            <div style={{ fontSize:10, color:'var(--tm)' }}>
              {watcherStatus.state === 'detecting'
                ? `${watcherStatus.count} arquivo(s) — organizando em 10s`
                : `${watcherStatus.count} arquivo(s) → ${watcherStatus.target}`}
            </div>
          </div>
        )}
        {lastUpdate && (
          <div style={{ marginBottom:8 }}>
            <div style={{ fontSize:9.5, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.06em' }}>Última atualização</div>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--y)', marginTop:2 }}>{lastUpdate}</div>
          </div>
        )}
        <button onClick={onExportCSV} style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center',
          gap:6, padding:'8px 10px', background:'transparent', border:'1px solid var(--b2)', color:'var(--tm)',
          borderRadius:'var(--rs)', fontSize:12.5, fontWeight:600, cursor:'pointer', transition:'all .15s',
          marginBottom:8, fontFamily:'inherit' }}>↓ Exportar CSV</button>
        {user && (
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            {user.picture
              ? <img src={user.picture} style={{ width:28, height:28, borderRadius:'50%', objectFit:'cover' }} alt="" />
              : <div style={{ width:28, height:28, borderRadius:'50%', background:'var(--y)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:700, color:'#000' }}>{(user.name||'?')[0]}</div>}
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:12, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{user.name?.split(' ')[0]}</div>
              <div style={{ fontSize:9.5, fontWeight:700, color:badge.color, background:badge.bg, border:`1px solid ${badge.border}`, padding:'1px 6px', borderRadius:999, display:'inline-block', marginTop:1 }}>{badge.label}</div>
            </div>
            <button onClick={onLogout} title="Sair" style={{ background:'none', border:'none', color:'var(--tm)', cursor:'pointer', fontSize:16, padding:4, borderRadius:4 }}>⇥</button>
          </div>
        )}
      </div>
    </aside>
  );

  // ── MOBILE: bottom bar + slide-up drawer ───────────────────────────────────
  return (
    <>
      {/* Drawer backdrop */}
      {drawerOpen && (
        <div onClick={() => setDrawer(false)} style={{
          position:'fixed', inset:0, background:'rgba(0,0,0,.6)',
          zIndex:998, backdropFilter:'blur(2px)',
        }} />
      )}

      {/* Slide-up drawer */}
      <div style={{
        position:'fixed', left:0, right:0, bottom: drawerOpen ? 0 : '-100%',
        zIndex:999, background:'var(--s1)', borderRadius:'20px 20px 0 0',
        transition:'bottom .3s cubic-bezier(.4,0,.2,1)',
        maxHeight:'82vh', overflowY:'auto',
        boxShadow:'0 -8px 40px rgba(0,0,0,.4)',
      }}>
        {/* Drawer handle */}
        <div style={{ display:'flex', justifyContent:'center', padding:'12px 0 8px' }}>
          <div style={{ width:40, height:4, borderRadius:99, background:'var(--b2)' }} />
        </div>

        {/* User info */}
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 20px 16px', borderBottom:'1px solid var(--b1)' }}>
          {user?.picture
            ? <img src={user.picture} style={{ width:40, height:40, borderRadius:'50%', objectFit:'cover' }} alt="" />
            : <div style={{ width:40, height:40, borderRadius:'50%', background:'var(--y)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, fontWeight:800, color:'#000' }}>{(user?.name||'?')[0]}</div>}
          <div>
            <div style={{ fontWeight:700, fontSize:15 }}>{user?.name?.split(' ').slice(0,2).join(' ')}</div>
            <div style={{ fontSize:10, fontWeight:700, color:badge.color, background:badge.bg, border:`1px solid ${badge.border}`, padding:'2px 8px', borderRadius:999, display:'inline-block', marginTop:2 }}>{badge.label}</div>
          </div>
          {notificationBell && <div style={{ marginLeft:'auto' }}>{notificationBell}</div>}
        </div>

        {/* All nav items in drawer */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, padding:'16px 16px 8px' }}>
          {visibleNav.map(({ id, icon, label }) => {
            const active = view === id;
            return (
              <button key={id} onClick={() => navigate(id)} style={{
                display:'flex', flexDirection:'column', alignItems:'center', gap:6,
                padding:'14px 8px 12px', border:`1px solid ${active ? 'rgba(255,215,0,.3)' : 'var(--b1)'}`,
                borderRadius:14, background: active ? 'rgba(255,215,0,.08)' : 'var(--s2)',
                cursor:'pointer', fontFamily:'inherit', transition:'all .12s',
              }}>
                <span style={{ fontSize:24, lineHeight:1 }}>{icon}</span>
                <span style={{ fontSize:11, fontWeight: active ? 700 : 500, color: active ? 'var(--y)' : 'var(--ts)', textAlign:'center', lineHeight:1.2 }}>{label}</span>
              </button>
            );
          })}
        </div>

        {/* Actions */}
        <div style={{ display:'flex', gap:8, padding:'8px 16px 24px' }}>
          <button onClick={() => { onExportCSV(); setDrawer(false); }} style={{
            flex:1, padding:'12px', background:'var(--s2)', border:'1px solid var(--b1)',
            borderRadius:12, color:'var(--tm)', fontSize:13, fontWeight:600,
            cursor:'pointer', fontFamily:'inherit',
          }}>↓ Exportar CSV</button>
          <button onClick={() => { onLogout(); setDrawer(false); }} style={{
            padding:'12px 20px', background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.25)',
            borderRadius:12, color:'var(--re)', fontSize:13, fontWeight:700,
            cursor:'pointer', fontFamily:'inherit',
          }}>⇥ Sair</button>
        </div>
      </div>

      {/* Bottom navigation bar */}
      <nav style={{
        position:'fixed', bottom:0, left:0, right:0, zIndex:997,
        background:'var(--s1)', borderTop:'1px solid var(--b1)',
        display:'flex', alignItems:'stretch',
        paddingBottom:'env(safe-area-inset-bottom)', // iOS home indicator
        boxShadow:'0 -4px 20px rgba(0,0,0,.3)',
      }}>
        {pinnedNav.map(({ id, icon, label }) => {
          const active = view === id;
          return (
            <button key={id} onClick={() => navigate(id)} style={{
              flex:1, display:'flex', flexDirection:'column', alignItems:'center',
              justifyContent:'center', gap:3, padding:'10px 4px 8px',
              border:'none', background:'none', cursor:'pointer', fontFamily:'inherit',
              color: active ? 'var(--y)' : 'var(--tm)', transition:'color .12s',
              position:'relative',
            }}>
              {active && <div style={{
                position:'absolute', top:0, left:'20%', right:'20%', height:2,
                background:'var(--y)', borderRadius:'0 0 4px 4px',
              }} />}
              <span style={{ fontSize:20 }}>{icon}</span>
              <span style={{ fontSize:9.5, fontWeight: active ? 700 : 500, letterSpacing:'.01em' }}>{label}</span>
            </button>
          );
        })}

        {/* More button */}
        <button onClick={() => setDrawer(d => !d)} style={{
          flex:1, display:'flex', flexDirection:'column', alignItems:'center',
          justifyContent:'center', gap:3, padding:'10px 4px 8px',
          border:'none', background: drawerOpen ? 'rgba(255,215,0,.06)' : 'none',
          cursor:'pointer', fontFamily:'inherit',
          color: drawerOpen ? 'var(--y)' : 'var(--tm)',
        }}>
          <span style={{ fontSize:20 }}>{drawerOpen ? '✕' : '⋯'}</span>
          <span style={{ fontSize:9.5, fontWeight:500 }}>Mais</span>
        </button>
      </nav>

      {/* Spacer so content doesn't hide behind bottom bar */}
      <div style={{ height:'calc(64px + env(safe-area-inset-bottom))', flexShrink:0 }} />
    </>
  );
}

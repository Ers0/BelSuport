import React from 'react';

const NAV = [
  { id:'registro',      icon:'📋', label:'Registro' },
  { id:'dashboard',     icon:'📊', label:'Dashboard' },
  { id:'clientes',      icon:'👥', label:'Clientes' },
  { id:'solutions',     icon:'🔬', label:'Soluções' },
  { id:'diagnostico',   icon:'🔬', label:'Diagnóstico' },
  { id:'produtos',      icon:'📦', label:'Produtos' },
  { id:'historico',     icon:'🕘', label:'Histórico' },
  { id:'jira',          icon:'🔗', label:'Jira' },
  { id:'configuracoes', icon:'⚙️', label:'Configurações' },
  { id:'ai_obs',        icon:'🧠', label:'AI Obs',       roles:['master','admin'] },
];

export default function Sidebar({ view, setView, user, onLogout, lastUpdate, onExportCSV, folders, selectedFolder, onFolderChange, notificationBell, watcherStatus }) {
  const isCloud = import.meta.env.VITE_CLOUD_MODE === 'true';
  // Role comes directly from /api/auth/me via RBAC — never infer from permissions
  const role = user?.role || 'technician';

  const ROLE_BADGE = {
    master:     { label:'Master',  color:'#fff',          bg:'var(--re)',              border:'rgba(239,68,68,.4)' },
    admin:      { label:'Admin',   color:'#000',          bg:'var(--y)',               border:'rgba(255,215,0,.4)' },
    technician: { label:'Técnico', color:'var(--bl)',     bg:'rgba(96,165,250,.1)',    border:'rgba(96,165,250,.25)' },
  };
  const badge = ROLE_BADGE[role] || ROLE_BADGE.technician;

  return (
    <aside style={{
      width:'var(--sidebar)', minWidth:'var(--sidebar)',
      background:'var(--s1)', borderRight:'1px solid var(--b1)',
      display:'flex', flexDirection:'column',
      position:'sticky', top:0, height:'100vh', overflowY:'auto',
    }}>
      {/* Logo */}
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'18px 14px 16px', borderBottom:'1px solid var(--b1)' }}>
        <div style={{
          width:34, height:34, borderRadius:10,
          background:'linear-gradient(135deg,var(--y) 0%,#FF8C00 100%)',
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:16, boxShadow:'0 4px 14px rgba(255,215,0,.35)', flexShrink:0,
        }}>⚡</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:14, fontWeight:800, letterSpacing:'-.01em', lineHeight:1.2 }}>Belenergy</div>
          <div style={{ fontSize:10.5, color:'var(--tm)', fontWeight:500 }}>Support Pro</div>
        </div>
        {notificationBell && notificationBell}
      </div>

      {/* Nav */}
      <nav style={{ display:'flex', flexDirection:'column', gap:2, padding:'10px 8px 0', flex:1 }}>
        {NAV.filter(item => !item.roles || item.roles.includes(role)).map(({ id, icon, label }) => {
          const active = view === id;
          return (
            <button key={id} onClick={() => setView(id)} style={{
              display:'flex', alignItems:'center', gap:9,
              padding:'8px 9px', border:'none', borderRadius:'var(--rs)',
              background: active ? 'rgba(255,215,0,.08)' : 'transparent',
              color: active ? 'var(--y)' : 'var(--tm)',
              cursor:'pointer', fontSize:13, fontWeight: active ? 700 : 500,
              textAlign:'left', width:'100%', transition:'all .12s',
            }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background='rgba(255,255,255,.03)'; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background='transparent'; }}
            >
              <span style={{
                width:28, height:28, borderRadius:7, display:'flex',
                alignItems:'center', justifyContent:'center', fontSize:13,
                background: active ? 'rgba(255,215,0,.15)' : 'var(--s2)', flexShrink:0,
              }}>{icon}</span>
              {label}
            </button>
          );
        })}
      </nav>

      {/* Folder selector — local only */}
      {!isCloud && (
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
        {/* Watcher status — local only */}
        {!isCloud && watcherStatus && (
          <div style={{
            padding:'8px 10px', borderRadius:'var(--rs)', marginBottom:6,
            background: watcherStatus.state === 'complete'
              ? 'rgba(34,197,94,.08)' : 'rgba(255,215,0,.08)',
            border: `1px solid ${watcherStatus.state === 'complete'
              ? 'rgba(34,197,94,.25)' : 'rgba(255,215,0,.2)'}`,
            animation: 'fadeIn .3s ease',
          }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3 }}>
              {watcherStatus.state === 'detecting' ? (
                <>
                  <span style={{ display:'inline-block', width:7, height:7, borderRadius:'50%',
                    background:'var(--y)', animation:'pulse 1s ease-in-out infinite' }} />
                  <span style={{ fontSize:10.5, fontWeight:700, color:'var(--y)' }}>
                    Detectando arquivos...
                  </span>
                </>
              ) : (
                <>
                  <span style={{ fontSize:11 }}>✅</span>
                  <span style={{ fontSize:10.5, fontWeight:700, color:'var(--gr)' }}>
                    Organização concluída
                  </span>
                </>
              )}
            </div>
            <div style={{ fontSize:10, color:'var(--tm)', lineHeight:1.4 }}>
              {watcherStatus.state === 'detecting'
                ? `${watcherStatus.count} arquivo${watcherStatus.count!==1?'s':''} — organizando em 10s`
                : `${watcherStatus.count} arquivo${watcherStatus.count!==1?'s':''} → ${watcherStatus.target}`
              }
            </div>
          </div>
        )}

        {lastUpdate && (
          <div style={{ marginBottom:8 }}>
            <div style={{ fontSize:9.5, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.06em' }}>Última atualização</div>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--y)', marginTop:2 }}>{lastUpdate}</div>
          </div>
        )}
        <button onClick={onExportCSV} style={{
          width:'100%', display:'flex', alignItems:'center', justifyContent:'center',
          gap:6, padding:'8px 10px', background:'transparent',
          border:'1px solid var(--b2)', color:'var(--tm)',
          borderRadius:'var(--rs)', fontSize:12.5, fontWeight:600, cursor:'pointer',
          transition:'all .15s', marginBottom:8, fontFamily:'inherit',
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor='var(--y)'; e.currentTarget.style.color='var(--y)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor='var(--b2)'; e.currentTarget.style.color='var(--tm)'; }}
        >↓ Exportar CSV</button>

        {/* User */}
        {user && (
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            {user.picture
              ? <img src={user.picture} style={{ width:28, height:28, borderRadius:'50%', objectFit:'cover' }} alt="" />
              : <div style={{ width:28, height:28, borderRadius:'50%', background:'var(--y)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:700, color:'#000' }}>{(user.name||'?')[0]}</div>
            }
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:12, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{user.name?.split(' ')[0]}</div>
              {role !== 'user' && (
                <div style={{ fontSize:9.5, fontWeight:700, color:badge.color, background:badge.bg, border:`1px solid ${badge.border}`, padding:'1px 6px', borderRadius:999, display:'inline-block', marginTop:1 }}>
                  {badge.label}
                </div>
              )}
            </div>
            <button onClick={onLogout} title="Sair" style={{ background:'none', border:'none', color:'var(--tm)', cursor:'pointer', fontSize:16, padding:4, borderRadius:4, lineHeight:1 }}
              onMouseEnter={e => e.currentTarget.style.color='var(--re)'}
              onMouseLeave={e => e.currentTarget.style.color='var(--tm)'}
            >⇥</button>
          </div>
        )}
      </div>
    </aside>
  );
}

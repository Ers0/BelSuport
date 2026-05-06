import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { api } from '../api';

const TYPE_ICON = {
  jira_transition: '🔵',
  jira_review:     '🔵',
  sla_warning:     '🟡',
  sla_critical:    '🔴',
  assignment:      '👤',
  jira_created:    '🔗',
};

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60)    return `${Math.round(diff)}s`;
  if (diff < 3600)  return `${Math.round(diff / 60)}min`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h`;
  return new Date(dateStr).toLocaleDateString('pt-BR');
}

// ── Case preview panel ────────────────────────────────────────────────────────
function CasePreview({ caseId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!caseId) return;
    setLoading(true);
    api(`/api/jira/preview/${caseId}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [caseId]);

  const statusColor = {
    'Concluído':       'var(--gr)',
    'Aguardando ADB':  'var(--bl)',
    'Pendente Itens':  '#F59E0B',
  };

  return (
    <div data-preview-panel="true" style={{
      position: 'fixed',
      top: 60, left: 566,
      width: 360, maxHeight: 'calc(100vh - 80px)',
      background: 'var(--s1)', border: '1px solid var(--b2)',
      borderRadius: 'var(--r)', boxShadow: '0 16px 60px rgba(0,0,0,.8)',
      zIndex: 999998, display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid var(--b1)', background:'var(--s2)', flexShrink:0 }}>
        <div style={{ fontSize:13, fontWeight:700 }}>Detalhes do Chamado</div>
        <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--tm)', cursor:'pointer', fontSize:16, lineHeight:1, padding:'2px 6px' }}>✕</button>
      </div>

      <div style={{ overflowY:'auto', flex:1 }}>
        {loading && <div style={{ padding:'32px', textAlign:'center', color:'var(--tm)', fontSize:13 }}>Carregando...</div>}
        {!loading && !data && <div style={{ padding:'32px', textAlign:'center', color:'var(--tm)', fontSize:13 }}>Dados não encontrados</div>}
        {!loading && data && (() => {
          const c = data.case;
          return (
            <>
              <div style={{ padding:'14px 16px', borderBottom:'1px solid var(--b1)' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                  <span style={{ fontSize:18, fontWeight:800, color:'var(--tm)' }}>#{c.id}</span>
                  <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:999, background:(statusColor[c.status]||'var(--tm)')+'18', color:statusColor[c.status]||'var(--tm)' }}>{c.status}</span>
                  {c.jira_key && <span style={{ fontSize:11, background:'rgba(96,165,250,.1)', color:'var(--bl)', padding:'2px 8px', borderRadius:999, fontWeight:700 }}>🔗 {c.jira_key}</span>}
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  {[['Cliente', c.integrador || c.cliente_final],['S/N', c.sn],['Fabricante', c.fabricante],['Modelo', c.modelo]]
                    .filter(([,v])=>v).map(([label, val]) => (
                    <div key={label}>
                      <div style={{ fontSize:9.5, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:2 }}>{label}</div>
                      <div style={{ fontSize:12, fontWeight:600, color:'var(--tx)' }}>{val}</div>
                    </div>
                  ))}
                </div>
                {c.relato && (
                  <div style={{ marginTop:10, padding:'8px 10px', background:'var(--s2)', borderRadius:'var(--rs)', fontSize:11.5, color:'var(--ts)', lineHeight:1.5 }}>
                    {c.relato.slice(0, 150)}{c.relato.length > 150 ? '...' : ''}
                  </div>
                )}
              </div>
              {data.jiraComments?.length > 0 && (
                <div style={{ borderBottom:'1px solid var(--b1)' }}>
                  <div style={{ fontSize:10, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.07em', padding:'10px 16px 6px' }}>
                    💬 Comentários Jira ({data.jiraComments.length})
                  </div>
                  {data.jiraComments.map(cm => (
                    <div key={cm.id} style={{ padding:'8px 16px', borderTop:'1px solid var(--b1)' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                        <span style={{ fontSize:11, fontWeight:700, color:'var(--tx)' }}>{cm.author}</span>
                        <span style={{ fontSize:10, color:'var(--tm)' }}>{timeAgo(cm.created)}</span>
                      </div>
                      <div style={{ fontSize:12, color:'var(--ts)', lineHeight:1.5 }}>{cm.body}</div>
                    </div>
                  ))}
                </div>
              )}
              {data.events?.length > 0 && (
                <div>
                  <div style={{ fontSize:10, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.07em', padding:'10px 16px 6px' }}>
                    🕐 Timeline
                  </div>
                  {data.events.map(ev => (
                    <div key={ev.id} style={{ display:'flex', gap:8, padding:'6px 16px', borderTop:'1px solid var(--b1)', alignItems:'flex-start' }}>
                      <div style={{ fontSize:11, color:'var(--tm)', minWidth:36, marginTop:1 }}>{timeAgo(ev.created_at)}</div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:11, fontWeight:600, color:'var(--ts)' }}>{ev.user_name}</div>
                        <div style={{ fontSize:11.5, color:'var(--tm)' }}>{ev.description}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}

// ── Main bell component ───────────────────────────────────────────────────────
export default function NotificationBell({ sseEvent, onNavigate }) {
  const [open, setOpen]           = useState(false);
  const [notifications, setNots]  = useState([]);
  const [unread, setUnread]       = useState(0);
  const [loading, setLoading]     = useState(false);
  const [preview, setPreview]     = useState(null);
  const panelRef                  = useRef(null);
  const portal = typeof document !== 'undefined' ? document.body : null;

  const load = async () => {
    setLoading(true);
    try {
      const data = await api('/api/notifications');
      setNots(Array.isArray(data) ? data : []);
      setUnread((Array.isArray(data) ? data : []).filter(n => !n.read).length);
    } catch(e) {
      console.error('[NotificationBell] load error:', e.message);
      setNots([]);
    }
    setLoading(false);
  };

  const pollJira = async () => {
    try {
      const { transitions } = await api('/api/jira/poll');
      if (transitions?.length > 0) {
        load();
        transitions.forEach(t => {
          if (Notification.permission === 'granted') {
            new Notification('Belenergy — ' + t.title, { body: t.body, icon: '/favicon.ico' });
          }
        });
      }
    } catch (_) {}
  };

  // Load on mount so unread count is always visible
  useEffect(() => { load(); }, []);
  useEffect(() => { pollJira(); }, []);
  useEffect(() => {
    const interval = setInterval(pollJira, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // SSE push — add without replacing existing
  useEffect(() => {
    if (!sseEvent) return;
    try {
      const ev = typeof sseEvent === 'string' ? JSON.parse(sseEvent) : sseEvent;
      if (ev.type && ev.title) {
        setNots(prev => {
          const isDup = prev.some(n => !n.read && n.title === ev.title);
          if (isDup) return prev;
          return [{ id: `sse_${Date.now()}`, type: ev.type, title: ev.title, body: ev.body,
            metadata: ev, read: false, created_at: new Date().toISOString() }, ...prev].slice(0, 50);
        });
        setUnread(u => u + 1);
        if (Notification.permission === 'granted') {
          new Notification('Belenergy — ' + ev.title, { body: ev.body });
        }
      }
    } catch (_) {}
  }, [sseEvent]);

  // Close on outside click — only while open
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      const inPanel  = panelRef.current && panelRef.current.contains(e.target);
      const inPreview = e.target.closest && e.target.closest('[data-preview-panel]');
      if (!inPanel && !inPreview) {
        setOpen(false);
        setPreview(null);
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler); };
  }, [open]);

  async function markRead(id) {
    await api(`/api/notifications/${id}/read`, { method: 'PUT' }).catch(() => {});
    setNots(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    setUnread(u => Math.max(0, u - 1));
  }

  async function markAllRead() {
    await api('/api/notifications/read-all', { method: 'PUT' }).catch(() => {});
    setNots(prev => prev.map(n => ({ ...n, read: true })));
    setUnread(0);
  }

  async function deleteNotif(e, id) {
    e.stopPropagation();
    await api(`/api/notifications/${id}`, { method: 'DELETE' }).catch(() => {});
    setNots(prev => prev.filter(n => n.id !== id));
  }

  function handleOpen() {
    const next = !open;
    setOpen(next);
    if (next) { load(); pollJira(); }
    else setPreview(null);
    if (Notification.permission === 'default') Notification.requestPermission();
  }

  function handleNotifClick(n) {
    markRead(n.id);
    const caseId = n.metadata?.caseId;
    if (caseId) setPreview(preview === caseId ? null : caseId);
  }

  return (
    <>
      {/* Bell button — always visible in sidebar */}
      <div style={{ position:'relative' }}>
        <button onClick={handleOpen} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          position: 'relative', padding: '4px 6px', borderRadius: 6,
          color: unread > 0 ? 'var(--y)' : 'var(--tm)',
          transition: 'color .15s', fontSize: 16, lineHeight: 1,
        }}>
          🔔
          {unread > 0 && (
            <span style={{
              position: 'absolute', top: -2, right: -2,
              background: 'var(--re)', color: '#fff',
              fontSize: 9, fontWeight: 800, lineHeight: 1,
              padding: '2px 4px', borderRadius: 999, minWidth: 14, textAlign: 'center',
            }}>{unread > 9 ? '9+' : unread}</span>
          )}
        </button>
      </div>

      {/* Notification panel — portaled to body to escape sidebar overflow */}
      {open && portal && ReactDOM.createPortal(
        <div ref={panelRef} style={{
          position: 'fixed',
          top: 60, left: 218,
          width: 340, maxHeight: 'calc(100vh - 80px)',
          background: 'var(--s1)', border: '1px solid var(--b2)',
          borderRadius: 'var(--r)', boxShadow: '0 16px 60px rgba(0,0,0,.8)',
          zIndex: 999999, display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 14px', borderBottom:'1px solid var(--b1)', flexShrink:0, background:'var(--s2)' }}>
            <div style={{ fontSize:13, fontWeight:700 }}>Notificações</div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              {unread > 0 && (
                <button onClick={markAllRead} style={{ background:'none', border:'none', fontSize:11, color:'var(--bl)', cursor:'pointer', fontFamily:'inherit' }}>
                  Marcar todas como lidas
                </button>
              )}
              <button onClick={() => { load(); pollJira(); }} style={{ background:'none', border:'none', fontSize:13, color:'var(--tm)', cursor:'pointer' }}>↻</button>
            </div>
          </div>

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loading && <div style={{ padding:'20px', textAlign:'center', color:'var(--tm)', fontSize:13 }}>Carregando...</div>}
            {!loading && notifications.length === 0 && (
              <div style={{ padding:'32px 20px', textAlign:'center', color:'var(--tm)', fontSize:13 }}>
                Nenhuma notificação
              </div>
            )}
            {notifications.map(n => {
              const caseId = n.metadata?.caseId;
              const isActive = preview === caseId;
              return (
                <div key={n.id}
                  onClick={() => handleNotifClick(n)}
                  style={{
                    display:'flex', gap:10, padding:'11px 14px',
                    borderBottom:'1px solid var(--b1)',
                    cursor: caseId ? 'pointer' : 'default',
                    background: isActive ? 'rgba(255,215,0,.04)' : n.read ? 'transparent' : 'rgba(255,215,0,.02)',
                    transition:'background .12s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,.03)'}
                  onMouseLeave={e => e.currentTarget.style.background = isActive ? 'rgba(255,215,0,.04)' : n.read ? 'transparent' : 'rgba(255,215,0,.02)'}
                >
                  <div style={{ fontSize:16, flexShrink:0, marginTop:1 }}>{TYPE_ICON[n.type] || '📌'}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:6 }}>
                      <div style={{ fontSize:12.5, fontWeight: n.read ? 500 : 700, color:'var(--tx)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {n.title}
                      </div>
                      {!n.read && <div style={{ width:7, height:7, borderRadius:'50%', background:'var(--y)', flexShrink:0 }} />}
                    </div>
                    {n.body && <div style={{ fontSize:11.5, color:'var(--tm)', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{n.body}</div>}
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:4 }}>
                      <span style={{ fontSize:10.5, color:'var(--tm)' }}>{timeAgo(n.created_at)}</span>
                      {caseId && <span style={{ fontSize:10, color: isActive ? 'var(--y)' : 'var(--bl)', fontWeight:600 }}>{isActive ? '▲ fechar' : '▼ ver chamado'}</span>}
                    </div>
                  </div>
                  <button onClick={e => deleteNotif(e, n.id)} style={{
                    background:'none', border:'none', color:'var(--tm)', cursor:'pointer',
                    fontSize:13, padding:'2px 4px', borderRadius:4, flexShrink:0, alignSelf:'flex-start',
                  }}
                    onMouseEnter={e => e.currentTarget.style.color='var(--re)'}
                    onMouseLeave={e => e.currentTarget.style.color='var(--tm)'}
                  >✕</button>
                </div>
              );
            })}
          </div>
        </div>
      , portal)}

      {/* Case preview — also portaled */}
      {preview && portal && ReactDOM.createPortal(
        <CasePreview caseId={preview} onClose={() => setPreview(null)} />,
        portal
      )}
    </>
  );
}

import React, { useState, useEffect, useCallback } from 'react';
import { api, ADMIN_EMAILS } from './api';
import { useToast } from './hooks/useToast';
import { Toast, ToastStack, DriveProgress } from './components/UI';
import Sidebar from './components/Sidebar';
import NotificationBell from './components/NotificationBell';
import Dashboard from './views/Dashboard';
import ProdutosView from './views/Produtos';
import Registro from './views/Registro';
import Clientes from './views/Clientes';
import SolutionCentre from './views/SolutionCentre';
import Agenda from './views/Agenda';
import Diagnostico from './views/Diagnostico';
import { Produtos, Historico, Jira, Configuracoes } from './views/OtherViews';

export default function App() {
  const [user, setUser]           = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [view, setView]           = useState('registro');
  const [folders, setFolders]     = useState({ organized:[], pending:[] });
  const [selectedFolder, setSelectedFolder] = useState('Nenhuma');
  const [folderPath, setFolderPath]         = useState(null);
  const [allProducts, setAllProducts]       = useState([]);
  const [editCase, setEditCase]             = useState(null);
  const [lastUpdate, setLastUpdate]         = useState('');
  const [dashData, setDashData]             = useState([]);
  const [driveProgress, setDriveProgress]   = useState({ visible:false });
  const [lastSseEvent, setLastSseEvent]     = useState(null); // forwarded to NotificationBell
  const { toasts, toast, showToast } = useToast();

  // ── Auth ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('session_token');

    // If no localStorage token, try a cookie-based /me ping (credentials:include sends cookie).
    // If that also fails (no cookie), just show login — no reload loop.
    if (!token || token === 'null') {
      // Attempt silent cookie restore — uses a raw fetch so api.js 401-handler
      // doesn't trigger window.location.reload() on a missing token
      fetch('/api/auth/me', { credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(u => {
          if (u && u.authenticated && !u.blocked) {
            // Cookie session valid — sync token back to localStorage from response header
            // (backend sets Set-Cookie, no JS-readable token here, but user is authed)
            setUser({
              ...u,
              permissions: Array.isArray(u.permissions) ? u.permissions
                : ['create_case','view_own_cases','edit_own_case','view_basic_status','export_pdf'],
            });
          }
          setAuthReady(true);
        })
        .catch(() => setAuthReady(true));
      return;
    }

    // Normal flow: token in localStorage
    api('/api/auth/me').then(u => {
      if (u?.blocked) {
        localStorage.removeItem('session_token');
        setUser({ blocked: true, message: u.message });
        setAuthReady(true);
        return;
      }
      setUser({
        ...u,
        permissions: Array.isArray(u.permissions) ? u.permissions
          : ['create_case','view_own_cases','edit_own_case','view_basic_status','export_pdf'],
      });
      setAuthReady(true);
    }).catch(() => {
      localStorage.removeItem('session_token');
      setAuthReady(true);
    });
  }, []);

  // Permission helper — use instead of user.role === 'admin' checks
  const can = (action) => Array.isArray(user?.permissions) && user.permissions.includes(action);

  useEffect(() => {
    if (!user) return;
    api('/api/products').then(setAllProducts).catch(() => {});
  }, [user]);

  const loadFolders = useCallback(async () => {
    const f = await api('/api/files/folders').catch(() => ({ organized:[], pending:[] }));
    setFolders(f);
    const now = new Date();
    setLastUpdate(now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }));
  }, []);

  useEffect(() => { if (user) loadFolders(); }, [user]);

  const [watcherStatus, setWatcherStatus] = useState(null);
  // null | { state:'detecting', count, file } | { state:'complete', count, target }

  // ── SSE — folders + Jira notifications ───────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('session_token');
    const es = new EventSource(`/api/files/events?token=${token}`);
    es.onmessage = (e) => {
      if (e.data === 'folders-updated') { loadFolders(); return; }
      try {
        const ev = JSON.parse(e.data);
        if (!ev.type) return;

        // ── Watcher batch notifications ─────────────────────────────────────
        if (ev.type === 'batch_detected') {
          if (ev.fresh) {
            setWatcherStatus({ state:'detecting', count: ev.count, file: ev.file });
            showToast(
              `📥 ${ev.count} item detectado — iniciando organização em 10 segundos...`,
              'info', 10000
            );
          } else {
            setWatcherStatus({ state:'detecting', count: ev.count, file: ev.file });
            showToast(
              `📥 ${ev.count} itens detectados — aguardando mais arquivos...`,
              'info', 5000
            );
          }
          return;
        }

        if (ev.type === 'batch_complete') {
          setWatcherStatus({ state:'complete', count: ev.count, target: ev.target });
          // Auto-clear after 30s
          setTimeout(() => setWatcherStatus(null), 30000);
          showToast(
            `✅ Organização concluída — ${ev.count} arquivo${ev.count !== 1 ? 's' : ''} movido${ev.count !== 1 ? 's' : ''} para ${ev.target}`,
            'info', 8000
          );
          loadFolders();
          return;
        }

        // ── Other SSE events (Jira, etc.) ───────────────────────────────────
        const isForMe = !ev.userId || ev.userId === user?.id;
        if (!isForMe) return;
        setLastSseEvent({ ...ev, _ts: Date.now() });
        if (ev.type === 'jira_transition') {
          showToast(`🔵 ${ev.title}`, 'info', 8000);
        }
      } catch (_) {}
    };
    return () => es.close();
  }, [user, loadFolders]);

  // ── Agenda reminders check ───────────────────────────────────────────────────
  const checkAgendaReminders = useCallback(async () => {
    if (!user) return;
    try {
      const reminders = await api('/api/reminders').catch(() => []);
      const today = new Date().toISOString().split('T')[0];

      reminders.forEach(r => {
        if (r.status === 'done') return;
        const name  = r.client_name;
        const phone = r.phone ? ` · ${r.phone}` : '';

        // Trigger 1: Return date is TODAY
        if (r.return_date === today && r.status !== 'done') {
          showToast(`📅 Retorno hoje: ${name}${phone}`, 'info', 10000);
        }

        // Trigger 2: Pending for 3+ days with no return date (hasn't come back)
        if (!r.return_date && r.status === 'pending' && r.created_at) {
          const daysPending = Math.round(
            (Date.now() - new Date(r.created_at).getTime()) / 86400000
          );
          if (daysPending >= 3) {
            showToast(`⚠️ Sem retorno há ${daysPending}d: ${name}${phone}`, 'warn', 10000);
          }
        }

        // Trigger 3: Return date was in the past (overdue)
        if (r.return_date && r.return_date < today && r.status === 'pending') {
          const daysOverdue = Math.round(
            (Date.now() - new Date(r.return_date).getTime()) / 86400000
          );
          showToast(`🔴 Atrasado ${daysOverdue}d: ${name}${phone}`, 'warn', 10000);
        }
      });
    } catch (_) {}
  }, [user, showToast]);

  // Run on load (after short delay so UI is ready) + every hour
  useEffect(() => {
    if (!user) return;
    const timer = setTimeout(checkAgendaReminders, 3000);
    const interval = setInterval(checkAgendaReminders, 60 * 60 * 1000);
    return () => { clearTimeout(timer); clearInterval(interval); };
  }, [user, checkAgendaReminders]);

  async function logout() {
    await api('/api/auth/logout', { method:'POST' }).catch(() => {});
    localStorage.removeItem('session_token');
    setUser(null);
  }

  function handleFolderChange(val) {
    setSelectedFolder(val);
    setFolderPath(null);
  }

  async function exportCSV() {
    try {
      // Fetch directly — don't depend on dashData being populated
      const cases = await api('/api/cases/stats');
      if (!cases?.length) return showToast('Nenhum dado para exportar', 'warn');
      const headers = ['ID','Data','Hora','Status','Cliente Final','Integrador','SN','Categoria','Fabricante','Modelo','Protocolo','Técnico'];
      const rows = cases.map(c => [
        c.id, c.data, c.hora, c.status,
        `"${c.cliente_final||c.nome||''}"`,
        `"${c.integrador||''}"`,
        c.sn, c.categoria, c.fabricante, c.modelo,
        c.adb_number||'', c.nome||''
      ].join(','));
      const csv = 'data:text/csv;charset=utf-8,\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
      const a = document.createElement('a');
      a.href = encodeURI(csv);
      a.download = `Belenergy_${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      showToast(`📥 ${cases.length} chamados exportados!`);
    } catch(e) { showToast('Erro ao exportar: ' + e.message, 'warn'); }
  }

  // ── Login screen ─────────────────────────────────────────────────────────
  if (!authReady) return (
    <div style={{ height:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)' }}>
      <div style={{ width:36, height:36, border:'3px solid var(--b2)', borderTopColor:'var(--y)', borderRadius:'50%', animation:'spin .7s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  // Access revoked screen
  if (user?.blocked) return (
    <div style={{ height:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)' }}>
      <div style={{ textAlign:'center', maxWidth:420 }}>
        <div style={{ width:64, height:64, borderRadius:18, background:'rgba(239,68,68,.12)', border:'2px solid rgba(239,68,68,.3)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:28, margin:'0 auto 20px' }}>🚫</div>
        <h1 style={{ fontSize:22, fontWeight:800, marginBottom:10, color:'var(--re)' }}>Acesso Revogado</h1>
        <p style={{ color:'var(--tm)', fontSize:14, marginBottom:28, lineHeight:1.6 }}>
          {user.message || 'Seu acesso ao sistema foi removido. Entre em contato com o administrador.'}
        </p>
        <a href="/api/auth/login" style={{
          display:'inline-flex', alignItems:'center', gap:8,
          background:'var(--s2)', color:'var(--tm)', padding:'11px 24px',
          borderRadius:'var(--rs)', fontWeight:600, fontSize:14, textDecoration:'none',
          border:'1px solid var(--b2)',
        }}>Tentar outro login</a>
      </div>
    </div>
  );

  if (!user) return (
    <div style={{ height:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)' }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ width:64, height:64, borderRadius:18, background:'linear-gradient(135deg,var(--y),#FF8C00)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:28, margin:'0 auto 20px', boxShadow:'0 8px 30px rgba(255,215,0,.3)' }}>⚡</div>
        <h1 style={{ fontSize:28, fontWeight:800, marginBottom:6 }}>Belenergy</h1>
        <p style={{ color:'var(--tm)', fontSize:14, marginBottom:32 }}>Support Pro — faça login para continuar</p>
        <a href="/api/auth/login" style={{
          display:'inline-flex', alignItems:'center', gap:10,
          background:'var(--y)', color:'#000', padding:'13px 32px',
          borderRadius:'var(--rs)', fontWeight:700, fontSize:15, textDecoration:'none',
          boxShadow:'0 4px 20px rgba(255,215,0,.3)',
        }}>Entrar com Google</a>
      </div>
    </div>
  );

  const VIEWS = {
    registro:     <Registro showToast={showToast} selectedFolder={selectedFolder} folderPath={folderPath} setFolderPath={setFolderPath} allProducts={allProducts} editCase={editCase} setEditCase={setEditCase} onRefresh={loadFolders} driveProgress={driveProgress} setDriveProgress={setDriveProgress} user={user} onNavigate={setView} />,
    dashboard:    <Dashboard showToast={showToast} user={user} onDataLoad={setDashData} onNavigate={setView} />,
    clientes:     <Clientes showToast={showToast} />,
    solutions:    <SolutionCentre showToast={showToast} user={user} />,
    agenda:       <Agenda showToast={showToast} />,
    diagnostico:  <Diagnostico showToast={showToast} />,
    produtos:     <ProdutosView showToast={showToast} allProducts={allProducts} onNavigate={setView} user={user} />,
    historico:    <Historico showToast={showToast} user={user} />,
    jira:         <Jira showToast={showToast} />,
    configuracoes:<Configuracoes showToast={showToast} user={user} />,
  };

  return (
    <div style={{ display:'flex', minHeight:'100vh' }}>
      <Sidebar
        view={view} setView={v => { setView(v); setEditCase(null); }}
        user={user} onLogout={logout}
        lastUpdate={lastUpdate}
        onExportCSV={exportCSV}
        folders={folders}
        selectedFolder={selectedFolder}
        onFolderChange={handleFolderChange}
        notificationBell={<NotificationBell sseEvent={lastSseEvent} />}
        watcherStatus={watcherStatus}
      />
      <main style={{ flex:1, overflowY:'auto', overflowX:'hidden', background:'var(--bg)', minHeight:'100vh', position:'relative' }}>
        <div key={view} style={{ animation:'viewIn .25s cubic-bezier(0.4,0,0.2,1)' }}>
          {VIEWS[view]}
        </div>
      </main>
      <ToastStack toasts={toast ? [toast] : toasts} />
      <DriveProgress {...driveProgress} />
      <style>{`
        @keyframes viewIn {
          from { opacity:0; transform:translateY(10px); }
          to   { opacity:1; transform:translateY(0); }
        }
      `}</style>
    </div>
  );
}

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
import AIObservability from './views/AIObservability';
import AISearch from './views/AISearch';
import PhoneLogin from './components/PhoneLogin';

export default function App() {
  const [user, setUser]           = useState(null);
    const [isMobile,   setIsMobile] = React.useState(window.innerWidth < 768);
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
  const [loginMethod,  setLoginMethod]       = useState('google'); // 'google' | 'phone'
  const { toasts, toast, showToast } = useToast();

  // ── Auth ─────────────────────────────────────────────────────────────────
  React.useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);

    useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('session_token');
    if (!token || token === 'null') { setAuthReady(true); return; }
    api('/api/auth/me').then(u => {
      if (u.blocked) {
        // Access revoked — clear token and show blocked state
        localStorage.removeItem('session_token');
        setUser({ blocked: true, message: u.message });
        setAuthReady(true);
        return;
      }
      setUser({
        ...u,
        permissions: Array.isArray(u.permissions) ? u.permissions : ['create_case', 'view_own_cases', 'edit_own_case', 'view_basic_status', 'export_pdf'],
      });
      setAuthReady(true);
    }).catch(() => {
      localStorage.removeItem('session_token'); setAuthReady(true);
    });
  }, []);

  // Permission helper — use instead of user.role === 'admin' checks
  const can = (action) => Array.isArray(user?.permissions) && user.permissions.includes(action);

  useEffect(() => {
    if (!user) return;
    api('/api/products').then(setAllProducts).catch(() => {});
  }, [user]);

  // Cloud mode: Vercel deployment (not localhost/127.0.0.1 and not local network)
  const isCloud = (
    typeof window !== 'undefined' &&
    !['localhost', '127.0.0.1'].includes(window.location.hostname) &&
    !window.location.hostname.startsWith('192.168.') &&
    !window.location.hostname.startsWith('10.')
  );

  const loadFolders = useCallback(async () => {
    if (isCloud) return; // files/folders not available in cloud mode
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
    if (isCloud) return; // files/events SSE not available in cloud mode

    // Exponential backoff to prevent flood when server restarts
    let retryCount = 0;
    let esRef = null;

    function connectSSE() {
      esRef = new EventSource(`/api/files/events?token=${token}`);
      esRef.onopen = () => { retryCount = 0; }; // reset on success
      esRef.onerror = () => {
        esRef.close();
        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000); // max 30s
        retryCount++;
        setTimeout(connectSSE, delay);
      };
      return esRef;
    }
    const es = connectSSE();
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
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      background: 'var(--bg)',
      fontFamily: 'inherit',
    }}>
      {/* Left panel — branding (hidden on mobile) */}
      <div style={{
        flex: '0 0 45%',
        background: 'linear-gradient(160deg, #0C0E16 0%, #131621 50%, #1a1d2e 100%)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '48px 52px',
        position: 'relative',
        overflow: 'hidden',
      }} className="login-left-panel">
        {/* Background decoration */}
        <div style={{ position:'absolute', inset:0, overflow:'hidden', pointerEvents:'none' }}>
          <div style={{ position:'absolute', top:-80, right:-80, width:400, height:400, borderRadius:'50%', background:'radial-gradient(circle, rgba(255,215,0,.08) 0%, transparent 70%)' }} />
          <div style={{ position:'absolute', bottom:-60, left:-40, width:300, height:300, borderRadius:'50%', background:'radial-gradient(circle, rgba(96,165,250,.06) 0%, transparent 70%)' }} />
          <div style={{ position:'absolute', top:'40%', left:'30%', width:1, height:'200px', background:'linear-gradient(to bottom, transparent, rgba(255,215,0,.15), transparent)', transform:'rotate(20deg)' }} />
        </div>

        {/* Logo */}
        <div style={{ position:'relative', zIndex:1 }}>
          <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:48 }}>
            <div style={{ width:44, height:44, borderRadius:14, background:'linear-gradient(135deg, #FFD700, #FF8C00)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, boxShadow:'0 4px 20px rgba(255,215,0,.4)' }}>⚡</div>
            <div>
              <div style={{ fontSize:18, fontWeight:800, color:'var(--tx)', letterSpacing:'-.02em' }}>Belenergy</div>
              <div style={{ fontSize:11, color:'var(--tm)', letterSpacing:'.05em', textTransform:'uppercase' }}>Support Pro</div>
            </div>
          </div>

          <div style={{ marginBottom:32 }}>
            <h1 style={{ fontSize:36, fontWeight:800, color:'var(--tx)', letterSpacing:'-.03em', lineHeight:1.15, marginBottom:12 }}>
              Suporte técnico<br/><span style={{ color:'#FFD700' }}>mais inteligente.</span>
            </h1>
            <p style={{ fontSize:15, color:'var(--tm)', lineHeight:1.7, maxWidth:340 }}>
              Gerencie chamados, diagnósticos e soluções de energia solar com IA integrada.
            </p>
          </div>

          {/* Feature list */}
          {[
            { icon:'🔬', text:'Diagnósticos com IA e base de soluções vetorial' },
            { icon:'📅', text:'Agenda inteligente com tentativas de contato' },
            { icon:'📊', text:'Dashboard de performance e análise de falhas' },
            { icon:'🎙️', text:'Assistente de voz mãos-livres para campo' },
          ].map((f, i) => (
            <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:12, marginBottom:16 }}>
              <div style={{ width:36, height:36, borderRadius:10, background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.08)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>{f.icon}</div>
              <div style={{ fontSize:13, color:'var(--ts)', lineHeight:1.5, paddingTop:8 }}>{f.text}</div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ position:'relative', zIndex:1, fontSize:11, color:'var(--tm)' }}>
          © 2026 Belenergy · Sistema interno
        </div>
      </div>

      {/* Right panel — login form */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 24px',
        overflowY: 'auto',
      }}>
        {/* Mobile logo (shown only on mobile) */}
        <div style={{ marginBottom:32, textAlign:'center' }} className="login-mobile-logo">
          <div style={{ width:56, height:56, borderRadius:18, background:'linear-gradient(135deg,#FFD700,#FF8C00)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:26, margin:'0 auto 12px', boxShadow:'0 4px 24px rgba(255,215,0,.35)' }}>⚡</div>
          <div style={{ fontSize:20, fontWeight:800, color:'var(--tx)' }}>Belenergy Support Pro</div>
        </div>

        <div style={{ width:'100%', maxWidth:380 }}>
          {loginMethod === 'phone' ? (
            <PhoneLogin
              onSuccess={(u) => {
                setUser({ ...u, permissions: ['create_case','view_own_cases','edit_own_case','view_basic_status','export_pdf'] });
                setAuthReady(true);
                setLoginMethod('google');
              }}
              onBack={() => setLoginMethod('google')}
            />
          ) : (
            <>
              <div style={{ marginBottom:32, textAlign:'center' }}>
                <h2 style={{ fontSize:24, fontWeight:800, color:'var(--tx)', marginBottom:6 }}>Bem-vindo de volta</h2>
                <p style={{ fontSize:14, color:'var(--tm)' }}>Faça login para continuar</p>
              </div>

              {/* Google login */}
              <a href="/api/auth/login" style={{
                display:'flex', alignItems:'center', justifyContent:'center', gap:12,
                width:'100%', padding:'14px 20px',
                background:'var(--s2)', border:'1.5px solid var(--b2)',
                borderRadius:12, textDecoration:'none',
                color:'var(--tx)', fontWeight:700, fontSize:15,
                transition:'all .15s', boxSizing:'border-box',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor='rgba(255,215,0,.5)'; e.currentTarget.style.background='rgba(255,215,0,.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor='var(--b2)'; e.currentTarget.style.background='var(--s2)'; }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Entrar com Google
              </a>

              <div style={{ display:'flex', alignItems:'center', gap:12, margin:'20px 0', color:'var(--tm)', fontSize:12 }}>
                <div style={{ flex:1, height:1, background:'var(--b1)' }} />
                ou acesse com
                <div style={{ flex:1, height:1, background:'var(--b1)' }} />
              </div>

              {/* Phone login */}
              <button
                onClick={() => setLoginMethod('phone')}
                style={{
                  display:'flex', alignItems:'center', justifyContent:'center', gap:10,
                  width:'100%', padding:'14px 20px',
                  background:'var(--s2)', border:'1.5px solid var(--b2)',
                  borderRadius:12, cursor:'pointer', fontFamily:'inherit',
                  color:'var(--ts)', fontWeight:600, fontSize:14,
                  transition:'all .15s', boxSizing:'border-box',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor='rgba(34,197,94,.4)'; e.currentTarget.style.background='rgba(34,197,94,.05)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor='var(--b2)'; e.currentTarget.style.background='var(--s2)'; }}
              >
                <span style={{ fontSize:20 }}>💬</span>
                WhatsApp / Telefone + Senha
              </button>

              {/* Info */}
              <div style={{ marginTop:24, padding:'12px 16px', background:'rgba(96,165,250,.06)', border:'1px solid rgba(96,165,250,.15)', borderRadius:10, fontSize:12, color:'var(--tm)', lineHeight:1.6 }}>
                <span style={{ color:'var(--bl)', fontWeight:700 }}>Primeiro acesso?</span> Cadastre-se via WhatsApp ou solicite acesso ao administrador com seu email Google.
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .login-left-panel { display: none !important; }
          .login-mobile-logo { display: block !important; }
        }
        @media (min-width: 769px) {
          .login-mobile-logo { display: none !important; }
        }
      `}</style>
    </div>
  );

  // ── Views map ────────────────────────────────────────────────────────────────
  const VIEWS = {
    registro:     <Registro showToast={showToast} selectedFolder={selectedFolder} folderPath={folderPath} setFolderPath={setFolderPath} allProducts={allProducts} editCase={editCase} setEditCase={setEditCase} onRefresh={loadFolders} driveProgress={driveProgress} setDriveProgress={setDriveProgress} user={user} onNavigate={setView} />,
    dashboard:    <Dashboard showToast={showToast} user={user} onDataLoad={setDashData} onNavigate={setView} />,
    clientes:     <Clientes showToast={showToast} />,
    solutions:    <SolutionCentre showToast={showToast} user={user} />,
    agenda:       <Agenda showToast={showToast} user={user} />,
    diagnostico:  <Diagnostico showToast={showToast} />,
    produtos:     <ProdutosView showToast={showToast} allProducts={allProducts} onNavigate={setView} user={user} />,
    historico:    <Historico showToast={showToast} user={user} />,
    jira:         <Jira showToast={showToast} />,
    configuracoes:<Configuracoes showToast={showToast} user={user} />,
    ai_obs:       <AIObservability showToast={showToast} user={user} />,
    ai_search:    <AISearch showToast={showToast} user={user} />,
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
      <main style={{ flex:1, overflowY:'auto', overflowX:'hidden', background:'var(--bg)', minHeight:'100vh', position:'relative', minWidth:0, WebkitOverflowScrolling:'touch', paddingBottom:'env(safe-area-inset-bottom)' }}>
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

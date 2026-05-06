import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { Card, Btn, Field, Avatar } from '../components/UI';

// ── Helpers ───────────────────────────────────────────────────────────────────
const MONTHS_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DAYS_PT   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

function todayStr() { return new Date().toISOString().split('T')[0]; }
function formatDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = (new Date(dateStr) - new Date(todayStr())) / 86400000;
  return Math.round(diff);
}

const STATUS_CFG = {
  pending:    { label:'Pendente',   color:'#F59E0B', bg:'rgba(245,158,11,.1)' },
  contacted:  { label:'Contactado', color:'var(--bl)', bg:'rgba(96,165,250,.1)' },
  done:       { label:'Concluído',  color:'var(--gr)', bg:'rgba(34,197,94,.1)' },
};
const PRIORITY_CFG = {
  low:    { label:'Baixa',  color:'var(--tm)' },
  normal: { label:'Normal', color:'var(--bl)' },
  high:   { label:'Alta',   color:'var(--re)' },
};

const emptyForm = () => ({ client_name:'', phone:'', note:'', return_date:'', priority:'normal' });

// ── Mini Calendar ─────────────────────────────────────────────────────────────
function MiniCalendar({ year, month, reminders, selectedDate, onSelectDate, onMonthChange }) {
  const firstDay  = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = todayStr();

  // Build a set of dates that have reminders
  const reminderDates = {};
  reminders.forEach(r => {
    if (r.return_date) {
      if (!reminderDates[r.return_date]) reminderDates[r.return_date] = [];
      reminderDates[r.return_date].push(r);
    }
  });

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <Card style={{ padding:'16px' }}>
      {/* Month nav */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
        <button onClick={() => onMonthChange(-1)} style={{ background:'none', border:'none', color:'var(--tm)', cursor:'pointer', fontSize:16, padding:'2px 8px', borderRadius:6 }}>‹</button>
        <div style={{ fontSize:14, fontWeight:700 }}>{MONTHS_PT[month]} {year}</div>
        <button onClick={() => onMonthChange(1)}  style={{ background:'none', border:'none', color:'var(--tm)', cursor:'pointer', fontSize:16, padding:'2px 8px', borderRadius:6 }}>›</button>
      </div>

      {/* Day headers */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2, marginBottom:4 }}>
        {DAYS_PT.map(d => (
          <div key={d} style={{ textAlign:'center', fontSize:10, fontWeight:700, color:'var(--tm)', padding:'4px 0' }}>{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} />;
          const dateStr   = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
          const hasEvents = reminderDates[dateStr];
          const isToday   = dateStr === today;
          const isSel     = dateStr === selectedDate;
          const isPast    = dateStr < today && hasEvents;
          const dotColor  = isPast ? 'var(--re)' : dateStr === today ? 'var(--y)' : 'var(--bl)';

          return (
            <div key={day} onClick={() => onSelectDate(isSel ? null : dateStr)}
              style={{
                textAlign:'center', padding:'6px 2px', borderRadius:7, cursor: hasEvents ? 'pointer' : 'default',
                background: isSel ? 'var(--y)' : isToday ? 'rgba(255,215,0,.1)' : hasEvents ? 'rgba(96,165,250,.07)' : 'transparent',
                border: `1px solid ${isToday && !isSel ? 'rgba(255,215,0,.4)' : 'transparent'}`,
                transition:'all .12s', position:'relative',
              }}>
              <div style={{ fontSize:12, fontWeight: isToday || isSel ? 700 : 400, color: isSel ? '#000' : isToday ? 'var(--y)' : 'var(--tx)' }}>{day}</div>
              {hasEvents && !isSel && (
                <div style={{ display:'flex', justifyContent:'center', gap:2, marginTop:2 }}>
                  {hasEvents.slice(0,3).map((_, j) => (
                    <div key={j} style={{ width:4, height:4, borderRadius:'50%', background: dotColor }} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Reminder card ─────────────────────────────────────────────────────────────
function ReminderCard({ r, onEdit, onDelete, onStatusChange }) {
  const days    = daysUntil(r.return_date);
  const st      = STATUS_CFG[r.status] || STATUS_CFG.pending;
  const pr      = PRIORITY_CFG[r.priority] || PRIORITY_CFG.normal;
  const isOverdue = r.return_date && days < 0 && r.status === 'pending';
  const isToday   = days === 0 && r.status === 'pending';

  const urgencyBorder = isOverdue ? 'rgba(239,68,68,.4)'
    : isToday ? 'rgba(255,215,0,.4)' : 'var(--b1)';

  return (
    <div style={{
      background:'var(--s1)', border:`1px solid ${urgencyBorder}`,
      borderRadius:'var(--rs)', padding:'13px 16px', marginBottom:8,
      transition:'border-color .2s',
      animation:'springIn .35s cubic-bezier(0.34,1.56,0.64,1)',
    }}>
      <div style={{ display:'flex', alignItems:'flex-start', gap:10 }}>
        <Avatar name={r.client_name} size={34} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:7, flexWrap:'wrap', marginBottom:4 }}>
            <span style={{ fontSize:13, fontWeight:700 }}>{r.client_name}</span>
            <span style={{ fontSize:10.5, fontWeight:700, padding:'1px 7px', borderRadius:999, background:pr.color+'18', color:pr.color }}>{pr.label}</span>
            <span style={{ fontSize:10.5, fontWeight:700, padding:'1px 7px', borderRadius:999, background:st.bg, color:st.color }}>{st.label}</span>
            {isOverdue && <span style={{ fontSize:10.5, fontWeight:700, color:'var(--re)' }}>⚠️ Atrasado {Math.abs(days)}d</span>}
            {isToday   && <span style={{ fontSize:10.5, fontWeight:700, color:'var(--y)' }}>⭐ Hoje!</span>}
          </div>

          {r.phone && <div style={{ fontSize:12, color:'var(--tm)', marginBottom:2 }}>📞 {r.phone}</div>}

          {r.return_date && (
            <div style={{ fontSize:12, color: isOverdue ? 'var(--re)' : isToday ? 'var(--y)' : 'var(--ts)' }}>
              📅 {formatDate(r.return_date)}
              {days !== null && r.status === 'pending' && !isOverdue && !isToday && ` · em ${days}d`}
            </div>
          )}

          {r.note && (
            <div style={{ marginTop:6, padding:'6px 9px', background:'var(--s2)', borderRadius:'var(--rs)', fontSize:12, color:'var(--ts)', lineHeight:1.5 }}>
              {r.note}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display:'flex', gap:4, flexShrink:0 }}>
          <a href={`/api/reports/reminder/${r.id}?token=${localStorage.getItem('session_token')}`}
            target="_blank" rel="noreferrer" title="Relatório PDF"
            style={{ background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:6, color:'var(--tm)', fontSize:12, padding:'5px 8px', textDecoration:'none', display:'inline-flex', alignItems:'center' }}>
            📄
          </a>
          <button onClick={() => onEdit(r)} title="Editar"
            style={{ background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:6, color:'var(--tm)', cursor:'pointer', fontSize:12, padding:'5px 8px' }}
            onMouseEnter={e=>e.currentTarget.style.color='var(--y)'}
            onMouseLeave={e=>e.currentTarget.style.color='var(--tm)'}
          >✏️</button>
          <button onClick={() => onDelete(r.id)} title="Remover"
            style={{ background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:6, color:'var(--tm)', cursor:'pointer', fontSize:12, padding:'5px 8px' }}
            onMouseEnter={e=>e.currentTarget.style.color='var(--re)'}
            onMouseLeave={e=>e.currentTarget.style.color='var(--tm)'}
          >✕</button>
        </div>
      </div>

      {/* Status actions */}
      {r.status !== 'done' && (
        <div style={{ display:'flex', gap:6, marginTop:10, paddingTop:10, borderTop:'1px solid var(--b1)' }}>
          {r.status === 'pending' && (
            <button onClick={() => onStatusChange(r.id, 'contacted')}
              style={{ flex:1, background:'rgba(96,165,250,.08)', border:'1px solid rgba(96,165,250,.2)', color:'var(--bl)', borderRadius:'var(--rs)', padding:'6px', fontSize:11.5, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
              📞 Contactado
            </button>
          )}
          <button onClick={() => onStatusChange(r.id, 'done')}
            style={{ flex:1, background:'rgba(34,197,94,.08)', border:'1px solid rgba(34,197,94,.2)', color:'var(--gr)', borderRadius:'var(--rs)', padding:'6px', fontSize:11.5, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            ✅ Concluído
          </button>
        </div>
      )}
    </div>
  );
}

// ── Quick form ────────────────────────────────────────────────────────────────
function QuickForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || emptyForm());
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Card style={{ padding:'18px', marginBottom:14 }}>
      <div style={{ fontSize:13, fontWeight:700, marginBottom:14 }}>
        {initial?.id ? '✏️ Editar Lembrete' : '+ Novo Lembrete'}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        <Field label="Nome do Cliente *" style={{ gridColumn:'1/-1' }}>
          <input value={form.client_name} onChange={e=>set('client_name',e.target.value)}
            placeholder="Ex: Carvalho - ME" autoFocus />
        </Field>
        <Field label="Telefone / WhatsApp">
          <input value={form.phone} onChange={e=>set('phone',e.target.value)}
            placeholder="+55 (11) 99999-0000" />
        </Field>
        <Field label="Data de Retorno">
          <input type="date" value={form.return_date} onChange={e=>set('return_date',e.target.value)}
            min={todayStr()} />
        </Field>
        <Field label="Prioridade">
          <select value={form.priority} onChange={e=>set('priority',e.target.value)}>
            <option value="low">Baixa</option>
            <option value="normal">Normal</option>
            <option value="high">Alta</option>
          </select>
        </Field>
        <Field label="Anotação" style={{ gridColumn:'1/-1' }}>
          <textarea value={form.note} onChange={e=>set('note',e.target.value)}
            placeholder="Motivo do contato, equipamento, problema relatado..."
            rows={3} />
        </Field>
      </div>
      <div style={{ display:'flex', gap:8, marginTop:12 }}>
        <Btn variant="primary" onClick={() => { if (form.client_name.trim()) onSave(form); }}>
          {initial?.id ? 'Salvar' : 'Adicionar'}
        </Btn>
        <Btn variant="ghost" onClick={onCancel}>Cancelar</Btn>
      </div>
    </Card>
  );
}

// ── Main Agenda view ──────────────────────────────────────────────────────────
const CATEGORIES = ['Clientes','Fabricantes','Integradores','Fornecedores','Outros'];

const RESULT_MAP = {
  reached:      { label:'Atendeu',         color:'var(--gr)',  icon:'✅' },
  no_answer:    { label:'Não atendeu',     color:'var(--tm)',  icon:'📵' },
  busy:         { label:'Ocupado',          color:'#F59E0B',   icon:'🔴' },
  left_message: { label:'Deixou recado',   color:'var(--bl)',  icon:'📝' },
  email_sent:   { label:'Email enviado',   color:'var(--pu)',  icon:'📧' },
  whatsapp:     { label:'WhatsApp',        color:'var(--gr)',  icon:'💬' },
  other:        { label:'Outro',           color:'var(--tm)',  icon:'📞' },
};

// ── Tentativas de Contato Tab ─────────────────────────────────────────────────

// ── Contacts Mini Calendar ─────────────────────────────────────────────────────
function ContactsCalendar({ attempts, onDayClick }) {
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [dayView, setDayView] = useState(null);
  const [dayPopRef] = useState(() => ({ current: null }));

  // Build a map of date → attempts
  const attemptsByDay = {};
  (attempts||[]).forEach(a => {
    const d = new Date(a.attempted_at).toLocaleDateString('pt-BR');
    if (!attemptsByDay[d]) attemptsByDay[d] = [];
    attemptsByDay[d].push(a);
  });

  const firstDay = new Date(year, month, 1).getDay();
  const daysIn   = new Date(year, month + 1, 0).getDate();
  const cells    = Array(firstDay).fill(null).concat(Array.from({ length: daysIn }, (_, i) => i + 1));
  while (cells.length % 7 !== 0) cells.push(null);

  const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const DAYS   = ['D','S','T','Q','Q','S','S'];

  function cellDate(day) {
    return new Date(year, month, day).toLocaleDateString('pt-BR');
  }

  return (
    <div style={{ position:'relative' }}>
      {/* Calendar header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
        <button onClick={() => { if (month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1); }} style={{ background:'none', border:'none', color:'var(--tm)', cursor:'pointer', fontSize:14, fontFamily:'inherit' }}>‹</button>
        <div style={{ fontSize:11.5, fontWeight:700, color:'var(--tx)' }}>{MONTHS[month]} {year}</div>
        <button onClick={() => { if (month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1); }} style={{ background:'none', border:'none', color:'var(--tm)', cursor:'pointer', fontSize:14, fontFamily:'inherit' }}>›</button>
      </div>

      {/* Day headers */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2, marginBottom:4 }}>
        {DAYS.map((d,i) => <div key={i} style={{ textAlign:'center', fontSize:9, fontWeight:700, color:'var(--tm)', padding:'2px 0' }}>{d}</div>)}
      </div>

      {/* Day cells */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const dateStr  = cellDate(day);
          const dayAtts  = attemptsByDay[dateStr] || [];
          const isToday  = dateStr === now.toLocaleDateString('pt-BR');
          const hasAtts  = dayAtts.length > 0;
          const isActive = dayView === dateStr;
          return (
            <div key={i} onClick={() => hasAtts && setDayView(isActive ? null : dateStr)}
              style={{
                textAlign:'center', padding:'4px 2px', borderRadius:6, cursor: hasAtts ? 'pointer' : 'default',
                background: isActive ? 'rgba(255,215,0,.15)' : isToday ? 'rgba(255,215,0,.06)' : 'transparent',
                border: `1px solid ${isActive ? 'rgba(255,215,0,.4)' : isToday ? 'rgba(255,215,0,.2)' : 'transparent'}`,
                position:'relative',
              }}>
              <div style={{ fontSize:11, fontWeight: isToday ? 800 : 400, color: isToday ? 'var(--y)' : 'var(--ts)' }}>{day}</div>
              {hasAtts && (
                <div style={{ display:'flex', justifyContent:'center', gap:2, marginTop:1 }}>
                  {dayAtts.slice(0,3).map((a, ai) => (
                    <div key={ai} style={{ width:4, height:4, borderRadius:'50%',
                      background: RESULT_MAP[a.result]?.color || 'var(--tm)' }} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Day popup */}
      {dayView && attemptsByDay[dayView] && (
        <div ref={el => dayPopRef.current = el} style={{
          position:'absolute', top:'100%', left:0, right:0, zIndex:9999,
          background:'var(--s1)', border:'1px solid var(--b2)', borderRadius:'var(--rs)',
          boxShadow:'0 8px 32px rgba(0,0,0,.6)', padding:12, marginTop:4,
        }}>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:8 }}>
            {dayView}
          </div>
          {attemptsByDay[dayView].map((a, i) => {
            const res = RESULT_MAP[a.result]||RESULT_MAP.other;
            const t   = new Date(a.attempted_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
            return (
              <div key={i} style={{ padding:'7px 0', borderBottom:'1px solid var(--b1)' }}>
                {/* Entity + session header */}
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3 }}>
                  <span style={{ fontSize:12 }}>{res.icon}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:700, color:'var(--tx)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {a._entityName || '—'}
                    </div>
                    <div style={{ fontSize:10.5, color:'var(--tm)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {a._sessionTitle && <span>📂 {a._sessionTitle}</span>}
                      {a._chamadoId && <span style={{ marginLeft:6, color:'var(--bl)', fontWeight:600 }}>🔗 #{a._chamadoId}</span>}
                    </div>
                  </div>
                  <span style={{ fontSize:10, fontWeight:700, color:res.color, flexShrink:0 }}>{res.label}</span>
                </div>
                <div style={{ fontSize:10, color:'var(--tm)', fontFamily:'monospace', marginBottom: a.notes ? 3 : 0 }}>
                  ⏱ {t} · {a.author}
                </div>
                {a.notes && <div style={{ fontSize:11, color:'var(--ts)', background:'var(--s2)', padding:'3px 7px', borderRadius:4 }}>{a.notes.slice(0,80)}{a.notes.length>80?'...':''}</div>}
              </div>
            );
          })}
          <button onClick={() => setDayView(null)} style={{ marginTop:8, background:'none', border:'none', color:'var(--tm)', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}>Fechar</button>
        </div>
      )}
    </div>
  );
}

function ContactsTab({ showToast }) {
  const [entities, setEntities]       = useState([]);
  const [selected, setSelected]       = useState(null);
  const [sessions, setSessions]       = useState([]);
  const [selSession, setSelSession]   = useState(null);
  const [attempts, setAttempts]       = useState([]);
  const [cases, setCases]             = useState([]);
  const [catFilter, setCatFilter]     = useState('');
  const [search, setSearch]           = useState('');
  const [globalSearch, setGlobalSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching]     = useState(false);
  const [showNewEntity, setShowNewEntity]   = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);
  const [showNewAttempt, setShowNewAttempt] = useState(false);
  const [entityForm, setEntityForm] = useState({ category:'Clientes', name:'', phone:'', email:'', fabricante_contact_name:'', fabricante_contact_role:'', fabricante_contact_phone:'', notes:'' });
  const [sessionForm, setSessionForm] = useState({ title:'', chamado_id:'', notes:'' });
  const [attemptForm, setAttemptForm] = useState(() => {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const local = new Date(now.getTime() - tzOffset).toISOString().slice(0,16);
    return { result:'no_answer', notes:'', attempted_at: local };
  });

  const runGlobalSearch = async (term) => {
    if (term.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    const data = await api(`/api/contacts/search?q=${encodeURIComponent(term)}`).catch(() => []);
    setSearchResults(data);
    setSearching(false);
  };

  const loadEntities = async () => {
    const params = new URLSearchParams();
    if (catFilter) params.set('category', catFilter);
    if (search) params.set('q', search);
    const data = await api(`/api/contacts?${params}`).catch(() => []);
    setEntities(data);
  };
  const loadSessions = async (entityId) => {
    const data = await api(`/api/contacts/${entityId}/sessions`).catch(() => []);
    setSessions(data);
  };
  const loadAttempts = async (sessionId) => {
    const data = await api(`/api/contacts/sessions/${sessionId}/attempts`).catch(() => []);
    setAttempts(data);
  };
  const loadCases = async () => {
    const data = await api('/api/cases').catch(() => []);
    setCases(data);
  };

  useEffect(() => { loadEntities(); loadCases(); }, [catFilter, search]);

  function selectEntity(e) {
    setSelected(e); setSelSession(null); setAttempts([]);
    setShowNewSession(false); setShowNewAttempt(false);
    loadSessions(e.id);
  }
  function selectSession(s) {
    setSelSession(s); setShowNewAttempt(false);
    loadAttempts(s.id);
  }

  const setE = (k,v) => setEntityForm(f=>({...f,[k]:v}));
  const setS = (k,v) => setSessionForm(f=>({...f,[k]:v}));
  const setA = (k,v) => setAttemptForm(f=>({...f,[k]:v}));

  async function saveEntity() {
    if (!entityForm.name) return showToast('Nome obrigatório','warn');
    try {
      await api('/api/contacts', { method:'POST', body: JSON.stringify(entityForm) });
      showToast('✅ Contato adicionado!');
      setShowNewEntity(false);
      setEntityForm({ category:'Clientes', name:'', phone:'', email:'', fabricante_contact_name:'', fabricante_contact_role:'', fabricante_contact_phone:'', notes:'' });
      loadEntities();
    } catch(e) { showToast('❌ '+e.message,'warn'); }
  }

  async function saveSession() {
    if (!sessionForm.title) return showToast('Título obrigatório','warn');
    try {
      const res = await api(`/api/contacts/${selected.id}/sessions`, { method:'POST', body: JSON.stringify({ ...sessionForm, chamado_id: sessionForm.chamado_id||null }) });
      showToast('✅ Sessão criada!');
      setShowNewSession(false);
      setSessionForm({ title:'', chamado_id:'', notes:'' });
      loadSessions(selected.id);
      loadEntities();
      selectSession(res);
    } catch(e) { showToast('❌ '+e.message,'warn'); }
  }

  async function saveAttempt() {
    if (!selSession) return;
    try {
      await api(`/api/contacts/sessions/${selSession.id}/attempts`, { method:'POST', body: JSON.stringify({ ...attemptForm, attempted_at: new Date(attemptForm.attempted_at).toISOString() }) });
      showToast('✅ Tentativa registrada!');
      setShowNewAttempt(false);
      setAttemptForm({ result:'no_answer', notes:'', attempted_at: new Date().toISOString().slice(0,16) });
      loadAttempts(selSession.id);
      loadSessions(selected.id);
      loadEntities();
    } catch(e) { showToast('❌ '+e.message,'warn'); }
  }

  async function closeSession(id) {
    await api(`/api/contacts/sessions/${id}`, { method:'PUT', body: JSON.stringify({ status:'closed' }) });
    loadSessions(selected.id);
    if (selSession?.id === id) setSelSession(s => ({...s, status:'closed'}));
    showToast('Sessão encerrada');
  }

  async function deleteAttempt(id) {
    if (!confirm('Remover?')) return;
    await api(`/api/contacts/attempts/${id}`, { method:'DELETE' });
    loadAttempts(selSession.id);
  }

  const token = localStorage.getItem('session_token');

  // Total attempts across all sessions for an entity
  const entityAttemptCount = (e) => (e.sessions||[]).reduce((s,ss) => s+(ss.attempts||[]).length, 0);
  const entityLastResult = (e) => {
    const all = (e.sessions||[]).flatMap(ss => ss.attempts||[]).sort((a,b)=>new Date(b.attempted_at)-new Date(a.attempted_at));
    return all[0] ? RESULT_MAP[all[0].result] : null;
  };

  const filtered = entities.filter(e =>
    (!search || e.name.toLowerCase().includes(search.toLowerCase())) &&
    (!catFilter || e.category === catFilter)
  );

  return (
    <div style={{ display:'grid', gridTemplateColumns:'260px 260px 1fr', gap:12, alignItems:'start' }}>

      {/* Col 1 — Contacts */}
      <div>
        {/* Global search */}
        <div style={{ position:'relative', marginBottom:8 }}>
          <input
            value={globalSearch}
            onChange={e => { setGlobalSearch(e.target.value); runGlobalSearch(e.target.value); }}
            placeholder="🔍 Buscar por CTT-2026, KAN-24, #47, S/N..."
            style={{ fontSize:12, paddingRight:28 }}
          />
          {globalSearch && (
            <button onClick={() => { setGlobalSearch(''); setSearchResults([]); }} style={{
              position:'absolute', right:8, top:'50%', transform:'translateY(-50%)',
              background:'none', border:'none', color:'var(--tm)', cursor:'pointer', fontSize:13,
            }}>✕</button>
          )}
        </div>

        {/* Search results */}
        {globalSearch.length >= 2 && (
          <div style={{ background:'var(--s1)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', marginBottom:10, maxHeight:240, overflowY:'auto' }}>
            {searching && <div style={{ padding:'12px', textAlign:'center', color:'var(--tm)', fontSize:12 }}>Buscando...</div>}
            {!searching && searchResults.length === 0 && (
              <div style={{ padding:'12px', textAlign:'center', color:'var(--tm)', fontSize:12 }}>Nenhum resultado</div>
            )}
            {!searching && searchResults.map(s => {
              const lastA = (s.attempts||[]).sort((a,b)=>new Date(b.attempted_at)-new Date(a.attempted_at))[0];
              const lastR = lastA ? RESULT_MAP[lastA.result] : null;
              return (
                <div key={s.id} onClick={() => {
                  // Select the entity and session
                  if (s.entity) {
                    selectEntity(s.entity);
                    setTimeout(() => selectSession(s), 300);
                  }
                  setGlobalSearch(''); setSearchResults([]);
                }} style={{
                  padding:'9px 12px', borderBottom:'1px solid var(--b1)', cursor:'pointer',
                  transition:'background .1s',
                }}
                  onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,.03)'}
                  onMouseLeave={e => e.currentTarget.style.background='transparent'}
                >
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:2 }}>
                    {s.protocol && <span style={{ fontSize:10, fontFamily:'monospace', fontWeight:800, color:'var(--y)', background:'rgba(255,215,0,.08)', padding:'1px 6px', borderRadius:999 }}>{s.protocol}</span>}
                    {s.chamado?.jira_key && <span style={{ fontSize:10, fontWeight:700, color:'var(--bl)' }}>{s.chamado.jira_key}</span>}
                    {s.chamado?.id && <span style={{ fontSize:10, color:'var(--tm)' }}>#{s.chamado.id}</span>}
                    <span style={{ fontSize:11, fontWeight:600, color:'var(--tx)', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.title}</span>
                    {lastR && <span style={{ color:lastR.color, fontSize:12 }}>{lastR.icon}</span>}
                  </div>
                  <div style={{ fontSize:10.5, color:'var(--tm)' }}>
                    {s.entity?.name} · {s.entity?.category} · {(s.attempts||[]).length} tentativas
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Contact Attempts Calendar */}
        <div style={{ background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--rs)', padding:10, marginBottom:10 }}>
          <div style={{ fontSize:10, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:6 }}>📅 Tentativas</div>
          <ContactsCalendar attempts={entities.flatMap(e =>
            (e.sessions||[]).flatMap(s =>
              (s.attempts||[]).map(a => ({
                ...a,
                _entityName:   e.name,
                _entityCat:    e.category,
                _sessionTitle: s.title,
                _chamadoId:    s.chamado_id,
              }))
            )
          )} />
        </div>
        <div style={{ display:'flex', gap:6, marginBottom:8 }}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Buscar..." style={{ flex:1, fontSize:12 }} />
          <Btn variant="primary" style={{ fontSize:11, padding:'7px 10px' }} onClick={() => setShowNewEntity(v=>!v)}>+</Btn>
        </div>
        <div style={{ display:'flex', gap:3, flexWrap:'wrap', marginBottom:8 }}>
          {['', ...CATEGORIES].map(c => (
            <button key={c} onClick={() => setCatFilter(c)} style={{ fontSize:10, padding:'2px 8px', border:'1px solid var(--b2)', borderRadius:999, cursor:'pointer', fontFamily:'inherit', fontWeight:600, background: catFilter===c ? 'var(--y)' : 'var(--s2)', color: catFilter===c ? '#000' : 'var(--tm)' }}>
              {c || 'Todos'}
            </button>
          ))}
        </div>

        {showNewEntity && (
          <div style={{ background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', padding:10, marginBottom:8 }}>
            <Field label="Categoria" style={{ marginBottom:6 }}><select value={entityForm.category} onChange={e=>setE('category',e.target.value)}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></Field>
            <Field label="Nome *" style={{ marginBottom:6 }}><input value={entityForm.name} onChange={e=>setE('name',e.target.value)} /></Field>
            <Field label="Telefone" style={{ marginBottom:6 }}><input value={entityForm.phone} onChange={e=>setE('phone',e.target.value)} /></Field>
            <Field label="Email" style={{ marginBottom:6 }}><input value={entityForm.email} onChange={e=>setE('email',e.target.value)} /></Field>
            {entityForm.category === 'Fabricantes' && <>
              <div style={{ fontSize:10, fontWeight:700, color:'var(--bl)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:5, marginTop:4, borderTop:'1px solid var(--b1)', paddingTop:6 }}>Contato no Fabricante</div>
              <Field label="Responsável" style={{ marginBottom:6 }}><input value={entityForm.fabricante_contact_name} onChange={e=>setE('fabricante_contact_name',e.target.value)} /></Field>
              <Field label="Cargo" style={{ marginBottom:6 }}><input value={entityForm.fabricante_contact_role} onChange={e=>setE('fabricante_contact_role',e.target.value)} /></Field>
              <Field label="Tel. direto" style={{ marginBottom:6 }}><input value={entityForm.fabricante_contact_phone} onChange={e=>setE('fabricante_contact_phone',e.target.value)} /></Field>
            </>}
            <Field label="Notas" style={{ marginBottom:8 }}><textarea value={entityForm.notes} onChange={e=>setE('notes',e.target.value)} rows={2} /></Field>
            <div style={{ display:'flex', gap:5 }}>
              <Btn variant="primary" style={{ fontSize:11 }} onClick={saveEntity}>Salvar</Btn>
              <Btn variant="ghost" style={{ fontSize:11 }} onClick={() => setShowNewEntity(false)}>Cancelar</Btn>
            </div>
          </div>
        )}

        <div style={{ display:'flex', flexDirection:'column', gap:4, maxHeight:'65vh', overflowY:'auto' }}>
          {filtered.length === 0 && <div style={{ textAlign:'center', color:'var(--tm)', fontSize:12, padding:'24px 0' }}>Nenhum contato</div>}
          {filtered.map(e => {
            const count = entityAttemptCount(e);
            const lastRes = entityLastResult(e);
            return (
              <div key={e.id} onClick={() => selectEntity(e)} style={{
                padding:'9px 11px', borderRadius:'var(--rs)', cursor:'pointer',
                background: selected?.id===e.id ? 'rgba(255,215,0,.07)' : 'var(--s1)',
                border: `1px solid ${selected?.id===e.id ? 'rgba(255,215,0,.3)' : 'var(--b1)'}`,
              }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:2 }}>
                  <div style={{ fontSize:12.5, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{e.name}</div>
                  <span style={{ fontSize:9, background:'var(--s2)', color:'var(--tm)', padding:'1px 6px', borderRadius:999, fontWeight:600, marginLeft:4, flexShrink:0 }}>{e.category}</span>
                </div>
                <div style={{ fontSize:10.5, color:'var(--tm)', display:'flex', gap:8 }}>
                  <span>{(e.sessions||[]).length} sess.</span>
                  <span>{count} tent.</span>
                  {lastRes && <span style={{ color:lastRes.color, fontWeight:600 }}>{lastRes.icon}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Col 2 — Sessions */}
      <div>
        {!selected ? (
          <div style={{ textAlign:'center', color:'var(--tm)', fontSize:12, padding:'60px 0' }}>← Selecione um contato</div>
        ) : (
          <>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--tx)' }}>{selected.name}</div>
              <Btn variant="primary" style={{ fontSize:10, padding:'5px 9px' }} onClick={() => setShowNewSession(v=>!v)}>+ Sessão</Btn>
            </div>

            {showNewSession && (
              <div style={{ background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', padding:10, marginBottom:8 }}>
                <Field label="Título *" style={{ marginBottom:6 }}><input value={sessionForm.title} onChange={e=>setS('title',e.target.value)} placeholder="Ex: Garantia Inversor, Chamado #123" /></Field>
                <Field label="Vincular chamado" style={{ marginBottom:6 }}>
                  <select value={sessionForm.chamado_id} onChange={e=>setS('chamado_id',e.target.value)}>
                    <option value="">Nenhum</option>
                    {cases.map(c=><option key={c.id} value={c.id}>#{c.id} — {c.integrador||c.cliente_final||c.nome} | {c.sn||'-'}</option>)}
                  </select>
                </Field>
                <Field label="Notas" style={{ marginBottom:8 }}><textarea value={sessionForm.notes} onChange={e=>setS('notes',e.target.value)} rows={2} /></Field>
                <div style={{ display:'flex', gap:5 }}>
                  <Btn variant="primary" style={{ fontSize:11 }} onClick={saveSession}>Criar</Btn>
                  <Btn variant="ghost" style={{ fontSize:11 }} onClick={() => setShowNewSession(false)}>Cancelar</Btn>
                </div>
              </div>
            )}

            <div style={{ display:'flex', flexDirection:'column', gap:4, maxHeight:'65vh', overflowY:'auto' }}>
              {sessions.length === 0 && <div style={{ textAlign:'center', color:'var(--tm)', fontSize:12, padding:'24px 0' }}>Nenhuma sessão ainda</div>}
              {sessions.map(s => {
                const attCount = (s.attempts||[]).length;
                const lastA    = (s.attempts||[]).sort((a,b)=>new Date(b.attempted_at)-new Date(a.attempted_at))[0];
                const lastR    = lastA ? RESULT_MAP[lastA.result] : null;
                return (
                  <div key={s.id} onClick={() => selectSession(s)} style={{
                    padding:'9px 11px', borderRadius:'var(--rs)', cursor:'pointer',
                    background: selSession?.id===s.id ? 'rgba(96,165,250,.08)' : 'var(--s1)',
                    border: `1px solid ${selSession?.id===s.id ? 'rgba(96,165,250,.3)' : 'var(--b1)'}`,
                  }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:2 }}>
                      <div style={{ fontSize:12, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{s.title}</div>
                      <span style={{ fontSize:9, padding:'1px 6px', borderRadius:999, fontWeight:700, marginLeft:4, flexShrink:0, background: s.status==='open'?'rgba(34,197,94,.1)':'var(--s2)', color: s.status==='open'?'var(--gr)':'var(--tm)' }}>{s.status==='open'?'Aberta':'Fechada'}</span>
                    </div>
                    <div style={{ fontSize:10.5, color:'var(--tm)', display:'flex', gap:8, flexWrap:'wrap' }}>
                      {s.protocol && <span style={{ fontFamily:'monospace', fontWeight:700, color:'var(--y)', fontSize:10 }}>{s.protocol}</span>}
                      <span>{attCount} tent.</span>
                      {s.chamado && <span>🔗 #{s.chamado.id}</span>}
                      {s.chamado?.jira_key && <span style={{ color:'var(--bl)' }}>{s.chamado.jira_key}</span>}
                      {lastR && <span style={{ color:lastR.color }}>{lastR.icon}</span>}
                    </div>
                    {/* Per-session PDF link */}
                    <div style={{ marginTop:5 }}>
                      <a href={`/api/reports/contact-session/${s.id}?token=${token}`} target="_blank" rel="noreferrer"
                        onClick={e=>e.stopPropagation()}
                        style={{ fontSize:10, color:'var(--bl)', fontWeight:600, textDecoration:'none' }}>
                        📄 PDF
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Col 3 — Attempts */}
      <div>
        {!selSession ? (
          <div style={{ textAlign:'center', color:'var(--tm)', fontSize:12, padding:'60px 0' }}>← Selecione uma sessão</div>
        ) : (
          <>
            {/* Session header */}
            <div style={{ background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--r)', padding:'14px 16px', marginBottom:10 }}>
              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:6 }}>
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
                    <div style={{ fontSize:14, fontWeight:800 }}>{selSession.title}</div>
                    {selSession.protocol && (
                      <span style={{ fontSize:11, fontFamily:'monospace', fontWeight:800, color:'var(--y)', background:'rgba(255,215,0,.08)', border:'1px solid rgba(255,215,0,.2)', padding:'1px 8px', borderRadius:999 }}>
                        {selSession.protocol}
                      </span>
                    )}
                  </div>
                  {selSession.chamado && (
                    <div style={{ fontSize:11, color:'var(--bl)', marginTop:3, fontWeight:600 }}>
                      🔗 #{selSession.chamado.id} — {selSession.chamado.sn} | {selSession.chamado.fabricante} | {selSession.chamado.status}
                    </div>
                  )}
                  {selSession.notes && <div style={{ fontSize:11.5, color:'var(--ts)', marginTop:4 }}>{selSession.notes}</div>}
                </div>
                <div style={{ display:'flex', gap:5, flexShrink:0 }}>
                  <a href={`/api/reports/contact-session/${selSession.id}?token=${token}`} target="_blank" rel="noreferrer"
                    style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, fontWeight:600, padding:'5px 10px', borderRadius:'var(--rs)', background:'var(--s2)', border:'1px solid var(--b2)', color:'var(--tm)', textDecoration:'none' }}>
                    📄 PDF
                  </a>
                  {selSession.status === 'open' && (
                    <Btn variant="ghost" style={{ fontSize:11, padding:'5px 10px' }} onClick={() => closeSession(selSession.id)}>✓ Encerrar</Btn>
                  )}
                </div>
              </div>

              {/* Quick stats */}
              <div style={{ display:'flex', gap:10, paddingTop:8, borderTop:'1px solid var(--b1)', flexWrap:'wrap' }}>
                {Object.entries(RESULT_MAP).map(([key, meta]) => {
                  const count = attempts.filter(a=>a.result===key).length;
                  if (!count) return null;
                  return <span key={key} style={{ fontSize:11, color:meta.color, fontWeight:600 }}>{meta.icon} {meta.label}: {count}</span>;
                })}
                {attempts.length === 0 && <span style={{ fontSize:11, color:'var(--tm)' }}>Nenhuma tentativa ainda</span>}
              </div>
            </div>

            {/* New attempt button */}
            {selSession.status === 'open' && (
              <Btn variant="primary" style={{ fontSize:11, padding:'7px 14px', marginBottom:10, width:'100%' }} onClick={() => setShowNewAttempt(v=>!v)}>
                + Registrar tentativa
              </Btn>
            )}

            {/* New attempt form */}
            {showNewAttempt && (
              <div style={{ background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', padding:12, marginBottom:10 }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8 }}>
                  <Field label="Data e hora" style={{ marginBottom:0 }}>
                    <input type="datetime-local" value={attemptForm.attempted_at} onChange={e=>setA('attempted_at',e.target.value)} />
                  </Field>
                  <Field label="Resultado" style={{ marginBottom:0 }}>
                    <select value={attemptForm.result} onChange={e=>setA('result',e.target.value)}>
                      {Object.entries(RESULT_MAP).map(([key,meta]) => <option key={key} value={key}>{meta.icon} {meta.label}</option>)}
                    </select>
                  </Field>
                </div>
                <Field label="Observações" style={{ marginBottom:8 }}>
                  <textarea value={attemptForm.notes} onChange={e=>setA('notes',e.target.value)} rows={2} placeholder="O que foi discutido..." />
                </Field>
                <div style={{ display:'flex', gap:6 }}>
                  <Btn variant="primary" style={{ fontSize:11 }} onClick={saveAttempt}>Salvar</Btn>
                  <Btn variant="ghost" style={{ fontSize:11 }} onClick={() => setShowNewAttempt(false)}>Cancelar</Btn>
                </div>
              </div>
            )}

            {/* Attempts timeline */}
            {attempts.length === 0 && !showNewAttempt && (
              <div style={{ textAlign:'center', color:'var(--tm)', fontSize:12, padding:'24px 0' }}>Nenhuma tentativa. Clique em "+ Registrar tentativa".</div>
            )}
            {attempts.map((a,i) => {
              const res = RESULT_MAP[a.result]||RESULT_MAP.other;
              const dt  = new Date(a.attempted_at);
              return (
                <div key={a.id} style={{ display:'flex', gap:10, padding:'11px 0', borderBottom:'1px solid var(--b1)', alignItems:'flex-start' }}>
                  <div style={{ width:32, height:32, borderRadius:'50%', flexShrink:0, background:`${res.color}18`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, border:`1px solid ${res.color}30` }}>{res.icon}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:12, fontWeight:700, color:res.color, marginBottom:1 }}>{res.label}</div>
                    <div style={{ fontSize:10.5, color:'var(--tm)', marginBottom:2 }}>por {a.author}</div>
                    <div style={{ fontSize:10.5, color:'var(--tm)', fontFamily:'monospace' }}>
                      📅 {dt.toLocaleDateString('pt-BR', {weekday:'short', day:'2-digit', month:'2-digit', year:'numeric'})} ⏱ {dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
                    </div>
                    {a.notes && <div style={{ fontSize:12, color:'var(--ts)', background:'var(--s2)', padding:'5px 8px', borderRadius:'var(--rs)', marginTop:5, lineHeight:1.5 }}>{a.notes}</div>}
                    {/* Attachments */}
                    {(a.metadata?.attachments||[]).map((att, ai) => (
                      <a key={ai} href={att.url} target="_blank" rel="noreferrer" style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:10.5, color:'var(--bl)', marginTop:4, textDecoration:'none', fontWeight:600 }}>
                        📎 {att.name}
                      </a>
                    ))}
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:3, alignItems:'center' }}>
                    {/* Clip attachment */}
                    <label title="Anexar comprovante" style={{ cursor:'pointer', fontSize:13, color:'var(--tm)', padding:'2px 4px', borderRadius:4 }}
                      onMouseEnter={e=>e.currentTarget.style.color='var(--bl)'}
                      onMouseLeave={e=>e.currentTarget.style.color='var(--tm)'}>
                      📎
                      <input type="file" accept="image/*,.pdf" style={{ display:'none' }} onChange={async (ev) => {
                        const file = ev.target.files?.[0];
                        if (!file) return;
                        const fd = new FormData();
                        fd.append('file', file);
                        try {
                          const token = localStorage.getItem('session_token');
                          const r = await fetch(`/api/contacts/attempts/${a.id}/attach`, {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${token}` },
                            body: fd,
                          });
                          const data = await r.json();
                          if (data.url) { showToast('📎 Comprovante anexado!'); loadAttempts(selSession.id); }
                          else showToast('❌ ' + (data.error||'Erro'), 'warn');
                        } catch(e) { showToast('❌ ' + e.message, 'warn'); }
                        ev.target.value = '';
                      }} />
                    </label>
                    <button onClick={() => deleteAttempt(a.id)} style={{ background:'none', border:'none', color:'var(--tm)', cursor:'pointer', fontSize:12, padding:'2px 4px', borderRadius:4 }}
                      onMouseEnter={e=>e.currentTarget.style.color='var(--re)'}
                      onMouseLeave={e=>e.currentTarget.style.color='var(--tm)'}>✕</button>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}


export default function Agenda({ showToast }) {
  const now = new Date();
  const [activeTab, setActiveTab] = useState('reminders');
  const [year, setYear]       = useState(now.getFullYear());
  const [month, setMonth]     = useState(now.getMonth());
  const [reminders, setReminders] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [showForm, setShowForm]   = useState(false);
  const [editing, setEditing]     = useState(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch]   = useState('');

  const load = useCallback(async () => {
    const data = await api('/api/reminders').catch(() => []);
    setReminders(data);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save(form) {
    try {
      if (editing?.id) {
        await api(`/api/reminders/${editing.id}`, { method:'PUT', body: JSON.stringify(form) });
        showToast('✅ Lembrete atualizado!');
      } else {
        await api('/api/reminders', { method:'POST', body: JSON.stringify(form) });
        showToast('✅ Lembrete adicionado!');
      }
      setShowForm(false); setEditing(null); load();
    } catch(e) { showToast('❌ ' + e.message, 'warn'); }
  }

  async function del(id) {
    await api(`/api/reminders/${id}`, { method:'DELETE' }).catch(() => {});
    showToast('Lembrete removido');
    load();
  }

  async function changeStatus(id, status) {
    await api(`/api/reminders/${id}`, { method:'PUT', body: JSON.stringify({ status }) }).catch(() => {});
    load();
  }

  function handleMonthChange(dir) {
    let m = month + dir, y = year;
    if (m < 0)  { m = 11; y--; }
    if (m > 11) { m = 0;  y++; }
    setMonth(m); setYear(y); setSelectedDate(null);
  }

  // Filtered list
  const today = todayStr();
  const filtered = reminders.filter(r => {
    if (selectedDate && r.return_date !== selectedDate) return false;
    if (filterStatus && r.status !== filterStatus) return false;
    if (search && !r.client_name.toLowerCase().includes(search.toLowerCase()) &&
        !(r.phone||'').includes(search) && !(r.note||'').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Sort: overdue first, then by date, then no-date at end
  const sorted = [...filtered].sort((a, b) => {
    const da = daysUntil(a.return_date), db = daysUntil(b.return_date);
    if (a.status === 'done' && b.status !== 'done') return 1;
    if (b.status === 'done' && a.status !== 'done') return -1;
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });

  // Stats
  const overdue   = reminders.filter(r => r.return_date && daysUntil(r.return_date) < 0 && r.status === 'pending').length;
  const todayCount = reminders.filter(r => r.return_date === today && r.status === 'pending').length;
  const pending   = reminders.filter(r => r.status === 'pending').length;
  const done      = reminders.filter(r => r.status === 'done').length;

  return (
    <div style={{ padding:'28px 32px' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:16 }}>
        <div>
          <h1 style={{ fontSize:26, fontWeight:800, letterSpacing:'-.025em', marginBottom:4 }}>📅 Agenda</h1>
          <p style={{ fontSize:13, color:'var(--tm)' }}>Lembretes de retorno e controle de tentativas de contato.</p>
        </div>
        {activeTab === 'reminders' && (
          <Btn variant="primary" onClick={() => { setShowForm(true); setEditing(null); }}>
            + Novo Lembrete
          </Btn>
        )}
      </div>

      {/* Tab switcher */}
      <div style={{ display:'inline-flex', gap:2, background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--rs)', padding:3, marginBottom:20 }}>
        {[{ id:'reminders', label:'📅 Lembretes' }, { id:'contacts', label:'📞 Tentativas de Contato' }].map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            padding:'8px 18px', border:'none', borderRadius:7, fontSize:12.5, fontWeight:600,
            cursor:'pointer', fontFamily:'inherit', transition:'all .15s',
            background: activeTab===t.id ? 'var(--s3)' : 'transparent',
            color:      activeTab===t.id ? 'var(--tx)' : 'var(--tm)',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Contacts tab */}
      {activeTab === 'contacts' && <ContactsTab showToast={showToast} />}

      {/* Reminders tab */}
      {activeTab === 'reminders' && <>

      {/* Stat strip */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:18 }}>
        {[
          { label:'Pendentes',    value:pending,    color:'#F59E0B', icon:'⏳' },
          { label:'Hoje',         value:todayCount, color:'var(--y)', icon:'⭐' },
          { label:'Atrasados',    value:overdue,    color:'var(--re)', icon:'🔴' },
          { label:'Concluídos',   value:done,       color:'var(--gr)', icon:'✅' },
        ].map(s => (
          <Card key={s.label} style={{ padding:'14px 16px', display:'flex', alignItems:'center', gap:12 }}>
            <span style={{ fontSize:22 }}>{s.icon}</span>
            <div>
              <div style={{ fontSize:24, fontWeight:800, color:s.color, lineHeight:1 }}>{s.value}</div>
              <div style={{ fontSize:11.5, color:'var(--tm)', marginTop:2 }}>{s.label}</div>
            </div>
          </Card>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'280px 1fr', gap:16, alignItems:'start' }}>

        {/* Left: Calendar */}
        <div>
          <MiniCalendar
            year={year} month={month}
            reminders={reminders}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onMonthChange={handleMonthChange}
          />
          {selectedDate && (
            <div style={{ marginTop:8, textAlign:'center' }}>
              <button onClick={() => setSelectedDate(null)}
                style={{ background:'none', border:'none', color:'var(--tm)', cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>
                ✕ Limpar seleção ({formatDate(selectedDate)})
              </button>
            </div>
          )}

          {/* Filter legend */}
          <div style={{ marginTop:14 }}>
            <div style={{ fontSize:10, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:8 }}>Legenda</div>
            {[
              { color:'var(--re)', label:'Atrasado' },
              { color:'var(--y)',  label:'Hoje' },
              { color:'var(--bl)', label:'Próximos' },
            ].map(l => (
              <div key={l.label} style={{ display:'flex', alignItems:'center', gap:7, marginBottom:5 }}>
                <div style={{ width:8, height:8, borderRadius:'50%', background:l.color }} />
                <span style={{ fontSize:12, color:'var(--tm)' }}>{l.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Form + list */}
        <div>
          {(showForm || editing) && (
            <QuickForm
              initial={editing}
              onSave={save}
              onCancel={() => { setShowForm(false); setEditing(null); }}
            />
          )}

          {/* Filters */}
          <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="🔍 Buscar cliente, nota..."
              style={{ flex:1, minWidth:180 }} />
            <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{ minWidth:140 }}>
              <option value="">Todos os status</option>
              <option value="pending">Pendentes</option>
              <option value="contacted">Contactados</option>
              <option value="done">Concluídos</option>
            </select>
          </div>

          {/* List */}
          {sorted.length === 0 && (
            <div style={{ textAlign:'center', color:'var(--tm)', padding:'60px 0', fontSize:13 }}>
              {search || filterStatus || selectedDate
                ? 'Nenhum lembrete encontrado para este filtro'
                : 'Nenhum lembrete ainda — clique em "+ Novo Lembrete" para começar'}
            </div>
          )}

          {sorted.map(r => (
            <ReminderCard
              key={r.id} r={r}
              onEdit={r => { setEditing(r); setShowForm(false); }}
              onDelete={del}
              onStatusChange={changeStatus}
            />
          ))}
        </div>
      </div>
    </>
    }
    </div>
  );
}

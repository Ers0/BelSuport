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
function ReminderCard({ r, onEdit, onDelete, onStatusChange, showAuthor, onCommentAdded, showToast, currentUser }) {
  const days    = daysUntil(r.return_date);
  const st      = STATUS_CFG[r.status] || STATUS_CFG.pending;
  const pr      = PRIORITY_CFG[r.priority] || PRIORITY_CFG.normal;
  const isOverdue = r.return_date && days < 0 && r.status === 'pending';
  const isToday   = days === 0 && r.status === 'pending';
  const [showComments, setShowComments] = useState(false);
  const [newComment, setNewComment]     = useState('');
  // Local comments — optimistic, never reset by parent re-renders
  const [localComments, setLocalComments] = useState(() => Array.isArray(r.comments) ? r.comments : []);
  const comments = localComments;
  const didOptimisticUpdate = React.useRef(false);
  const mountedId = React.useRef(r.id);
  useEffect(() => {
    // Only sync from parent when the card ID changes (switched reminder)
    if (mountedId.current !== r.id) {
      mountedId.current = r.id;
      didOptimisticUpdate.current = false;
      setLocalComments(Array.isArray(r.comments) ? r.comments : []);
    } else if (!didOptimisticUpdate.current && Array.isArray(r.comments)) {
      // First load for this card — sync initial data
      setLocalComments(r.comments);
    }
  }, [r.id]);

  async function addComment() {
    if (!newComment.trim()) return;
    const newEntry = {
      text:   newComment.trim(),
      author: currentUser?.name?.split(' ')[0] || currentUser?.email?.split('@')[0] || 'Técnico',
      at:     new Date().toISOString(),
    };
    const updated = [...localComments, newEntry];
    // Update local state immediately — no refresh needed
    didOptimisticUpdate.current = true;
    setLocalComments(updated);
    setNewComment('');
    try {
      await api(`/api/reminders/${r.id}`, { method:'PUT', body: JSON.stringify({ comments: updated }) });
      onCommentAdded?.(); // sync parent in background (won't reset local state)
    } catch(e) {
      // Rollback on error
      setLocalComments(prev => prev.filter(c => c !== newEntry));
      showToast?.('Erro ao salvar comentário', 'warn');
    }
  }

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

          {/* Author tag for admin/master — shown always when canViewAll */}
          {showAuthor && (
            <div style={{ marginTop:5 }}>
              <span style={{ fontSize:10, fontWeight:700,
                background: r._userName ? 'rgba(167,139,250,.12)' : 'rgba(107,118,148,.1)',
                color: r._userName ? 'var(--pu)' : 'var(--tm)',
                border: `1px solid ${r._userName ? 'rgba(167,139,250,.25)' : 'rgba(107,118,148,.2)'}`,
                padding:'2px 9px', borderRadius:999, display:'inline-flex', alignItems:'center', gap:4 }}>
                👤 {r._userName || 'Técnico'}
              </span>
            </div>
          )}

          {/* Comments */}
          {comments.length > 0 && (
            <div style={{ marginTop:6 }}>
              {comments.map((c, i) => (
                <div key={i} style={{ display:'flex', gap:6, padding:'4px 0', borderTop:'1px solid var(--b1)', marginTop:i===0?4:0 }}>
                  <div style={{ flex:1 }}>
                    <span style={{ fontSize:11, fontWeight:600, color:'var(--ts)' }}>{c.author} </span>
                    <span style={{ fontSize:10.5, color:'var(--tm)' }}>{new Date(c.at).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</span>
                    <div style={{ fontSize:12, color:'var(--ts)', marginTop:2 }}>{c.text}</div>
                  </div>
                </div>
              ))}
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
          <button onClick={() => setShowComments(v=>!v)} title="Comentários"
            style={{ background: showComments ? 'rgba(255,215,0,.1)' : 'var(--s2)', border:`1px solid ${showComments?'rgba(255,215,0,.3)':'var(--b2)'}`, borderRadius:6, color: showComments ? 'var(--y)' : 'var(--tm)', cursor:'pointer', fontSize:12, padding:'5px 8px', position:'relative' }}>
            💬{comments.length > 0 && <span style={{ position:'absolute', top:-4, right:-4, background:'var(--y)', color:'#000', fontSize:8, fontWeight:800, width:14, height:14, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center' }}>{comments.length}</span>}
          </button>
        </div>
      </div>

      {/* Comment input */}
      {showComments && (
        <div style={{ marginTop:8, paddingTop:8, borderTop:'1px solid var(--b1)' }}>
          <div style={{ fontSize:10, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:6 }}>💬 Comentários</div>
          <div style={{ display:'flex', gap:6 }}>
            <input
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addComment()}
              placeholder="Adicionar comentário..."
              style={{ flex:1, fontSize:12 }}
            />
            <button onClick={addComment} style={{ background:'var(--y)', border:'none', color:'#000', fontWeight:700, fontSize:11, padding:'6px 12px', borderRadius:'var(--rs)', cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}>
              Enviar
            </button>
          </div>
        </div>
      )}

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
  reached:      { label:'Atendeu',        color:'var(--gr)',  icon:'✅' },
  no_answer:    { label:'Não atendeu',    color:'var(--tm)',  icon:'📵' },
  busy:         { label:'Ocupado',        color:'#F59E0B',   icon:'🔴' },
  left_message: { label:'Deixou recado', color:'var(--bl)',  icon:'📝' },
  email_sent:   { label:'Email enviado', color:'var(--pu)',  icon:'📧' },
  whatsapp:     { label:'WhatsApp',      color:'var(--gr)',  icon:'💬' },
  other:        { label:'Outro',         color:'var(--tm)',  icon:'📞' },
};

function ContactsTab({ showToast }) {
  const [entities, setEntities]   = useState([]);
  const [selected, setSelected]   = useState(null);
  const [attempts, setAttempts]   = useState([]);
  const [cases, setCases]         = useState([]);
  const [catFilter, setCatFilter] = useState('');
  const [search, setSearch]       = useState('');
  const [showNewEntity, setShowNewEntity]   = useState(false);
  const [showNewAttempt, setShowNewAttempt] = useState(false);
  const [entityForm, setEntityForm] = useState({
    category:'Clientes', name:'', phone:'', email:'',
    fabricante_contact_name:'', fabricante_contact_role:'',
    fabricante_contact_phone:'', notes:'',
  });
  const [attemptForm, setAttemptForm] = useState({
    result:'no_answer', notes:'', chamado_id:'',
    attempted_at: new Date().toISOString().slice(0,16),
  });
  const [loading, setLoading] = useState(false);

  const loadEntities = async () => {
    const params = new URLSearchParams();
    if (catFilter) params.set('category', catFilter);
    if (search)    params.set('q', search);
    const data = await api(`/api/contacts?${params}`).catch(() => []);
    setEntities(data);
  };

  const loadAttempts = async (id) => {
    setLoading(true);
    const data = await api(`/api/contacts/${id}/attempts`).catch(() => []);
    setAttempts(data);
    setLoading(false);
  };

  useEffect(() => { loadEntities(); }, [catFilter, search]);
  useEffect(() => { api('/api/cases').then(d => setCases(d||[])).catch(() => {}); }, []);

  function selectEntity(e) { setSelected(e); loadAttempts(e.id); setShowNewAttempt(false); }

  async function saveEntity() {
    if (!entityForm.name) return showToast('Nome obrigatório', 'warn');
    try {
      await api('/api/contacts', { method:'POST', body: JSON.stringify(entityForm) });
      showToast('✅ Contato adicionado!');
      setShowNewEntity(false);
      setEntityForm({ category:'Clientes', name:'', phone:'', email:'',
        fabricante_contact_name:'', fabricante_contact_role:'',
        fabricante_contact_phone:'', notes:'' });
      loadEntities();
    } catch(e) { showToast('❌ ' + e.message, 'warn'); }
  }

  async function saveAttempt() {
    if (!selected) return;
    try {
      const payload = {
        ...attemptForm,
        chamado_id:   attemptForm.chamado_id || null,
        attempted_at: new Date(attemptForm.attempted_at).toISOString(),
      };
      await api(`/api/contacts/${selected.id}/attempts`, { method:'POST', body: JSON.stringify(payload) });
      showToast('✅ Tentativa registrada!');
      setShowNewAttempt(false);
      setAttemptForm({ result:'no_answer', notes:'', chamado_id:'', attempted_at: new Date().toISOString().slice(0,16) });
      loadAttempts(selected.id);
      loadEntities();
    } catch(e) { showToast('❌ ' + e.message, 'warn'); }
  }

  async function deleteAttempt(id) {
    if (!confirm('Remover tentativa?')) return;
    await api(`/api/contacts/attempts/${id}`, { method:'DELETE' }).catch(() => {});
    loadAttempts(selected.id);
  }

  const setE = (k, v) => setEntityForm(f => ({...f, [k]:v}));
  const setA = (k, v) => setAttemptForm(f => ({...f, [k]:v}));
  const filtered = entities.filter(e =>
    (!search    || (e.name||'').toLowerCase().includes(search.toLowerCase())) &&
    (!catFilter || e.category === catFilter)
  );

  return (
    <div style={{ display:'grid', gridTemplateColumns:'280px 1fr', gap:16, alignItems:'start' }}>
      {/* Left — entity list */}
      <div>
        <div style={{ display:'flex', gap:6, marginBottom:8 }}>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="🔍 Buscar..." style={{ flex:1, fontSize:12 }} />
          <button onClick={() => setShowNewEntity(v=>!v)} style={{
            padding:'7px 10px', background:'var(--y)', color:'#000', border:'none',
            borderRadius:'var(--rs)', fontWeight:700, fontSize:11, cursor:'pointer', whiteSpace:'nowrap',
          }}>+ Novo</button>
        </div>
        <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:10 }}>
          {['', ...CATEGORIES].map(c => (
            <button key={c||'all'} onClick={() => setCatFilter(c)} style={{
              fontSize:10.5, padding:'3px 10px', border:'1px solid var(--b2)',
              borderRadius:999, cursor:'pointer', fontFamily:'inherit', fontWeight:600,
              background: catFilter===c ? 'var(--y)' : 'var(--s2)',
              color:      catFilter===c ? '#000'     : 'var(--tm)',
            }}>{c||'Todos'}</button>
          ))}
        </div>

        {showNewEntity && (
          <div style={{ background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', padding:12, marginBottom:10 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:8 }}>Novo Contato</div>
            <div style={{ marginBottom:8 }}>
              <label style={{ fontSize:11, color:'var(--tm)', display:'block', marginBottom:3 }}>Categoria</label>
              <select value={entityForm.category} onChange={e=>setE('category',e.target.value)} style={{ width:'100%' }}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ marginBottom:8 }}>
              <label style={{ fontSize:11, color:'var(--tm)', display:'block', marginBottom:3 }}>Nome *</label>
              <input value={entityForm.name} onChange={e=>setE('name',e.target.value)} placeholder="Nome do contato ou empresa" style={{ width:'100%' }} />
            </div>
            <div style={{ marginBottom:8 }}>
              <label style={{ fontSize:11, color:'var(--tm)', display:'block', marginBottom:3 }}>Telefone</label>
              <input value={entityForm.phone} onChange={e=>setE('phone',e.target.value)} style={{ width:'100%' }} />
            </div>
            <div style={{ marginBottom:8 }}>
              <label style={{ fontSize:11, color:'var(--tm)', display:'block', marginBottom:3 }}>Email</label>
              <input value={entityForm.email} onChange={e=>setE('email',e.target.value)} style={{ width:'100%' }} />
            </div>
            {entityForm.category === 'Fabricantes' && (
              <div style={{ borderTop:'1px solid var(--b1)', paddingTop:8, marginBottom:8 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--bl)', marginBottom:6 }}>Contato no Fabricante</div>
                <div style={{ marginBottom:6 }}>
                  <label style={{ fontSize:11, color:'var(--tm)', display:'block', marginBottom:3 }}>Nome do responsável</label>
                  <input value={entityForm.fabricante_contact_name} onChange={e=>setE('fabricante_contact_name',e.target.value)} style={{ width:'100%' }} />
                </div>
                <div style={{ marginBottom:6 }}>
                  <label style={{ fontSize:11, color:'var(--tm)', display:'block', marginBottom:3 }}>Cargo</label>
                  <input value={entityForm.fabricante_contact_role} onChange={e=>setE('fabricante_contact_role',e.target.value)} style={{ width:'100%' }} />
                </div>
                <div style={{ marginBottom:6 }}>
                  <label style={{ fontSize:11, color:'var(--tm)', display:'block', marginBottom:3 }}>Tel. direto</label>
                  <input value={entityForm.fabricante_contact_phone} onChange={e=>setE('fabricante_contact_phone',e.target.value)} style={{ width:'100%' }} />
                </div>
              </div>
            )}
            <div style={{ marginBottom:8 }}>
              <label style={{ fontSize:11, color:'var(--tm)', display:'block', marginBottom:3 }}>Notas</label>
              <textarea value={entityForm.notes} onChange={e=>setE('notes',e.target.value)} rows={2} style={{ width:'100%' }} />
            </div>
            <div style={{ display:'flex', gap:6 }}>
              <button onClick={saveEntity} style={{ padding:'7px 14px', background:'var(--y)', color:'#000', border:'none', borderRadius:'var(--rs)', fontWeight:700, fontSize:11, cursor:'pointer' }}>Salvar</button>
              <button onClick={() => setShowNewEntity(false)} style={{ padding:'7px 14px', background:'var(--s3)', color:'var(--ts)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', fontSize:11, cursor:'pointer' }}>Cancelar</button>
            </div>
          </div>
        )}

        <div style={{ display:'flex', flexDirection:'column', gap:5, maxHeight:'62vh', overflowY:'auto' }}>
          {filtered.length === 0 && (
            <div style={{ textAlign:'center', color:'var(--tm)', fontSize:13, padding:'30px 0' }}>Nenhum contato encontrado</div>
          )}
          {filtered.map(e => {
            const lastAttempt = (e.attempts||[]).sort((a,b) => new Date(b.attempted_at)-new Date(a.attempted_at))[0];
            const res = lastAttempt ? RESULT_MAP[lastAttempt.result] : null;
            return (
              <div key={e.id} onClick={() => selectEntity(e)} style={{
                padding:'10px 12px', borderRadius:'var(--rs)', cursor:'pointer',
                background: selected?.id===e.id ? 'rgba(255,215,0,.07)' : 'var(--s1)',
                border:`1px solid ${selected?.id===e.id ? 'rgba(255,215,0,.3)' : 'var(--b1)'}`,
              }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:3 }}>
                  <div style={{ fontSize:13, fontWeight:600 }}>{e.name}</div>
                  <span style={{ fontSize:9.5, background:'var(--s2)', color:'var(--tm)', padding:'1px 7px', borderRadius:999, fontWeight:600 }}>{e.category}</span>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:11, color:'var(--tm)' }}>
                  {e.phone && <span>📞 {e.phone}</span>}
                  <span>{(e.attempts||[]).length} tentativa{(e.attempts||[]).length!==1?'s':''}</span>
                  {res && <span style={{ color:res.color, fontWeight:600 }}>{res.icon} {res.label}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right — attempt timeline */}
      <div>
        {!selected && (
          <div style={{ textAlign:'center', color:'var(--tm)', fontSize:13, padding:'80px 0' }}>
            Selecione um contato para ver o histórico de tentativas
          </div>
        )}
        {selected && (
          <div>
            <div style={{ background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--r)', padding:'16px 20px', marginBottom:12 }}>
              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:10 }}>
                <div>
                  <div style={{ fontSize:18, fontWeight:800 }}>{selected.name}</div>
                  <div style={{ fontSize:12, color:'var(--tm)', marginTop:3, display:'flex', gap:12, flexWrap:'wrap' }}>
                    <span style={{ background:'var(--s2)', padding:'1px 8px', borderRadius:999, fontWeight:600 }}>{selected.category}</span>
                    {selected.phone && <span>📞 {selected.phone}</span>}
                    {selected.email && <span>📧 {selected.email}</span>}
                  </div>
                  {selected.category === 'Fabricantes' && selected.fabricante_contact_name && (
                    <div style={{ marginTop:8, padding:'8px 12px', background:'rgba(96,165,250,.06)', border:'1px solid rgba(96,165,250,.15)', borderRadius:'var(--rs)', fontSize:12 }}>
                      <span style={{ color:'var(--bl)', fontWeight:700 }}>👤 {selected.fabricante_contact_name}</span>
                      {selected.fabricante_contact_role && <span style={{ color:'var(--tm)', marginLeft:8 }}>{selected.fabricante_contact_role}</span>}
                      {selected.fabricante_contact_phone && <span style={{ color:'var(--tm)', marginLeft:8 }}>📞 {selected.fabricante_contact_phone}</span>}
                    </div>
                  )}
                  {selected.notes && <div style={{ marginTop:6, fontSize:12, color:'var(--ts)' }}>{selected.notes}</div>}
                </div>
                <button onClick={() => setShowNewAttempt(v=>!v)} style={{
                  padding:'7px 14px', background:'var(--y)', color:'#000', border:'none',
                  borderRadius:'var(--rs)', fontWeight:700, fontSize:11, cursor:'pointer', flexShrink:0,
                }}>+ Registrar tentativa</button>
              </div>
              <div style={{ display:'flex', gap:10, paddingTop:10, borderTop:'1px solid var(--b1)', flexWrap:'wrap' }}>
                {Object.entries(RESULT_MAP).map(([key,meta]) => {
                  const count = attempts.filter(a => a.result===key).length;
                  if (!count) return null;
                  return <span key={key} style={{ fontSize:11, color:meta.color, fontWeight:600 }}>{meta.icon} {meta.label}: {count}</span>;
                })}
                {attempts.length === 0 && <span style={{ fontSize:11, color:'var(--tm)' }}>Nenhuma tentativa registrada</span>}
              </div>
            </div>

            {showNewAttempt && (
              <div style={{ background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', padding:14, marginBottom:12 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:10 }}>Nova Tentativa</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8 }}>
                  <div>
                    <label style={{ fontSize:11, color:'var(--tm)', display:'block', marginBottom:3 }}>Data e hora</label>
                    <input type="datetime-local" value={attemptForm.attempted_at} onChange={e=>setA('attempted_at',e.target.value)} style={{ width:'100%' }} />
                  </div>
                  <div>
                    <label style={{ fontSize:11, color:'var(--tm)', display:'block', marginBottom:3 }}>Resultado</label>
                    <select value={attemptForm.result} onChange={e=>setA('result',e.target.value)} style={{ width:'100%' }}>
                      {Object.entries(RESULT_MAP).map(([key,meta]) => <option key={key} value={key}>{meta.icon} {meta.label}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom:8 }}>
                  <label style={{ fontSize:11, color:'var(--tm)', display:'block', marginBottom:3 }}>Vincular a chamado (opcional)</label>
                  <select value={attemptForm.chamado_id} onChange={e=>setA('chamado_id',e.target.value)} style={{ width:'100%' }}>
                    <option value="">Nenhum</option>
                    {cases.map(c => (
                      <option key={c.id} value={c.id}>#{c.id} — {c.integrador||c.cliente_final||c.nome} | {c.sn||'-'} | {c.status}</option>
                    ))}
                  </select>
                </div>
                <div style={{ marginBottom:8 }}>
                  <label style={{ fontSize:11, color:'var(--tm)', display:'block', marginBottom:3 }}>Observações</label>
                  <textarea value={attemptForm.notes} onChange={e=>setA('notes',e.target.value)} rows={2} style={{ width:'100%' }} placeholder="O que foi discutido, próximos passos..." />
                </div>
                <div style={{ display:'flex', gap:6 }}>
                  <button onClick={saveAttempt} style={{ padding:'7px 14px', background:'var(--y)', color:'#000', border:'none', borderRadius:'var(--rs)', fontWeight:700, fontSize:11, cursor:'pointer' }}>Salvar</button>
                  <button onClick={() => setShowNewAttempt(false)} style={{ padding:'7px 14px', background:'var(--s3)', color:'var(--ts)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', fontSize:11, cursor:'pointer' }}>Cancelar</button>
                </div>
              </div>
            )}

            {loading && <div style={{ textAlign:'center', color:'var(--tm)', padding:'20px 0', fontSize:13 }}>Carregando...</div>}
            {!loading && attempts.length === 0 && (
              <div style={{ textAlign:'center', color:'var(--tm)', fontSize:13, padding:'30px 0' }}>
                Nenhuma tentativa registrada ainda.<br/>
                <span style={{ fontSize:12 }}>Clique em "+ Registrar tentativa" para começar.</span>
              </div>
            )}
            {!loading && attempts.map((a, i) => {
              const res = RESULT_MAP[a.result] || RESULT_MAP.other;
              const dt  = new Date(a.attempted_at);
              return (
                <div key={a.id} style={{
                  display:'flex', gap:12, padding:'12px 0',
                  borderBottom: i < attempts.length-1 ? '1px solid var(--b1)' : 'none',
                  alignItems:'flex-start',
                }}>
                  <div style={{ width:36, height:36, borderRadius:'50%', flexShrink:0, background:`${res.color}18`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, border:`1px solid ${res.color}30` }}>{res.icon}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:3 }}>
                      <span style={{ fontSize:12.5, fontWeight:700, color:res.color }}>{res.label}</span>
                      <span style={{ fontSize:11, color:'var(--tm)' }}>por {a.author}</span>
                      {a.chamado && (
                        <span style={{ fontSize:10.5, background:'rgba(96,165,250,.1)', color:'var(--bl)', padding:'1px 7px', borderRadius:999, fontWeight:600 }}>
                          🔗 #{a.chamado.id} {a.chamado.sn}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize:11, color:'var(--tm)', marginBottom:4, fontFamily:'monospace' }}>
                      📅 {dt.toLocaleDateString('pt-BR')} ⏱ {dt.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })}
                    </div>
                    {a.notes && (
                      <div style={{ fontSize:12, color:'var(--ts)', background:'var(--s2)', padding:'6px 10px', borderRadius:'var(--rs)', lineHeight:1.5 }}>
                        {a.notes}
                      </div>
                    )}
                  </div>
                  <button onClick={() => deleteAttempt(a.id)} style={{ background:'none', border:'none', color:'var(--tm)', cursor:'pointer', fontSize:12, padding:'4px 6px', borderRadius:4, flexShrink:0 }}
                    onMouseEnter={e=>e.currentTarget.style.color='var(--re)'}
                    onMouseLeave={e=>e.currentTarget.style.color='var(--tm)'}>✕</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Agenda({ showToast = () => {}, user = {} }) {
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

  const isAdminOrMaster = user?.role === 'master' || user?.role === 'admin'
    || (user?.permissions || []).includes('view_all_cases')
    || (user?.permissions || []).includes('manage_roles');

  const load = useCallback(async () => {
    const data = await api('/api/reminders').catch(() => []);
    setReminders(Array.isArray(data) ? data : []);
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
          <p style={{ fontSize:13, color:'var(--tm)' }}>Lembretes de retorno e tentativas de contato.</p>
        </div>
        {activeTab === 'reminders' && (
          <Btn variant="primary" onClick={() => { setShowForm(true); setEditing(null); }}>
            + Novo Lembrete
          </Btn>
        )}
      </div>

      {/* Tab switcher */}
      <div style={{ display:'inline-flex', gap:2, background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--rs)', padding:3, marginBottom:20 }}>
        {[{id:'reminders',label:'📅 Lembretes'},{id:'contacts',label:'📞 Tentativas de Contato'}].map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            padding:'8px 18px', border:'none', borderRadius:7, fontSize:12.5, fontWeight:600,
            cursor:'pointer', fontFamily:'inherit', transition:'all .15s',
            background: activeTab===t.id ? 'var(--s3)' : 'transparent',
            color:      activeTab===t.id ? 'var(--tx)' : 'var(--tm)',
          }}>{t.label}</button>
        ))}
      </div>

      {activeTab === 'contacts' && <ContactsTab showToast={showToast} />}

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
              showAuthor={isAdminOrMaster}
              currentUser={user}
              onCommentAdded={load}
              showToast={showToast}
            />
          ))}
        </div>
      </div>
    </>
    }
    </div>
  );
}
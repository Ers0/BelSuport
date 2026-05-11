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
export default function Agenda({ showToast, user }) {
  const now = new Date();
  const isAdminOrMaster = ['admin','master'].includes(user?.role) ||
    (user?.permissions||[]).includes('view_all_cases') ||
    (user?.permissions||[]).includes('manage_roles');
  const [year, setYear]       = useState(now.getFullYear());
  const [month, setMonth]     = useState(now.getMonth());
  const [reminders, setReminders] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [showForm, setShowForm]   = useState(false);
  const [editing, setEditing]     = useState(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch]   = useState('');

  const load = useCallback(async () => {
    const url = isAdminOrMaster ? '/api/reminders?all=true' : '/api/reminders';
    const data = await api(url).catch(() => []);
    setReminders(data);
  }, [isAdminOrMaster]);

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
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:26, fontWeight:800, letterSpacing:'-.025em', marginBottom:4 }}>📅 Agenda</h1>
          <p style={{ fontSize:13, color:'var(--tm)' }}>Lembretes de retorno e anotações de clientes.</p>
        </div>
        <Btn variant="primary" onClick={() => { setShowForm(true); setEditing(null); }}>
          + Novo Lembrete
        </Btn>
      </div>

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
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { Btn, Avatar } from './UI';

const EVENT_ICONS = {
  created:        '🆕',
  status_change:  '🔄',
  comment:        '💬',
  file_uploaded:  '📎',
  jira_created:   '🔗',
  drive_uploaded: '☁️',
  assignment:     '👤',
};

const EVENT_COLORS = {
  created:        'var(--gr)',
  status_change:  'var(--bl)',
  comment:        'var(--y)',
  file_uploaded:  'var(--pu)',
  jira_created:   'var(--bl)',
  drive_uploaded: 'var(--gr)',
  assignment:     '#F59E0B',
};

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60)   return `${Math.round(diff)}s`;
  if (diff < 3600) return `${Math.round(diff/60)}min`;
  if (diff < 86400) return `${Math.round(diff/3600)}h`;
  return `${Math.round(diff/86400)}d`;
}

export default function CaseTimeline({ caseId, visible }) {
  const [events, setEvents]   = useState([]);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !caseId) return;
    api(`/api/events/${caseId}`).then(setEvents).catch(() => {});
  }, [caseId, visible]);

  async function addComment() {
    if (!comment.trim()) return;
    setLoading(true);
    try {
      await api('/api/events', { method:'POST', body: JSON.stringify({
        case_id: caseId, event_type: 'comment', description: comment
      })});
      setComment('');
      const data = await api(`/api/events/${caseId}`);
      setEvents(data);
    } catch(e) {}
    setLoading(false);
  }

  if (!visible) return null;

  return (
    <div style={{ borderTop:'1px solid var(--b1)', marginTop:10, paddingTop:12 }}>
      <div style={{ fontSize:11, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:10 }}>
        Timeline
      </div>

      {/* Comment input */}
      <div style={{ display:'flex', gap:7, marginBottom:12 }}>
        <input
          value={comment}
          onChange={e=>setComment(e.target.value)}
          onKeyDown={e=>e.key==='Enter'&&addComment()}
          placeholder="Adicionar comentário..."
          style={{ flex:1, fontSize:12 }}
        />
        <Btn variant="ghost" onClick={addComment} disabled={loading || !comment.trim()} style={{ fontSize:12, padding:'7px 12px' }}>
          Enviar
        </Btn>
      </div>

      {/* Events list */}
      <div style={{ maxHeight:220, overflowY:'auto', display:'flex', flexDirection:'column', gap:8 }}>
        {events.length === 0 && (
          <div style={{ fontSize:12, color:'var(--tm)', textAlign:'center', padding:'10px 0' }}>Sem eventos registrados</div>
        )}
        {events.map(ev => (
          <div key={ev.id} style={{ display:'flex', gap:9, alignItems:'flex-start' }}>
            <div style={{
              width:26, height:26, borderRadius:'50%', flexShrink:0, marginTop:1,
              background: `${EVENT_COLORS[ev.event_type] || 'var(--tm)'}18`,
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:12,
            }}>
              {EVENT_ICONS[ev.event_type] || '•'}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:2 }}>
                <span style={{ fontSize:12, fontWeight:600 }}>{ev.user_name || 'Sistema'}</span>
                <span style={{ fontSize:10.5, color:'var(--tm)' }}>{timeAgo(ev.created_at)}</span>
              </div>
              <div style={{ fontSize:12, color:'var(--ts)' }}>{ev.description}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

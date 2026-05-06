import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import { Avatar, Btn, Field } from '../components/UI';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS & HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const CAT_COLORS = {
  'Inversor':        { bg:'rgba(96,165,250,.12)',  accent:'#60A5FA', icon:'⚡' },
  'Comunicação':     { bg:'rgba(168,85,247,.12)',  accent:'#A78BFA', icon:'📡' },
  'Monitoramento':   { bg:'rgba(34,197,94,.12)',   accent:'#22C55E', icon:'📊' },
  'Instalação':      { bg:'rgba(251,146,60,.12)',  accent:'#FB923C', icon:'🔧' },
  'Firmware':        { bg:'rgba(239,68,68,.12)',   accent:'#EF4444', icon:'💾' },
  'Baterias':        { bg:'rgba(52,211,153,.12)',  accent:'#34D399', icon:'🔋' },
  'Proteção':        { bg:'rgba(244,114,182,.12)', accent:'#F472B6', icon:'🛡️' },
  'Outros':          { bg:'rgba(255,215,0,.08)',   accent:'#FFD700', icon:'📋' },
};

function catStyle(brand, tags) {
  const tag = (tags || [])[0] || '';
  for (const [key, val] of Object.entries(CAT_COLORS)) {
    if (tag.toLowerCase().includes(key.toLowerCase()) || brand?.toLowerCase().includes(key.toLowerCase())) return val;
  }
  // Hash brand to a color
  const colors = Object.values(CAT_COLORS);
  const idx = (brand || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % colors.length;
  return colors[idx];
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60)     return 'agora';
  if (diff < 3600)   return `${Math.floor(diff/60)}min atrás`;
  if (diff < 86400)  return `${Math.floor(diff/3600)}h atrás`;
  if (diff < 604800) return `${Math.floor(diff/86400)}d atrás`;
  return new Date(dateStr).toLocaleDateString('pt-BR');
}

function excerpt(text, len = 120) {
  if (!text) return '';
  const plain = text.replace(/#{1,3} /g,'').replace(/\*\*/g,'').replace(/`/g,'').replace(/\n/g,' ');
  return plain.length > len ? plain.slice(0, len) + '…' : plain;
}

function readTime(text) {
  const words = (text || '').split(/\s+/).length;
  return Math.max(1, Math.round(words / 200)) + ' min';
}

// ─────────────────────────────────────────────────────────────────────────────
// MARKDOWN RENDERER
// ─────────────────────────────────────────────────────────────────────────────

function MD({ text }) {
  if (!text) return null;
  const html = text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
    .replace(/^# (.+)$/gm,   '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^---$/gm, '<hr/>')
    .replace(/^- (.+)$/gm,    '<li>$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
    .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');
  return (
    <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} style={{
      fontSize:14, color:'var(--ts)', lineHeight:1.8,
    }} />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EMPTY STATE
// ─────────────────────────────────────────────────────────────────────────────

function EmptyState({ onNew, query }) {
  return (
    <div style={{ gridColumn:'1/-1', textAlign:'center', padding:'80px 20px' }}>
      <div style={{
        width:80, height:80, borderRadius:20, background:'var(--s2)',
        border:'1px solid var(--b2)', display:'flex', alignItems:'center',
        justifyContent:'center', fontSize:36, margin:'0 auto 20px',
      }}>📚</div>
      <div style={{ fontSize:20, fontWeight:800, marginBottom:8 }}>
        {query ? `Nenhum resultado para "${query}"` : 'Nenhuma solução ainda'}
      </div>
      <div style={{ fontSize:13.5, color:'var(--tm)', maxWidth:380, margin:'0 auto 28px', lineHeight:1.6 }}>
        {query
          ? 'Tente outros termos ou navegue pelas categorias ao lado.'
          : 'Seja o primeiro a compartilhar uma solução com a equipe. O conhecimento coletivo é o maior ativo do time.'}
      </div>
      {!query && (
        <button onClick={onNew} style={{
          padding:'12px 28px', background:'var(--y)', color:'#000',
          border:'none', borderRadius:'var(--rs)', fontSize:14, fontWeight:700,
          cursor:'pointer', fontFamily:'inherit',
        }}>✍️ Escrever primeira solução</button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ARTICLE CARD
// ─────────────────────────────────────────────────────────────────────────────

function ArticleCard({ s, onClick, onHelpful, featured }) {
  const cs = catStyle(s.brand, s.tags);
  const voteKey = `sol_vote_${s.id}`;
  const [voted, setVoted] = useState(() => localStorage.getItem(voteKey) || null);

  function vote(e, v) {
    e.stopPropagation();
    if (voted) return;
    localStorage.setItem(voteKey, v);
    setVoted(v);
    onHelpful?.(s.id, v);
  }

  if (featured) {
    return (
      <div onClick={onClick} style={{
        gridColumn:'1/-1',
        background:'var(--s1)', border:'1px solid var(--b1)',
        borderRadius:16, overflow:'hidden', cursor:'pointer',
        display:'grid', gridTemplateColumns:'1fr 340px',
        transition:'border-color .15s, box-shadow .15s',
      }}
        onMouseEnter={e => { e.currentTarget.style.borderColor='var(--b2)'; e.currentTarget.style.boxShadow='0 8px 32px rgba(0,0,0,.2)'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor='var(--b1)'; e.currentTarget.style.boxShadow='none'; }}
      >
        <div style={{ padding:'28px 32px' }}>
          {/* Category + pinned */}
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
            <span style={{ fontSize:11, fontWeight:700, background:'rgba(255,215,0,.1)', color:'var(--y)', padding:'3px 10px', borderRadius:999, border:'1px solid rgba(255,215,0,.2)' }}>
              📌 Em destaque
            </span>
            {s.brand && (
              <span style={{ fontSize:11, fontWeight:700, background:cs.bg, color:cs.accent, padding:'3px 10px', borderRadius:999 }}>
                {cs.icon} {s.brand}
              </span>
            )}
          </div>
          <h2 style={{ fontSize:22, fontWeight:900, lineHeight:1.25, marginBottom:12, letterSpacing:'-.02em' }}>{s.title}</h2>
          <p style={{ fontSize:13.5, color:'var(--tm)', lineHeight:1.7, marginBottom:20, maxWidth:520 }}>{excerpt(s.content, 200)}</p>
          {/* Tags */}
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:20 }}>
            {(s.tags||[]).map(t => (
              <span key={t} style={{ fontSize:11.5, color:'var(--tm)', background:'var(--s2)', padding:'2px 9px', borderRadius:999, border:'1px solid var(--b1)' }}>#{t}</span>
            ))}
          </div>
          {/* Meta */}
          <div style={{ display:'flex', alignItems:'center', gap:16, fontSize:12, color:'var(--ts)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:7 }}>
              <Avatar name={s.author_name || '?'} size={24} />
              <span>{s.author_name}</span>
            </div>
            <span>·</span>
            <span>{timeAgo(s.created_at)}</span>
            <span>·</span>
            <span>⏱ {readTime(s.content)}</span>
            {s.images?.length > 0 && <><span>·</span><span>🖼️ {s.images.length}</span></>}
          </div>
        </div>
        {/* Right accent panel */}
        <div style={{ background:cs.bg, display:'flex', alignItems:'center', justifyContent:'center', borderLeft:'1px solid var(--b1)' }}>
          <span style={{ fontSize:72, opacity:.4 }}>{cs.icon}</span>
        </div>
      </div>
    );
  }

  return (
    <div onClick={onClick} style={{
      background:'var(--s1)', border:'1px solid var(--b1)',
      borderRadius:12, overflow:'hidden', cursor:'pointer',
      display:'flex', flexDirection:'column',
      transition:'border-color .15s, transform .15s, box-shadow .15s',
    }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor='var(--b2)';
        e.currentTarget.style.transform='translateY(-2px)';
        e.currentTarget.style.boxShadow='0 8px 24px rgba(0,0,0,.18)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor='var(--b1)';
        e.currentTarget.style.transform='translateY(0)';
        e.currentTarget.style.boxShadow='none';
      }}
    >
      {/* Color band */}
      <div style={{ height:4, background:`linear-gradient(90deg, ${cs.accent}, ${cs.accent}88)` }} />

      <div style={{ padding:'18px 20px', flex:1, display:'flex', flexDirection:'column' }}>
        {/* Brand badge */}
        {s.brand && (
          <span style={{ alignSelf:'flex-start', fontSize:11, fontWeight:700, background:cs.bg, color:cs.accent, padding:'2px 9px', borderRadius:999, marginBottom:10 }}>
            {cs.icon} {s.brand}
          </span>
        )}

        {/* Title */}
        <h3 style={{ fontSize:15, fontWeight:800, lineHeight:1.3, marginBottom:8, letterSpacing:'-.01em', flex:'none' }}>{s.title}</h3>

        {/* Excerpt */}
        <p style={{ fontSize:12.5, color:'var(--tm)', lineHeight:1.65, marginBottom:14, flex:1 }}>{excerpt(s.content)}</p>

        {/* Tags */}
        {s.tags?.length > 0 && (
          <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:14 }}>
            {s.tags.slice(0,3).map(t => (
              <span key={t} style={{ fontSize:10.5, color:'var(--ts)', background:'var(--s2)', padding:'1px 7px', borderRadius:999, border:'1px solid var(--b1)' }}>#{t}</span>
            ))}
            {s.tags.length > 3 && <span style={{ fontSize:10.5, color:'var(--ts)' }}>+{s.tags.length-3}</span>}
          </div>
        )}

        {/* Footer */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', paddingTop:12, borderTop:'1px solid var(--b1)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:7 }}>
            <Avatar name={s.author_name || '?'} size={22} />
            <div>
              <div style={{ fontSize:11.5, fontWeight:600 }}>{(s.author_name||'?').split(' ')[0]}</div>
              <div style={{ fontSize:10.5, color:'var(--ts)' }}>{timeAgo(s.created_at)}</div>
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:11, color:'var(--ts)' }}>⏱ {readTime(s.content)}</span>
            {/* Helpful votes */}
            <div onClick={e => e.stopPropagation()} style={{ display:'flex', gap:3 }}>
              <button onClick={e => vote(e,'up')} title={voted ? 'Já votou' : 'Útil'} style={{
                padding:'3px 7px', border:'1px solid var(--b2)', borderRadius:6,
                background: voted==='up' ? 'rgba(34,197,94,.1)' : 'transparent',
                color: voted==='up' ? 'var(--gr)' : 'var(--ts)',
                cursor: voted ? 'default' : 'pointer', fontSize:11.5, fontFamily:'inherit',
                transition:'all .12s',
              }}>👍 {(s.helpful_up||0)+(voted==='up'?1:0)}</button>
              <button onClick={e => vote(e,'down')} title={voted ? 'Já votou' : 'Não útil'} style={{
                padding:'3px 7px', border:'1px solid var(--b2)', borderRadius:6,
                background: voted==='down' ? 'rgba(239,68,68,.08)' : 'transparent',
                color: voted==='down' ? 'var(--re)' : 'var(--ts)',
                cursor: voted ? 'default' : 'pointer', fontSize:11.5, fontFamily:'inherit',
                transition:'all .12s',
              }}>👎 {(s.helpful_down||0)+(voted==='down'?1:0)}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ARTICLE READER (slide-in panel)
// ─────────────────────────────────────────────────────────────────────────────

function ArticleReader({ sol, onClose, onEdit, user, showToast, onReload }) {
  const [uploading, setUploading] = useState(null);
  const voteKey = `sol_vote_${sol.id}`;
  const [voted, setVoted] = useState(() => localStorage.getItem(voteKey) || null);
  const imgRef = useRef();
  const vidRef = useRef();

  const canEdit = sol.created_by === user?.id
    || user?.permissions?.includes('manage_roles')
    || user?.permissions?.includes('view_all_cases');

  async function uploadFile(file) {
    setUploading('uploading');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/solutions/${sol.id}/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('session_token')}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload falhou');

      // Warn if YouTube scope is missing
      if (data.media?._ytFallbackReason === 'youtube_scope') {
        showToast('⚠️ Vídeo salvo no Drive. Para usar YouTube: vá em Configurações → autentique o Google Drive novamente (precisamos de permissão do YouTube).', 'warn', 10000);
      } else if (data.media?._ytFallbackReason === 'youtube_quota') {
        showToast('⚠️ Cota YouTube esgotada. Vídeo salvo no Drive.', 'warn', 6000);
      } else {
        showToast(`✅ ${file.type.startsWith('video/') ? 'Vídeo' : 'Imagem'} enviado!`);
      }
      onReload?.();
    } catch (e) { showToast('Erro: ' + e.message, 'warn'); }
    setUploading(null);
  }

  async function deleteMedia(mediaId) {
    if (!mediaId) return;
    await fetch(`/api/solutions/${sol.id}/media/${mediaId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${localStorage.getItem('session_token')}` },
    });
    showToast('Mídia removida');
    onReload?.();
  }

  async function deleteSol() {
    if (!confirm('Remover esta solução permanentemente?')) return;
    await api(`/api/solutions/${sol.id}`, { method: 'DELETE' });
    showToast('Solução removida');
    onClose();
    onReload?.();
  }

  const cs = catStyle(sol.brand, sol.tags);

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:900,
        backdropFilter:'blur(2px)', animation:'fadeIn .2s ease',
      }} />

      {/* Slide-in panel */}
      <div style={{
        position:'fixed', top:0, right:0, bottom:0, width:'min(780px, 90vw)',
        background:'var(--bg)', zIndex:901, overflowY:'auto',
        boxShadow:'-12px 0 60px rgba(0,0,0,.5)',
        animation:'slideInRight .28s cubic-bezier(0.34,1.2,0.64,1)',
        display:'flex', flexDirection:'column',
      }}>
        {/* Reader header */}
        <div style={{
          position:'sticky', top:0, zIndex:10,
          background:'var(--bg)', borderBottom:'1px solid var(--b1)',
          padding:'14px 24px', display:'flex', alignItems:'center', gap:12,
        }}>
          <button onClick={onClose} style={{
            background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:8,
            color:'var(--tm)', cursor:'pointer', fontSize:13, padding:'6px 12px',
            fontFamily:'inherit', display:'flex', alignItems:'center', gap:6,
          }}>← Voltar</button>

          <div style={{ flex:1 }} />

          <div style={{ display:'flex', gap:8 }}>
            {canEdit && (
              <>
                <button onClick={onEdit} style={{ padding:'6px 14px', background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:8, color:'var(--tm)', cursor:'pointer', fontSize:12.5, fontFamily:'inherit', fontWeight:600 }}>
                  ✏️ Editar
                </button>
                <button onClick={deleteSol} style={{ padding:'6px 14px', background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.2)', borderRadius:8, color:'var(--re)', cursor:'pointer', fontSize:12.5, fontFamily:'inherit', fontWeight:600 }}>
                  🗑 Remover
                </button>
              </>
            )}
            <a href={`/api/reports/solution/${sol.id}?token=${localStorage.getItem('session_token')}`}
              target="_blank" rel="noreferrer"
              style={{ padding:'6px 14px', background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:8, color:'var(--tm)', textDecoration:'none', fontSize:12.5, fontWeight:600 }}>
              📤 Compartilhar / PDF
            </a>
          </div>
        </div>

        {/* Article content */}
        <div style={{ padding:'32px 40px', flex:1 }}>
          {/* Brand + tags header */}
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:18 }}>
            {sol.brand && (
              <span style={{ fontSize:12, fontWeight:700, background:cs.bg, color:cs.accent, padding:'3px 12px', borderRadius:999, border:`1px solid ${cs.accent}33` }}>
                {cs.icon} {sol.brand}
              </span>
            )}
            {(sol.tags||[]).map(t => (
              <span key={t} style={{ fontSize:11.5, color:'var(--tm)', background:'var(--s2)', padding:'2px 9px', borderRadius:999, border:'1px solid var(--b1)' }}>#{t}</span>
            ))}
          </div>

          {/* Title */}
          <h1 style={{ fontSize:28, fontWeight:900, lineHeight:1.2, marginBottom:16, letterSpacing:'-.025em' }}>{sol.title}</h1>

          {/* Author + meta strip */}
          <div style={{ display:'flex', alignItems:'center', gap:16, paddingBottom:20, borderBottom:'1px solid var(--b1)', marginBottom:28, fontSize:13, color:'var(--tm)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <Avatar name={sol.author_name||'?'} size={32} />
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:'var(--tx)' }}>{sol.author_name}</div>
                <div style={{ fontSize:11.5 }}>{new Date(sol.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' })}</div>
              </div>
            </div>
            <span>·</span>
            <span>⏱ {readTime(sol.content)} de leitura</span>
            {sol.images?.length > 0 && <><span>·</span><span>🖼️ {sol.images.length} imagem{sol.images.length!==1?'s':''}</span></>}
            {sol.videos?.length > 0 && <><span>·</span><span>🎥 {sol.videos.length} vídeo{sol.videos.length!==1?'s':''}</span></>}
          </div>

          {/* Body */}
          <style>{`
            .md-body h1 { font-size:20px; font-weight:800; color:var(--tx); margin:22px 0 8px; letter-spacing:-.02em; }
            .md-body h2 { font-size:16px; font-weight:700; color:var(--tx); margin:18px 0 7px; }
            .md-body h3 { font-size:14px; font-weight:700; color:var(--ts); margin:14px 0 6px; }
            .md-body strong { font-weight:700; color:var(--tx); }
            .md-body code { background:var(--s2); padding:2px 6px; border-radius:5px; font-family:monospace; font-size:12.5px; color:var(--bl); border:1px solid var(--b2); }
            .md-body blockquote { border-left:3px solid var(--y); padding:8px 16px; background:rgba(255,215,0,.04); border-radius:0 6px 6px 0; margin:12px 0; color:var(--ts); }
            .md-body hr { border:none; border-top:1px solid var(--b2); margin:20px 0; }
            .md-body ul, .md-body ol { padding-left:20px; margin:8px 0; }
            .md-body li { margin:5px 0; color:var(--ts); }
            .md-body p { margin:10px 0; }
          `}</style>
          <MD text={sol.content} />

          {/* Media grid */}
          {sol.media?.length > 0 && (
            <div style={{ marginTop:32 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:14 }}>
                📎 Arquivos ({sol.media.length})
              </div>

              {/* Images */}
              {sol.media.filter(m=>m.type==='image').length > 0 && (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px, 1fr))', gap:10, marginBottom:14 }}>
                  {sol.media.filter(m=>m.type==='image').map((img, i) => (
                    <div key={img.id||i} style={{ borderRadius:10, overflow:'hidden', border:'1px solid var(--b1)', position:'relative' }}>
                      <a href={img.view_link||img.url} target="_blank" rel="noreferrer">
                        {/* Use Drive direct embed URL for images */}
                        <img
                          src={img.thumb_url || img.url}
                          alt={img.name}
                          style={{ width:'100%', height:140, objectFit:'cover', display:'block' }}
                          onError={e => { e.target.src = img.url; }}
                        />
                      </a>
                      <div style={{ padding:'6px 10px', fontSize:11, color:'var(--tm)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{img.name}</span>
                        {canEdit && (
                          <button onClick={() => deleteMedia(img.id)} style={{ background:'none', border:'none', color:'var(--ts)', cursor:'pointer', fontSize:13, padding:'0 0 0 6px', flexShrink:0 }}>✕</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Videos */}
              {sol.media.filter(m=>m.type==='video').map((v, i) => (
                <div key={v.id||i} style={{ marginBottom:10, border:'1px solid var(--b1)', borderRadius:10, overflow:'hidden' }}>
                  {v.provider === 'youtube' && v.embed_url ? (
                    <iframe
                      src={v.embed_url}
                      width="100%" height="240"
                      style={{ border:'none', display:'block' }}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  ) : v.provider === 'drive' ? (
                    /* Drive iframe is CSP-blocked — show thumbnail + play button */
                    <a href={v.url} target="_blank" rel="noreferrer" style={{ display:'block', textDecoration:'none', position:'relative' }}>
                      {/* Thumbnail via Drive thumbnail API */}
                      <div style={{ position:'relative', width:'100%', height:220, background:'var(--s2)', overflow:'hidden' }}>
                        <img
                          src={`https://drive.google.com/thumbnail?id=${v.ref_id}&sz=w640`}
                          alt={v.name}
                          style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}
                          onError={e => { e.target.style.display='none'; }}
                        />
                        {/* Play button overlay */}
                        <div style={{
                          position:'absolute', inset:0,
                          display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                          background:'rgba(0,0,0,.35)',
                        }}>
                          <div style={{
                            width:56, height:56, borderRadius:'50%',
                            background:'rgba(255,255,255,.92)',
                            display:'flex', alignItems:'center', justifyContent:'center',
                            fontSize:22, marginBottom:10,
                          }}>▶</div>
                          <div style={{ color:'#fff', fontSize:12.5, fontWeight:600, textShadow:'0 1px 3px rgba(0,0,0,.6)' }}>
                            {v.name}
                          </div>
                          <div style={{ color:'rgba(255,255,255,.75)', fontSize:11, marginTop:4 }}>
                            ☁️ Abrir no Google Drive
                          </div>
                        </div>
                      </div>
                    </a>
                  ) : (
                    <a href={v.url} target="_blank" rel="noreferrer" style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', textDecoration:'none' }}>
                      {v.thumb_url && <img src={v.thumb_url} alt="" style={{ width:90, height:52, objectFit:'cover', borderRadius:7, flexShrink:0 }} />}
                      <div>
                        <div style={{ fontSize:13, fontWeight:600, color:'var(--tx)', marginBottom:3 }}>{v.name}</div>
                        <div style={{ fontSize:11.5, color:'var(--bl)' }}>▶ Abrir vídeo</div>
                      </div>
                    </a>
                  )}
                  {canEdit && (
                    <div style={{ padding:'6px 12px', borderTop:'1px solid var(--b1)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <span style={{ fontSize:11, color:'var(--ts)' }}>{v.provider === 'youtube' ? '🎬 YouTube' : '☁️ Drive'} · {v.name}</span>
                      <button onClick={() => deleteMedia(v.id)} style={{ background:'none', border:'none', color:'var(--ts)', cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>✕ Remover</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Upload controls */}
          {canEdit && (
            <div style={{ marginTop:20, paddingTop:18, borderTop:'1px solid var(--b1)' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:10 }}>
                Adicionar mídia
              </div>
              <div style={{ display:'flex', gap:10 }}>
                <input ref={imgRef} type="file" accept="image/*" style={{ display:'none' }}
                  onChange={e => e.target.files[0] && uploadFile(e.target.files[0])} />
                <input ref={vidRef} type="file" accept="video/*" style={{ display:'none' }}
                  onChange={e => e.target.files[0] && uploadFile(e.target.files[0])} />
                <button onClick={() => imgRef.current.click()} disabled={!!uploading} style={{ padding:'8px 16px', background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:8, color:'var(--tm)', cursor:'pointer', fontSize:12.5, fontFamily:'inherit', fontWeight:600 }}>
                  {uploading === 'uploading' ? '⏳ Enviando...' : '🖼️ Imagem → Drive'}
                </button>
                <button onClick={() => vidRef.current.click()} disabled={!!uploading} style={{ padding:'8px 16px', background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:8, color:'var(--tm)', cursor:'pointer', fontSize:12.5, fontFamily:'inherit', fontWeight:600 }}>
                  {uploading === 'uploading' ? '⏳ Enviando...' : '🎥 Vídeo → YouTube / Drive'}
                </button>
              </div>
              <div style={{ fontSize:11, color:'var(--ts)', marginTop:7 }}>
                Imagens ficam no Drive. Vídeos vão para YouTube (não listado) — se a cota acabar, vão para o Drive automaticamente.
              </div>
            </div>
          )}

          {/* Helpful? */}
          <div style={{ marginTop:36, padding:'20px', background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:12, textAlign:'center' }}>
            <div style={{ fontSize:14, fontWeight:700, marginBottom:12 }}>Esta solução foi útil?</div>
            <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
              {[['👍','Sim, resolveu!','up','var(--gr)','rgba(34,197,94,.1)'],['👎','Não ajudou','down','var(--re)','rgba(239,68,68,.08)']].map(([icon, label, v, color, bg]) => (
                <button key={v} onClick={() => {
                if (voted) return;
                const key = `sol_vote_${sol.id}`;
                localStorage.setItem(key, v);
                setVoted(v);
              }} disabled={!!voted} style={{
                  padding:'10px 24px', borderRadius:10, border:`1px solid ${voted===v?color:'var(--b2)'}`,
                  background: voted===v ? bg : 'transparent',
                  color: voted===v ? color : 'var(--tm)',
                  fontSize:13, fontWeight:700, cursor: voted?'default':'pointer', fontFamily:'inherit',
                  transition:'all .15s',
                }}>{icon} {label}</button>
              ))}
            </div>
            {voted && <div style={{ marginTop:12, fontSize:12.5, color:'var(--tm)' }}>{voted==='up' ? '🎉 Obrigado pelo feedback!' : 'Feedback registrado. Vamos melhorar!'}</div>}
          </div>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STRUCTURED EDITOR
// ─────────────────────────────────────────────────────────────────────────────

const TEMPLATE = `## Problema
Descreva o problema encontrado — sintomas, alarmes, contexto.

## Causa
O que causou o problema.

## Solução Passo a Passo
1. Primeiro passo
2. Segundo passo
3. Terceiro passo

## Observações
Dicas extras, cuidados, variações encontradas em campo.`;

function Editor({ initial, onSave, onCancel, allBrands, allTags }) {
  const [form, setForm] = useState({
    title:   initial?.title   || '',
    content: initial?.content || TEMPLATE,
    brand:   initial?.brand   || '',
    tags:    (initial?.tags||[]).join(', '),
  });
  const [tab,         setTab]         = useState('edit');
  const [saving,      setSaving]      = useState(false);
  const [brandOpen,   setBrandOpen]   = useState(false);
  const [brandFilter, setBrandFilter] = useState('');
  const brandRef = React.useRef();
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!brandOpen) return;
    const handler = e => {
      if (brandRef.current && !brandRef.current.contains(e.target)) setBrandOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [brandOpen]);

  const filteredBrands = allBrands.filter(b =>
    !brandFilter || b.toLowerCase().includes(brandFilter.toLowerCase())
  );

  function insertSnippet(snippet) {
    const ta = document.getElementById('sol-editor-body');
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const before = form.content.slice(0, s);
    const after  = form.content.slice(e);
    const newVal = before + snippet + after;
    set('content', newVal);
    setTimeout(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = s + snippet.length; }, 10);
  }

  async function save() {
    if (!form.title.trim() || !form.content.trim()) return;
    setSaving(true);
    await onSave({
      title:        form.title.trim(),
      content:      form.content.trim(),
      brand:        form.brand.trim() || null,
      tags:         form.tags.split(',').map(t => t.trim()).filter(Boolean),
      _pendingFiles: form._pendingFiles || [],   // pass files to parent
    });
    setSaving(false);
  }

  const wordCount = form.content.trim().split(/\s+/).filter(Boolean).length;

  return (
    <div style={{ maxWidth:880, margin:'0 auto', padding:'28px 32px' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:900, marginBottom:4 }}>
            {initial ? '✏️ Editar Solução' : '✍️ Nova Solução'}
          </h1>
          <p style={{ fontSize:12.5, color:'var(--tm)' }}>
            Compartilhe um aprendizado com a equipe. Use Markdown para formatar.
          </p>
        </div>
        <button onClick={onCancel} style={{ background:'none', border:'1px solid var(--b2)', borderRadius:8, color:'var(--tm)', cursor:'pointer', fontSize:12.5, padding:'7px 16px', fontFamily:'inherit' }}>
          Cancelar
        </button>
      </div>

      {/* Title */}
      <div style={{ marginBottom:14 }}>
        <input value={form.title} onChange={e => set('title', e.target.value)}
          placeholder="Título da solução — seja específico. Ex: Reset do WIFI no Deye SUN-6K após falha F01"
          style={{ width:'100%', fontSize:18, fontWeight:700, padding:'12px 16px', background:'var(--s1)', border:'1.5px solid var(--b2)', borderRadius:10, color:'var(--tx)', fontFamily:'inherit' }}
          autoFocus
        />
      </div>

      {/* Brand + Tags row */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap:10, marginBottom:14 }}>
        <div>
          {/* Brand picker — custom dropdown so arrow click works */}
          <div ref={brandRef} style={{ position:'relative' }}>
            <div style={{ display:'flex', alignItems:'center', background:'var(--s1)', border:`1px solid ${brandOpen ? 'var(--y)' : 'var(--b2)'}`, borderRadius:8, overflow:'hidden', transition:'border-color .15s' }}>
              <input
                value={brandOpen ? brandFilter : form.brand}
                onChange={e => {
                  setBrandFilter(e.target.value);
                  if (!brandOpen) setBrandOpen(true);
                  // If user clears the field, also clear the form brand
                  if (!e.target.value) set('brand', '');
                }}
                onFocus={() => { setBrandOpen(true); setBrandFilter(''); }}
                onBlur={e => {
                  // Normalize on blur
                  if (!brandOpen) {
                    const n = e.target.value.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
                    if (n) set('brand', n);
                  }
                }}
                placeholder={form.brand || 'Fabricante (ex: Deye, FoxESS...)'}
                style={{ flex:1, padding:'9px 12px', background:'transparent', border:'none', outline:'none', color:'var(--tx)', fontFamily:'inherit', fontSize:13, minWidth:0 }}
              />
              <button
                type="button"
                onClick={() => { setBrandOpen(v => !v); setBrandFilter(''); }}
                style={{ padding:'9px 12px', background:'transparent', border:'none', color:'var(--tm)', cursor:'pointer', fontSize:11, lineHeight:1, flexShrink:0 }}
              >▼</button>
            </div>

            {brandOpen && (
              <div style={{
                position:'absolute', left:0, right:0, top:'calc(100% + 4px)',
                background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:8,
                boxShadow:'0 8px 24px rgba(0,0,0,.4)', zIndex:500,
                maxHeight:220, overflowY:'auto',
              }}>
                {/* "Use custom" option if typed something not in list */}
                {brandFilter && !allBrands.find(b => b.toLowerCase() === brandFilter.toLowerCase()) && (
                  <div
                    onMouseDown={e => { e.preventDefault(); const n = brandFilter.trim().toLowerCase().replace(/\b\w/g, c=>c.toUpperCase()); set('brand', n); setBrandOpen(false); setBrandFilter(''); }}
                    style={{ padding:'9px 14px', fontSize:12.5, cursor:'pointer', color:'var(--y)', borderBottom:'1px solid var(--b1)' }}
                    onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.04)'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}
                  >
                    ✚ Usar "{brandFilter.trim().toLowerCase().replace(/\b\w/g, c=>c.toUpperCase())}"
                  </div>
                )}
                {filteredBrands.length === 0 && !brandFilter && (
                  <div style={{ padding:'12px 14px', fontSize:12.5, color:'var(--tm)', fontStyle:'italic' }}>
                    Nenhum fabricante cadastrado ainda
                  </div>
                )}
                {filteredBrands.map(b => (
                  <div
                    key={b}
                    onMouseDown={e => { e.preventDefault(); set('brand', b); setBrandOpen(false); setBrandFilter(''); }}
                    style={{ padding:'9px 14px', fontSize:13, cursor:'pointer', fontWeight: form.brand===b ? 700 : 400, color: form.brand===b ? 'var(--y)' : 'var(--tx)', borderBottom:'1px solid var(--b1)' }}
                    onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.04)'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}
                  >
                    {form.brand===b && <span style={{ marginRight:6 }}>✓</span>}
                    {b}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div>
          <input value={form.tags} onChange={e => set('tags', e.target.value)}
            placeholder="Tags separadas por vírgula: F01, RS485, comunicação, WIFI"
            style={{ width:'100%', padding:'9px 14px', background:'var(--s1)', border:'1px solid var(--b2)', borderRadius:8, color:'var(--tx)', fontFamily:'inherit', fontSize:13 }}
          />
        </div>
      </div>

      {/* Editor / Preview tabs */}
      <div style={{ background:'var(--s1)', border:'1px solid var(--b2)', borderRadius:12, overflow:'hidden' }}>
        {/* Toolbar */}
        <div style={{ display:'flex', alignItems:'center', padding:'8px 12px', borderBottom:'1px solid var(--b2)', background:'var(--s2)', gap:4, flexWrap:'wrap' }}>
          {/* Tab switcher */}
          <div style={{ display:'flex', gap:2, marginRight:12 }}>
            {['edit','preview'].map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding:'4px 12px', borderRadius:6, border:'none', fontSize:12, fontWeight:600,
                cursor:'pointer', fontFamily:'inherit', transition:'all .12s',
                background: tab===t ? 'var(--s1)' : 'transparent',
                color:      tab===t ? 'var(--tx)' : 'var(--tm)',
              }}>{t === 'edit' ? '✏️ Editar' : '👁 Preview'}</button>
            ))}
          </div>
          {/* Format buttons */}
          {tab === 'edit' && [
            ['**texto**','B','bold'],
            ['*texto*','I','italic'],
            ['`código`','</>','code'],
            ['## Título','H2','heading'],
            ['- item','• ','list'],
            ['> nota','❝','quote'],
          ].map(([snippet, label]) => (
            <button key={label} onClick={() => insertSnippet(snippet)} style={{
              padding:'3px 9px', borderRadius:5, border:'1px solid var(--b2)', fontSize:11.5,
              background:'transparent', color:'var(--tm)', cursor:'pointer', fontFamily:'monospace',
              fontWeight:600,
            }}>{label}</button>
          ))}
          <div style={{ flex:1 }} />
          <span style={{ fontSize:11, color:'var(--ts)' }}>{wordCount} palavras · ⏱ {Math.max(1,Math.round(wordCount/200))} min</span>
        </div>

        {/* Content area */}
        {tab === 'edit' ? (
          <textarea id="sol-editor-body"
            value={form.content} onChange={e => set('content', e.target.value)}
            style={{
              width:'100%', minHeight:420, padding:'18px 20px', resize:'vertical',
              background:'transparent', border:'none', outline:'none',
              color:'var(--tx)', fontFamily:'monospace', fontSize:13.5,
              lineHeight:1.7, boxSizing:'border-box',
            }}
          />
        ) : (
          <div style={{ padding:'24px 28px', minHeight:420 }}>
            {form.content.trim()
              ? <MD text={form.content} />
              : <div style={{ color:'var(--ts)', fontStyle:'italic', fontSize:13 }}>Escreva algo para ver o preview aqui...</div>
            }
          </div>
        )}
      </div>

      {/* Upload zone */}
      <div style={{ marginTop:10, marginBottom:6 }}>
        <input
          type="file"
          accept="image/*,video/*"
          multiple
          id="sol-upload-input"
          style={{ display:'none' }}
          onChange={e => {
            Array.from(e.target.files).forEach(f => {
              // Queue files — actual upload happens after save when we have an ID
              setForm(prev => ({ ...prev, _pendingFiles: [...(prev._pendingFiles||[]), f] }));
            });
          }}
        />
        <label htmlFor="sol-upload-input" style={{
          display:'block', padding:'16px', border:'2px dashed var(--b2)',
          borderRadius:10, textAlign:'center', cursor:'pointer',
          background:'var(--s1)', color:'var(--tm)', fontSize:13,
          transition:'all .15s',
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor='var(--y)'; e.currentTarget.style.color='var(--tx)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor='var(--b2)'; e.currentTarget.style.color='var(--tm)'; }}
          onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor='var(--y)'; }}
          onDragLeave={e => { e.currentTarget.style.borderColor='var(--b2)'; }}
          onDrop={e => {
            e.preventDefault();
            e.currentTarget.style.borderColor='var(--b2)';
            Array.from(e.dataTransfer.files).forEach(f => {
              setForm(prev => ({ ...prev, _pendingFiles: [...(prev._pendingFiles||[]), f] }));
            });
          }}
        >
          <span style={{ fontSize:20 }}>📎</span>
          <div style={{ marginTop:4 }}>Arraste imagens/vídeos ou clique para selecionar</div>
          <div style={{ fontSize:11, marginTop:3, color:'var(--ts)' }}>
            Imagens → Drive · Vídeos → YouTube (fallback Drive) · Enviados após publicar
          </div>
        </label>
        {(form._pendingFiles||[]).length > 0 && (
          <div style={{ marginTop:8, display:'flex', gap:6, flexWrap:'wrap' }}>
            {(form._pendingFiles||[]).map((f, i) => (
              <div key={i} style={{ padding:'3px 10px', background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:999, fontSize:11.5, display:'flex', alignItems:'center', gap:6 }}>
                <span>{f.type.startsWith('video/') ? '🎥' : '🖼️'}</span>
                <span style={{ maxWidth:120, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.name}</span>
                <button onClick={() => setForm(p => ({ ...p, _pendingFiles:(p._pendingFiles||[]).filter((_,j)=>j!==i) }))}
                  style={{ background:'none', border:'none', color:'var(--ts)', cursor:'pointer', fontSize:13, padding:0, lineHeight:1 }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display:'flex', gap:10, marginTop:16, alignItems:'center' }}>
        <button onClick={save} disabled={saving || !form.title.trim() || !form.content.trim()} style={{
          padding:'11px 28px', background:'var(--y)', color:'#000',
          border:'none', borderRadius:10, fontSize:14, fontWeight:700,
          cursor: (saving || !form.title.trim()) ? 'not-allowed' : 'pointer',
          opacity: (saving || !form.title.trim()) ? .6 : 1,
          fontFamily:'inherit', transition:'opacity .15s',
        }}>
          {saving ? '⏳ Publicando...' : '🚀 Publicar Solução'}
        </button>
        <button onClick={onCancel} style={{ padding:'11px 20px', background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:10, color:'var(--tm)', cursor:'pointer', fontSize:14, fontFamily:'inherit' }}>
          Cancelar
        </button>
        <span style={{ fontSize:11.5, color:'var(--ts)', marginLeft:8 }}>
          💡 Após publicar, a IA indexa automaticamente para busca semântica.
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SIDEBAR
// ─────────────────────────────────────────────────────────────────────────────

function Sidebar({ brands, tags, activeBrand, activeTag, onBrand, onTag, counts, total }) {
  return (
    <div style={{ width:220, flexShrink:0 }}>
      {/* Stats */}
      <div style={{ background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:12, padding:'16px', marginBottom:12 }}>
        <div style={{ fontSize:28, fontWeight:900, color:'var(--tx)', lineHeight:1 }}>{total}</div>
        <div style={{ fontSize:12, color:'var(--tm)', marginTop:3 }}>soluções publicadas</div>
      </div>

      {/* Browse categories */}
      <div style={{ background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:12, padding:'14px', marginBottom:10 }}>
        <div style={{ fontSize:10.5, fontWeight:700, color:'var(--ts)', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:10 }}>Categorias</div>
        <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
          <button onClick={() => onBrand('')} style={{
            display:'flex', justifyContent:'space-between', alignItems:'center',
            padding:'7px 10px', borderRadius:7, border:'none', fontSize:12.5,
            fontFamily:'inherit', cursor:'pointer', textAlign:'left', fontWeight:600,
            background: !activeBrand ? 'rgba(255,215,0,.08)' : 'transparent',
            color:      !activeBrand ? 'var(--y)' : 'var(--tm)',
          }}>
            <span>📋 Todas</span>
            <span style={{ fontSize:11, opacity:.6 }}>{total}</span>
          </button>
          {brands.map(b => {
            const cs = catStyle(b, []);
            const active = activeBrand === b;
            return (
              <button key={b} onClick={() => onBrand(active ? '' : b)} style={{
                display:'flex', justifyContent:'space-between', alignItems:'center',
                padding:'7px 10px', borderRadius:7, border:'none', fontSize:12.5,
                fontFamily:'inherit', cursor:'pointer', textAlign:'left', fontWeight: active ? 700 : 500,
                background: active ? cs.bg : 'transparent',
                color:      active ? cs.accent : 'var(--tm)',
              }}>
                <span>{cs.icon} {b}</span>
                <span style={{ fontSize:11, opacity:.6 }}>{counts.brands?.[b]||0}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tags cloud */}
      {tags.length > 0 && (
        <div style={{ background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:12, padding:'14px' }}>
          <div style={{ fontSize:10.5, fontWeight:700, color:'var(--ts)', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:10 }}>Tags populares</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
            {tags.slice(0,16).map(t => (
              <button key={t} onClick={() => onTag(activeTag === t ? '' : t)} style={{
                padding:'3px 9px', borderRadius:999, border:'1px solid var(--b2)',
                fontSize:11, cursor:'pointer', fontFamily:'inherit', transition:'all .12s',
                background: activeTag === t ? 'var(--y)' : 'transparent',
                color:      activeTag === t ? '#000' : 'var(--tm)',
                fontWeight: activeTag === t ? 700 : 400,
              }}>#{t}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI SEARCH ANSWER
// ─────────────────────────────────────────────────────────────────────────────

function AIBanner({ answer, loading, onClear }) {
  if (!answer && !loading) return null;
  return (
    <div style={{
      gridColumn:'1/-1', padding:'18px 22px',
      background:'rgba(255,215,0,.04)', border:'1px solid rgba(255,215,0,.18)',
      borderRadius:12, marginBottom:4,
    }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:16 }}>✨</span>
          <span style={{ fontSize:13, fontWeight:700, color:'var(--y)' }}>Resposta gerada pela IA</span>
          <span style={{ fontSize:11, color:'var(--tm)' }}>baseada nas soluções indexadas</span>
        </div>
        <button onClick={onClear} style={{ background:'none', border:'none', color:'var(--ts)', cursor:'pointer', fontSize:13 }}>✕</button>
      </div>
      {loading
        ? <div style={{ fontSize:13, color:'var(--tm)', fontStyle:'italic' }}>Sintetizando resposta com base no banco de soluções...</div>
        : <div style={{ fontSize:13, color:'var(--tx)', lineHeight:1.7, whiteSpace:'pre-wrap' }}>{answer}</div>
      }
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN VIEW
// ─────────────────────────────────────────────────────────────────────────────

export default function SolutionCentre({ showToast, user }) {
  const [solutions,     setSolutions]     = useState([]);
  const [selectedSol,   setSelectedSol]   = useState(null);
  const [editing,       setEditing]       = useState(null);
  const [view,          setView]          = useState('browse'); // browse | editor
  const [loading,       setLoading]       = useState(false);
  const [searching,     setSearching]     = useState(false);
  const [query,         setQuery]         = useState('');
  const [aiAnswer,      setAiAnswer]      = useState(null);
  const [searchResults, setSearchResults] = useState(null);
  const [activeBrand,   setActiveBrand]   = useState('');
  const [activeTag,     setActiveTag]     = useState('');
  const [brands,        setBrands]        = useState([]);
  const [tags,          setTags]          = useState([]);
  const searchTimer = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (activeBrand) params.set('brand', activeBrand);
    if (activeTag)   params.set('tag',   activeTag);
    const data = await api(`/api/solutions?${params}`).catch(() => []);
    setSolutions(data || []);
    setLoading(false);
  }, [activeBrand, activeTag]);

  const loadMeta = useCallback(async () => {
    const m = await api('/api/solutions/meta/tags').catch(() => ({ brands:[], tags:[] }));
    setBrands(m.brands || []);
    setTags(m.tags || []);
  }, []);

  useEffect(() => { load(); loadMeta(); }, [load, loadMeta]);

  // Semantic search with debounce
  async function doSearch(q) {
    if (!q.trim()) { setSearchResults(null); setAiAnswer(null); return; }
    setSearching(true); setAiAnswer(null);
    try {
      const res = await api('/api/solutions/search', { method:'POST', body: JSON.stringify({ query:q, brand:activeBrand||undefined }) });
      setSearchResults(res.solutions || []);
      setAiAnswer(res.answer || null);
    } catch(e) { showToast('Erro na busca: ' + e.message, 'warn'); }
    setSearching(false);
  }

  function handleQuery(val) {
    setQuery(val);
    clearTimeout(searchTimer.current);
    if (!val.trim()) { setSearchResults(null); setAiAnswer(null); return; }
    searchTimer.current = setTimeout(() => doSearch(val), 700);
  }

  async function loadDetail(id) {
    const sol = await api(`/api/solutions/${id}`).catch(() => null);
    if (sol) setSelectedSol(sol);
  }

  async function handleHelpful(id, vote) {
    // Optimistically update the count in the displayed list
    const update = list => list.map(s =>
      s.id === id ? { ...s, helpful_up: (s.helpful_up||0) + (vote==='up'?1:0), helpful_down: (s.helpful_down||0) + (vote==='down'?1:0) } : s
    );
    setSolutions(prev => update(prev));
    if (searchResults) setSearchResults(prev => update(prev));

    await api(`/api/solutions/${id}/helpful`, {
      method: 'POST',
      body:   JSON.stringify({ vote }),
    }).catch(() => {});
  }

  async function saveNew(formData) {
    try {
      const { _pendingFiles, ...payload } = formData;
      const sol = await api('/api/solutions', { method:'POST', body: JSON.stringify(payload) });
      showToast('🚀 Solução publicada!');

      // Upload any attached files
      if (_pendingFiles?.length) {
        showToast(`📎 Enviando ${_pendingFiles.length} arquivo(s)...`, 'info', 4000);
        for (const file of _pendingFiles) {
          const fd = new FormData();
          fd.append('file', file);
          await fetch(`/api/solutions/${sol.id}/upload`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${localStorage.getItem('session_token')}` },
            body: fd,
          }).catch(e => console.warn('File upload failed:', e));
        }
        showToast('✅ Arquivos enviados!');
      }

      load(); loadMeta(); setView('browse');
    } catch(e) { showToast('Erro: ' + e.message, 'warn'); }
  }

  async function saveEdit(formData) {
    try {
      await api(`/api/solutions/${editing.id}`, { method:'PUT', body: JSON.stringify(formData) });
      showToast('✅ Solução atualizada!');
      const updated = await api(`/api/solutions/${editing.id}`);
      setSelectedSol(updated); setEditing(null); setView('browse');
      load(); loadMeta();
    } catch(e) { showToast('Erro: ' + e.message, 'warn'); }
  }

  // Counts for sidebar
  const counts = {
    brands: solutions.reduce((acc, s) => { if (s.brand) acc[s.brand] = (acc[s.brand]||0)+1; return acc; }, {}),
  };

  const displayed = searchResults !== null ? searchResults : solutions;
  const featured  = displayed[0];
  const rest      = displayed.slice(1);

  // ── Editor ──────────────────────────────────────────────────────────────────
  if (view === 'editor') {
    return (
      <Editor
        initial={editing?.id ? editing : null}
        allBrands={brands}
        allTags={tags}
        onSave={editing?.id ? saveEdit : saveNew}
        onCancel={() => { setEditing(null); setView('browse'); }}
      />
    );
  }

  // ── Browse ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding:'24px 28px 48px' }}>
      {/* Reader */}
      {selectedSol && (
        <ArticleReader
          sol={selectedSol}
          user={user}
          showToast={showToast}
          onClose={() => setSelectedSol(null)}
          onEdit={() => { setEditing(selectedSol); setSelectedSol(null); setView('editor'); }}
          onReload={async () => { const u = await api(`/api/solutions/${selectedSol.id}`); setSelectedSol(u); load(); }}
        />
      )}

      {/* Page header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:22 }}>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:4 }}>
            <span style={{ fontSize:24 }}>🔬</span>
            <h1 style={{ fontSize:24, fontWeight:900, letterSpacing:'-.025em' }}>Centro de Soluções</h1>
          </div>
          <p style={{ fontSize:13, color:'var(--tm)' }}>Base de conhecimento colaborativa da equipe técnica.</p>
        </div>
        <button onClick={() => { setEditing(null); setView('editor'); }} style={{
          padding:'10px 22px', background:'var(--y)', color:'#000',
          border:'none', borderRadius:10, fontSize:13.5, fontWeight:700,
          cursor:'pointer', fontFamily:'inherit', display:'flex', alignItems:'center', gap:8,
        }}>✍️ Nova Solução</button>
      </div>

      {/* Search bar */}
      <div style={{ position:'relative', marginBottom:22 }}>
        <span style={{ position:'absolute', left:16, top:'50%', transform:'translateY(-50%)', fontSize:16, pointerEvents:'none', color:'var(--tm)' }}>🔍</span>
        <input
          value={query}
          onChange={e => handleQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doSearch(query)}
          placeholder="Busca semântica — ex: inversor sem comunicação após chuva, alarme F01, reset WIFI Deye..."
          style={{ width:'100%', paddingLeft:46, paddingRight:100, fontSize:14, padding:'13px 110px 13px 46px', background:'var(--s1)', border:'1.5px solid var(--b2)', borderRadius:12, color:'var(--tx)', fontFamily:'inherit', boxSizing:'border-box' }}
        />
        <button onClick={() => doSearch(query)} disabled={searching || !query.trim()} style={{
          position:'absolute', right:6, top:'50%', transform:'translateY(-50%)',
          padding:'7px 18px', background: query.trim() ? 'var(--y)' : 'var(--s2)',
          color: query.trim() ? '#000' : 'var(--tm)',
          border:'none', borderRadius:8, fontSize:12.5, fontWeight:700,
          cursor:'pointer', fontFamily:'inherit', transition:'all .15s',
        }}>
          {searching ? '...' : '✨ IA'}
        </button>
      </div>

      {/* Body: sidebar + content */}
      <div style={{ display:'flex', gap:18, alignItems:'flex-start' }}>
        <Sidebar
          brands={brands} tags={tags}
          activeBrand={activeBrand} activeTag={activeTag}
          onBrand={b => { setActiveBrand(b); setSearchResults(null); setQuery(''); }}
          onTag={t => { setActiveTag(t); setSearchResults(null); setQuery(''); }}
          counts={counts}
          total={solutions.length}
        />

        {/* Article grid */}
        <div style={{ flex:1, minWidth:0 }}>
          {/* Search state header */}
          {searchResults !== null && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
              <div style={{ fontSize:13, color:'var(--tm)' }}>
                {searching ? 'Buscando...' : `${searchResults.length} resultado${searchResults.length !== 1 ? 's' : ''} para "${query}"`}
              </div>
              <button onClick={() => { setQuery(''); setSearchResults(null); setAiAnswer(null); }}
                style={{ background:'none', border:'none', color:'var(--bl)', cursor:'pointer', fontSize:12.5, fontFamily:'inherit', fontWeight:600 }}>
                ✕ Limpar busca
              </button>
            </div>
          )}

          {loading && !searching && (
            <div style={{ textAlign:'center', padding:'60px 0', color:'var(--tm)', fontSize:13 }}>
              <div style={{ fontSize:28, marginBottom:12 }}>⏳</div>
              Carregando soluções...
            </div>
          )}

          {!loading && (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(300px, 1fr))', gap:14 }}>
              {/* AI Answer */}
              <AIBanner answer={aiAnswer} loading={searching} onClear={() => setAiAnswer(null)} />

              {/* Empty state */}
              {displayed.length === 0 && !searching && (
                <EmptyState onNew={() => setView('editor')} query={query} />
              )}

              {/* Featured card */}
              {featured && (
                <ArticleCard
                  s={featured}
                  featured
                  onClick={() => loadDetail(featured.id)}
                  similarity={featured.similarity}
                  onHelpful={handleHelpful}
                />
              )}

              {/* Regular grid */}
              {rest.map(s => (
                <ArticleCard
                  key={s.id}
                  s={s}
                  similarity={s.similarity}
                  onClick={() => loadDetail(s.id)}
                  onHelpful={handleHelpful}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

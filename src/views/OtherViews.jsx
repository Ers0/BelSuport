// ── Produtos ──────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import { Btn, Card, Field, Avatar } from '../components/UI';

export function Produtos({ showToast, user }) {
  const [cats, setCats]   = useState([]);
  const [selCat, setSelCat] = useState(null);
  const [newCat, setNewCat] = useState('');
  const [newFab, setNewFab] = useState('');
  const [showCatForm, setShowCatForm] = useState(false);
  const [showFabForm, setShowFabForm] = useState(false);
  const [stats, setStats] = useState([]);
  const isAdmin = user?.role === 'master' || user?.role === 'admin';

  useEffect(() => { load(); }, []);

  async function load() {
    const [prods, cases] = await Promise.all([
      api('/api/products').catch(() => []),
      api('/api/cases/stats').catch(() => []),
    ]);
    setCats(prods);
    setStats(cases);
    if (prods.length && !selCat) setSelCat(prods[0]);
  }

  const casesByFab = {};
  stats.forEach(c => { if (c.fabricante) casesByFab[c.fabricante] = (casesByFab[c.fabricante]||0)+1; });
  const casesByCat = {};
  cats.forEach(cat => {
    casesByCat[cat.id] = (cat.fabricantes||[]).reduce((s,f) => s + (casesByFab[f.nome]||0), 0);
  });

  const totalCases = stats.length;
  const totalFabs  = cats.reduce((s,c) => s + (c.fabricantes||[]).length, 0);

  async function addCat() {
    if (!newCat.trim()) return;
    await api('/api/products/categoria', { method:'POST', body: JSON.stringify({ nome: newCat }) });
    setNewCat(''); setShowCatForm(false); load();
  }
  async function addFab() {
    if (!newFab.trim() || !selCat) return;
    await api('/api/products/fabricante', { method:'POST', body: JSON.stringify({ nome: newFab, categoria_id: selCat.id }) });
    setNewFab(''); setShowFabForm(false); load();
  }
  async function delCat(id) {
    if (!confirm('Remover categoria?')) return;
    await api(`/api/products/categoria/${id}`, { method:'DELETE' }).catch(() => {});
    load();
  }
  async function delFab(id) {
    if (!confirm('Remover fabricante?')) return;
    await api(`/api/products/fabricante/${id}`, { method:'DELETE' }).catch(() => {});
    load();
  }

  const CAT_COLORS = ['#A78BFA','#22C55E','#FB923C','#60A5FA','#F472B6','#FBBF24'];
  const maxCases = Math.max(...cats.map(c => casesByCat[c.id]||0), 1);

  return (
    <div style={{ padding:'28px 32px' }}>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:22 }}>
        <div>
          <h1 style={{ fontSize:26, fontWeight:800, letterSpacing:'-.025em', marginBottom:4 }}>
            <span style={{ marginRight:10 }}>📦</span>Gestão de Produtos
            {isAdmin && <span style={{ fontSize:12, background:'rgba(34,197,94,.1)', color:'var(--gr)', padding:'3px 10px', borderRadius:999, fontWeight:700, marginLeft:12, verticalAlign:'middle' }}>Admin</span>}
          </h1>
          <p style={{ fontSize:13, color:'var(--tm)' }}>Configure as categorias e fabricantes disponíveis no formulário de registro.</p>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:18 }}>
        {[
          { icon:'📦', color:'rgba(255,215,0,.12)', border:'rgba(255,215,0,.3)', val: cats.length, label:'Categorias' },
          { icon:'🏭', color:'rgba(96,165,250,.12)', border:'rgba(96,165,250,.3)', val: totalFabs, label:'Fabricantes' },
          { icon:'📞', color:'rgba(34,197,94,.12)', border:'rgba(34,197,94,.3)', val: totalCases, label:'Chamados Vinculados' },
        ].map((s, i) => (
          <Card key={i} style={{ padding:'16px 20px', display:'flex', alignItems:'center', gap:14 }}>
            <div style={{ width:42, height:42, borderRadius:'50%', background:s.color, border:`2px solid ${s.border}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>{s.icon}</div>
            <div>
              <div style={{ fontSize:26, fontWeight:800, lineHeight:1 }}>{s.val}</div>
              <div style={{ fontSize:12, color:'var(--tm)', marginTop:3 }}>{s.label}</div>
            </div>
          </Card>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
        <Card>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px', borderBottom:'1px solid var(--b1)' }}>
            <div>
              <div style={{ fontSize:13, fontWeight:700 }}>Categorias</div>
              <div style={{ fontSize:11, color:'var(--tm)', marginTop:2 }}>{cats.length} categorias cadastradas</div>
            </div>
            {isAdmin && <Btn variant="primary" style={{ fontSize:12, padding:'7px 14px' }} onClick={() => setShowCatForm(v=>!v)}>+ Adicionar</Btn>}
          </div>
          {showCatForm && (
            <div style={{ display:'flex', gap:6, padding:'10px 12px', borderBottom:'1px solid var(--b1)' }}>
              <input value={newCat} onChange={e=>setNewCat(e.target.value)} placeholder="Nome da categoria" onKeyDown={e=>e.key==='Enter'&&addCat()} style={{ flex:1 }} />
              <Btn variant="primary" style={{ fontSize:12, padding:'7px 12px' }} onClick={addCat}>Salvar</Btn>
              <Btn variant="ghost"   style={{ fontSize:12, padding:'7px 10px' }} onClick={() => setShowCatForm(false)}>✕</Btn>
            </div>
          )}
          <div style={{ padding:'8px' }}>
            {cats.map((cat, i) => {
              const color  = CAT_COLORS[i % CAT_COLORS.length];
              const cases  = casesByCat[cat.id] || 0;
              const barPct = Math.round((cases / maxCases) * 100);
              const active = selCat?.id === cat.id;
              return (
                <div key={cat.id} onClick={() => setSelCat(cat)} style={{
                  display:'flex', alignItems:'center', gap:10,
                  padding:'11px 10px', borderRadius:'var(--rs)',
                  background: active ? `${color}11` : 'transparent',
                  borderLeft: active ? `3px solid ${color}` : '3px solid transparent',
                  cursor:'pointer', marginBottom:2, transition:'all .12s',
                }}>
                  <div style={{ width:28, height:28, borderRadius:8, background:`${color}22`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, flexShrink:0 }}>
                    {cat.nome[0]}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:600 }}>{cat.nome}</div>
                    <div style={{ fontSize:11, color:'var(--tm)', marginTop:2 }}>{(cat.fabricantes||[]).length} fabricantes · {cases} chamados</div>
                  </div>
                  {cases > 0 && (
                    <div style={{ width:60, height:3, background:'var(--s2)', borderRadius:999, overflow:'hidden' }}>
                      <div style={{ height:'100%', background:color, borderRadius:999, width:`${barPct}%` }} />
                    </div>
                  )}
                  <span style={{ fontSize:11, fontWeight:700, color: active ? color : 'var(--tm)', minWidth:16, textAlign:'right' }}>{(cat.fabricantes||[]).length}</span>
                  {isAdmin && <button onClick={e=>{e.stopPropagation();delCat(cat.id)}} style={{ background:'none', border:'none', color:'var(--tm)', cursor:'pointer', fontSize:13, padding:'2px 4px', borderRadius:4, lineHeight:1 }}
                    onMouseEnter={e=>e.currentTarget.style.color='var(--re)'}
                    onMouseLeave={e=>e.currentTarget.style.color='var(--tm)'}
                  >✕</button>}
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px', borderBottom:'1px solid var(--b1)' }}>
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                {selCat && <div style={{ width:8, height:8, borderRadius:'50%', background: CAT_COLORS[cats.findIndex(c=>c.id===selCat.id)%CAT_COLORS.length] }} />}
                <div style={{ fontSize:13, fontWeight:700 }}>Fabricantes{selCat && ` — ${selCat.nome}`}</div>
              </div>
              {selCat && <div style={{ fontSize:11, color:'var(--tm)', marginTop:2 }}>{(selCat.fabricantes||[]).length} fabricantes · {casesByCat[selCat.id]||0} chamados</div>}
            </div>
            {isAdmin && selCat && <Btn variant="primary" style={{ fontSize:12, padding:'7px 14px' }} onClick={() => setShowFabForm(v=>!v)}>+ Adicionar</Btn>}
          </div>
          {showFabForm && (
            <div style={{ display:'flex', gap:6, padding:'10px 12px', borderBottom:'1px solid var(--b1)' }}>
              <input value={newFab} onChange={e=>setNewFab(e.target.value)} placeholder="Nome do fabricante" onKeyDown={e=>e.key==='Enter'&&addFab()} style={{ flex:1 }} />
              <Btn variant="primary" style={{ fontSize:12, padding:'7px 12px' }} onClick={addFab}>Salvar</Btn>
              <Btn variant="ghost"   style={{ fontSize:12, padding:'7px 10px' }} onClick={() => setShowFabForm(false)}>✕</Btn>
            </div>
          )}
          <div style={{ padding:'8px', minHeight:80 }}>
            {!selCat && <div style={{ textAlign:'center', color:'var(--tm)', padding:'28px 0', fontSize:13 }}>Selecione uma categoria</div>}
            {selCat && (selCat.fabricantes||[]).length === 0 && <div style={{ textAlign:'center', color:'var(--tm)', padding:'28px 0', fontSize:13 }}>Nenhum fabricante cadastrado</div>}
            {(selCat?.fabricantes||[]).map(fab => {
              const count = casesByFab[fab.nome] || 0;
              const maxF  = Math.max(...(selCat.fabricantes||[]).map(f=>casesByFab[f.nome]||0),1);
              return (
                <div key={fab.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 10px', borderRadius:'var(--rs)', marginBottom:2 }}>
                  <div style={{ width:8, height:8, borderRadius:'50%', background:'var(--y)', flexShrink:0 }} />
                  <span style={{ flex:1, fontSize:13, fontWeight:500 }}>{fab.nome}</span>
                  {count > 0 && (
                    <div style={{ width:80, height:3, background:'var(--s2)', borderRadius:999, overflow:'hidden' }}>
                      <div style={{ height:'100%', background:'var(--y)', borderRadius:999, width:`${Math.round(count/maxF*100)}%` }} />
                    </div>
                  )}
                  <span style={{ fontSize:12, color:'var(--tm)', minWidth:70, textAlign:'right' }}>{count} chamados</span>
                  {isAdmin && <button onClick={() => delFab(fab.id)} style={{ background:'none', border:'none', color:'var(--tm)', cursor:'pointer', fontSize:13, padding:'2px 4px', borderRadius:4 }}
                    onMouseEnter={e=>e.currentTarget.style.color='var(--re)'}
                    onMouseLeave={e=>e.currentTarget.style.color='var(--tm)'}
                  >✕</button>}
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── Historico ─────────────────────────────────────────────────────────────────
export function Historico({ showToast, user }) {
  const [cases,      setCases]      = useState([]);
  const [search,     setSearch]     = useState('');
  const [statusF,    setStatusF]    = useState('');
  const [selected,   setSelected]   = useState(null);
  const [editFields, setEditFields] = useState({});
  const [saving,     setSaving]     = useState(false);
  const [uploading,  setUploading]  = useState(false);
  const fileRef = useRef();

  const isAdmin = user?.role === 'master' || user?.role === 'admin'
    || user?.permissions?.includes('view_all_cases')
    || user?.permissions?.includes('manage_roles');

  const canEdit = isAdmin || user?.permissions?.includes('edit_case');

  const load = useCallback(async () => {
    const data = await api('/api/cases').catch(() => []);
    const arr  = Array.isArray(data) ? data.sort((a,b) => (b.id||0)-(a.id||0)) : [];
    // Non-admins only see their own cases
    const visible = isAdmin ? arr : arr.filter(c =>
      c.user_id === user?.id ||
      c.user_name === user?.name ||
      c.user_name === user?.email ||
      c.nome === user?.name
    );
    setCases(visible);
  }, [isAdmin, user?.id, user?.name, user?.email]);

  useEffect(() => { load(); }, [load]);

  function canEditCase(c) {
    if (isAdmin) return canEdit;
    // Regular users can only edit their own cases
    return canEdit && (
      c.user_id === user?.id ||
      c.user_name === user?.name ||
      c.user_name === user?.email
    );
  }

  function openCase(c) {
    setSelected(c);
    setEditFields({
      status:        c.status || '',
      adb_number:    c.adb_number || c.jira_key || '',
      modelo:        c.modelo || '',
      relato:        c.relato || '',
      fabricante:    c.fabricante || '',
      categoria:     c.categoria || '',
    });
  }

  async function saveEdit() {
    if (!selected) return;
    setSaving(true);
    try {
      await api(`/api/cases/${selected.id}`, {
        method: 'PUT',
        body:   JSON.stringify(editFields),
      });
      showToast('✅ Chamado atualizado!');
      await load();
      // Refresh selected with updated data
      setSelected(s => ({ ...s, ...editFields }));
    } catch(e) { showToast('Erro: '+e.message, 'warn'); }
    setSaving(false);
  }

  async function attachFile(file) {
    if (!selected || !file) return;
    setUploading(true);
    showToast('📎 Enviando arquivo para Drive/Pendentes...', 'info', 10000);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('caseId', selected.id);
      const res = await fetch('/api/drive/attach-pending', {
        method:  'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('session_token')}` },
        body:    fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload falhou');
      showToast(`✅ ${file.name} enviado para pasta /Pendentes no Drive!`);
    } catch(e) { showToast('Erro: '+e.message, 'warn'); }
    setUploading(false);
  }

  const filtered = cases.filter(c => {
    const s = search.toLowerCase();
    const matchSearch = !s || [c.nome,c.sn,c.integrador,c.cliente_final,c.fabricante,c.modelo].some(v => v?.toLowerCase().includes(s));
    const matchStatus = !statusF || c.status === statusF;
    return matchSearch && matchStatus;
  });

  const STATUS_COLORS = {
    'Pendente Itens':      { color:'#F59E0B', bg:'rgba(245,158,11,.12)' },
    'Aguardando Protocolo':{ color:'var(--bl)', bg:'rgba(96,165,250,.1)' },
    'Aguardando ADB':      { color:'var(--bl)', bg:'rgba(96,165,250,.1)' },
    'Concluído':           { color:'var(--gr)', bg:'rgba(34,197,94,.1)' },
  };

  return (
    <div style={{ padding:'28px 32px', display:'grid', gridTemplateColumns: selected ? '1fr 380px' : '1fr', gap:20, alignItems:'start' }}>
      {/* LEFT — list */}
      <div>
        <h1 style={{ fontSize:24, fontWeight:800, marginBottom:4 }}>📋 Histórico de Chamados</h1>
        <p style={{ fontSize:13, color:'var(--tm)', marginBottom:18 }}>Todos os chamados registrados no sistema.</p>

        <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="🔍 Buscar por nome, S/N, integrador..."
            style={{ flex:1, minWidth:240 }} />
          <select value={statusF} onChange={e=>setStatusF(e.target.value)} style={{ minWidth:200 }}>
            <option value="">Todos os status</option>
            <option value="Pendente Itens">Pendente Itens</option>
            <option value="Aguardando Protocolo">Aguardando Protocolo</option>
            <option value="Aguardando ADB">Aguardando ADB</option>
            <option value="Concluído">Concluído</option>
          </select>
          <button onClick={load} style={{ padding:'8px 14px', background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', color:'var(--tm)', cursor:'pointer', fontFamily:'inherit', fontSize:13 }}>🔄</button>
        </div>

        <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
          {filtered.length === 0 && (
            <div style={{ textAlign:'center', color:'var(--tm)', padding:'40px 0' }}>Nenhum chamado encontrado</div>
          )}
          {filtered.map(c => {
            const sc = STATUS_COLORS[c.status] || { color:'var(--tm)', bg:'var(--s2)' };
            const isSelected = selected?.id === c.id;
            return (
              <div key={c.id} onClick={() => isSelected ? setSelected(null) : openCase(c)}
                style={{
                  display:'flex', alignItems:'center', gap:14,
                  background: isSelected ? 'rgba(255,215,0,.04)' : 'var(--s1)',
                  border:`1px solid ${isSelected ? 'rgba(255,215,0,.3)' : 'var(--b1)'}`,
                  borderRadius:'var(--rs)', padding:'12px 16px', cursor:'pointer',
                  transition:'all .15s',
                }}
                onMouseEnter={e=>{ if(!isSelected) e.currentTarget.style.borderColor='var(--b2)'; }}
                onMouseLeave={e=>{ if(!isSelected) e.currentTarget.style.borderColor='var(--b1)'; }}
              >
                <div style={{ textAlign:'right', fontSize:11, color:'var(--tm)', minWidth:56, flexShrink:0 }}>
                  <div>{c.data}</div>
                  <div>{c.hora?.slice(0,5)}</div>
                </div>
                <Avatar name={c.nome||c.integrador||'?'} size={30} />
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {c.integrador || c.cliente_final || c.nome}
                    {c.sn && <span style={{ color:'var(--tm)', fontWeight:400, marginLeft:6 }}>| {c.sn}</span>}
                    {(c.jira_key||c.adb_number) && (
                      <span style={{ marginLeft:8, fontSize:10.5, background:'rgba(96,165,250,.1)', color:'var(--bl)', padding:'1px 7px', borderRadius:999, fontWeight:700, border:'1px solid rgba(96,165,250,.2)' }}>
                        🔗 {c.jira_key||c.adb_number}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize:11.5, color:'var(--tm)', marginTop:2 }}>
                    {c.fabricante} {c.modelo ? `· ${c.modelo}` : ''} {c.cliente_final ? `· ${c.cliente_final}` : ''}
                  </div>
                </div>
                <span style={{ fontSize:11, fontWeight:600, padding:'3px 10px', borderRadius:999, background:sc.bg, color:sc.color, flexShrink:0 }}>
                  {c.status}
                </span>
                {c.drive_id && (
                  <a href={`https://drive.google.com/drive/folders/${c.drive_id}`} target="_blank" rel="noreferrer"
                    onClick={e=>e.stopPropagation()}
                    style={{ fontSize:14, color:'var(--bl)', flexShrink:0, textDecoration:'none' }}>☁️</a>
                )}
                <a href={`/api/reports/case/${c.id}?token=${localStorage.getItem('session_token')}`}
                  target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()}
                  style={{ fontSize:11.5, padding:'4px 10px', background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:6, color:'var(--tm)', textDecoration:'none', flexShrink:0 }}>
                  📄 PDF
                </a>
              </div>
            );
          })}
        </div>
      </div>

      {/* RIGHT — edit panel */}
      {selected && (
        <div style={{ background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--rs)', overflow:'hidden', position:'sticky', top:20 }}>
          {/* Header */}
          <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--b1)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div>
              <div style={{ fontSize:14, fontWeight:700 }}>Editar Chamado #{selected.id}</div>
              <div style={{ fontSize:11.5, color:'var(--tm)', marginTop:2 }}>{selected.integrador||selected.cliente_final||selected.nome}</div>
            </div>
            <button onClick={() => setSelected(null)} style={{ background:'none', border:'none', color:'var(--ts)', cursor:'pointer', fontSize:18 }}>✕</button>
          </div>

          <div style={{ padding:'16px 18px', display:'flex', flexDirection:'column', gap:12 }}>
            {/* Status */}
            <div>
              <label style={{ fontSize:11, fontWeight:700, color:'var(--ts)', textTransform:'uppercase', letterSpacing:'.06em', display:'block', marginBottom:5 }}>Status</label>
              <select value={editFields.status} onChange={e=>setEditFields(f=>({...f,status:e.target.value}))}
                style={{ width:'100%' }}>
                <option value="Pendente Itens">Pendente Itens</option>
                <option value="Aguardando Protocolo">Aguardando Protocolo</option>
                <option value="Aguardando ADB">Aguardando ADB</option>
                <option value="Concluído">Concluído</option>
              </select>
            </div>

            {/* Protocol / ADB number */}
            <div>
              <label style={{ fontSize:11, fontWeight:700, color:'var(--ts)', textTransform:'uppercase', letterSpacing:'.06em', display:'block', marginBottom:5 }}>
                Número do Protocolo / Jira
              </label>
              <input value={editFields.adb_number} onChange={e=>setEditFields(f=>({...f,adb_number:e.target.value}))}
                placeholder="KAN-21 ou protocolo interno..." style={{ width:'100%', boxSizing:'border-box' }} />
            </div>

            {/* Modelo */}
            <div>
              <label style={{ fontSize:11, fontWeight:700, color:'var(--ts)', textTransform:'uppercase', letterSpacing:'.06em', display:'block', marginBottom:5 }}>Modelo</label>
              <input value={editFields.modelo} onChange={e=>setEditFields(f=>({...f,modelo:e.target.value}))}
                placeholder="SUN-6K-SGD4LP3" style={{ width:'100%', boxSizing:'border-box' }} />
            </div>

            {/* Fabricante */}
            <div>
              <label style={{ fontSize:11, fontWeight:700, color:'var(--ts)', textTransform:'uppercase', letterSpacing:'.06em', display:'block', marginBottom:5 }}>Fabricante</label>
              <input value={editFields.fabricante} onChange={e=>setEditFields(f=>({...f,fabricante:e.target.value}))}
                placeholder="Deye, FoxESS..." style={{ width:'100%', boxSizing:'border-box' }} />
            </div>

            {/* Relato */}
            <div>
              <label style={{ fontSize:11, fontWeight:700, color:'var(--ts)', textTransform:'uppercase', letterSpacing:'.06em', display:'block', marginBottom:5 }}>Relato</label>
              <textarea value={editFields.relato} onChange={e=>setEditFields(f=>({...f,relato:e.target.value}))}
                rows={3} style={{ width:'100%', boxSizing:'border-box', resize:'vertical' }} />
            </div>

            {/* Save button */}
            {canEditCase(selected) && (
              <button onClick={saveEdit} disabled={saving} style={{
                padding:'10px', background:'var(--y)', color:'#000', border:'none',
                borderRadius:'var(--rs)', fontSize:13, fontWeight:700, cursor:'pointer',
                fontFamily:'inherit', opacity:saving?.6:1,
              }}>
                {saving ? '⏳ Salvando...' : '💾 Salvar alterações'}
              </button>
            )}

            {/* Attach files — only for pendentes */}
            {(editFields.status === 'Pendente Itens' || selected.status === 'Pendente Itens') && (
              <div style={{ paddingTop:10, borderTop:'1px solid var(--b1)' }}>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--ts)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:8 }}>
                  📎 Anexar arquivo (salva em /Pendentes no Drive)
                </div>
                <input ref={fileRef} type="file" style={{ display:'none' }}
                  onChange={e => { if (e.target.files[0]) attachFile(e.target.files[0]); }} />
                <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{
                  width:'100%', padding:'9px', background:'var(--s2)', border:'2px dashed var(--b2)',
                  borderRadius:'var(--rs)', color:'var(--tm)', cursor:'pointer', fontFamily:'inherit',
                  fontSize:12.5, fontWeight:600, opacity:uploading?.6:1,
                }}>
                  {uploading ? '⏳ Enviando...' : '+ Selecionar arquivo'}
                </button>
                <div style={{ fontSize:11, color:'var(--ts)', marginTop:6 }}>
                  Arquivos ficam na pasta <code style={{ fontSize:10.5, background:'var(--s2)', padding:'1px 5px', borderRadius:4 }}>Drive/{selected.sn||'Pendentes'}</code>
                </div>
              </div>
            )}

            {/* Drive link */}
            {selected.drive_id && (
              <a href={`https://drive.google.com/drive/folders/${selected.drive_id}`}
                target="_blank" rel="noreferrer"
                style={{ display:'block', padding:'9px', textAlign:'center', background:'rgba(96,165,250,.07)', border:'1px solid rgba(96,165,250,.2)', borderRadius:'var(--rs)', color:'var(--bl)', textDecoration:'none', fontSize:12.5, fontWeight:600 }}>
                ☁️ Abrir pasta no Drive
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Jira ──────────────────────────────────────────────────────────────────────
export function Jira({ showToast }) {
  const [status, setStatus]   = useState('Verificando...');
  const [cases, setCases]     = useState([]);
  const [boards, setBoards]   = useState([]);
  const [selCase, setSelCase] = useState('');
  const [result, setResult]   = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api('/api/cases').then(setCases).catch(()=>{});
    api('/api/settings').then(d => setBoards(d.jiraBoards || [])).catch(()=>{});
    testConn();
  }, []);

  async function testConn(force = false) {
    // Only test if Jira is configured (has a URL in settings) or explicitly requested
    if (!force) {
      const cfg = await api('/api/settings').catch(() => null);
      if (!cfg?.jiraUrl && !cfg?.jiraHost) return; // skip if not configured
    }
    try {
      const r = await api('/api/jira/test');
      setStatus(r?.success ? '✅ Conectado como ' + r.user : '❌ ' + (r?.error || 'Erro'));
    } catch(e) { setStatus('❌ ' + e.message); }
  }

  async function createIssue() {
    if (!selCase) return showToast('Selecione um chamado', 'warn');
    const c = cases.find(x => String(x.id) === String(selCase));
    if (!c) return;
    setLoading(true);
    try {
      const r = await api('/api/jira/create-issue', { method:'POST', body: JSON.stringify(c) });
      setResult(`✅ Issue criado: <a href="${r.issueUrl}" target="_blank" style="color:var(--bl)">${r.issueKey}</a> — vinculado ao chamado #${c.id}`);
      showToast(`✅ ${r.issueKey} criado e vinculado!`);
      // Reload cases so jira_key appears in dropdown
      const updated = await api('/api/cases').catch(() => cases);
      setCases(updated);
    } catch(e) { setResult('❌ ' + e.message); showToast(e.message, 'warn'); }
    setLoading(false);
  }

  const sel = cases.find(c => String(c.id) === String(selCase));
  const matchedBoard = sel ? boards.find(b =>
    b.fabricante && (sel.fabricante||'').toLowerCase().includes(b.fabricante.toLowerCase())
  ) : null;

  return (
    <div style={{ padding:'28px 32px' }}>
      <h1 style={{ fontSize:26, fontWeight:800, letterSpacing:'-.025em', marginBottom:4 }}>🔗 Integração Jira</h1>
      <p style={{ fontSize:13, color:'var(--tm)', marginBottom:20 }}>Crie chamados no Jira a partir dos casos registrados.</p>

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--rs)', padding:'12px 16px', marginBottom:18 }}>
        <span style={{ fontSize:13, color:'var(--ts)' }}>{status}</span>
        <Btn variant="ghost" onClick={testConn}>Testar conexão</Btn>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
        <Card style={{ padding:'20px' }}>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:14 }}>Criar Issue</div>
          <Field label="Selecione o chamado">
            <select value={selCase} onChange={e=>setSelCase(e.target.value)}>
              <option value="">-- Selecione --</option>
              {cases.map(c => (
                <option key={c.id} value={c.id}>
                  {c.jira_key ? `[${c.jira_key}] ` : ''}{c.integrador || c.cliente_final || c.nome || '-'} | {c.sn || '-'} | {c.fabricante || '-'}
                </option>
              ))}
            </select>
          </Field>
          {sel && (
            <div style={{ background:'var(--s2)', borderRadius:'var(--rs)', padding:12, marginTop:8 }}>
              {sel.jira_key && (
                <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 0 10px', marginBottom:6, borderBottom:'1px solid var(--b1)' }}>
                  <span style={{ fontSize:11, background:'rgba(96,165,250,.12)', color:'var(--bl)', padding:'2px 10px', borderRadius:999, fontWeight:700 }}>
                    🔗 Jira: {sel.jira_key}
                  </span>
                  <span style={{ fontSize:11, color:'var(--tm)' }}>já vinculado — criar outro substituirá o vínculo</span>
                </div>
              )}
              {[['Cliente', sel.integrador||sel.cliente_final||sel.nome], ['S/N', sel.sn], ['Fabricante', sel.fabricante], ['Modelo', sel.modelo], ['Status', sel.status]].map(([k,v]) => (
                <div key={k} style={{ display:'flex', justifyContent:'space-between', fontSize:12.5, padding:'4px 0', borderBottom:'1px solid var(--b1)', color:'var(--tm)' }}>
                  <span>{k}</span><strong style={{ color:'var(--tx)' }}>{v || '-'}</strong>
                </div>
              ))}
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:12.5, paddingTop:8, marginTop:4 }}>
                <span style={{ color:'var(--tm)' }}>Board Jira</span>
                {matchedBoard
                  ? <span style={{ background:'rgba(255,215,0,.1)', color:'var(--y)', fontWeight:700, fontSize:12, padding:'3px 10px', borderRadius:999 }}>
                      {matchedBoard.project} ({matchedBoard.fabricante})
                    </span>
                  : <span style={{ background:'var(--s1)', color:'var(--ts)', fontSize:12, padding:'3px 10px', borderRadius:999 }}>
                      Projeto padrão
                    </span>
                }
              </div>
            </div>
          )}
          <div style={{ marginTop:14 }}>
            <Btn variant="primary" onClick={createIssue} disabled={loading}>{loading ? '⏳ Criando...' : 'Criar Issue'}</Btn>
          </div>
          {result && <div style={{ marginTop:10, fontSize:13 }} dangerouslySetInnerHTML={{ __html: result }} />}
        </Card>
      </div>
    </div>
  );
}

// ── KnowledgeBaseEditor — alarm codes training data, admin only ───────────────
const SEVERITIES = ['low','medium','high','critical'];
const SEVERITY_COLOR = { low:'var(--gr)', medium:'var(--y)', high:'var(--or)', critical:'var(--re)' };

const emptyEntry = () => ({ fabricante:'', code:'', description:'', cause:'', solution:'', severity:'medium' });

function KnowledgeBaseEditor({ showToast }) {
  const [entries, setEntries]   = useState([]);
  const [fabs, setFabs]         = useState([]);
  const [selFab, setSelFab]     = useState('');
  const [editing, setEditing]   = useState(null);
  const [form, setFormKB]       = useState(emptyEntry());
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState('');
  const [loading, setLoading]   = useState(false);

  const load = async (fab) => {
    setLoading(true);
    const params = fab ? `?fabricante=${encodeURIComponent(fab)}` : '';
    const data = await api(`/api/knowledge${params}`).catch(() => []);
    setEntries(data);
    setLoading(false);
  };

  const loadFabs = async () => {
    const data = await api('/api/knowledge/fabricantes').catch(() => []);
    setFabs(data);
  };

  useEffect(() => { loadFabs(); load(''); }, []);

  const setF = (k,v) => setFormKB(f => ({...f,[k]:v}));

  async function save() {
    if (!form.fabricante || !form.code || !form.description)
      return showToast('Fabricante, código e descrição são obrigatórios', 'warn');
    try {
      if (editing) {
        await api(`/api/knowledge/${editing}`, { method:'PUT', body: JSON.stringify(form) });
      } else {
        await api('/api/knowledge', { method:'POST', body: JSON.stringify(form) });
      }
      showToast('✅ Salvo!');
      setEditing(null); setFormKB(emptyEntry());
      loadFabs(); load(selFab);
    } catch(e) { showToast('❌ ' + e.message, 'warn'); }
  }

  async function del(id) {
    if (!confirm('Remover este código?')) return;
    await api(`/api/knowledge/${id}`, { method:'DELETE' });
    load(selFab); loadFabs();
  }

  async function bulkImport() {
    try {
      const entries = JSON.parse(importText);
      const res = await api('/api/knowledge/import', { method:'POST', body: JSON.stringify({ entries }) });
      showToast(`✅ ${res.imported} entradas importadas!`);
      setImporting(false); setImportText('');
      loadFabs(); load(selFab);
    } catch(e) { showToast('JSON inválido: ' + e.message, 'warn'); }
  }

  const filtered = selFab ? entries.filter(e => e.fabricante === selFab) : entries;

  return (
    <Card style={{ padding:'20px', marginBottom:14 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
        <div style={{ fontSize:11, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.08em' }}>
          🧠 Base de Conhecimento — Alarmes
        </div>
        <div style={{ display:'flex', gap:6 }}>
          <span style={{ fontSize:11, background:'rgba(239,68,68,.1)', color:'var(--re)', padding:'2px 8px', borderRadius:999, fontWeight:600 }}>Admin only</span>
          <Btn variant="ghost" style={{ fontSize:11, padding:'4px 10px' }} onClick={() => setImporting(v=>!v)}>
            {importing ? 'Cancelar' : '📥 Importar JSON'}
          </Btn>
        </div>
      </div>
      <div style={{ fontSize:12, color:'var(--tm)', marginBottom:16 }}>
        Cadastre códigos de alarme e falhas por fabricante. O Groq usará esta base para análises mais precisas.
      </div>

      {/* Bulk import */}
      {importing && (
        <div style={{ marginBottom:14, padding:'12px', background:'var(--s2)', borderRadius:'var(--rs)' }}>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--tm)', marginBottom:6 }}>
            Cole um array JSON no formato:
          </div>
          <div style={{ fontSize:10.5, color:'var(--tm)', fontFamily:'monospace', marginBottom:8, background:'var(--s3)', padding:'6px 10px', borderRadius:6 }}>
            {`[{"fabricante":"Deye","code":"F01","description":"Falha de rede","cause":"Tensão fora do range","solution":"Verificar tensão CA","severity":"high"}]`}
          </div>
          <textarea value={importText} onChange={e=>setImportText(e.target.value)}
            placeholder="Cole o JSON aqui..." rows={5} style={{ fontSize:12, fontFamily:'monospace' }} />
          <div style={{ display:'flex', gap:8, marginTop:8 }}>
            <Btn variant="primary" style={{ fontSize:12 }} onClick={bulkImport}>Importar</Btn>
            <Btn variant="ghost"   style={{ fontSize:12 }} onClick={() => setImporting(false)}>Cancelar</Btn>
          </div>
        </div>
      )}

      {/* Add/edit form */}
      <div style={{ background:'rgba(255,215,0,.03)', border:'1px solid rgba(255,215,0,.1)', borderRadius:'var(--rs)', padding:'14px', marginBottom:16 }}>
        <div style={{ fontSize:11, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:10 }}>
          {editing ? '✏️ Editando entrada' : '+ Novo Código de Alarme'}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:8, marginBottom:8 }}>
          <Field label="Fabricante" style={{ marginBottom:0 }}>
            <input value={form.fabricante} onChange={e=>setF('fabricante',e.target.value)} placeholder="Ex: Deye" />
          </Field>
          <Field label="Código" style={{ marginBottom:0 }}>
            <input value={form.code} onChange={e=>setF('code',e.target.value)} placeholder="Ex: E045, F01" style={{ fontFamily:'monospace', fontWeight:700 }} />
          </Field>
          <Field label="Severidade" style={{ marginBottom:0 }}>
            <select value={form.severity} onChange={e=>setF('severity',e.target.value)}>
              {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:8 }}>
          <Field label="Descrição *" style={{ marginBottom:0 }}>
            <input value={form.description} onChange={e=>setF('description',e.target.value)} placeholder="O que este alarme significa" />
          </Field>
          <Field label="Causa conhecida" style={{ marginBottom:0 }}>
            <input value={form.cause||''} onChange={e=>setF('cause',e.target.value)} placeholder="Ex: Tensão CA fora do range permitido (180-270V)" />
          </Field>
          <Field label="Solução recomendada" style={{ marginBottom:0 }}>
            <textarea value={form.solution||''} onChange={e=>setF('solution',e.target.value)}
              placeholder="Ex: 1. Verificar tensão na entrada CA&#10;2. Checar disjuntor&#10;3. ..." rows={3} />
          </Field>
        </div>
        <div style={{ display:'flex', gap:8, marginTop:10 }}>
          <Btn variant="primary" style={{ fontSize:12, padding:'8px 16px' }} onClick={save}>
            {editing ? 'Atualizar' : 'Adicionar'}
          </Btn>
          {editing && <Btn variant="ghost" style={{ fontSize:12 }} onClick={() => { setEditing(null); setFormKB(emptyEntry()); }}>Cancelar</Btn>}
        </div>
      </div>

      {/* Filter by fabricante */}
      <div style={{ display:'flex', gap:8, marginBottom:10, flexWrap:'wrap' }}>
        <button onClick={() => { setSelFab(''); load(''); }} style={{
          padding:'5px 12px', border:'1px solid var(--b2)', borderRadius:999, fontSize:12, cursor:'pointer',
          background: !selFab ? 'var(--y)' : 'var(--s2)', color: !selFab ? '#000' : 'var(--tm)', fontFamily:'inherit', fontWeight:600,
        }}>Todos</button>
        {fabs.map(f => (
          <button key={f} onClick={() => { setSelFab(f); load(f); }} style={{
            padding:'5px 12px', border:'1px solid var(--b2)', borderRadius:999, fontSize:12, cursor:'pointer',
            background: selFab===f ? 'var(--y)' : 'var(--s2)', color: selFab===f ? '#000' : 'var(--tm)', fontFamily:'inherit', fontWeight:600,
          }}>{f}</button>
        ))}
      </div>

      {/* Entries table */}
      {loading && <div style={{ textAlign:'center', color:'var(--tm)', padding:'20px 0', fontSize:13 }}>Carregando...</div>}
      {!loading && filtered.length === 0 && (
        <div style={{ textAlign:'center', color:'var(--tm)', padding:'20px 0', fontSize:13 }}>
          Nenhum código cadastrado ainda. Adicione acima ou importe um JSON.
        </div>
      )}
      {!loading && filtered.length > 0 && (
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12.5 }}>
            <thead>
              <tr>{['Fabricante','Código','Descrição','Causa','Severidade',''].map(h => (
                <th key={h} style={{ textAlign:'left', padding:'8px 10px', background:'var(--s2)', color:'var(--tm)', fontSize:10.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', borderBottom:'1px solid var(--b1)', whiteSpace:'nowrap' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id}>
                  <td style={{ padding:'9px 10px', borderBottom:'1px solid var(--b1)', color:'var(--ts)' }}>{e.fabricante}</td>
                  <td style={{ padding:'9px 10px', borderBottom:'1px solid var(--b1)', fontFamily:'monospace', fontWeight:700, color:'var(--y)' }}>{e.code}</td>
                  <td style={{ padding:'9px 10px', borderBottom:'1px solid var(--b1)', maxWidth:200 }}>{e.description}</td>
                  <td style={{ padding:'9px 10px', borderBottom:'1px solid var(--b1)', color:'var(--tm)', maxWidth:180, fontSize:12 }}>{e.cause || '—'}</td>
                  <td style={{ padding:'9px 10px', borderBottom:'1px solid var(--b1)' }}>
                    <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:999,
                      background:`${SEVERITY_COLOR[e.severity]}18`, color:SEVERITY_COLOR[e.severity]||'var(--tm)' }}>
                      {e.severity}
                    </span>
                  </td>
                  <td style={{ padding:'9px 10px', borderBottom:'1px solid var(--b1)' }}>
                    <div style={{ display:'flex', gap:5 }}>
                      <button onClick={() => { setEditing(e.id); setFormKB(e); }} style={{ background:'none', border:'1px solid var(--b2)', color:'var(--tm)', cursor:'pointer', fontSize:11, padding:'3px 8px', borderRadius:5, fontFamily:'inherit' }}>✏️</button>
                      <button onClick={() => del(e.id)} style={{ background:'none', border:'1px solid rgba(239,68,68,.2)', color:'var(--re)', cursor:'pointer', fontSize:11, padding:'3px 8px', borderRadius:5, fontFamily:'inherit' }}>✕</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── JiraBoardsEditor — admin-only, per-board custom field mapping ──────────────
const CASE_SOURCES = [
  { value:'',             label:'— Não mapear —' },
  { value:'sn',           label:'S/N Série' },
  { value:'modelo',       label:'Modelo' },
  { value:'fabricante',   label:'Fabricante' },
  { value:'categoria',    label:'Categoria' },
  { value:'cliente_final',label:'Cliente Final' },
  { value:'integrador',   label:'Integrador' },
  { value:'tel_integrador',label:'Tel. Integrador' },
  { value:'contato',      label:'WhatsApp' },
  { value:'relato',       label:'Relato / Alarme' },
  { value:'drive_link',   label:'Link do Drive' },
  { value:'nome',         label:'Técnico' },
  { value:'adb_number',   label:'Protocolo' },
];

function JiraBoardsEditor({ boards, onChange }) {
  const [expanded, setExpanded]       = useState(null);
  // Add board wizard state
  const [wizFab, setWizFab]           = useState('');
  const [wizKey, setWizKey]           = useState('');
  const [wizType, setWizType]         = useState('Task');
  const [wizLoading, setWizLoading]   = useState(false);
  const [wizFields, setWizFields]     = useState(null); // null = not loaded
  const [wizError, setWizError]       = useState('');
  // Per-field mapping state (fieldId → caseSource)
  const [wizMapping, setWizMapping]   = useState({});

  const updateBoard = (i, patch) =>
    onChange(boards.map((b, idx) => idx === i ? { ...b, ...patch } : b));

  const removeBoard = (i) => {
    onChange(boards.filter((_, idx) => idx !== i));
    if (expanded === i) setExpanded(null);
  };

  async function loadFields() {
    if (!wizKey.trim()) return;
    setWizLoading(true);
    setWizError('');
    setWizFields(null);
    setWizMapping({});
    try {
      const data = await api(`/api/jira/project-fields/${wizKey.trim().toUpperCase()}`);
      setWizFields(data.fields || []);
      // Auto-suggest mappings based on field name keywords
      const auto = {};
      (data.fields || []).forEach(f => {
        const name = f.name.toLowerCase();
        if (name.includes('série') || name.includes('serie') || name.includes('serial') || name.includes('s/n')) auto[f.id] = 'sn';
        else if (name.includes('modelo') || name.includes('model'))          auto[f.id] = 'modelo';
        else if (name.includes('fabricante') || name.includes('brand'))      auto[f.id] = 'fabricante';
        else if (name.includes('cliente') || name.includes('client'))        auto[f.id] = 'cliente_final';
        else if (name.includes('integrador'))                                auto[f.id] = 'integrador';
        else if (name.includes('telefone') || name.includes('tel') || name.includes('phone') || name.includes('whatsapp')) auto[f.id] = 'tel_integrador';
        else if (name.includes('relato') || name.includes('alarm') || name.includes('descri') || name.includes('problem')) auto[f.id] = 'relato';
        else if (name.includes('drive') || name.includes('link') || name.includes('pasta')) auto[f.id] = 'drive_link';
        else if (name.includes('técnico') || name.includes('tecnico'))       auto[f.id] = 'nome';
        else if (name.includes('protocolo') || name.includes('adb'))         auto[f.id] = 'adb_number';
        else if (name.includes('categoria') || name.includes('categoria'))   auto[f.id] = 'categoria';
      });
      setWizMapping(auto);
    } catch (e) {
      setWizError('Erro ao carregar campos: ' + e.message);
    }
    setWizLoading(false);
  }

  function addBoard() {
    if (!wizFab.trim() || !wizKey.trim() || !wizFields) return;
    // Convert mapping to fields array (only mapped fields)
    const fields = wizFields
      .filter(f => wizMapping[f.id])
      .map(f => ({ label: f.name, jiraField: f.id, source: wizMapping[f.id] }));

    onChange([...boards, {
      fabricante: wizFab.trim(),
      project:    wizKey.trim().toUpperCase(),
      type:       wizType || 'Task',
      fields,
    }]);
    // Reset wizard
    setWizFab(''); setWizKey(''); setWizType('Task');
    setWizFields(null); setWizMapping({}); setWizError('');
    setExpanded(boards.length);
  }

  return (
    <Card style={{ padding:'20px', marginBottom:14 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
        <div style={{ fontSize:11, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.08em' }}>
          🔗 Jira — Boards por Fabricante
        </div>
        <span style={{ fontSize:11, background:'rgba(239,68,68,.1)', color:'var(--re)', padding:'2px 8px', borderRadius:999, fontWeight:600 }}>Admin only</span>
      </div>
      <div style={{ fontSize:12, color:'var(--tm)', marginBottom:18 }}>
        Digite o código do projeto e a app detecta os campos automaticamente. Sem digitar IDs manualmente.
      </div>

      {/* Existing boards */}
      {boards.map((b, i) => (
        <div key={i} style={{ marginBottom:8, border:'1px solid var(--b2)', borderRadius:'var(--rs)', overflow:'hidden' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', background:'var(--s2)', cursor:'pointer', userSelect:'none' }}
            onClick={() => setExpanded(expanded === i ? null : i)}>
            <div style={{ width:8, height:8, borderRadius:'50%', background:'var(--gr)', flexShrink:0 }} />
            <span style={{ fontSize:13, fontWeight:700, flex:1 }}>{b.fabricante}</span>
            <span style={{ fontSize:12, fontFamily:'monospace', color:'var(--y)', background:'rgba(255,215,0,.08)', padding:'3px 10px', borderRadius:999, fontWeight:700 }}>{b.project}</span>
            <span style={{ fontSize:11, color:'var(--ts)' }}>{b.type}</span>
            <span style={{ fontSize:11, color:'var(--tm)', background:'var(--s1)', padding:'2px 8px', borderRadius:999 }}>
              {(b.fields||[]).length} campo{(b.fields||[]).length !== 1 ? 's' : ''}
            </span>
            <span style={{ fontSize:11, color:'var(--tm)' }}>{expanded === i ? '▲' : '▼'}</span>
            <button onClick={e => { e.stopPropagation(); removeBoard(i); }}
              style={{ background:'none', border:'none', color:'var(--tm)', cursor:'pointer', fontSize:14, lineHeight:1, padding:'2px 5px', borderRadius:4 }}
              onMouseEnter={e => e.currentTarget.style.color='var(--re)'}
              onMouseLeave={e => e.currentTarget.style.color='var(--tm)'}
            >✕</button>
          </div>

          {expanded === i && (
            <div style={{ padding:'14px 16px' }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:14, paddingBottom:14, borderBottom:'1px solid var(--b1)' }}>
                <Field label="Fabricante" style={{ marginBottom:0 }}>
                  <input value={b.fabricante} onChange={e => updateBoard(i, { fabricante: e.target.value })} />
                </Field>
                <Field label="Chave do Projeto" style={{ marginBottom:0 }}>
                  <input value={b.project} onChange={e => updateBoard(i, { project: e.target.value })} style={{ fontFamily:'monospace', fontWeight:700 }} />
                </Field>
                <Field label="Tipo de Issue" style={{ marginBottom:0 }}>
                  <input value={b.type} onChange={e => updateBoard(i, { type: e.target.value })} />
                </Field>
              </div>
              <div style={{ fontSize:10, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:8 }}>
                Campos mapeados ({(b.fields||[]).length})
              </div>
              {(b.fields||[]).length === 0 ? (
                <div style={{ fontSize:12, color:'var(--ts)', fontStyle:'italic' }}>Sem campos — usando padrão do Jira</div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                  {(b.fields||[]).map((f, fi) => (
                    <div key={fi} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 10px', background:'var(--s2)', borderRadius:'var(--rs)' }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:12, fontWeight:600 }}>{f.label}</div>
                        <div style={{ fontSize:10.5, fontFamily:'monospace', color:'var(--y)' }}>{f.jiraField}</div>
                      </div>
                      <select value={f.source} onChange={e => {
                        const fields = (b.fields||[]).map((ff,ffi) => ffi===fi ? {...ff,source:e.target.value} : ff);
                        updateBoard(i, { fields });
                      }} style={{ fontSize:12, minWidth:160 }}>
                        {CASE_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                      <button onClick={() => updateBoard(i, { fields:(b.fields||[]).filter((_,ffi)=>ffi!==fi) })}
                        style={{ background:'none', border:'none', color:'var(--tm)', cursor:'pointer', fontSize:13, padding:'2px 5px' }}
                        onMouseEnter={e => e.currentTarget.style.color='var(--re)'}
                        onMouseLeave={e => e.currentTarget.style.color='var(--tm)'}
                      >✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* ── Add board wizard ── */}
      <div style={{ marginTop:14, padding:'16px', background:'var(--s2)', borderRadius:'var(--rs)', border:'1px solid var(--b1)' }}>
        <div style={{ fontSize:11, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:12 }}>
          + Adicionar Board
        </div>

        {/* Step 1 — Basic info + load */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap:8, alignItems:'flex-end', marginBottom:12 }}>
          <Field label="Fabricante *" style={{ marginBottom:0 }}>
            <input value={wizFab} onChange={e => setWizFab(e.target.value)} placeholder="Ex: Deye, FoxESS..." />
          </Field>
          <Field label="Código do Projeto Jira *" style={{ marginBottom:0 }}>
            <input value={wizKey} onChange={e => setWizKey(e.target.value.toUpperCase())}
              placeholder="Ex: KAN, GAB, BEL"
              style={{ fontFamily:'monospace', fontWeight:700, letterSpacing:'.05em' }}
              onKeyDown={e => e.key === 'Enter' && loadFields()} />
          </Field>
          <Field label="Tipo de Issue" style={{ marginBottom:0 }}>
            <input value={wizType} onChange={e => setWizType(e.target.value)} placeholder="Task" />
          </Field>
          <Btn variant="primary" style={{ padding:'9px 16px', whiteSpace:'nowrap' }}
            onClick={loadFields} disabled={wizLoading || !wizKey.trim()}>
            {wizLoading ? '⏳ Buscando...' : '🔍 Carregar Campos'}
          </Btn>
        </div>

        {wizError && (
          <div style={{ padding:'8px 12px', background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.2)', borderRadius:'var(--rs)', fontSize:12, color:'var(--re)', marginBottom:12 }}>
            {wizError}
          </div>
        )}

        {/* Step 2 — Field picker */}
        {wizFields && (
          <div>
            <div style={{ fontSize:12, color:'var(--gr)', fontWeight:600, marginBottom:12, display:'flex', alignItems:'center', gap:7 }}>
              <span>✓</span> {wizFields.length} campos encontrados no projeto {wizKey}
              <span style={{ fontSize:11, color:'var(--tm)', fontWeight:400 }}>— mapeie cada campo Jira ao dado do chamado correspondente</span>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, maxHeight:340, overflowY:'auto', marginBottom:14 }}>
              {wizFields.map(f => (
                <div key={f.id} style={{
                  display:'flex', alignItems:'center', gap:10, padding:'9px 12px',
                  background: wizMapping[f.id] ? 'rgba(34,197,94,.05)' : 'var(--s1)',
                  border: `1px solid ${wizMapping[f.id] ? 'rgba(34,197,94,.25)' : 'var(--b1)'}`,
                  borderRadius:'var(--rs)', transition:'all .15s',
                }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                      <span style={{ fontSize:12.5, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.name}</span>
                      {f.required && <span style={{ fontSize:9, background:'rgba(239,68,68,.12)', color:'var(--re)', padding:'1px 5px', borderRadius:999, fontWeight:700, flexShrink:0 }}>obrig.</span>}
                      {f.custom && <span style={{ fontSize:9, background:'rgba(255,215,0,.1)', color:'var(--y)', padding:'1px 5px', borderRadius:999, flexShrink:0 }}>custom</span>}
                    </div>
                    <div style={{ fontSize:10, fontFamily:'monospace', color:'var(--ts)', marginTop:2 }}>{f.id}</div>
                  </div>
                  <select
                    value={wizMapping[f.id] || ''}
                    onChange={e => setWizMapping(m => ({ ...m, [f.id]: e.target.value || undefined }))}
                    style={{ fontSize:11.5, minWidth:145, maxWidth:160, background: wizMapping[f.id] ? 'rgba(34,197,94,.08)' : 'var(--s2)' }}
                  >
                    {CASE_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              ))}
            </div>

            {/* Summary + confirm */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', paddingTop:12, borderTop:'1px solid var(--b1)' }}>
              <div style={{ fontSize:12, color:'var(--tm)' }}>
                {Object.values(wizMapping).filter(Boolean).length} campo{Object.values(wizMapping).filter(Boolean).length !== 1 ? 's' : ''} mapeado{Object.values(wizMapping).filter(Boolean).length !== 1 ? 's' : ''}
                {' '}·{' '}
                {wizFields.filter(f => f.required && !wizMapping[f.id]).length > 0
                  ? <span style={{ color:'var(--re)' }}>{wizFields.filter(f => f.required && !wizMapping[f.id]).length} obrigatório{wizFields.filter(f => f.required && !wizMapping[f.id]).length !== 1 ? 's' : ''} sem mapeamento</span>
                  : <span style={{ color:'var(--gr)' }}>todos os obrigatórios mapeados ✓</span>
                }
              </div>
              <Btn variant="primary" onClick={addBoard} disabled={!wizFab.trim() || !wizKey.trim()}>
                ✓ Salvar Board
              </Btn>
            </div>
          </div>
        )}

        {!wizFields && !wizLoading && (
          <div style={{ fontSize:12, color:'var(--ts)', fontStyle:'italic' }}>
            Digite o código do projeto e clique em "Carregar Campos" para ver os campos disponíveis no Jira.
          </div>
        )}
      </div>
    </Card>
  );
}

// ── ApprovalManager ───────────────────────────────────────────────────────────
function ApprovalManager({ user, showToast }) {
  const [approvals,    setApprovals]    = useState([]);
  const [requests,     setRequests]     = useState([]);
  const [newEmail,     setNewEmail]     = useState('');
  const [newRoleId,    setNewRoleId]    = useState('3');
  const [adding,       setAdding]       = useState(false);
  const [tab,          setTab]          = useState('pending'); // 'pending' | 'approved' | 'phone'
  const [phoneUsers,   setPhoneUsers]   = useState([]);
  const [resetId,      setResetId]      = useState(null);
  const [resetPw,      setResetPw]      = useState('');
  const [resetting,    setResetting]    = useState(false);

  const isMaster = user?.role === 'master';
  const isAdmin  = user?.role === 'admin' || isMaster;

  // Roles that this user can approve
  const approvableRoles = isMaster
    ? [{ id:2, label:'Admin' }, { id:3, label:'Técnico' }]
    : [{ id:3, label:'Técnico' }];

  const load = useCallback(async () => {
    const [appr, phoneU, reqs] = await Promise.all([
      api('/api/auth/approvals').catch(() => []),
      api('/api/phone-auth/admin/users').catch(() => []),
      api('/api/auth/access-requests').catch(() => []),
    ]);
    setApprovals(Array.isArray(appr) ? appr : []);
    setPhoneUsers(Array.isArray(phoneU) ? phoneU : []);
    setRequests(Array.isArray(reqs) ? reqs : []);
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  async function addApproval() {
    if (!newEmail.trim()) return;
    setAdding(true);
    try {
      await api('/api/auth/approvals', { method:'POST', body: JSON.stringify({ email: newEmail.trim(), role_id: Number(newRoleId) }) });
      showToast(`✅ ${newEmail} pré-aprovado como ${newRoleId==='2'?'Admin':'Técnico'}`);
      setNewEmail(''); load();
    } catch(e) { showToast('Erro: '+e.message, 'warn'); }
    setAdding(false);
  }

  async function removeApproval(id) {
    await api(`/api/auth/approvals/${id}`, { method:'DELETE' });
    showToast('Aprovação removida'); load();
  }

  async function reviewRequest(id, action, roleId) {
    await api(`/api/auth/access-requests/${id}`, {
      method: 'POST',
      body:   JSON.stringify({ action, role_id: roleId }),
    });
    showToast(action === 'approve' ? '✅ Acesso concedido!' : '❌ Acesso negado');
    load();
  }

  if (!isAdmin) return null;

  const ROLE_COLORS = { master:'var(--re)', admin:'var(--y)', technician:'var(--bl)', Técnico:'var(--bl)', Admin:'var(--y)' };

  return (
    <div style={{ background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--rs)', overflow:'hidden', marginTop:8 }}>
      {/* Header */}
      <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--b1)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <div style={{ fontSize:14, fontWeight:700, marginBottom:2 }}>🔑 Gerenciamento de Acesso</div>
          <div style={{ fontSize:12, color:'var(--tm)' }}>Pré-aprove emails e gerencie solicitações de acesso</div>
        </div>
        {requests.length > 0 && (
          <span style={{ fontSize:12, fontWeight:700, background:'rgba(239,68,68,.1)', color:'var(--re)', padding:'3px 10px', borderRadius:999, border:'1px solid rgba(239,68,68,.25)' }}>
            {requests.length} pendente{requests.length!==1?'s':''}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', borderBottom:'1px solid var(--b1)' }}>
        {[['pending','⏳ Solicitações'], ['approved','✅ Pré-aprovados'], ['phone','📱 Usuários Telefone']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding:'10px 20px', border:'none', background:'transparent', cursor:'pointer',
            fontFamily:'inherit', fontSize:13, fontWeight: tab===id ? 700 : 400,
            color: tab===id ? 'var(--tx)' : 'var(--tm)',
            borderBottom: tab===id ? '2px solid var(--y)' : '2px solid transparent',
            marginBottom:-1,
          }}>
            {label}
            {id==='pending' && requests.length>0 && (
              <span style={{ marginLeft:6, fontSize:10, background:'var(--re)', color:'#fff', padding:'1px 6px', borderRadius:999 }}>{requests.length}</span>
            )}
          </button>
        ))}
      </div>

      <div style={{ padding:'16px 20px' }}>

        {/* Pending access requests tab */}
        {tab === 'pending' && (
          <div>
            {requests.length === 0 ? (
              <div style={{ textAlign:'center', color:'var(--tm)', padding:'28px 0', fontSize:13 }}>
                Nenhuma solicitação pendente 🎉
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {requests.map(r => (
                  <div key={r.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', background:'var(--s2)', borderRadius:'var(--rs)', border:'1px solid var(--b2)' }}>
                    {r.picture
                      ? <img src={r.picture} style={{ width:36, height:36, borderRadius:'50%', flexShrink:0 }} alt="" />
                      : <div style={{ width:36, height:36, borderRadius:'50%', background:'var(--s1)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:700, flexShrink:0 }}>{(r.name||'?')[0]}</div>
                    }
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:700 }}>{r.name}</div>
                      <div style={{ fontSize:11.5, color:'var(--tm)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.email}</div>
                      <div style={{ fontSize:10.5, color:'var(--ts)', marginTop:2 }}>{new Date(r.requested_at).toLocaleString('pt-BR')}</div>
                    </div>
                    <div style={{ display:'flex', gap:6, alignItems:'center', flexShrink:0 }}>
                      <select defaultValue="3" id={`role-select-${r.id}`}
                        style={{ padding:'5px 8px', background:'var(--s1)', border:'1px solid var(--b2)', borderRadius:6, color:'var(--tx)', fontSize:12, cursor:'pointer' }}>
                        {approvableRoles.map(role => (
                          <option key={role.id} value={role.id}>{role.label}</option>
                        ))}
                      </select>
                      <button onClick={() => {
                        const sel = document.getElementById(`role-select-${r.id}`);
                        reviewRequest(r.id, 'approve', sel?.value || '3');
                      }} style={{ padding:'6px 14px', background:'rgba(34,197,94,.1)', border:'1px solid rgba(34,197,94,.25)', borderRadius:6, color:'var(--gr)', cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:'inherit' }}>
                        ✓ Aprovar
                      </button>
                      {isMaster && (
                        <button onClick={() => reviewRequest(r.id, 'deny', null)} style={{ padding:'6px 12px', background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.2)', borderRadius:6, color:'var(--re)', cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>
                          ✕ Negar
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Phone users tab */}
        {tab === 'phone' && (
          <div>
            <div style={{ fontSize:12, color:'var(--tm)', marginBottom:12 }}>
              Usuários cadastrados via login de telefone. Aprovação e gestão de senhas.
            </div>
            {phoneUsers.length === 0 && (
              <div style={{ textAlign:'center', color:'var(--tm)', padding:'40px 0', fontSize:13 }}>
                Nenhum usuário telefone cadastrado ainda.
              </div>
            )}
            {phoneUsers.map(u => (
              <div key={u.id} style={{ background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--rs)', padding:'14px 16px', marginBottom:8 }}>
                <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:4 }}>
                      <span style={{ fontWeight:700, fontSize:14 }}>{u.name}</span>
                      {!u.approved && <span style={{ fontSize:10, background:'rgba(251,146,60,.15)', color:'var(--or)', padding:'2px 8px', borderRadius:999, fontWeight:700 }}>Pendente</span>}
                      {u.approved && <span style={{ fontSize:10, background:'rgba(34,197,94,.15)', color:'var(--gr)', padding:'2px 8px', borderRadius:999, fontWeight:700 }}>✓ Aprovado</span>}
                      {u.temp_password && <span style={{ fontSize:10, background:'rgba(239,68,68,.15)', color:'var(--re)', padding:'2px 8px', borderRadius:999, fontWeight:700 }}>🔐 Senha Temp</span>}
                      {!u.phone_verified && <span style={{ fontSize:10, background:'rgba(107,114,128,.15)', color:'var(--tm)', padding:'2px 8px', borderRadius:999, fontWeight:700 }}>Sem verificação</span>}
                    </div>
                    <div style={{ fontSize:11, color:'var(--tm)', display:'flex', gap:12, flexWrap:'wrap' }}>
                      <span>📞 {u.phone}</span>
                      {u.email && <span>📧 {u.email}</span>}
                      <span>👤 {u.role_name}</span>
                      {u.last_login && <span>Último login: {new Date(u.last_login).toLocaleDateString('pt-BR')}</span>}
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:6, flexShrink:0, flexWrap:'wrap' }}>
                    {!u.approved && u.phone_verified && (
                      <>
                        <button onClick={() => approvePhoneUser(u.id, 'approve', 3)}
                          style={{ padding:'6px 12px', background:'rgba(34,197,94,.15)', color:'var(--gr)', border:'1px solid rgba(34,197,94,.3)', borderRadius:'var(--rs)', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
                          ✓ Aprovar
                        </button>
                        <button onClick={() => approvePhoneUser(u.id, 'reject')}
                          style={{ padding:'6px 12px', background:'rgba(239,68,68,.1)', color:'var(--re)', border:'1px solid rgba(239,68,68,.3)', borderRadius:'var(--rs)', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
                          ✕ Rejeitar
                        </button>
                      </>
                    )}
                    {u.approved && (
                      <button onClick={() => setResetId(resetId===u.id ? null : u.id)}
                        style={{ padding:'6px 12px', background:'rgba(96,165,250,.1)', color:'var(--bl)', border:'1px solid rgba(96,165,250,.3)', borderRadius:'var(--rs)', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
                        🔐 Redefinir Senha
                      </button>
                    )}
                  </div>
                </div>

                {/* Password reset form */}
                {resetId === u.id && (
                  <div style={{ marginTop:12, padding:'12px 14px', background:'var(--s2)', border:'1px solid var(--b2)', borderRadius:'var(--rs)' }}>
                    <div style={{ fontSize:12, color:'var(--or)', fontWeight:700, marginBottom:8 }}>
                      🔐 Definir senha temporária para {u.name.split(' ')[0]}
                    </div>
                    <div style={{ fontSize:11, color:'var(--tm)', marginBottom:8, lineHeight:1.5 }}>
                      A senha temporária será enviada ao usuário por WhatsApp. Ele precisará criar uma nova senha no próximo login.
                      <br/><b>Você não pode ver a senha atual — apenas substitui-la.</b>
                    </div>
                    <div style={{ display:'flex', gap:8 }}>
                      <input
                        type="text"
                        placeholder="Senha temporária (mín. 8 chars, letra + número)"
                        value={resetPw}
                        onChange={e => setResetPw(e.target.value)}
                        style={{ flex:1, background:'var(--s3)', border:'1px solid var(--b2)', color:'var(--tx)', borderRadius:'var(--rs)', padding:'8px 10px', fontSize:13, fontFamily:'inherit', outline:'none' }}
                      />
                      <button onClick={() => resetPhonePassword(u.id)} disabled={resetting}
                        style={{ padding:'8px 14px', background:'var(--or)', color:'#000', border:'none', borderRadius:'var(--rs)', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}>
                        {resetting ? '⟳' : '✓ Aplicar'}
                      </button>
                      <button onClick={() => { setResetId(null); setResetPw(''); }}
                        style={{ padding:'8px 10px', background:'var(--s3)', color:'var(--tm)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>
                        ✕
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Pre-approvals tab */}
        {tab === 'approved' && (
          <div>
            {/* Add new approval */}
            <div style={{ display:'flex', gap:8, marginBottom:16 }}>
              <input value={newEmail} onChange={e => setNewEmail(e.target.value)}
                placeholder="email@empresa.com"
                onKeyDown={e => e.key==='Enter' && addApproval()}
                style={{ flex:3 }} />
              <select value={newRoleId} onChange={e => setNewRoleId(e.target.value)}
                style={{ padding:'8px 12px', background:'var(--s1)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', color:'var(--tx)', fontSize:13, cursor:'pointer', maxWidth:100 }}>
                {approvableRoles.map(role => (
                  <option key={role.id} value={role.id}>{role.label}</option>
                ))}
              </select>
              <button onClick={addApproval} disabled={adding || !newEmail.trim()} style={{
                padding:'8px 18px', background:'var(--y)', color:'#000', border:'none',
                borderRadius:'var(--rs)', fontSize:13, fontWeight:700, cursor:'pointer',
                fontFamily:'inherit', opacity:(adding||!newEmail.trim())?.6:1,
              }}>
                {adding ? '⏳' : '+ Adicionar'}
              </button>
            </div>

            {/* List */}
            {approvals.length === 0 ? (
              <div style={{ textAlign:'center', color:'var(--tm)', padding:'20px 0', fontSize:13 }}>
                Nenhuma pré-aprovação ainda. Adicione emails acima.
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {approvals.map(a => (
                  <div key={a.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', background:'var(--s2)', borderRadius:'var(--rs)', border:'1px solid var(--b2)' }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{a.email}</div>
                      <div style={{ fontSize:11, color:'var(--ts)', marginTop:2 }}>
                        Aprovado em {new Date(a.approved_at).toLocaleDateString('pt-BR')}
                      </div>
                    </div>
                    <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:999,
                      background: (ROLE_COLORS[a.role]||'var(--tm)')+'18',
                      color: ROLE_COLORS[a.role]||'var(--tm)',
                      border:`1px solid ${ROLE_COLORS[a.role]||'var(--b2)'}33`,
                    }}>{a.role}</span>
                    {a.used && (
                      <span style={{ fontSize:10.5, color:'var(--gr)', background:'rgba(34,197,94,.1)', padding:'2px 7px', borderRadius:999 }}>✓ Usado</span>
                    )}
                    {isMaster && (
                      <button onClick={() => removeApproval(a.id)} style={{ background:'none', border:'none', color:'var(--ts)', cursor:'pointer', fontSize:14, padding:'2px', lineHeight:1 }}
                        onMouseEnter={e=>e.currentTarget.style.color='var(--re)'}
                        onMouseLeave={e=>e.currentTarget.style.color='var(--ts)'}
                      >✕</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Configuracoes ─────────────────────────────────────────────────────────────

// ── JanitorPanel — Auto archive old data to GitHub ──────────────────────────
function JanitorPanel({ showToast }) {
  const [settings, setSettings]   = useState(null);
  const [preview,  setPreview]    = useState(null);
  const [log,      setLog]        = useState([]);
  const [days,     setDays]       = useState(90);
  const [enabled,  setEnabled]    = useState(false);
  const [repo,     setRepo]       = useState('');
  const [token,    setToken]      = useState('');
  const [branch,   setBranch]     = useState('main');
  const [running,  setRunning]    = useState(false);
  const [section,  setSection]    = useState('settings'); // settings | preview | log

  const ALL_TABLES = ['chamados', 'reminders', 'contact_attempts', 'ai_requests', 'pending_curation'];
  const [tables, setTables] = useState(ALL_TABLES);

  useEffect(() => {
    api('/api/janitor/settings').then(s => {
      setSettings(s);
      setDays(s.days || 90);
      setEnabled(s.enabled || false);
      setRepo(s.githubRepo || '');
      setBranch(s.githubBranch || 'main');
      setTables(s.tables || ALL_TABLES);
    }).catch(() => {});
  }, []);

  async function saveSettings() {
    await api('/api/janitor/settings', {
      method:'PUT',
      body: JSON.stringify({ days, enabled, tables, githubRepo: repo, githubBranch: branch, ...(token ? { githubToken: token } : {}) }),
    }).catch(e => showToast('Erro: ' + e.message, 'warn'));
    showToast('✅ Configurações do Janitor salvas');
  }

  async function loadPreview() {
    setSection('preview');
    const p = await api('/api/janitor/preview?days=' + days).catch(() => null);
    setPreview(p);
  }

  async function loadLog() {
    setSection('log');
    const l = await api('/api/janitor/log').catch(() => []);
    setLog(l || []);
  }

  async function runDryRun() {
    setRunning(true);
    const r = await api('/api/janitor/run', { method:'POST', body: JSON.stringify({ dryRun: true, days, tables }) }).catch(e => ({ error: e.message }));
    setRunning(false);
    if (r?.error) { showToast('Erro: ' + r.error, 'warn'); return; }
    showToast('✅ Simulação concluída — ' + r.totalArchived + ' registros seriam arquivados');
    loadPreview();
  }

  async function runReal() {
    if (!confirm('Isso irá mover dados para o GitHub e deletar do Supabase. Confirma?')) return;
    setRunning(true);
    const r = await api('/api/janitor/run', { method:'POST', body: JSON.stringify({ dryRun: false, days, tables }) }).catch(e => ({ error: e.message }));
    setRunning(false);
    if (r?.error) { showToast('Erro: ' + r.error, 'warn'); return; }
    showToast('✅ Janitor concluído — ' + r.totalArchived + ' arquivados, ' + r.totalDeleted + ' deletados do Supabase');
    loadLog();
  }

  const TABLE_LABELS = { chamados:'Chamados', reminders:'Lembretes', contact_attempts:'Tentativas de Contato', ai_requests:'Logs de IA', pending_curation:'Curadoria Pendente' };

  return (
    <div style={{ background:'var(--s1)', border:'1px solid var(--b2)', borderRadius:'var(--r)', padding:'20px 24px', marginBottom:16 }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16 }}>
        <div style={{ width:38, height:38, borderRadius:11, background:'rgba(167,139,250,.15)', border:'1px solid rgba(167,139,250,.3)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>🧹</div>
        <div>
          <div style={{ fontWeight:700, color:'var(--tx)', fontSize:14 }}>Auto Janitor — Arquivamento de Dados</div>
          <div style={{ fontSize:11, color:'var(--tm)' }}>Move dados antigos do Supabase para o repositório GitHub · Acesso Master</div>
        </div>
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ fontSize:11, color: enabled ? 'var(--gr)' : 'var(--tm)' }}>{enabled ? '● Ativo' : '○ Inativo'}</span>
        </div>
      </div>

      {/* Tab switcher */}
      <div style={{ display:'flex', gap:2, marginBottom:16, background:'var(--s2)', borderRadius:8, padding:3, width:'fit-content' }}>
        {[['settings','⚙️ Config'], ['preview','👁️ Preview'], ['log','📋 Log']].map(([id, label]) => (
          <button key={id} onClick={() => { setSection(id); if (id==='preview') loadPreview(); if (id==='log') loadLog(); }}
            style={{ padding:'6px 14px', border:'none', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer',
              background: section===id ? 'var(--s3)' : 'transparent', color: section===id ? 'var(--tx)' : 'var(--tm)', fontFamily:'inherit' }}>
            {label}
          </button>
        ))}
      </div>

      {/* Settings */}
      {section === 'settings' && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div>
              <label style={{ fontSize:11, color:'var(--tm)', fontWeight:700, display:'block', marginBottom:4 }}>Arquivar dados com mais de (dias)</label>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <input type="number" min="7" max="3650" value={days} onChange={e => setDays(parseInt(e.target.value)||90)}
                  style={{ width:100, background:'var(--s2)', border:'1px solid var(--b2)', color:'var(--tx)', borderRadius:'var(--rs)', padding:'8px 10px', fontSize:14, fontFamily:'inherit', outline:'none' }} />
                <span style={{ fontSize:12, color:'var(--tm)' }}>dias sem atualização</span>
              </div>
            </div>
            <div>
              <label style={{ fontSize:11, color:'var(--tm)', fontWeight:700, display:'block', marginBottom:4 }}>Execução automática</label>
              <button onClick={() => setEnabled(v => !v)} style={{ padding:'8px 16px', background: enabled ? 'rgba(34,197,94,.15)' : 'var(--s2)',
                border:`1px solid ${enabled ? 'rgba(34,197,94,.3)' : 'var(--b2)'}`, borderRadius:'var(--rs)',
                color: enabled ? 'var(--gr)' : 'var(--tm)', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
                {enabled ? '✅ Ativado' : '⚪ Desativado'}
              </button>
            </div>
          </div>

          <div>
            <label style={{ fontSize:11, color:'var(--tm)', fontWeight:700, display:'block', marginBottom:6 }}>Tabelas a arquivar</label>
            <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
              {ALL_TABLES.map(t => (
                <button key={t} onClick={() => setTables(prev => prev.includes(t) ? prev.filter(x=>x!==t) : [...prev, t])}
                  style={{ padding:'4px 12px', border:`1px solid ${tables.includes(t) ? 'var(--pu)' : 'var(--b2)'}`,
                    background: tables.includes(t) ? 'rgba(167,139,250,.12)' : 'var(--s2)',
                    color: tables.includes(t) ? 'var(--pu)' : 'var(--tm)',
                    borderRadius:999, fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
                  {TABLE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          <div style={{ borderTop:'1px solid var(--b1)', paddingTop:14 }}>
            <label style={{ fontSize:11, color:'var(--tm)', fontWeight:700, display:'block', marginBottom:8 }}>🐙 GitHub Repositório de Arquivo</label>
            <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:8, marginBottom:8 }}>
              <div>
                <label style={{ fontSize:10, color:'var(--tm)', display:'block', marginBottom:3 }}>Repositório (owner/nome)</label>
                <input value={repo} onChange={e=>setRepo(e.target.value)} placeholder="seu-usuario/belenergy-archive"
                  style={{ width:'100%', background:'var(--s2)', border:'1px solid var(--b2)', color:'var(--tx)', borderRadius:'var(--rs)', padding:'8px 10px', fontSize:12, fontFamily:'inherit', outline:'none' }} />
              </div>
              <div>
                <label style={{ fontSize:10, color:'var(--tm)', display:'block', marginBottom:3 }}>Branch</label>
                <input value={branch} onChange={e=>setBranch(e.target.value)} placeholder="main"
                  style={{ width:'100%', background:'var(--s2)', border:'1px solid var(--b2)', color:'var(--tx)', borderRadius:'var(--rs)', padding:'8px 10px', fontSize:12, fontFamily:'inherit', outline:'none' }} />
              </div>
            </div>
            <div>
              <label style={{ fontSize:10, color:'var(--tm)', display:'block', marginBottom:3 }}>Token GitHub (ghp_xxxx) — {settings?.githubTokenSet ? '✅ já configurado' : '⚠️ não configurado'}</label>
              <input type="password" value={token} onChange={e=>setToken(e.target.value)} placeholder={settings?.githubTokenSet ? '(manter atual — deixe vazio)' : 'ghp_xxxxxxxxxxxxx'}
                style={{ width:'100%', background:'var(--s2)', border:'1px solid var(--b2)', color:'var(--tx)', borderRadius:'var(--rs)', padding:'8px 10px', fontSize:12, fontFamily:'inherit', outline:'none' }} />
              <div style={{ fontSize:10, color:'var(--tm)', marginTop:4 }}>Permissões necessárias: repo (write). Criar em github.com → Settings → Developer Settings → Personal Access Tokens</div>
            </div>
          </div>

          <div style={{ display:'flex', gap:8 }}>
            <button onClick={saveSettings} style={{ padding:'9px 18px', background:'var(--y)', color:'#000', border:'none', borderRadius:'var(--rs)', fontWeight:700, fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>
              💾 Salvar
            </button>
            <button onClick={runDryRun} disabled={running} style={{ padding:'9px 18px', background:'var(--s2)', border:'1px solid var(--b2)', color:'var(--ts)', borderRadius:'var(--rs)', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
              {running ? '⟳ Executando...' : '🔍 Simular (dry run)'}
            </button>
            <button onClick={runReal} disabled={running || !repo} style={{ padding:'9px 18px', background:'rgba(239,68,68,.15)', border:'1px solid rgba(239,68,68,.3)', color:'var(--re)', borderRadius:'var(--rs)', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit', marginLeft:'auto', opacity: (!repo || running) ? .5 : 1 }}>
              🧹 Executar Janitor
            </button>
          </div>
        </div>
      )}

      {/* Preview */}
      {section === 'preview' && (
        <div>
          {!preview ? <div style={{ color:'var(--tm)', fontSize:13 }}>Carregando preview...</div> : (
            <div>
              <div style={{ fontSize:12, color:'var(--tm)', marginBottom:12 }}>
                Registros com mais de <b style={{ color:'var(--y)' }}>{preview.days} dias</b> sem atualização (cutoff: {new Date(preview.cutoffDate).toLocaleDateString('pt-BR')}):
              </div>
              {Object.entries(preview.preview).map(([table, info]) => (
                <div key={table} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 12px', background:'var(--s2)', borderRadius:'var(--rs)', marginBottom:6 }}>
                  <span style={{ fontSize:13, color:'var(--ts)' }}>{info.label}</span>
                  <span style={{ fontWeight:700, color: info.count > 0 ? 'var(--or)' : 'var(--gr)', fontSize:14 }}>
                    {info.error ? '❌ ' + info.error : info.count + ' registros'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Log */}
      {section === 'log' && (
        <div style={{ maxHeight:300, overflowY:'auto' }}>
          {log.length === 0 ? <div style={{ color:'var(--tm)', fontSize:13 }}>Nenhuma execução registrada ainda.</div> : log.map(l => (
            <div key={l.id} style={{ padding:'8px 12px', background:'var(--s2)', borderRadius:'var(--rs)', marginBottom:6, fontSize:12 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                <span style={{ color:'var(--ts)', fontWeight:600 }}>{l.table_name}</span>
                <span style={{ color:'var(--tm)' }}>{new Date(l.run_at).toLocaleString('pt-BR')}</span>
              </div>
              <div style={{ color: l.status==='ok' ? 'var(--gr)' : 'var(--re)' }}>
                {l.dry_run ? '🔍 Simulação — ' : ''}
                {l.status==='ok' ? l.records_archived + ' arquivados, ' + l.records_deleted + ' deletados' : '❌ ' + l.error_msg}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Configuracoes({ showToast, user }) {
  const [cfg, setCfg]     = useState({});
  const [saved, setSaved] = useState('');
  const isAdmin = user?.role === 'master' || user?.role === 'admin';
  const isCloud = import.meta.env.VITE_CLOUD_MODE === 'true';

  useEffect(() => {
    api('/api/settings').then(d => setCfg(d)).catch(()=>{});
  }, []);

  const set = (k,v) => setCfg(c => ({...c, [k]:v}));
  const boards = cfg.jiraBoards || [];

  async function save() {
    try {
      await api('/api/settings', { method:'POST', body: JSON.stringify(cfg) });
      setSaved('✅ Salvo!');
      setTimeout(() => setSaved(''), 3000);
    } catch(e) { setSaved('❌ ' + e.message); }
  }

  async function runAuth() {
    try {
      const { url } = await api('/api/drive/auth-url');
      const win = window.open(url, '_blank', 'width=500,height=600');
      window.addEventListener('message', e => { if (e.data === 'google-auth-success') { showToast('✅ Drive autenticado!'); win?.close(); } }, { once:true });
    } catch(e) { showToast(e.message, 'warn'); }
  }

  const SettingCard = ({ title, children }) => (
    <Card style={{ padding:'20px' }}>
      <div style={{ fontSize:11, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:14 }}>{title}</div>
      {children}
    </Card>
  );

  return (
    <div style={{ padding:'28px 32px' }}>
      <h1 style={{ fontSize:26, fontWeight:800, letterSpacing:'-.025em', marginBottom:4 }}>⚙️ Configurações</h1>
      <p style={{ fontSize:13, color:'var(--tm)', marginBottom:20 }}>Configurações do sistema salvas na nuvem.</p>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(290px,1fr))', gap:14, marginBottom:14 }}>
        <SettingCard title="Google Drive">
          <Field label="ID da pasta mestre no Drive" hint="Abra a pasta no Drive. O ID está na URL após /folders/">
            <input value={cfg.driveId||''} onChange={e=>set('driveId',e.target.value)} placeholder="1abc...xyz" />
          </Field>
          <Field label="ID da pasta do Centro de Soluções" hint="Pasta para imagens e vídeos do Centro de Soluções. Deixe vazio para usar a pasta mestre.">
            <input value={cfg.solutionsDriveId||''} onChange={e=>set('solutionsDriveId',e.target.value)} placeholder="1abc...xyz (opcional)" />
          </Field>
          <Field label="ID da pasta de Manuais e Datasheets" hint="Pasta com PDFs indexados pelo AI Obs para busca semântica em manuais.">
            <input value={cfg.manualsDriveId||''} onChange={e=>set('manualsDriveId',e.target.value)} placeholder="1abc...xyz (opcional)" />
          </Field>
          <div style={{ fontSize:12, color: cfg.has_drive_auth ? 'var(--gr)' : 'var(--tm)', marginBottom:8 }}>
            {cfg.has_drive_auth ? '✅ Drive autenticado' : '⚠️ Drive não autenticado'}
          </div>
          <Btn variant="ghost" onClick={runAuth}>Autenticar Google Drive</Btn>
        </SettingCard>

        <SettingCard title="OCR / Tesseract">
          {isCloud && (
            <div style={{ padding:'10px 14px', background:'rgba(96,165,250,.07)', border:'1px solid rgba(96,165,250,.2)', borderRadius:8, marginBottom:12, fontSize:12, color:'var(--bl)' }}>
              ☁️ <strong>Modo Cloud</strong> — OCR e Tesseract rodam apenas na versão desktop local.
            </div>
          )}
          <Field label="Caminho do Tesseract">
            <input value={cfg.tesseractPath||''} onChange={e=>set('tesseractPath',e.target.value)} placeholder="Ex: Tesseract-OCR" disabled={isCloud} style={{opacity:isCloud?.4:1}} />
          </Field>
          <Field label="Caminho do Poppler">
            <input value={cfg.popplerPath||''} onChange={e=>set('popplerPath',e.target.value)} placeholder="Ex: poppler/bin" disabled={isCloud} style={{opacity:isCloud?.4:1}} />
          </Field>
        </SettingCard>

        <SettingCard title="IA / Ollama">
          {isCloud && (
            <div style={{ padding:'10px 14px', background:'rgba(96,165,250,.07)', border:'1px solid rgba(96,165,250,.2)', borderRadius:8, marginBottom:12, fontSize:12, color:'var(--bl)' }}>
              ☁️ <strong>Modo Cloud</strong> — Ollama roda apenas localmente na versão desktop.
            </div>
          )}
          <Field label="URL do Ollama">
            <input value={cfg.ollamaUrl||''} onChange={e=>set('ollamaUrl',e.target.value)} placeholder="http://localhost:11434" disabled={isCloud} style={{opacity:isCloud?.4:1}} />
          </Field>
          <Field label="Modelo de visão" hint="llava-phi3 (2.9GB) ou moondream (1.7GB)">
            <input value={cfg.ollamaModel||''} onChange={e=>set('ollamaModel',e.target.value)} placeholder="llava-phi3" disabled={isCloud} style={{opacity:isCloud?.4:1}} />
          </Field>
        </SettingCard>
      </div>

      <Card style={{ padding:'20px', marginBottom:14 }}>
        <div style={{ fontSize:11, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:14 }}>Jira — Credenciais</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))', gap:12 }}>
          <Field label="URL do Jira"><input value={cfg.jiraUrl||''} onChange={e=>set('jiraUrl',e.target.value)} placeholder="https://empresa.atlassian.net" /></Field>
          <Field label="Email Atlassian"><input value={cfg.jiraEmail||''} onChange={e=>set('jiraEmail',e.target.value)} placeholder="voce@empresa.com" /></Field>
          <Field label="API Token"><input type="password" value={cfg.jiraToken||''} onChange={e=>set('jiraToken',e.target.value)} placeholder="Token" /></Field>
          <Field label="Projeto Padrão" hint="Usado quando nenhum board específico bate">
            <input value={cfg.jiraProject||''} onChange={e=>set('jiraProject',e.target.value)} placeholder="BEL" />
          </Field>
          <Field label="Tipo de Issue Padrão"><input value={cfg.jiraType||''} onChange={e=>set('jiraType',e.target.value)} placeholder="Task" /></Field>
        </div>
      </Card>

      {isAdmin && (
        <JiraBoardsEditor boards={boards} onChange={v => set('jiraBoards', v)} />
      )}

      {isAdmin && <KnowledgeBaseEditor showToast={showToast} />}

      {/* User Approval Management — master and admin */}
      <ApprovalManager user={user} showToast={showToast} />

      {/* Janitor — master only */}
      {user?.role === 'master' && <JanitorPanel showToast={showToast} />}

      <div style={{ display:'flex', alignItems:'center', gap:14 }}>
        <Btn variant="primary" style={{ padding:'13px 40px' }} onClick={save}>Salvar Configurações</Btn>
        {saved && <span style={{ fontSize:13, color: saved.startsWith('✅') ? 'var(--gr)' : 'var(--re)' }}>{saved}</span>}
        <Btn variant="ghost" style={{ padding:'13px 20px', marginLeft:'auto' }} onClick={async () => {
          try {
            const res = await api('/api/sheets/export', { method:'POST' });
            if (res.url) window.open(res.url, '_blank');
          } catch(e) { showToast('Erro ao exportar: '+e.message, 'warn'); }
        }}>
          📊 Exportar para Google Sheets
        </Btn>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { Btn, Card, Field, StatusBadge, Avatar } from '../components/UI';

// Build client profiles from chamados data
function buildProfiles(cases) {
  const map = {};
  cases.forEach(c => {
    // Key by integrador name, fallback to cliente_final
    const name = c.integrador || c.cliente_final;
    if (!name) return;
    const key = name.trim().toLowerCase();
    if (!map[key]) {
      map[key] = {
        nome:      name.trim(),
        tipo:      c.integrador ? 'integrador' : 'cliente_final',
        telefone:  c.tel_integrador || c.contato || '',
        cases:     [],
        fabricantes: new Set(),
        lastCase:  null,
      };
    }
    map[key].cases.push(c);
    if (c.fabricante) map[key].fabricantes.add(c.fabricante);
    if (!map[key].telefone && (c.tel_integrador || c.contato))
      map[key].telefone = c.tel_integrador || c.contato;
    if (!map[key].lastCase || c.id > map[key].lastCase.id)
      map[key].lastCase = c;
  });

  return Object.values(map)
    .map(p => ({ ...p, fabricantes: [...p.fabricantes] }))
    .sort((a, b) => (b.lastCase?.id || 0) - (a.lastCase?.id || 0));
}

const STATUS_COLOR = {
  'Pendente Itens':  '#F59E0B',
  'Aguardando ADB':  'var(--bl)',
  'Concluído':       'var(--gr)',
};

export default function Clientes({ showToast }) {
  const [allCases, setAllCases]     = useState([]);
  const [profiles, setProfiles]     = useState([]);
  const [search, setSearch]         = useState('');
  const [tipoF, setTipoF]           = useState('');
  const [selected, setSelected]     = useState(null);
  const [loading, setLoading]       = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    // Pull all cases from stats (all users, all statuses)
    const data = await api('/api/cases/stats').catch(() => []);
    setAllCases(data);
    setProfiles(buildProfiles(data));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Recompute profiles when filters change
  const filtered = profiles.filter(p => {
    const matchSearch = !search || p.nome.toLowerCase().includes(search.toLowerCase()) ||
      p.telefone?.includes(search);
    const matchTipo = !tipoF || p.tipo === tipoF;
    return matchSearch && matchTipo;
  });

  function selectProfile(p) {
    setSelected(p);
  }

  // Stats for selected profile
  const stats = selected ? {
    total:    selected.cases.length,
    pending:  selected.cases.filter(c => c.status === 'Pendente Itens').length,
    adb:      selected.cases.filter(c => c.status === 'Aguardando ADB').length,
    done:     selected.cases.filter(c => c.status === 'Concluído').length,
  } : null;

  return (
    <div style={{ padding:'28px 32px' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:26, fontWeight:800, letterSpacing:'-.025em', marginBottom:4 }}>
            👥 Clientes
          </h1>
          <p style={{ fontSize:13, color:'var(--tm)' }}>
            Perfis gerados automaticamente a partir dos protocolos registrados.
          </p>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <span style={{ fontSize:12, color:'var(--tm)' }}>{profiles.length} clientes · {allCases.length} protocolos</span>
          <Btn variant="ghost" onClick={load} style={{ fontSize:12 }}>🔄</Btn>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'300px 1fr', gap:16, alignItems:'start' }}>

        {/* Left — client list */}
        <div>
          <div style={{ display:'flex', gap:6, marginBottom:10 }}>
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="🔍 Buscar cliente..." style={{ flex:1 }} />
            <select value={tipoF} onChange={e=>setTipoF(e.target.value)} style={{ width:130 }}>
              <option value="">Todos</option>
              <option value="integrador">Integrador</option>
              <option value="cliente_final">Cliente Final</option>
            </select>
          </div>

          {loading && <div style={{ textAlign:'center', color:'var(--tm)', padding:'40px 0', fontSize:13 }}>Carregando...</div>}

          <div style={{ display:'flex', flexDirection:'column', gap:5, maxHeight:'72vh', overflowY:'auto' }}>
            {!loading && filtered.length === 0 && (
              <div style={{ textAlign:'center', color:'var(--tm)', padding:'40px 0', fontSize:13 }}>
                Nenhum cliente encontrado.<br/>
                <span style={{ fontSize:11.5 }}>Os perfis aparecem conforme protocolos são registrados.</span>
              </div>
            )}
            {filtered.map((p, i) => {
              const isSelected = selected?.nome === p.nome;
              const openCount  = p.cases.filter(c => c.status !== 'Concluído').length;
              return (
                <div key={i} onClick={() => selectProfile(p)} style={{
                  padding:'11px 13px',
                  background: isSelected ? 'rgba(255,215,0,.07)' : 'var(--s1)',
                  border: `1px solid ${isSelected ? 'rgba(255,215,0,.3)' : 'var(--b1)'}`,
                  borderRadius:'var(--rs)', cursor:'pointer', transition:'all .12s',
                }}>
                  <div style={{ display:'flex', alignItems:'center', gap:9 }}>
                    <Avatar name={p.nome} size={32} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {p.nome}
                      </div>
                      <div style={{ fontSize:11, color:'var(--tm)', marginTop:2, display:'flex', gap:8, alignItems:'center' }}>
                        <span>{p.tipo === 'integrador' ? '🔧' : '👤'}</span>
                        <span>{p.cases.length} protocolo{p.cases.length !== 1 ? 's' : ''}</span>
                        {openCount > 0 && (
                          <span style={{ background:'rgba(245,158,11,.1)', color:'#F59E0B', padding:'0 5px', borderRadius:999, fontSize:10, fontWeight:700 }}>
                            {openCount} aberto{openCount !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    {p.telefone && (
                      <div style={{ fontSize:10.5, color:'var(--tm)', textAlign:'right', flexShrink:0 }}>
                        {p.telefone}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right — profile detail */}
        <div>
          {!selected && !loading && (
            <div style={{ textAlign:'center', color:'var(--tm)', padding:'80px 0', fontSize:13 }}>
              Selecione um cliente para ver o histórico completo
            </div>
          )}

          {selected && (
            <div>
              {/* Profile header */}
              <Card style={{ padding:'20px', marginBottom:12 }}>
                <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:16 }}>
                  <Avatar name={selected.nome} size={52} />
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:22, fontWeight:800 }}>{selected.nome}</div>
                    <div style={{ fontSize:12, color:'var(--tm)', marginTop:4, display:'flex', gap:12, flexWrap:'wrap' }}>
                      <span>{selected.tipo === 'integrador' ? '🔧 Integrador' : '👤 Cliente Final'}</span>
                      {selected.telefone && <span>📞 {selected.telefone}</span>}
                      {selected.fabricantes.length > 0 && (
                        <span>⚡ {selected.fabricantes.join(', ')}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Stat strip */}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, paddingTop:14, borderTop:'1px solid var(--b1)' }}>
                  {[
                    { label:'Total', value: stats.total,   color:'var(--y)' },
                    { label:'Pendentes', value: stats.pending, color:'#F59E0B' },
                    { label:'Protocolo', value: stats.adb,    color:'var(--bl)' },
                    { label:'Concluídos', value: stats.done,  color:'var(--gr)' },
                  ].map(s => (
                    <div key={s.label} style={{ textAlign:'center' }}>
                      <div style={{ fontSize:24, fontWeight:800, color:s.color }}>{s.value}</div>
                      <div style={{ fontSize:11, color:'var(--tm)', marginTop:2 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Protocols list */}
              <Card style={{ padding:'0' }}>
                <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--b1)', fontSize:12, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.07em' }}>
                  Histórico de Protocolos
                </div>
                {selected.cases.length === 0 && (
                  <div style={{ padding:'28px', textAlign:'center', color:'var(--tm)', fontSize:13 }}>Nenhum protocolo</div>
                )}
                {[...selected.cases]
                  .sort((a,b) => (b.id||0) - (a.id||0))
                  .map(c => (
                  <div key={c.id} style={{
                    display:'flex', alignItems:'center', gap:14,
                    padding:'13px 18px', borderBottom:'1px solid var(--b1)',
                    transition:'background .1s',
                  }}
                    onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,.02)'}
                    onMouseLeave={e => e.currentTarget.style.background='transparent'}
                  >
                    {/* Date */}
                    <div style={{ fontSize:11, color:'var(--tm)', textAlign:'right', minWidth:52, lineHeight:1.7 }}>
                      <div>{c.data}</div>
                      <div>{c.hora?.slice(0,5)}</div>
                    </div>

                    {/* Info */}
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:600, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                        <span style={{ fontFamily:'monospace', color:'var(--ts)' }}>{c.sn || '—'}</span>
                        {c.fabricante && <span style={{ fontSize:11, color:'var(--tm)' }}>{c.fabricante}</span>}
                        {c.modelo && <span style={{ fontSize:11, color:'var(--tm)' }}>{c.modelo}</span>}
                      </div>
                      {c.relato && (
                        <div style={{ fontSize:11.5, color:'var(--tm)', marginTop:3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {c.relato}
                        </div>
                      )}
                      {(c.jira_key || c.adb_number) && (
                        <div style={{ marginTop:4, display:'flex', gap:6 }}>
                          {c.jira_key && <span style={{ fontSize:10.5, background:'rgba(96,165,250,.08)', color:'var(--bl)', padding:'1px 7px', borderRadius:999, fontWeight:700, border:'1px solid rgba(96,165,250,.2)' }}>🔗 {c.jira_key}</span>}
                          {c.adb_number && c.adb_number !== c.jira_key && <span style={{ fontSize:10.5, background:'rgba(34,197,94,.08)', color:'var(--gr)', padding:'1px 7px', borderRadius:999, fontWeight:700 }}>#{c.adb_number}</span>}
                        </div>
                      )}
                    </div>

                    {/* Status + PDF */}
                    <div style={{ display:'flex', gap:6, alignItems:'center', flexShrink:0 }}>
                      <StatusBadge status={c.status} />
                      <a href={`/api/reports/case/${c.id}?token=${localStorage.getItem('session_token')}`}
                        target="_blank" rel="noreferrer"
                        style={{ fontSize:13, color:'var(--tm)', textDecoration:'none', padding:'3px 6px', borderRadius:4, border:'1px solid var(--b2)' }}
                        title="PDF">📄</a>
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

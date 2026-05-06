import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { Btn, Card, Field, StatusBadge } from '../components/UI';

export default function Equipamentos({ showToast }) {
  const [equipment, setEquipment] = useState([]);
  const [warranty, setWarranty]   = useState([]);
  const [search, setSearch]       = useState('');
  const [selected, setSelected]   = useState(null);
  const [editing, setEditing]     = useState(null);
  const [tab, setTab]             = useState('equipment'); // equipment | warranty
  const [loading, setLoading]     = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    const data = await api(`/api/equipment?${params}`).catch(() => []);
    setEquipment(data);
  }, [search]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (tab === 'warranty') {
      api('/api/reports/warranty').then(setWarranty).catch(() => {});
    }
  }, [tab]);

  async function loadDetail(id) {
    setLoading(true);
    const data = await api(`/api/equipment/${id}`).catch(() => null);
    setSelected(data);
    setLoading(false);
  }

  async function save() {
    try {
      if (editing.id) {
        await api(`/api/equipment/${editing.id}`, { method:'PUT', body: JSON.stringify(editing) });
      } else {
        await api('/api/equipment', { method:'POST', body: JSON.stringify(editing) });
      }
      showToast('✅ Salvo!');
      setEditing(null);
      load();
      if (selected?.id) loadDetail(selected.id);
    } catch(e) { showToast('❌ ' + e.message, 'warn'); }
  }

  const warrantyColor = (status) => ({
    active:        'var(--gr)',
    expiring_soon: '#F59E0B',
    expired:       'var(--re)',
    unknown:       'var(--tm)',
  }[status] || 'var(--tm)');

  const warrantyLabel = (status, days) => ({
    active:        `✅ ${days}d restantes`,
    expiring_soon: `⚠️ Expira em ${days}d`,
    expired:       `❌ Expirada há ${Math.abs(days)}d`,
    unknown:       '—',
  }[status] || '—');

  const TABS = [
    { id:'equipment', label:'🔧 Equipamentos' },
    { id:'warranty',  label:'📅 Garantias' },
  ];

  return (
    <div style={{ padding:'28px 32px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:26, fontWeight:800, letterSpacing:'-.025em', marginBottom:4 }}>🔧 Equipamentos</h1>
          <p style={{ fontSize:13, color:'var(--tm)' }}>Histórico de equipamentos por número de série e controle de garantias.</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:4, background:'var(--s1)', border:'1px solid var(--b1)', borderRadius:'var(--rs)', padding:4, marginBottom:16, width:'fit-content' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            padding:'8px 18px', border:'none', borderRadius:7, cursor:'pointer',
            background: tab===t.id ? 'var(--s2)' : 'transparent',
            color: tab===t.id ? 'var(--tx)' : 'var(--tm)',
            fontSize:12.5, fontWeight:600, fontFamily:'inherit',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Equipment tab */}
      {tab === 'equipment' && (
        <div style={{ display:'grid', gridTemplateColumns:'320px 1fr', gap:16, alignItems:'start' }}>
          <div>
            <div style={{ display:'flex', gap:6, marginBottom:10 }}>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 S/N, modelo, fabricante..." style={{ flex:1 }} />
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:5, maxHeight:'70vh', overflowY:'auto' }}>
              {equipment.length === 0 && <div style={{ textAlign:'center', color:'var(--tm)', padding:'40px 0', fontSize:13 }}>Nenhum equipamento encontrado</div>}
              {equipment.map(eq => (
                <div key={eq.id} onClick={() => { setEditing(null); loadDetail(eq.id); }}
                  style={{
                    padding:'11px 14px',
                    background: selected?.id===eq.id ? 'rgba(96,165,250,.07)' : 'var(--s1)',
                    border: `1px solid ${selected?.id===eq.id ? 'rgba(96,165,250,.3)' : 'var(--b1)'}`,
                    borderRadius:'var(--rs)', cursor:'pointer', transition:'all .12s',
                  }}>
                  <div style={{ fontSize:13, fontWeight:700, fontFamily:'monospace', color:'var(--bl)' }}>{eq.sn}</div>
                  <div style={{ fontSize:11.5, color:'var(--tm)', marginTop:3 }}>{eq.fabricante} · {eq.modelo || '—'}</div>
                  {eq.client && <div style={{ fontSize:11, color:'var(--ts)', marginTop:2 }}>👤 {eq.client.nome}</div>}
                </div>
              ))}
            </div>
          </div>

          <div>
            {loading && <div style={{ textAlign:'center', color:'var(--tm)', padding:'60px 0' }}>Carregando...</div>}

            {editing && (
              <Card style={{ padding:'20px' }}>
                <div style={{ fontSize:14, fontWeight:700, marginBottom:16 }}>✏️ Editar Equipamento</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  <Field label="S/N *"><input value={editing.sn||''} onChange={e=>setEditing(f=>({...f,sn:e.target.value}))} style={{ fontFamily:'monospace' }} /></Field>
                  <Field label="Modelo"><input value={editing.modelo||''} onChange={e=>setEditing(f=>({...f,modelo:e.target.value}))} /></Field>
                  <Field label="Fabricante"><input value={editing.fabricante||''} onChange={e=>setEditing(f=>({...f,fabricante:e.target.value}))} /></Field>
                  <Field label="Categoria"><input value={editing.categoria||''} onChange={e=>setEditing(f=>({...f,categoria:e.target.value}))} /></Field>
                  <Field label="Data de Compra"><input type="date" value={editing.data_compra||''} onChange={e=>setEditing(f=>({...f,data_compra:e.target.value}))} /></Field>
                  <Field label="Data de Instalação"><input type="date" value={editing.data_instalacao||''} onChange={e=>setEditing(f=>({...f,data_instalacao:e.target.value}))} /></Field>
                  <Field label="Garantia (meses)"><input type="number" value={editing.garantia_meses||12} onChange={e=>setEditing(f=>({...f,garantia_meses:Number(e.target.value)}))} /></Field>
                  <Field label="Observações" style={{ gridColumn:'1/-1' }}><textarea value={editing.observacoes||''} onChange={e=>setEditing(f=>({...f,observacoes:e.target.value}))} rows={3} /></Field>
                </div>
                <div style={{ display:'flex', gap:8, marginTop:14 }}>
                  <Btn variant="primary" onClick={save}>Salvar</Btn>
                  <Btn variant="ghost" onClick={() => setEditing(null)}>Cancelar</Btn>
                </div>
              </Card>
            )}

            {selected && !editing && !loading && (
              <div>
                <Card style={{ padding:'20px', marginBottom:12 }}>
                  <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:16 }}>
                    <div>
                      <div style={{ fontSize:20, fontWeight:800, fontFamily:'monospace', color:'var(--bl)' }}>{selected.sn}</div>
                      <div style={{ fontSize:13, color:'var(--tm)', marginTop:4 }}>{selected.fabricante} · {selected.modelo}</div>
                      {selected.client && <div style={{ fontSize:12, color:'var(--ts)', marginTop:4 }}>👤 {selected.client.nome}</div>}
                    </div>
                    <div style={{ display:'flex', gap:6 }}>
                      <Btn variant="ghost" onClick={() => setEditing(selected)}>✏️ Editar</Btn>
                    </div>
                  </div>

                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
                    {[
                      ['Categoria', selected.categoria],
                      ['Data Compra', selected.data_compra],
                      ['Data Instalação', selected.data_instalacao],
                    ].filter(([,v])=>v).map(([l,v]) => (
                      <div key={l}>
                        <div style={{ fontSize:10.5, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:3 }}>{l}</div>
                        <div style={{ fontSize:13 }}>{v}</div>
                      </div>
                    ))}
                    <div>
                      <div style={{ fontSize:10.5, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:3 }}>Garantia</div>
                      <div style={{ fontSize:13, color: warrantyColor(selected.warrantyStatus), fontWeight:600 }}>
                        {warrantyLabel(selected.warrantyStatus, selected.daysLeft)}
                      </div>
                    </div>
                  </div>
                </Card>

                {/* Case history */}
                <Card style={{ padding:'16px 20px' }}>
                  <div style={{ fontSize:12, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:12 }}>
                    Histórico de Chamados ({(selected.cases||[]).length})
                  </div>
                  {(selected.cases||[]).length === 0 && (
                    <div style={{ color:'var(--tm)', fontSize:13, textAlign:'center', padding:'20px 0' }}>Nenhum chamado registrado para este S/N</div>
                  )}
                  {(selected.cases||[]).map(c => (
                    <div key={c.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'9px 0', borderBottom:'1px solid var(--b1)' }}>
                      <div style={{ fontSize:11, color:'var(--tm)', minWidth:52 }}>{c.data}</div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:600 }}>{c.integrador || c.cliente_final || c.nome}</div>
                        <div style={{ fontSize:11, color:'var(--tm)', marginTop:2 }}>{c.relato?.slice(0,70) || '—'}</div>
                      </div>
                      <StatusBadge status={c.status} />
                    </div>
                  ))}
                </Card>
              </div>
            )}

            {!selected && !editing && !loading && (
              <div style={{ textAlign:'center', color:'var(--tm)', padding:'80px 0', fontSize:13 }}>
                Selecione um equipamento para ver o histórico
              </div>
            )}
          </div>
        </div>
      )}

      {/* Warranty tab */}
      {tab === 'warranty' && (
        <Card>
          <div style={{ padding:'14px 16px', borderBottom:'1px solid var(--b1)', fontSize:13, fontWeight:700 }}>
            Controle de Garantias
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr>{['S/N','Fabricante','Modelo','Cliente','Compra','Fim da Garantia','Status'].map(h => (
                  <th key={h} style={{ textAlign:'left', padding:'10px 14px', background:'var(--s2)', color:'var(--tm)', fontSize:10.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', borderBottom:'1px solid var(--b1)' }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {warranty.length === 0 && (
                  <tr><td colSpan={7} style={{ padding:'40px', textAlign:'center', color:'var(--tm)' }}>
                    Nenhum equipamento com data de compra registrada
                  </td></tr>
                )}
                {warranty.map(eq => (
                  <tr key={eq.id}>
                    <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--b1)', fontFamily:'monospace', fontSize:12, color:'var(--bl)' }}>{eq.sn}</td>
                    <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--b1)' }}>{eq.fabricante}</td>
                    <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--b1)', color:'var(--tm)' }}>{eq.modelo}</td>
                    <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--b1)', color:'var(--ts)' }}>{eq.client?.nome || '—'}</td>
                    <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--b1)', color:'var(--tm)' }}>{eq.data_compra}</td>
                    <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--b1)', color:'var(--tm)' }}>{eq.warrantyEnd}</td>
                    <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--b1)' }}>
                      <span style={{ fontSize:11.5, fontWeight:700, padding:'3px 10px', borderRadius:999,
                        background: eq.warrantyStatus==='active' ? 'rgba(34,197,94,.1)' : eq.warrantyStatus==='expiring_soon' ? 'rgba(245,158,11,.1)' : 'rgba(239,68,68,.1)',
                        color: warrantyColor(eq.warrantyStatus),
                      }}>
                        {warrantyLabel(eq.warrantyStatus, eq.daysLeft)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

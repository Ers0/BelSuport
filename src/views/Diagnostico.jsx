import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { Card, Btn } from '../components/UI';

// Simple markdown-ish renderer for AI response
function AIText({ text }) {
  if (!text) return null;
  const lines = text.split('\n');
  return (
    <div style={{ fontSize:12.5, color:'var(--ts)', lineHeight:1.7 }}>
      {lines.map((line, i) => {
        if (line.startsWith('**') && line.endsWith('**'))
          return <div key={i} style={{ fontWeight:700, color:'var(--tx)', marginTop:10 }}>{line.replace(/\*\*/g,'')}</div>;
        if (/^\d+\.\s/.test(line))
          return <div key={i} style={{ marginLeft:12, marginTop:3 }}>{line}</div>;
        if (line.startsWith('- '))
          return <div key={i} style={{ marginLeft:12, marginTop:3 }}>• {line.slice(2)}</div>;
        if (line.trim() === '') return <div key={i} style={{ height:6 }} />;
        return <div key={i}>{line}</div>;
      })}
    </div>
  );
}

function ClusterBar({ cluster, maxCount }) {
  const pct = Math.round((cluster.count / maxCount) * 100);
  return (
    <div style={{ marginBottom:14 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:5 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <span style={{ fontSize:13, fontWeight:600, color:'var(--tx)' }}>{cluster.label}</span>
          {cluster.keywords.length > 0 && (
            <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginTop:3 }}>
              {cluster.keywords.map(kw => (
                <span key={kw} style={{ fontSize:10, background:'rgba(255,215,0,.08)', color:'var(--y)', padding:'1px 7px', borderRadius:999, fontWeight:600 }}>{kw}</span>
              ))}
            </div>
          )}
        </div>
        <div style={{ textAlign:'right', marginLeft:14, flexShrink:0 }}>
          <div style={{ fontSize:15, fontWeight:800, color:'var(--y)' }}>{cluster.count}</div>
          <div style={{ fontSize:10.5, color:'var(--tm)' }}>{cluster.pct}%</div>
        </div>
      </div>
      <div style={{ height:5, background:'var(--s2)', borderRadius:999, overflow:'hidden' }}>
        <div style={{
          height:'100%', borderRadius:999,
          background:'linear-gradient(90deg, var(--y), var(--y2))',
          width:`${pct}%`, transition:'width 1s cubic-bezier(.4,0,.2,1)',
        }} />
      </div>
      {cluster.sampleRelatos?.length > 0 && (
        <div style={{ marginTop:6, padding:'6px 10px', background:'var(--s2)', borderRadius:'var(--rs)' }}>
          <div style={{ fontSize:10, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4 }}>Exemplos de relatos</div>
          {cluster.sampleRelatos.map((r, i) => (
            <div key={i} style={{ fontSize:11.5, color:'var(--ts)', marginTop:2 }}>"{r}{r.length >= 120 ? '...' : ''}"</div>
          ))}
        </div>
      )}
    </div>
  );
}

function BrandCard({ brand, rank }) {
  const [expanded, setExpanded]   = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState(null);
  const [aiError, setAiError]     = useState(null);

  const maxCount = brand.clusters[0]?.count || 1;

  const medals = ['🥇','🥈','🥉'];
  const rankIcon = medals[rank] || `${rank + 1}.`;

  async function runAI() {
    setAiLoading(true); setAiError(null);
    try {
      const res = await api('/api/analysis/ai-summary', {
        method: 'POST',
        body: JSON.stringify({
          fabricante: brand.fabricante,
          clusters:   brand.clusters.filter(c => c.label !== 'Outros'),
          total:      brand.total,
        }),
      });
      setAiSummary({ text: res.summary, kbCount: res.knowledgeCount || 0 });
    } catch(e) { setAiError(e.message); }
    setAiLoading(false);
  }

  return (
    <Card style={{ marginBottom:12, overflow:'hidden' }}>
      {/* Brand header */}
      <div style={{
        display:'flex', alignItems:'center', gap:12, padding:'14px 18px',
        cursor:'pointer', userSelect:'none', borderBottom: expanded ? '1px solid var(--b1)' : 'none',
      }} onClick={() => setExpanded(v => !v)}>
        <span style={{ fontSize:18 }}>{rankIcon}</span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:15, fontWeight:800 }}>{brand.fabricante}</div>
          <div style={{ fontSize:12, color:'var(--tm)', marginTop:2 }}>
            {brand.total} chamados · {brand.clusters.length} padrões identificados
          </div>
        </div>
        {/* Mini bar preview */}
        <div style={{ display:'flex', gap:3, alignItems:'flex-end', height:28 }}>
          {brand.clusters.slice(0,5).map((cl, i) => (
            <div key={i} style={{
              width:8, borderRadius:3,
              height: `${Math.round((cl.count/maxCount)*100)*0.28}px`,
              background:`rgba(255,215,0,${1 - i*0.15})`,
              minHeight:3,
            }} />
          ))}
        </div>
        <div style={{ fontSize:13, color:'var(--tm)', marginLeft:4 }}>{expanded ? '▲' : '▼'}</div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div style={{ padding:'16px 18px' }}>
          {/* Cluster bars */}
          <div style={{ marginBottom:16 }}>
            {brand.clusters.map((cl, i) => (
              <ClusterBar key={i} cluster={cl} maxCount={maxCount} />
            ))}
          </div>

          {/* AI Analysis */}
          <div style={{ borderTop:'1px solid var(--b1)', paddingTop:14 }}>
            {!aiSummary && !aiLoading && (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:'var(--tx)' }}>Análise com IA</div>
                  <div style={{ fontSize:11.5, color:'var(--tm)', marginTop:2 }}>
                    Claude analisa os padrões e sugere causa raiz + checklist de diagnóstico
                  </div>
                </div>
                <Btn variant="primary" style={{ fontSize:12, padding:'8px 16px', flexShrink:0 }} onClick={runAI}>
                  ✨ Analisar
                </Btn>
              </div>
            )}

            {aiLoading && (
              <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 0' }}>
                <div style={{ width:20, height:20, border:'2px solid var(--b2)', borderTopColor:'var(--y)', borderRadius:'50%', animation:'spin .7s linear infinite' }} />
                <span style={{ fontSize:13, color:'var(--tm)' }}>Claude está analisando os padrões...</span>
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              </div>
            )}

            {aiError && (
              <div style={{ fontSize:12, color:'var(--re)', padding:'8px 0' }}>
                ❌ {aiError}
                {aiError.includes('GROQ_API_KEY') && (
                  <div style={{ marginTop:4, color:'var(--tm)' }}>Adicione GROQ_API_KEY ao seu .env — grátis em console.groq.com</div>
                )}
              </div>
            )}

            {aiSummary && (
              <div>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <div style={{ fontSize:12, fontWeight:700, color:'var(--y)' }}>✨ Análise Groq AI</div>
                    {aiSummary.kbCount > 0 && (
                      <span style={{ fontSize:10.5, background:'rgba(34,197,94,.1)', color:'var(--gr)', padding:'1px 8px', borderRadius:999, fontWeight:600 }}>
                        {aiSummary.kbCount} códigos da base de conhecimento
                      </span>
                    )}
                  </div>
                  <button onClick={() => setAiSummary(null)} style={{ background:'none', border:'none', color:'var(--tm)', cursor:'pointer', fontSize:12 }}>
                    Refazer
                  </button>
                </div>
                <div style={{ background:'var(--s2)', borderRadius:'var(--rs)', padding:'12px 14px' }}>
                  <AIText text={aiSummary.text} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

export default function Diagnostico({ showToast }) {
  const [data, setData]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastRun, setLastRun] = useState(null);

  const load = async () => {
    setLoading(true);
    const results = await api('/api/analysis').catch(() => []);
    setData(results);
    setLastRun(new Date().toLocaleString('pt-BR'));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const totalCases    = data.reduce((s, b) => s + b.total, 0);
  const totalBrands   = data.length;
  const totalClusters = data.reduce((s, b) => s + b.clusters.length, 0);

  return (
    <div style={{ padding:'28px 32px' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:22 }}>
        <div>
          <h1 style={{ fontSize:26, fontWeight:800, letterSpacing:'-.025em', marginBottom:4 }}>
            🔬 Diagnóstico por Fabricante
          </h1>
          <p style={{ fontSize:13, color:'var(--tm)' }}>
            Padrões de alarmes identificados automaticamente. Clique em um fabricante para ver os detalhes e solicitar análise de IA.
          </p>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {lastRun && <span style={{ fontSize:11, color:'var(--tm)' }}>Atualizado: {lastRun}</span>}
          <Btn variant="ghost" onClick={load} style={{ fontSize:12 }}>🔄 Reanalisar</Btn>
        </div>
      </div>

      {/* Summary stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:20 }}>
        {[
          { label:'Chamados analisados', value: totalCases, color:'var(--y)' },
          { label:'Fabricantes',         value: totalBrands, color:'var(--bl)' },
          { label:'Padrões identificados', value: totalClusters, color:'var(--gr)' },
        ].map(s => (
          <Card key={s.label} style={{ padding:'14px 18px', display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ fontSize:28, fontWeight:800, color:s.color }}>{s.value}</div>
            <div style={{ fontSize:12.5, color:'var(--tm)' }}>{s.label}</div>
          </Card>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign:'center', padding:'60px 0', color:'var(--tm)' }}>
          <div style={{ width:36, height:36, border:'3px solid var(--b2)', borderTopColor:'var(--y)', borderRadius:'50%', animation:'spin .7s linear infinite', margin:'0 auto 14px' }} />
          <div style={{ fontSize:13 }}>Analisando padrões de alarmes...</div>
        </div>
      )}

      {/* No data */}
      {!loading && data.length === 0 && (
        <div style={{ textAlign:'center', padding:'60px 0', color:'var(--tm)', fontSize:13 }}>
          Nenhum chamado com relato encontrado ainda.<br/>
          <span style={{ fontSize:12 }}>Os padrões aparecem conforme os chamados são registrados.</span>
        </div>
      )}

      {/* Brand cards */}
      {!loading && data.map((brand, i) => (
        <BrandCard key={brand.fabricante} brand={brand} rank={i} />
      ))}
    </div>
  );
}

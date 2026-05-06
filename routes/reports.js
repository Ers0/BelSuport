// routes/reports.js
const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../services/db');
const { requirePermission } = require('../services/permissions');

// Helper: check pdf_export_enabled toggle + permission
async function guardExport(req, res, next) {
  try {
    const { data: g } = await supabaseAdmin
      .from('settings_global').select('pdf_export_enabled').eq('id', 1).maybeSingle();
    const enabled = g?.pdf_export_enabled !== false; // default true
    if (!enabled) return res.status(403).json({ error: 'Exportação PDF desabilitada pelo administrador' });
    return requirePermission('export_pdf')(req, res, next);
  } catch { next(); }
}

// All report routes require export_pdf permission + feature toggle
router.use(guardExport);

// ── GET /api/reports/case/:id — HTML report (print to PDF via browser) ─────────
router.get('/case/:id', async (req, res) => {
  try {
    const { data: c, error } = await supabaseAdmin
      .from('chamados').select('*').eq('id', req.params.id).single();
    if (error) throw error;

    const { data: events } = await supabaseAdmin
      .from('case_events').select('*')
      .eq('case_id', req.params.id)
      .order('created_at', { ascending: true });

    // Resolve categoria name
    let categoriaNome = c.categoria || '';
    if (categoriaNome && /^\d+$/.test(categoriaNome)) {
      try {
        const { data: cat } = await supabaseAdmin
          .from('categorias').select('nome').eq('id', categoriaNome).maybeSingle();
        if (cat?.nome) categoriaNome = cat.nome;
      } catch (_) {}
    }

    const concluded = ['Concluído', 'Aguardando Protocolo'].includes(c.status);
    const checks = [
      { label:'NF',          ok: concluded || !!c.f_nf },
      { label:'Unifilar',    ok: concluded || !!c.f_un },
      { label:'Etiqueta',    ok: concluded || !!c.f_et },
      { label:'VCC',         ok: concluded || !!c.v_cc },
      { label:'Vídeo CA',    ok: concluded || !!c.v_ca },
      { label:'Vídeo Amplo', ok: concluded || !!c.f_va },
      { label:'Ficha',       ok: concluded || !!c.f_fi },
    ];
    const checkedCount = checks.filter(c => c.ok).length;

    const statusColor = {
      'Concluído':       '#16a34a',
      'Aguardando Protocolo':  '#2563eb',
      'Pendente Itens':  '#d97706',
    }[c.status] || '#6b7280';

    const driveUrl = c.drive_id
      ? `https://drive.google.com/drive/folders/${c.drive_id}`
      : null;

    const fmt = (d) => {
      if (!d) return '—';
      try { return new Date(d).toLocaleString('pt-BR'); } catch { return d; }
    };

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relatório de Chamado #${c.id}</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Plus Jakarta Sans', sans-serif;
    background: #f8f9fb;
    color: #111827;
    font-size: 13px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .page {
    max-width: 720px;
    margin: 0 auto;
    padding: 0 0 60px;
  }

  /* ── Header ── */
  .header {
    background: #0C0E16;
    padding: 18px 28px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .header-logo {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .logo-icon {
    width: 34px; height: 34px;
    background: linear-gradient(135deg, #FFD700, #FF8C00);
    border-radius: 9px;
    display: flex; align-items: center; justify-content: center;
    font-size: 16px;
  }
  .logo-text { color: #fff; font-size: 15px; font-weight: 800; letter-spacing: -.02em; }
  .logo-sub  { color: #6B7694; font-size: 10px; font-weight: 500; }
  .header-right { text-align: right; }
  .header-title { color: #FFD700; font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
  .header-date  { color: #6B7694; font-size: 10px; margin-top: 2px; }

  /* ── Meta strip ── */
  .meta-strip {
    background: #fff;
    border-bottom: 1px solid #e5e7eb;
    padding: 14px 28px;
    display: flex;
    gap: 32px;
    align-items: center;
  }
  .meta-item label { display: block; font-size: 9px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 3px; }
  .meta-item span  { font-size: 13px; font-weight: 700; color: #111827; }
  .status-badge {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 700;
    background: ${statusColor}18; color: ${statusColor};
  }
  .status-dot { width: 7px; height: 7px; border-radius: 50%; background: ${statusColor}; }

  /* ── Body ── */
  .body { padding: 20px 28px; display: flex; flex-direction: column; gap: 14px; }

  /* ── Card ── */
  .card {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    overflow: hidden;
  }
  .card-header {
    padding: 11px 18px;
    display: flex; align-items: center; gap: 8px;
    border-bottom: 1px solid #f3f4f6;
    font-size: 10px; font-weight: 700; color: #6b7280;
    text-transform: uppercase; letter-spacing: .08em;
  }
  .card-icon {
    width: 22px; height: 22px; border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px;
  }
  .card-body { padding: 16px 18px; }

  /* ── Field grid ── */
  .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .field-grid.three { grid-template-columns: 1fr 1fr 1fr; }
  .field label { display: block; font-size: 9px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: .07em; margin-bottom: 4px; }
  .field span  { font-size: 13px; font-weight: 600; color: #111827; }
  .field span.mono { font-family: monospace; font-size: 14px; }
  .field span.muted { color: #6b7280; font-weight: 400; }

  /* ── Relato ── */
  .relato-box {
    background: #f9fafb; border: 1px solid #e5e7eb;
    border-radius: 8px; padding: 12px 14px;
    font-size: 12.5px; line-height: 1.6; color: #374151;
  }

  /* ── Checklist ── */
  .checklist-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 12px;
  }
  .checklist-count { font-size: 11px; color: #6b7280; }
  .checklist-bar-wrap { height: 4px; background: #f3f4f6; border-radius: 999px; margin-bottom: 14px; overflow: hidden; }
  .checklist-bar-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #16a34a, #22c55e); }
  .check-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .check-item {
    display: flex; align-items: center; gap: 8px;
    padding: 9px 12px; border-radius: 8px; border: 1.5px solid;
    font-size: 12px; font-weight: 600;
  }
  .check-item.ok    { background: #f0fdf4; border-color: #bbf7d0; color: #15803d; }
  .check-item.nok   { background: #fef9ee; border-color: #fde68a; color: #92400e; }
  .check-circle {
    width: 16px; height: 16px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 9px; flex-shrink: 0;
  }
  .check-circle.ok  { background: #16a34a; color: #fff; }
  .check-circle.nok { background: #e5e7eb; color: #9ca3af; }
  .check-wide { grid-column: 1 / -1; }

  /* ── Two-col cards ── */
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

  /* ── Protocol ── */
  .protocol-badge {
    display: inline-flex; flex-direction: column;
    background: #fffbeb; border: 1.5px solid #fde68a;
    border-radius: 10px; padding: 10px 16px;
  }
  .protocol-badge .pb-label { font-size: 9px; font-weight: 700; color: #92400e; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 4px; }
  .protocol-badge .pb-value { font-size: 18px; font-weight: 800; color: #d97706; }

  /* ── Drive ── */
  .drive-btn {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 9px 14px; background: #eff6ff; border: 1.5px solid #bfdbfe;
    border-radius: 8px; color: #1d4ed8; font-size: 12px; font-weight: 600;
    text-decoration: none;
  }

  /* ── Timeline ── */
  .timeline { display: flex; flex-direction: column; gap: 12px; }
  .tl-item  { display: flex; gap: 12px; align-items: flex-start; }
  .tl-dot-wrap { display: flex; flex-direction: column; align-items: center; gap: 0; }
  .tl-dot {
    width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center; font-size: 12px;
  }
  .tl-line { width: 2px; flex: 1; min-height: 12px; background: #e5e7eb; margin: 2px 0; }
  .tl-content { flex: 1; padding-top: 4px; }
  .tl-meta { font-size: 10.5px; color: #6b7280; margin-bottom: 2px; }
  .tl-meta strong { color: #374151; font-weight: 700; }
  .tl-desc { font-size: 12px; color: #4b5563; }

  /* ── Footer ── */
  .footer {
    margin-top: 8px; padding: 14px 28px;
    display: flex; justify-content: space-between; align-items: center;
    border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 10.5px;
  }

  /* ── Print ── */
  @media print {
    body { background: #fff; }
    .page { max-width: 100%; }
    .no-print { display: none !important; }
  }

  /* ── Print button ── */
  .print-bar {
    background: #0C0E16; padding: 10px 28px;
    display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  }
  .print-btn {
    background: #FFD700; color: #000; border: none; border-radius: 7px;
    padding: 8px 18px; font-size: 12px; font-weight: 700; cursor: pointer;
    font-family: inherit; display: flex; align-items: center; gap: 6px;
  }
</style>
</head>
<body>
<div class="page">

  <!-- Print bar -->
  <div class="print-bar no-print">
    <button class="print-btn" onclick="window.print()">🖨️ Salvar como PDF</button>
  </div>

  <!-- Header -->
  <div class="header">
    <div class="header-logo">
      <div class="logo-icon">⚡</div>
      <div>
        <div class="logo-text">Belenergy</div>
        <div class="logo-sub">Support Pro</div>
      </div>
    </div>
    <div class="header-right">
      <div class="header-title">Relatório de Chamado</div>
      <div class="header-date">Gerado em ${new Date().toLocaleString('pt-BR')}</div>
    </div>
  </div>

  <!-- Meta strip -->
  <div class="meta-strip">
    <div class="meta-item">
      <label>ID</label>
      <span>#${c.id}</span>
    </div>
    <div class="meta-item">
      <label>Data</label>
      <span>${c.data || '—'} às ${c.hora || '—'}</span>
    </div>
    <div class="meta-item">
      <label>Técnico</label>
      <span>${c.nome || '—'}</span>
    </div>
    <div class="meta-item">
      <label>Status</label>
      <span class="status-badge"><span class="status-dot"></span>${c.status || '—'}</span>
    </div>
  </div>

  <div class="body">

    <!-- Equipamento -->
    <div class="card">
      <div class="card-header">
        <div class="card-icon" style="background:#fef3c7">🔧</div>
        Identificação do Equipamento
      </div>
      <div class="card-body">
        <div class="field-grid">
          <div class="field">
            <label>Número de Série</label>
            <span class="mono">${c.sn || '—'}</span>
          </div>
          <div class="field">
            <label>Modelo</label>
            <span>${c.modelo || '—'}</span>
          </div>
          <div class="field">
            <label>Fabricante</label>
            <span>${c.fabricante || '—'}</span>
          </div>
          <div class="field">
            <label>Categoria</label>
            <span>${categoriaNome || '—'}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Cliente -->
    <div class="card">
      <div class="card-header">
        <div class="card-icon" style="background:#ede9fe">👤</div>
        Cliente / Integrador
      </div>
      <div class="card-body">
        <div class="field-grid">
          <div class="field">
            <label>Cliente Final</label>
            <span>${c.cliente_final || '—'}</span>
          </div>
          <div class="field">
            <label>Responsável</label>
            <span>${c.nome || '—'}</span>
          </div>
          <div class="field">
            <label>Integrador</label>
            <span>${c.integrador || '—'}</span>
          </div>
          <div class="field">
            <label>Contato</label>
            <span>${c.contato || c.tel_integrador || '—'}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Relato -->
    <div class="card">
      <div class="card-header">
        <div class="card-icon" style="background:#fee2e2">📋</div>
        Relato do Problema
      </div>
      <div class="card-body">
        <div class="relato-box">${c.relato || 'Sem relato registrado.'}</div>
      </div>
    </div>

    <!-- Checklist -->
    <div class="card">
      <div class="card-header">
        <div class="card-icon" style="background:#dcfce7">✅</div>
        Checklist de Documentação
      </div>
      <div class="card-body">
        <div class="checklist-header">
          <span style="font-size:11px;color:#6b7280">Itens verificados</span>
          <span class="checklist-count">${checkedCount} / ${checks.length} itens</span>
        </div>
        <div class="checklist-bar-wrap">
          <div class="checklist-bar-fill" style="width:${Math.round(checkedCount/checks.length*100)}%"></div>
        </div>
        <div class="check-grid">
          ${checks.map((ch, i) => `
          <div class="check-item ${ch.ok?'ok':'nok'}${i===checks.length-1?' check-wide':''}">
            <div class="check-circle ${ch.ok?'ok':'nok'}">${ch.ok?'✓':'○'}</div>
            ${ch.label}
          </div>`).join('')}
        </div>
      </div>
    </div>

    <!-- Protocol + Drive -->
    <div class="two-col">
      ${(c.adb_number || c.jira_key) ? `
      <div class="card">
        <div class="card-header">
          <div class="card-icon" style="background:#fef3c7">🔗</div>
          Protocolo Jira
        </div>
        <div class="card-body">
          <div class="protocol-badge">
            <div class="pb-label">Issue ID</div>
            <div class="pb-value">${c.adb_number || c.jira_key}</div>
          </div>
        </div>
      </div>` : '<div></div>'}

      ${driveUrl ? `
      <div class="card">
        <div class="card-header">
          <div class="card-icon" style="background:#dbeafe">☁️</div>
          Google Drive
        </div>
        <div class="card-body">
          <a href="${driveUrl}" class="drive-btn" target="_blank">
            ↗ Abrir pasta no Drive
          </a>
        </div>
      </div>` : '<div></div>'}
    </div>

    <!-- Timeline -->
    ${events && events.length > 0 ? `
    <div class="card">
      <div class="card-header">
        <div class="card-icon" style="background:#e0e7ff">🕐</div>
        Timeline de Ações
      </div>
      <div class="card-body">
        <div class="timeline">
          ${events.map((ev, i) => {
            const dotColors = { status_change:'#2563eb', jira_created:'#d97706', jira_transition:'#7c3aed', comment:'#0891b2', drive_uploaded:'#16a34a', created:'#6b7280', assignment:'#db2777' };
            const dotEmoji  = { status_change:'🔄', jira_created:'🔗', jira_transition:'🔔', comment:'💬', drive_uploaded:'☁️', created:'✦', assignment:'👤' };
            const bg = (dotColors[ev.event_type] || '#6b7280') + '18';
            const color = dotColors[ev.event_type] || '#6b7280';
            return `
            <div class="tl-item">
              <div class="tl-dot-wrap">
                <div class="tl-dot" style="background:${bg};color:${color}">${dotEmoji[ev.event_type]||'•'}</div>
                ${i < events.length-1 ? '<div class="tl-line"></div>' : ''}
              </div>
              <div class="tl-content">
                <div class="tl-meta">${fmt(ev.created_at)} · <strong>${ev.user_name||'Sistema'}</strong></div>
                <div class="tl-desc">${ev.description||ev.event_type}</div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>` : ''}

  </div>

  <!-- Footer -->
  <div class="footer">
    <span>Belenergy Support Pro · Documento gerado automaticamente</span>
    <span>Chamado #${c.id} · ${new Date().toLocaleDateString('pt-BR')}</span>
  </div>

</div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);

  } catch (err) {
    console.error('Report error:', err.stack || err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── GET /api/reports/reminder/:id — HTML contact report ──────────────────────
router.get('/reminder/:id', async (req, res) => {
  try {
    const { data: r, error } = await supabaseAdmin
      .from('reminders').select('*').eq('id', req.params.id).single();
    if (error) throw error;

    const statusLabel = { pending:'Pendente', contacted:'Contactado', done:'Concluído' }[r.status] || r.status;
    const statusColor = { pending:'#d97706', contacted:'#2563eb', done:'#16a34a' }[r.status] || '#6b7280';
    const priorityLabel = { low:'Baixa', normal:'Normal', high:'Alta' }[r.priority] || r.priority;
    const priorityColor = { low:'#6b7280', normal:'#2563eb', high:'#dc2626' }[r.priority] || '#6b7280';

    const fmt = (d) => { try { return new Date(d).toLocaleString('pt-BR'); } catch { return d || '—'; } };
    const fmtDate = (d) => { if (!d) return '—'; const [y,m,day] = d.split('-'); return `${day}/${m}/${y}`; };

    const daysUntil = r.return_date
      ? Math.round((new Date(r.return_date) - new Date(new Date().toISOString().split('T')[0])) / 86400000)
      : null;

    const daysLabel = daysUntil === null ? '' :
      daysUntil < 0  ? ` · ${Math.abs(daysUntil)}d atrasado` :
      daysUntil === 0 ? ' · Hoje!' :
      ` · em ${daysUntil}d`;

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relatório de Contato — ${r.client_name}</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Plus Jakarta Sans',sans-serif; background:#f8f9fb; color:#111827; font-size:13px; line-height:1.6; -webkit-font-smoothing:antialiased; }
  .page { max-width:680px; margin:0 auto; padding:0 0 60px; }

  /* Header */
  .header { background:#0C0E16; padding:18px 28px; display:flex; align-items:center; justify-content:space-between; }
  .logo { display:flex; align-items:center; gap:10px; }
  .logo-icon { width:34px; height:34px; background:linear-gradient(135deg,#FFD700,#FF8C00); border-radius:9px; display:flex; align-items:center; justify-content:center; font-size:16px; }
  .logo-name { color:#fff; font-size:15px; font-weight:800; }
  .logo-sub  { color:#6B7694; font-size:10px; }
  .header-right { text-align:right; }
  .header-title { color:#FFD700; font-size:11px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; }
  .header-date  { color:#6B7694; font-size:10px; margin-top:2px; }

  /* Meta strip */
  .meta-strip { background:#fff; border-bottom:1px solid #e5e7eb; padding:14px 28px; display:flex; gap:28px; flex-wrap:wrap; }
  .meta-item label { display:block; font-size:9px; font-weight:700; color:#9ca3af; text-transform:uppercase; letter-spacing:.08em; margin-bottom:3px; }
  .meta-item span  { font-size:13px; font-weight:700; }
  .badge { display:inline-flex; align-items:center; gap:5px; padding:3px 10px; border-radius:999px; font-size:11px; font-weight:700; }
  .dot   { width:7px; height:7px; border-radius:50%; }

  /* Body */
  .body { padding:20px 28px; display:flex; flex-direction:column; gap:14px; }

  /* Cards */
  .card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; overflow:hidden; }
  .card-header { padding:11px 18px; display:flex; align-items:center; gap:8px; border-bottom:1px solid #f3f4f6; font-size:10px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:.08em; }
  .card-icon { width:22px; height:22px; border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:11px; }
  .card-body { padding:16px 18px; }

  /* Fields */
  .field-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .field label { display:block; font-size:9px; font-weight:700; color:#9ca3af; text-transform:uppercase; letter-spacing:.07em; margin-bottom:4px; }
  .field span  { font-size:13px; font-weight:600; }

  /* Note box */
  .note-box { background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px; padding:12px 14px; font-size:12.5px; line-height:1.7; color:#374151; white-space:pre-wrap; }

  /* Return date highlight */
  .return-card { background:#fffbeb; border:1.5px solid #fde68a; border-radius:12px; padding:16px 20px; display:flex; align-items:center; gap:16px; }
  .return-icon { font-size:32px; }
  .return-date-big { font-size:22px; font-weight:800; color:#d97706; }
  .return-sub { font-size:12px; color:#92400e; margin-top:2px; }

  /* Footer */
  .footer { margin-top:8px; padding:14px 28px; display:flex; justify-content:space-between; align-items:center; border-top:1px solid #e5e7eb; color:#9ca3af; font-size:10.5px; }

  /* Print */
  @media print { body { background:#fff; } .no-print { display:none !important; } }

  /* Print button */
  .print-bar { background:#0C0E16; padding:10px 28px; display:flex; align-items:center; justify-content:flex-end; gap:8px; }
  .print-btn { background:#FFD700; color:#000; border:none; border-radius:7px; padding:8px 18px; font-size:12px; font-weight:700; cursor:pointer; font-family:inherit; }
</style>
</head>
<body>
<div class="page">

  <div class="print-bar no-print">
    <button class="print-btn" onclick="window.print()">🖨️ Salvar como PDF</button>
  </div>

  <!-- Header -->
  <div class="header">
    <div class="logo">
      <div class="logo-icon">⚡</div>
      <div>
        <div class="logo-name">Belenergy</div>
        <div class="logo-sub">Support Pro</div>
      </div>
    </div>
    <div class="header-right">
      <div class="header-title">Relatório de Contato</div>
      <div class="header-date">Gerado em ${new Date().toLocaleString('pt-BR')}</div>
    </div>
  </div>

  <!-- Meta strip -->
  <div class="meta-strip">
    <div class="meta-item">
      <label>ID</label>
      <span>#${r.id}</span>
    </div>
    <div class="meta-item">
      <label>Criado em</label>
      <span>${fmt(r.created_at)}</span>
    </div>
    <div class="meta-item">
      <label>Status</label>
      <span class="badge" style="background:${statusColor}18;color:${statusColor}">
        <span class="dot" style="background:${statusColor}"></span>${statusLabel}
      </span>
    </div>
    <div class="meta-item">
      <label>Prioridade</label>
      <span class="badge" style="background:${priorityColor}18;color:${priorityColor}">${priorityLabel}</span>
    </div>
  </div>

  <div class="body">

    <!-- Client info -->
    <div class="card">
      <div class="card-header">
        <div class="card-icon" style="background:#ede9fe">👤</div>
        Dados do Cliente
      </div>
      <div class="card-body">
        <div class="field-grid">
          <div class="field" style="grid-column:1/-1">
            <label>Nome</label>
            <span style="font-size:18px">${r.client_name}</span>
          </div>
          ${r.phone ? `<div class="field">
            <label>Telefone / WhatsApp</label>
            <span>📞 ${r.phone}</span>
          </div>` : ''}
        </div>
      </div>
    </div>

    <!-- Return date -->
    ${r.return_date ? `
    <div class="return-card">
      <div class="return-icon">📅</div>
      <div>
        <div style="font-size:10px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Data de Retorno</div>
        <div class="return-date-big">${fmtDate(r.return_date)}</div>
        <div class="return-sub">${
          daysUntil < 0  ? `⚠️ Atrasado ${Math.abs(daysUntil)} dia${Math.abs(daysUntil)!==1?'s':''}` :
          daysUntil === 0 ? '⭐ Retorno agendado para hoje!' :
          `Em ${daysUntil} dia${daysUntil!==1?'s':''}`
        }</div>
      </div>
    </div>` : ''}

    <!-- Note -->
    ${r.note ? `
    <div class="card">
      <div class="card-header">
        <div class="card-icon" style="background:#fef3c7">📝</div>
        Anotações
      </div>
      <div class="card-body">
        <div class="note-box">${r.note.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
      </div>
    </div>` : ''}

    <!-- Comments timeline -->
    ${r.comments && r.comments.length > 0 ? `
    <div class="card">
      <div class="card-header">
        <div class="card-icon" style="background:#dbeafe">💬</div>
        Histórico de Contatos (${r.comments.length})
      </div>
      <div class="card-body" style="padding:0">
        ${r.comments.map((cm, i) => `
        <div style="display:flex;gap:12px;padding:12px 18px;${i < r.comments.length - 1 ? 'border-bottom:1px solid #f3f4f6' : ''}">
          <div style="width:8px;height:8px;border-radius:50%;background:#2563eb;margin-top:5px;flex-shrink:0"></div>
          <div style="flex:1">
            <div style="font-size:12.5px;color:#111827;line-height:1.5;margin-bottom:4px">${cm.text.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
            <div style="font-size:10px;color:#9ca3af">${cm.author} · ${new Date(cm.at).toLocaleString('pt-BR')}</div>
          </div>
        </div>`).join('')}
      </div>
    </div>` : ''}

    <!-- Signature area -->
    <div class="card">
      <div class="card-header">
        <div class="card-icon" style="background:#f0fdf4">✍️</div>
        Registro de Atendimento
      </div>
      <div class="card-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:8px">
          <div>
            <div style="font-size:9px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.07em;margin-bottom:28px">Atendente</div>
            <div style="border-top:1.5px solid #d1d5db;padding-top:6px;font-size:11px;color:#9ca3af">Assinatura</div>
          </div>
          <div>
            <div style="font-size:9px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.07em;margin-bottom:28px">Cliente</div>
            <div style="border-top:1.5px solid #d1d5db;padding-top:6px;font-size:11px;color:#9ca3af">Assinatura</div>
          </div>
        </div>
        <div style="margin-top:20px;padding:10px 12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px">
          <div style="font-size:9px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Observações do atendimento</div>
          <div style="height:52px"></div>
        </div>
      </div>
    </div>

  </div>

  <div class="footer">
    <span>Belenergy Support Pro · Relatório de Contato</span>
    <span>#${r.id} · ${new Date().toLocaleDateString('pt-BR')}</span>
  </div>
</div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Reminder report error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});


router.get('/warranty', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('equipment')
      .select('*, client:clients(nome)')
      .not('data_compra', 'is', null)
      .order('data_compra');
    if (error) throw error;

    const now = new Date();
    const enriched = (data || []).map(eq => {
      const warrantyEnd = new Date(new Date(eq.data_compra).setMonth(
        new Date(eq.data_compra).getMonth() + (eq.garantia_meses || 12)
      ));
      const daysLeft = Math.ceil((warrantyEnd - now) / 864e5);
      return {
        ...eq,
        warrantyEnd:    warrantyEnd.toISOString().split('T')[0],
        daysLeft,
        warrantyStatus: daysLeft < 0 ? 'expired' : daysLeft < 30 ? 'expiring_soon' : 'active',
      };
    }).sort((a, b) => a.daysLeft - b.daysLeft);

    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/reports/dashboard?period=daily|weekly|monthly ───────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const period = req.query.period || 'weekly';
    const label  = { daily:'Diário', weekly:'Semanal', monthly:'Mensal' }[period] || 'Semanal';
    const now    = new Date();
    const fromDate = new Date(now);
    if (period === 'daily')   fromDate.setHours(0,0,0,0);
    if (period === 'weekly')  fromDate.setDate(now.getDate() - 7);
    if (period === 'monthly') fromDate.setDate(now.getDate() - 30);

    const { data: cases } = await supabaseAdmin
      .from('chamados')
      .select('id,data,hora,status,fabricante,sn,integrador,cliente_final,nome,adb_number,created_at')
      .gte('created_at', fromDate.toISOString())
      .order('created_at', { ascending: false });

    const all     = cases || [];
    const total   = all.length;
    const done    = all.filter(c => c.status === 'Concluído').length;
    const pending = all.filter(c => c.status === 'Pendente Itens').length;
    const resRate = total ? Math.round((done / total) * 100) : 0;

    const byFab = {};
    all.forEach(c => {
      const f = c.fabricante || 'Não informado';
      if (!byFab[f]) byFab[f] = { total:0, done:0 };
      byFab[f].total++;
      if (c.status === 'Concluído') byFab[f].done++;
    });
    const fabRows = Object.entries(byFab).sort((a,b) => b[1].total - a[1].total);

    const byTech = {};
    all.forEach(c => {
      const t = c.nome || 'Desconhecido';
      if (!byTech[t]) byTech[t] = { total:0, done:0 };
      byTech[t].total++;
      if (c.status === 'Concluído') byTech[t].done++;
    });
    const techRows = Object.entries(byTech).sort((a,b) => b[1].total - a[1].total);

    const range = `${fromDate.toLocaleDateString('pt-BR')} – ${now.toLocaleDateString('pt-BR')}`;

    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Relatório ${label} — Belenergy</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Plus Jakarta Sans',sans-serif;background:#f8f9fb;color:#111827;font-size:13px;line-height:1.5}
.page{max-width:760px;margin:0 auto;padding:0 0 60px}
.header{background:#0C0E16;padding:18px 28px;display:flex;align-items:center;justify-content:space-between}
.logo{display:flex;align-items:center;gap:10px}
.logo-icon{width:34px;height:34px;background:linear-gradient(135deg,#FFD700,#FF8C00);border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:16px}
.logo-name{color:#fff;font-size:15px;font-weight:800}.logo-sub{color:#6B7694;font-size:10px}
.hr{text-align:right}.hr-title{color:#FFD700;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
.hr-date{color:#6B7694;font-size:10px;margin-top:2px}
.body{padding:20px 28px;display:flex;flex-direction:column;gap:14px}
.sg{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.sc{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;text-align:center}
.sv{font-size:32px;font-weight:800;line-height:1}.sl{font-size:11px;color:#6b7280;margin-top:4px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden}
.ch{padding:11px 18px;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #f3f4f6}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th{text-align:left;padding:9px 16px;background:#f9fafb;color:#6b7280;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #e5e7eb}
td{padding:10px 16px;border-bottom:1px solid #f3f4f6}
.bw{height:6px;background:#f3f4f6;border-radius:999px;overflow:hidden;margin-top:4px;flex:1}
.bf{height:100%;border-radius:999px;background:linear-gradient(90deg,#FFD700,#FF8C00)}
.badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700}
.footer{padding:14px 28px;display:flex;justify-content:space-between;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:10.5px}
@media print{body{background:#fff}.no-print{display:none!important}}
.pb{background:#0C0E16;padding:10px 28px;display:flex;justify-content:flex-end;gap:8px}
.pbtn{background:#FFD700;color:#000;border:none;border-radius:7px;padding:8px 18px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}
</style></head><body>
<div class="page">
<div class="pb no-print"><button class="pbtn" onclick="window.print()">🖨️ Salvar como PDF</button></div>
<div class="header">
  <div class="logo"><div class="logo-icon">⚡</div><div><div class="logo-name">Belenergy</div><div class="logo-sub">Support Pro</div></div></div>
  <div class="hr"><div class="hr-title">Relatório ${label}</div><div class="hr-date">${range} · Gerado em ${now.toLocaleString('pt-BR')}</div></div>
</div>
<div class="body">
  <div class="sg">
    <div class="sc"><div class="sv" style="color:#d97706">${total}</div><div class="sl">Total</div></div>
    <div class="sc"><div class="sv" style="color:#16a34a">${done}</div><div class="sl">Concluídos</div></div>
    <div class="sc"><div class="sv" style="color:#f59e0b">${pending}</div><div class="sl">Pendentes</div></div>
    <div class="sc"><div class="sv" style="color:#2563eb">${resRate}%</div><div class="sl">Resolução</div></div>
  </div>
  <div class="card"><div class="ch">Por Fabricante</div><table>
    <thead><tr><th>Fabricante</th><th>Chamados</th><th>Concluídos</th><th>Taxa</th></tr></thead>
    <tbody>${fabRows.map(([f,s])=>{const r=s.total?Math.round(s.done/s.total*100):0;return`<tr><td style="font-weight:600">${f}</td><td>${s.total}</td><td style="color:#16a34a">${s.done}</td><td><div style="display:flex;align-items:center;gap:8px"><div class="bw"><div class="bf" style="width:${r}%"></div></div><span style="font-size:11px;font-weight:700;color:#d97706;min-width:32px">${r}%</span></div></td></tr>`;}).join('')}
    </tbody></table></div>
  <div class="card"><div class="ch">Por Técnico</div><table>
    <thead><tr><th>Técnico</th><th>Chamados</th><th>Concluídos</th><th>Taxa</th></tr></thead>
    <tbody>${techRows.map(([t,s])=>{const r=s.total?Math.round(s.done/s.total*100):0;return`<tr><td style="font-weight:600">${t}</td><td>${s.total}</td><td style="color:#16a34a">${s.done}</td><td><div style="display:flex;align-items:center;gap:8px"><div class="bw"><div class="bf" style="width:${r}%"></div></div><span style="font-size:11px;font-weight:700;color:#d97706;min-width:32px">${r}%</span></div></td></tr>`;}).join('')}
    </tbody></table></div>
  <div class="card"><div class="ch">Chamados (${total})</div><table>
    <thead><tr><th>Data</th><th>Cliente</th><th>S/N</th><th>Fabricante</th><th>Status</th><th>Protocolo</th></tr></thead>
    <tbody>${all.map(c=>{const sc=c.status==='Concluído'?'#16a34a':c.status==='Aguardando Protocolo'?'#2563eb':'#d97706';return`<tr><td style="color:#6b7280;white-space:nowrap">${c.data||''}</td><td style="font-weight:600">${c.integrador||c.cliente_final||c.nome||'—'}</td><td style="font-family:monospace;font-size:11px">${c.sn||'—'}</td><td>${c.fabricante||'—'}</td><td><span class="badge" style="background:${sc}18;color:${sc}">${c.status}</span></td><td style="font-family:monospace;font-size:11px;color:#6b7280">${c.adb_number||'—'}</td></tr>`;}).join('')}
    </tbody></table></div>
</div>
<div class="footer"><span>Belenergy Support Pro · Relatório ${label}</span><span>${range}</span></div>
</div></body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Dashboard report error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── GET /api/reports/solution/:id — Blog-style solution PDF ──────────────────
router.get('/solution/:id', async (req, res) => {
  try {
    const { data: s, error } = await supabaseAdmin
      .from('solutions').select('*').eq('id', req.params.id).single();
    if (error || !s) throw error || new Error('Solução não encontrada');

    const publishedAt = s.created_at
      ? new Date(s.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' })
      : '—';

    const readMin = Math.max(1, Math.round((s.content || '').split(/\s+/).length / 200));

    // Convert markdown to simple HTML for PDF
    const mdToHtml = (text) => (text || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/^### (.+)$/gm,'<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm,  '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,   '<em>$1</em>')
      .replace(/`(.+?)`/g,     '<code>$1</code>')
      .replace(/^> (.+)$/gm,   '<blockquote>$1</blockquote>')
      .replace(/^---$/gm,      '<hr>')
      .replace(/^- (.+)$/gm,   '<li>$1</li>')
      .replace(/(<li>[\s\S]+?<\/li>)/g, '<ul>$1</ul>')
      .replace(/\n\n/g,'</p><p>')
      .replace(/\n/g,'<br>');

    const images = (s.media || []).filter(m => m.type === 'image');
    const videos = (s.media || []).filter(m => m.type === 'video');
    const tags   = (s.tags || []).map(t => `<span class="tag">#${t}</span>`).join('');

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>${s.title} — Belenergy Soluções</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Plus Jakarta Sans', sans-serif; background: #fff; color: #1a1a2e; font-size: 14px; line-height: 1.7; }

  @media print {
    body { font-size: 12px; }
    .no-print { display: none !important; }
    @page { margin: 20mm 18mm; }
  }

  .header { background: linear-gradient(135deg, #0f111a 0%, #1a1d2e 100%); color: #fff; padding: 36px 48px 28px; }
  .header-top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; }
  .logo { display: flex; align-items: center; gap: 10px; }
  .logo-icon { width: 36px; height: 36px; background: linear-gradient(135deg,#FFD700,#FF8C00); border-radius: 9px;
               display: flex; align-items: center; justify-content: center; font-size: 18px; }
  .logo-text { font-size: 15px; font-weight: 800; }
  .logo-sub { font-size: 10px; color: #9aa0b8; font-weight: 400; }
  .badge { font-size: 11px; font-weight: 700; background: rgba(255,215,0,.15); color: #FFD700;
           padding: 4px 12px; border-radius: 999px; border: 1px solid rgba(255,215,0,.25); }

  .brand-pill { display: inline-block; font-size: 12px; font-weight: 700; background: rgba(96,165,250,.15);
                color: #60A5FA; padding: 3px 12px; border-radius: 999px; border: 1px solid rgba(96,165,250,.25); margin-bottom: 14px; }
  .title { font-size: 28px; font-weight: 900; line-height: 1.2; margin-bottom: 16px; letter-spacing: -.02em; }
  .meta { display: flex; align-items: center; gap: 20px; font-size: 12px; color: #9aa0b8; padding-top: 14px;
          border-top: 1px solid rgba(255,255,255,.08); }

  .tag { display: inline-block; font-size: 11px; background: rgba(255,255,255,.08); color: #9aa0b8;
         padding: 2px 9px; border-radius: 999px; margin-right: 5px; }

  .body { padding: 40px 48px; max-width: 800px; margin: 0 auto; }

  h1 { font-size: 20px; font-weight: 800; color: #1a1a2e; margin: 24px 0 8px; }
  h2 { font-size: 16px; font-weight: 700; color: #1a1a2e; margin: 20px 0 7px; padding-bottom: 6px;
       border-bottom: 2px solid #FFD700; }
  h3 { font-size: 14px; font-weight: 700; color: #374151; margin: 16px 0 6px; }
  p  { margin: 10px 0; color: #374151; }
  strong { font-weight: 700; color: #1a1a2e; }
  em { font-style: italic; }
  code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 12px; color: #2563eb; }
  blockquote { border-left: 3px solid #FFD700; padding: 8px 16px; background: #fffbeb; border-radius: 0 6px 6px 0; margin: 12px 0; color: #92400e; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 20px 0; }
  ul { padding-left: 20px; margin: 8px 0; }
  li { margin: 5px 0; color: #374151; }

  .media-section { margin-top: 32px; padding-top: 24px; border-top: 2px solid #f3f4f6; }
  .media-title { font-size: 11px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 14px; }
  .image-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
  .image-grid img { width: 100%; height: 180px; object-fit: cover; border-radius: 8px; border: 1px solid #e5e7eb; }
  .image-caption { font-size: 10px; color: #9ca3af; margin-top: 4px; text-align: center; }
  .video-link { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: #f8fafc;
                border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 8px; text-decoration: none; color: #1a1a2e; }
  .video-icon { font-size: 24px; flex-shrink: 0; }
  .video-name { font-size: 13px; font-weight: 600; }
  .video-provider { font-size: 11px; color: #6b7280; margin-top: 2px; }

  .footer { margin-top: 40px; padding: 20px 48px; background: #f8fafc; border-top: 1px solid #e5e7eb;
            display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #9ca3af; }

  .print-btn { position: fixed; bottom: 24px; right: 24px; padding: 12px 24px; background: #FFD700; color: #000;
               border: none; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer;
               font-family: inherit; box-shadow: 0 4px 20px rgba(0,0,0,.15); }
</style>
</head>
<body>

<!-- Header -->
<div class="header">
  <div class="header-top">
    <div class="logo">
      <div class="logo-icon">⚡</div>
      <div>
        <div class="logo-text">Belenergy</div>
        <div class="logo-sub">Centro de Soluções</div>
      </div>
    </div>
    <div class="badge">📚 Base de Conhecimento</div>
  </div>

  ${s.brand ? `<div class="brand-pill">⚡ ${s.brand}</div>` : ''}
  <div class="title">${s.title}</div>
  ${tags ? `<div style="margin-bottom:16px">${tags}</div>` : ''}

  <div class="meta">
    <span>✍️ ${s.author_name || 'Técnico Belenergy'}</span>
    <span>📅 Publicado em ${publishedAt}</span>
    <span>⏱ ${readMin} min de leitura</span>
    ${images.length > 0 ? `<span>🖼️ ${images.length} imagem${images.length!==1?'s':''}</span>` : ''}
    ${videos.length > 0 ? `<span>🎥 ${videos.length} vídeo${videos.length!==1?'s':''}</span>` : ''}
    <span style="margin-left:auto">ID #${s.id}</span>
  </div>
</div>

<!-- Body -->
<div class="body">
  <p>${mdToHtml(s.content)}</p>

  ${images.length > 0 ? `
  <div class="media-section">
    <div class="media-title">🖼️ Imagens (${images.length})</div>
    <div class="image-grid">
      ${images.map(img => `
        <div>
          <img src="${img.thumb_url || img.url}" alt="${img.name}" onerror="this.style.display='none'">
          <div class="image-caption">${img.name}</div>
        </div>
      `).join('')}
    </div>
  </div>` : ''}

  ${videos.length > 0 ? `
  <div class="media-section">
    <div class="media-title">🎥 Vídeos (${videos.length})</div>
    ${videos.map(v => `
      <a class="video-link" href="${v.url}" target="_blank">
        <div class="video-icon">${v.provider === 'youtube' ? '▶' : '☁️'}</div>
        <div>
          <div class="video-name">${v.name}</div>
          <div class="video-provider">${v.provider === 'youtube' ? 'YouTube' : 'Google Drive'} — ${v.url}</div>
        </div>
      </a>
    `).join('')}
  </div>` : ''}
</div>

<!-- Footer -->
<div class="footer">
  <span>Belenergy Support Pro — Centro de Soluções Técnicas</span>
  <span>Gerado em ${new Date().toLocaleString('pt-BR')}</span>
</div>

<!-- Print button (hidden on print) -->
<button class="print-btn no-print" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>

</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Solution report error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});


// ── GET /api/reports/contact/:id — HTML contact attempt report ────────────────
router.get('/contact/:id', async (req, res) => {
  try {
    const token = req.query.token || req.headers.authorization?.replace('Bearer ','');
    if (!token) return res.status(401).send('Unauthorized');

    const { data: entity, error: eErr } = await supabaseAdmin
      .from('contact_entities')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (eErr || !entity) return res.status(404).send('Contato não encontrado');

    const { data: attempts } = await supabaseAdmin
      .from('contact_attempts')
      .select('*, chamado:chamados(id, sn, fabricante, integrador, cliente_final, status)')
      .eq('entity_id', req.params.id)
      .order('attempted_at', { ascending: false });

    const RESULT_MAP = {
      reached:      { icon:'✅', label:'Atendeu',        color:'#16a34a' },
      no_answer:    { icon:'📵', label:'Não atendeu',    color:'#6B7694' },
      busy:         { icon:'🔴', label:'Ocupado',         color:'#d97706' },
      left_message: { icon:'📝', label:'Deixou recado',  color:'#2563eb' },
      email_sent:   { icon:'📧', label:'Email enviado',  color:'#7c3aed' },
      whatsapp:     { icon:'💬', label:'WhatsApp',       color:'#16a34a' },
      other:        { icon:'📞', label:'Outro',          color:'#6B7694' },
    };

    // Stats
    const stats = {};
    (attempts||[]).forEach(a => { stats[a.result] = (stats[a.result]||0) + 1; });
    const reached = stats['reached'] || 0;
    const total   = (attempts||[]).length;
    const lastAttempt = (attempts||[])[0];
    const lastRes = lastAttempt ? RESULT_MAP[lastAttempt.result] : null;

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tentativas de Contato — ${entity.name}</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Plus Jakarta Sans', sans-serif; background: #f8f9fb; color: #111827; font-size: 13px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
  .page { max-width: 720px; margin: 0 auto; padding: 0 0 60px; }
  .header { background: #0C0E16; padding: 18px 28px; display: flex; align-items: center; justify-content: space-between; }
  .header-logo { display: flex; align-items: center; gap: 10px; }
  .logo-icon { width: 34px; height: 34px; background: linear-gradient(135deg, #FFD700, #FF8C00); border-radius: 9px; display: flex; align-items: center; justify-content: center; font-size: 16px; }
  .logo-text { color: #fff; font-size: 15px; font-weight: 800; letter-spacing: -.02em; }
  .logo-sub  { color: #6B7694; font-size: 10px; font-weight: 500; }
  .header-right { text-align: right; }
  .header-title { color: #FFD700; font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
  .header-date  { color: #6B7694; font-size: 10px; margin-top: 2px; }
  .meta-strip { background: #fff; border-bottom: 1px solid #e5e7eb; padding: 16px 28px; display: flex; gap: 28px; align-items: center; flex-wrap: wrap; }
  .meta-item label { display: block; font-size: 9px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 3px; }
  .meta-item span  { font-size: 13px; font-weight: 700; color: #111827; }
  .cat-badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; background: #f3f4f6; color: #374151; }
  .section { background: #fff; border-radius: 10px; margin: 16px 28px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
  .section-title { padding: 12px 18px; background: #f9fafb; border-bottom: 1px solid #e5e7eb; font-size: 10px; font-weight: 800; color: #6b7280; text-transform: uppercase; letter-spacing: .09em; display: flex; align-items: center; gap: 7px; }
  .section-body { padding: 16px 18px; }
  .info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .info-item label { display: block; font-size: 9px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 3px; }
  .info-item span  { font-size: 13px; font-weight: 600; color: #111827; }
  .fab-contact-box { margin-top: 14px; padding: 12px 14px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; }
  .fab-contact-box .label { font-size: 9px; font-weight: 800; color: #2563eb; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 8px; }
  .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .stat-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; text-align: center; }
  .stat-card .val { font-size: 22px; font-weight: 800; color: #111827; }
  .stat-card .lbl { font-size: 10px; color: #6b7280; margin-top: 2px; }
  .result-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
  .result-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .attempt { display: flex; gap: 14px; padding: 14px 18px; border-bottom: 1px solid #f3f4f6; align-items: flex-start; }
  .attempt:last-child { border-bottom: none; }
  .attempt-icon { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; margin-top: 2px; }
  .attempt-meta { font-size: 10px; color: #9ca3af; margin-top: 2px; font-family: monospace; }
  .attempt-result { font-size: 12px; font-weight: 700; margin-bottom: 2px; }
  .attempt-author { font-size: 11px; color: #6b7280; margin-bottom: 4px; }
  .attempt-notes { font-size: 12px; color: #374151; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; margin-top: 6px; line-height: 1.5; }
  .chamado-tag { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; margin-top: 4px; }
  .footer { display: flex; justify-content: space-between; align-items: center; padding: 14px 28px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #9ca3af; margin-top: 8px; }
  .print-btn { position: fixed; bottom: 24px; right: 24px; background: #FFD700; color: #000; border: none; padding: 12px 24px; border-radius: 10px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; box-shadow: 0 4px 16px rgba(0,0,0,.15); }
  @media print { .print-btn { display: none; } .page { padding-bottom: 0; } body { background: #fff; } }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="header-logo">
      <div class="logo-icon">⚡</div>
      <div>
        <div class="logo-text">Belenergy</div>
        <div class="logo-sub">Support Pro</div>
      </div>
    </div>
    <div class="header-right">
      <div class="header-title">Relatório de Contato</div>
      <div class="header-date">Gerado em ${new Date().toLocaleString('pt-BR')}</div>
    </div>
  </div>

  <!-- Meta strip -->
  <div class="meta-strip">
    <div class="meta-item">
      <label>Nome</label>
      <span>${entity.name}</span>
    </div>
    <div class="meta-item">
      <label>Categoria</label>
      <span><span class="cat-badge">${entity.category}</span></span>
    </div>
    ${entity.phone ? `<div class="meta-item"><label>Telefone</label><span>${entity.phone}</span></div>` : ''}
    ${entity.email ? `<div class="meta-item"><label>Email</label><span>${entity.email}</span></div>` : ''}
    <div class="meta-item">
      <label>Total de Tentativas</label>
      <span>${total}</span>
    </div>
    ${lastRes ? `<div class="meta-item"><label>Último Resultado</label><span style="color:${lastRes.color};font-weight:700">${lastRes.icon} ${lastRes.label}</span></div>` : ''}
  </div>

  ${entity.category === 'Fabricantes' && entity.fabricante_contact_name ? `
  <!-- Fabricante contact -->
  <div class="section">
    <div class="section-title">👤 Contato no Fabricante</div>
    <div class="section-body">
      <div class="info-grid">
        <div class="info-item"><label>Nome</label><span>${entity.fabricante_contact_name}</span></div>
        ${entity.fabricante_contact_role ? `<div class="info-item"><label>Cargo</label><span>${entity.fabricante_contact_role}</span></div>` : ''}
        ${entity.fabricante_contact_phone ? `<div class="info-item"><label>Tel. Direto</label><span>${entity.fabricante_contact_phone}</span></div>` : ''}
      </div>
    </div>
  </div>` : ''}

  ${entity.notes ? `
  <!-- Notes -->
  <div class="section">
    <div class="section-title">📝 Observações</div>
    <div class="section-body" style="color:#374151;line-height:1.6">${entity.notes}</div>
  </div>` : ''}

  <!-- Stats -->
  <div class="section">
    <div class="section-title">📊 Resumo das Tentativas</div>
    <div class="section-body">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="val">${total}</div>
          <div class="lbl">Total</div>
        </div>
        <div class="stat-card">
          <div class="val" style="color:#16a34a">${reached}</div>
          <div class="lbl">Atendeu</div>
        </div>
        <div class="stat-card">
          <div class="val" style="color:#d97706">${total - reached}</div>
          <div class="lbl">Sem resposta</div>
        </div>
        <div class="stat-card">
          <div class="val" style="color:#2563eb">${Math.round(total ? (reached/total)*100 : 0)}%</div>
          <div class="lbl">Taxa de contato</div>
        </div>
      </div>
      <div style="margin-top:14px;display:flex;gap:16px;flex-wrap:wrap">
        ${Object.entries(stats).map(([key, count]) => {
          const r = RESULT_MAP[key] || { icon:'📞', label:key, color:'#6B7694' };
          return `<div class="result-row">
            <div class="result-dot" style="background:${r.color}"></div>
            <span style="font-size:11px;color:#374151">${r.icon} ${r.label}: <strong>${count}</strong></span>
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>

  <!-- Timeline -->
  <div class="section">
    <div class="section-title">🕐 Histórico de Tentativas (${total})</div>
    ${total === 0 ? '<div class="section-body" style="color:#9ca3af;text-align:center;padding:24px 0">Nenhuma tentativa registrada</div>' : ''}
    ${(attempts||[]).map((a, i) => {
      const r   = RESULT_MAP[a.result] || RESULT_MAP.other;
      const dt  = new Date(a.attempted_at);
      const dateStr = dt.toLocaleDateString('pt-BR', { weekday:'short', day:'2-digit', month:'2-digit', year:'numeric' });
      const timeStr = dt.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
      return `
      <div class="attempt">
        <div class="attempt-icon" style="background:${r.color}18;border:1px solid ${r.color}30">${r.icon}</div>
        <div style="flex:1;min-width:0">
          <div class="attempt-result" style="color:${r.color}">${r.label}</div>
          <div class="attempt-author">por ${a.author}</div>
          <div class="attempt-meta">📅 ${dateStr} &nbsp;⏱ ${timeStr}</div>
          ${a.chamado ? `<div class="chamado-tag">🔗 #${a.chamado.id} — ${a.chamado.sn||''} ${a.chamado.integrador||a.chamado.cliente_final||''} | ${a.chamado.status}</div>` : ''}
          ${a.notes ? `<div class="attempt-notes">${a.notes}</div>` : ''}
        </div>
        <div style="font-size:11px;color:#9ca3af;white-space:nowrap;margin-top:2px">#${i+1}</div>
      </div>`;
    }).join('')}
  </div>

  <!-- Signature area -->
  <div class="section">
    <div class="section-title">✍️ Responsável</div>
    <div class="section-body">
      <div style="display:flex;gap:40px;margin-top:8px">
        <div style="flex:1">
          <div style="border-bottom:1px solid #d1d5db;margin-bottom:6px;height:40px"></div>
          <div style="font-size:10px;color:#9ca3af;text-align:center">Técnico responsável</div>
        </div>
        <div style="flex:1">
          <div style="border-bottom:1px solid #d1d5db;margin-bottom:6px;height:40px"></div>
          <div style="font-size:10px;color:#9ca3af;text-align:center">Data</div>
        </div>
      </div>
    </div>
  </div>

  <div class="footer">
    <span>Belenergy Support Pro — Relatório de Tentativas de Contato</span>
    <span>Gerado em ${new Date().toLocaleString('pt-BR')}</span>
  </div>

</div>
<button class="print-btn" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Contact report error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ── GET /api/reports/contact-session/:id — Per-session PDF ───────────────────
router.get('/contact-session/:id', async (req, res) => {
  try {
    const { data: session, error: sErr } = await supabaseAdmin
      .from('contact_sessions')
      .select(`*, entity:contact_entities(*), chamado:chamados(id,sn,fabricante,integrador,cliente_final,status,relato), attempts:contact_attempts(*)`)
      .eq('id', req.params.id)
      .single();
    if (sErr || !session) return res.status(404).send('Sessão não encontrada');

    const attempts = (session.attempts||[]).sort((a,b) => new Date(b.attempted_at)-new Date(a.attempted_at));
    const entity   = session.entity;

    const RESULT_MAP = {
      reached:      { icon:'✅', label:'Atendeu',        color:'#16a34a' },
      no_answer:    { icon:'📵', label:'Não atendeu',    color:'#6B7694' },
      busy:         { icon:'🔴', label:'Ocupado',         color:'#d97706' },
      left_message: { icon:'📝', label:'Deixou recado',  color:'#2563eb' },
      email_sent:   { icon:'📧', label:'Email enviado',  color:'#7c3aed' },
      whatsapp:     { icon:'💬', label:'WhatsApp',       color:'#16a34a' },
      other:        { icon:'📞', label:'Outro',          color:'#6B7694' },
    };

    const stats   = {};
    attempts.forEach(a => { stats[a.result] = (stats[a.result]||0) + 1; });
    const reached = stats['reached'] || 0;
    const total   = attempts.length;
    const lastRes = attempts[0] ? RESULT_MAP[attempts[0].result] : null;

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Sessão de Contato — ${session.title}</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Plus Jakarta Sans', sans-serif; background: #f8f9fb; color: #111827; font-size: 13px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
  .page { max-width: 720px; margin: 0 auto; padding: 0 0 60px; }
  .header { background: #0C0E16; padding: 18px 28px; display: flex; align-items: center; justify-content: space-between; }
  .header-logo { display: flex; align-items: center; gap: 10px; }
  .logo-icon { width: 34px; height: 34px; background: linear-gradient(135deg, #FFD700, #FF8C00); border-radius: 9px; display: flex; align-items: center; justify-content: center; font-size: 16px; }
  .logo-text { color: #fff; font-size: 15px; font-weight: 800; }
  .logo-sub  { color: #6B7694; font-size: 10px; }
  .header-right { text-align: right; }
  .header-title { color: #FFD700; font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
  .header-date  { color: #6B7694; font-size: 10px; margin-top: 2px; }
  .meta-strip { background: #fff; border-bottom: 1px solid #e5e7eb; padding: 14px 28px; display: flex; gap: 24px; align-items: center; flex-wrap: wrap; }
  .meta-item label { display: block; font-size: 9px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 3px; }
  .meta-item span  { font-size: 13px; font-weight: 700; color: #111827; }
  .session-title { background: #fffbeb; border-left: 4px solid #FFD700; padding: 12px 28px; font-size: 16px; font-weight: 800; color: #111827; display: flex; align-items: center; gap:10px; }
  .section { background: #fff; border-radius: 10px; margin: 14px 28px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
  .section-title { padding: 10px 18px; background: #f9fafb; border-bottom: 1px solid #e5e7eb; font-size: 10px; font-weight: 800; color: #6b7280; text-transform: uppercase; letter-spacing: .09em; }
  .section-body  { padding: 14px 18px; }
  .stats-grid { display: grid; grid-template-columns: repeat(4,1fr); gap:10px; }
  .stat-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; text-align: center; }
  .stat-card .val { font-size: 22px; font-weight: 800; }
  .stat-card .lbl { font-size: 10px; color: #6b7280; margin-top: 2px; }
  .chamado-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px 14px; }
  .chamado-box .clabel { font-size: 9px; font-weight: 800; color: #2563eb; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 6px; }
  .info-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; }
  .info-item label { display: block; font-size: 9px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: .07em; margin-bottom: 2px; }
  .info-item span  { font-size:12px; font-weight:600; color:#111827; }
  .attempt { display: flex; gap: 12px; padding: 12px 18px; border-bottom: 1px solid #f3f4f6; align-items: flex-start; }
  .attempt:last-child { border-bottom: none; }
  .attempt-icon { width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 15px; flex-shrink: 0; margin-top:2px; }
  .attempt-result { font-size: 12px; font-weight: 700; margin-bottom: 2px; }
  .attempt-meta   { font-size: 10px; color: #9ca3af; font-family: monospace; }
  .attempt-author { font-size: 11px; color: #6b7280; margin-bottom: 3px; }
  .attempt-notes  { font-size: 12px; color: #374151; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 7px 10px; margin-top: 6px; line-height: 1.5; }
  .status-badge { display:inline-block; padding:2px 9px; border-radius:999px; font-size:10.5px; font-weight:700; }
  .footer { display: flex; justify-content: space-between; padding: 12px 28px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #9ca3af; margin-top: 8px; }
  .print-btn { position: fixed; bottom: 24px; right: 24px; background: #FFD700; color: #000; border: none; padding: 12px 24px; border-radius: 10px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; box-shadow: 0 4px 16px rgba(0,0,0,.15); }
  @media print { .print-btn { display:none; } body { background:#fff; } .page { padding-bottom:0; } }
</style>
</head>
<body>
<div class="page">

  <div class="header">
    <div class="header-logo">
      <div class="logo-icon">⚡</div>
      <div><div class="logo-text">Belenergy</div><div class="logo-sub">Support Pro</div></div>
    </div>
    <div class="header-right">
      <div class="header-title">Sessão de Contato</div>
      <div class="header-date">Gerado em ${new Date().toLocaleString('pt-BR')}</div>
    </div>
  </div>

  <!-- Session title bar -->
  <div class="session-title">
    📞 ${session.title}
    <span class="status-badge" style="font-size:10px;background:${session.status==='open'?'#dcfce7':'#f3f4f6'};color:${session.status==='open'?'#16a34a':'#6b7280'};margin-left:auto">
      ${session.status==='open'?'Em aberto':'Encerrada'}
    </span>
  </div>

  <!-- Contact + meta -->
  <div class="meta-strip">
    <div class="meta-item"><label>Contato</label><span>${entity?.name||'—'}</span></div>
    <div class="meta-item"><label>Categoria</label><span>${entity?.category||'—'}</span></div>
    ${entity?.phone ? `<div class="meta-item"><label>Telefone</label><span>${entity.phone}</span></div>` : ''}
    <div class="meta-item"><label>Total tentativas</label><span>${total}</span></div>
    ${lastRes ? `<div class="meta-item"><label>Último resultado</label><span style="color:${lastRes.color};font-weight:700">${lastRes.icon} ${lastRes.label}</span></div>` : ''}
    <div class="meta-item"><label>Criada em</label><span>${new Date(session.created_at).toLocaleDateString('pt-BR')}</span></div>
  </div>

  ${session.chamado ? `
  <!-- Linked chamado -->
  <div class="section">
    <div class="section-title">🔗 Chamado Vinculado</div>
    <div class="section-body">
      <div class="chamado-box">
        <div class="clabel">Protocolo #${session.chamado.id}</div>
        <div class="info-grid">
          <div class="info-item"><label>Cliente</label><span>${session.chamado.integrador||session.chamado.cliente_final||'—'}</span></div>
          <div class="info-item"><label>S/N</label><span>${session.chamado.sn||'—'}</span></div>
          <div class="info-item"><label>Fabricante</label><span>${session.chamado.fabricante||'—'}</span></div>
          <div class="info-item"><label>Status</label><span>${session.chamado.status||'—'}</span></div>
        </div>
        ${session.chamado.relato ? `<div style="margin-top:10px;font-size:12px;color:#374151;background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px">${session.chamado.relato.slice(0,200)}${session.chamado.relato.length>200?'...':''}</div>` : ''}
      </div>
    </div>
  </div>` : ''}

  ${session.notes ? `
  <div class="section">
    <div class="section-title">📝 Observações da Sessão</div>
    <div class="section-body" style="color:#374151;line-height:1.6">${session.notes}</div>
  </div>` : ''}

  <!-- Stats -->
  <div class="section">
    <div class="section-title">📊 Resumo</div>
    <div class="section-body">
      <div class="stats-grid">
        <div class="stat-card"><div class="val">${total}</div><div class="lbl">Total</div></div>
        <div class="stat-card"><div class="val" style="color:#16a34a">${reached}</div><div class="lbl">Atendeu</div></div>
        <div class="stat-card"><div class="val" style="color:#d97706">${total-reached}</div><div class="lbl">Sem resposta</div></div>
        <div class="stat-card"><div class="val" style="color:#2563eb">${Math.round(total?(reached/total)*100:0)}%</div><div class="lbl">Taxa contato</div></div>
      </div>
      <div style="margin-top:12px;display:flex;gap:14px;flex-wrap:wrap">
        ${Object.entries(stats).map(([key,count]) => {
          const r = RESULT_MAP[key]||RESULT_MAP.other;
          return `<span style="font-size:11px;color:#374151">${r.icon} ${r.label}: <strong>${count}</strong></span>`;
        }).join('')}
      </div>
    </div>
  </div>

  <!-- Attempts timeline -->
  <div class="section">
    <div class="section-title">🕐 Tentativas (${total})</div>
    ${total===0?'<div style="padding:24px;text-align:center;color:#9ca3af">Nenhuma tentativa registrada</div>':''}
    ${attempts.map((a,i) => {
      const r   = RESULT_MAP[a.result]||RESULT_MAP.other;
      const dt  = new Date(a.attempted_at);
      const dateStr = dt.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'});
      const timeStr = dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
      return `
      <div class="attempt">
        <div class="attempt-icon" style="background:${r.color}18;border:1px solid ${r.color}30">${r.icon}</div>
        <div style="flex:1;min-width:0">
          <div class="attempt-result" style="color:${r.color}">${r.label}</div>
          <div class="attempt-author">por ${a.author}</div>
          <div class="attempt-meta">📅 ${dateStr} &nbsp;⏱ ${timeStr}</div>
          ${a.notes?`<div class="attempt-notes">${a.notes}</div>`:''}
          ${(a.metadata?.attachments||[]).length > 0 ? `
          <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px">
            ${(a.metadata.attachments||[]).map(att => `
              <a href="${att.url}" target="_blank" style="display:inline-flex;align-items:center;gap:4px;font-size:10.5px;color:#2563eb;font-weight:600;text-decoration:none;background:#eff6ff;border:1px solid #bfdbfe;padding:2px 8px;border-radius:999px">
                📎 ${att.name}
              </a>`).join('')}
          </div>` : ''}
        </div>
        <div style="font-size:11px;color:#9ca3af;white-space:nowrap;margin-top:2px">#${i+1}</div>
      </div>`;
    }).join('')}
  </div>

  <!-- Signature -->
  <div class="section">
    <div class="section-title">✍️ Responsável</div>
    <div class="section-body">
      <div style="display:flex;gap:40px;margin-top:8px">
        <div style="flex:1"><div style="border-bottom:1px solid #d1d5db;height:40px;margin-bottom:6px"></div><div style="font-size:10px;color:#9ca3af;text-align:center">Técnico responsável</div></div>
        <div style="flex:1"><div style="border-bottom:1px solid #d1d5db;height:40px;margin-bottom:6px"></div><div style="font-size:10px;color:#9ca3af;text-align:center">Data</div></div>
      </div>
    </div>
  </div>

  <div class="footer">
    <span>Belenergy Support Pro — Sessão de Contato: ${session.title}</span>
    <span>Gerado em ${new Date().toLocaleString('pt-BR')}</span>
  </div>
</div>
<button class="print-btn" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Contact session report error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

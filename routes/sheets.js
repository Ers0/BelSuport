// routes/sheets.js — Google Sheets weekly export + approval email notifications
'use strict';

const express  = require('express');
const router   = express.Router();
const path     = require('path');
const fs       = require('fs');
const { google }       = require('googleapis');
const { supabaseAdmin } = require('../services/db');
const { authMiddleware } = require('./auth');
const nodemailer = require('nodemailer');

const BASE_PATH        = path.resolve(__dirname, '..');
const CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH || path.join(BASE_PATH, 'credentials.json');

// ── Build OAuth2 client ───────────────────────────────────────────────────────
async function getOAuth2(userId) {
  const raw = process.env.GOOGLE_CREDENTIALS_JSON
    ? JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON)
    : JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const creds  = raw.installed || raw.web;
  const oauth2 = new google.auth.OAuth2(creds.client_id, creds.client_secret, creds.redirect_uris[0]);
  const { data: su } = await supabaseAdmin
    .from('settings_user').select('google_token').eq('user_id', userId).maybeSingle();
  if (!su?.google_token) throw new Error('Drive não autenticado');
  oauth2.setCredentials(su.google_token);
  return oauth2;
}

// ── Mailer ────────────────────────────────────────────────────────────────────
async function sendEmail({ to, subject, html }) {
  let transporter;
  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT)||587, secure:false, auth:{ user:process.env.SMTP_USER, pass:process.env.SMTP_PASS } });
  } else if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    transporter = nodemailer.createTransport({ service:'gmail', auth:{ user:process.env.GMAIL_USER, pass:process.env.GMAIL_APP_PASSWORD } });
  } else { console.warn('[Email] No SMTP configured'); return; }
  await transporter.sendMail({ from:`"Belenergy Support Pro" <${process.env.GMAIL_USER||process.env.SMTP_USER}>`, to, subject, html });
}

// ── Email templates (all in Portuguese) ──────────────────────────────────────

const BASE_STYLE = `
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Arial,sans-serif;background:#f0f2f5;color:#1a1a2e;font-size:14px;line-height:1.6}
    .wrap{max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)}
    .header{background:linear-gradient(135deg,#0C0E16 0%,#1C1F2E 100%);padding:32px 40px;text-align:center}
    .logo{display:inline-flex;align-items:center;gap:10px;margin-bottom:4px}
    .logo-icon{width:40px;height:40px;background:linear-gradient(135deg,#FFD700,#FF8C00);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;line-height:1}
    .logo-text{color:#fff;font-size:18px;font-weight:800;letter-spacing:-.02em}
    .logo-sub{color:#6B7694;font-size:11px;margin-top:2px}
    .badge{display:inline-block;padding:4px 14px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-top:12px}
    .body{padding:36px 40px}
    .greeting{font-size:22px;font-weight:800;color:#0C0E16;margin-bottom:12px}
    .text{color:#374151;font-size:14px;line-height:1.7;margin-bottom:16px}
    .info-box{background:#f8f9fb;border:1px solid #e5e7eb;border-radius:10px;padding:18px 20px;margin:20px 0}
    .info-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #e5e7eb}
    .info-row:last-child{border-bottom:none}
    .info-label{font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em}
    .info-value{font-size:14px;font-weight:700;color:#1a1a2e}
    .btn{display:block;text-align:center;padding:15px 32px;background:#FFD700;color:#000;border-radius:10px;text-decoration:none;font-weight:800;font-size:15px;margin:24px 0}
    .btn:hover{background:#FFC400}
    .divider{height:1px;background:#e5e7eb;margin:24px 0}
    .footer{padding:20px 40px;border-top:1px solid #f3f4f6;text-align:center}
    .footer p{color:#9ca3af;font-size:11px;line-height:1.6}
    .highlight{color:#FFD700;font-weight:700}
    .role-master{background:rgba(239,68,68,.1);color:#dc2626;border:1px solid rgba(239,68,68,.2)}
    .role-admin{background:rgba(255,215,0,.1);color:#b45309;border:1px solid rgba(255,215,0,.3)}
    .role-technician{background:rgba(96,165,250,.1);color:#1d4ed8;border:1px solid rgba(96,165,250,.2)}
  </style>`;

// ── 1. Acesso solicitado (para admins/masters) — novo usuário tentou entrar ──
function accessRequestEmailHtml(requesterName, requesterEmail, appUrl) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${BASE_STYLE}</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="logo">
      <div class="logo-icon">⚡</div>
      <div>
        <div class="logo-text">Belenergy Support Pro</div>
        <div class="logo-sub">Sistema de Suporte Técnico</div>
      </div>
    </div>
    <div class="badge" style="background:rgba(255,215,0,.15);color:#FFD700;border:1px solid rgba(255,215,0,.3)">
      🔔 Novo Pedido de Acesso
    </div>
  </div>
  <div class="body">
    <div class="greeting">Um novo usuário quer entrar no sistema</div>
    <p class="text">
      Um usuário tentou acessar o Belenergy Support Pro mas ainda não possui autorização.
      Revise os dados abaixo e aprove ou recuse o acesso diretamente na plataforma.
    </p>
    <div class="info-box">
      <div class="info-row">
        <span class="info-label">Nome</span>
        <span class="info-value">${requesterName}</span>
      </div>
      <div class="info-row">
        <span class="info-label">E-mail</span>
        <span class="info-value">${requesterEmail}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Data da solicitação</span>
        <span class="info-value">${new Date().toLocaleString('pt-BR')}</span>
      </div>
    </div>
    <p class="text">
      Para aprovar ou recusar, acesse a aba <strong>Configurações → Aprovações</strong> no sistema.
    </p>
    <a href="${appUrl}/configuracoes" class="btn">
      Gerenciar Aprovações →
    </a>
    <div class="divider"></div>
    <p class="text" style="font-size:12px;color:#9ca3af">
      Se você não reconhece este usuário, simplesmente ignore este e-mail. O acesso não será liberado sem sua aprovação.
    </p>
  </div>
  <div class="footer">
    <p>Belenergy Support Pro · ${new Date().getFullYear()}<br>Este é um e-mail automático, não responda.</p>
  </div>
</div>
</body></html>`;
}

// ── 2. Acesso aprovado (para o usuário aprovado por master/admin) ─────────────
function approvedEmailHtml(name, role) {
  const roles = {
    master:     { label:'Master', cls:'role-master', desc:'Acesso total ao sistema, incluindo gerenciamento de usuários e configurações globais.' },
    admin:      { label:'Administrador', cls:'role-admin', desc:'Acesso completo aos chamados, relatórios, configurações e aprovação de usuários.' },
    technician: { label:'Técnico', cls:'role-technician', desc:'Acesso aos chamados, registros de suporte e ferramentas de diagnóstico.' },
  };
  const r = roles[role] || roles.technician;
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${BASE_STYLE}</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="logo">
      <div class="logo-icon">⚡</div>
      <div>
        <div class="logo-text">Belenergy Support Pro</div>
        <div class="logo-sub">Sistema de Suporte Técnico</div>
      </div>
    </div>
    <div class="badge" style="background:rgba(34,197,94,.15);color:#16a34a;border:1px solid rgba(34,197,94,.3)">
      ✅ Acesso Aprovado
    </div>
  </div>
  <div class="body">
    <div class="greeting">Olá, ${name}! 👋</div>
    <p class="text">
      Sua solicitação de acesso ao <strong>Belenergy Support Pro</strong> foi <span style="color:#16a34a;font-weight:700">aprovada</span>.
      Você já pode entrar no sistema com sua conta Google.
    </p>
    <div class="info-box">
      <div class="info-row">
        <span class="info-label">Perfil de acesso</span>
        <span class="badge ${r.cls}" style="font-size:12px">${r.label}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Permissões</span>
        <span class="info-value" style="font-size:12px;text-align:right;max-width:280px">${r.desc}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Data de aprovação</span>
        <span class="info-value">${new Date().toLocaleString('pt-BR')}</span>
      </div>
    </div>
    <a href="${process.env.APP_URL || 'http://localhost:3000'}" class="btn">
      ⚡ Entrar no sistema agora
    </a>
    <div class="divider"></div>
    <p class="text" style="font-size:12px;color:#9ca3af">
      Em caso de dúvidas sobre seu acesso, entre em contato com o administrador do sistema.
    </p>
  </div>
  <div class="footer">
    <p>Belenergy Support Pro · ${new Date().getFullYear()}<br>Este é um e-mail automático, não responda.</p>
  </div>
</div>
</body></html>`;
}

// ── 3. Pré-aprovado — enviado quando o usuário pré-aprovado faz login ─────────
function preApprovedEmailHtml(name, role) {
  const roles = {
    master:     { label:'Master',        cls:'role-master' },
    admin:      { label:'Administrador', cls:'role-admin' },
    technician: { label:'Técnico',       cls:'role-technician' },
  };
  const r = roles[role] || roles.technician;
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${BASE_STYLE}</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="logo">
      <div class="logo-icon">⚡</div>
      <div>
        <div class="logo-text">Belenergy Support Pro</div>
        <div class="logo-sub">Sistema de Suporte Técnico</div>
      </div>
    </div>
    <div class="badge" style="background:rgba(96,165,250,.15);color:#1d4ed8;border:1px solid rgba(96,165,250,.3)">
      🎉 Conta Ativada
    </div>
  </div>
  <div class="body">
    <div class="greeting">Bem-vindo ao Belenergy, ${name}!</div>
    <p class="text">
      Sua conta no <strong>Belenergy Support Pro</strong> foi ativada com sucesso.
      O administrador já configurou seu acesso antes mesmo do seu primeiro login — você está pronto para começar!
    </p>
    <div class="info-box">
      <div class="info-row">
        <span class="info-label">Perfil de acesso</span>
        <span class="badge ${r.cls}" style="font-size:12px">${r.label}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Primeiro acesso</span>
        <span class="info-value">${new Date().toLocaleString('pt-BR')}</span>
      </div>
    </div>
    <p class="text">
      Dicas para começar:
    </p>
    <ul style="color:#374151;font-size:14px;line-height:2;margin:0 0 20px 20px">
      <li>Acesse <strong>Registro</strong> para criar novos chamados</li>
      <li>Use o <strong>Dashboard</strong> para acompanhar o desempenho da equipe</li>
      <li>Configure suas preferências em <strong>Configurações</strong></li>
    </ul>
    <a href="${process.env.APP_URL || 'http://localhost:3000'}" class="btn">
      ⚡ Entrar no sistema
    </a>
  </div>
  <div class="footer">
    <p>Belenergy Support Pro · ${new Date().getFullYear()}<br>Este é um e-mail automático, não responda.</p>
  </div>
</div>
</body></html>`;
}

// ── Core export function — reused by manual + cron ────────────────────────────
async function runExport(userId) {
  const oauth2 = await getOAuth2(userId);
  const sheets = google.sheets({ version: 'v4', auth: oauth2 });
  const drive  = google.drive({ version: 'v3', auth: oauth2 });

  // Fetch all data in parallel
  const [
    { data: cases },
    { data: reminders },
    { data: solutions },
    { data: clients },
    { data: products },
  ] = await Promise.all([
    supabaseAdmin.from('chamados').select('*').order('id', { ascending: false }),
    supabaseAdmin.from('reminders').select('*').order('created_at', { ascending: false }),
    supabaseAdmin.from('solutions').select('id,title,fabricante,categoria,author,created_at').order('created_at', { ascending: false }),
    supabaseAdmin.from('chamados').select('integrador,cliente_final,contato,tel_integrador,fabricante').order('id', { ascending: false }),
    supabaseAdmin.from('fabricantes').select('nome').order('nome'),
  ]);

  const now  = new Date();
  const week = `${now.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' })} — ${now.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' })}`;

  // Sheet IDs
  const SH = { resumo:0, pendentes:1, aguardando:2, concluidos:3, clientes:4, agenda:5, solucoes:6, produtos:7, historico:8 };

  // ── Check if spreadsheet already exists in settings ───────────────────────
  const { data: su } = await supabaseAdmin
    .from('settings_user').select('drive_id, sheets_export_id, google_token').eq('user_id', userId).maybeSingle();

  let ssId = su?.sheets_export_id || null;
  let isNew = false;

  // Verify existing spreadsheet is still accessible
  if (ssId) {
    try {
      await sheets.spreadsheets.get({ spreadsheetId: ssId, fields: 'spreadsheetId' });
    } catch (_) {
      ssId = null; // deleted or no access — create new
    }
  }

  if (!ssId) {
    isNew = true;
    const title = `Belenergy — Relatorio Semanal`;
    const { data: created } = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title, locale: 'pt_BR' },
        sheets: [
          { properties: { sheetId: SH.resumo,     title: 'Resumo',               index: 0 } },
          { properties: { sheetId: SH.pendentes,  title: 'Pendentes',            index: 1 } },
          { properties: { sheetId: SH.aguardando, title: 'Aguardando Protocolo', index: 2 } },
          { properties: { sheetId: SH.concluidos, title: 'Concluidos',           index: 3 } },
          { properties: { sheetId: SH.clientes,   title: 'Clientes',             index: 4 } },
          { properties: { sheetId: SH.agenda,     title: 'Agenda',               index: 5 } },
          { properties: { sheetId: SH.solucoes,   title: 'Solucoes',             index: 6 } },
          { properties: { sheetId: SH.produtos,   title: 'Produtos',             index: 7 } },
          { properties: { sheetId: SH.historico,  title: 'Historico Completo',   index: 8 } },
        ],
      },
    });
    ssId = created.spreadsheetId;

    // Save to settings_user
    await supabaseAdmin.from('settings_user').update({ sheets_export_id: ssId }).eq('user_id', userId);

    // Move to Drive folder
    if (su?.drive_id) {
      await drive.files.update({ fileId: ssId, addParents: su.drive_id, fields: 'id,parents' }).catch(() => {});
    }
  } else {
    // Clear existing data from all sheets
    await sheets.spreadsheets.values.batchClear({
      spreadsheetId: ssId,
      requestBody: {
        ranges: ['Resumo','Pendentes',"'Aguardando Protocolo'",'Concluidos','Clientes','Agenda','Solucoes','Produtos',"'Historico Completo'"],
      },
    }).catch(() => {});
  }

  // ── Build data ────────────────────────────────────────────────────────────
  const total   = cases?.length || 0;
  const pct     = n => total ? `${Math.round(n/total*100)}%` : '0%';
  const pending   = (cases||[]).filter(c => c.status === 'Pendente Itens');
  const awaiting  = (cases||[]).filter(c => c.status === 'Aguardando Protocolo' || c.status === 'Aguardando ADB');
  const concluded = (cases||[]).filter(c => c.status === 'Concluído');

  // By fabricante
  const byFab = {};
  (cases||[]).forEach(c => { const f=c.fabricante||'Outros'; byFab[f]=(byFab[f]||0)+1; });
  const fabEntries = Object.entries(byFab).sort((a,b)=>b[1]-a[1]);

  // By technician
  const byTech = {};
  (cases||[]).forEach(c => {
    const t=c.nome||'Sem técnico';
    if(!byTech[t]) byTech[t]={total:0,pendentes:0,concluidos:0};
    byTech[t].total++;
    if(c.status==='Pendente Itens') byTech[t].pendentes++;
    if(c.status==='Concluído') byTech[t].concluidos++;
  });

  // Unique clients
  const clientMap = {};
  (clients||[]).forEach(c => {
    const name = c.integrador||c.cliente_final; if(!name) return;
    const key  = name.toLowerCase();
    if(!clientMap[key]) clientMap[key]={nome:name,contato:c.contato||c.tel_integrador||'',fabricante:c.fabricante||'',chamados:0};
    clientMap[key].chamados++;
  });

  const CASE_H = [['ID','Data','Hora','Integrador','Cliente Final','S/N','Modelo','Fabricante','Categoria','Status','Protocolo','Tecnico','Relato','Drive']];
  const caseRow = c => [
    c.id,c.data,c.hora,c.integrador||'',c.cliente_final||'',
    c.sn||'',c.modelo||'',c.fabricante||'',c.categoria||'',
    c.status||'',c.adb_number||c.jira_key||'',c.nome||'',
    (c.relato||'').slice(0,200),
    c.drive_id?`https://drive.google.com/drive/folders/${c.drive_id}`:'',
  ];

  // Summary rows — with spacing for charts
  const summaryRows = [
    ['Belenergy Support Pro — Relatorio Semanal'],
    ['Atualizado em:', now.toLocaleString('pt-BR')],
    ['Periodo:', week],
    [],
    ['STATUS', 'QUANTIDADE', '% DO TOTAL'],
    ['Pendentes',            pending.length,   pct(pending.length)],
    ['Aguardando Protocolo', awaiting.length,  pct(awaiting.length)],
    ['Concluidos',           concluded.length, pct(concluded.length)],
    ['Total',                total,            '100%'],
    [],
    ['FABRICANTE', 'CHAMADOS'],
    ...fabEntries.map(([f,n])=>[f,n]),
    [],
    ['TECNICO', 'TOTAL', 'PENDENTES', 'CONCLUIDOS'],
    ...Object.entries(byTech).sort((a,b)=>b[1].total-a[1].total).map(([t,v])=>[t,v.total,v.pendentes,v.concluidos]),
    [],
    ['VISAO GERAL',''],
    ['Clientes unicos', Object.keys(clientMap).length],
    ['Solucoes cadastradas', solutions?.length||0],
    ['Lembretes na agenda', reminders?.length||0],
  ];

  // Write all data
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: ssId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: 'Resumo!A1',                  values: summaryRows },
        { range: 'Pendentes!A1',               values: [...CASE_H, ...pending.map(caseRow)] },
        { range: "'Aguardando Protocolo'!A1",  values: [...CASE_H, ...awaiting.map(caseRow)] },
        { range: 'Concluidos!A1',              values: [...CASE_H, ...concluded.map(caseRow)] },
        { range: 'Clientes!A1',                values: [['Nome','Contato','Fabricante','Chamados'], ...Object.values(clientMap).sort((a,b)=>b.chamados-a.chamados).map(c=>[c.nome,c.contato,c.fabricante,c.chamados])] },
        { range: 'Agenda!A1',                  values: [['ID','Cliente','Telefone','Nota','Data Retorno','Status','Prioridade','Criado em'], ...(reminders||[]).map(r=>[r.id,r.client_name||'',r.phone||'',r.note||'',r.return_date||'',r.status||'',r.priority||'',r.created_at?new Date(r.created_at).toLocaleDateString('pt-BR'):''])] },
        { range: 'Solucoes!A1',                values: [['ID','Titulo','Fabricante','Categoria','Autor','Data'], ...(solutions||[]).map(s=>[s.id,s.title||'',s.fabricante||'',s.categoria||'',s.author||'',s.created_at?new Date(s.created_at).toLocaleDateString('pt-BR'):''])] },
        { range: 'Produtos!A1',                values: [['Fabricante'], ...(products||[]).map(p=>[p.nome])] },
        { range: "'Historico Completo'!A1",    values: [...CASE_H, ...(cases||[]).map(caseRow)] },
      ],
    },
  });


  // ── Belenergy color palette ────────────────────────────────────────────────
  const C = {
    bg:      { red:0.047, green:0.055, blue:0.086 },  // #0C0E16
    s1:      { red:0.075, green:0.086, blue:0.129 },  // #131621
    s2:      { red:0.110, green:0.122, blue:0.180 },  // #1C1F2E
    s3:      { red:0.141, green:0.157, blue:0.251 },  // #242840
    yellow:  { red:1.000, green:0.843, blue:0.000 },  // #FFD700
    orange:  { red:0.984, green:0.620, blue:0.235 },  // #FB923C
    green:   { red:0.133, green:0.773, blue:0.369 },  // #22C55E
    red:     { red:0.937, green:0.267, blue:0.267 },  // #EF4444
    blue:    { red:0.376, green:0.647, blue:0.980 },  // #60A5FA
    purple:  { red:0.655, green:0.545, blue:0.980 },  // #A78BFA
    tx:      { red:0.933, green:0.941, blue:0.973 },  // #EEF0F8
    tm:      { red:0.420, green:0.463, blue:0.580 },  // #6B7694
    white:   { red:1.000, green:1.000, blue:1.000 },
  };

  function cell(bg, fg, bold=false, fontSize=10, italic=false) {
    return { userEnteredFormat: {
      backgroundColor: bg,
      textFormat: { bold, italic, fontSize, foregroundColor: fg },
      verticalAlignment: 'MIDDLE',
      padding: { top:4, bottom:4, left:8, right:8 },
    }};
  }

  function border(color) {
    return { style:'SOLID', colorStyle:{ rgbColor:color } };
  }

  function borders(c) {
    return { top:border(c), bottom:border(c), left:border(c), right:border(c) };
  }

  const dataSheetIds = [SH.pendentes,SH.aguardando,SH.concluidos,SH.clientes,SH.agenda,SH.solucoes,SH.produtos,SH.historico];
  const allSheetIds  = Object.values(SH);

  const techCount = Object.keys(byTech).length;
  const fabCount  = fabEntries.length;
  const techHeaderRow = 12 + fabCount; // row index of technician header

  const formatRequests = [
    // ── Global: dark background on all sheets ─────────────────────────────
    ...allSheetIds.map(sheetId => ({
      repeatCell: {
        range: { sheetId, startRowIndex:0, endRowIndex:1000, startColumnIndex:0, endColumnIndex:20 },
        cell: cell(C.s1, C.tx),
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)',
      },
    })),

    // ── Data tabs: yellow header row ──────────────────────────────────────
    ...dataSheetIds.map(sheetId => ({
      repeatCell: {
        range: { sheetId, startRowIndex:0, endRowIndex:1 },
        cell: { userEnteredFormat: {
          backgroundColor: C.bg,
          textFormat: { bold:true, fontSize:10, foregroundColor:C.yellow },
          verticalAlignment: 'MIDDLE',
          padding: { top:6, bottom:6, left:8, right:8 },
        }},
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)',
      },
    })),

    // ── Data tabs: alternating row colors ─────────────────────────────────
    ...dataSheetIds.flatMap(sheetId =>
      Array.from({ length:200 }, (_, i) => i + 1).filter(i => i % 2 === 0).map(i => ({
        repeatCell: {
          range: { sheetId, startRowIndex:i, endRowIndex:i+1, startColumnIndex:0, endColumnIndex:20 },
          cell: { userEnteredFormat: { backgroundColor:C.s2 } },
          fields: 'userEnteredFormat.backgroundColor',
        },
      }))
    ),

    // ── Cases tabs: color-code status column (col 9) ──────────────────────
    // Pendentes tab — orange tint on all rows
    { repeatCell: {
      range: { sheetId:SH.pendentes, startRowIndex:1, endRowIndex:500, startColumnIndex:9, endColumnIndex:10 },
      cell: { userEnteredFormat: { textFormat:{ bold:true, foregroundColor:C.orange } } },
      fields: 'userEnteredFormat.textFormat',
    }},
    // Aguardando tab — blue tint
    { repeatCell: {
      range: { sheetId:SH.aguardando, startRowIndex:1, endRowIndex:500, startColumnIndex:9, endColumnIndex:10 },
      cell: { userEnteredFormat: { textFormat:{ bold:true, foregroundColor:C.blue } } },
      fields: 'userEnteredFormat.textFormat',
    }},
    // Concluidos tab — green tint
    { repeatCell: {
      range: { sheetId:SH.concluidos, startRowIndex:1, endRowIndex:500, startColumnIndex:9, endColumnIndex:10 },
      cell: { userEnteredFormat: { textFormat:{ bold:true, foregroundColor:C.green } } },
      fields: 'userEnteredFormat.textFormat',
    }},

    // ── Resumo: title row ─────────────────────────────────────────────────
    { repeatCell: {
      range: { sheetId:SH.resumo, startRowIndex:0, endRowIndex:1 },
      cell: { userEnteredFormat: {
        backgroundColor: C.bg,
        textFormat: { bold:true, fontSize:16, foregroundColor:C.yellow },
        verticalAlignment: 'MIDDLE',
        padding: { top:10, bottom:10, left:12, right:12 },
      }},
      fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)',
    }},
    // Resumo: subtitle rows (generated at, period)
    { repeatCell: {
      range: { sheetId:SH.resumo, startRowIndex:1, endRowIndex:3 },
      cell: { userEnteredFormat: { backgroundColor:C.s2, textFormat:{ fontSize:10, foregroundColor:C.tm } } },
      fields: 'userEnteredFormat(backgroundColor,textFormat)',
    }},

    // ── Resumo: STATUS section header ─────────────────────────────────────
    { repeatCell: {
      range: { sheetId:SH.resumo, startRowIndex:4, endRowIndex:5 },
      cell: { userEnteredFormat: {
        backgroundColor: C.s3,
        textFormat: { bold:true, fontSize:10, foregroundColor:C.yellow },
        verticalAlignment: 'MIDDLE', padding:{ top:6,bottom:6,left:8,right:8 },
      }},
      fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)',
    }},
    // Pendentes row — orange
    { repeatCell: {
      range: { sheetId:SH.resumo, startRowIndex:5, endRowIndex:6 },
      cell: { userEnteredFormat: { backgroundColor:C.s2, textFormat:{ foregroundColor:C.orange, bold:true } } },
      fields: 'userEnteredFormat(backgroundColor,textFormat)',
    }},
    // Aguardando row — blue
    { repeatCell: {
      range: { sheetId:SH.resumo, startRowIndex:6, endRowIndex:7 },
      cell: { userEnteredFormat: { backgroundColor:C.s1, textFormat:{ foregroundColor:C.blue, bold:true } } },
      fields: 'userEnteredFormat(backgroundColor,textFormat)',
    }},
    // Concluidos row — green
    { repeatCell: {
      range: { sheetId:SH.resumo, startRowIndex:7, endRowIndex:8 },
      cell: { userEnteredFormat: { backgroundColor:C.s2, textFormat:{ foregroundColor:C.green, bold:true } } },
      fields: 'userEnteredFormat(backgroundColor,textFormat)',
    }},
    // Total row — yellow bold
    { repeatCell: {
      range: { sheetId:SH.resumo, startRowIndex:8, endRowIndex:9 },
      cell: { userEnteredFormat: { backgroundColor:C.s3, textFormat:{ foregroundColor:C.yellow, bold:true, fontSize:11 } } },
      fields: 'userEnteredFormat(backgroundColor,textFormat)',
    }},

    // ── Resumo: FABRICANTE section header ─────────────────────────────────
    { repeatCell: {
      range: { sheetId:SH.resumo, startRowIndex:10, endRowIndex:11 },
      cell: { userEnteredFormat: {
        backgroundColor: C.s3,
        textFormat: { bold:true, fontSize:10, foregroundColor:C.blue },
        verticalAlignment: 'MIDDLE', padding:{ top:6,bottom:6,left:8,right:8 },
      }},
      fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)',
    }},
    // Fab rows alternating
    ...Array.from({ length: fabCount }, (_, i) => ({
      repeatCell: {
        range: { sheetId:SH.resumo, startRowIndex:11+i, endRowIndex:12+i },
        cell: { userEnteredFormat: { backgroundColor: i%2===0 ? C.s1 : C.s2 } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    })),

    // ── Resumo: TECNICO section header ────────────────────────────────────
    { repeatCell: {
      range: { sheetId:SH.resumo, startRowIndex:techHeaderRow, endRowIndex:techHeaderRow+1 },
      cell: { userEnteredFormat: {
        backgroundColor: C.s3,
        textFormat: { bold:true, fontSize:10, foregroundColor:C.green },
        verticalAlignment: 'MIDDLE', padding:{ top:6,bottom:6,left:8,right:8 },
      }},
      fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)',
    }},
    // Tech rows alternating
    ...Array.from({ length: techCount }, (_, i) => ({
      repeatCell: {
        range: { sheetId:SH.resumo, startRowIndex:techHeaderRow+1+i, endRowIndex:techHeaderRow+2+i },
        cell: { userEnteredFormat: { backgroundColor: i%2===0 ? C.s1 : C.s2 } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    })),

    // ── Resumo: VISAO GERAL footer ────────────────────────────────────────
    { repeatCell: {
      range: { sheetId:SH.resumo, startRowIndex:techHeaderRow+techCount+2, endRowIndex:techHeaderRow+techCount+6 },
      cell: { userEnteredFormat: { backgroundColor:C.s2, textFormat:{ foregroundColor:C.tm } } },
      fields: 'userEnteredFormat(backgroundColor,textFormat)',
    }},

    // ── Freeze header rows ────────────────────────────────────────────────
    ...dataSheetIds.map(sheetId => ({
      updateSheetProperties: { properties:{ sheetId, gridProperties:{ frozenRowCount:1 } }, fields:'gridProperties.frozenRowCount' },
    })),

    // ── Auto-resize all columns ───────────────────────────────────────────
    ...allSheetIds.map(sheetId => ({
      autoResizeDimensions: { dimensions:{ sheetId, dimension:'COLUMNS', startIndex:0, endIndex:14 } },
    })),

    // ── Tab colors ────────────────────────────────────────────────────────
    { updateSheetProperties: { properties:{ sheetId:SH.resumo,     tabColorStyle:{ rgbColor:C.yellow  } }, fields:'tabColorStyle' } },
    { updateSheetProperties: { properties:{ sheetId:SH.pendentes,  tabColorStyle:{ rgbColor:C.orange  } }, fields:'tabColorStyle' } },
    { updateSheetProperties: { properties:{ sheetId:SH.aguardando, tabColorStyle:{ rgbColor:C.blue    } }, fields:'tabColorStyle' } },
    { updateSheetProperties: { properties:{ sheetId:SH.concluidos, tabColorStyle:{ rgbColor:C.green   } }, fields:'tabColorStyle' } },
    { updateSheetProperties: { properties:{ sheetId:SH.clientes,   tabColorStyle:{ rgbColor:C.purple  } }, fields:'tabColorStyle' } },
    { updateSheetProperties: { properties:{ sheetId:SH.agenda,     tabColorStyle:{ rgbColor:C.blue    } }, fields:'tabColorStyle' } },
    { updateSheetProperties: { properties:{ sheetId:SH.solucoes,   tabColorStyle:{ rgbColor:C.green   } }, fields:'tabColorStyle' } },
    { updateSheetProperties: { properties:{ sheetId:SH.produtos,   tabColorStyle:{ rgbColor:C.tm      } }, fields:'tabColorStyle' } },
    { updateSheetProperties: { properties:{ sheetId:SH.historico,  tabColorStyle:{ rgbColor:C.s3      } }, fields:'tabColorStyle' } },
  ];

  // Split into batches of 30 to avoid API limits
  for (let i = 0; i < formatRequests.length; i += 30) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: ssId,
      requestBody: { requests: formatRequests.slice(i, i + 30) },
    });
  }

  // ── Charts on Resumo tab ──────────────────────────────────────────────────
  // Only add charts on first creation to avoid duplicates on update
  if (isNew) {
    const chartBg = { rgbColor: C.s2 };
    const titleFmt = { bold:true, fontSize:12, foregroundColor:C.yellow };

    const chartRequests = [
      // ── Pie: status breakdown ──────────────────────────────────────────
      { addChart: { chart: {
        spec: {
          title: 'Chamados por Status',
          titleTextFormat: titleFmt,
          backgroundColorStyle: chartBg,
          pieChart: {
            legendPosition: 'RIGHT_LEGEND',
            threeDimensional: false,
            domain: { data: { sourceRange: { sources: [{ sheetId:SH.resumo, startRowIndex:5, endRowIndex:8, startColumnIndex:0, endColumnIndex:1 }] } } },
            series: { data: { sourceRange: { sources: [{ sheetId:SH.resumo, startRowIndex:5, endRowIndex:8, startColumnIndex:1, endColumnIndex:2 }] } } },
          },
        },
        position: { overlayPosition: {
          anchorCell: { sheetId:SH.resumo, rowIndex:0, columnIndex:4 },
          widthPixels:400, heightPixels:260,
        }},
      }}},

      // ── Bar: by fabricante ────────────────────────────────────────────
      { addChart: { chart: {
        spec: {
          title: 'Chamados por Fabricante',
          titleTextFormat: titleFmt,
          backgroundColorStyle: chartBg,
          basicChart: {
            chartType: 'BAR',
            legendPosition: 'NO_LEGEND',
            axis: [
              { position:'BOTTOM_AXIS', title:'Chamados', format:{ foregroundColorStyle:{ rgbColor:C.tm } } },
              { position:'LEFT_AXIS',   title:'Fabricante', format:{ foregroundColorStyle:{ rgbColor:C.tm } } },
            ],
            domains: [{ domain: { data: { sourceRange: { sources: [{ sheetId:SH.resumo, startRowIndex:11, endRowIndex:11+fabCount, startColumnIndex:0, endColumnIndex:1 }] } } } }],
            series: [{
              data: { sourceRange: { sources: [{ sheetId:SH.resumo, startRowIndex:11, endRowIndex:11+fabCount, startColumnIndex:1, endColumnIndex:2 }] } },
              color: C.yellow,
            }],
            headerCount: 0,
          },
        },
        position: { overlayPosition: {
          anchorCell: { sheetId:SH.resumo, rowIndex:10, columnIndex:4 },
          widthPixels:400, heightPixels: Math.max(220, fabCount * 28),
        }},
      }}},

      // ── Column: by technician ─────────────────────────────────────────
      { addChart: { chart: {
        spec: {
          title: 'Chamados por Técnico',
          titleTextFormat: titleFmt,
          backgroundColorStyle: chartBg,
          basicChart: {
            chartType: 'COLUMN',
            legendPosition: 'BOTTOM_LEGEND',
            axis: [
              { position:'BOTTOM_AXIS', title:'Técnico', format:{ foregroundColorStyle:{ rgbColor:C.tm } } },
              { position:'LEFT_AXIS',   title:'Chamados', format:{ foregroundColorStyle:{ rgbColor:C.tm } } },
            ],
            domains: [{ domain: { data: { sourceRange: { sources: [{ sheetId:SH.resumo, startRowIndex:techHeaderRow+1, endRowIndex:techHeaderRow+1+techCount, startColumnIndex:0, endColumnIndex:1 }] } } } }],
            series: [
              { data: { sourceRange: { sources: [{ sheetId:SH.resumo, startRowIndex:techHeaderRow+1, endRowIndex:techHeaderRow+1+techCount, startColumnIndex:1, endColumnIndex:2 }] } }, color:C.blue,   targetAxis:'LEFT_AXIS' },
              { data: { sourceRange: { sources: [{ sheetId:SH.resumo, startRowIndex:techHeaderRow+1, endRowIndex:techHeaderRow+1+techCount, startColumnIndex:2, endColumnIndex:3 }] } }, color:C.orange, targetAxis:'LEFT_AXIS' },
              { data: { sourceRange: { sources: [{ sheetId:SH.resumo, startRowIndex:techHeaderRow+1, endRowIndex:techHeaderRow+1+techCount, startColumnIndex:3, endColumnIndex:4 }] } }, color:C.green,  targetAxis:'LEFT_AXIS' },
            ],
            headerCount: 0,
          },
        },
        position: { overlayPosition: {
          anchorCell: { sheetId:SH.resumo, rowIndex:techHeaderRow, columnIndex:4 },
          widthPixels:420, heightPixels:280,
        }},
      }}},
    ];

    await sheets.spreadsheets.batchUpdate({ spreadsheetId:ssId, requestBody:{ requests:chartRequests } }).catch(e => {
      console.warn('[Sheets] Chart creation failed (non-fatal):', e.message);
    });
  }

  const url = `https://docs.google.com/spreadsheets/d/${ssId}/edit`;
  console.log(`[Sheets] Export ${isNew ? 'created' : 'updated'}: ${url}`);
  return { url, spreadsheetId: ssId, isNew };
}

// ── POST /api/sheets/export — Manual trigger ──────────────────────────────────
router.post('/export', authMiddleware, async (req, res) => {
  try {
    const result = await runExport(req.user.id);
    res.json({ success:true, ...result });
  } catch (e) {
    console.error('[Sheets] Export error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/sheets/link — Get current spreadsheet URL ───────────────────────
router.get('/link', authMiddleware, async (req, res) => {
  try {
    const { data: su } = await supabaseAdmin
      .from('settings_user').select('sheets_export_id').eq('user_id', req.user.id).maybeSingle();
    if (!su?.sheets_export_id) return res.json({ url: null });
    res.json({ url: `https://docs.google.com/spreadsheets/d/${su.sheets_export_id}/edit` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/cron/sheets — Vercel cron at 17:15 UTC-3 (20:15 UTC) ──────────
router.post('/cron', async (req, res) => {
  // Verify this is a Vercel cron call
  const authHeader = req.headers.authorization;
  if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    // Run export for all users that have Google auth + sheets_export_id
    const { data: users } = await supabaseAdmin
      .from('settings_user')
      .select('user_id, google_token, sheets_export_id')
      .not('google_token', 'is', null);

    const results = [];
    for (const u of (users||[])) {
      try {
        const result = await runExport(u.user_id);
        results.push({ user_id: u.user_id, ...result });
      } catch (e) {
        results.push({ user_id: u.user_id, error: e.message });
      }
    }
    console.log(`[Sheets Cron] Updated ${results.filter(r=>!r.error).length}/${results.length} sheets`);
    res.json({ success:true, results });
  } catch (e) {
    console.error('[Sheets Cron] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/sheets/send-approval-email ─────────────────────────────────────
router.post('/send-approval-email', authMiddleware, async (req, res) => {
  const { email, name, role } = req.body;
  try {
    await sendEmail({ to:email, subject:'✅ Seu acesso ao Belenergy Support Pro foi aprovado', html:approvedEmailHtml(name||email, role||'technician') });
    res.json({ success:true });
  } catch (e) { res.status(500).json({ error:e.message }); }
});

// ── 4. Convite — enviado quando admin pré-aprova um email novo ───────────────
function inviteEmailHtml(email, role) {
  const roles = {
    master:     { label:'Master',        cls:'role-master' },
    admin:      { label:'Administrador', cls:'role-admin' },
    technician: { label:'Técnico',       cls:'role-technician' },
  };
  const r = roles[role] || roles.technician;
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${BASE_STYLE}</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="logo">
      <div class="logo-icon">⚡</div>
      <div>
        <div class="logo-text">Belenergy Support Pro</div>
        <div class="logo-sub">Sistema de Suporte Técnico</div>
      </div>
    </div>
    <div class="badge" style="background:rgba(168,139,250,.15);color:#6d28d9;border:1px solid rgba(168,139,250,.3)">
      🎉 Você foi convidado
    </div>
  </div>
  <div class="body">
    <div class="greeting">Você recebeu um convite!</div>
    <p class="text">
      Você foi convidado para acessar o <strong>Belenergy Support Pro</strong>,
      o sistema de gestão de chamados técnicos da Belenergy.
      Seu acesso já está configurado e pronto para uso.
    </p>
    <div class="info-box">
      <div class="info-row">
        <span class="info-label">E-mail de acesso</span>
        <span class="info-value">${email}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Perfil atribuído</span>
        <span class="badge ${r.cls}" style="font-size:12px">${r.label}</span>
      </div>
    </div>
    <p class="text">
      Para entrar, clique no botão abaixo e faça login com sua conta Google.
      Não é necessário criar senha — o acesso é feito diretamente pelo Google.
    </p>
    <a href="${appUrl}" class="btn">
      ⚡ Acessar o sistema agora
    </a>
    <div class="divider"></div>
    <p class="text" style="font-size:12px;color:#9ca3af">
      Se você não esperava este convite, pode ignorar este e-mail com segurança.
      Nenhuma ação será tomada sem que você acesse o link acima.
    </p>
  </div>
  <div class="footer">
    <p>Belenergy Support Pro · ${new Date().getFullYear()}<br>Este é um e-mail automático, não responda.</p>
  </div>
</div>
</body></html>`;
}

module.exports = router;
module.exports.sendEmail = sendEmail;
module.exports.accessRequestEmailHtml = accessRequestEmailHtml;
module.exports.approvedEmailHtml = approvedEmailHtml;
module.exports.preApprovedEmailHtml = preApprovedEmailHtml;
module.exports.inviteEmailHtml = inviteEmailHtml;

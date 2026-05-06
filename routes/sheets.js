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

// ── Email templates ───────────────────────────────────────────────────────────
function approvedEmailHtml(name, role) {
  const roleLabel = { master:'Master', admin:'Admin', technician:'Técnico' }[role] || role;
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',sans-serif">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <div style="background:linear-gradient(135deg,#0f111a,#1a1d2e);padding:36px 40px;text-align:center">
      <div style="font-size:42px;margin-bottom:12px">⚡</div>
      <h1 style="color:#FFD700;font-size:22px;margin:0;font-weight:800">Belenergy Support Pro</h1>
    </div>
    <div style="padding:36px 40px">
      <h2 style="color:#1a1a2e;font-size:20px;margin:0 0 16px">✅ Seu acesso foi aprovado!</h2>
      <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 20px">Olá <strong>${name}</strong>, sua solicitação foi aprovada.</p>
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:16px 20px;margin-bottom:24px">
        <p style="margin:0;font-size:13px;color:#6b7280">Perfil de acesso</p>
        <p style="margin:6px 0 0;font-size:18px;font-weight:700;color:#1a1a2e">${roleLabel}</p>
      </div>
      <a href="${process.env.APP_URL||'http://localhost:3000'}" style="display:block;text-align:center;padding:14px;background:#FFD700;color:#000;border-radius:10px;text-decoration:none;font-weight:800;font-size:15px">Entrar no sistema →</a>
    </div>
  </div>
</body></html>`;
}

function accessRequestEmailHtml(requesterName, requesterEmail, appUrl) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',sans-serif">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <div style="background:linear-gradient(135deg,#0f111a,#1a1d2e);padding:36px 40px;text-align:center">
      <div style="font-size:42px;margin-bottom:12px">🔔</div>
      <h1 style="color:#FFD700;font-size:22px;margin:0;font-weight:800">Novo Pedido de Acesso</h1>
    </div>
    <div style="padding:36px 40px">
      <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 20px">Novo usuário solicitou acesso:</p>
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:16px 20px;margin-bottom:24px">
        <p style="margin:0;font-size:13px;color:#6b7280">Nome</p>
        <p style="margin:4px 0 12px;font-size:16px;font-weight:700;color:#1a1a2e">${requesterName}</p>
        <p style="margin:0;font-size:13px;color:#6b7280">Email</p>
        <p style="margin:4px 0 0;font-size:15px;color:#1a1a2e">${requesterEmail}</p>
      </div>
      <a href="${appUrl}/configuracoes" style="display:block;text-align:center;padding:14px;background:#FFD700;color:#000;border-radius:10px;text-decoration:none;font-weight:800;font-size:15px">Gerenciar Aprovações →</a>
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

  // ── Formatting ────────────────────────────────────────────────────────────
  const dataSheetIds = [SH.pendentes,SH.aguardando,SH.concluidos,SH.clientes,SH.agenda,SH.solucoes,SH.produtos,SH.historico];
  const allSheetIds  = Object.values(SH);

  const formatRequests = [
    // Dark header on all data tabs
    ...dataSheetIds.map(sheetId => ({
      repeatCell: {
        range: { sheetId, startRowIndex:0, endRowIndex:1 },
        cell: { userEnteredFormat: {
          backgroundColor: { red:0.06, green:0.07, blue:0.1 },
          textFormat: { bold:true, foregroundColor:{ red:1, green:0.843, blue:0 } },
        }},
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      },
    })),
    // Freeze header row
    ...dataSheetIds.map(sheetId => ({
      updateSheetProperties: { properties:{ sheetId, gridProperties:{ frozenRowCount:1 } }, fields:'gridProperties.frozenRowCount' },
    })),
    // Auto-resize
    ...allSheetIds.map(sheetId => ({
      autoResizeDimensions: { dimensions:{ sheetId, dimension:'COLUMNS', startIndex:0, endIndex:14 } },
    })),
    // Summary title style
    { repeatCell: { range:{ sheetId:SH.resumo, startRowIndex:0, endRowIndex:1 },
        cell:{ userEnteredFormat:{ textFormat:{ bold:true, fontSize:16, foregroundColor:{ red:1, green:0.843, blue:0 } } } },
        fields:'userEnteredFormat.textFormat' } },
    // Status header row (row 5, index 4) bold
    { repeatCell: { range:{ sheetId:SH.resumo, startRowIndex:4, endRowIndex:5 },
        cell:{ userEnteredFormat:{ backgroundColor:{ red:0.06,green:0.07,blue:0.1 }, textFormat:{ bold:true, foregroundColor:{ red:1,green:0.843,blue:0 } } } },
        fields:'userEnteredFormat(backgroundColor,textFormat)' } },
    // Fabricante header (row after status block)
    { repeatCell: { range:{ sheetId:SH.resumo, startRowIndex:10, endRowIndex:11 },
        cell:{ userEnteredFormat:{ backgroundColor:{ red:0.1,green:0.1,blue:0.18 }, textFormat:{ bold:true, foregroundColor:{ red:0.6,green:0.76,blue:1 } } } },
        fields:'userEnteredFormat(backgroundColor,textFormat)' } },
    // Technician header
    { repeatCell: { range:{ sheetId:SH.resumo, startRowIndex: 12 + fabEntries.length, endRowIndex: 13 + fabEntries.length },
        cell:{ userEnteredFormat:{ backgroundColor:{ red:0.1,green:0.18,blue:0.1 }, textFormat:{ bold:true, foregroundColor:{ red:0.13,green:0.77,blue:0.37 } } } },
        fields:'userEnteredFormat(backgroundColor,textFormat)' } },
  ];

  await sheets.spreadsheets.batchUpdate({ spreadsheetId:ssId, requestBody:{ requests:formatRequests } });

  // ── Charts on Resumo tab ──────────────────────────────────────────────────
  // Only add charts on first creation to avoid duplicates on update
  if (isNew) {
    const chartRequests = [
      // Pie chart — status breakdown (rows 5-8, cols A-B = indices 4-8, 0-1)
      { addChart: { chart: {
        spec: {
          title: 'Chamados por Status',
          titleTextFormat: { bold:true, fontSize:12, foregroundColor:{ red:0.93,green:0.84,blue:0 } },
          pieChart: {
            legendPosition: 'RIGHT_LEGEND',
            series: { dataRange: { sheetId:SH.resumo, startRowIndex:5, endRowIndex:8, startColumnIndex:1, endColumnIndex:2 } },
            domain: { dataRange: { sheetId:SH.resumo, startRowIndex:5, endRowIndex:8, startColumnIndex:0, endColumnIndex:1 } },
          },
          backgroundColorStyle: { rgbColor:{ red:0.11,green:0.13,blue:0.2 } },
        },
        position: { overlayPosition: {
          anchorCell: { sheetId:SH.resumo, rowIndex:0, columnIndex:4 },
          offsetXPixels:0, offsetYPixels:0, widthPixels:420, heightPixels:280,
        }},
      }}},
      // Bar chart — by fabricante
      { addChart: { chart: {
        spec: {
          title: 'Chamados por Fabricante',
          titleTextFormat: { bold:true, fontSize:12, foregroundColor:{ red:0.93,green:0.84,blue:0 } },
          basicChart: {
            chartType: 'BAR',
            legendPosition: 'NO_LEGEND',
            axis: [{ position:'BOTTOM_AXIS', title:'Chamados' }, { position:'LEFT_AXIS', title:'Fabricante' }],
            domains: [{ domain: { data: { sourceRange: { sources: [{ sheetId:SH.resumo, startRowIndex:11, endRowIndex:11+fabEntries.length, startColumnIndex:0, endColumnIndex:1 }] } } } }],
            series: [{ data: { sourceRange: { sources: [{ sheetId:SH.resumo, startRowIndex:11, endRowIndex:11+fabEntries.length, startColumnIndex:1, endColumnIndex:2 }] } } },
            ],
          },
          backgroundColorStyle: { rgbColor:{ red:0.11,green:0.13,blue:0.2 } },
        },
        position: { overlayPosition: {
          anchorCell: { sheetId:SH.resumo, rowIndex:10, columnIndex:4 },
          offsetXPixels:0, offsetYPixels:0, widthPixels:420, heightPixels: Math.max(200, fabEntries.length * 30),
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

module.exports = router;
module.exports.sendEmail = sendEmail;
module.exports.accessRequestEmailHtml = accessRequestEmailHtml;
module.exports.approvedEmailHtml = approvedEmailHtml;

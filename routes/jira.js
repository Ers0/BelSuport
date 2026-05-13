/**
 * Belenergy — Jira Integration Route
 * POST /api/jira/create-issue   — create a new Jira issue for a case
 * GET  /api/jira/test           — test connection with saved credentials
 * GET  /api/jira/projects       — list available projects
 */

const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../services/db'); 

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getJiraConfig(userId) {
  const { data: g } = await supabaseAdmin.from('settings_global').select('*').eq('id', 1).single();
  let u = null;
  if (userId) {
    const { data } = await supabaseAdmin.from('settings_user').select('*').eq('user_id', userId).single();
    u = data;
  }
  return {
    baseUrl:    (g && g.jira_url)      || process.env.JIRA_BASE_URL    || '',
    email:      (u && u.jira_email)    || process.env.JIRA_EMAIL        || '',
    apiToken:   (u && u.jira_token)    || process.env.JIRA_API_TOKEN    || '',
    project:    (g && g.jira_project)  || process.env.JIRA_PROJECT_KEY  || '',
    type:       (g && g.jira_type)     || process.env.JIRA_ISSUE_TYPE   || 'Task',
    // jiraBoards: array of { fabricante, project, type, fields[] }
    jiraBoards: (g && g.jira_boards)   || [],
  };
}

// Resolve the correct board for a given fabricante.
// Matching is case-insensitive and trims whitespace.
// Falls back to default cfg.project if no specific board found.
function resolveBoard(cfg, fabricante) {
  const boards = Array.isArray(cfg.jiraBoards) ? cfg.jiraBoards : [];
  const fab = (fabricante || '').trim().toLowerCase();

  const match = boards.find(b =>
    (b.fabricante || '').trim().toLowerCase() === fab
  );

  if (match) {
    console.log(`🔵 [Jira Board] "${fabricante}" → project: ${match.project} (type: ${match.type || cfg.type})`);
    return {
      project: match.project,
      type:    match.type    || cfg.type    || 'Task',
      fields:  match.fields  || [],
    };
  }

  // Log unmatched so it's easy to spot misconfiguration
  if (fab && boards.length > 0) {
    console.warn(`⚠️  [Jira Board] No board found for fabricante="${fabricante}". Available: [${boards.map(b=>b.fabricante).join(', ')}]. Using default project: ${cfg.project}`);
  }

  return {
    project: cfg.project,
    type:    cfg.type || 'Task',
    fields:  [],
  };
}

function jiraHeaders(cfg) {
  const creds = Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64');
  return {
    'Authorization': 'Basic ' + creds,
    'Content-Type':  'application/json',
    'Accept':        'application/json',
  };
}

async function jiraFetch(path_url, options = {}, userId) {
  const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
  
  // 🔥 AGORA BUSCA A CONFIGURAÇÃO EM TEMPO REAL:
  const cfg = await getJiraConfig(userId);

  // 🕵️ DEBUG: Veja o que está chegando do banco no seu terminal
  console.log("🔍 [DEBUG JIRA] Config Atual:", {
    url: cfg.baseUrl ? "OK" : "VAZIO ❌",
    email: cfg.email ? "OK" : "VAZIO ❌",
    token: cfg.apiToken ? "OK" : "VAZIO ❌",
    project: cfg.project ? "OK" : "VAZIO ❌"
  });

  if (!cfg.baseUrl || !cfg.email || !cfg.apiToken) {
    throw new Error('Jira não configurado nas Settings');
  }

  const url = `${cfg.baseUrl.replace(/\/$/, '')}${path_url}`;
  
  const res = await fetch(url, {
    ...options,
    headers: {
      ...jiraHeaders(cfg),
      ...(options.headers || {})
    }
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Jira API Error (${res.status}): ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

// ── GET /api/jira/test ────────────────────────────────────────────────────────
router.get('/test', async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const cfg = await getJiraConfig(userId); 
    const result = await jiraFetch('/rest/api/3/myself', {}, userId);

    // 👇 O PLANO B PARA O NOME: Pega o displayName, ou name, ou um texto padrão
    const userName = result.displayName || result.name || 'Usuário Autenticado';

    res.json({ 
      success: true, 
      user: userName,   // Adeus 'undefined'!
      email: cfg.email 
    });
  } catch (err) {
    // Return 200 (not 400) so browser doesn't log it as error when Jira isn't configured
    const isUnconfigured = err.message?.includes('não configurad') || err.message?.includes('not configured') || err.message?.includes('config');
    res.status(200).json({
      success: false,
      error:   err.message,
      configured: !isUnconfigured,
    });
  }
});

// ── POST /api/jira/create-issue ───────────────────────────────────────────────
router.post('/create-issue', async (req, res) => {
  const c = req.body;
  const userId = req.user ? req.user.id : null;

  if (!c) return res.status(400).json({ error: 'Nenhum dado recebido' });

  try {
    // 1. Puxa configuração + resolve o board correto pelo fabricante
    const cfg = await getJiraConfig(userId);
    if (!cfg.project) {
      return res.status(400).json({ error: 'Projeto Jira não configurado nas Settings' });
    }
    const board = resolveBoard(cfg, c.fabricante);

    // 2. Busca o AccountID (passando o userId para o jiraFetch)
    let accountId = null;
    try {
      const myself = await jiraFetch('/rest/api/3/myself', {}, userId);
      if (myself && myself.accountId) {
        accountId = myself.accountId;
      }
    } catch (e) {
      console.warn("⚠️ Não foi possível capturar o AccountID para atribuição.");
    }

    // 3. Enrich case data — if modelo is missing, try equipment table
    let modelo = c.modelo || '';
    if (!modelo && c.sn) {
      const { supabaseAdmin: db } = require('../services/db');
      const { data: eq } = await db.from('equipment').select('modelo').eq('sn', c.sn).maybeSingle();
      if (eq?.modelo) modelo = eq.modelo;
    }

    // Also update the case in Supabase if we found a modelo
    if (modelo && !c.modelo && c.id) {
      const { supabaseAdmin: db } = require('../services/db');
      await db.from('chamados').update({ modelo }).eq('id', c.id).catch(() => {});
    }

    // 4. Monta o Link do Drive
    const driveLink = c.drive_id
      ? `https://drive.google.com/drive/folders/${c.drive_id}`
      : 'Link não gerado (Pasta ainda local ou não sincronizada)';

    // 5. Monta o corpo com o projeto/tipo do board correto
    // Summary: only cliente_final name (clean, no SN/model in title)
    const clienteName = c.cliente_final || c.integrador || c.nome || 'Sem Nome';
    const issueBody = {
      fields: {
        project:   { key: board.project },
        issuetype: { name: board.type },
        summary:   clienteName,

        description: {
          type: 'doc', version: 1,
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: `SN: ${c.sn || '—'} | ${modelo ? `Modelo: ${modelo} | ` : ''}Fabricante: ${c.fabricante || '—'}\n` },
              { type: 'hardBreak' },
              { type: 'text', text: 'Link do Drive: ' },
              { type: 'text', text: driveLink, marks: c.drive_id ? [{ type: 'link', attrs: { href: driveLink } }] : [] },
            ],
          }],
        },

        labels: ['belenergy', 'garantia', (c.fabricante || '').toLowerCase().replace(/\s/g, '-')].filter(Boolean),
      },
    };

    // Apply ONLY board-mapped custom fields (avoids "field not on screen" errors)
    // If board has no field mappings, fall back to hardcoded defaults
    if (board.fields && board.fields.length > 0) {
      const sourceMap = {
        sn:             c.sn || '',
        modelo,
        fabricante:     c.fabricante || '',
        categoria:      c.categoria || '',
        cliente_final:  clienteName,
        integrador:     c.integrador || '',
        tel_integrador: c.tel_integrador || c.contato || '',
        contato:        c.contato || '',
        relato:         c.relato || '',
        drive_link:     driveLink,
        nome:           c.nome || '',
        adb_number:     c.adb_number || '',
      };
      board.fields.forEach(f => {
        if (f.jiraField && f.source && sourceMap[f.source] !== undefined) {
          issueBody.fields[f.jiraField] = sourceMap[f.source];
        }
      });
    } else {
      // No board field mapping — try safe defaults but skip on 400
      // (These will be sent and silently dropped if not on screen)
      const safeFallbacks = {};
      if (modelo)                            safeFallbacks.customfield_10108 = modelo;
      if (c.alarme || c.relato)             safeFallbacks.customfield_10109 = c.alarme || c.relato;
      if (c.tel_integrador || c.contato)    safeFallbacks.customfield_10110 = c.tel_integrador || c.contato;
      if (c.sn)                              safeFallbacks.customfield_10112 = c.sn;
      if (accountId)                         safeFallbacks.customfield_10111 = [{ accountId }];
      Object.assign(issueBody.fields, safeFallbacks);
    }

    if (accountId) {
      issueBody.fields.assignee = { accountId: accountId };
      issueBody.fields.reporter = { accountId: accountId };
    }

    // 5. Cria o Issue (PASSANDO userId para usar o Token certo)
    const created = await jiraFetch('/rest/api/3/issue', {
      method: 'POST',
      body:   JSON.stringify(issueBody),
    }, userId);

    const issueUrl = `${cfg.baseUrl.replace(/\/$/, '')}/browse/${created.key}`;

    // Save jira_key back to the case + set as protocolo (adb_number)
    if (c.id) {
      const { supabaseAdmin } = require('../services/db');
      await supabaseAdmin.from('chamados')
        .update({ jira_key: created.key, adb_number: created.key })
        .eq('id', c.id);

      // Log event on the case timeline
      await supabaseAdmin.from('case_events').insert([{
        case_id:    c.id,
        user_id:    userId,
        user_name:  req.user?.name || req.user?.email || 'Sistema',
        event_type: 'jira_created',
        description: `Issue Jira criado: ${created.key} — salvo como protocolo`,
        metadata:   { jira_key: created.key, issue_url: issueUrl },
      }]);
    }

    res.json({
      success:  true,
      issueKey: created.key,
      issueId:  created.id,
      issueUrl,
    });

  } catch (err) {
    console.error("❌ Erro ao criar Issue:", err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── POST /api/jira/request-adb ────────────────────────────────────────────────
router.post('/request-adb', async (req, res) => {
  const { issueKey, sn, nome } = req.body;
  if (!issueKey) return res.status(400).json({ error: 'issueKey required' });

  try {
    await jiraFetch(`/rest/api/3/issue/${issueKey}/comment`, {
      method: 'POST',
      body: JSON.stringify({
        body: {
          type: 'doc', version: 1,
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: `Solicitação de protocolo ADB para o chamado: ${integrador || ''} | S/N: ${sn || ''}. Por favor, informe o número ADB para conclusão do processo.` }]
          }]
        }
      })
    });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── POST /api/jira/webhook — receives Jira transition events ─────────────────
// Register in Jira: Project Settings → Webhooks → Create webhook
// URL: https://your-tunnel-url.com/api/jira/webhook
// Events: Issue → updated
// NOTE: this route is whitelisted from auth in server.js (Jira sends no token)
router.post('/webhook', express.json({ strict: false }), async (req, res) => {
  res.sendStatus(200); // always ack immediately — Jira retries on non-200

  try {
    const payload = req.body;
    console.log('🔔 Jira webhook received:', payload?.webhookEvent, payload?.issue?.key);

    // Only handle issue_updated events
    if (payload.webhookEvent !== 'jira:issue_updated') return;

    // Check a transition actually happened
    const transition = payload.changelog?.items?.find(i => i.field === 'status');
    if (!transition) return;

    const toStatus  = transition.toString;
    const issueKey  = payload.issue.key;
    const summary   = payload.issue.fields?.summary || '';

    console.log(`  → ${issueKey} moved to "${toStatus}"`);

    const { supabaseAdmin } = require('../services/db');
    const { notifyClients } = require('../services/watcher');

    // Find the case that owns this Jira issue
    const { data: caseRow } = await supabaseAdmin
      .from('chamados')
      .select('id, integrador, cliente_final, sn, user_id, nome')
      .eq('jira_key', issueKey)
      .maybeSingle();

    if (!caseRow) {
      console.warn(`  ⚠ No case found for jira_key=${issueKey}`);
    }

    const client = caseRow?.integrador || caseRow?.cliente_final || '';
    const notif  = {
      type:     'jira_transition',
      issueKey,
      toStatus,
      summary,
      caseId:   caseRow?.id   || null,
      userId:   caseRow?.user_id || null,  // targeted user
      client,
      sn:       caseRow?.sn   || null,
      title:    `Jira: ${issueKey} → ${toStatus}`,
      body:     `${client || summary}${caseRow?.sn ? ` | S/N: ${caseRow.sn}` : ''}`,
    };

    // Persist notification — targeted to case owner only (not broadcast)
    await supabaseAdmin.from('notifications').insert([{
      user_id:  caseRow?.user_id || null,  // null only if case not found
      type:     notif.type,
      title:    notif.title,
      body:     notif.body,
      metadata: notif,
      read:     false,
    }]);

    // Log on case timeline
    if (caseRow?.id) {
      await supabaseAdmin.from('case_events').insert([{
        case_id:     caseRow.id,
        user_name:   'Jira',
        event_type:  'jira_transition',
        description: `Issue ${issueKey} movido para "${toStatus}"`,
        metadata:    { jira_key: issueKey, to_status: toStatus },
      }]);
    }

    // Push SSE — include userId so clients can filter client-side
    notifyClients(JSON.stringify(notif));
    console.log(`  ✓ Notification sent to user_id=${caseRow?.user_id || 'broadcast'}`);

  } catch (err) {
    console.error('Jira webhook error:', err.message);
  }
});

// ── GET /api/jira/project-fields/:projectKey ─────────────────────────────────
// Fetches all fields available for a project including custom fields.
// Returns field id, name, type, and whether it's required.
router.get('/project-fields/:projectKey', async (req, res) => {
  const userId = req.user?.id;
  try {
    const { projectKey } = req.params;

    // 1. Get all fields from Jira
    const allFields = await jiraFetch('/rest/api/3/field', {}, userId);

    // 2. Get create metadata for this project to know which fields apply + if required
    let createMeta = { projects: [] };
    try {
      createMeta = await jiraFetch(
        `/rest/api/3/issue/createmeta?projectKeys=${projectKey}&expand=projects.issuetypes.fields`,
        {}, userId
      );
    } catch (_) {}

    // Build a map of field id → required + schema from createmeta
    const metaFields = {};
    const project = createMeta.projects?.[0];
    if (project) {
      project.issuetypes?.forEach(it => {
        Object.entries(it.fields || {}).forEach(([fid, fdata]) => {
          metaFields[fid] = {
            required:    fdata.required || false,
            issueType:   it.name,
            allowedValues: fdata.allowedValues?.map(v => v.name || v.value) || [],
          };
        });
      });
    }

    // 3. Merge — return all fields that appear in this project's createmeta, plus all custom fields
    const fields = (Array.isArray(allFields) ? allFields : [])
      .filter(f => f.id in metaFields || f.custom)
      .map(f => ({
        id:            f.id,
        name:          f.name,
        custom:        f.custom || false,
        type:          f.schema?.type || 'string',
        required:      metaFields[f.id]?.required || false,
        allowedValues: metaFields[f.id]?.allowedValues || [],
      }))
      .sort((a, b) => {
        // Sort: required first, then standard, then custom
        if (a.required !== b.required) return a.required ? -1 : 1;
        if (a.custom !== b.custom) return a.custom ? 1 : -1;
        return a.name.localeCompare(b.name);
      });

    res.json({ projectKey, fields });
  } catch (err) {
    console.error('project-fields error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


router.get('/preview/:caseId', async (req, res) => {
  const userId = req.user?.id;
  try {
    const { supabaseAdmin } = require('../services/db');

    // Get case
    const { data: c, error } = await supabaseAdmin
      .from('chamados')
      .select('*')
      .eq('id', req.params.caseId)
      .single();
    if (error) throw error;

    // Get case events/timeline
    const { data: events } = await supabaseAdmin
      .from('case_events')
      .select('*')
      .eq('case_id', req.params.caseId)
      .order('created_at', { ascending: false })
      .limit(10);

    // Get Jira comments if issue is linked
    let jiraComments = [];
    if (c.jira_key) {
      try {
        const cfg = await getJiraConfig(userId);
        const result = await jiraFetch(
          `/rest/api/3/issue/${c.jira_key}/comment?maxResults=10&orderBy=-created`,
          {}, userId
        );
        jiraComments = (result.comments || []).map(cm => ({
          id:        cm.id,
          author:    cm.author?.displayName || 'Jira',
          body:      cm.body?.content?.[0]?.content?.[0]?.text || '[conteúdo formatado]',
          created:   cm.created,
        }));
      } catch (_) {}
    }

    res.json({ case: c, events: events || [], jiraComments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Uses jira_status column on chamados to track last known status.
// Notifies when status CHANGES. If card goes back to "A Fazer" then "A Revisar"
// again — jira_status was updated in between, so it fires again. Foolproof.
router.get('/poll', async (req, res) => {
  const userId = req.user?.id;
  try {
    const { supabaseAdmin } = require('../services/db');

    // Get all cases belonging to this user that have a jira_key
    const { data: cases } = await supabaseAdmin
      .from('chamados')
      .select('id, jira_key, jira_status, status, integrador, cliente_final, sn')
      .eq('user_id', userId)
      .not('jira_key', 'is', null);

    if (!cases?.length) return res.json({ checked: 0, transitions: [] });

    const transitions = [];

    for (const c of cases) {
      try {
        const issue = await jiraFetch(
          `/rest/api/3/issue/${c.jira_key}?fields=status,summary`, {}, userId
        );
        const jiraStatus = issue.fields?.status?.name;
        if (!jiraStatus) continue;

        // Only act if status CHANGED since last poll
        if (jiraStatus === c.jira_status) continue;

        // Update jira_status on the case immediately
        // (do this before inserting notification so re-polls don't double-fire)
        await supabaseAdmin
          .from('chamados')
          .update({ jira_status: jiraStatus })
          .eq('id', c.id);

        const client = c.integrador || c.cliente_final || '';
        const title  = `Jira: ${c.jira_key} → ${jiraStatus}`;
        const body   = `${client}${c.sn ? ` | S/N: ${c.sn}` : ''}`;

        // Save notification
        await supabaseAdmin.from('notifications').insert([{
          user_id:  userId,
          type:     'jira_transition',
          title,
          body,
          metadata: {
            issueKey:  c.jira_key,
            toStatus:  jiraStatus,
            fromStatus: c.jira_status || null,
            caseId:    c.id,
            userId,
          },
          read: false,
        }]);

        // Log on case timeline
        await supabaseAdmin.from('case_events').insert([{
          case_id:     c.id,
          user_name:   'Jira (poll)',
          event_type:  'jira_transition',
          description: c.jira_status
            ? `Issue ${c.jira_key}: "${c.jira_status}" → "${jiraStatus}"`
            : `Issue ${c.jira_key} está em "${jiraStatus}"`,
          metadata: { jira_key: c.jira_key, from_status: c.jira_status, to_status: jiraStatus },
        }]).catch(() => {});

        transitions.push({
          issueKey:   c.jira_key,
          fromStatus: c.jira_status,
          toStatus:   jiraStatus,
          caseId:     c.id,
          title,
          body,
          userId,
        });

      } catch (_) {
        // Skip issues that can't be fetched (deleted, no permission, etc.)
      }
    }

    res.json({ checked: cases.length, transitions });
  } catch (err) {
    console.error('Jira poll error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
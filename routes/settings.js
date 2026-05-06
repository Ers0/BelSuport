const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../services/db'); 

const ADMIN_EMAILS = ['eros.belenergy@gmail.com'];

// 1 ÚNICA ROTA GET PARA JUNTAR TUDO
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`📥 [DEBUG] Iniciando busca para: ${req.user.email} (ID: ${userId})`);

    // Busca configurações globais
    const { data: g, error: gErr } = await supabaseAdmin
      .from('settings_global')
      .select('*')
      .eq('id', 1)
      .maybeSingle();

    if (gErr) console.error("❌ Erro ao ler settings_global:", gErr.message);

    // Busca configurações do usuário (aqui tem o google_token e o drive_id)
    const { data: u, error: uErr } = await supabaseAdmin
      .from('settings_user')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (uErr) console.error("❌ Erro ao ler settings_user:", uErr.message);

    console.log("✅ Busca finalizada. Enviando para o App.");

    // Manda tudo junto para o Front-end
    res.json({
      tesseractPath: g?.tesseract_path || '',
      popplerPath:   g?.poppler_path || '',
      ollamaUrl:     g?.ollama_url || '',
      ollamaModel:   g?.ollama_model || 'moondream',
      jiraUrl:       g?.jira_url || '',
      jiraProject:   g?.jira_project || '',
      jiraType:      g?.jira_type || 'Task',
      jiraEmail:     u?.jira_email || '',
      jiraToken:     u?.jira_token || '',
      driveId:            u?.drive_id || '',
      solutionsDriveId:   u?.solutions_drive_id || '',
      fabricantes:      g?.fabricantes || [],
      jiraBoards:       g?.jira_boards || [],   // ← was missing from GET
      
      // 🚨 O GRANDE TRUQUE AQUI: 
      // Se houver qualquer coisa no campo google_token, retorna true. Senão, false.
      has_drive_auth: !!u?.google_token 
    });

  } catch (err) {
    console.error("🔥 CRASH na rota GET /settings:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// A ROTA POST CONTINUA IGUAL
router.post('/', async (req, res) => {
    try {
      const b = req.body;
      const userId = req.user.id;
      const userEmail = req.user.email;
  
      console.log(`⏳ [DEBUG] Salvando dados de: ${userEmail}`);
  
      // 1. Tenta salvar User Settings
      const { error: uErr } = await supabaseAdmin
        .from('settings_user')
        .upsert({
          user_id:             userId,
          drive_id:            b.driveId,
          solutions_drive_id:  b.solutionsDriveId || null,
          jira_email:          b.jiraEmail,
          jira_token:          b.jiraToken,
          updated_at:          new Date()
        });
  
      if (uErr) throw new Error("Erro User Settings: " + uErr.message);
  
      // 2. Se for Admin, tenta salvar Global
      if (ADMIN_EMAILS.includes(userEmail)) {
        console.log("🛡️ [DEBUG] Usuário é Admin. Salvando configs globais...");
        const { error: gErr } = await supabaseAdmin
          .from('settings_global')
          .upsert({
            id: 1, 
            tesseract_path: b.tesseractPath,
            poppler_path:   b.popplerPath,
            ollama_url:     b.ollamaUrl,
            ollama_model:   b.ollamaModel,
            jira_url:       b.jiraUrl,
            jira_project:   b.jiraProject,
            jira_type:      b.jiraType,
            fabricantes:    b.fabricantes || [],
            jira_boards:    b.jiraBoards  || []   // ← was missing
          });
        
        if (gErr) throw new Error("Erro Global Settings: " + gErr.message);
      }
  
      console.log("✅ [DEBUG] Tudo salvo com sucesso!");
      res.json({ success: true });
    } catch (err) {
      console.error("❌ [DEBUG] Falha no POST:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

module.exports = router;
// migrate.js
require('dotenv').config();
const { supabaseAdmin } = require('./services/db');

async function migrate() {
    console.log("🚀 Iniciando migração do .env para Supabase...");

    const { error } = await supabaseAdmin
        .from('settings')
        .upsert({
            id: 1,
            drive_id:       process.env.DRIVE_PARENT_ID,
            tesseract_path: process.env.TESSERACT_PATH,
            poppler_path:   process.env.POPPLER_PATH,
            ollama_url:     process.env.OLLAMA_URL,
            ollama_model:   process.env.OLLAMA_MODEL || 'moondream',
            jira_url:       process.env.JIRA_BASE_URL,
            jira_email:     process.env.JIRA_EMAIL,
            jira_token:     process.env.JIRA_API_TOKEN,
            jira_project:   process.env.JIRA_PROJECT_KEY,
            jira_type:      process.env.JIRA_ISSUE_TYPE || 'Task'
        });

    if (error) {
        console.error("❌ Erro na migração:", error.message);
    } else {
        console.log("✅ Dados migrados com sucesso para a nuvem!");
    }
}

migrate();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

// Service role key bypasses Row Level Security for server-side operations
// (session storage, admin writes). This key MUST stay server-side only.
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || supabaseKey;

if (!supabaseUrl || !supabaseKey) {
  console.error("ERRO: SUPABASE_URL ou SUPABASE_KEY nao encontradas no .env");
}

// Public client (anon key) — for user-facing queries subject to RLS
const supabase = createClient(supabaseUrl, supabaseKey);

// Admin client (service role key) — bypasses RLS, used only server-side
// for session management and admin writes
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function getSettings() {
    try {
        const { data, error } = await supabaseAdmin
            .from('settings')
            .select('*')
            .eq('id', 1)
            .single();

        if (error) throw error;
        return data;
    } catch (err) {
        console.error("⚠️ Fallback para .env:", err.message);
        return process.env; // Se o banco falhar, usa o que tiver no .env
    }
}
async function editCase(caseId, updateData) {
    try {
        const { data, error } = await supabaseAdmin
            .from('cases') // ⚠️ IMPORTANTE: Confirme se o nome da sua tabela é 'cases' ou 'tickets'
            .update(updateData)
            .eq('id', caseId);

        if (error) throw error;
        return data;
    } catch (err) {
        console.error("Erro ao atualizar o caso no Supabase:", err.message);
        throw err;
    }
}

module.exports = { supabase, supabaseAdmin, getSettings, editCase };
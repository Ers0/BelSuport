require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const { startWatcher } = require('./services/watcher');
const authRoutes = require('./routes/auth');
const driveRoutes = require('./routes/drive');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Configurações Base
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// 2. Arquivos Estáticos (HTML, CSS, JS) - Deixamos no topo pois são públicos
app.use(express.static(path.join(__dirname, 'public')));

// =====================================================================
// 🚨 A MÁGICA ACONTECE AQUI: A ORDEM CORRETA
// =====================================================================

// 3. O Segurança Global (Middleware)
// Ele deve vir ANTES de qualquer rota /api. 
// Ele já sabe liberar o /login e o /callback sozinho, mas vai barrar quem não tem token.
app.use(authRoutes.authMiddleware);

// 4. Middleware de Log (AGORA DEPOIS DO SEGURANÇA!)
// Agora ele consegue ler o req.user verdadeiro, pois o middleware já rodou.
app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
        console.log(`🔍 [DEBUG] ${req.method} ${req.path} | User: ${req.user ? req.user.email : 'Public'}`);
    }
    next();
});

// 5. Montagem das Rotas da API
// Agora todas as rotas abaixo (incluindo o /api/auth/me) estão protegidas.
app.use('/api/auth', authRoutes.router);
app.use('/api/drive', driveRoutes); 

function safeRoute(routePath) {
    try {
        return require(routePath);
    } catch (err) {
        console.error(`❌ Erro ao carregar rota [${routePath}]:`, err.message);
        const r = express.Router();
        r.all('*', (req, res) => res.status(500).json({ error: 'Serviço indisponível' }));
        return r;
    }
}

app.use('/api/cases',         safeRoute('./routes/cases'));
app.use('/api/files',         safeRoute('./routes/files'));
app.use('/api/products',      safeRoute('./routes/products'));
app.use('/api/settings',      safeRoute('./routes/settings'));
app.use('/api/jira',          safeRoute('./routes/jira'));
app.use('/api/sheets',        safeRoute('./routes/sheets'));
app.use('/api/clients',       safeRoute('./routes/clients'));
app.use('/api/events',        safeRoute('./routes/events'));
app.use('/api/equipment',     safeRoute('./routes/equipment'));
app.use('/api/reports',       safeRoute('./routes/reports'));
app.use('/api/solutions',     safeRoute('./routes/solutions'));
app.use('/api/reminders',     safeRoute('./routes/reminders'));
app.use('/api/analysis',      safeRoute('./routes/analysis'));
app.use('/api/knowledge',     safeRoute('./routes/knowledge'));
app.use('/api/notifications', safeRoute('./routes/notifications'));
app.use('/api/contacts',      safeRoute('./routes/contacts'));
app.use('/api/contacts',      safeRoute('./routes/contacts'));

// 7. Inicialização
startWatcher();

app.listen(PORT, () => {
    console.log(`
    =============================================
    🚀 Belenergy Support Pro rodando!
    🔗 URL: http://localhost:${PORT}
    =============================================
    `);
});
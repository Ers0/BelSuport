# Belenergy Support Pro v1.0 — Sistema Interno de Suporte Técnico

Uso interno restrito à Belenergy. Não autorizado para distribuição externa.

---------------------------------------------------------------------

VISÃO GERAL

O Belenergy Support Pro é um sistema interno desenvolvido para otimizar o fluxo operacional da equipe de suporte técnico, centralizando:

- Gestão de chamados
- Organização automática de arquivos
- Integração com Google Drive
- Extração de dados via OCR
- Rastreamento de status (incluindo pendências e reprocessos)

O sistema adota uma abordagem local-first, reduzindo exposição de dados e aumentando a confiabilidade operacional.

---------------------------------------------------------------------

ARQUITETURA

start.bat
  ├── Node.js (porta 3000)   — Backend Express + Frontend estático
  └── Python (porta 8001)    — Microserviço OCR (FastAPI)

Componentes principais:

- Backend: Node.js (Express)
- Frontend: SPA (HTML/CSS/JS)
- Banco de dados: SQLite (local)
- OCR: Tesseract + Poppler
- Integração externa: Google Drive
- IA local (opcional): Ollama

---------------------------------------------------------------------

FLUXO OPERACIONAL

Registro → Processamento → Upload (Drive)
        → Falha → PENDENTES → Reprocesso → Conclusão

Características:

- Upload com fallback automático
- Separação entre arquivos organizados e pendentes
- Exclusão local apenas após confirmação da API

---------------------------------------------------------------------

CONFIGURAÇÃO INICIAL

1. Backend Node.js

npm install
cp .env.example .env

Editar .env com:
- Caminhos do Tesseract e Poppler
- ID da pasta no Google Drive

2. Microserviço OCR

cd ocr-service
pip install -r requirements.txt

Garantir no .env:
- TESSERACT_DIR
- POPPLER_BIN

3. Google Drive

1. Acessar https://console.cloud.google.com
2. Criar projeto e ativar Drive API
3. Criar credenciais OAuth 2.0 (Desktop)
4. Salvar credentials.json na raiz

Executar:
node auth.js

---------------------------------------------------------------------

EXECUÇÃO

Método padrão (Windows):
start.bat

Execução manual:

# OCR
cd ocr-service
python ocr_server.py

# Backend
node server.js

Acessar:
http://localhost:3000

---------------------------------------------------------------------

ESTRUTURA DO PROJETO

belenergy/
├── server.js
├── services/
│   ├── db.js
│   ├── watcher.js
│   └── ocr.js
├── routes/
│   ├── cases.js
│   ├── drive.js
│   ├── files.js
│   └── ...
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── ocr-service/
│   ├── ocr_server.py
│   └── requirements.txt
├── ENTRADA/
├── ORGANIZADOS/
├── PENDENTES/
├── .env.example
└── start.bat

---------------------------------------------------------------------

API ENDPOINTS

GET    /api/cases                  Lista chamados
POST   /api/cases                  Cria chamado
PUT    /api/cases/:id              Atualiza chamado
DELETE /api/cases/:id              Remove chamado

GET    /api/files/folders          Lista pastas
POST   /api/files/audit            Define auditoria
POST   /api/files/ven              Extração VEN (OCR)
POST   /api/files/move-to-pending  Move para pendentes

POST   /api/drive/upload           Upload para Google Drive

---------------------------------------------------------------------

SEGURANÇA

- Execução local (sem exposição pública)
- Controle de acesso por função (RBAC)
- Integrações externas isoladas no backend
- Banco armazena apenas dados estruturados
- Arquivos armazenados externamente (Drive/local)

---------------------------------------------------------------------

OBSERVAÇÕES

- Sistema não projetado para uso público
- Uso exclusivo da equipe de suporte técnico
- Expansões devem respeitar RBAC e fluxo existente

---------------------------------------------------------------------

LICENÇA

Belenergy Support Pro v1.0
Licença de Uso Interno
----------------------------------

Copyright (C) 2026 Belenergy

Este software e seu código-fonte são propriedade exclusiva da Belenergy.

Uso restrito ao ambiente interno da empresa. É proibida qualquer forma de
distribuição, reprodução, modificação ou compartilhamento externo sem
autorização formal.

O acesso é limitado a usuários autorizados conforme políticas internas.

Este software é fornecido "como está", sem garantias.
A Belenergy não se responsabiliza por danos decorrentes do uso.

----------------------------------
Belenergy Sistemas
Uso Interno Restrito
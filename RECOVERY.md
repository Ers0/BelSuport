# Belenergy Support Pro — Disaster Recovery Runbook

> Keep this file printed and in a physical binder. Don't rely on the system being up to read the recovery docs.

---

## Contacts & Credentials Location

| Item | Location |
|---|---|
| `.env` backup | Google Drive → Backups → config_YYYY-MM-DD.env |
| DB backup | Google Drive → Backups → db_YYYY-MM-DD.sql.gz |
| Storage backup | Google Drive → Backups → storage_YYYY-MM-DD.zip |
| Supabase dashboard | https://supabase.com/dashboard |
| Google Cloud Console | https://console.cloud.google.com |
| Groq Console | https://console.groq.com |

---

## Scenario 1 — Supabase Temporarily Down

**Symptoms:** App shows errors, no data loads, server logs show connection refused.

**Immediate action (< 5 min):**
1. Check https://status.supabase.com — if planned maintenance, wait.
2. Check server terminal — if `[Queue] Supabase OFFLINE` appears, the queue is active.
3. Inform the team: **read-only mode** until restored. Do not attempt writes manually.
4. When Supabase comes back, the queue flushes automatically. Verify in logs:
   ```
   [Queue] Supabase back online — flushing queue
   [Queue] All actions flushed ✓
   ```

---

## Scenario 2 — Full Database Loss / Corruption

**Time to recovery: ~30–60 minutes**

### Step 1 — Get the latest backup

```bash
# List backups on Drive (or download manually from Drive UI)
# File: db_YYYY-MM-DD.sql.gz
```

### Step 2 — Create a fresh Supabase project (if needed)

1. Go to https://supabase.com/dashboard → New Project
2. Note the new: `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
3. Note the DB connection string (Settings → Database → Connection string → URI)

### Step 3 — Restore the database

```bash
# Decompress and restore
gunzip db_YYYY-MM-DD.sql.gz

# Restore to new Supabase DB
psql "postgres://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres" \
  < db_YYYY-MM-DD.sql
```

> If psql isn't installed: `winget install PostgreSQL.PostgreSQL` (Windows) or `brew install postgresql` (Mac)

### Step 4 — Re-run migrations that aren't in the dump

```sql
-- In Supabase SQL Editor, re-run if needed:
-- migration_v2.sql, migration_v3.sql, migration_v4.sql
-- migration_agenda.sql, migration_solutions.sql, rbac_migration.sql
```

### Step 5 — Update .env with new credentials

```env
SUPABASE_URL=https://[new-ref].supabase.co
SUPABASE_KEY=[new-anon-key]
SUPABASE_SERVICE_ROLE_KEY=[new-service-role-key]
SUPABASE_DB_URL=postgres://postgres.[new-ref]:[password]@...
```

### Step 6 — Restart and verify

```bash
node server.js
# Check: GET http://localhost:3000/api/cases/stats
# Check: GET http://localhost:3000/api/auth/me
```

---

## Scenario 3 — Storage Loss (Drive/Supabase files)

### Restore from backup zip

```bash
unzip storage_YYYY-MM-DD.zip -d storage_restore/

# Re-upload to Supabase Storage via CLI
npx supabase storage cp --recursive ./storage_restore/ ss:///your-bucket/
```

### Restore from Google Drive directly

Files uploaded to Drive remain there. Update any broken `drive_id` references in `chamados` table after restoring.

---

## Scenario 4 — Server Machine Lost / Migration

**Time to recovery: ~2 hours**

### Step 1 — Restore .env

1. Download `config_YYYY-MM-DD.env` from Drive
2. Rename to `.env`
3. Verify all keys are present (see list below)

**Required .env keys:**
```
SUPABASE_URL
SUPABASE_KEY  
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_DB_URL
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
DRIVE_CLIENT_ID
DRIVE_CLIENT_SECRET
DRIVE_REDIRECT_URI
JWT_SECRET
JIRA_BASE_URL
JIRA_EMAIL
JIRA_API_TOKEN
GROQ_API_KEY
PORT
BACKUP_DRIVE_FOLDER_ID
BACKUP_DRIVE_TOKEN
```

### Step 2 — Install dependencies

```bash
# Install Node.js 20 LTS
winget install OpenJS.NodeJS.LTS   # Windows
brew install node@20               # Mac

# Clone or copy project files
cd C:\Belenergy

# Install npm packages
npm install

# Install Python deps for OCR server
pip install fastapi uvicorn pytesseract Pillow --break-system-packages
```

### Step 3 — Install external tools

```bash
# Tesseract OCR
winget install UB-Mannheim.TesseractOCR

# Poppler
winget install oschwartz10612.Poppler

# Ollama (for AI + embeddings)
winget install Ollama.Ollama
ollama pull nomic-embed-text
ollama pull moondream
```

### Step 4 — Rebuild frontend

```bash
npm run build
```

### Step 5 — Start

```bash
node server.js
# or double-click iniciar.bat
```

---

## Backup Verification (run weekly)

```bash
# 1. Check last backup date
ls -la _backups/

# 2. Verify DB dump is readable
gunzip -t _backups/db_$(date +%Y-%m-%d).sql.gz && echo "OK"

# 3. Trigger manual backup
node backup.js

# 4. Check Drive folder has today's files
# (open Drive link in browser)

# 5. Test restore on staging (monthly)
# Create a temp Supabase project, restore dump, verify counts match
```

---

## .env Variables Checklist

Print this and keep with passwords:

- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `SUPABASE_DB_URL` (get from Supabase → Settings → Database)
- [ ] `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- [ ] `DRIVE_CLIENT_ID` / `DRIVE_CLIENT_SECRET`
- [ ] `JWT_SECRET` (any random 64-char string)
- [ ] `JIRA_BASE_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN`
- [ ] `GROQ_API_KEY`
- [ ] `BACKUP_DRIVE_FOLDER_ID` (Drive folder ID for backups)
- [ ] `BACKUP_DRIVE_TOKEN` (OAuth token with Drive write access)

---

## Recovery Time Estimates

| Scenario | RTO | RPO |
|---|---|---|
| Supabase down (auto-queues) | 0 min (auto) | 0 (queued) |
| DB corruption, same project | 30 min | 24h |
| Full project loss | 60 min | 24h |
| Server machine lost | 2h | 24h |
| Everything lost, no backup | Days | ∞ |

**RTO** = Recovery Time Objective (how long to restore service)
**RPO** = Recovery Point Objective (how much data could be lost)

---

*Last updated: 2026 — Belenergy Support Pro*

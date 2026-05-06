#!/usr/bin/env node
// ============================================================
// Belenergy Support Pro — Disaster Recovery Backup Script
// Schedule: daily via Windows Task Scheduler or node-cron
//
// What it does:
//   1. pg_dump  → compressed SQL → Google Drive
//   2. Supabase Storage → local mirror → Google Drive
//   3. .env snapshot → Drive (keys redacted in log)
//
// Run manually: node backup.js
// Cron (Linux):  0 2 * * * /usr/bin/node /path/to/backup.js >> /var/log/belenergy-backup.log 2>&1
// Windows Task:  node C:\Belenergy\backup.js >> C:\Belenergy\logs\backup.log
// ============================================================

require('dotenv').config();
const { execSync, spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_DB_URL   = process.env.SUPABASE_DB_URL;   // postgres://user:pass@host:5432/postgres
const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRIVE_FOLDER_ID   = process.env.BACKUP_DRIVE_FOLDER_ID; // dedicated backup folder
const DRIVE_TOKEN       = process.env.BACKUP_DRIVE_TOKEN;     // long-lived service account token
const BACKUP_DIR        = path.join(__dirname, '_backups');
const LOG_FILE          = path.join(__dirname, 'logs', 'backup.log');
const RETENTION_DAYS    = 7; // keep 7 days of local backups

const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (msg) => {
  const line = `[${ts()}] ${msg}`;
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (_) {}
};

const dateTag = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ── 1. Database backup via pg_dump ────────────────────────────────────────────
async function backupDatabase() {
  log('=== DATABASE BACKUP START ===');

  if (!SUPABASE_DB_URL) {
    log('SKIP: SUPABASE_DB_URL not set — add to .env for DB backup');
    return null;
  }

  const outFile = path.join(BACKUP_DIR, `db_${dateTag}.sql.gz`);

  try {
    // pg_dump | gzip → compressed SQL file
    // Supabase DB URL format: postgres://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres
    execSync(
      `pg_dump "${SUPABASE_DB_URL}" | gzip > "${outFile}"`,
      { stdio: ['ignore', 'pipe', 'pipe'], shell: true }
    );

    const sizeKB = Math.round(fs.statSync(outFile).size / 1024);
    log(`DB backup: ${outFile} (${sizeKB} KB)`);
    return outFile;
  } catch (err) {
    log(`DB backup FAILED: ${err.message}`);
    log('  Is pg_dump installed? https://www.postgresql.org/download/');
    return null;
  }
}

// ── 2. Supabase Storage backup ────────────────────────────────────────────────
async function backupStorage() {
  log('=== STORAGE BACKUP START ===');

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    log('SKIP: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    return [];
  }

  const storageDir = path.join(BACKUP_DIR, `storage_${dateTag}`);
  fs.mkdirSync(storageDir, { recursive: true });

  const savedFiles = [];

  try {
    // List all buckets
    const bucketsRes = await apiCall(`${SUPABASE_URL}/storage/v1/bucket`, SUPABASE_KEY);
    const buckets    = JSON.parse(bucketsRes);

    for (const bucket of buckets) {
      log(`  Bucket: ${bucket.name}`);
      const bucketDir = path.join(storageDir, bucket.name);
      fs.mkdirSync(bucketDir, { recursive: true });

      // List files in bucket
      const filesRes = await apiCall(
        `${SUPABASE_URL}/storage/v1/object/list/${bucket.name}`,
        SUPABASE_KEY,
        'POST',
        JSON.stringify({ prefix: '', limit: 1000 })
      );
      const files = JSON.parse(filesRes);

      for (const file of files) {
        if (!file.name) continue;
        try {
          // Download each file
          const fileData = await downloadFile(
            `${SUPABASE_URL}/storage/v1/object/${bucket.name}/${file.name}`,
            SUPABASE_KEY
          );
          const localPath = path.join(bucketDir, file.name.replace(/\//g, '_'));
          fs.writeFileSync(localPath, fileData);
          savedFiles.push(localPath);
        } catch (e) {
          log(`    WARN: Could not download ${file.name}: ${e.message}`);
        }
      }
      log(`    Saved ${savedFiles.length} files from ${bucket.name}`);
    }
  } catch (err) {
    log(`Storage backup FAILED: ${err.message}`);
  }

  return savedFiles;
}

// ── 3. Config backup ──────────────────────────────────────────────────────────
function backupConfig() {
  log('=== CONFIG BACKUP ===');

  const envFile = path.join(__dirname, '.env');
  if (!fs.existsSync(envFile)) {
    log('SKIP: .env not found');
    return null;
  }

  // Save a copy with sensitive values partially redacted for the log
  const outFile = path.join(BACKUP_DIR, `config_${dateTag}.env`);
  fs.copyFileSync(envFile, outFile);

  // Log which keys exist (never log values)
  const keys = fs.readFileSync(envFile, 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => l.split('=')[0].trim());
  log(`Config backup: ${keys.length} keys [${keys.join(', ')}]`);

  return outFile;
}

// ── 4. Upload to Google Drive ─────────────────────────────────────────────────
async function uploadToDrive(filePath) {
  if (!DRIVE_TOKEN || !DRIVE_FOLDER_ID) {
    log(`SKIP Drive upload (no token/folder). File kept locally: ${filePath}`);
    return;
  }

  const fileName = path.basename(filePath);
  const fileData = fs.readFileSync(filePath);
  const boundary = 'BACKUP_BOUNDARY_' + Date.now();

  const metadata = JSON.stringify({ name: fileName, parents: [DRIVE_FOLDER_ID] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
    fileData,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  try {
    await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'www.googleapis.com',
        path:     '/upload/drive/v3/files?uploadType=multipart',
        method:   'POST',
        headers:  {
          'Authorization':  `Bearer ${DRIVE_TOKEN}`,
          'Content-Type':   `multipart/related; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      }, res => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const data = JSON.parse(raw);
            log(`Drive upload OK: ${fileName} → ${data.id}`);
            resolve();
          } else {
            reject(new Error(`Drive ${res.statusCode}: ${raw.slice(0, 200)}`));
          }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  } catch (err) {
    log(`Drive upload FAILED for ${fileName}: ${err.message}`);
  }
}

// ── 5. Cleanup old local backups ──────────────────────────────────────────────
function cleanOldBackups() {
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  const files  = fs.readdirSync(BACKUP_DIR);
  let removed  = 0;
  for (const f of files) {
    const fp   = path.join(BACKUP_DIR, f);
    const stat = fs.statSync(fp);
    if (stat.mtimeMs < cutoff) {
      if (stat.isDirectory()) fs.rmSync(fp, { recursive: true });
      else fs.unlinkSync(fp);
      removed++;
    }
  }
  if (removed > 0) log(`Cleaned ${removed} old backup(s) (>${RETENTION_DAYS}d)`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function apiCall(url, token, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const u   = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const opts = {
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey':        token,
        'Content-Type':  'application/json',
      },
    };
    const req = mod.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString()));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function downloadFile(url, token) {
  return new Promise((resolve, reject) => {
    const u   = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: u.hostname, path: u.pathname,
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': token },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log('');
  log('===============================================');
  log('  BELENERGY BACKUP — ' + dateTag);
  log('===============================================');

  const results = { db: false, storage: false, config: false };

  try {
    // Database
    const dbFile = await backupDatabase();
    if (dbFile) { await uploadToDrive(dbFile); results.db = true; }

    // Storage
    const storageFiles = await backupStorage();
    if (storageFiles.length > 0) {
      // Zip the storage folder and upload
      const storageDir = path.join(BACKUP_DIR, `storage_${dateTag}`);
      const zipFile    = storageDir + '.zip';
      try {
        execSync(`cd "${BACKUP_DIR}" && zip -r "storage_${dateTag}.zip" "storage_${dateTag}"`, { shell: true });
        await uploadToDrive(zipFile);
        results.storage = true;
      } catch (_) {
        // zip not available — upload individually
        for (const f of storageFiles.slice(0, 20)) {
          await uploadToDrive(f);
        }
        results.storage = storageFiles.length > 0;
      }
    }

    // Config
    const cfgFile = backupConfig();
    if (cfgFile) { await uploadToDrive(cfgFile); results.config = true; }

    // Cleanup
    cleanOldBackups();

    const ok = Object.values(results).filter(Boolean).length;
    log('');
    log(`DONE: ${ok}/3 components backed up`);
    log(`  DB:      ${results.db      ? '✓' : '✗'}`);
    log(`  Storage: ${results.storage ? '✓' : '✗'}`);
    log(`  Config:  ${results.config  ? '✓' : '✗'}`);
    log('===============================================');

    process.exit(ok === 0 ? 1 : 0);
  } catch (err) {
    log(`FATAL: ${err.stack}`);
    process.exit(1);
  }
}

main();

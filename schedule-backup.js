// schedule-backup.js
//
// Drop-in cron scheduler for backup.js.
// Runs daily at 02:00 AM local time.
// Add to server.js: require('./schedule-backup');
//
// No external cron dependency — uses setInterval + time check.

'use strict';

const { execFile } = require('child_process');
const path         = require('path');
const fs           = require('fs');

const BACKUP_SCRIPT = path.join(__dirname, 'backup.js');
const LOG_DIR       = path.join(__dirname, 'logs');
const BACKUP_HOUR   = parseInt(process.env.BACKUP_HOUR || '2'); // 2 AM default

fs.mkdirSync(LOG_DIR, { recursive: true });

let _lastRun = null; // date string YYYY-MM-DD of last backup

function shouldRunToday() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  return now.getHours() === BACKUP_HOUR && _lastRun !== today;
}

function runBackup() {
  const today = new Date().toISOString().slice(0, 10);
  _lastRun = today;

  const logFile = path.join(LOG_DIR, `backup_${today}.log`);
  const out     = fs.openSync(logFile, 'a');
  const err     = fs.openSync(logFile, 'a');

  console.log(`[Backup Scheduler] Starting backup — log: ${logFile}`);

  const child = execFile(process.execPath, [BACKUP_SCRIPT], {
    stdio: ['ignore', out, err],
    env:   { ...process.env },
  });

  child.on('close', code => {
    fs.closeSync(out); fs.closeSync(err);
    if (code === 0) console.log('[Backup Scheduler] Backup completed ✓');
    else            console.warn(`[Backup Scheduler] Backup exited with code ${code}`);
  });
}

// Check every minute
const interval = setInterval(() => {
  if (shouldRunToday()) runBackup();
}, 60_000);

// Prevent interval from keeping process alive alone
interval.unref();

console.log(`[Backup Scheduler] Daily backup scheduled at ${BACKUP_HOUR}:00`);

module.exports = { runBackup }; // export for manual trigger

'use strict';

/*
 * Runs one Claude Code CLI turn (`claude -p`) in a project folder when the user asks for it,
 * and returns the answer. It runs in `acceptEdits` mode: Claude may read and edit files inside
 * that folder, nothing more. Every call is started by the user and confirmed first.
 */

const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { isWin, ToolError } = require('./tools/util');

let cachedPath = null;

async function locate() {
  if (cachedPath && fs.existsSync(cachedPath)) return cachedPath;
  const found = await new Promise((resolve) => {
    execFile(isWin ? 'where' : 'which', ['claude'], { timeout: 5000, windowsHide: true }, (err, out) => {
      resolve(err ? null : out.toString().split(/\r?\n/).map((s) => s.trim()).find(Boolean));
    });
  });
  if (found && fs.existsSync(found)) return (cachedPath = found);
  const home = os.homedir();
  const candidates = isWin
    ? [path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'), path.join(home, '.local', 'bin', 'claude.exe')]
    : [path.join(home, '.claude', 'local', 'claude'), path.join(home, '.local', 'bin', 'claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude'];
  for (const c of candidates) if (fs.existsSync(c)) return (cachedPath = c);
  throw new ToolError('Claude Code bu bilgisayarda bulunamadı.', 'Kur: npm install -g @anthropic-ai/claude-code, sonra bir kez "claude" yazıp giriş yap.');
}

function runOnce(prompt, { cwd, resume, timeout = 15 * 60 * 1000 } = {}) {
  return locate().then((bin) => new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'json', '--permission-mode', 'acceptEdits'];
    if (resume) args.push('--resume', resume);
    args.push(prompt);
    // .cmd shims on Windows need a shell to start.
    const child = spawn(bin, args, { cwd, windowsHide: true, shell: isWin && bin.endsWith('.cmd') });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', (e) => { clearTimeout(timer); reject(new ToolError(`Claude Code başlatılamadı: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      let data = null;
      try { data = JSON.parse(out.trim().split('\n').pop()); } catch { /* not JSON */ }
      if (!data) return reject(new ToolError(`Claude Code yanıt vermedi (çıkış ${code}). ${err.trim().slice(-200)}`));
      resolve({ ok: !data.is_error, text: String(data.result || '').trim(), sessionId: data.session_id || resume, cost: data.total_cost_usd });
    });
  }));
}

module.exports = { runOnce, locate };

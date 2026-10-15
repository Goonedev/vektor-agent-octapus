'use strict';

/*
 * Conversation history: every finished user/model message and every tool call is appended to a
 * JSON-lines file, one object per line. Appending never rewrites old data, so a crash loses at
 * most the line being written. The file is trimmed to the newest MAX lines once it grows past it.
 */

const fs = require('node:fs');
const path = require('node:path');
const { norm } = require('./tools/util');

const MAX = 20000;

class History {
  constructor(file) {
    this.file = file;
    this.count = null;
  }

  add(entry) {
    const e = {
      t: Number(entry.t) || Date.now(),
      session: String(entry.session || ''),
      role: ['user', 'model', 'tool', 'system'].includes(entry.role) ? entry.role : 'system',
      text: String(entry.text ?? '').slice(0, 4000)
    };
    if (entry.tool) e.tool = String(entry.tool).slice(0, 80);
    if (entry.ok === false) e.ok = false;
    if (!e.text.trim()) return null;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, JSON.stringify(e) + '\n');
    if (this.count != null) this.count++;
    if ((this.count ?? this.all().length) > MAX * 1.2) this.trim();
    return e;
  }

  all() {
    let text = '';
    try { text = fs.readFileSync(this.file, 'utf8'); } catch { return []; }
    const out = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      try { out.push(JSON.parse(line)); } catch { /* a half-written line after a crash */ }
    }
    this.count = out.length;
    return out;
  }

  trim() {
    const keep = this.all().slice(-MAX);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, keep.map((e) => JSON.stringify(e)).join('\n') + '\n');
    fs.renameSync(tmp, this.file);
    this.count = keep.length;
  }

  /** Newest first. `query` matches all of its words (Turkish-insensitive) in the text. */
  search({ query = '', limit = 200, before } = {}) {
    const words = norm(query).split(/\s+/).filter(Boolean);
    const out = [];
    const list = this.all();
    for (let i = list.length - 1; i >= 0 && out.length < limit; i--) {
      const e = list[i];
      if (before && e.t >= before) continue;
      if (words.length) {
        const hay = norm(`${e.text} ${e.tool || ''}`);
        if (!words.every((w) => hay.includes(w))) continue;
      }
      out.push(e);
    }
    return out;
  }

  /** The last `n` user/model messages, oldest first: context for a new live session. */
  recent(n = 12) {
    return this.all().filter((e) => e.role === 'user' || e.role === 'model').slice(-n);
  }

  clear() {
    try { fs.rmSync(this.file, { force: true }); } catch { /* already gone */ }
    this.count = 0;
  }
}

module.exports = { History };

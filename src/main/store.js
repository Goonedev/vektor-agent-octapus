'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

/**
 * A tiny JSON-file store. Writes are debounced and atomic (write to a temp file, then rename),
 * so a crash mid-write never leaves a half-written settings file behind.
 */
class Store extends EventEmitter {
  constructor(file, defaults = {}) {
    super();
    this.file = file;
    this.defaults = defaults;
    this.data = structuredClone(defaults);
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.data = { ...this.data, ...saved };
    } catch { /* first run or unreadable: start from defaults */ }
    this.timer = null;
  }

  get(key) {
    return key ? this.data[key] : this.data;
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
    this.emit('change', key, value);
    return value;
  }

  update(key, fn) {
    return this.set(key, fn(structuredClone(this.data[key] ?? this.defaults[key])));
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 150);
  }

  flush() {
    clearTimeout(this.timer);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store };

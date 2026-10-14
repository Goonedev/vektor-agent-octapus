'use strict';

const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const { norm } = require('./tools/util');

/**
 * Timers, alarms and reminders. Alarms and reminders persist in the store so they survive
 * a restart; plain countdown timers live only in memory. Fired items emit 'fire'.
 */
class Scheduler extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.handles = new Map();
    this.memory = [];
    for (const item of this.persisted()) this.arm(item);
  }

  persisted() {
    return this.store.get('schedule') || [];
  }

  list() {
    return [...this.memory, ...this.persisted()].sort((a, b) => a.endsAt - b.endsAt);
  }

  add({ kind, label, endsAt, total }) {
    const item = { id: crypto.randomUUID().slice(0, 8), kind, label, endsAt, total: total ?? endsAt - Date.now(), createdAt: Date.now() };
    if (kind === 'timer') this.memory.push(item);
    else this.store.update('schedule', (s) => [...(s || []), item]);
    this.arm(item);
    this.emit('change');
    return item;
  }

  arm(item) {
    const delay = item.endsAt - Date.now();
    if (delay <= 0) {
      // Missed while Vektör was closed: fire once now, a little late beats never.
      setTimeout(() => this.fire(item.id), 1500);
      return;
    }
    // setTimeout overflows past ~24.8 days; re-arm in steps for anything longer.
    const step = Math.min(delay, 2 ** 31 - 1);
    this.handles.set(item.id, setTimeout(() => (step < delay ? this.arm(item) : this.fire(item.id)), step));
  }

  remove(id) {
    clearTimeout(this.handles.get(id));
    this.handles.delete(id);
    const before = this.list().length;
    this.memory = this.memory.filter((i) => i.id !== id);
    this.store.update('schedule', (s) => (s || []).filter((i) => i.id !== id));
    this.emit('change');
    return this.list().length < before;
  }

  find(query) {
    const q = norm(query);
    return this.list().find((i) => i.id === query || norm(i.label).includes(q));
  }

  fire(id) {
    const item = this.list().find((i) => i.id === id);
    if (!item) return;
    this.remove(id);
    this.emit('fire', item);
  }
}

module.exports = { Scheduler };

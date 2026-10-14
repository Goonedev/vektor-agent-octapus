'use strict';

const crypto = require('node:crypto');
const { ToolError, norm, duration } = require('./util');

const fmtTime = (ms) => new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
const fmtWhen = (ms) => {
  const d = new Date(ms), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now.getTime() + 86400000).toDateString() === d.toDateString();
  return `${sameDay ? 'bugün' : tomorrow ? 'yarın' : d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })} ${fmtTime(ms)}`;
};

/** "07:30", "7.30", "19" → the next time that clock time occurs. */
function nextClock(text) {
  const m = String(text).trim().match(/^(\d{1,2})(?:[:.](\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2] || 0);
  if (h > 23 || min > 59) return null;
  const d = new Date();
  d.setHours(h, min, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Accepts "HH:MM", ISO dates and "YYYY-MM-DD HH:MM". */
function parseWhen(text) {
  const clock = nextClock(text);
  if (clock) return clock;
  const t = Date.parse(String(text).trim().replace(' ', 'T'));
  return Number.isFinite(t) ? t : null;
}

function timerCard(item) {
  return { type: 'timer', id: item.id, label: item.label, endsAt: item.endsAt, total: item.total, kind: item.kind };
}

module.exports = [
  {
    name: 'set_timer',
    category: 'productivity',
    title: 'Zamanlayıcı kur',
    description: 'Geri sayım zamanlayıcısı kurar; süre dolunca bildirim ve ses verir, sen de kullanıcıya haber verirsin.',
    params: {
      minutes: { type: 'number', description: 'Süre (dakika). Saniye için kesirli ver, ör. 0.5.', required: true },
      label: { type: 'string', description: 'Zamanlayıcının adı, ör. "Çay".' }
    },
    run: async (a, ctx) => {
      if (!(a.minutes > 0)) throw new ToolError('Süre sıfırdan büyük olmalı.');
      const total = Math.round(a.minutes * 60000);
      const item = ctx.scheduler.add({ kind: 'timer', label: a.label || `${duration(total / 1000)} zamanlayıcı`, endsAt: Date.now() + total, total });
      return { summary: `${duration(total / 1000)} zamanlayıcı kuruldu (${fmtTime(item.endsAt)}).`, display: timerCard(item), data: { id: item.id } };
    }
  },
  {
    name: 'set_alarm',
    category: 'productivity',
    title: 'Alarm kur',
    description: 'Belirli bir saate alarm kurar (ör. "07:30"). Saat geçmişse yarına kurulur.',
    params: {
      time: { type: 'string', description: 'Saat, SS:DD biçiminde.', required: true },
      label: { type: 'string', description: 'Alarm adı.' }
    },
    run: async (a, ctx) => {
      const at = nextClock(a.time);
      if (!at) throw new ToolError('Saat SS:DD biçiminde olmalı, ör. 07:30.');
      const item = ctx.scheduler.add({ kind: 'alarm', label: a.label || 'Alarm', endsAt: at });
      return { summary: `Alarm ${fmtWhen(at)} için kuruldu.`, display: timerCard(item), data: { id: item.id, at: new Date(at).toISOString() } };
    }
  },
  {
    name: 'set_reminder',
    category: 'productivity',
    title: 'Hatırlatıcı',
    description: 'Bir şeyi hatırlatmak için hatırlatıcı kurar. Ya dakika sonra ya da belirli zamanda.',
    params: {
      text: { type: 'string', description: 'Hatırlatılacak şey.', required: true },
      in_minutes: { type: 'number', description: 'Kaç dakika sonra.' },
      at: { type: 'string', description: 'Ne zaman: "14:30" ya da "2026-10-20 09:00".' }
    },
    run: async (a, ctx) => {
      const at = a.in_minutes > 0 ? Date.now() + a.in_minutes * 60000 : a.at ? parseWhen(a.at) : null;
      if (!at || at <= Date.now()) throw new ToolError('Geçerli bir gelecek zaman ya da dakika vermelisin.');
      const item = ctx.scheduler.add({ kind: 'reminder', label: a.text, endsAt: at });
      return { summary: `${fmtWhen(at)} için hatırlatıcı kuruldu: ${a.text}.`, display: timerCard(item), data: { id: item.id } };
    }
  },
  {
    name: 'list_timers',
    category: 'productivity',
    title: 'Zamanlayıcılar',
    description: 'Aktif zamanlayıcıları, alarmları ve hatırlatıcıları listeler.',
    params: {},
    run: async (a, ctx) => {
      const list = ctx.scheduler.list();
      const kinds = { timer: 'Zamanlayıcı', alarm: 'Alarm', reminder: 'Hatırlatıcı' };
      return {
        summary: list.length ? list.map((i) => `${i.label} (${fmtWhen(i.endsAt)})`).join(', ') : 'Aktif zamanlayıcı yok.',
        display: { type: 'list', items: list.map((i) => ({ title: i.label, subtitle: kinds[i.kind], meta: fmtWhen(i.endsAt), icon: i.kind === 'alarm' ? 'bell' : 'timer', countdown: i.endsAt })) },
        data: list.map((i) => ({ id: i.id, kind: i.kind, label: i.label, at: fmtWhen(i.endsAt) }))
      };
    }
  },
  {
    name: 'cancel_timer',
    category: 'productivity',
    title: 'Zamanlayıcıyı iptal et',
    description: 'Bir zamanlayıcı, alarm ya da hatırlatıcıyı adıyla ya da kimliğiyle iptal eder. "hepsi" hepsini iptal eder.',
    params: { query: { type: 'string', description: 'Ad, kimlik ya da "hepsi".', required: true } },
    run: async (a, ctx) => {
      if (/^(hepsi|tümü|all)$/i.test(a.query.trim())) {
        const all = ctx.scheduler.list();
        all.forEach((i) => { ctx.scheduler.remove(i.id); ctx.emit?.('timer-cancel', { id: i.id }); });
        return { summary: `${all.length} zamanlayıcı iptal edildi.` };
      }
      const item = ctx.scheduler.find(a.query);
      if (!item) throw new ToolError(`“${a.query}” adında bir zamanlayıcı yok.`);
      ctx.scheduler.remove(item.id);
      ctx.emit?.('timer-cancel', { id: item.id });
      return { summary: `${item.label} iptal edildi.`, display: { type: 'kv', rows: [['İptal edildi', item.label]] } };
    }
  },
  {
    name: 'show_notification',
    category: 'productivity',
    title: 'Bildirim göster',
    description: 'Masaüstünde bir sistem bildirimi gösterir.',
    params: {
      title: { type: 'string', description: 'Başlık.', required: true },
      body: { type: 'string', description: 'İçerik.' }
    },
    run: async (a, ctx) => {
      ctx.notify(a.title, a.body || '');
      return { summary: 'Bildirim gösterildi.', display: { type: 'kv', rows: [['Bildirim', a.title], ...(a.body ? [['', a.body]] : [])] } };
    }
  },
  {
    name: 'add_note',
    category: 'productivity',
    title: 'Not al',
    description: 'Vektör not defterine bir not kaydeder.',
    params: {
      text: { type: 'string', description: 'Not içeriği.', required: true },
      title: { type: 'string', description: 'İsteğe bağlı başlık.' }
    },
    run: async (a, ctx) => {
      const note = { id: crypto.randomUUID().slice(0, 8), title: a.title || a.text.split(/[.!?\n]/)[0].slice(0, 60), text: a.text, createdAt: Date.now() };
      ctx.store.update('notes', (n) => [note, ...(n || [])]);
      return { summary: `Not kaydedildi: ${note.title}.`, display: { type: 'note', title: note.title, text: note.text }, data: { id: note.id } };
    }
  },
  {
    name: 'list_notes',
    category: 'productivity',
    title: 'Notlar',
    description: 'Kayıtlı notları listeler; isteğe bağlı olarak içinde arama yapar.',
    params: { search: { type: 'string', description: 'Aranacak kelime.' } },
    run: async (a, ctx) => {
      const q = norm(a.search);
      const notes = (ctx.store.get('notes') || []).filter((n) => !q || norm(`${n.title} ${n.text}`).includes(q));
      return {
        summary: notes.length ? `${notes.length} not bulundu.` : 'Not bulunamadı.',
        display: { type: 'list', items: notes.slice(0, 30).map((n) => ({ title: n.title, subtitle: n.text.slice(0, 120), meta: new Date(n.createdAt).toLocaleDateString('tr-TR'), icon: 'note' })) },
        data: notes.slice(0, 30).map((n) => ({ id: n.id, title: n.title, text: n.text }))
      };
    }
  },
  {
    name: 'delete_note',
    category: 'productivity',
    title: 'Notu sil',
    description: 'Bir notu kimliğiyle ya da başlığındaki bir kelimeyle siler.',
    params: { query: { type: 'string', description: 'Not kimliği ya da başlık parçası.', required: true } },
    run: async (a, ctx) => {
      const q = norm(a.query);
      const notes = ctx.store.get('notes') || [];
      const hit = notes.find((n) => n.id === a.query) || notes.find((n) => norm(`${n.title} ${n.text}`).includes(q));
      if (!hit) throw new ToolError(`“${a.query}” ile eşleşen not yok.`);
      ctx.store.set('notes', notes.filter((n) => n.id !== hit.id));
      return { summary: `“${hit.title}” notu silindi.`, display: { type: 'kv', rows: [['Silindi', hit.title]] } };
    }
  },
  {
    name: 'add_todo',
    category: 'productivity',
    title: 'Görev ekle',
    description: 'Yapılacaklar listesine bir görev ekler.',
    params: {
      text: { type: 'string', description: 'Görev.', required: true },
      due: { type: 'string', description: 'İsteğe bağlı son tarih, ör. "yarın" ya da "2026-10-20".' }
    },
    run: async (a, ctx) => {
      const todo = { id: crypto.randomUUID().slice(0, 8), text: a.text, due: a.due || null, done: false, createdAt: Date.now() };
      ctx.store.update('todos', (t) => [todo, ...(t || [])]);
      const open = (ctx.store.get('todos') || []).filter((t) => !t.done);
      return { summary: `Görev eklendi. Açık görev sayısı ${open.length}.`, display: { type: 'todos', items: open.slice(0, 8), highlight: todo.id }, data: { id: todo.id } };
    }
  },
  {
    name: 'list_todos',
    category: 'productivity',
    title: 'Yapılacaklar',
    description: 'Yapılacaklar listesini gösterir.',
    params: { include_done: { type: 'boolean', description: 'Tamamlananlar da gösterilsin mi.' } },
    run: async (a, ctx) => {
      const all = ctx.store.get('todos') || [];
      const list = a.include_done ? all : all.filter((t) => !t.done);
      return {
        summary: list.length ? `${list.length} görev: ${list.slice(0, 5).map((t) => t.text).join('; ')}.` : 'Yapılacak görev yok.',
        display: { type: 'todos', items: list.slice(0, 20) },
        data: list.map((t) => ({ id: t.id, text: t.text, due: t.due, done: t.done }))
      };
    }
  },
  {
    name: 'complete_todo',
    category: 'productivity',
    title: 'Görevi tamamla',
    description: 'Bir görevi tamamlandı olarak işaretler.',
    params: { query: { type: 'string', description: 'Görev kimliği ya da metninden bir parça.', required: true } },
    run: async (a, ctx) => {
      const q = norm(a.query);
      const todos = ctx.store.get('todos') || [];
      const hit = todos.find((t) => t.id === a.query) || todos.find((t) => !t.done && norm(t.text).includes(q));
      if (!hit) throw new ToolError(`“${a.query}” ile eşleşen görev yok.`);
      ctx.store.set('todos', todos.map((t) => (t.id === hit.id ? { ...t, done: true, doneAt: Date.now() } : t)));
      const open = (ctx.store.get('todos') || []).filter((t) => !t.done);
      return { summary: `“${hit.text}” tamamlandı. ${open.length} görev kaldı.`, display: { type: 'todos', items: [{ ...hit, done: true }, ...open.slice(0, 6)], highlight: hit.id } };
    }
  }
];

module.exports.parseWhen = parseWhen;
module.exports.nextClock = nextClock;

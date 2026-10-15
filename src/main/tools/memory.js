'use strict';

/*
 * What Vektör keeps between sessions:
 * - memory: short facts and preferences the user wants remembered ("adım Kadir", "müziği hep
 *   Spotify'da aç"). They are added to the system prompt of every new session.
 * - skills: named routines the user saved ("çalışma modu"), each a list of tool steps. Running
 *   one goes through run_steps, so every step that needs approval still asks.
 * - history: search past conversations.
 */

const crypto = require('node:crypto');
const { ToolError, norm, truncate } = require('./util');

const MAX_MEMORY = 200;
const id = () => crypto.randomBytes(4).toString('hex');

/* Things that must never be written to memory, whatever the user says. */
const SECRET = /(şifre|parola|password|passwd|\bpin\b|cvv|cvc|kart numaras|card number|iban|api[ _-]?key|token|secret|\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b)/i;

function matches(text, query) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  const hay = norm(text);
  return words.length > 0 && words.every((w) => hay.includes(w));
}

function findSkill(list, name) {
  const n = norm(name);
  return list.find((s) => norm(s.name) === n) || list.find((s) => norm(s.name).includes(n) || n.includes(norm(s.name)));
}

const STEP = {
  type: 'object',
  properties: {
    tool: { type: 'string', description: 'Aracın adı, ör. open_app ya da settings_display.' },
    args_json: { type: 'string', description: 'Parametreler JSON olarak, ör. {"name":"Spotify"}. Parametresizse {}.' },
    wait_ms: { type: 'integer', description: 'Bu adımdan sonra beklenecek milisaniye (en fazla 30000).' }
  },
  required: ['tool']
};

module.exports = [
  {
    name: 'remember',
    category: 'productivity',
    title: 'Hatırla',
    description: 'Kullanıcının kalıcı bir tercihini ya da kendisiyle ilgili bir bilgiyi hafızaya kaydeder ("adım Kadir", "bana kısa cevap ver", "müziği Spotify\'da aç"). Hafıza her yeni oturumda sana verilir. Kullanıcı "bunu hatırla", "bundan sonra" dediğinde ya da açıkça kalıcı bir tercih söylediğinde kullan. Şifre, kart numarası, anahtar gibi gizli bilgileri kaydetme.',
    params: {
      text: { type: 'string', description: 'Kısa, kendi başına anlaşılır bir cümle; ör. "Kullanıcının adı Kadir."', required: true },
      topic: { type: 'string', description: 'İsteğe bağlı konu etiketi: kişisel, tercih, iş, cihaz...' }
    },
    run: (a, ctx) => {
      const text = String(a.text).trim().slice(0, 300);
      if (!text) throw new ToolError('Hatırlanacak bir şey söylemedin.');
      if (SECRET.test(text)) throw new ToolError('Şifre, kart numarası ya da anahtar gibi gizli bilgileri hafızaya kaydetmiyorum.');
      const list = ctx.store.get('memory') || [];
      const same = list.find((m) => norm(m.text) === norm(text));
      if (same) return { summary: 'Bunu zaten hatırlıyorum.', display: { type: 'note', title: 'Hafıza', text }, data: { id: same.id } };
      const item = { id: id(), text, topic: a.topic ? String(a.topic).slice(0, 30) : '', createdAt: Date.now() };
      ctx.store.set('memory', [...list, item].slice(-MAX_MEMORY));
      return { summary: 'Hafızaya kaydettim.', display: { type: 'note', title: 'Hafızaya eklendi', text }, data: { id: item.id } };
    }
  },
  {
    name: 'recall',
    category: 'productivity',
    title: 'Hafızaya bak',
    description: 'Hafızadaki bilgileri listeler ya da bir konuda arar. "Benim hakkımda ne biliyorsun?", "neyi hatırlıyorsun?" sorularında kullan.',
    params: { query: { type: 'string', description: 'Aranacak kelimeler. Boşsa hepsi.' } },
    run: (a, ctx) => {
      const list = ctx.store.get('memory') || [];
      const hits = a.query ? list.filter((m) => matches(`${m.text} ${m.topic}`, a.query)) : list;
      return {
        summary: hits.length ? `Hafızada ${hits.length} bilgi: ${hits.slice(-15).map((m) => m.text).join(' | ')}` : (a.query ? `“${a.query}” hakkında bir şey hatırlamıyorum.` : 'Hafızam henüz boş.'),
        display: { type: 'list', title: 'Hafıza', items: hits.slice(-30).reverse().map((m) => ({ title: m.text, meta: m.topic || '', icon: 'lightbulb' })) },
        data: hits.slice(-40).map((m) => ({ id: m.id, text: m.text, topic: m.topic }))
      };
    }
  },
  {
    name: 'forget',
    category: 'productivity',
    title: 'Unut',
    description: 'Hafızadan bir bilgiyi siler. Kullanıcı "bunu unut" dediğinde kullan; neyin silineceğini query ile belirt. all=true hafızanın tamamını siler.',
    danger: true,
    params: {
      query: { type: 'string', description: 'Silinecek bilgiyi tarif eden kelimeler.' },
      all: { type: 'boolean', description: 'Hafızanın tamamını sil.' }
    },
    run: (a, ctx) => {
      const list = ctx.store.get('memory') || [];
      if (a.all) {
        ctx.store.set('memory', []);
        return { summary: `Hafızadaki ${list.length} bilginin hepsi silindi.`, display: { type: 'power', action: 'trash', label: 'Hafıza temizlendi' } };
      }
      if (!a.query) throw new ToolError('Neyi unutmamı istediğini söylemelisin.');
      const gone = list.filter((m) => matches(`${m.text} ${m.topic}`, a.query));
      if (!gone.length) throw new ToolError(`Hafızada “${a.query}” ile ilgili bir şey yok.`);
      ctx.store.set('memory', list.filter((m) => !gone.includes(m)));
      return { summary: `${gone.length} bilgi unutuldu: ${gone.map((m) => m.text).join(' | ')}`, display: { type: 'list', title: 'Unutuldu', items: gone.map((m) => ({ title: m.text, icon: 'trash' })) } };
    }
  },
  {
    name: 'skill_save',
    category: 'productivity',
    title: 'Beceri kaydet',
    description: 'Kullanıcının adlandırdığı çok adımlı bir işi (rutin) kaydeder; sonra adıyla tek komutla çalıştırılır. Ör. "çalışma modu" = VS Code\'u aç, Spotify\'da odak müziği çal, bildirimleri kapat. Adımlar run_steps ile aynı biçimdedir. Aynı adla kaydedilirse günceller. Yalnızca kullanıcı bir rutin tanımlamak istediğinde kullan.',
    params: {
      name: { type: 'string', description: 'Becerinin adı, ör. "çalışma modu".', required: true },
      description: { type: 'string', description: 'Ne yaptığının kısa açıklaması.' },
      steps: { type: 'array', required: true, description: 'Sırayla yapılacak adımlar (en fazla 25).', items: STEP }
    },
    run: (a, ctx) => {
      const { TOOLS } = require('./index');
      const known = new Set(TOOLS.map((t) => t.name));
      const steps = (Array.isArray(a.steps) ? a.steps : []).map((s) => (typeof s === 'string' ? JSON.parse(s) : s));
      if (!steps.length) throw new ToolError('Beceri için en az bir adım gerekli.');
      if (steps.length > 25) throw new ToolError('Bir beceride en fazla 25 adım olabilir.');
      for (const s of steps) {
        if (!known.has(s?.tool)) throw new ToolError(`Bilinmeyen araç: ${s?.tool}`);
        if (['run_steps', 'skill_run', 'skill_save', 'use_tool'].includes(s.tool)) throw new ToolError(`${s.tool} bir becerinin adımı olamaz.`);
        if (s.args_json != null && typeof s.args_json !== 'string') s.args_json = JSON.stringify(s.args_json);
        try { JSON.parse(s.args_json || '{}'); } catch { throw new ToolError(`${s.tool} adımının parametreleri geçerli JSON değil.`); }
      }
      const clean = steps.map((s) => ({ tool: s.tool, args_json: s.args_json || '{}', ...(s.wait_ms ? { wait_ms: Math.min(Math.max(Number(s.wait_ms) || 0, 0), 30000) } : {}) }));
      const list = ctx.store.get('skills') || [];
      const old = list.find((s) => norm(s.name) === norm(a.name));
      const skill = { id: old?.id || id(), name: String(a.name).trim().slice(0, 60), description: String(a.description || '').slice(0, 200), steps: clean, createdAt: old?.createdAt || Date.now(), updatedAt: Date.now(), runs: old?.runs || 0 };
      ctx.store.set('skills', [...list.filter((s) => s !== old), skill]);
      const titleOf = (n) => TOOLS.find((t) => t.name === n)?.title || n;
      return {
        summary: `“${skill.name}” becerisi ${old ? 'güncellendi' : 'kaydedildi'} (${clean.length} adım). Artık “${skill.name}” demen yeterli.`,
        display: { type: 'list', title: `Beceri · ${skill.name}`, items: clean.map((s, i) => ({ title: `${i + 1}. ${titleOf(s.tool)}`, subtitle: s.args_json === '{}' ? '' : s.args_json, icon: 'layers' })) },
        data: { id: skill.id, steps: clean.length }
      };
    }
  },
  {
    name: 'skill_run',
    category: 'productivity',
    title: 'Beceriyi çalıştır',
    description: 'Kaydedilmiş bir beceriyi (rutini) adıyla çalıştırır. Kullanıcı bir becerinin adını söylediğinde ("çalışma modu", "film modunu aç") bunu kullan. Onay gerektiren adımlar yine onay ister.',
    timeout: 20 * 60 * 1000,
    params: { name: { type: 'string', description: 'Becerinin adı.', required: true } },
    run: async (a, ctx) => {
      const { execute } = require('./index');
      const list = ctx.store.get('skills') || [];
      const skill = findSkill(list, a.name);
      if (!skill) throw new ToolError(`“${a.name}” adında bir beceri yok.${list.length ? ` Kayıtlı beceriler: ${list.map((s) => s.name).join(', ')}.` : ''}`);
      ctx.store.set('skills', list.map((s) => (s.id === skill.id ? { ...s, runs: (s.runs || 0) + 1, lastRun: Date.now() } : s)));
      const r = await execute('run_steps', { steps: skill.steps }, ctx);
      // run_steps reports a plan that stopped half-way as a finished plan; for a skill that is a failure.
      const steps = Array.isArray(r.data) ? r.data : [];
      const complete = r.ok && steps.length === skill.steps.length && steps.every((x) => x.ok);
      return { ok: complete, denied: steps.some((x) => x.denied), summary: `“${skill.name}”: ${r.summary}`, display: r.display, data: r.data };
    }
  },
  {
    name: 'skill_list',
    category: 'productivity',
    title: 'Beceriler',
    description: 'Kaydedilmiş becerileri (rutinleri) ve adımlarını listeler.',
    params: {},
    run: (a, ctx) => {
      const list = ctx.store.get('skills') || [];
      return {
        summary: list.length ? `Kayıtlı beceriler: ${list.map((s) => `${s.name} (${s.steps.length} adım)`).join(', ')}.` : 'Henüz kayıtlı bir beceri yok. "Şunu bir beceri olarak kaydet" diyebilirsin.',
        display: { type: 'list', title: 'Beceriler', items: list.map((s) => ({ title: s.name, subtitle: s.description || s.steps.map((x) => x.tool).join(' → '), meta: `${s.steps.length} adım`, icon: 'layers' })) },
        data: list.map((s) => ({ name: s.name, description: s.description, steps: s.steps }))
      };
    }
  },
  {
    name: 'skill_delete',
    category: 'productivity',
    title: 'Beceriyi sil',
    description: 'Kaydedilmiş bir beceriyi (rutini) siler.',
    danger: true,
    params: { name: { type: 'string', description: 'Becerinin adı.', required: true } },
    run: (a, ctx) => {
      const list = ctx.store.get('skills') || [];
      const skill = findSkill(list, a.name);
      if (!skill) throw new ToolError(`“${a.name}” adında bir beceri yok.`);
      ctx.store.set('skills', list.filter((s) => s.id !== skill.id));
      return { summary: `“${skill.name}” becerisi silindi.`, display: { type: 'power', action: 'trash', label: `${skill.name} silindi` } };
    }
  },
  {
    name: 'search_history',
    category: 'productivity',
    title: 'Geçmişte ara',
    description: 'Eski konuşmalarda ve yapılan işlerde arar. "Dün ne konuşmuştuk?", "geçen hafta hangi oyunu kurmuştum?" gibi sorularda kullan.',
    params: {
      query: { type: 'string', description: 'Aranacak kelimeler. Boşsa en son kayıtlar.' },
      days: { type: 'integer', description: 'Yalnızca son kaç gün. İsteğe bağlı.' },
      limit: { type: 'integer', description: 'En fazla kaç kayıt, varsayılan 20.' }
    },
    run: (a, ctx) => {
      if (!ctx.history) throw new ToolError('Geçmiş kullanılamıyor.');
      const since = a.days ? Date.now() - a.days * 86400000 : 0;
      const hits = ctx.history.search({ query: a.query || '', limit: 400 }).filter((e) => e.t >= since).slice(0, Math.min(Math.max(a.limit || 20, 1), 60));
      const who = { user: 'Sen', model: 'Vektör', tool: 'İşlem', system: 'Sistem' };
      const when = (t) => new Date(t).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return {
        summary: hits.length ? `${hits.length} kayıt bulundu. En yenisi: ${when(hits[0].t)} — ${truncate(hits[0].text, 160)}` : 'Geçmişte eşleşen bir şey bulunamadı.',
        display: { type: 'list', title: a.query ? `Geçmiş · “${a.query}”` : 'Son konuşmalar', items: hits.map((e) => ({ title: truncate(e.text, 140), subtitle: `${who[e.role] || e.role}${e.tool ? ` · ${e.tool}` : ''}`, meta: when(e.t), icon: e.role === 'tool' ? 'layers' : 'chat' })) },
        data: hits.map((e) => ({ when: new Date(e.t).toISOString(), role: e.role, text: truncate(e.text, 400), tool: e.tool }))
      };
    }
  }
];

module.exports.SECRET = SECRET;

'use strict';

/*
 * Tools for reaching the whole library. Only the core tools are declared to the live model;
 * the packs (settings pages, sites, shortcuts, text, info...) are found with find_tools and run
 * with use_tool. find_a_way researches how to do something no single tool covers and returns a
 * plan built from existing tools. Everything still runs through execute(), so approvals stay.
 */

const { ToolError, norm, truncate } = require('./util');

const NO_NESTING = new Set(['use_tool', 'run_steps', 'find_tools', 'find_a_way']);

function parseArgs(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object') return raw;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    throw new ToolError(`Parametreler geçerli JSON değil: ${String(raw).slice(0, 80)}`);
  }
}

/** Compact parameter description the model can fill in. */
function paramsOf(tool) {
  return Object.fromEntries(Object.entries(tool.params || {}).map(([k, p]) => [k,
    `${p.type}${p.required ? ', zorunlu' : ''}${p.enum ? `, şunlardan biri: ${p.enum.join('/')}` : ''}${p.description ? ` — ${p.description}` : ''}`]));
}

/** Ranks tools by how many query words appear in their name, title, description and category. */
function search(tools, categories, query, limit = 8) {
  const words = norm(query).split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  const catTitle = Object.fromEntries(categories.map((c) => [c.id, norm(c.title)]));
  const scored = [];
  for (const t of tools) {
    if (NO_NESTING.has(t.name)) continue;
    const name = norm(t.name.replace(/_/g, ' '));
    const title = norm(t.title);
    const desc = norm(t.description);
    const cat = catTitle[t.category] || '';
    let score = 0;
    for (const w of words) {
      const stem = w.length > 4 ? w.slice(0, w.length - 1) : w; // "ayarları" ~ "ayarlar"
      if (title.includes(w)) score += 6; else if (title.includes(stem)) score += 4;
      if (name.includes(w)) score += 4; else if (name.includes(stem)) score += 2;
      if (desc.includes(w)) score += 2; else if (desc.includes(stem)) score += 1;
      if (cat.includes(stem)) score += 1;
    }
    if (score) scored.push({ t, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.t);
}

function make({ TOOLS, CATEGORIES, execute }) {
  const byName = () => new Map(TOOLS.map((t) => [t.name, t]));

  return [
    {
      name: 'find_tools',
      category: 'utility',
      title: 'Araç bul',
      description: 'Vektör\'ün ~570 araçlık kütüphanesinde bir iş için uygun araçları arar ve parametrelerini verir (Windows ayar sayfaları, siteler, kısayollar, metin/hesap araçları, bilgi, sistem, geliştirici...). Doğrudan bir aracın yoksa "yapamam" demeden önce bunu kullan, sonra use_tool ile çalıştır.',
      params: {
        query: { type: 'string', description: 'Ne yapmak istendiği, Türkçe anahtar kelimelerle; ör. "bluetooth ayarları", "trendyol ara", "metni büyük harf".', required: true },
        limit: { type: 'integer', description: 'En fazla kaç sonuç. Varsayılan 8.' }
      },
      run: (a) => {
        const found = search(TOOLS, CATEGORIES, a.query, Math.min(Math.max(a.limit || 8, 1), 20));
        if (!found.length) {
          return {
            summary: `“${a.query}” için hazır araç bulunamadı. find_a_way ile nasıl yapılacağını araştırabilirsin.`,
            data: { tools: [] }
          };
        }
        return {
          summary: `${found.length} araç bulundu: ${found.map((t) => t.name).join(', ')}. Uygun olanı use_tool ile çalıştır.`,
          display: { type: 'list', title: `“${a.query}”`, items: found.map((t) => ({ title: t.title, subtitle: t.name, meta: t.danger ? 'Onaylı' : '' })) },
          data: { tools: found.map((t) => ({ name: t.name, title: t.title, description: t.description, params: paramsOf(t), needs_approval: !!t.danger })) }
        };
      }
    },
    {
      name: 'use_tool',
      category: 'utility',
      title: 'Araç çalıştır',
      description: 'Kütüphanedeki herhangi bir aracı adıyla çalıştırır (find_tools ile bulduğun ya da sistem talimatındaki listede gördüğün araçlar). Onay gerektiren araçlar yine onay ister.',
      timeout: 20 * 60 * 1000,
      params: {
        name: { type: 'string', description: 'Aracın adı, ör. settings_bluetooth.', required: true },
        args_json: { type: 'string', description: 'Parametreler JSON olarak, ör. {"query":"kulaklık"}. Parametresizse {}.' }
      },
      run: async (a, ctx) => {
        const tool = byName().get(a.name);
        if (!tool) {
          const near = search(TOOLS, CATEGORIES, a.name.replace(/_/g, ' '), 5).map((t) => t.name);
          throw new ToolError(`“${a.name}” adında araç yok.${near.length ? ` Şunlardan biri olabilir: ${near.join(', ')}.` : ''}`);
        }
        if (NO_NESTING.has(tool.name)) throw new ToolError(`${tool.name} use_tool içinden çalıştırılamaz; doğrudan çağır.`);
        const r = await execute(tool.name, parseArgs(a.args_json), ctx);
        if (!r.ok) {
          const missing = /^Eksik parametre/.test(r.summary || '');
          return {
            summary: `${tool.title}: ${r.summary}`,
            display: { type: 'kv', rows: [['Araç', tool.title], ['Sonuç', r.summary || 'Başarısız']] },
            data: { tool: tool.name, ...(missing ? { params: paramsOf(tool) } : {}) },
            hint: r.hint,
            ok: false,
            denied: !!r.denied,
            as: tool.name
          };
        }
        return { summary: r.summary, display: r.display, data: r.data, hint: r.hint, as: tool.name };
      }
    },
    {
      name: 'find_a_way',
      category: 'web',
      title: 'Yol bul',
      description: 'Hazır bir araçla yapılamayan bir işin nasıl yapılacağını web\'de araştırır (kısayol, ayar sayfası, menü yolu, resmi yöntem) ve bunu Vektör\'ün araçlarıyla uygulanabilir adımlara çevirir. "Yapamam" demeden önce kullan; sonra adımları use_tool ya da run_steps ile uygula.',
      timeout: 120000,
      params: {
        goal: { type: 'string', description: 'Kullanıcının yapmak istediği iş, ayrıntılı.', required: true },
        tried: { type: 'string', description: 'Denenip olmayan yollar, varsa.' }
      },
      run: async (a, ctx) => {
        const { ask } = require('../research');
        const os = { win32: 'Windows 10/11', darwin: 'macOS', linux: 'Linux' }[process.platform] || process.platform;
        const catalogue = TOOLS.filter((t) => !NO_NESTING.has(t.name)).map((t) => `${t.name}: ${t.title}`).join('\n');
        const prompt = `Bir masaüstü asistanı (${os}) kullanıcının şu isteğini yerine getirmek istiyor: ${a.goal}
${a.tried ? `Şunlar denendi ve olmadı: ${a.tried}\n` : ''}
Web'de araştır ve bu işin en güvenilir, resmi yolunu bul (klavye kısayolu, ayar sayfası, menü yolu, resmi komut). Güvenlik korumalarını kapatma, lisans/ödeme atlatma ya da korsan yöntemler önerme.
Sonra yöntemi aşağıdaki araçlarla uygulanabilir adımlara çevir. Yalnızca listedeki araç adlarını kullan. Düğmeye basmak için click_button, tuş için press_keys, yazmak için type_text, uygulama açmak için open_app kullanılabilir.

Araçlar:
${catalogue}

Yalnızca şu JSON'u döndür, başka metin yazma:
{"method":"yöntemin 1-3 cümlelik açıklaması","steps":[{"tool":"araç_adı","args":{},"why":"kısa neden"}],"possible":true}
İş bu araçlarla yapılamıyorsa possible=false ver ve method alanında kullanıcının elle ne yapması gerektiğini anlat.`;
        const { text, sources } = await ask(ctx.settings, prompt);
        const m = text.match(/\{[\s\S]*\}/);
        let plan = null;
        try { plan = JSON.parse(m ? m[0] : ''); } catch { /* prose answer */ }
        if (!plan) {
          return {
            summary: truncate(text, 1500) || 'Bir yöntem bulunamadı.',
            display: { type: 'article', title: a.goal, subtitle: 'Yöntem araştırması', text: truncate(text, 1200), sources: sources.slice(0, 6) },
            data: { method: truncate(text, 3000), steps: [] }
          };
        }
        const names = byName();
        const steps = (Array.isArray(plan.steps) ? plan.steps : [])
          .filter((s) => names.has(s?.tool) && !NO_NESTING.has(s.tool))
          .slice(0, 25)
          .map((s) => ({ tool: s.tool, args_json: JSON.stringify(s.args && typeof s.args === 'object' ? s.args : {}), why: String(s.why || '') }));
        const doable = plan.possible !== false && steps.length > 0;
        return {
          summary: doable
            ? `Yöntem: ${plan.method || ''} Plan ${steps.length} adım; şimdi run_steps ile (ya da adım adım use_tool ile) uygula.`
            : `Bu iş araçlarla tam yapılamıyor. ${plan.method || ''}`,
          display: {
            type: 'list',
            title: doable ? `Bulunan yol · ${steps.length} adım` : 'Elle yapılması gerekenler',
            items: doable
              ? steps.map((s, i) => ({ title: `${i + 1}. ${names.get(s.tool).title}`, subtitle: s.why || s.args_json }))
              : [{ title: plan.method || 'Yöntem bulunamadı', icon: 'info' }]
          },
          data: { method: plan.method, possible: doable, steps, sources: sources.slice(0, 5).map((s) => s.url) }
        };
      }
    }
  ];
}

module.exports = { make, search, paramsOf };

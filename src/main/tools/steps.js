'use strict';

/*
 * run_steps: carry out a multi-step request as one ordered plan — e.g. open Steam, start the
 * install, press "Yükle", then show a notification. Steps run one after another through the
 * normal tool executor, so every step that needs approval still asks for it. The plan stops at
 * the first failed or refused step and reports where it stopped.
 */

const { ToolError } = require('./util');

const MAX_STEPS = 25;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object') return raw;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    throw new ToolError(`Adım parametreleri geçerli JSON değil: ${String(raw).slice(0, 80)}`);
  }
}

module.exports = [
  {
    name: 'run_steps',
    category: 'utility',
    title: 'Adımları sırayla yap',
    description: 'Birden fazla aracı tek bir planda, sırayla çalıştırır. Kullanıcının isteği birkaç adım gerektiriyorsa (aç → bul → bas → bildir gibi) bunu kullan; aynı aracı birden fazla kez de koyabilirsin. Her adımda tool = araç adı, args_json = parametreleri JSON metni olarak, wait_ms = o adımdan sonra beklenecek süre (pencere açılması gibi). Bir adım başarısız olursa ya da kullanıcı reddederse plan orada durur.',
    timeout: 20 * 60 * 1000,
    params: {
      steps: {
        type: 'array',
        required: true,
        description: `Sırayla yapılacak adımlar (en fazla ${MAX_STEPS}).`,
        items: {
          type: 'object',
          properties: {
            tool: { type: 'string', description: 'Çalıştırılacak aracın adı, ör. open_app.' },
            args_json: { type: 'string', description: 'Aracın parametreleri JSON olarak, ör. {"name":"Steam"}. Parametresizse {}.' },
            wait_ms: { type: 'integer', description: 'Bu adımdan sonra beklenecek milisaniye (en fazla 30000).' }
          },
          required: ['tool']
        }
      }
    },
    run: async (a, ctx) => {
      const { execute, TOOLS } = require('./index');
      const steps = Array.isArray(a.steps) ? a.steps : parseArgs(a.steps);
      if (!Array.isArray(steps) || !steps.length) throw new ToolError('En az bir adım vermelisin.');
      if (steps.length > MAX_STEPS) throw new ToolError(`Bir planda en fazla ${MAX_STEPS} adım olabilir.`);

      const known = new Set(TOOLS.map((t) => t.name));
      const results = [];
      for (let i = 0; i < steps.length; i++) {
        const step = typeof steps[i] === 'string' ? parseArgs(steps[i]) : steps[i];
        const name = step?.tool;
        if (!name || !known.has(name) || name === 'run_steps') {
          results.push({ step: i + 1, tool: name || '?', ok: false, summary: name === 'run_steps' ? 'İç içe plan çalıştırılamaz.' : `Bilinmeyen araç: ${name}` });
          break;
        }
        let args;
        try { args = parseArgs(step.args_json ?? step.args); } catch (e) {
          results.push({ step: i + 1, tool: name, ok: false, summary: e.message });
          break;
        }
        ctx.emit?.('step', { index: i + 1, total: steps.length, tool: name });
        const r = await execute(name, args, ctx);
        results.push({ step: i + 1, tool: name, ok: r.ok, denied: !!r.denied, summary: r.summary, data: r.data });
        if (!r.ok) break;
        const wait = Math.min(Math.max(Number(step.wait_ms) || 0, 0), 30000);
        if (wait) await sleep(wait);
      }

      const done = results.filter((r) => r.ok).length;
      const failed = results.find((r) => !r.ok);
      const titleOf = (n) => TOOLS.find((t) => t.name === n)?.title || n;
      return {
        summary: failed
          ? `${steps.length} adımın ${done} tanesi yapıldı; ${failed.step}. adımda (${titleOf(failed.tool)}) durdu: ${failed.summary}`
          : `${done} adımın hepsi tamamlandı.`,
        display: {
          type: 'list',
          title: failed ? `${done}/${steps.length} adım · ${failed.step}. adımda durdu` : `${done}/${steps.length} adım tamamlandı`,
          items: results.map((r) => ({
            title: `${r.step}. ${titleOf(r.tool)}`,
            subtitle: r.summary,
            meta: r.ok ? 'Tamam' : r.denied ? 'Reddedildi' : 'Hata',
            icon: r.ok ? 'check-circle' : r.denied ? 'warning' : 'danger'
          }))
        },
        data: results.map(({ step, tool, ok, denied, summary, data }) => ({ step, tool, ok, denied, summary, data }))
      };
    }
  }
];

import { Orb } from '../renderer/orb.js';
import { icon } from '../renderer/icons.js';

const api = window.vektor;
const $ = (id) => document.getElementById(id);
const island = $('island');
const bars = [...$('bars').children];
const orb = new Orb($('orb'), { compact: true });
orb.start();

$('mic').innerHTML = icon('mic');
$('open').innerHTML = icon('expand');

const TONE = {
  offline: '#636366', idle: '#0a84ff', connecting: '#ffb340', listening: '#0a84ff', hearing: '#40c8e0',
  thinking: '#bf5af2', speaking: '#bf5af2', tool: '#ff9f0a', confirm: '#ffb340', error: '#ff453a'
};
const EXPAND = new Set(['connecting', 'hearing', 'thinking', 'speaking', 'tool', 'confirm', 'error']);

let current = { phase: 'offline', level: 0 };
let hover = false;

function render() {
  const s = current;
  island.dataset.phase = s.phase;
  island.style.setProperty('--tone', TONE[s.phase] || TONE.idle);
  const expanded = hover || EXPAND.has(s.phase);
  island.classList.toggle('expanded', expanded);
  island.classList.toggle('hover', hover);
  $('label').textContent = s.phase === 'offline' ? (hover ? 'Vektör · bağlanmak için dokun' : 'Vektör') : s.label || 'Vektör';
  const sub = s.phase === 'tool' ? 'Araç çalışıyor'
    : s.phase === 'confirm' ? 'Ana pencerede onay bekliyor'
      : s.timers ? `${s.timers} aktif zamanlayıcı` : s.connected ? (s.mic ? 'Mikrofon açık' : 'Mikrofon kapalı') : '';
  $('sub').textContent = sub;
  const caption = (s.phase === 'speaking' || s.phase === 'hearing' || s.phase === 'thinking') ? s.caption || '' : '';
  $('caption').textContent = caption;
  island.classList.toggle('has-caption', expanded && !!caption);
  $('mic').classList.toggle('on', !!s.mic);
  $('mic').innerHTML = icon(s.mic ? 'mic' : 'mic-off');
  // Tell the main process how tall we are so clicks below the island pass through.
  api.mini.size(expanded ? (caption ? 118 : 78) : 50);
}

api.state.onState((s) => {
  const phaseChanged = s.phase !== current.phase || s.label !== current.label || s.caption !== current.caption || s.mic !== current.mic || s.timers !== current.timers;
  current = s;
  orb.set(s.phase === 'offline' ? 'offline' : s.phase, s.level);
  if (phaseChanged) render();
});

/* Equaliser bars follow the live level with a little per-bar variation. */
const weights = [0.55, 0.85, 1, 0.8, 0.5];
function animateBars(t) {
  const lv = current.level || 0;
  const idle = current.phase === 'thinking' || current.phase === 'tool' || current.phase === 'connecting';
  bars.forEach((b, i) => {
    const wobble = idle ? (Math.sin(t / 180 + i * 0.9) + 1) * 0.35 : (Math.sin(t / 90 + i * 1.7) + 1) * 0.15;
    const h = 4 + Math.min(1, lv * weights[i] * 1.6 + wobble * (idle ? 1 : lv + 0.1)) * 14;
    b.style.height = `${h.toFixed(1)}px`;
  });
  requestAnimationFrame(animateBars);
}
requestAnimationFrame(animateBars);

island.addEventListener('mouseenter', () => { hover = true; api.mini.hover(true); render(); });
island.addEventListener('mouseleave', () => { hover = false; api.mini.hover(false); render(); });
$('orb-btn').addEventListener('click', () => api.mini.command('toggle-mic'));
$('mic').addEventListener('click', () => api.mini.command('toggle-mic'));
$('open').addEventListener('click', () => api.mini.command('open'));
island.addEventListener('dblclick', () => api.mini.command('open'));

render();

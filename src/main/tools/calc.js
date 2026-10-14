'use strict';

/*
 * A small, safe arithmetic evaluator (no eval). Supports + - * / % ^, parentheses,
 * unary minus, implicit percent ("200 * 18%"), constants and common functions.
 */

const FUNCS = {
  sqrt: Math.sqrt, karekök: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: (x) => Math.sin(x * Math.PI / 180), cos: (x) => Math.cos(x * Math.PI / 180), tan: (x) => Math.tan(x * Math.PI / 180),
  log: Math.log10, ln: Math.log, exp: Math.exp, cbrt: Math.cbrt,
  fact: (n) => { if (n < 0 || n > 170 || !Number.isInteger(n)) return NaN; let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
};
const CONSTS = { pi: Math.PI, π: Math.PI, e: Math.E };

function tokenize(src) {
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/,(?=\d)/g, '.').replace(/\*\*/g, '^').toLowerCase();
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[\d.]/.test(c)) {
      const m = s.slice(i).match(/^\d*\.?\d+(e[+-]?\d+)?/) || s.slice(i).match(/^\d+\.?/);
      tokens.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[a-zπçğıöşü]/.test(c)) {
      const m = s.slice(i).match(/^[a-zπçğıöşü]+/);
      tokens.push({ t: 'id', v: m[0] });
      i += m[0].length;
      continue;
    }
    if ('+-*/^%()'.includes(c)) { tokens.push({ t: 'op', v: c }); i++; continue; }
    throw new Error(`Beklenmeyen karakter: ${c}`);
  }
  return tokens;
}

function evaluate(expr) {
  const tokens = tokenize(String(expr));
  let pos = 0;
  const peek = () => tokens[pos];
  const take = (v) => { const t = tokens[pos]; if (v && (!t || t.v !== v)) throw new Error(`"${v}" bekleniyordu`); pos++; return t; };

  function primary() {
    const t = peek();
    if (!t) throw new Error('İfade eksik');
    if (t.t === 'num') { pos++; return t.v; }
    if (t.t === 'id') {
      pos++;
      if (t.v in CONSTS) return CONSTS[t.v];
      if (t.v in FUNCS) {
        take('(');
        const v = additive();
        take(')');
        return FUNCS[t.v](v);
      }
      throw new Error(`Bilinmeyen ad: ${t.v}`);
    }
    if (t.v === '(') { pos++; const v = additive(); take(')'); return v; }
    if (t.v === '-') { pos++; return -power(); }
    if (t.v === '+') { pos++; return unary(); }
    throw new Error(`Beklenmeyen: ${t.v}`);
  }

  function postfix() {
    let v = primary();
    while (peek()?.v === '%' && !(tokens[pos + 1] && (tokens[pos + 1].t === 'num' || tokens[pos + 1].v === '('))) {
      pos++;
      v = v / 100;
    }
    return v;
  }

  function unary() {
    return postfix();
  }

  function power() {
    const base = unary();
    if (peek()?.v === '^') { pos++; return Math.pow(base, power()); }
    return base;
  }

  function multiplicative() {
    let v = power();
    for (;;) {
      const t = peek();
      if (t?.v === '*') { pos++; v *= power(); }
      else if (t?.v === '/') { pos++; v /= power(); }
      else if (t?.v === '%') { pos++; v %= power(); }
      else if (t && (t.t === 'num' || t.t === 'id' || t.v === '(')) v *= power();
      else return v;
    }
  }

  function additive() {
    let v = multiplicative();
    for (;;) {
      const t = peek();
      if (t?.v === '+' || t?.v === '-') {
        pos++;
        // "200 + 10%" means 200 plus ten percent of 200.
        const save = pos;
        const rhs = multiplicative();
        const pct = tokens[pos - 1]?.v === '%' && tokens[save]?.t === 'num' && pos - save === 2;
        const delta = pct ? v * rhs : rhs;
        v = t.v === '+' ? v + delta : v - delta;
      } else return v;
    }
  }

  const result = additive();
  if (pos < tokens.length) throw new Error(`Fazladan: ${tokens[pos].v}`);
  if (!Number.isFinite(result)) throw new Error('Sonuç tanımsız');
  return result;
}

function format(n, maxDecimals = 8) {
  if (Math.abs(n) >= 1e15 || (Math.abs(n) < 1e-6 && n !== 0)) return n.toExponential(6);
  return Number(n.toPrecision(12)).toLocaleString('tr-TR', { maximumFractionDigits: maxDecimals });
}

/* ------------------------------------------------------- unit conversion */

const UNITS = {
  length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, mil: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254, inç: 0.0254, metre: 1, kilometre: 1000, santimetre: 0.01, milimetre: 0.001, feet: 0.3048, ayak: 0.3048, inch: 0.0254, yard: 0.9144, mile: 1609.344, nmi: 1852, deniz_mili: 1852 },
  mass: { kg: 1, g: 0.001, gram: 0.001, mg: 1e-6, t: 1000, ton: 1000, lb: 0.45359237, pound: 0.45359237, libre: 0.45359237, oz: 0.028349523125, ons: 0.028349523125, kilogram: 1 },
  volume: { l: 1, litre: 1, ml: 0.001, mililitre: 0.001, m3: 1000, gal: 3.785411784, galon: 3.785411784, qt: 0.946352946, pt: 0.473176473, cup: 0.2365882365, bardak: 0.2, floz: 0.0295735295625, tbsp: 0.01478676478125, yemek_kaşığı: 0.015, tsp: 0.00492892159375, çay_kaşığı: 0.005 },
  speed: { 'm/s': 1, 'km/h': 1 / 3.6, kmh: 1 / 3.6, 'km/sa': 1 / 3.6, mph: 0.44704, knot: 0.514444, knots: 0.514444, kn: 0.514444, düğüm: 0.514444 },
  data: { b: 1, byte: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4, pb: 1024 ** 5, bit: 1 / 8, kbit: 128, mbit: 131072, gbit: 134217728 },
  time: { ms: 0.001, s: 1, sn: 1, saniye: 1, sec: 1, min: 60, dk: 60, dakika: 60, h: 3600, sa: 3600, saat: 3600, hour: 3600, gün: 86400, day: 86400, d: 86400, hafta: 604800, week: 604800, ay: 2629800, month: 2629800, yıl: 31557600, year: 31557600 },
  area: { m2: 1, km2: 1e6, cm2: 1e-4, ha: 1e4, hektar: 1e4, dönüm: 1000, acre: 4046.8564224, ft2: 0.09290304, mi2: 2589988.110336 },
  energy: { j: 1, kj: 1000, cal: 4.184, kcal: 4184, kalori: 4184, wh: 3600, kwh: 3.6e6 },
  pressure: { pa: 1, kpa: 1000, bar: 1e5, atm: 101325, psi: 6894.757, mmhg: 133.322 }
};

const TEMP = { c: 'c', celsius: 'c', santigrat: 'c', '°c': 'c', f: 'f', fahrenheit: 'f', '°f': 'f', k: 'k', kelvin: 'k' };

function convertUnits(value, from, to) {
  const f = String(from).toLowerCase().trim().replace(/\s+/g, '_');
  const t = String(to).toLowerCase().trim().replace(/\s+/g, '_');
  if (TEMP[f] && TEMP[t]) {
    const toC = { c: (v) => v, f: (v) => (v - 32) * 5 / 9, k: (v) => v - 273.15 }[TEMP[f]](value);
    return { c: toC, f: toC * 9 / 5 + 32, k: toC + 273.15 }[TEMP[t]];
  }
  for (const table of Object.values(UNITS)) {
    if (f in table && t in table) return value * table[f] / table[t];
  }
  throw new Error(`${from} → ${to} dönüşümü desteklenmiyor.`);
}

module.exports = { evaluate, format, convertUnits, UNITS };

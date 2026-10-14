'use strict';

/*
 * Everyday calculators: money, health, dates, number theory, geometry and chance.
 * Pure JS; every tool returns exact figures so the assistant never has to estimate.
 */

const crypto = require('node:crypto');
const { ToolError, valueResult, kvResult, listResult, textResult } = require('./kit');
const { norm } = require('../util');

const TR = 'tr-TR';
const fmt = (n, d = 2) => Number(n).toLocaleString(TR, { maximumFractionDigits: d });
const money = (n) => Number(n).toLocaleString(TR, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (description, required = true) => ({ type: 'number', description, required });
const int = (description, required = true) => ({ type: 'integer', description, required });
const str = (description, required = true) => ({ type: 'string', description, required });

function need(v, label) {
  if (v == null || v === '' || Number.isNaN(v)) throw new ToolError(`${label} belirtmelisin.`);
  return v;
}

function positive(v, label) {
  need(v, label);
  if (!(v > 0)) throw new ToolError(`${label} sıfırdan büyük olmalı.`);
  return v;
}

/** Parses numbers from an array or text like "3 4 5", "3; 4,5" or "3, 4, 5" (a bare comma inside a number is a decimal). */
function numbers(v, label = 'Sayılar') {
  let parts;
  if (Array.isArray(v)) parts = v;
  else {
    const s = String(v ?? '').trim();
    parts = /^-?\d+(,-?\d+){2,}$/.test(s) ? s.split(',') : s.split(/[;\s]+|,\s+/);
  }
  const out = parts.map((x) => (typeof x === 'number' ? x : String(x).trim() === '' ? NaN : Number(String(x).trim().replace(',', '.')))).filter(Number.isFinite);
  if (!out.length) throw new ToolError(`${label} belirtmelisin, ör. "4, 8, 15".`);
  return out;
}

/* ------------------------------------------------------------------ dates */

const DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const DAY = 86400000;

/** Local calendar date at noon (immune to DST edges). Accepts ISO, 14.03.2025, 14/03/2025, bugün/yarın/dün. */
function parseDate(input, label = 'Tarih') {
  const s = norm(input ?? '');
  const today = new Date();
  const at = (y, m, d) => {
    const dt = new Date(y, m, d, 12);
    if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) throw new ToolError(`${label} geçersiz: ${input}`);
    return dt;
  };
  if (!s || s === 'bugun' || s === 'today') return at(today.getFullYear(), today.getMonth(), today.getDate());
  if (s === 'yarin') return new Date(at(today.getFullYear(), today.getMonth(), today.getDate()).getTime() + DAY);
  if (s === 'dun') return new Date(at(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - DAY);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return at(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) return at(+m[3], +m[2] - 1, +m[1]);
  m = s.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/);
  if (m) {
    const mi = MONTHS.findIndex((x) => norm(x).startsWith(m[2].slice(0, 3)));
    if (mi >= 0) return at(+m[3], mi, +m[1]);
  }
  throw new ToolError(`${label} anlaşılamadı: “${input}”. Ör. 2025-03-14 ya da 14.03.2025.`);
}

const dayDiff = (a, b) => Math.round((b - a) / DAY);
const fmtDate = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${DAYS[d.getDay()]}`;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { week: Math.ceil(((t - y0) / DAY + 1) / 7), year: t.getUTCFullYear() };
}

/** Whole years, months and days between two dates. */
function ymd(from, to) {
  let y = to.getFullYear() - from.getFullYear();
  let m = to.getMonth() - from.getMonth();
  let d = to.getDate() - from.getDate();
  if (d < 0) { m--; d += new Date(to.getFullYear(), to.getMonth(), 0).getDate(); }
  if (m < 0) { y--; m += 12; }
  return { y, m, d };
}

const FIXED_HOLIDAYS = ['01-01', '04-23', '05-01', '05-19', '07-15', '08-30', '10-29'];

function workdays(start, end, holidays) {
  let a = start, b = end, sign = 1;
  if (b < a) { [a, b] = [b, a]; sign = -1; }
  let count = 0;
  for (let t = a.getTime(); t <= b.getTime(); t += DAY) {
    const d = new Date(t);
    const wd = d.getDay();
    if (wd === 0 || wd === 6) continue;
    if (holidays && FIXED_HOLIDAYS.includes(iso(d).slice(5))) continue;
    count++;
  }
  return count * sign;
}

/* -------------------------------------------------------------- time zones */

function zoneOf(place) {
  const { tzFor } = require('../utility');
  const z = tzFor(String(place || '').trim());
  if (!z) throw new ToolError(`“${place}” için saat dilimi bulunamadı. Şehir adı ya da Europe/Istanbul gibi bir dilim ver.`);
  return z;
}

function wallParts(zone, t) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(t));
  const g = (k) => +parts.find((p) => p.type === k).value;
  return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour'), mi: g('minute'), s: g('second') };
}

const offsetAt = (zone, t) => { const p = wallParts(zone, t); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000; };

/** UTC instant for a wall-clock time in a zone. */
function zonedInstant(zone, y, mo, d, h, mi) {
  const guess = Date.UTC(y, mo, d, h, mi);
  let t = guess - offsetAt(zone, guess);
  t = guess - offsetAt(zone, t);
  return t;
}

function parseClock(s, label = 'Saat') {
  const m = String(s ?? '').trim().match(/^(\d{1,2})(?:[:.](\d{2}))?$/);
  if (!m || +m[1] > 23 || +(m[2] || 0) > 59) throw new ToolError(`${label} anlaşılamadı: “${s}”. Ör. 14:30.`);
  return { h: +m[1], mi: +(m[2] || 0) };
}

const hhmm = (h, mi) => `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;

/* ---------------------------------------------------------- number theory */

function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; }

function isPrime(n) {
  if (!Number.isSafeInteger(n) || n < 2) return false;
  if (n % 2 === 0) return n === 2;
  if (n % 3 === 0) return n === 3;
  for (let i = 5; i * i <= n; i += 6) if (n % i === 0 || n % (i + 2) === 0) return false;
  return true;
}

function factorize(n) {
  const out = [];
  for (let p = 2; p * p <= n; p += p === 2 ? 1 : 2) while (n % p === 0) { out.push(p); n /= p; }
  if (n > 1) out.push(n);
  return out;
}

function factorial(n) { let r = 1n; for (let i = 2n; i <= BigInt(n); i++) r *= i; return r; }

function fib(n) { let a = 0n, b = 1n; for (let i = 0; i < n; i++) [a, b] = [b, a + b]; return a; }

const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];

function toRoman(n) {
  if (!Number.isInteger(n) || n < 1 || n > 3999) throw new ToolError('Roma rakamı 1 ile 3999 arasında olabilir.');
  let out = '';
  for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v; }
  return out;
}

function fromRoman(s) {
  const up = s.toUpperCase();
  if (!/^[MDCLXVI]+$/.test(up)) throw new ToolError(`Geçerli bir Roma rakamı değil: ${s}`);
  const val = { M: 1000, D: 500, C: 100, L: 50, X: 10, V: 5, I: 1 };
  let n = 0;
  for (let i = 0; i < up.length; i++) n += val[up[i]] < (val[up[i + 1]] || 0) ? -val[up[i]] : val[up[i]];
  if (toRoman(n) !== up) throw new ToolError(`Geçerli bir Roma rakamı değil: ${s}`);
  return n;
}

/* Turkish number words: 1234567 → "bir milyon iki yüz otuz dört bin beş yüz altmış yedi". */
const ONES = ['', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan'];
const SCALES = ['', 'bin', 'milyon', 'milyar', 'trilyon', 'katrilyon'];

function under1000(n) {
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), o = n % 10;
  return [h ? (h === 1 ? 'yüz' : `${ONES[h]} yüz`) : '', TENS[t], ONES[o]].filter(Boolean).join(' ');
}

function intWords(n) {
  if (n === 0n) return 'sıfır';
  const groups = [];
  while (n > 0n) { groups.push(Number(n % 1000n)); n /= 1000n; }
  if (groups.length > SCALES.length) throw new ToolError('Sayı çok büyük.');
  const parts = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    if (i === 1 && g === 1) parts.push('bin');
    else parts.push([under1000(g), SCALES[i]].filter(Boolean).join(' '));
  }
  return parts.join(' ');
}

function numberWords(input) {
  const s = String(input).trim().replace(/\s/g, '');
  const m = s.match(/^(-)?(\d+)(?:[.,](\d+))?$/);
  if (!m) throw new ToolError(`Sayı anlaşılamadı: ${input}`);
  let out = intWords(BigInt(m[2]));
  if (m[3]) {
    const dec = m[3].replace(/0+$/, '');
    if (dec) out += ` virgül ${dec.match(/^0*/)[0].split('').map(() => 'sıfır').concat(intWords(BigInt(dec))).join(' ')}`;
  }
  return (m[1] && out !== 'sıfır' ? 'eksi ' : '') + out;
}

/* ------------------------------------------------------------------- color */

function parseColor(v) {
  const s = String(v ?? '').trim();
  let m = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  m = s.match(/^(?:rgb\s*\()?\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*\)?$/i);
  if (m && [m[1], m[2], m[3]].every((x) => +x <= 255)) return [+m[1], +m[2], +m[3]];
  throw new ToolError(`Renk anlaşılamadı: “${v}”. Ör. #0A84FF ya da 10, 132, 255.`);
}

function toHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

/* ------------------------------------------------------------- calendars */

function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const today = new Date();
  const cells = Array(lead).fill('  ');
  for (let d = 1; d <= days; d++) {
    const mark = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
    cells.push(mark ? `[${d}]`.padStart(2) : String(d).padStart(2));
  }
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7).map((c) => c.padStart(4)).join(''));
  return `${MONTHS[month]} ${year}\n${['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pa'].map((x) => x.padStart(4)).join('')}\n${rows.join('\n')}`;
}

/* ------------------------------------------------------------------ tools */

const tool = (name, title, description, params, run) => ({ name: `calc_${name}`, category: 'utility', title, description, params, run });

module.exports = [
  tool('percent', 'Yüzde hesapla', 'Bir sayının yüzdesini (200\'ün %15\'i) ya da bir sayının diğerinin yüzde kaçı olduğunu (30, 200\'ün yüzde kaçı) hesaplar.', {
    percent: num('Yüzde oranı (ör. 15). "x\'in %y\'si" için.', false),
    of: num('Yüzdesi alınacak sayı / bütün.', true),
    part: num('"part, of\'un yüzde kaçı" için parça. Verilirse percent yok sayılır.', false)
  }, (a) => {
    if (a.part != null) {
      if (!a.of) throw new ToolError('Bütün sıfır olamaz.');
      const p = (a.part / a.of) * 100;
      return valueResult(`${fmt(a.part)}, ${fmt(a.of)} sayısının`, `%${fmt(p)}`, { icon: 'calculator', data: { percent: p } });
    }
    need(a.percent, 'Yüzde oranı');
    const r = (a.of * a.percent) / 100;
    return valueResult(`${fmt(a.of)} sayısının %${fmt(a.percent)}'i`, fmt(r), { icon: 'calculator', data: { result: r } });
  }),
  tool('percent_change', 'Yüzde değişim', 'İki değer arasındaki yüzde artışı ya da azalışı hesaplar (eski fiyat → yeni fiyat).', {
    from: num('Eski değer.'), to: num('Yeni değer.')
  }, (a) => {
    if (!a.from) throw new ToolError('Eski değer sıfır olamaz.');
    const p = ((a.to - a.from) / Math.abs(a.from)) * 100;
    return valueResult(p >= 0 ? 'Artış' : 'Azalış', `%${fmt(Math.abs(p))}`, { detail: `${fmt(a.from)} → ${fmt(a.to)} (fark ${fmt(a.to - a.from)})`, icon: 'activity', data: { percent: p, diff: a.to - a.from } });
  }),
  tool('vat', 'KDV hesapla', 'Bir tutara KDV ekler ya da KDV dahil tutardan KDV\'yi ayırır. Oran varsayılan %20.', {
    amount: num('Tutar.'), rate: num('KDV oranı, varsayılan 20.', false),
    mode: { type: 'string', enum: ['add', 'remove'], description: 'add = KDV ekle (varsayılan), remove = KDV dahil tutardan ayır.' }
  }, (a) => {
    const rate = a.rate ?? 20;
    const net = a.mode === 'remove' ? a.amount / (1 + rate / 100) : a.amount;
    const vat = net * rate / 100;
    return kvResult(`KDV hariç ${money(net)}, KDV ${money(vat)}, toplam ${money(net + vat)}.`,
      [['KDV hariç', money(net)], [`KDV (%${fmt(rate)})`, money(vat)], ['KDV dahil', money(net + vat)]], { net, vat, gross: net + vat });
  }),
  tool('discount', 'İndirim hesapla', 'İndirimli fiyatı ve kazancı hesaplar.', { price: num('Fiyat.'), percent: num('İndirim yüzdesi.') }, (a) => {
    const off = a.price * a.percent / 100;
    return kvResult(`%${fmt(a.percent)} indirimle ${money(a.price - off)} (${money(off)} kazanç).`,
      [['Eski fiyat', money(a.price)], ['İndirim', money(off)], ['Yeni fiyat', money(a.price - off)]], { price: a.price - off, saved: off });
  }),
  tool('split_bill', 'Hesap bölme', 'Hesabı bahşişle birlikte kişi başına böler.', {
    total: num('Toplam hesap.'), people: int('Kişi sayısı, varsayılan 1.', false), tip_percent: num('Bahşiş yüzdesi, varsayılan 0.', false)
  }, (a) => {
    const people = Math.max(1, a.people || 1);
    const tip = a.total * (a.tip_percent || 0) / 100;
    const each = (a.total + tip) / people;
    return kvResult(`Kişi başı ${money(each)} (bahşiş ${money(tip)}).`,
      [['Hesap', money(a.total)], ['Bahşiş', money(tip)], ['Toplam', money(a.total + tip)], ['Kişi', people], ['Kişi başı', money(each)]], { each, tip, total: a.total + tip });
  }),
  tool('loan', 'Kredi taksiti', 'Aylık kredi taksitini, toplam geri ödemeyi ve toplam faizi hesaplar.', {
    principal: num('Kredi tutarı.'), annual_rate: num('Yıllık faiz yüzdesi (aylık faiz biliniyorsa ×12).'), months: int('Vade (ay).')
  }, (a) => {
    positive(a.principal, 'Kredi tutarı'); positive(a.months, 'Vade');
    const r = a.annual_rate / 100 / 12;
    const pay = r ? a.principal * r / (1 - (1 + r) ** -a.months) : a.principal / a.months;
    const total = pay * a.months;
    return kvResult(`Aylık taksit ${money(pay)}; toplam ${money(total)}, faiz ${money(total - a.principal)}.`,
      [['Aylık taksit', money(pay)], ['Toplam ödeme', money(total)], ['Toplam faiz', money(total - a.principal)], ['Vade', `${a.months} ay`]], { monthly: pay, total, interest: total - a.principal });
  }),
  tool('compound_interest', 'Bileşik faiz', 'Bileşik faizle bir birikimin zamanla ne kadar olacağını hesaplar; isteğe bağlı aylık ek yatırım.', {
    principal: num('Başlangıç tutarı.'), annual_rate: num('Yıllık getiri yüzdesi.'), years: num('Süre (yıl).'),
    compounds_per_year: int('Yılda kaç kez faiz eklenir, varsayılan 12.', false), monthly_contribution: num('Her ay eklenecek tutar.', false)
  }, (a) => {
    const n = a.compounds_per_year || 12;
    const months = Math.round(a.years * 12);
    let bal = a.principal;
    for (let m = 1; m <= months; m++) {
      bal += a.monthly_contribution || 0;
      if (n >= 12 || m % Math.round(12 / n) === 0) bal *= 1 + a.annual_rate / 100 / Math.min(n, 12);
    }
    const paid = a.principal + (a.monthly_contribution || 0) * months;
    return kvResult(`${fmt(a.years)} yıl sonra ${money(bal)}; getiri ${money(bal - paid)}.`,
      [['Son tutar', money(bal)], ['Yatırılan', money(paid)], ['Getiri', money(bal - paid)]], { balance: bal, invested: paid, gain: bal - paid });
  }),
  tool('deposit', 'Mevduat getirisi', 'Vadeli mevduatın brüt ve stopaj sonrası net getirisini hesaplar.', {
    principal: num('Anapara.'), annual_rate: num('Yıllık faiz yüzdesi.'), days: int('Vade (gün).'), withholding: num('Stopaj yüzdesi, varsayılan 15.', false)
  }, (a) => {
    const gross = a.principal * a.annual_rate / 100 * a.days / 365;
    const tax = gross * (a.withholding ?? 15) / 100;
    return kvResult(`${a.days} günde net getiri ${money(gross - tax)}; vade sonu ${money(a.principal + gross - tax)}.`,
      [['Brüt getiri', money(gross)], [`Stopaj (%${fmt(a.withholding ?? 15)})`, money(tax)], ['Net getiri', money(gross - tax)], ['Vade sonu', money(a.principal + gross - tax)]], { gross, tax, net: gross - tax });
  }),
  tool('bmi', 'Vücut kitle indeksi', 'Boy ve kiloya göre VKİ\'yi ve sınıfını hesaplar.', { weight_kg: num('Kilo (kg).'), height_cm: num('Boy (cm).') }, (a) => {
    positive(a.weight_kg, 'Kilo'); positive(a.height_cm, 'Boy');
    const bmi = a.weight_kg / (a.height_cm / 100) ** 2;
    const cls = bmi < 18.5 ? 'zayıf' : bmi < 25 ? 'normal' : bmi < 30 ? 'fazla kilolu' : bmi < 35 ? 'obez (1. derece)' : bmi < 40 ? 'obez (2. derece)' : 'obez (3. derece)';
    return valueResult('Vücut kitle indeksi', fmt(bmi, 1), { detail: cls, icon: 'activity', data: { bmi, class: cls } });
  }),
  tool('calories', 'Günlük kalori ihtiyacı', 'Mifflin-St Jeor formülüyle bazal metabolizmayı ve hareket düzeyine göre günlük kalori ihtiyacını hesaplar.', {
    sex: { type: 'string', enum: ['erkek', 'kadın'], description: 'Cinsiyet.', required: true },
    age: int('Yaş.'), weight_kg: num('Kilo (kg).'), height_cm: num('Boy (cm).'),
    activity: { type: 'string', enum: ['hareketsiz', 'hafif', 'orta', 'yüksek', 'çok yüksek'], description: 'Hareket düzeyi, varsayılan hafif.' }
  }, (a) => {
    const bmr = 10 * a.weight_kg + 6.25 * a.height_cm - 5 * a.age + (norm(a.sex).startsWith('e') ? 5 : -161);
    const f = { hareketsiz: 1.2, hafif: 1.375, orta: 1.55, yuksek: 1.725, 'cok yuksek': 1.9 }[norm(a.activity || 'hafif')] || 1.375;
    const tdee = bmr * f;
    return kvResult(`Günlük ihtiyaç yaklaşık ${fmt(tdee, 0)} kcal (bazal ${fmt(bmr, 0)}).`,
      [['Bazal metabolizma', `${fmt(bmr, 0)} kcal`], ['Günlük ihtiyaç', `${fmt(tdee, 0)} kcal`], ['Kilo vermek için', `${fmt(tdee - 500, 0)} kcal`], ['Kilo almak için', `${fmt(tdee + 300, 0)} kcal`]], { bmr, tdee });
  }),
  tool('water', 'Su ihtiyacı', 'Kiloya göre günlük su ihtiyacını hesaplar (kg başına ~33 ml).', { weight_kg: num('Kilo (kg).') }, (a) => {
    const l = positive(a.weight_kg, 'Kilo') * 0.033;
    return valueResult('Günlük su ihtiyacı', `${fmt(l, 1)} litre`, { detail: `yaklaşık ${Math.round(l / 0.2)} bardak`, icon: 'drop', data: { liters: l } });
  }),
  tool('ideal_weight', 'İdeal kilo', 'Devine formülüyle boya göre ideal kiloyu ve sağlıklı VKİ aralığını verir.', {
    sex: { type: 'string', enum: ['erkek', 'kadın'], description: 'Cinsiyet.', required: true }, height_cm: num('Boy (cm).')
  }, (a) => {
    const inches = positive(a.height_cm, 'Boy') / 2.54;
    const ideal = (norm(a.sex).startsWith('e') ? 50 : 45.5) + 2.3 * (inches - 60);
    const m = a.height_cm / 100;
    return valueResult('İdeal kilo', `${fmt(ideal, 1)} kg`, { detail: `Sağlıklı aralık ${fmt(18.5 * m * m, 0)}–${fmt(24.9 * m * m, 0)} kg`, icon: 'activity', data: { ideal, min: 18.5 * m * m, max: 24.9 * m * m } });
  }),
  tool('age', 'Yaş hesapla', 'Doğum tarihinden yaşı yıl, ay ve gün olarak; bir sonraki doğum gününe kalan günü hesaplar.', { birth_date: str('Doğum tarihi, ör. 14.03.1995.') }, (a) => {
    const b = parseDate(a.birth_date, 'Doğum tarihi');
    const now = parseDate('bugün');
    if (b > now) throw new ToolError('Doğum tarihi gelecekte olamaz.');
    const { y, m, d } = ymd(b, now);
    let next = new Date(now.getFullYear(), b.getMonth(), b.getDate(), 12);
    if (next < now) next = new Date(now.getFullYear() + 1, b.getMonth(), b.getDate(), 12);
    const left = dayDiff(now, next);
    return valueResult('Yaş', `${y}`, { detail: `${y} yıl ${m} ay ${d} gün · doğum gününe ${left ? `${left} gün` : 'bugün!'}`, icon: 'user', data: { years: y, months: m, days: d, days_to_birthday: left, days_alive: dayDiff(b, now) } });
  }),
  tool('date_diff', 'İki tarih arası', 'İki tarih arasındaki gün, hafta ve ay farkını hesaplar.', { start: str('Başlangıç tarihi.'), end: str('Bitiş tarihi. Boşsa bugün.', false) }, (a) => {
    const s = parseDate(a.start, 'Başlangıç'), e = parseDate(a.end || 'bugün', 'Bitiş');
    const days = dayDiff(s, e);
    const { y, m, d } = s <= e ? ymd(s, e) : ymd(e, s);
    return kvResult(`${Math.abs(days)} gün (${y} yıl ${m} ay ${d} gün).`,
      [['Gün', Math.abs(days)], ['Hafta', fmt(Math.abs(days) / 7, 1)], ['Yıl/ay/gün', `${y} yıl ${m} ay ${d} gün`], ['İş günü', Math.abs(workdays(s, e, false))]], { days, years: y, months: m, rest_days: d });
  }),
  tool('add_days', 'Tarihe gün ekle', 'Bir tarihe gün ekler ya da çıkarır (eksi değer).', { date: str('Tarih. Boşsa bugün.', false), days: int('Eklenecek gün (eksi = çıkar).') }, (a) => {
    const r = new Date(parseDate(a.date || 'bugün').getTime() + a.days * DAY);
    return valueResult(`${a.days >= 0 ? `${a.days} gün sonra` : `${-a.days} gün önce`}`, fmtDate(r), { icon: 'timer', data: { date: iso(r) } });
  }),
  tool('weekday', 'Haftanın günü', 'Bir tarihin haftanın hangi gününe denk geldiğini söyler.', { date: str('Tarih.') }, (a) => {
    const d = parseDate(a.date);
    return valueResult(fmtDate(d).replace(/ \S+$/, ''), DAYS[d.getDay()], { icon: 'timer', data: { weekday: DAYS[d.getDay()], date: iso(d) } });
  }),
  tool('countdown', 'Tarihe kalan süre', 'Bir tarihe (isteğe bağlı saatle) ne kadar kaldığını hesaplar.', { date: str('Hedef tarih.'), time: str('Saat, ör. 18:00. İsteğe bağlı.', false) }, (a) => {
    const d = parseDate(a.date);
    const { h, mi } = a.time ? parseClock(a.time) : { h: 0, mi: 0 };
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, mi);
    const ms = target - Date.now();
    const abs = Math.abs(ms);
    const days = Math.floor(abs / DAY), hours = Math.floor((abs % DAY) / 3600000), mins = Math.floor((abs % 3600000) / 60000);
    const text = `${days} gün ${hours} saat ${mins} dakika`;
    return valueResult(ms >= 0 ? `${fmtDate(d)} için kalan` : `${fmtDate(d)} üzerinden geçen`, text, { icon: 'timer', data: { ms, days, hours, minutes: mins } });
  }),
  tool('unix_time', 'Unix zaman damgası', 'Unix zaman damgasını tarihe ya da tarihi zaman damgasına çevirir. Boş bırakılırsa şimdiki zamanı verir.', { value: str('Zaman damgası (saniye/milisaniye) ya da tarih.', false) }, (a) => {
    const v = String(a.value ?? '').trim();
    if (/^-?\d{9,13}$/.test(v)) {
      const ms = v.length >= 12 ? +v : +v * 1000;
      const d = new Date(ms);
      return kvResult(`${v} = ${d.toLocaleString(TR)}.`, [['Yerel', d.toLocaleString(TR)], ['UTC', d.toISOString()], ['Birim', v.length >= 12 ? 'milisaniye' : 'saniye']], { iso: d.toISOString() });
    }
    const d = v ? parseDate(v) : new Date();
    if (v) d.setHours(0, 0, 0, 0);
    return kvResult(`Zaman damgası ${Math.floor(d / 1000)}.`, [['Saniye', Math.floor(d / 1000)], ['Milisaniye', d.getTime()], ['Tarih', d.toLocaleString(TR)]], { seconds: Math.floor(d / 1000), ms: d.getTime() });
  }),
  tool('timezone', 'Saat dilimi çevir', 'Bir şehirdeki saati başka bir şehrin saatine çevirir (İstanbul 14:30 → New York).', {
    time: str('Saat, ör. 14:30. Boşsa şimdi.', false), from: str('Kaynak şehir ya da saat dilimi. Boşsa İstanbul.', false), to: str('Hedef şehir ya da saat dilimi.'), date: str('Tarih, isteğe bağlı.', false)
  }, (a) => {
    const fromZ = zoneOf(a.from || 'İstanbul'), toZ = zoneOf(a.to);
    let t = Date.now();
    if (a.time) {
      const { h, mi } = parseClock(a.time);
      const base = a.date ? parseDate(a.date) : (() => { const p = wallParts(fromZ, Date.now()); return new Date(p.y, p.mo - 1, p.d, 12); })();
      t = zonedInstant(fromZ, base.getFullYear(), base.getMonth(), base.getDate(), h, mi);
    }
    const f = wallParts(fromZ, t), g = wallParts(toZ, t);
    const dayShift = Date.UTC(g.y, g.mo - 1, g.d) - Date.UTC(f.y, f.mo - 1, f.d);
    const note = dayShift > 0 ? ' (ertesi gün)' : dayShift < 0 ? ' (önceki gün)' : '';
    return kvResult(`${a.from || 'İstanbul'} ${hhmm(f.h, f.mi)} = ${a.to} ${hhmm(g.h, g.mi)}${note}.`,
      [[a.from || 'İstanbul', `${hhmm(f.h, f.mi)} · ${f.d}.${f.mo}.${f.y}`], [a.to, `${hhmm(g.h, g.mi)} · ${g.d}.${g.mo}.${g.y}`], ['Fark', `${fmt((offsetAt(toZ, t) - offsetAt(fromZ, t)) / 3600000, 1)} saat`]],
      { from: hhmm(f.h, f.mi), to: hhmm(g.h, g.mi), day_shift: Math.sign(dayShift) });
  }),
  tool('sleep', 'Uyku döngüsü', '90 dakikalık uyku döngülerine göre ne zaman yatman ya da kalkman gerektiğini hesaplar (uykuya dalma ~15 dk).', {
    wake_time: str('Kalkmak istediğin saat, ör. 07:00.', false), bed_time: str('Yatacağın saat. wake_time yoksa kullanılır; ikisi de yoksa şimdi.', false)
  }, (a) => {
    const fmtMin = (m) => { m = ((m % 1440) + 1440) % 1440; return hhmm(Math.floor(m / 60), m % 60); };
    if (a.wake_time) {
      const { h, mi } = parseClock(a.wake_time);
      const wake = h * 60 + mi;
      const opts = [6, 5, 4, 3].map((c) => ({ title: fmtMin(wake - c * 90 - 15), subtitle: `${c} döngü · ${fmt(c * 1.5, 1)} saat uyku` }));
      return listResult(`${a.wake_time}'de kalkmak için en iyi yatış saatleri: ${opts.map((o) => o.title).join(', ')}.`, `${a.wake_time} kalkış için yatış`, opts);
    }
    const now = new Date();
    const bed = a.bed_time ? (() => { const { h, mi } = parseClock(a.bed_time); return h * 60 + mi; })() : now.getHours() * 60 + now.getMinutes();
    const opts = [3, 4, 5, 6].map((c) => ({ title: fmtMin(bed + 15 + c * 90), subtitle: `${c} döngü · ${fmt(c * 1.5, 1)} saat uyku` }));
    return listResult(`En iyi kalkış saatleri: ${opts.map((o) => o.title).join(', ')}.`, `${fmtMin(bed)} yatış için kalkış`, opts);
  }),
  tool('stats', 'İstatistik', 'Bir sayı listesinin toplamını, ortalamasını, medyanını, modunu, en küçük/büyük değerini ve standart sapmasını hesaplar.', {
    numbers: { type: 'array', items: { type: 'number' }, description: 'Sayılar.', required: true }
  }, (a) => {
    const xs = numbers(a.numbers);
    const n = xs.length, sum = xs.reduce((s, x) => s + x, 0), mean = sum / n;
    const sorted = [...xs].sort((p, q) => p - q);
    const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    const counts = new Map(); xs.forEach((x) => counts.set(x, (counts.get(x) || 0) + 1));
    const top = Math.max(...counts.values());
    const mode = top > 1 ? [...counts].filter(([, c]) => c === top).map(([x]) => x) : [];
    const ss = xs.reduce((s, x) => s + (x - mean) ** 2, 0);
    const popSd = Math.sqrt(ss / n), sampleSd = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
    return kvResult(`${n} sayı: ortalama ${fmt(mean, 4)}, medyan ${fmt(median, 4)}.`,
      [['Adet', n], ['Toplam', fmt(sum, 4)], ['Ortalama', fmt(mean, 4)], ['Medyan', fmt(median, 4)], ['Mod', mode.length ? mode.map((x) => fmt(x, 4)).join(', ') : 'yok'],
        ['En küçük', fmt(sorted[0], 4)], ['En büyük', fmt(sorted[n - 1], 4)], ['Std. sapma (örneklem)', fmt(sampleSd, 4)], ['Std. sapma (kitle)', fmt(popSd, 4)]],
      { count: n, sum, mean, median, mode, min: sorted[0], max: sorted[n - 1], stdev_sample: sampleSd, stdev_population: popSd });
  }),
  tool('gcd_lcm', 'EBOB ve EKOK', 'Tam sayıların en büyük ortak bölenini ve en küçük ortak katını bulur.', {
    numbers: { type: 'array', items: { type: 'integer' }, description: 'İki ya da daha fazla tam sayı.', required: true }
  }, (a) => {
    const xs = numbers(a.numbers).map((x) => Math.round(Math.abs(x)));
    if (xs.length < 2 || xs.some((x) => !x)) throw new ToolError('Sıfırdan farklı en az iki tam sayı ver.');
    const g = xs.reduce(gcd);
    const l = xs.reduce((p, q) => (p / gcd(p, q)) * q);
    return kvResult(`EBOB ${g}, EKOK ${l}.`, [['Sayılar', xs.join(', ')], ['EBOB', g], ['EKOK', l]], { gcd: g, lcm: l });
  }),
  tool('is_prime', 'Asal mı', 'Bir sayının asal olup olmadığını söyler; değilse en küçük böleni ve en yakın asalları verir.', { n: int('Sayı.') }, (a) => {
    const n = a.n;
    if (!Number.isSafeInteger(n)) throw new ToolError('Sayı çok büyük.');
    const prime = isPrime(n);
    let lo = n - 1; while (lo > 1 && !isPrime(lo)) lo--;
    let hi = n + 1; while (!isPrime(hi)) hi++;
    const f = !prime && n > 1 ? factorize(n)[0] : null;
    return valueResult(`${n}`, prime ? 'Asal' : 'Asal değil', { detail: `${f ? `${f}'e bölünür · ` : ''}önceki asal ${lo > 1 ? lo : '—'}, sonraki ${hi}`, icon: 'calculator', data: { prime, smallest_factor: f, prev_prime: lo > 1 ? lo : null, next_prime: hi } });
  }),
  tool('prime_factors', 'Asal çarpanlar', 'Bir sayıyı asal çarpanlarına ayırır (360 = 2³ × 3² × 5).', { n: int('Sayı (2 veya büyük).') }, (a) => {
    if (!Number.isSafeInteger(a.n) || a.n < 2) throw new ToolError('2 veya daha büyük bir tam sayı ver.');
    const fs = factorize(a.n);
    const sup = (k) => String(k).split('').map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[c]).join('');
    const grouped = [...new Set(fs)].map((p) => { const k = fs.filter((x) => x === p).length; return k > 1 ? `${p}${sup(k)}` : `${p}`; }).join(' × ');
    return valueResult(`${a.n}`, grouped, { icon: 'calculator', data: { factors: fs } });
  }),
  tool('factorial', 'Faktöriyel', 'n! değerini tam olarak hesaplar (büyük sayılar dahil).', { n: int('0 ile 1000 arası sayı.') }, (a) => {
    if (a.n < 0 || a.n > 1000) throw new ToolError('n 0 ile 1000 arasında olmalı.');
    const s = factorial(a.n).toString();
    const shown = s.length > 60 ? `${s.slice(0, 20)}…${s.slice(-10)} (${s.length} basamak)` : s;
    return valueResult(`${a.n}!`, shown, { icon: 'calculator', data: { value: s.length > 400 ? `${s.slice(0, 400)}…` : s, digits: s.length } });
  }),
  tool('fibonacci', 'Fibonacci', 'n\'inci Fibonacci sayısını ve ilk sayıları verir.', { n: int('Kaçıncı terim (0-1000).') }, (a) => {
    if (a.n < 0 || a.n > 1000) throw new ToolError('n 0 ile 1000 arasında olmalı.');
    const v = fib(a.n).toString();
    const first = Array.from({ length: Math.min(a.n + 1, 20) }, (_, i) => fib(i).toString());
    return valueResult(`F(${a.n})`, v.length > 60 ? `${v.slice(0, 30)}… (${v.length} basamak)` : v, { detail: `İlk terimler: ${first.join(', ')}`, icon: 'calculator', data: { value: v, first } });
  }),
  tool('base_convert', 'Sayı tabanı çevir', 'Bir sayıyı tabanlar arasında çevirir (ikilik, sekizlik, onluk, onaltılık... 2-36).', {
    value: str('Sayı, ör. "ff" ya da "1011".'), from: int('Kaynak taban, varsayılan 10.', false), to: int('Hedef taban. Boşsa 2, 8, 10 ve 16\'nın hepsi.', false)
  }, (a) => {
    const from = a.from || 10;
    if (from < 2 || from > 36 || (a.to && (a.to < 2 || a.to > 36))) throw new ToolError('Taban 2 ile 36 arasında olmalı.');
    const digits = String(a.value).trim().toLowerCase().replace(/^(0x|0b|0o)/, '').replace(/[\s_]/g, '');
    const neg = digits.startsWith('-');
    const body = neg ? digits.slice(1) : digits;
    let v = 0n;
    for (const c of body) {
      const d = parseInt(c, 36);
      if (Number.isNaN(d) || d >= from) throw new ToolError(`“${a.value}” ${from} tabanında geçerli değil.`);
      v = v * BigInt(from) + BigInt(d);
    }
    if (neg) v = -v;
    const targets = a.to ? [a.to] : [2, 8, 10, 16];
    const rows = targets.map((b) => [`${b} tabanı`, v.toString(b).toUpperCase()]);
    return kvResult(rows.map(([k, x]) => `${k}: ${x}`).join(', ') + '.', rows);
  }),
  tool('roman', 'Roma rakamı', 'Sayıyı Roma rakamına ya da Roma rakamını sayıya çevirir (1-3999).', { value: str('Sayı ya da Roma rakamı, ör. 1994 veya MCMXCIV.') }, (a) => {
    const v = String(a.value).trim();
    if (/^\d+$/.test(v)) { const r = toRoman(+v); return valueResult(v, r, { icon: 'calculator', data: { roman: r } }); }
    const n = fromRoman(v);
    return valueResult(v.toUpperCase(), String(n), { icon: 'calculator', data: { number: n } });
  }),
  tool('number_words', 'Sayıyı yazıyla', 'Bir sayıyı Türkçe yazıya çevirir (çek, fatura için): 1250,50 → bin iki yüz elli virgül elli.', { number: str('Sayı. Ondalık için virgül ya da nokta.') }, (a) => {
    const w = numberWords(a.number);
    return valueResult(String(a.number), w, { icon: 'note', data: { words: w } });
  }),
  tool('quadratic', 'İkinci derece denklem', 'ax² + bx + c = 0 denkleminin köklerini (gerçek ya da karmaşık) bulur.', { a: num('a katsayısı.'), b: num('b katsayısı.'), c: num('c katsayısı.') }, (a) => {
    if (!a.a) {
      if (!a.b) throw new ToolError('a ve b aynı anda sıfır olamaz.');
      const x = -a.c / a.b;
      return valueResult('Doğrusal denklem kökü', `x = ${fmt(x, 6)}`, { icon: 'calculator', data: { roots: [x] } });
    }
    const disc = a.b * a.b - 4 * a.a * a.c;
    if (disc >= 0) {
      const x1 = (-a.b + Math.sqrt(disc)) / (2 * a.a), x2 = (-a.b - Math.sqrt(disc)) / (2 * a.a);
      return kvResult(disc ? `İki kök: ${fmt(x1, 6)} ve ${fmt(x2, 6)}.` : `Çift kök: ${fmt(x1, 6)}.`, [['Diskriminant', fmt(disc, 6)], ['x₁', fmt(x1, 6)], ['x₂', fmt(x2, 6)]], { discriminant: disc, roots: [x1, x2] });
    }
    const re = -a.b / (2 * a.a), im = Math.sqrt(-disc) / (2 * Math.abs(a.a));
    return kvResult(`Gerçek kök yok; karmaşık kökler ${fmt(re, 6)} ± ${fmt(im, 6)}i.`, [['Diskriminant', fmt(disc, 6)], ['x₁', `${fmt(re, 6)} + ${fmt(im, 6)}i`], ['x₂', `${fmt(re, 6)} − ${fmt(im, 6)}i`]], { discriminant: disc, real: re, imaginary: im });
  }),
  tool('area', 'Alan hesapla', 'Kare, dikdörtgen, daire, üçgen ya da yamuğun alanını (ve çevresini) hesaplar.', {
    shape: { type: 'string', enum: ['kare', 'dikdörtgen', 'daire', 'üçgen', 'yamuk'], description: 'Şekil.', required: true },
    a: num('Kenar / taban / üst taban.', false), b: num('İkinci kenar / alt taban.', false), h: num('Yükseklik (üçgen, yamuk).', false), r: num('Yarıçap (daire).', false)
  }, (a) => {
    const s = norm(a.shape);
    let area, per;
    if (s === 'kare') { need(a.a, 'Kenar'); area = a.a ** 2; per = 4 * a.a; }
    else if (s === 'dikdortgen') { need(a.a, 'Kenar a'); need(a.b, 'Kenar b'); area = a.a * a.b; per = 2 * (a.a + a.b); }
    else if (s === 'daire') { need(a.r, 'Yarıçap'); area = Math.PI * a.r ** 2; per = 2 * Math.PI * a.r; }
    else if (s === 'ucgen') { need(a.a, 'Taban'); need(a.h, 'Yükseklik'); area = a.a * a.h / 2; }
    else if (s === 'yamuk') { need(a.a, 'Üst taban'); need(a.b, 'Alt taban'); need(a.h, 'Yükseklik'); area = (a.a + a.b) * a.h / 2; }
    else throw new ToolError('Bilinmeyen şekil.');
    return valueResult(`${a.shape} alanı`, fmt(area, 4), { detail: per != null ? `Çevre ${fmt(per, 4)}` : undefined, icon: 'calculator', data: { area, perimeter: per ?? null } });
  }),
  tool('volume', 'Hacim hesapla', 'Küp, dikdörtgen prizma, silindir, küre ya da koninin hacmini hesaplar.', {
    shape: { type: 'string', enum: ['küp', 'prizma', 'silindir', 'küre', 'koni'], description: 'Cisim.', required: true },
    a: num('Kenar / en.', false), b: num('Boy.', false), c: num('Yükseklik (prizma).', false), r: num('Yarıçap.', false), h: num('Yükseklik (silindir, koni).', false)
  }, (a) => {
    const s = norm(a.shape);
    let v;
    if (s === 'kup') { need(a.a, 'Kenar'); v = a.a ** 3; }
    else if (s === 'prizma') { need(a.a, 'En'); need(a.b, 'Boy'); need(a.c, 'Yükseklik'); v = a.a * a.b * a.c; }
    else if (s === 'silindir') { need(a.r, 'Yarıçap'); need(a.h, 'Yükseklik'); v = Math.PI * a.r ** 2 * a.h; }
    else if (s === 'kure') { need(a.r, 'Yarıçap'); v = (4 / 3) * Math.PI * a.r ** 3; }
    else if (s === 'koni') { need(a.r, 'Yarıçap'); need(a.h, 'Yükseklik'); v = Math.PI * a.r ** 2 * a.h / 3; }
    else throw new ToolError('Bilinmeyen cisim.');
    return valueResult(`${a.shape} hacmi`, fmt(v, 4), { icon: 'cube', data: { volume: v } });
  }),
  tool('speed', 'Hız, yol, zaman', 'Hız (km/sa), yol (km) ve süreden (saat) ikisi verilince üçüncüsünü hesaplar.', {
    speed_kmh: num('Hız (km/sa).', false), distance_km: num('Yol (km).', false), hours: num('Süre (saat).', false)
  }, (a) => {
    const known = ['speed_kmh', 'distance_km', 'hours'].filter((k) => a[k] != null);
    if (known.length < 2) throw new ToolError('Hız, yol ve süreden en az ikisini ver.');
    const v = a.speed_kmh ?? a.distance_km / a.hours;
    const d = a.distance_km ?? a.speed_kmh * a.hours;
    const t = a.hours ?? a.distance_km / a.speed_kmh;
    if (!Number.isFinite(v) || !Number.isFinite(t)) throw new ToolError('Sıfıra bölme: değerleri kontrol et.');
    const tm = `${Math.floor(t)} sa ${Math.round((t % 1) * 60)} dk`;
    return kvResult(`Hız ${fmt(v)} km/sa, yol ${fmt(d)} km, süre ${tm}.`, [['Hız', `${fmt(v)} km/sa`], ['Yol', `${fmt(d)} km`], ['Süre', tm]], { speed_kmh: v, distance_km: d, hours: t });
  }),
  tool('fuel_cost', 'Yakıt maliyeti', 'Bir yolculuğun yakıt tüketimini ve maliyetini hesaplar.', {
    km: num('Yol (km).'), liters_per_100km: num('Ortalama tüketim (L/100 km).'), price_per_liter: num('Litre fiyatı.'), people: int('Masrafı bölüşen kişi sayısı.', false)
  }, (a) => {
    const liters = a.km * a.liters_per_100km / 100, cost = liters * a.price_per_liter;
    const rows = [['Yakıt', `${fmt(liters)} L`], ['Maliyet', money(cost)]];
    if (a.people > 1) rows.push(['Kişi başı', money(cost / a.people)]);
    return kvResult(`${fmt(a.km)} km için ${fmt(liters)} litre, ${money(cost)}.`, rows, { liters, cost });
  }),
  tool('grade_average', 'Not ortalaması', 'Notların ortalamasını hesaplar; kredi verilirse ağırlıklı ortalama (AGNO) ve harf notu.', {
    grades: { type: 'array', items: { type: 'number' }, description: 'Notlar (100\'lük ya da 4\'lük).', required: true },
    credits: { type: 'array', items: { type: 'number' }, description: 'Her dersin kredisi, aynı sırayla. İsteğe bağlı.' }
  }, (a) => {
    const g = numbers(a.grades, 'Notlar');
    const c = a.credits ? numbers(a.credits, 'Krediler') : g.map(() => 1);
    if (c.length !== g.length) throw new ToolError('Not ve kredi sayısı aynı olmalı.');
    const total = c.reduce((s, x) => s + x, 0);
    const avg = g.reduce((s, x, i) => s + x * c[i], 0) / total;
    const letter = avg <= 4 ? null : avg >= 90 ? 'AA' : avg >= 85 ? 'BA' : avg >= 80 ? 'BB' : avg >= 75 ? 'CB' : avg >= 70 ? 'CC' : avg >= 65 ? 'DC' : avg >= 60 ? 'DD' : avg >= 50 ? 'FD' : 'FF';
    return valueResult(a.credits ? 'Ağırlıklı ortalama' : 'Ortalama', fmt(avg, 2), { detail: letter ? `Harf notu ${letter} (yaygın ölçek)` : `${g.length} ders`, icon: 'calculator', data: { average: avg, letter } });
  }),
  tool('color', 'Renk çevir', 'Bir rengi HEX, RGB ve HSL biçimleri arasında çevirir.', { value: str('Renk, ör. #0A84FF ya da 10, 132, 255.') }, (a) => {
    const rgb = parseColor(a.value);
    const hex = '#' + rgb.map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    const [h, s, l] = toHsl(rgb);
    return kvResult(`${hex} = rgb(${rgb.join(', ')}) = hsl(${h}, %${s}, %${l}).`, [['HEX', hex], ['RGB', `rgb(${rgb.join(', ')})`], ['HSL', `hsl(${h}, ${s}%, ${l}%)`]], { hex, rgb, hsl: [h, s, l] });
  }),
  tool('random', 'Rastgele sayı', 'Belirli aralıkta bir ya da birden fazla rastgele tam sayı üretir (kriptografik).', {
    min: int('En küçük, varsayılan 1.', false), max: int('En büyük, varsayılan 100.', false), count: int('Kaç sayı, varsayılan 1 (en fazla 100).', false), unique: { type: 'boolean', description: 'Tekrarsız olsun.' }
  }, (a) => {
    const min = a.min ?? 1, max = a.max ?? 100, count = Math.min(Math.max(a.count || 1, 1), 100);
    if (max < min) throw new ToolError('En büyük değer en küçükten küçük olamaz.');
    if (a.unique && count > max - min + 1) throw new ToolError('Aralıkta bu kadar farklı sayı yok.');
    const out = [];
    while (out.length < count) {
      const x = crypto.randomInt(min, max + 1);
      if (!a.unique || !out.includes(x)) out.push(x);
    }
    return valueResult(`${min}–${max} arası`, out.join(', '), { icon: 'dice', data: { numbers: out } });
  }),
  tool('dice', 'Zar at', 'Bir ya da birden fazla zar atar.', { count: int('Zar sayısı, varsayılan 1 (en fazla 20).', false), sides: int('Yüz sayısı, varsayılan 6.', false) }, (a) => {
    const n = Math.min(Math.max(a.count || 1, 1), 20), sides = Math.max(a.sides || 6, 2);
    const rolls = Array.from({ length: n }, () => crypto.randomInt(1, sides + 1));
    return valueResult(n > 1 ? `${n} zar · toplam ${rolls.reduce((s, x) => s + x, 0)}` : `${sides} yüzlü zar`, rolls.join(' · '), { icon: 'dice', data: { rolls, total: rolls.reduce((s, x) => s + x, 0) } });
  }),
  tool('coin', 'Yazı tura', 'Para atar.', { count: int('Kaç kez, varsayılan 1 (en fazla 50).', false) }, (a) => {
    const n = Math.min(Math.max(a.count || 1, 1), 50);
    const flips = Array.from({ length: n }, () => (crypto.randomInt(2) ? 'Yazı' : 'Tura'));
    const heads = flips.filter((f) => f === 'Yazı').length;
    return valueResult(n > 1 ? `${n} atış · ${heads} yazı, ${n - heads} tura` : 'Yazı tura', n > 1 ? flips.join(', ') : flips[0], { icon: 'dice', data: { flips } });
  }),
  tool('month_calendar', 'Ay takvimi', 'Bir ayın takvimini gösterir (Pazartesi başlangıçlı; bugün işaretli).', { year: int('Yıl. Boşsa bu yıl.', false), month: int('Ay (1-12). Boşsa bu ay.', false) }, (a) => {
    const now = new Date();
    const y = a.year || now.getFullYear(), m = (a.month || now.getMonth() + 1) - 1;
    if (m < 0 || m > 11) throw new ToolError('Ay 1 ile 12 arasında olmalı.');
    const days = new Date(y, m + 1, 0).getDate();
    return textResult(`${MONTHS[m]} ${y}`, monthGrid(y, m), `${MONTHS[m]} ${y}: ${days} gün, ${DAYS[new Date(y, m, 1).getDay()]} başlıyor.`);
  }),
  tool('week_number', 'Hafta numarası', 'Bir tarihin ISO hafta numarasını verir.', { date: str('Tarih. Boşsa bugün.', false) }, (a) => {
    const d = parseDate(a.date || 'bugün');
    const { week, year } = isoWeek(d);
    return valueResult(fmtDate(d), `${year} yılının ${week}. haftası`, { icon: 'timer', data: { week, year } });
  }),
  tool('workdays', 'İş günü say', 'İki tarih arasındaki iş günlerini sayar (hafta sonları hariç; istenirse sabit resmi tatiller de hariç).', {
    start: str('Başlangıç tarihi.'), end: str('Bitiş tarihi.'), holidays: { type: 'boolean', description: 'Sabit tarihli resmi tatilleri de çıkar (1 Ocak, 23 Nisan, 1 Mayıs, 19 Mayıs, 15 Temmuz, 30 Ağustos, 29 Ekim). Dini bayramlar dahil değil.' }
  }, (a) => {
    const s = parseDate(a.start, 'Başlangıç'), e = parseDate(a.end, 'Bitiş');
    const n = Math.abs(workdays(s, e, !!a.holidays));
    return valueResult(`${iso(s)} – ${iso(e)}`, `${n} iş günü`, { detail: a.holidays ? 'Sabit resmi tatiller hariç; dini bayramlar dahil değil' : 'Hafta sonları hariç', icon: 'timer', data: { workdays: n } });
  })
];

module.exports.helpers = { parseDate, numberWords, toRoman, fromRoman, isoWeek, workdays, zonedInstant, wallParts, factorize, isPrime };

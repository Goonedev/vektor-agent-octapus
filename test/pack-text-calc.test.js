'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const text = require('../src/main/tools/packs/text');
const calc = require('../src/main/tools/packs/calc');

const clip = { value: '', readText: async () => clip.value, writeText: async (s) => { clip.value = s; } };
const ctx = { clip };
const run = (pack, name, args) => {
  const t = pack.find((x) => x.name === name);
  assert.ok(t, `missing ${name}`);
  return t.run(args, ctx);
};

test('text and calc packs have the expected shape and size', () => {
  assert.equal(text.length, 46);
  assert.equal(calc.length, 42);
  const names = new Set();
  for (const t of [...text, ...calc]) {
    assert.match(t.name, /^(text|calc)_[a-z0-9_]{2,60}$/);
    assert.ok(!names.has(t.name), `duplicate ${t.name}`);
    names.add(t.name);
    assert.ok(t.category === (t.name.startsWith('text_') ? 'text' : 'utility'));
    assert.ok(t.title && t.description);
    assert.equal(typeof t.run, 'function');
    for (const [k, p] of Object.entries(t.params || {})) {
      assert.ok(['string', 'number', 'integer', 'boolean', 'array'].includes(p.type), `${t.name}.${k}`);
    }
  }
});

test('text transforms are Turkish-aware and use the clipboard', async () => {
  assert.match((await run(text, 'text_upper', { text: 'istanbul ılık' })).data.text, /İSTANBUL ILIK/);
  assert.match((await run(text, 'text_lower', { text: 'IŞIK İz' })).data.text, /ışık iz/);
  assert.match((await run(text, 'text_slug', { text: 'Çağrı Şükrü Öğün!' })).summary, /cagri-sukru-ogun/);
  assert.match((await run(text, 'text_sha256', { text: 'abc' })).summary, /ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad/);
  const b64 = await run(text, 'text_base64_encode', { text: 'Ğüzel şey' });
  const back = await run(text, 'text_base64_decode', { text: b64.data.text ?? b64.data.value });
  assert.match(back.summary, /Ğüzel şey/);
  const morse = await run(text, 'text_morse_encode', { text: 'SOS' });
  assert.match(morse.summary, /\.\.\. --- \.\.\./);
  clip.value = 'panodan gelen';
  const fromClip = await run(text, 'text_upper', { copy: true });
  assert.match(fromClip.summary, /PANODAN GELEN/);
  assert.equal(clip.value, 'PANODAN GELEN');
  clip.value = '';
  await assert.rejects(run(text, 'text_upper', {}), /metin yok/);
  const bad = await run(text, 'text_json_validate', { text: '{"a":1,\n "b":}' });
  assert.equal(bad.data.valid, false);
  assert.deepEqual([bad.data.line, bad.data.column], [2, 6]);
});

test('calculators give exact answers', async () => {
  assert.match((await run(calc, 'calc_factorial', { n: 5 })).summary, /120/);
  assert.match((await run(calc, 'calc_roman', { value: '1994' })).summary, /MCMXCIV/);
  assert.match((await run(calc, 'calc_roman', { value: 'MCMXCIV' })).summary, /1994/);
  assert.match((await run(calc, 'calc_prime_factors', { n: 360 })).summary, /2³ × 3² × 5/);
  assert.match((await run(calc, 'calc_gcd_lcm', { numbers: [12, 18] })).summary, /EBOB 6, EKOK 36/);
  assert.equal((await run(calc, 'calc_is_prime', { n: 97 })).data.prime, true);
  assert.match((await run(calc, 'calc_base_convert', { value: 'ff', from: 16, to: 2 })).summary, /11111111/);
  assert.equal((await run(calc, 'calc_stats', { numbers: '2 4 4 4 5 5 7 9' })).data.stdev_population, 2);
  const loan = await run(calc, 'calc_loan', { principal: 100000, annual_rate: 12, months: 12 });
  assert.ok(Math.abs(loan.data.monthly - 8884.88) < 0.01);
  assert.ok(Math.abs((await run(calc, 'calc_bmi', { weight_kg: 70, height_cm: 175 })).data.bmi - 22.857) < 0.01);
  assert.match((await run(calc, 'calc_quadratic', { a: 1, b: -3, c: 2 })).summary, /2 ve 1/);
});

test('Turkish number words', () => {
  const { numberWords } = calc.helpers;
  assert.equal(numberWords('0'), 'sıfır');
  assert.equal(numberWords('10'), 'on');
  assert.equal(numberWords('100'), 'yüz');
  assert.equal(numberWords('1000'), 'bin');
  assert.equal(numberWords('1001'), 'bin bir');
  assert.equal(numberWords('2024'), 'iki bin yirmi dört');
  assert.equal(numberWords('1000000'), 'bir milyon');
  assert.equal(numberWords('1234567'), 'bir milyon iki yüz otuz dört bin beş yüz altmış yedi');
  assert.equal(numberWords('-15'), 'eksi on beş');
  assert.equal(numberWords('12,5'), 'on iki virgül beş');
});

test('dates: parsing, ISO weeks, workdays and time zones', async () => {
  const { parseDate, isoWeek, workdays } = calc.helpers;
  assert.equal(parseDate('14.03.2025').getMonth(), 2);
  assert.equal(parseDate('2025-03-14').getDate(), 14);
  assert.throws(() => parseDate('31.02.2025'));
  assert.deepEqual(isoWeek(new Date(2021, 0, 3, 12)), { week: 53, year: 2020 });
  assert.deepEqual(isoWeek(new Date(2026, 9, 14, 12)), { week: 42, year: 2026 });
  assert.equal(workdays(parseDate('2026-10-26'), parseDate('2026-10-30'), true), 4);
  assert.equal(workdays(parseDate('2026-10-26'), parseDate('2026-10-30'), false), 5);
  const ny = await run(calc, 'calc_timezone', { time: '14:30', from: 'İstanbul', to: 'New York', date: '2026-01-15' });
  assert.equal(ny.data.to, '06:30');
  const tokyo = await run(calc, 'calc_timezone', { time: '23:00', from: 'İstanbul', to: 'Tokyo', date: '2026-07-15' });
  assert.equal(tokyo.data.to, '05:00');
  assert.equal(tokyo.data.day_shift, 1);
  assert.match((await run(calc, 'calc_weekday', { date: '29.10.1923' })).summary, /Pazartesi/);
});

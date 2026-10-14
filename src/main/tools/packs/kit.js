'use strict';

/*
 * Shared helpers for the tool packs. Packs are mostly data tables (settings pages, sites,
 * shortcuts, text transforms) turned into tools by the small factories here.
 */

const { isWin, isMac, isLinux, ToolError, launch, ps, psJson, psStr, run, unsupported, truncate } = require('../util');

function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } }

/** Opens a URL or URI (https:, ms-settings:, spotify:, steam: ...) with the system handler. */
async function openUri(ctx, uri) {
  try {
    await ctx.electron.shell.openExternal(uri);
  } catch (e) {
    throw new ToolError(`Açılamadı: ${uri}`, e.message);
  }
}

/** Result for a tool that opened a web page. */
function linkResult(url, title) {
  return { summary: `${title} açıldı.`, display: { type: 'link', url, title, host: host(url) }, data: { url } };
}

/** Result for a tool that produced a single value the user may want to copy. */
function valueResult(label, value, { detail, icon, data } = {}) {
  return {
    summary: `${label}: ${value}`,
    display: { type: 'value', label, value: String(value), detail, icon },
    data: data ?? { value }
  };
}

/** Result for a block of text (transforms, command output). */
function textResult(title, text, summary) {
  const t = String(text ?? '');
  return {
    summary: summary || (t.length > 300 ? `${title} hazır (${t.length} karakter).` : `${title}: ${t}`),
    display: { type: 'code', title, text: truncate(t, 6000) },
    data: { text: truncate(t, 8000) }
  };
}

/** Result for key/value rows. */
function kvResult(summary, rows, data) {
  return { summary, display: { type: 'kv', rows: rows.map(([k, v]) => [String(k), String(v ?? '—')]) }, data: data ?? Object.fromEntries(rows) };
}

/** Result for a list. items: [{ title, subtitle?, meta?, icon?, path? }] */
function listResult(summary, title, items, data) {
  return { summary, display: { type: 'list', title, items }, data: data ?? items.map((i) => i.title) };
}

/** Runs PowerShell on Windows only; elsewhere throws a readable "not supported". */
async function winOnly(feature, script, opts) {
  if (!isWin) throw unsupported(feature);
  return ps(script, opts);
}

async function winJson(feature, script, opts) {
  if (!isWin) throw unsupported(feature);
  return psJson(script, opts);
}

const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

module.exports = {
  isWin, isMac, isLinux, ToolError, launch, ps, psJson, psStr, run, unsupported, truncate,
  host, openUri, linkResult, valueResult, textResult, kvResult, listResult, winOnly, winJson, asArray
};

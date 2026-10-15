'use strict';

/*
 * MCP connections. The user lists servers in Settings in the same JSON shape Claude Desktop uses:
 *   { "mcpServers": { "dosyalar": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/Users/me/Belgeler"] },
 *                     "uzak": { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer ..." } } } }
 * Each server's tools join Vektör's library as mcp_<server>_<tool>: listed in the system prompt,
 * found with find_tools, run with use_tool. A tool asks for approval unless the server marks it
 * read-only. Only servers the user adds here are ever started.
 */

const { ToolError, norm, truncate } = require('./tools/util');

const CONNECT_TIMEOUT = 25000;
const CALL_TIMEOUT = 120000;

function slug(s) {
  return norm(s).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
}

/** Accepts {"mcpServers": {...}} or the bare {...}. Returns [{ name, ...cfg }]. */
function parseConfig(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  let obj;
  try { obj = JSON.parse(raw); } catch (e) { throw new ToolError(`MCP ayarı geçerli JSON değil: ${e.message}`); }
  const servers = obj && typeof obj === 'object' ? (obj.mcpServers || obj.servers || obj) : null;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) throw new ToolError('MCP ayarı {"mcpServers": {...}} biçiminde olmalı.');
  return Object.entries(servers).map(([name, cfg]) => {
    if (!cfg || typeof cfg !== 'object') throw new ToolError(`“${name}” sunucusunun ayarı bir nesne olmalı.`);
    if (!cfg.command && !cfg.url) throw new ToolError(`“${name}” için "command" ya da "url" gerekli.`);
    if (cfg.args != null && !Array.isArray(cfg.args)) throw new ToolError(`“${name}” için "args" bir liste olmalı.`);
    return { name, ...cfg, disabled: !!cfg.disabled };
  });
}

const TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object']);

function paramOf(schema = {}) {
  let type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  if (!TYPES.has(type)) type = schema.enum ? 'string' : schema.properties ? 'object' : 'string';
  const p = { type };
  if (schema.description) p.description = truncate(schema.description, 300);
  if (Array.isArray(schema.enum) && schema.enum.every((v) => typeof v === 'string')) p.enum = schema.enum;
  if (type === 'array') {
    const it = schema.items || {};
    p.items = { type: TYPES.has(it.type) && it.type !== 'array' && it.type !== 'object' ? it.type : 'string' };
  }
  return p;
}

/** Converts one MCP tool into a Vektör library tool. */
function toVektorTool(server, t, call, taken) {
  let name = `mcp_${slug(server)}_${slug(t.name)}`.slice(0, 64);
  if (!/^[a-z]/.test(name)) name = `m${name}`.slice(0, 64);
  for (let i = 2; taken.has(name); i++) name = `${name.slice(0, 60)}_${i}`;
  taken.add(name);
  const schema = t.inputSchema || {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const params = Object.fromEntries(Object.entries(schema.properties || {}).map(([k, s]) => [k, { ...paramOf(s), ...(required.has(k) ? { required: true } : {}) }]));
  const readOnly = t.annotations?.readOnlyHint === true;
  return {
    name,
    category: 'mcp',
    title: truncate(t.title || t.annotations?.title || t.name, 60),
    description: truncate(`${server} (MCP): ${t.description || t.name}`, 500),
    params,
    passthrough: true,
    danger: !readOnly,
    timeout: CALL_TIMEOUT + 5000,
    mcp: { server, tool: t.name },
    run: (args) => call(t.name, args)
  };
}

/** Turns an MCP CallToolResult into Vektör's { summary, display, data }. */
function toResult(server, toolName, res) {
  const parts = Array.isArray(res?.content) ? res.content : [];
  const texts = [];
  let image = null;
  for (const c of parts) {
    if (c.type === 'text' && c.text) texts.push(c.text);
    else if (c.type === 'image' && c.data && !image) image = `data:${c.mimeType || 'image/png'};base64,${c.data}`;
    else if (c.type === 'resource' && c.resource?.text) texts.push(c.resource.text);
    else if (c.type === 'resource_link' && c.uri) texts.push(`${c.name || c.uri}: ${c.uri}`);
  }
  const text = texts.join('\n\n').trim();
  if (res?.isError) throw new ToolError(`${server}: ${truncate(text || 'araç hata döndürdü', 400)}`);
  const summary = text ? truncate(text, 1200) : image ? `${toolName} bir görüntü döndürdü.` : `${toolName} tamamlandı.`;
  return {
    summary,
    display: image ? { type: 'image', src: image, caption: `${server} · ${toolName}` } : { type: 'code', title: `${server} · ${toolName}`, text: truncate(text || '(boş yanıt)', 6000) },
    data: res?.structuredContent ?? { text: truncate(text, 8000) }
  };
}

function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new ToolError(`${what} zaman aşımına uğradı.`)), ms); })]).finally(() => clearTimeout(t));
}

class McpManager {
  /** @param {{ setDynamic: (source: string, tools: object[]) => void, log?: Function, clientInfo?: object }} o */
  constructor(o) {
    this.setDynamic = o.setDynamic;
    this.log = o.log || (() => {});
    this.clientInfo = o.clientInfo || { name: 'vektor', version: '0.0.0' };
    this.servers = new Map(); // name → { state, tools, error, client }
    this.generation = 0;
    this.onStatus = null;
  }

  status() {
    return [...this.servers.entries()].map(([name, s]) => ({ name, state: s.state, tools: s.tools?.length || 0, error: s.error || null, kind: s.kind }));
  }

  emit() { try { this.onStatus?.(this.status()); } catch { /* UI not ready */ } }

  /** Disconnects everything and connects the servers in `configText`. Never throws for a single bad server. */
  async apply(configText) {
    const gen = ++this.generation;
    await this.closeAll();
    let list;
    try { list = parseConfig(configText); } catch (e) {
      this.servers.set('ayar', { state: 'error', error: e.message });
      this.emit();
      return this.status();
    }
    for (const s of list) this.servers.set(s.name, { state: s.disabled ? 'disabled' : 'connecting', kind: s.url ? 'http' : 'stdio' });
    this.emit();
    await Promise.all(list.filter((s) => !s.disabled).map((s) => this.connect(s, gen)));
    if (gen === this.generation) this.publish();
    return this.status();
  }

  async connect(cfg, gen) {
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const entry = this.servers.get(cfg.name);
    if (!entry || gen !== this.generation) return;
    let stderr = '';
    const make = () => new Client(this.clientInfo, { capabilities: {} });
    let client = make();
    try {
      let transport;
      if (cfg.url) {
        const url = new URL(cfg.url);
        if (!['http:', 'https:'].includes(url.protocol)) throw new ToolError('MCP adresi http ya da https olmalı.');
        const opts = cfg.headers ? { requestInit: { headers: cfg.headers } } : undefined;
        try {
          const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
          transport = new StreamableHTTPClientTransport(url, opts);
          await withTimeout(client.connect(transport), CONNECT_TIMEOUT, `${cfg.name} bağlantısı`);
        } catch (e) {
          // Older servers only speak SSE.
          await client.close().catch(() => {});
          client = make();
          const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');
          transport = new SSEClientTransport(url, opts);
          await withTimeout(client.connect(transport), CONNECT_TIMEOUT, `${cfg.name} bağlantısı`);
        }
      } else {
        const { StdioClientTransport, getDefaultEnvironment } = require('@modelcontextprotocol/sdk/client/stdio.js');
        transport = new StdioClientTransport({
          command: cfg.command,
          args: (cfg.args || []).map(String),
          env: { ...getDefaultEnvironment(), ...(cfg.env || {}) },
          cwd: cfg.cwd,
          stderr: 'pipe'
        });
        transport.stderr?.on('data', (d) => { stderr = (stderr + d.toString()).slice(-2000); });
        await withTimeout(client.connect(transport), CONNECT_TIMEOUT, `${cfg.name} başlatılması`);
      }
      const tools = [];
      let cursor;
      do {
        const page = await withTimeout(client.listTools(cursor ? { cursor } : {}), CONNECT_TIMEOUT, `${cfg.name} araç listesi`);
        tools.push(...(page.tools || []));
        cursor = page.nextCursor;
      } while (cursor && tools.length < 500);
      if (gen !== this.generation) { await client.close().catch(() => {}); return; }
      const call = async (name, args) => {
        if (entry.state !== 'connected') throw new ToolError(`${cfg.name} MCP sunucusu bağlı değil.`);
        const res = await withTimeout(client.callTool({ name, arguments: args || {} }, undefined, { timeout: CALL_TIMEOUT }), CALL_TIMEOUT + 2000, `${cfg.name} · ${name}`);
        return toResult(cfg.name, name, res);
      };
      Object.assign(entry, { state: 'connected', client, rawTools: tools, call, error: null });
      client.onclose = () => { if (entry.client === client && entry.state === 'connected') { entry.state = 'error'; entry.error = 'Bağlantı kapandı.'; this.publish(); } };
      this.log(`MCP ${cfg.name}: ${tools.length} araç`);
    } catch (e) {
      await client.close().catch(() => {});
      if (gen !== this.generation) return;
      const tail = stderr.trim().split('\n').slice(-2).join(' ');
      Object.assign(entry, { state: 'error', error: truncate(`${e.message || e}${tail ? ` — ${tail}` : ''}`, 300) });
      this.log(`MCP ${cfg.name} hata: ${entry.error}`);
    }
    this.emit();
  }

  /** Puts every connected server's tools into the registry. */
  publish() {
    const taken = new Set();
    const all = [];
    for (const [name, s] of this.servers) {
      if (s.state !== 'connected') { s.tools = []; continue; }
      s.tools = s.rawTools.map((t) => toVektorTool(name, t, s.call, taken));
      all.push(...s.tools);
    }
    this.setDynamic('mcp', all);
    this.emit();
  }

  async closeAll() {
    const old = [...this.servers.values()];
    this.servers.clear();
    this.setDynamic('mcp', []);
    await Promise.all(old.map((s) => s.client?.close().catch(() => {})));
  }
}

module.exports = { McpManager, parseConfig, toVektorTool, toResult, slug };

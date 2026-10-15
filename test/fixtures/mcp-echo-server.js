'use strict';

// A tiny MCP server over stdio for tests: one read-only tool and one that changes state.
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const server = new McpServer({ name: 'echo', version: '1.0.0' });
let counter = 0;
server.registerTool('echo', {
  title: 'Yankı',
  description: 'Metni geri döndürür.',
  inputSchema: { text: z.string().describe('Metin') },
  annotations: { readOnlyHint: true }
}, async ({ text }) => ({ content: [{ type: 'text', text: `yankı: ${text}` }] }));
server.registerTool('increment', {
  description: 'Sayacı artırır.',
  inputSchema: { by: z.number().int().optional() }
}, async ({ by }) => { counter += by || 1; return { content: [{ type: 'text', text: String(counter) }] }; });
server.registerTool('fail', { description: 'Hata döndürür.', inputSchema: {} }, async () => ({ isError: true, content: [{ type: 'text', text: 'olmadı' }] }));
server.connect(new StdioServerTransport());

#!/usr/bin/env node
// MCP server (stdio) that lets an agent buy AgentFeed data in MUSD. Tools: list_routes, call_route.
//   AGENT_PRIVATE_KEY=0x... NETWORK=base|mezo-mainnet|mezo-testnet GATEWAY_URL=https://mezo.ochinimus.app npx @seekdaseek/agentfeed-mezo
// Without AGENT_PRIVATE_KEY the server still starts and list_routes works (it is free); call_route then says what is missing.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs';
import { createAgent } from './client.js';

const baseUrl = (process.env.GATEWAY_URL || 'https://mezo.ochinimus.app').replace(/\/$/, '');
const NEEDS_KEY = 'call_route spends MUSD and needs AGENT_PRIVATE_KEY (a funded wallet on NETWORK) in the server environment. list_routes is free and works without it.';
const agent = !process.env.AGENT_PRIVATE_KEY ? null : createAgent({ privateKey: process.env.AGENT_PRIVATE_KEY, networkKey: process.env.NETWORK || 'mezo-testnet', baseUrl, maxPriceMusd: Number(process.env.MAX_PRICE_MUSD || 0.1) });

const server = new McpServer({ name: 'agentfeed-mezo', version: JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version });
const text = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 2) }] });

server.registerTool('list_routes', {
  description: 'List the AgentFeed routes sold for MUSD on Mezo testnet with their prices. Free, spends nothing.',
  inputSchema: {},
  // Reads the gateway manifest only: no state changes, same answer for the same state, talks to a remote service.
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async () => {
  const m = await (await fetch(`${baseUrl}/.well-known/x402`)).json();
  return text({ network: m.network, token: m.asset, routes: m.routes.map((r) => ({ id: r.id, price_musd: r.price_musd, params: r.params, description: r.description })) });
});

server.registerTool('call_route', {
  description: 'Pay for and call one AgentFeed route in MUSD (signs an EIP-2612 permit; the gateway pays the gas). Returns the data and the Mezo explorer link of the settlement. Spends MUSD from the agent wallet.',
  inputSchema: {
    route: z.string().describe('route id from list_routes, e.g. "sol-price", "liquidations", "summarize"'),
    params: z.record(z.string(), z.string()).optional().describe('query parameters, e.g. {"url":"https://example.com"} for summarize'),
    scheme: z.enum(['permit', 'transfer']).optional().describe('permit (default, no gas) or transfer (agent sends a plain MUSD transfer)'),
  },
  // Spends MUSD from the agent wallet and calls a remote gateway. Each call is a new payment, so it is not idempotent;
  // it moves funds but does not destroy or overwrite anything, so it is not destructive in the MCP sense.
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async ({ route, params, scheme }) => {
  if (!agent) return { isError: true, ...text(NEEDS_KEY) };
  try {
    const r = await agent.call(route, params || {}, { scheme: scheme || 'permit' });
    if (!r.ok) return { isError: true, ...text({ status: r.status, error: r.body.error, message: r.body.message }) };
    return text({ paid: r.body.paid, data: r.body.data });
  } catch (e) { return { isError: true, ...text(String(e.message || e)) }; }
});

await server.connect(new StdioServerTransport());

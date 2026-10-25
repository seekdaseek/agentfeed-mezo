// MCP server (stdio) that lets an agent buy AgentFeed data in MUSD. Tools: list_routes, call_route.
//   AGENT_PRIVATE_KEY=0x... GATEWAY_URL=https://mezo.ochinimus.app node src/mcp.js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createAgent } from './client.js';

const baseUrl = (process.env.GATEWAY_URL || 'https://mezo.ochinimus.app').replace(/\/$/, '');
if (!process.env.AGENT_PRIVATE_KEY) { console.error('AGENT_PRIVATE_KEY is required'); process.exit(2); }
const agent = createAgent({ privateKey: process.env.AGENT_PRIVATE_KEY, baseUrl, maxPriceMusd: Number(process.env.MAX_PRICE_MUSD || 0.1) });

const server = new McpServer({ name: 'agentfeed-mezo', version: '0.1.0' });
const text = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 2) }] });

server.registerTool('list_routes', {
  description: 'List the AgentFeed routes sold for MUSD on Mezo testnet with their prices. Free, spends nothing.',
  inputSchema: {},
}, async () => {
  const m = await (await fetch(`${baseUrl}/.well-known/x402`)).json();
  return text({ network: m.network, token: m.asset, routes: m.routes.map((r) => ({ id: r.id, price_musd: r.price_musd, params: r.params, description: r.description })) });
});

server.registerTool('call_route', {
  description: 'Pay for and call one AgentFeed route in MUSD (signs an EIP-2612 permit; the gateway pays the gas). Returns the data and the Mezo explorer link of the settlement. Spends MUSD from the agent wallet.',
  inputSchema: {
    route: z.string().describe('route id from list_routes, e.g. "sol-price", "liquidations", "summarize"'),
    params: z.record(z.string()).optional().describe('query parameters, e.g. {"url":"https://example.com"} for summarize'),
    scheme: z.enum(['permit', 'transfer']).optional().describe('permit (default, no gas) or transfer (agent sends a plain MUSD transfer)'),
  },
}, async ({ route, params, scheme }) => {
  try {
    const r = await agent.call(route, params || {}, { scheme: scheme || 'permit' });
    if (!r.ok) return { isError: true, ...text({ status: r.status, error: r.body.error, message: r.body.message }) };
    return text({ paid: r.body.paid, data: r.body.data });
  } catch (e) { return { isError: true, ...text(String(e.message || e)) }; }
});

await server.connect(new StdioServerTransport());

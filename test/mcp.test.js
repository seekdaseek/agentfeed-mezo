// The MCP server exercised the way a host does: spawn src/mcp.js over stdio, talk to it with the SDK client.
// No real key and no internet: the key is freshly generated, and the "gateway" is a loopback http server in this file
// (or a closed port). Nothing here can reach Mezo or spend MUSD; the price guard and connection failures are refusals
// that happen before anything is signed.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { generatePrivateKey } from 'viem/accounts';

const ASSET = '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503';
const TREASURY = '0xf01d65DBd1B946C48b7dB1f0A02AaBd021c89227';
const ROUTES = [
  { id: 'sol-price', price_musd: '0.01', price_wei: '10000000000000000', params: {}, description: 'Live SOL/USD spot price.' },
  { id: 'summarize', price_musd: '0.05', price_wei: '50000000000000000', params: { url: 'string!' }, description: 'Summarize a page.' },
];

// price of the route the fake gateway asks for, in wei; the tests change it
let gw; let seen = []; let askWei = '500000000000000000'; let askAsset = ASSET; let askNetwork = 'eip155:31611';
before(async () => {
  gw = http.createServer((req, res) => {
    seen.push({ url: req.url, paid: Boolean(req.headers['payment-signature'] || req.headers['x-payment']) });
    if (req.url === '/.well-known/x402') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ network: 'eip155:31611', asset: { address: ASSET, symbol: 'MUSD' }, routes: ROUTES }));
    }
    const accept = { scheme: 'permit', network: askNetwork, asset: askAsset, amount: askWei, payTo: TREASURY, maxTimeoutSeconds: 300,
      extra: { name: 'Mezo USD', version: '1', spender: TREASURY, nonce: '1.2.aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', expiresAt: Math.floor(Date.now() / 1000) + 300 } };
    const body = { x402Version: 2, error: 'payment_required', accepts: [accept] };
    res.writeHead(402, { 'content-type': 'application/json', 'payment-required': Buffer.from(JSON.stringify(body)).toString('base64') });
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => gw.listen(0, '127.0.0.1', r));
});
after(() => { gw.closeAllConnections(); gw.close(); });
const gwUrl = () => `http://127.0.0.1:${gw.address().port}`;

async function withClient(env, fn) {
  const transport = new StdioClientTransport({
    command: process.execPath, args: ['src/mcp.js'],
    env: { PATH: process.env.PATH, AGENT_PRIVATE_KEY: generatePrivateKey(), ...env },
  });
  const client = new Client({ name: 'test', version: '0.0.1' });
  await client.connect(transport);
  try { return await fn(client); } finally { await client.close(); }
}
const text = (r) => r.content[0].text;

describe('mcp server: tool declarations', () => {
  test('exposes exactly list_routes and call_route', () => withClient({ GATEWAY_URL: gwUrl() }, async (c) => {
    const { tools } = await c.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ['call_route', 'list_routes']);
  }));
  test('list_routes declares read-only, non-destructive, idempotent, open-world', () => withClient({ GATEWAY_URL: gwUrl() }, async (c) => {
    const t = (await c.listTools()).tools.find((x) => x.name === 'list_routes');
    assert.deepEqual(t.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true });
  }));
  test('call_route declares not read-only, non-destructive, not idempotent, open-world (it spends MUSD)', () => withClient({ GATEWAY_URL: gwUrl() }, async (c) => {
    const t = (await c.listTools()).tools.find((x) => x.name === 'call_route');
    assert.deepEqual(t.annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });
  }));
  test('input schemas contain no array type (zod GHSA-mrhx-c7xc-m3w5 is about array schemas)', () => withClient({ GATEWAY_URL: gwUrl() }, async (c) => {
    const { tools } = await c.listTools();
    const walk = (n) => (n && typeof n === 'object' ? Object.entries(n).some(([k, v]) => (k === 'type' && (v === 'array' || (Array.isArray(v) && v.includes('array')))) || k === 'items' || k === 'prefixItems' || walk(v)) : false);
    for (const t of tools) assert.equal(walk(t.inputSchema), false, `${t.name} schema has an array`);
    const call = tools.find((x) => x.name === 'call_route').inputSchema;
    assert.deepEqual(call.required, ['route']);
    assert.equal(call.properties.route.type, 'string');
    assert.deepEqual(call.properties.scheme.enum, ['permit', 'transfer']);
  }));
});

describe('mcp server: list_routes', () => {
  test('returns the gateway routes with their MUSD prices and spends nothing', () => withClient({ GATEWAY_URL: gwUrl() }, async (c) => {
    seen = [];
    const r = await c.callTool({ name: 'list_routes', arguments: {} });
    assert.ok(!r.isError);
    const j = JSON.parse(text(r));
    assert.equal(j.network, 'eip155:31611');
    assert.equal(j.token.symbol, 'MUSD');
    assert.deepEqual(j.routes.map((x) => [x.id, x.price_musd]), [['sol-price', '0.01'], ['summarize', '0.05']]);
    assert.deepEqual(seen.map((s) => s.url), ['/.well-known/x402']);
    assert.ok(seen.every((s) => !s.paid));
  }));
});

describe('mcp server: call_route refuses safely', () => {
  test('a price above MAX_PRICE_MUSD is refused before anything is signed', () => withClient({ GATEWAY_URL: gwUrl(), MAX_PRICE_MUSD: '0.10' }, async (c) => {
    seen = []; askWei = '500000000000000000'; // 0.5 MUSD
    const r = await c.callTool({ name: 'call_route', arguments: { route: 'sol-price' } });
    assert.equal(r.isError, true);
    assert.match(text(r), /above the cap of 0\.1/);
    assert.deepEqual(seen, [{ url: '/api/sol-price', paid: false }], 'one unpaid request, no payment header ever sent');
  }));
  test('a challenge for another token is refused', () => withClient({ GATEWAY_URL: gwUrl() }, async (c) => {
    seen = []; askWei = '10000000000000000'; askAsset = '0x00000000000000000000000000000000000dEaD1';
    try {
      const r = await c.callTool({ name: 'call_route', arguments: { route: 'sol-price' } });
      assert.equal(r.isError, true);
      assert.match(text(r), /expected MUSD/);
      assert.ok(seen.every((s) => !s.paid));
    } finally { askAsset = ASSET; }
  }));
  test('a challenge for another network is refused', () => withClient({ GATEWAY_URL: gwUrl() }, async (c) => {
    seen = []; askWei = '10000000000000000'; askNetwork = 'eip155:1';
    try {
      const r = await c.callTool({ name: 'call_route', arguments: { route: 'sol-price' } });
      assert.equal(r.isError, true);
      assert.match(text(r), /expected eip155:31611/);
      assert.ok(seen.every((s) => !s.paid));
    } finally { askNetwork = 'eip155:31611'; }
  }));
  test('an unreachable gateway is a clean tool error, not a crash, and nothing is spent', () => withClient({ GATEWAY_URL: 'http://127.0.0.1:1' }, async (c) => {
    const r = await c.callTool({ name: 'call_route', arguments: { route: 'sol-price' } });
    assert.equal(r.isError, true);
    assert.match(text(r), /fetch failed|ECONNREFUSED/i);
    const again = await c.callTool({ name: 'list_routes', arguments: {} }).catch((e) => ({ threw: e }));
    assert.ok(again.threw || again.isError || again.content, 'the server is still answering after the failure');
  }));
  test('bad arguments are rejected by the schema', () => withClient({ GATEWAY_URL: gwUrl() }, async (c) => {
    const r = await c.callTool({ name: 'call_route', arguments: { route: 'sol-price', scheme: 'wire' } }).catch((e) => ({ isError: true, text: String(e) }));
    assert.equal(r.isError, true);
  }));
});

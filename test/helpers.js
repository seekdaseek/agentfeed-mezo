// Test harness: the real gateway code over a FAKE chain adapter and a FAKE upstream.
// Signatures are real EIP-712 / EIP-191 signatures made with viem, so verification logic is genuinely exercised;
// only the RPC and AgentFeed are stubbed. Live-chain evidence is in evidence/ and the README, not here.
import http from 'node:http';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { loadConfig, MUSD } from '../src/config.js';
import { createGateway } from '../src/server.js';
import { openStore } from '../src/store.js';
import { PERMIT_TYPES, claimMessage, permitDomain } from '../src/payments.js';
import { TRANSFER_TOPIC } from '../src/chain.js';

export const settlerAcct = privateKeyToAccount(generatePrivateKey());
export const treasuryAcct = privateKeyToAccount(generatePrivateKey());
export const otherAcct = privateKeyToAccount(generatePrivateKey());
export const payerAcct = privateKeyToAccount(generatePrivateKey());
export const OTHER_TOKEN = '0x00000000000000000000000000000000000dEaD1';

export const baseEnv = () => ({
  TREASURY_ADDRESS: treasuryAcct.address, SETTLER_PRIVATE_KEY: generatePrivateKey(), CHALLENGE_SECRET: 'test-secret',
  UPSTREAM_KEY: 'afk_test', DB_PATH: ':memory:', PUBLIC_URL: 'http://gw.test', UPSTREAM_URL: 'http://upstream.test',
});

export function fakeChain(over = {}) {
  const c = {
    settlerAddress: settlerAcct.address,
    nonces: new Map(), balances: new Map(), receipts: new Map(),
    settled: [], simulateError: null, settleError: null, rpcDown: false,
    async permitNonce(o) { if (c.rpcDown) throw new Error('rpc down'); return c.nonces.get(o.toLowerCase()) ?? 0n; },
    async balanceOf(o) { return c.balances.get(o.toLowerCase()) ?? 10n ** 20n; },
    async simulatePermit() { if (c.simulateError) throw new Error(c.simulateError); },
    async settlePermit(p) {
      if (c.settleError) throw new Error(c.settleError);
      c.settled.push(p);
      c.nonces.set(p.owner.toLowerCase(), (c.nonces.get(p.owner.toLowerCase()) ?? 0n) + 1n);
      const n = c.settled.length.toString(16).padStart(62, '0');
      return { permitTx: `0xaa${n}`, transferTx: `0xbb${n}` };
    },
    async transferReceipt(h) { return c.receipts.get(h) ?? null; },
    ...over,
  };
  return c;
}

export function fakeUpstream() {
  const u = { mode: 'ok', calls: [], payload: { tool: 'sol_price', data: { symbol: 'SOL', usd: 142.5 } } };
  u.server = http.createServer((req, res) => {
    u.calls.push({ url: req.url, key: req.headers['x-agentfeed-key'] });
    if (u.mode === 'down') { res.writeHead(503); return res.end('{"error":"stale"}'); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(u.payload));
  });
  return new Promise((r) => u.server.listen(0, '127.0.0.1', () => { u.url = `http://127.0.0.1:${u.server.address().port}`; r(u); }));
}

export async function boot({ chain = fakeChain(), clock } = {}) {
  const up = await fakeUpstream();
  const cfg = loadConfig({ ...baseEnv(), UPSTREAM_URL: up.url });
  const store = openStore(':memory:');
  const t = { now: Math.floor(Date.now() / 1000) };
  const gw = createGateway({ cfg, chain, store, now: clock || (() => t.now) });
  await new Promise((r) => gw.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${gw.address().port}`;
  const close = () => { gw.closeAllConnections(); gw.close(); up.server.closeAllConnections(); up.server.close(); store.close(); };
  return { cfg, chain, store, up, gw, url, close, t };
}

export const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');

export async function challenge(url, route = 'sol-price', qs = '') {
  const r = await fetch(`${url}/api/${route}${qs}`);
  const body = await r.json();
  return { status: r.status, body, header: JSON.parse(Buffer.from(r.headers.get('payment-required'), 'base64').toString()) };
}

// A permit payment for the challenge. opts override single fields to build bad payments.
export async function permitPayment(ctx, ch, opts = {}) {
  const acct = opts.account || payerAcct;
  const accept = ch.body.accepts.find((a) => a.scheme === 'permit');
  const owner = acct.address;
  const value = opts.value ?? BigInt(accept.amount);
  const nonce = opts.permitNonce ?? (ctx.chain.nonces.get(owner.toLowerCase()) ?? 0n);
  const deadline = BigInt(opts.deadline ?? accept.extra.expiresAt);
  const spender = opts.spender || accept.extra.spender;
  const domain = { ...permitDomain(ctx.cfg), ...(opts.domain || {}) };
  const signature = await acct.signTypedData({ domain, types: PERMIT_TYPES, primaryType: 'Permit', message: { owner, spender, value, nonce, deadline } });
  return {
    x402Version: 2, scheme: 'permit', network: opts.network ?? accept.network, asset: opts.asset ?? accept.asset, payTo: opts.payTo ?? accept.payTo,
    amount: String(opts.declared ?? accept.amount), nonce: opts.challengeNonce ?? accept.extra.nonce,
    payload: { owner, spender, value: String(value), deadline: String(deadline), signature },
  };
}

const pad = (a) => `0x${'0'.repeat(24)}${a.slice(2).toLowerCase()}`;
export function addReceipt(ctx, hash, { from = payerAcct.address, to = ctx.cfg.treasury, value, token = ctx.cfg.musd.address, status = 'success', confirmations = 3, timestamp } = {}) {
  ctx.chain.receipts.set(hash, {
    status, from, confirmations, timestamp: timestamp ?? ctx.t.now + 1,
    logs: [{ address: token, topics: [TRANSFER_TOPIC, pad(from), pad(to)], data: `0x${BigInt(value).toString(16).padStart(64, '0')}` }],
  });
}

export async function transferPayment(ctx, ch, hash, opts = {}) {
  const accept = ch.body.accepts.find((a) => a.scheme === 'transfer');
  const acct = opts.account || payerAcct;
  const signature = await acct.signMessage({ message: claimMessage(accept.extra.nonce, hash) });
  return { x402Version: 2, scheme: 'transfer', network: accept.network, asset: accept.asset, payTo: accept.payTo, amount: accept.amount, nonce: accept.extra.nonce, payload: { txHash: hash, signature } };
}

export const pay = (ctx, route, payment, qs = '') => fetch(`${ctx.url}/api/${route}${qs}`, { headers: { 'payment-signature': b64(payment) } });
export { MUSD };

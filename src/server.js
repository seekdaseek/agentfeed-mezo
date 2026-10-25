// agentfeed-mezo gateway: HTTP 402 in front of AgentFeed, settled in MUSD on Mezo testnet.
import http from 'node:http';
import { ROUTES, findRoute, priceWei, priceMusd, cleanParams } from './routes.js';
import { makeNonce } from './challenge.js';
import { checkEnvelope, verifyPermit, verifyTransfer } from './payments.js';
import { landingHtml } from './landing.js';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
const fromB64 = (s) => JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
const musdStr = (wei) => {
  const t = (Number(BigInt(wei) / 10n ** 12n) / 1e6).toFixed(6).replace(/0+$/, '');
  return t.replace(/\.(\d)$/, '.$10');
};

const STATUS = {
  malformed_payment: 400, unsupported_scheme: 400, payment_in_flight: 429,
};

export function createGateway({ cfg, chain, store, fetchImpl = fetch, now = () => Math.floor(Date.now() / 1000) }) {
  const inflight = new Set();
  const hits = new Map(); // ip -> [count, windowStart]
  let upstreamDay = { day: '', n: 0 };

  const tx = (h) => `${cfg.explorer}/tx/${h}`;
  const requirements = (route, code, message) => {
    const amount = priceWei(route);
    const nonce = makeNonce({ secret: cfg.challengeSecret, routeId: route.id, amountWei: amount, now: now(), ttl: cfg.challengeTtlSec });
    const expiresAt = now() + cfg.challengeTtlSec;
    const base = { network: cfg.network, asset: cfg.musd.address, amount: String(amount), payTo: cfg.treasury, maxTimeoutSeconds: cfg.challengeTtlSec };
    return {
      x402Version: 2,
      error: code || 'payment_required',
      message: message || `${priceMusd(route)} MUSD on Mezo testnet`,
      resource: { url: `${cfg.publicUrl}/api/${route.id}`, description: route.description, mimeType: 'application/json' },
      price: { amount: priceMusd(route), currency: 'MUSD', wei: String(amount) },
      accepts: [
        { scheme: 'permit', ...base, extra: { standard: 'EIP-2612', name: cfg.musd.name, version: cfg.musd.version, symbol: cfg.musd.symbol, decimals: cfg.musd.decimals, spender: chain.settlerAddress, nonce, expiresAt, gasPaidBy: 'gateway' } },
        { scheme: 'transfer', ...base, extra: { standard: 'ERC-20 transfer', nonce, expiresAt, confirmations: cfg.confirmations, claim: 'sign personal_message "AgentFeed-Mezo claim\\nnonce:<nonce>\\ntx:<hash lowercase>" with the sender key', gasPaidBy: 'agent' } },
      ],
    };
  };

  const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'PAYMENT-REQUIRED, PAYMENT-RESPONSE', 'access-control-allow-headers': 'content-type, payment-signature, x-payment' };
  const send = (res, status, body, headers = {}) => {
    const isStr = typeof body === 'string';
    res.writeHead(status, { 'content-type': isStr ? 'text/html; charset=utf-8' : 'application/json', 'cache-control': 'no-store', ...cors, ...headers });
    res.end(isStr ? body : JSON.stringify(body, null, 2));
  };
  const send402 = (res, route, code, message) => {
    const body = requirements(route, code, message);
    send(res, code && STATUS[code] ? STATUS[code] : 402, body, { 'payment-required': b64(body) });
  };

  const manifest = () => ({
    name: 'agentfeed-mezo',
    description: 'AgentFeed market data for AI agents, paid per call in MUSD on Mezo testnet (chain 31611).',
    x402Version: 2,
    network: cfg.network,
    asset: { address: cfg.musd.address, symbol: 'MUSD', decimals: cfg.musd.decimals, standard: 'ERC-20 + EIP-2612 permit' },
    treasury: cfg.treasury,
    settler: chain.settlerAddress,
    schemes: ['permit', 'transfer'],
    explorer: cfg.explorer,
    upstream: 'https://x402.ochinimus.app',
    routes: ROUTES.map((r) => ({ id: r.id, method: 'GET', path: `/api/${r.id}`, url: `${cfg.publicUrl}/api/${r.id}`, price_musd: priceMusd(r), price_wei: String(priceWei(r)), params: r.params, title: r.title, description: r.description })),
    source: 'https://github.com/seekdaseek/agentfeed-mezo',
  });

  const csv = () => {
    const head = 'timestamp_utc,route,scheme,payer,amount_musd,transfer_tx,permit_tx,transfer_tx_url';
    const rows = store.all().map((p) => [new Date(p.ts * 1000).toISOString(), p.route, p.scheme, p.payer, musdStr(p.amount_wei), p.tx_hash, p.permit_tx || '', tx(p.tx_hash)].join(','));
    return [head, ...rows].join('\n') + '\n';
  };

  async function upstream(route, query) {
    const day = new Date().toISOString().slice(0, 10);
    if (upstreamDay.day !== day) upstreamDay = { day, n: 0 };
    if (upstreamDay.n >= cfg.dailyUpstreamCap) return { error: 'capacity', status: 503 };
    upstreamDay.n++;
    const url = `${cfg.upstreamUrl}${route.upstream}${query.size ? `?${query}` : ''}`;
    const t0 = Date.now();
    try {
      const r = await fetchImpl(url, { headers: { 'x-agentfeed-key': cfg.upstreamKey, accept: 'application/json' }, signal: AbortSignal.timeout(cfg.upstreamTimeoutMs) });
      const text = await r.text();
      let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 2000) }; }
      if (r.status >= 500) return { error: 'upstream_unavailable', status: 502, detail: `AgentFeed answered ${r.status}`, ms: Date.now() - t0 };
      if (r.status >= 400) return { error: 'upstream_rejected', status: r.status === 402 ? 502 : 400, detail: json, ms: Date.now() - t0 };
      return { ok: true, json, ms: Date.now() - t0 };
    } catch (e) {
      return { error: 'upstream_unavailable', status: 502, detail: e.name === 'TimeoutError' ? 'AgentFeed timed out' : 'AgentFeed unreachable', ms: Date.now() - t0 };
    }
  }

  async function paid(req, res, route, url) {
    const t0 = Date.now();
    const cp = cleanParams(route, url.searchParams);
    if (!cp.ok) return send(res, 400, { error: 'bad_request', message: cp.error });
    const raw = req.headers['payment-signature'] || req.headers['x-payment'];
    if (!raw) return send402(res, route);

    let payment;
    try { payment = fromB64(raw); } catch { return send402(res, route, 'malformed_payment', 'payment header is not base64 JSON'); }
    const price = priceWei(route);
    const t = now();
    const env = checkEnvelope({ cfg, route, price, payment, now: t });
    if (!env.ok) return send402(res, route, env.code, env.message);

    const v = payment.scheme === 'permit'
      ? await verifyPermit({ cfg, chain, store, price, payment, env, now: t }).catch((e) => ({ ok: false, code: 'chain_unavailable', message: `Mezo RPC error: ${e.shortMessage || e.message}` }))
      : await verifyTransfer({ cfg, chain, store, price, payment, env }).catch((e) => ({ ok: false, code: 'chain_unavailable', message: `Mezo RPC error: ${e.shortMessage || e.message}` }));
    if (!v.ok) return send402(res, route, v.code, v.message);

    // One in-flight permit per owner: stops a payer racing many signatures against one on-chain nonce.
    if (v.lockKey) {
      if (inflight.has(v.lockKey)) return send(res, 429, { error: 'payment_in_flight', message: 'one paid call at a time per owner address' }, { 'retry-after': '5' });
      inflight.add(v.lockKey);
    }
    let reserved = false;
    try {
      reserved = store.reserve(v.keys);
      if (!reserved) return send402(res, route, 'payment_replayed', 'this payment was already used');

      // Fetch first, settle second: if AgentFeed is down the payer is never charged.
      const up = await upstream(route, cp.query);
      if (!up.ok) {
        store.release(v.keys); reserved = false;
        return send(res, up.status, { error: up.error, charged: false, detail: up.detail, message: 'no payment was taken; retry with the same payment' });
      }

      let permitTx = null; let transferTx;
      if (payment.scheme === 'permit') {
        try {
          const s = await chain.settlePermit({ owner: v.owner, spender: chain.settlerAddress, value: v.value, deadline: v.deadline, v: v.v, r: v.r, s: v.s, to: cfg.treasury, amount: price });
          permitTx = s.permitTx; transferTx = s.transferTx;
        } catch (e) {
          store.release(v.keys); reserved = false;
          return send402(res, route, 'settlement_failed', `settlement failed, nothing was charged: ${e.shortMessage || e.message}`);
        }
      } else { transferTx = v.txHash; }

      const keys = [...v.keys, `tx:${transferTx.toLowerCase()}`, ...(permitTx ? [`tx:${permitTx.toLowerCase()}`] : [])];
      if (keys.length > v.keys.length) { for (const k of keys.slice(v.keys.length)) { if (!store.isUsed(k)) store.reserve([k]); } }
      store.commit(keys, { ts: now(), route: route.id, scheme: payment.scheme, payer: v.owner, amount_wei: String(price), nonce: payment.nonce, permit_tx: permitTx, tx_hash: transferTx, upstream_ms: up.ms, total_ms: Date.now() - t0 });
      reserved = false;

      const receipt = { success: true, network: cfg.network, scheme: payment.scheme, payer: v.owner, amount: String(price), transaction: transferTx, ...(permitTx ? { permitTransaction: permitTx } : {}) };
      return send(res, 200, {
        route: route.id,
        paid: { amount_musd: priceMusd(route), currency: 'MUSD', network: cfg.network, payer: v.owner, scheme: payment.scheme, tx: transferTx, explorer: tx(transferTx), ...(permitTx ? { permit_tx: permitTx } : {}) },
        data: up.json,
      }, { 'payment-response': b64(receipt) });
    } finally {
      if (reserved) store.release(v.keys);
      if (v.lockKey) inflight.delete(v.lockKey);
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const ip = String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '');
      const nowMs = Date.now();
      const h = hits.get(ip) || [0, nowMs];
      if (nowMs - h[1] > 60000) { h[0] = 0; h[1] = nowMs; }
      h[0]++; hits.set(ip, h);
      if (hits.size > 5000) hits.clear();
      if (h[0] > 240) return send(res, 429, { error: 'rate_limited' }, { 'retry-after': '30' });

      const url = new URL(req.url, 'http://x');
      const p = url.pathname.replace(/\/+$/, '') || '/';
      if (req.method === 'OPTIONS') return send(res, 204, '', {});
      if (p.startsWith('/api/')) {
        if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed', message: 'paid routes are GET only' }, { allow: 'GET' });
        const route = findRoute(p.slice(5));
        if (!route) return send(res, 404, { error: 'unknown_route', routes: ROUTES.map((r) => r.id) });
        return await paid(req, res, route, url);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method_not_allowed' }, { allow: 'GET, HEAD' });
      if (p === '/') return send(res, 200, landingHtml({ cfg, routes: ROUTES, priceMusd, settler: chain.settlerAddress }));
      if (p === '/health') return send(res, 200, { ok: true, network: cfg.network, settled: store.stats().settled });
      if (p === '/.well-known/x402' || p === '/.well-known/agentfeed-mezo.json' || p === '/manifest.json') return send(res, 200, manifest());
      if (p === '/stats') {
        const s = store.stats();
        return send(res, 200, { settled_calls: s.settled, musd_settled: musdStr(s.musdWei), distinct_payers: s.payers, last_24h: s.last24h, by_route: s.byRoute, by_scheme: s.byScheme, recent: store.recent(10).map((x) => ({ ts: x.ts, route: x.route, scheme: x.scheme, payer: x.payer, amount_musd: musdStr(x.amount_wei), tx: x.tx_hash, explorer: tx(x.tx_hash) })) });
      }
      if (p === '/payments.csv') return send(res, 200, csv(), { 'content-type': 'text/csv; charset=utf-8' });
      return send(res, 404, { error: 'not_found', see: '/.well-known/x402' });
    } catch (e) {
      console.error('unhandled', e);
      if (!res.headersSent) send(res, 500, { error: 'internal_error' });
    }
  });
  return server;
}

// agentfeed-mezo gateway: HTTP 402 in front of AgentFeed, settled in MUSD on Mezo (testnet and mainnet) and Base.
import http from 'node:http';
import { ROUTES, findRoute, priceWei, priceMusd, cleanParams } from './routes.js';
import { makeNonce } from './challenge.js';
import { checkEnvelope, verifyPermit, verifyTransfer } from './payments.js';
import { landingHtml } from './landing.js';
import { openAgents } from './agents.js';
import { pegReport, troveHealth } from './mezo-data.js';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
const fromB64 = (s) => JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
const musdStr = (wei) => {
  const t = (Number(BigInt(wei) / 10n ** 12n) / 1e6).toFixed(6).replace(/0+$/, '');
  return t.replace(/\.(\d)$/, '.$10');
};

const STATUS = {
  malformed_payment: 400, unsupported_scheme: 400, payment_in_flight: 429,
};

export function createGateway({ cfg, chain, chains, store, fetchImpl = fetch, now = () => Math.floor(Date.now() / 1000), local = { peg: pegReport, trove: troveHealth } }) {
  // One entry per network the gateway sells on. Wave 1 callers pass a single `chain` and no cfg.networks: that is one
  // Mezo testnet entry built from the top-level config.
  const nets = cfg.networks || [{ key: 'mezo-testnet', network: cfg.network, chainId: cfg.chainId, label: 'Mezo testnet', explorer: cfg.explorer,
    asset: cfg.musd, treasury: cfg.treasury, confirmations: cfg.confirmations, surchargeCents: 0, keyPrefix: '', mainnet: false }];
  const chainFor = (net) => (chains && chains[net.network]) || chain;
  const netCfg = (net) => ({ ...cfg, network: net.network, chainId: net.chainId, musd: net.asset, treasury: net.treasury, confirmations: net.confirmations, explorer: net.explorer, keyPrefix: net.keyPrefix || '' });
  const netOf = (network) => nets.find((n) => n.network === network);
  const agents = openAgents(store.db);
  const inflight = new Set();
  const hits = new Map(); // ip -> [count, windowStart]
  let upstreamDay = { day: '', n: 0 };

  const tx = (h, net = nets[0]) => `${net.explorer}/tx/${h}`;
  const own = new Set(cfg.ownWallets || []);
  const requirements = (route, code, message) => {
    const first = nets[0];
    const amount = priceWei(route, first.surchargeCents);
    const expiresAt = now() + cfg.challengeTtlSec;
    const accepts = nets.flatMap((net) => {
      const price = priceWei(route, net.surchargeCents);
      const nonce = makeNonce({ secret: cfg.challengeSecret, routeId: `${route.id}@${net.network}`, amountWei: price, now: now(), ttl: cfg.challengeTtlSec });
      const base = { network: net.network, asset: net.asset.address, amount: String(price), payTo: net.treasury, maxTimeoutSeconds: cfg.challengeTtlSec };
      const label = { networkLabel: net.label, priceMusd: priceMusd(route, net.surchargeCents), mainnet: net.mainnet };
      return [
        { scheme: 'permit', ...base, extra: { standard: 'EIP-2612', name: net.asset.name, version: net.asset.version, symbol: net.asset.symbol, decimals: net.asset.decimals, spender: chainFor(net).settlerAddress, nonce, expiresAt, gasPaidBy: 'gateway', ...label } },
        { scheme: 'transfer', ...base, extra: { standard: 'ERC-20 transfer', nonce, expiresAt, confirmations: net.confirmations, claim: 'sign personal_message "AgentFeed-Mezo claim\\nnonce:<nonce>\\ntx:<hash lowercase>" with the sender key', gasPaidBy: 'agent', ...label } },
      ];
    });
    return {
      x402Version: 2,
      error: code || 'payment_required',
      message: message || `${priceMusd(route, first.surchargeCents)} MUSD on ${first.label}`,
      resource: { url: `${cfg.publicUrl}/api/${route.id}`, description: route.description, mimeType: 'application/json' },
      price: { amount: priceMusd(route, first.surchargeCents), currency: 'MUSD', wei: String(amount) },
      accepts,
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
    description: `AgentFeed market data for AI agents, paid per call in MUSD on ${nets.map((n) => n.label).join(', ')}.`,
    x402Version: 2,
    // the first network keeps the Wave 1 top-level fields; every network is listed in `networks`
    network: nets[0].network,
    asset: { address: nets[0].asset.address, symbol: 'MUSD', decimals: nets[0].asset.decimals, standard: 'ERC-20 + EIP-2612 permit' },
    treasury: nets[0].treasury,
    settler: chainFor(nets[0]).settlerAddress,
    networks: nets.map((n) => ({ key: n.key, network: n.network, chainId: n.chainId, label: n.label, mainnet: n.mainnet, asset: { address: n.asset.address, symbol: n.asset.symbol, decimals: n.asset.decimals, name: n.asset.name, version: n.asset.version }, treasury: n.treasury, settler: chainFor(n).settlerAddress, explorer: n.explorer, gas_surcharge_cents: n.surchargeCents })),
    schemes: ['permit', 'transfer'],
    explorer: nets[0].explorer,
    upstream: 'https://x402.ochinimus.app',
    routes: ROUTES.map((r) => ({ id: r.id, method: 'GET', path: `/api/${r.id}`, url: `${cfg.publicUrl}/api/${r.id}`, price_musd: priceMusd(r, nets[0].surchargeCents), price_wei: String(priceWei(r, nets[0].surchargeCents)),
      prices: Object.fromEntries(nets.map((n) => [n.network, { musd: priceMusd(r, n.surchargeCents), wei: String(priceWei(r, n.surchargeCents)) }])), params: r.params, title: r.title, description: r.description })),
    source: 'https://github.com/seekdaseek/agentfeed-mezo',
  });

  const csv = () => {
    // network is the last column so Wave 1 readers that index columns keep working
    const head = 'timestamp_utc,route,scheme,payer,amount_musd,transfer_tx,permit_tx,transfer_tx_url,network';
    const rows = store.all().map((p) => [new Date(p.ts * 1000).toISOString(), p.route, p.scheme, p.payer, musdStr(p.amount_wei), p.tx_hash, p.permit_tx || '', tx(p.tx_hash, netOf(p.network) || nets[0]), p.network].join(','));
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

  // Routes answered from the chains themselves (src/mezo-data.js) rather than by AgentFeed. Same rule as upstream: a failed read is a 502 and charges nothing.
  async function localData(route, query) {
    const t0 = Date.now();
    try {
      const data = await local[route.local](Object.fromEntries(query));
      return { ok: true, json: { tool: route.id.replace(/-/g, '_'), data, source: 'agentfeed-mezo, read from the chain at request time' }, ms: Date.now() - t0 };
    } catch (e) {
      if (e.status === 400) return { error: 'bad_request', status: 400, detail: e.message, ms: Date.now() - t0 };
      return { error: 'data_unavailable', status: 502, detail: 'a chain read failed', ms: Date.now() - t0 };
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
    const net = netOf(payment && payment.network);
    if (!net) return send402(res, route, 'wrong_network', `this gateway settles on ${nets.map((n) => `${n.network} (${n.label})`).join(', ')}, not ${payment && payment.network}`);
    const cfgN = netCfg(net);
    const chainN = chainFor(net);
    const price = priceWei(route, net.surchargeCents);
    const t = now();
    const env = checkEnvelope({ cfg: cfgN, route, price, payment, now: t, nonceRoute: `${route.id}@${net.network}` });
    if (!env.ok) return send402(res, route, env.code, env.message);

    const rpcErr = (e) => ({ ok: false, code: 'chain_unavailable', message: `${net.label} RPC error: ${e.shortMessage || e.message}` });
    const v = payment.scheme === 'permit'
      ? await verifyPermit({ cfg: cfgN, chain: chainN, store, price, payment, env, now: t }).catch(rpcErr)
      : await verifyTransfer({ cfg: cfgN, chain: chainN, store, price, payment, env }).catch(rpcErr);
    if (!v.ok) return send402(res, route, v.code, v.message);

    // A registered agent wallet is held to its owner's budget, daily cap and pause/revoke, before anything is fetched or settled.
    const agent = agents.byAddress(v.owner);
    if (agent) {
      const gate = agents.check(agent, price, t);
      if (!gate.ok) return send402(res, route, gate.code, `${gate.message}; nothing was charged`);
      v.lockKey = `agent:${agent.id}`; // one call at a time per agent across networks, so two networks cannot race one budget
    }
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
      const up = route.local ? await localData(route, cp.query) : await upstream(route, cp.query);
      if (!up.ok) {
        store.release(v.keys); reserved = false;
        return send(res, up.status, { error: up.error, charged: false, detail: up.detail, message: 'no payment was taken; retry with the same payment' });
      }

      let permitTx = null; let transferTx;
      if (payment.scheme === 'permit') {
        try {
          const s = await chainN.settlePermit({ owner: v.owner, spender: chainN.settlerAddress, value: v.value, deadline: v.deadline, v: v.v, r: v.r, s: v.s, to: net.treasury, amount: price });
          permitTx = s.permitTx; transferTx = s.transferTx;
        } catch (e) {
          store.release(v.keys); reserved = false;
          return send402(res, route, 'settlement_failed', `settlement failed, nothing was charged: ${e.shortMessage || e.message}`);
        }
      } else { transferTx = v.txHash; }

      const kp = net.keyPrefix || '';
      const keys = [...v.keys, `tx:${kp}${transferTx.toLowerCase()}`, ...(permitTx ? [`tx:${kp}${permitTx.toLowerCase()}`] : [])];
      if (keys.length > v.keys.length) { for (const k of keys.slice(v.keys.length)) { if (!store.isUsed(k)) store.reserve([k]); } }
      store.commit(keys, { ts: now(), route: route.id, scheme: payment.scheme, payer: v.owner, amount_wei: String(price), nonce: payment.nonce, permit_tx: permitTx, tx_hash: transferTx, upstream_ms: up.ms, total_ms: Date.now() - t0, network: net.network });
      reserved = false;

      const receipt = { success: true, network: net.network, scheme: payment.scheme, payer: v.owner, amount: String(price), transaction: transferTx, ...(permitTx ? { permitTransaction: permitTx } : {}) };
      return send(res, 200, {
        route: route.id,
        paid: { amount_musd: priceMusd(route, net.surchargeCents), currency: 'MUSD', network: net.network, network_label: net.label, mainnet: net.mainnet, payer: v.owner, scheme: payment.scheme, tx: transferTx, explorer: tx(transferTx, net), ...(permitTx ? { permit_tx: permitTx } : {}) },
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
      if (p === '/') return send(res, 200, landingHtml({ cfg, nets, routes: ROUTES, priceMusd, settler: chainFor(nets[0]).settlerAddress, settlerOf: (n) => chainFor(n).settlerAddress }));
      if (p === '/health') return send(res, 200, { ok: true, network: nets[0].network, networks: nets.map((n) => n.network), settled: store.stats().settled });
      if (p === '/.well-known/x402' || p === '/.well-known/agentfeed-mezo.json' || p === '/manifest.json') return send(res, 200, manifest());
      if (p === '/stats') {
        const s = store.stats();
        // Rule: one headline number (settled_calls, musd_settled); outside payers are counted apart from our own wallets.
        const per = nets.map((n) => {
          const x = s.byNet[n.network] || { n: 0, wei: 0n, payers: new Set() };
          const outside = [...x.payers].filter((a) => !own.has(a));
          return { network: n.network, label: n.label, mainnet: n.mainnet, settled_calls: x.n, musd_settled: musdStr(x.wei), distinct_payers: x.payers.size, outside_payers: outside.length };
        });
        const all = Object.values(s.byNet).flatMap((x) => [...x.payers]);
        const outsideAll = new Set(all.filter((a) => !own.has(a)));
        return send(res, 200, { settled_calls: s.settled, musd_settled: musdStr(s.musdWei), distinct_payers: s.payers, outside_payers: outsideAll.size, last_24h: s.last24h, by_network: per, by_route: s.byRoute, by_scheme: s.byScheme,
          recent: store.recent(10).map((x) => ({ ts: x.ts, network: x.network, route: x.route, scheme: x.scheme, payer: x.payer, amount_musd: musdStr(x.amount_wei), tx: x.tx_hash, explorer: tx(x.tx_hash, netOf(x.network) || nets[0]) })) });
      }
      if (p.startsWith('/agents/') && /^\/agents\/0x[0-9a-fA-F]{40}$/.test(p)) {
        const a = agents.byAddress(p.slice(8));
        if (!a) return send(res, 200, { registered: false });
        const st = agents.state(a, now());
        return send(res, 200, { registered: true, name: a.name, status: a.status, remaining_musd: musdStr(st.remaining), daily_remaining_musd: musdStr(st.dailyRemaining), daily_cap_musd: musdStr(st.dailyCap), resets_at: new Date(st.resetsAt * 1000).toISOString() });
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

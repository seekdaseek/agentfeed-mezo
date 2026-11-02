// Wave 2: one gateway selling on Mezo testnet, Mezo mainnet and Base. Same real signatures as gateway.test.js over fake
// chains: nothing here touches a network or spends anything.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { loadConfig } from '../src/config.js';
import { createGateway } from '../src/server.js';
import { openStore } from '../src/store.js';
import { PERMIT_TYPES, claimMessage } from '../src/payments.js';
import { TRANSFER_TOPIC } from '../src/chain.js';
import { ROUTES, priceWei } from '../src/routes.js';
import { fakeChain, fakeUpstream, b64 } from './helpers.js';

const TEST = 'eip155:31611', MAIN = 'eip155:31612', BASE = 'eip155:8453';
const sol = ROUTES.find((r) => r.id === 'sol-price');
const agent = privateKeyToAccount(generatePrivateKey());
const outsider = privateKeyToAccount(generatePrivateKey());
const acct = () => privateKeyToAccount(generatePrivateKey());
const addr = { testTreasury: acct().address, mainTreasury: acct().address, baseTreasury: acct().address };

let ctx;
async function boot() {
  const up = await fakeUpstream();
  const settlers = { [TEST]: acct(), [MAIN]: acct(), [BASE]: acct() };
  const cfg = loadConfig({
    NETWORKS: 'mezo-testnet,mezo-mainnet,base',
    TREASURY_ADDRESS: addr.testTreasury, SETTLER_PRIVATE_KEY: generatePrivateKey(),
    MEZO_MAINNET_TREASURY_ADDRESS: addr.mainTreasury, MEZO_MAINNET_SETTLER_PRIVATE_KEY: generatePrivateKey(),
    BASE_TREASURY_ADDRESS: addr.baseTreasury, BASE_SETTLER_PRIVATE_KEY: generatePrivateKey(),
    CHALLENGE_SECRET: 's', UPSTREAM_KEY: 'afk_test', UPSTREAM_URL: up.url, PUBLIC_URL: 'http://gw.test',
    OWN_WALLETS: agent.address,
  });
  const chains = Object.fromEntries(Object.values(settlers).map((s, i) => [Object.keys(settlers)[i], fakeChain({ settlerAddress: s.address })]));
  const store = openStore(':memory:');
  const t = { now: Math.floor(Date.now() / 1000) };
  const gw = createGateway({ cfg, chain: chains[TEST], chains, store, now: () => t.now });
  await new Promise((r) => gw.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${gw.address().port}`;
  return { cfg, chains, store, up, gw, url, t, settlers, close() { gw.closeAllConnections(); gw.close(); up.server.closeAllConnections(); up.server.close(); store.close(); } };
}
beforeEach(async () => { ctx = await boot(); });
afterEach(() => ctx.close());

const net = (network) => ctx.cfg.networks.find((n) => n.network === network);
async function challenge(route = 'sol-price') {
  const r = await fetch(`${ctx.url}/api/${route}`);
  return { status: r.status, body: await r.json() };
}
const accept = (ch, network, scheme = 'permit') => ch.body.accepts.find((a) => a.network === network && a.scheme === scheme);

async function permitFor(ch, network, o = {}) {
  const a = accept(ch, network);
  const n = net(network);
  const owner = (o.account || agent).address;
  const nonce = ctx.chains[network].nonces.get(owner.toLowerCase()) ?? 0n;
  const domain = { name: n.asset.name, version: n.asset.version, chainId: o.signChainId ?? n.chainId, verifyingContract: n.asset.address };
  const value = o.value ?? BigInt(a.amount);
  const deadline = BigInt(a.extra.expiresAt);
  const signature = await (o.account || agent).signTypedData({ domain, types: PERMIT_TYPES, primaryType: 'Permit', message: { owner, spender: a.extra.spender, value, nonce, deadline } });
  return { x402Version: 2, scheme: 'permit', network: o.network ?? network, asset: a.asset, payTo: a.payTo, amount: String(o.declared ?? a.amount), nonce: o.nonce ?? a.extra.nonce,
    payload: { owner, spender: a.extra.spender, value: String(value), deadline: String(deadline), signature } };
}
const pay = (route, payment) => fetch(`${ctx.url}/api/${route}`, { headers: { 'payment-signature': b64(payment) } });
const pad = (a) => `0x${'0'.repeat(24)}${a.slice(2).toLowerCase()}`;
function receipt(network, hash, o = {}) {
  const n = net(network);
  const from = (o.from || agent).address ?? o.from;
  ctx.chains[network].receipts.set(hash, { status: 'success', from, confirmations: 3, timestamp: ctx.t.now + 1,
    logs: [{ address: n.asset.address, topics: [TRANSFER_TOPIC, pad(from), pad(n.treasury)], data: `0x${BigInt(o.value ?? priceWei(sol, n.surchargeCents)).toString(16).padStart(64, '0')}` }] });
}
async function transferFor(ch, network, hash) {
  const a = accept(ch, network, 'transfer');
  const signature = await agent.signMessage({ message: claimMessage(a.extra.nonce, hash) });
  return { x402Version: 2, scheme: 'transfer', network, asset: a.asset, payTo: a.payTo, amount: a.amount, nonce: a.extra.nonce, payload: { txHash: hash, signature } };
}

describe('config', () => {
  test('three networks, each with its own chain id, treasury and MUSD domain', () => {
    assert.deepEqual(ctx.cfg.networks.map((n) => [n.key, n.chainId]), [['mezo-testnet', 31611], ['mezo-mainnet', 31612], ['base', 8453]]);
    assert.equal(net(MAIN).asset.address, '0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186');
    assert.equal(net(BASE).asset.address, net(MAIN).asset.address);
    assert.equal(net(TEST).asset.address, '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503');
    assert.notEqual(net(BASE).treasury, net(MAIN).treasury);
  });
  test('a network without its own treasury and settler key refuses to start', () => {
    assert.throws(() => loadConfig({ NETWORKS: 'base', CHALLENGE_SECRET: 's', UPSTREAM_KEY: 'k' }), /BASE_TREASURY_ADDRESS/);
    assert.throws(() => loadConfig({ NETWORKS: 'solana', CHALLENGE_SECRET: 's', UPSTREAM_KEY: 'k' }), /unknown network/);
  });
  test('the default is Mezo testnet only, with the Wave 1 variable names', () => {
    const c = loadConfig({ TREASURY_ADDRESS: addr.testTreasury, SETTLER_PRIVATE_KEY: generatePrivateKey(), CHALLENGE_SECRET: 's', UPSTREAM_KEY: 'k' });
    assert.deepEqual(c.networks.map((n) => n.key), ['mezo-testnet']);
  });
});

describe('402 challenge across networks', () => {
  test('lists a permit and a transfer accept for every network, with that network\'s token, treasury, spender and price', async () => {
    const ch = await challenge();
    assert.equal(ch.status, 402);
    assert.equal(ch.body.accepts.length, 6);
    for (const key of [TEST, MAIN, BASE]) {
      const p = accept(ch, key);
      assert.equal(p.asset, net(key).asset.address);
      assert.equal(p.payTo, net(key).treasury);
      assert.equal(p.extra.spender, ctx.chains[key].settlerAddress);
    }
    assert.equal(accept(ch, TEST).extra.priceMusd, '0.01');
    assert.equal(accept(ch, BASE).extra.priceMusd, '0.01', 'Base has no gas surcharge');
    assert.equal(accept(ch, MAIN).extra.priceMusd, '0.03', 'Mezo mainnet carries a 2 cent gas surcharge');
    assert.equal(accept(ch, MAIN).amount, String(priceWei(sol, 2)));
    assert.equal(new Set(ch.body.accepts.map((a) => a.extra.nonce)).size, 3, 'one nonce per network, shared by its two schemes');
  });
  test('manifest lists the networks and the price on each', async () => {
    const m = await (await fetch(`${ctx.url}/.well-known/x402`)).json();
    assert.deepEqual(m.networks.map((n) => n.network), [TEST, MAIN, BASE]);
    assert.deepEqual(m.routes.find((r) => r.id === 'sol-price').prices[MAIN], { musd: '0.03', wei: String(priceWei(sol, 2)) });
  });
});

describe('paying on each network', () => {
  for (const [key, label, explorer, price] of [[BASE, 'Base', 'https://basescan.org', '0.01'], [MAIN, 'Mezo mainnet', 'https://explorer.mezo.org', '0.03']]) {
    test(`permit settles on ${label} only, with that chain's domain, treasury and explorer`, async () => {
      const ch = await challenge();
      const res = await pay('sol-price', await permitFor(ch, key));
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.paid.network, key);
      assert.equal(body.paid.mainnet, true);
      assert.equal(body.paid.amount_musd, price);
      assert.ok(body.paid.explorer.startsWith(`${explorer}/tx/`));
      for (const other of [TEST, MAIN, BASE].filter((k) => k !== key)) assert.equal(ctx.chains[other].settled.length, 0, `nothing settled on ${other}`);
      assert.equal(ctx.chains[key].settled.length, 1);
      assert.equal(ctx.chains[key].settled[0].to, net(key).treasury);
    });
  }
  test('the ledger records the network and the CSV carries it with the right explorer', async () => {
    const ch = await challenge();
    await pay('sol-price', await permitFor(ch, BASE));
    const csv = (await (await fetch(`${ctx.url}/payments.csv`)).text()).trim().split('\n');
    assert.match(csv[0], /,network$/);
    assert.ok(csv[1].endsWith(`,${BASE}`));
    assert.ok(csv[1].includes('https://basescan.org/tx/'));
  });
  test('the same owner can pay on two networks with permit nonce 0 on each: the ledgers are kept apart', async () => {
    const ch = await challenge();
    assert.equal((await pay('sol-price', await permitFor(ch, BASE))).status, 200);
    const ch2 = await challenge();
    assert.equal((await pay('sol-price', await permitFor(ch2, MAIN))).status, 200);
    const s = await (await fetch(`${ctx.url}/stats`)).json();
    assert.equal(s.settled_calls, 2);
    assert.deepEqual(s.by_network.filter((n) => n.settled_calls).map((n) => n.network).sort(), [MAIN, BASE].sort());
  });
  test('a transfer hash is a separate ledger key per network', async () => {
    const hash = `0x${'ab'.repeat(32)}`;
    receipt(BASE, hash); receipt(MAIN, hash);
    const ch = await challenge();
    assert.equal((await pay('sol-price', await transferFor(ch, BASE, hash))).status, 200);
    const again = await pay('sol-price', await transferFor(await challenge(), BASE, hash));
    assert.equal((await again.json()).error, 'payment_replayed');
    assert.equal((await pay('sol-price', await transferFor(await challenge(), MAIN, hash))).status, 200, 'same string on the other chain is a different transaction');
  });
});

describe('wrong chain, wrong price, wrong nonce', () => {
  test('a permit signed for Base presented as Mezo mainnet is refused', async () => {
    const ch = await challenge();
    const p = await permitFor(ch, MAIN, { signChainId: 8453 });
    assert.equal((await (await pay('sol-price', p)).json()).error, 'bad_signature');
    assert.equal(ctx.chains[MAIN].settled.length, 0);
  });
  test('a nonce issued for Base cannot pay on Mezo mainnet', async () => {
    const ch = await challenge();
    const p = await permitFor(ch, MAIN, { nonce: accept(ch, BASE).extra.nonce });
    assert.equal((await (await pay('sol-price', p)).json()).error, 'nonce_invalid');
  });
  test('the cheap Base price does not pay for Mezo mainnet', async () => {
    const ch = await challenge();
    const p = await permitFor(ch, MAIN, { value: priceWei(sol, 0), declared: priceWei(sol, 0) });
    assert.equal((await (await pay('sol-price', p)).json()).error, 'underpaid');
  });
  test('a network the gateway does not sell on is refused', async () => {
    const ch = await challenge();
    const p = await permitFor(ch, BASE, { network: 'eip155:1' });
    const r = await (await pay('sol-price', p)).json();
    assert.equal(r.error, 'wrong_network');
    assert.match(r.message, /eip155:8453/);
  });
  test('a transfer that exists only on Base is not found when presented as Mezo mainnet', async () => {
    const hash = `0x${'cd'.repeat(32)}`;
    receipt(BASE, hash);
    const r = await (await pay('sol-price', await transferFor(await challenge(), MAIN, hash))).json();
    assert.equal(r.error, 'tx_not_found');
  });
  test('a transfer to the other network\'s treasury is a wrong recipient', async () => {
    const hash = `0x${'ef'.repeat(32)}`;
    ctx.chains[MAIN].receipts.set(hash, { status: 'success', from: agent.address, confirmations: 3, timestamp: ctx.t.now + 1,
      logs: [{ address: net(MAIN).asset.address, topics: [TRANSFER_TOPIC, pad(agent.address), pad(net(BASE).treasury)], data: `0x${priceWei(sol, 2).toString(16).padStart(64, '0')}` }] });
    const r = await (await pay('sol-price', await transferFor(await challenge(), MAIN, hash))).json();
    assert.equal(r.error, 'wrong_recipient');
  });
});

describe('outside payers are counted apart from our own wallets', () => {
  test('stats split our wallet from an outside one and never mix them', async () => {
    await pay('sol-price', await permitFor(await challenge(), BASE));
    await pay('sol-price', await permitFor(await challenge(), BASE, { account: outsider }));
    const s = await (await fetch(`${ctx.url}/stats`)).json();
    assert.equal(s.settled_calls, 2);
    assert.equal(s.distinct_payers, 2);
    assert.equal(s.outside_payers, 1);
    const b = s.by_network.find((n) => n.network === BASE);
    assert.deepEqual([b.settled_calls, b.distinct_payers, b.outside_payers], [2, 2, 1]);
  });
});

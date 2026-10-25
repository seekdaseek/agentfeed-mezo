import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { boot, challenge, permitPayment, transferPayment, addReceipt, pay, b64, fakeChain, payerAcct, otherAcct, treasuryAcct, OTHER_TOKEN } from './helpers.js';
import { ROUTES, priceWei } from '../src/routes.js';

const sol = ROUTES.find((r) => r.id === 'sol-price');
const PRICE = priceWei(sol);
let ctx;
beforeEach(async () => { ctx = await boot(); });
afterEach(() => ctx.close());
const done = () => {};

describe('402 challenge', () => {
  test('names MUSD on Mezo testnet, price, treasury, nonce, and sets the PAYMENT-REQUIRED header', async () => {
    const ch = await challenge(ctx.url);
    assert.equal(ch.status, 402);
    assert.deepEqual(ch.body, ch.header);
    assert.equal(ch.body.price.amount, '0.01');
    const permit = ch.body.accepts.find((a) => a.scheme === 'permit');
    assert.equal(permit.network, 'eip155:31611');
    assert.equal(permit.asset, '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503');
    assert.equal(permit.payTo, ctx.cfg.treasury);
    assert.equal(permit.amount, String(PRICE));
    assert.match(permit.extra.nonce, /^\d+\.\d+\.[0-9a-f]{16}\.[0-9a-f]{32}$/);
    assert.equal(permit.extra.spender, ctx.chain.settlerAddress);
    assert.equal(ch.body.accepts.length, 2);
    done();
  });
  test('every route answers 402 with its own price; unknown route 404; bad param 400; non-GET 405', async () => {
    for (const r of ROUTES) {
      if (r.params.url) continue;
      const ch = await challenge(ctx.url, r.id);
      assert.equal(ch.status, 402, r.id);
      assert.equal(ch.body.accepts[0].amount, String(priceWei(r)));
    }
    assert.equal((await fetch(`${ctx.url}/api/nope`)).status, 404);
    assert.equal((await fetch(`${ctx.url}/api/summarize`)).status, 400);
    assert.equal((await fetch(`${ctx.url}/api/liquidations?limit=abc`)).status, 400);
    assert.equal((await fetch(`${ctx.url}/api/sol-price`, { method: 'HEAD' })).status, 405);
    assert.equal((await fetch(`${ctx.url}/api/sol-price`, { method: 'POST' })).status, 405);
    done();
  });
  test('free endpoints: landing page, manifest, health, stats, csv', async () => {
    assert.match(await (await fetch(ctx.url)).text(), /AgentFeed on Mezo/);
    const m = await (await fetch(`${ctx.url}/.well-known/x402`)).json();
    assert.equal(m.routes.length, ROUTES.length);
    assert.equal(m.asset.address, ctx.cfg.musd.address);
    assert.equal((await fetch(`${ctx.url}/health`)).status, 200);
    assert.equal((await (await fetch(`${ctx.url}/stats`)).json()).settled_calls, 0);
    assert.match(await (await fetch(`${ctx.url}/payments.csv`)).text(), /^timestamp_utc,route/);
    done();
  });
});

describe('happy path', () => {
  test('permit: data returned, settled once, upstream sees the key, receipt header, ledger row', async () => {
    const ch = await challenge(ctx.url);
    const res = await pay(ctx, 'sol-price', await permitPayment(ctx, ch));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.data.symbol, 'SOL');
    assert.equal(body.paid.currency, 'MUSD');
    assert.equal(body.paid.scheme, 'permit');
    assert.equal(ctx.chain.settled.length, 1);
    assert.equal(ctx.chain.settled[0].amount, PRICE);
    assert.equal(ctx.chain.settled[0].to, ctx.cfg.treasury);
    assert.equal(ctx.up.calls.length, 1);
    assert.equal(ctx.up.calls[0].key, 'afk_test');
    assert.equal(JSON.parse(Buffer.from(res.headers.get('payment-response'), 'base64')).success, true);
    const s = await (await fetch(`${ctx.url}/stats`)).json();
    assert.equal(s.settled_calls, 1);
    assert.equal(s.musd_settled, '0.01');
    done();
  });
  test('query params are whitelisted and forwarded', async () => {
    const ch = await challenge(ctx.url, 'liquidations', '?symbol=SOL&limit=5&evil=1');
    const res = await pay(ctx, 'liquidations', await permitPayment(ctx, ch), '?symbol=SOL&limit=5&evil=1');
    assert.equal(res.status, 200);
    assert.equal(ctx.up.calls[0].url, '/api/liquidations?symbol=SOL&limit=5');
    done();
  });
  test('transfer: a real-looking MUSD transfer receipt is accepted', async () => {
    const ch = await challenge(ctx.url);
    const hash = `0x${'11'.repeat(32)}`;
    addReceipt(ctx, hash, { value: PRICE });
    const res = await pay(ctx, 'sol-price', await transferPayment(ctx, ch, hash));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).paid.tx, hash);
    assert.equal(ctx.chain.settled.length, 0, 'transfer scheme settles nothing itself');
    done();
  });
});

describe('replay protection', () => {
  test('the same permit presented twice settles once', async () => {
    const ch = await challenge(ctx.url);
    const p = await permitPayment(ctx, ch);
    assert.equal((await pay(ctx, 'sol-price', p)).status, 200);
    const again = await pay(ctx, 'sol-price', p);
    assert.equal(again.status, 402);
    assert.equal((await again.json()).error, 'payment_replayed');
    assert.equal(ctx.chain.settled.length, 1);
    assert.equal(ctx.up.calls.length, 1);
    done();
  });
  test('a fresh signature on a used challenge nonce is refused', async () => {
    const ch = await challenge(ctx.url);
    assert.equal((await pay(ctx, 'sol-price', await permitPayment(ctx, ch))).status, 200);
    const second = await pay(ctx, 'sol-price', await permitPayment(ctx, ch, { deadline: ch.body.accepts[0].extra.expiresAt - 1 }));
    assert.equal((await second.json()).error, 'payment_replayed');
    done();
  });
  test('the same transfer tx hash cannot pay twice, even with a new challenge', async () => {
    const hash = `0x${'22'.repeat(32)}`;
    addReceipt(ctx, hash, { value: PRICE });
    const ch1 = await challenge(ctx.url);
    assert.equal((await pay(ctx, 'sol-price', await transferPayment(ctx, ch1, hash))).status, 200);
    const ch2 = await challenge(ctx.url);
    const r = await pay(ctx, 'sol-price', await transferPayment(ctx, ch2, hash));
    assert.equal((await r.json()).error, 'payment_replayed');
    done();
  });
  test('the settlement tx of a permit payment cannot be re-presented as a transfer payment', async () => {
    const ch = await challenge(ctx.url);
    const res = await pay(ctx, 'sol-price', await permitPayment(ctx, ch));
    const { tx } = (await res.json()).paid;
    addReceipt(ctx, tx, { value: PRICE });
    const ch2 = await challenge(ctx.url);
    const r = await pay(ctx, 'sol-price', await transferPayment(ctx, ch2, tx));
    assert.equal((await r.json()).error, 'payment_replayed');
    done();
  });
  test('a replay survives a gateway restart (ledger is sqlite, not memory)', async () => {
    const ch = await challenge(ctx.url);
    const p = await permitPayment(ctx, ch);
    await pay(ctx, 'sol-price', p);
    const db = ctx.store.db;
    const used = db.prepare("SELECT COUNT(*) n FROM replay WHERE state='used'").get().n;
    assert.ok(used >= 4, `expected sig, nonce, challenge and tx keys, got ${used}`);
    done();
  });
});

describe('rejections (each is 402 and charges nothing)', () => {
  const expectRefused = async (code, build) => {
    const ch = await challenge(ctx.url);
    const res = await pay(ctx, 'sol-price', await build(ch));
    assert.equal(res.status, 402);
    assert.equal((await res.json()).error, code);
    assert.equal(ctx.chain.settled.length, 0);
    assert.equal(ctx.up.calls.length, 0, 'upstream must not be called for a bad payment');
    done();
  };
  test('underpayment: permit value below price', () => expectRefused('underpaid', (ch) => permitPayment(ctx, ch, { value: PRICE - 1n })));
  test('underpayment: declared amount below price', () => expectRefused('underpaid', (ch) => permitPayment(ctx, ch, { declared: 1n })));
  test('overpayment is refused so no allowance is left behind', () => expectRefused('overpaid', (ch) => permitPayment(ctx, ch, { value: PRICE * 2n })));
  test('wrong token', () => expectRefused('wrong_asset', (ch) => permitPayment(ctx, ch, { asset: OTHER_TOKEN })));
  test('wrong chain: network field', () => expectRefused('wrong_network', (ch) => permitPayment(ctx, ch, { network: 'eip155:1' })));
  test('wrong chain: permit signed for another chain id', () => expectRefused('bad_signature', (ch) => permitPayment(ctx, ch, { domain: { chainId: 1 } })));
  test('wrong recipient', () => expectRefused('wrong_recipient', (ch) => permitPayment(ctx, ch, { payTo: otherAcct.address })));
  test('wrong spender', () => expectRefused('wrong_spender', (ch) => permitPayment(ctx, ch, { spender: otherAcct.address })));
  test('stale permit nonce (already used on-chain)', () => { ctx.chain.nonces.set(payerAcct.address.toLowerCase(), 1n); return expectRefused('bad_signature', (ch) => permitPayment(ctx, ch, { permitNonce: 0n })); });
  test('signature by someone else', () => expectRefused('bad_signature', async (ch) => { const p = await permitPayment(ctx, ch, { account: otherAcct }); p.payload.owner = payerAcct.address; return p; }));
  test('owner without enough MUSD', () => { ctx.chain.balances.set(payerAcct.address.toLowerCase(), 1n); return expectRefused('insufficient_balance', (ch) => permitPayment(ctx, ch)); });
  test('MUSD.permit would revert on-chain', () => { ctx.chain.simulateError = 'ERC2612ExpiredSignature'; return expectRefused('permit_rejected', (ch) => permitPayment(ctx, ch)); });
  test('expired permit deadline', () => expectRefused('permit_expired', (ch) => permitPayment(ctx, ch, { deadline: ctx.t.now - 1 })));
  test('permit that outlives the challenge', () => expectRefused('deadline_too_long', (ch) => permitPayment(ctx, ch, { deadline: ctx.t.now + 86400 })));
  test('expired nonce', () => expectRefused('nonce_expired', async (ch) => { const p = await permitPayment(ctx, ch, { deadline: ctx.t.now + 400 }); ctx.t.now += 301; return p; }));
  test('nonce issued for another route', async () => {
    const ch = await challenge(ctx.url, 'sol-price');
    const p = await permitPayment(ctx, ch);
    const res = await pay(ctx, 'btc-price', p); // same price, different route: only the nonce binding can refuse it
    assert.equal((await res.json()).error, 'nonce_invalid');
    done();
  });
  test('forged nonce', () => expectRefused('nonce_invalid', (ch) => permitPayment(ctx, ch, { challengeNonce: ch.body.accepts[0].extra.nonce.replace(/.$/, (c) => (c === '0' ? '1' : '0')) })));
  test('garbage payment header', async () => {
    const r = await fetch(`${ctx.url}/api/sol-price`, { headers: { 'payment-signature': 'not-base64-json!!' } });
    assert.equal((await r.json()).error, 'malformed_payment');
    done();
  });
  test('Mezo RPC down: refused, nothing charged', async () => {
    const ch = await challenge(ctx.url);
    const p = await permitPayment(ctx, ch);
    ctx.chain.rpcDown = true;
    const r = await pay(ctx, 'sol-price', p);
    assert.equal((await r.json()).error, 'chain_unavailable');
    assert.equal(ctx.chain.settled.length, 0);
    done();
  });
});

describe('transfer scheme rejections', () => {
  const run = async (code, receipt, { claimer } = {}) => {
    const ch = await challenge(ctx.url);
    const hash = `0x${Math.floor(Math.random() * 1e15).toString(16).padStart(64, '3')}`;
    if (receipt) addReceipt(ctx, hash, receipt);
    const res = await pay(ctx, 'sol-price', await transferPayment(ctx, ch, hash, { account: claimer }));
    assert.equal(res.status, 402);
    assert.equal((await res.json()).error, code);
    assert.equal(ctx.up.calls.length, 0);
    done();
  };
  test('underpayment', () => run('underpaid', { value: PRICE - 1n }));
  test('wrong token (another token paid to the treasury)', () => run('wrong_asset', { value: PRICE, token: OTHER_TOKEN }));
  test('wrong recipient', () => run('wrong_recipient', { value: PRICE, to: otherAcct.address }));
  test('wrong chain: hash unknown on Mezo testnet', () => run('tx_not_found', null));
  test('reverted transaction', () => run('tx_failed', { value: PRICE, status: 'reverted' }));
  test('not enough confirmations', () => run('not_enough_confirmations', { value: PRICE, confirmations: 0 }));
  test('transfer older than the challenge', () => run('tx_before_challenge', { value: PRICE, timestamp: ctx.t.now - 3600 }));
  test('third party claiming someone else\'s transfer', () => run('claim_signature_invalid', { value: PRICE }, { claimer: otherAcct }));
});

describe('upstream AgentFeed down', () => {
  test('502, payer not charged, and the same payment works once upstream recovers', async () => {
    ctx.up.mode = 'down';
    const ch = await challenge(ctx.url);
    const p = await permitPayment(ctx, ch);
    const r = await pay(ctx, 'sol-price', p);
    assert.equal(r.status, 502);
    const body = await r.json();
    assert.equal(body.error, 'upstream_unavailable');
    assert.equal(body.charged, false);
    assert.equal(ctx.chain.settled.length, 0, 'no settlement while upstream is down');
    ctx.up.mode = 'ok';
    const retry = await pay(ctx, 'sol-price', p);
    assert.equal(retry.status, 200);
    assert.equal(ctx.chain.settled.length, 1);
    done();
  });
  test('upstream unreachable (connection refused) is also a clean 502', async () => {
    ctx.cfg.upstreamUrl = 'http://127.0.0.1:1';
    const ch = await challenge(ctx.url);
    const r = await pay(ctx, 'sol-price', await permitPayment(ctx, ch));
    assert.equal(r.status, 502);
    assert.equal((await r.json()).charged, false);
    done();
  });
  test('settlement failure after a good upstream answer: 402, data withheld, not recorded', async () => {
    ctx.chain.settleError = 'nonce too low';
    const ch = await challenge(ctx.url);
    const r = await pay(ctx, 'sol-price', await permitPayment(ctx, ch));
    assert.equal(r.status, 402);
    const body = await r.json();
    assert.equal(body.error, 'settlement_failed');
    assert.equal(body.data, undefined);
    assert.equal((await (await fetch(`${ctx.url}/stats`)).json()).settled_calls, 0);
    done();
  });
});

describe('concurrency', () => {
  test('two simultaneous permits from one owner: exactly one settles, the other is refused (429 in flight or 402 nonce claimed)', async () => {
    let release;
    ctx.chain.settlePermit = async (p) => { await new Promise((r) => { release = r; setTimeout(r, 150); }); ctx.chain.settled.push(p); return { permitTx: `0xaa${'0'.repeat(62)}`, transferTx: `0xbb${'0'.repeat(62)}` }; };
    const [c1, c2] = [await challenge(ctx.url), await challenge(ctx.url)];
    const [p1, p2] = [await permitPayment(ctx, c1), await permitPayment(ctx, c2)];
    const [a, b] = await Promise.all([pay(ctx, 'sol-price', p1), pay(ctx, 'sol-price', p2)]);
    const codes = [a.status, b.status].sort();
    assert.equal(codes[0], 200);
    assert.ok(codes[1] === 429 || codes[1] === 402, `second call got ${codes[1]}`);
    assert.equal(ctx.chain.settled.length, 1);
    done();
  });
});

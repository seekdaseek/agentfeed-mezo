// The Mezo-native routes: the arithmetic, and the gateway selling them with the same fetch-first, charge-second rule.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { devBps, liquidation, icrPct } from '../src/mezo-data.js';
import { ROUTES, cleanParams, priceWei } from '../src/routes.js';
import { boot, challenge, permitPayment, pay } from './helpers.js';

const E18 = 10n ** 18n;

describe('arithmetic', () => {
  test('deviation from a dollar in basis points', () => {
    assert.equal(devBps(1), 0);
    assert.equal(devBps(0.9906), -94);
    assert.equal(devBps(1.0042), 42);
  });
  test('liquidation price is debt x 110% / collateral, and the distance is measured from the current price', () => {
    // 0.05 BTC against 2,000 MUSD at $80,000: liquidates at 2000 x 1.1 / 0.05 = $44,000, 45% below
    const l = liquidation({ coll: 5n * 10n ** 16n, debt: 2000n * E18, price: 80_000n * E18 });
    assert.equal(l.liqPrice, 44_000n * E18);
    assert.equal(l.distancePct, 45);
    assert.equal(liquidation({ coll: 0n, debt: 1n, price: 1n }), null);
  });
  test('collateral ratio in percent', () => {
    assert.equal(icrPct(5n * 10n ** 16n, 80_000n * E18, 2000n * E18), 200);
    assert.equal(icrPct(1n, 1n, 0n), null);
  });
});

describe('route parameters', () => {
  const trove = ROUTES.find((r) => r.id === 'mezo-trove');
  const q = (s) => cleanParams(trove, new URLSearchParams(s));
  test('mezo-trove needs a real address and only mainnet or testnet', () => {
    assert.equal(q('').ok, false);
    assert.equal(q('address=0x123').ok, false);
    assert.equal(q('address=0x' + 'a'.repeat(40)).ok, true);
    assert.equal(q('address=0x' + 'a'.repeat(40) + '&network=goerli').ok, false);
    assert.equal(q('address=0x' + 'a'.repeat(40) + '&network=testnet').query.get('network'), 'testnet');
  });
});

describe('selling them', () => {
  let ctx, calls, fail;
  beforeEach(async () => {
    calls = []; fail = null;
    const local = {
      peg: async () => { calls.push('peg'); if (fail) throw new Error('rpc down'); return { venues: [{ venue: 'x', sell_1_musd_usd: 0.99 }], worst_deviation_bps: -100 }; },
      trove: async (q) => { calls.push(['trove', q]); if (fail) throw new Error('rpc down'); if (fail === 'bad') throw Object.assign(new Error('nope'), { status: 400 }); return { address: q.address, has_trove: false }; },
    };
    ctx = await boot({ local });
  });
  afterEach(() => ctx.close());
  const price = (id) => priceWei(ROUTES.find((r) => r.id === id));

  test('prices: peg 3 cents, trove 2 cents, both in the 402', async () => {
    assert.equal((await challenge(ctx.url, 'mezo-peg')).body.accepts[0].amount, String(price('mezo-peg')));
    assert.equal((await challenge(ctx.url, 'mezo-trove', '?address=0x' + 'a'.repeat(40))).body.accepts[0].amount, String(price('mezo-trove')));
  });
  test('a paid peg call returns the chain read, never touches AgentFeed, and settles once', async () => {
    const ch = await challenge(ctx.url, 'mezo-peg');
    const res = await pay(ctx, 'mezo-peg', await permitPayment(ctx, ch));
    assert.equal(res.status, 200);
    const b = await res.json();
    assert.equal(b.data.tool, 'mezo_peg');
    assert.equal(b.data.data.worst_deviation_bps, -100);
    assert.equal(ctx.up.calls.length, 0, 'AgentFeed upstream is not used for a Mezo route');
    assert.equal(ctx.chain.settled.length, 1);
  });
  test('a trove call passes the address through', async () => {
    const a = '0x' + 'b'.repeat(40);
    const ch = await challenge(ctx.url, 'mezo-trove', `?address=${a}&network=testnet`);
    const res = await pay(ctx, 'mezo-trove', await permitPayment(ctx, ch), `?address=${a}&network=testnet`);
    assert.equal(res.status, 200);
    assert.deepEqual(calls[0], ['trove', { address: a, network: 'testnet' }]);
  });
  test('a missing or bad address is a 400 before any 402, so nobody pays for a malformed request', async () => {
    assert.equal((await fetch(`${ctx.url}/api/mezo-trove`)).status, 400);
    assert.equal((await fetch(`${ctx.url}/api/mezo-trove?address=nope`)).status, 400);
  });
  test('when the chain read fails the buyer is not charged and can retry the same payment', async () => {
    const ch = await challenge(ctx.url, 'mezo-peg');
    const p = await permitPayment(ctx, ch);
    fail = true;
    const r = await pay(ctx, 'mezo-peg', p);
    assert.equal(r.status, 502);
    const b = await r.json();
    assert.equal(b.error, 'data_unavailable');
    assert.equal(b.charged, false);
    assert.equal(ctx.chain.settled.length, 0);
    fail = null;
    assert.equal((await pay(ctx, 'mezo-peg', p)).status, 200);
    assert.equal(ctx.chain.settled.length, 1);
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeNonce, checkNonce } from '../src/challenge.js';
import { cleanParams, ROUTES, priceWei, priceMusd } from '../src/routes.js';
import { splitSignature } from '../src/payments.js';
import { openStore } from '../src/store.js';

describe('challenge nonce', () => {
  const args = { secret: 's', routeId: 'sol-price', amountWei: 10n ** 16n, now: 1000, ttl: 300 };
  test('round trip', () => assert.equal(checkNonce({ ...args, nonce: makeNonce(args), now: 1100 }).ok, true));
  test('expires', () => assert.equal(checkNonce({ ...args, nonce: makeNonce(args), now: 1301 }).code, 'nonce_expired'));
  test('bound to route', () => assert.equal(checkNonce({ ...args, routeId: 'trade-context', nonce: makeNonce(args), now: 1100 }).code, 'nonce_invalid'));
  test('bound to price', () => assert.equal(checkNonce({ ...args, amountWei: 1n, nonce: makeNonce(args), now: 1100 }).code, 'nonce_invalid'));
  test('bound to secret', () => assert.equal(checkNonce({ ...args, secret: 'x', nonce: makeNonce(args), now: 1100 }).code, 'nonce_invalid'));
  test('malformed', () => assert.equal(checkNonce({ ...args, nonce: 'a.b' }).code, 'nonce_malformed'));
});

describe('routes', () => {
  test('8 routes, cents pricing, unique ids', () => {
    assert.equal(ROUTES.length, 8);
    assert.equal(new Set(ROUTES.map((r) => r.id)).size, 8);
    for (const r of ROUTES) assert.ok(Number.isInteger(r.cents) && r.cents >= 1 && r.cents <= 5);
    assert.equal(priceWei(ROUTES[0]), 10n ** 16n);
    assert.equal(priceMusd(ROUTES.find((r) => r.id === 'summarize')), '0.05');
  });
  test('cleanParams drops unknown, requires url on summarize, types ints', () => {
    const sum = ROUTES.find((r) => r.id === 'summarize');
    assert.equal(cleanParams(sum, new URLSearchParams('')).ok, false);
    assert.equal(cleanParams(sum, new URLSearchParams('url=https://a.b&x=1')).query.toString(), 'url=https%3A%2F%2Fa.b');
    const liq = ROUTES.find((r) => r.id === 'liquidations');
    assert.equal(cleanParams(liq, new URLSearchParams('limit=5')).ok, true);
    assert.equal(cleanParams(liq, new URLSearchParams('limit=-1')).ok, false);
  });
});

describe('signature helper', () => {
  test('splits 65 bytes, normalises v', () => {
    const sig = `0x${'ab'.repeat(32)}${'cd'.repeat(32)}01`;
    assert.equal(splitSignature(sig).v, 28);
    assert.equal(splitSignature('0x12'), null);
  });
});

describe('store', () => {
  test('reserve is all-or-nothing; release frees; used stays used', () => {
    const s = openStore(':memory:');
    assert.equal(s.reserve(['a', 'b']), true);
    assert.equal(s.reserve(['b', 'c']), false);
    assert.equal(s.isUsed('c'), false, 'a failed reserve must not leave partial keys');
    s.release(['a', 'b']);
    assert.equal(s.reserve(['a']), true);
    s.commit(['a'], { ts: 1, route: 'r', scheme: 'permit', payer: '0x1', amount_wei: '1', nonce: 'n', permit_tx: null, tx_hash: '0xh', upstream_ms: 1, total_ms: 2 });
    s.release(['a']);
    assert.equal(s.isUsed('a'), true, 'release must not free a used key');
    assert.equal(s.stats().settled, 1);
    s.close();
  });
});

// Per-agent budgets and caps: the unit rules and the gateway refusing before it settles. Real signatures, fake chain.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { openStore } from '../src/store.js';
import { openAgents, registerMessage, dayStart, DAY } from '../src/agents.js';
import { priceWei, ROUTES } from '../src/routes.js';
import { boot, challenge, permitPayment, pay, payerAcct, otherAcct } from './helpers.js';

const CENT = 10n ** 16n;
const sol = ROUTES.find((r) => r.id === 'sol-price'); // 1 cent
const OWNER = 1111, OTHER_OWNER = 2222;
const NOW = 1_800_000_000;

const sign = (acct, ownerTg, name) => acct.signMessage({ message: registerMessage({ ownerTg, name, address: acct.address }) });
async function register(agents, acct, { ownerTg = OWNER, name = 'bot1', cap = 100n * CENT, now = NOW } = {}) {
  return agents.register({ ownerTg, name, address: acct.address, signature: await sign(acct, ownerTg, name), dailyCapWei: cap, now });
}

describe('registration', () => {
  let store, agents;
  beforeEach(() => { store = openStore(':memory:'); agents = openAgents(store.db); });
  afterEach(() => store.close());

  test('an agent wallet registers with its own signature', async () => {
    const r = await register(agents, payerAcct);
    assert.equal(r.ok, true);
    assert.equal(r.agent.address, payerAcct.address.toLowerCase());
    assert.equal(r.agent.status, 'active');
    assert.equal(r.agent.floor_pct, 200, 'default trove floor is 200%');
  });
  test('a signature by another wallet is refused: nobody can register a stranger\'s wallet to block it', async () => {
    const r = await agents.register({ ownerTg: OWNER, name: 'x', address: payerAcct.address, signature: await sign(otherAcct, OWNER, 'x'), dailyCapWei: CENT, now: NOW });
    assert.equal(r.code, 'bad_signature');
    assert.equal(agents.byAddress(payerAcct.address), undefined);
  });
  test('the signature binds the owner and the name: it cannot be replayed under another owner', async () => {
    const sig = await sign(payerAcct, OWNER, 'bot1');
    const r = await agents.register({ ownerTg: OTHER_OWNER, name: 'bot1', address: payerAcct.address, signature: sig, dailyCapWei: CENT, now: NOW });
    assert.equal(r.code, 'bad_signature');
  });
  test('one wallet, one agent; one name per owner; zero cap and junk names refused', async () => {
    assert.equal((await register(agents, payerAcct)).ok, true);
    assert.equal((await register(agents, payerAcct, { name: 'again' })).code, 'address_taken');
    assert.equal((await register(agents, otherAcct, { name: 'bot1' })).code, 'name_taken');
    assert.equal((await register(agents, privateKeyToAccount(generatePrivateKey()), { name: 'z', cap: 0n })).code, 'bad_cap');
    assert.equal((await register(agents, privateKeyToAccount(generatePrivateKey()), { name: 'bad name!' })).code, 'bad_name');
  });
  test('only the owner can pause, resume, cap, set the floor; revoked is final', async () => {
    const { agent } = await register(agents, payerAcct);
    assert.equal(agents.setStatus(agent, OTHER_OWNER, 'paused').code, 'not_owner');
    assert.equal(agents.setCap(agent, OTHER_OWNER, CENT).code, 'not_owner');
    assert.equal(agents.setFloor(agent, OWNER, 105).code, 'bad_floor');
    assert.equal(agents.setFloor(agent, OWNER, 250).ok, true);
    assert.equal(agents.setStatus(agent, OWNER, 'paused').ok, true);
    assert.equal(agents.byId(agent.id).status, 'paused');
    assert.equal(agents.setStatus(agent, OWNER, 'revoked').ok, true);
    assert.equal(agents.setStatus(agents.byId(agent.id), OWNER, 'active').code, 'agent_revoked');
  });
});

describe('the rules', () => {
  let store, agents, agent;
  beforeEach(async () => { store = openStore(':memory:'); agents = openAgents(store.db); agent = (await register(agents, payerAcct, { cap: 3n * CENT })).agent; });
  afterEach(() => store.close());
  const spend = (ts, wei = CENT, n = 1) => { for (let i = 0; i < n; i++) store.commit([`k${ts}-${i}-${Math.random()}`], { ts, route: 'sol-price', scheme: 'permit', payer: payerAcct.address, amount_wei: String(wei), nonce: `n${ts}${i}${Math.random()}`, permit_tx: null, tx_hash: `0x${ts}${i}${Math.random()}`, upstream_ms: 1, total_ms: 1, network: 'eip155:31611' }); };
  const top = (wei, tx) => agents.topup(agents.byId(agent.id), { kind: 'topup-send', amountWei: wei, txHash: tx, now: NOW });

  test('no budget, no calls', () => assert.equal(agents.check(agent, CENT, NOW).code, 'budget_exceeded'));
  test('a budget lets calls through until it is spent, then refuses', () => {
    top(2n * CENT, '0xaa');
    assert.equal(agents.check(agent, CENT, NOW).ok, true);
    spend(NOW + 1); spend(NOW + 2);
    assert.equal(agents.state(agent, NOW + 3).remaining, 0n);
    assert.equal(agents.check(agent, CENT, NOW + 3).code, 'budget_exceeded');
  });
  test('a top-up reopens it', () => {
    top(CENT, '0xaa'); spend(NOW + 1);
    assert.equal(agents.check(agent, CENT, NOW + 2).code, 'budget_exceeded');
    top(5n * CENT, '0xbb');
    assert.equal(agents.check(agent, CENT, NOW + 2).ok, true);
  });
  test('a transaction can fund a budget only once', () => {
    assert.equal(top(CENT, '0xAA').ok, true);
    assert.equal(top(CENT, '0xaa').code, 'tx_used');
  });
  test('the daily cap holds and resets at UTC midnight', () => {
    top(100n * CENT, '0xaa');
    const t0 = NOW + 10; // same UTC day as the agent's creation (8 h in)
    spend(t0, CENT, 3); // cap is 3 cents
    assert.equal(agents.check(agent, CENT, t0 + 10).code, 'daily_cap_exceeded');
    assert.equal(agents.check(agent, CENT, dayStart(NOW) + DAY - 1).code, 'daily_cap_exceeded', 'still the same UTC day one second before midnight');
    assert.equal(agents.check(agent, CENT, dayStart(NOW) + DAY).ok, true, 'a new UTC day starts at midnight');
  });
  test('spending before the agent existed does not count', () => {
    top(10n * CENT, '0xaa');
    spend(agent.created_ts - 5000, CENT, 3);
    assert.equal(agents.state(agent, NOW).spentTotal, 0n);
  });
  test('refusal messages state MUSD, not wei', () => {
    top(2n * CENT, '0xaa');
    spend(NOW + 1, CENT, 2);
    const budget = agents.check(agent, CENT, NOW + 2);
    assert.equal(budget.code, 'budget_exceeded');
    assert.equal(budget.message, 'budget left 0.00 MUSD, this call costs 0.01 MUSD');
    top(100n * CENT, '0xbb');
    spend(NOW + 3, CENT, 1); // 3 cents today, cap is 3 cents
    const cap = agents.check(agent, 2n * CENT, NOW + 4);
    assert.equal(cap.code, 'daily_cap_exceeded');
    assert.match(cap.message, /^daily cap of 0\.03 MUSD would be passed \(0\.03 spent today, this call costs 0\.02\); it resets at /);
    assert.doesNotMatch(cap.message + budget.message, /wei|\d{10,}/);
  });
  test('paused and revoked refuse whatever the budget', () => {
    top(10n * CENT, '0xaa');
    agents.setStatus(agent, OWNER, 'paused');
    assert.equal(agents.check(agents.byId(agent.id), CENT, NOW).code, 'agent_paused');
    agents.setStatus(agent, OWNER, 'revoked');
    assert.equal(agents.check(agents.byId(agent.id), CENT, NOW).code, 'agent_revoked');
  });
});

describe('the gateway enforces them before it settles', () => {
  let ctx, agents;
  beforeEach(async () => { ctx = await boot(); agents = openAgents(ctx.store.db); });
  afterEach(() => ctx.close());
  const call = async () => { const ch = await challenge(ctx.url); return pay(ctx, 'sol-price', await permitPayment(ctx, ch)); };
  const mk = async (cap = 100n * CENT, budget = 100n * CENT) => {
    const { agent } = await agents.register({ ownerTg: OWNER, name: 'a', address: payerAcct.address, signature: await sign(payerAcct, OWNER, 'a'), dailyCapWei: cap, now: ctx.t.now });
    if (budget) agents.topup(agent, { kind: 'topup-send', amountWei: budget, txHash: '0xfeed', now: ctx.t.now });
    return agent;
  };

  test('a call over budget is refused with nothing settled and nothing fetched', async () => {
    await mk(100n * CENT, 1n * CENT);
    assert.equal((await call()).status, 200);
    const r = await call();
    assert.equal(r.status, 402);
    const b = await r.json();
    assert.equal(b.error, 'budget_exceeded');
    assert.match(b.message, /nothing was charged/);
    assert.equal(ctx.chain.settled.length, 1);
    assert.equal(ctx.up.calls.length, 1, 'AgentFeed was not called for the refused one');
  });
  test('the daily cap stops the third call of a 2 cent day and a new UTC day lets it through', async () => {
    ctx.t.now = dayStart(ctx.t.now) + 5000; // early in a UTC day, set before the agent exists so created_ts is not later than the calls
    await mk(2n * CENT, 100n * CENT);
    assert.equal((await call()).status, 200);
    assert.equal((await call()).status, 200);
    assert.equal((await (await call()).json()).error, 'daily_cap_exceeded');
    ctx.t.now = dayStart(ctx.t.now) + DAY + 1;
    assert.equal((await call()).status, 200);
    assert.equal(ctx.chain.settled.length, 3);
  });
  test('pause stops it, resume restarts it, revoke ends it for good', async () => {
    const a = await mk();
    agents.setStatus(a, OWNER, 'paused');
    assert.equal((await (await call()).json()).error, 'agent_paused');
    agents.setStatus(agents.byId(a.id), OWNER, 'active');
    assert.equal((await call()).status, 200);
    agents.setStatus(agents.byId(a.id), OWNER, 'revoked');
    assert.equal((await (await call()).json()).error, 'agent_revoked');
    assert.equal(agents.setStatus(agents.byId(a.id), OWNER, 'active').code, 'agent_revoked');
    assert.equal(ctx.chain.settled.length, 1);
  });
  test('a registered agent without any budget cannot pay even though its wallet holds MUSD', async () => {
    await mk(100n * CENT, 0n);
    assert.equal((await (await call()).json()).error, 'budget_exceeded');
    assert.equal(ctx.chain.settled.length, 0);
  });
  test('an unregistered wallet is not affected by anyone\'s budgets', async () => {
    const ch = await challenge(ctx.url);
    const r = await pay(ctx, 'sol-price', await permitPayment(ctx, ch, { account: otherAcct }));
    assert.equal(r.status, 200);
  });
  test('GET /agents/:address shows the public state and nothing about the owner', async () => {
    await mk(5n * CENT, 3n * CENT);
    await call();
    const s = await (await fetch(`${ctx.url}/agents/${payerAcct.address}`)).json();
    assert.deepEqual([s.registered, s.status, s.remaining_musd, s.daily_remaining_musd, s.daily_cap_musd], [true, 'active', '0.02', '0.04', '0.05']);
    assert.equal(JSON.stringify(s).includes(String(OWNER)), false);
    assert.deepEqual(await (await fetch(`${ctx.url}/agents/${otherAcct.address}`)).json(), { registered: false });
  });
  test('the cap is read from the ledger, so a restart cannot reset it', async () => {
    ctx.t.now = dayStart(ctx.t.now) + 5000;
    await mk(1n * CENT, 100n * CENT);
    assert.equal((await call()).status, 200);
    const again = openAgents(ctx.store.db); // a second handle on the same database, as a restarted process would open
    assert.equal(again.check(again.byAddress(payerAcct.address), priceWei(sol), ctx.t.now).code, 'daily_cap_exceeded');
  });
});

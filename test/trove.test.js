// Funding a budget from a Mezo trove, with the floor checked off-chain. Real EIP-712 signatures, fake chain operations.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { openStore } from '../src/store.js';
import { openAgents, registerMessage } from '../src/agents.js';
import { makeBotCore } from '../src/botcore.js';
import { makeTrove, floorCheck, ratioPct, drawTypedData } from '../src/trove.js';
import { loadConfig } from '../src/config.js';
import { TRANSFER_TOPIC } from '../src/chain.js';

const E18 = 10n ** 18n;
const NOW = 1_800_000_000;
const TEST = 'eip155:31611';
const owner = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const agentAcct = privateKeyToAccount(generatePrivateKey());
const OWNER_TG = 7;
const cfg = loadConfig({ NETWORKS: 'mezo-testnet,base', TREASURY_ADDRESS: stranger.address, SETTLER_PRIVATE_KEY: generatePrivateKey(), BASE_TREASURY_ADDRESS: stranger.address, BASE_SETTLER_PRIVATE_KEY: generatePrivateKey(), CHALLENGE_SECRET: 's', UPSTREAM_KEY: 'k' });
const testnet = cfg.networks[0], base = cfg.networks[1];
const domain = { name: 'BorrowerOperationsSignatures', version: '1', chainId: 31611, verifyingContract: testnet.borrow.signatures };
const pad = (a) => `0x${'0'.repeat(24)}${a.slice(2).toLowerCase()}`;

// a trove of 0.06 BTC at $80,000 = $4,800 against 2,000 MUSD of debt: 240%
function fakeOps(over = {}) {
  const o = {
    calls: [], priceV: 80_000n * E18, status: 1, coll: 6n * 10n ** 16n, debt: 2_000n * E18, feeV: 1n * E18, recoveryV: false, nonceV: 5n, mintedTo: null, rcStatus: 'success', simulateError: null, submitError: null,
    async price() { return o.priceV; },
    async trove() { return { status: o.status, coll: o.coll, debt: o.debt }; },
    async recovery() { return o.recoveryV; },
    async fee() { return o.feeV; },
    async nonce() { return o.nonceV; },
    async domain() { return domain; },
    async hints() { return { upper: '0x' + '00'.repeat(20), lower: '0x' + '00'.repeat(20) }; },
    async simulate(a) { o.calls.push(['simulate', a]); if (o.simulateError) throw new Error(o.simulateError); },
    async submit(a) { o.calls.push(['submit', a]); if (o.submitError) throw new Error(o.submitError); o.last = a; return `0x${'ab'.repeat(32)}`; },
    async receipt() { return { status: o.rcStatus, confirmations: 3, timestamp: NOW, logs: [{ address: testnet.asset.address, topics: [TRANSFER_TOPIC, pad('0x' + '00'.repeat(20)), pad(o.mintedTo || agentAcct.address)], data: `0x${(o.last?.amount ?? 0n).toString(16).padStart(64, '0')}` }] }; },
    ...over,
  };
  return o;
}

describe('floor arithmetic', () => {
  test('collateral ratio is whole percent of coll x price / debt', () => {
    assert.equal(ratioPct(6n * 10n ** 16n, 80_000n * E18, 2_000n * E18), 240n);
    assert.equal(ratioPct(1n, 1n, 0n), null);
  });
  test('the draw and its fee count against the floor', () => {
    const base = { coll: 6n * 10n ** 16n, price: 80_000n * E18, debt: 2_000n * E18, floorPct: 200 };
    assert.deepEqual(Object.values(floorCheck({ ...base, drawWei: 300n * E18, feeWei: 0n })).slice(0, 3), [true, 240n, 208n]);
    assert.equal(floorCheck({ ...base, drawWei: 399n * E18, feeWei: 1n * E18 }).ok, true, 'exactly 200% passes');
    assert.equal(floorCheck({ ...base, drawWei: 399n * E18, feeWei: 2n * E18 }).ok, false, 'a dollar more is under');
    assert.equal(floorCheck({ ...base, drawWei: 1n, feeWei: 0n, floorPct: 241 }).ok, false);
  });
});

describe('draw', () => {
  let store, agents, agent, ops, trove, bot, now;
  const sign = (o) => owner.signTypedData(drawTypedData({ domain, amount: o.amount, borrower: o.borrower ?? owner.address, recipient: o.recipient ?? agentAcct.address, nonce: o.nonce ?? 5n, deadline: BigInt(o.deadline) }));
  const run = async (o = {}) => {
    const amount = o.amount ?? 100n * E18, deadline = o.deadline ?? NOW + 3600;
    const signature = o.signature ?? await sign({ ...o, amount, deadline });
    return trove.draw({ ownerTg: OWNER_TG, agent: agents.byId(agent.id), amountWei: amount, troveAddress: o.troveAddress ?? owner.address, deadline, signature, net: o.net ?? testnet, now: NOW });
  };
  beforeEach(async () => {
    store = openStore(':memory:'); agents = openAgents(store.db);
    agent = (await agents.register({ ownerTg: OWNER_TG, name: 'bot1', address: agentAcct.address, signature: await agentAcct.signMessage({ message: registerMessage({ ownerTg: OWNER_TG, name: 'bot1', address: agentAcct.address }) }), dailyCapWei: 5n * E18, now: NOW })).agent;
    ops = fakeOps(); trove = makeTrove({ agents, opsFor: () => ops });
    bot = makeBotCore({ agents, networks: cfg.networks, readers: {}, trove, now: () => NOW });
  });
  afterEach(() => store.close());

  test('a signed draw above the floor is submitted to the agent wallet and credits the budget; the label says testnet and off-chain', async () => {
    const r = await run();
    assert.match(r, /Drew 100\.00 MUSD/);
    assert.match(r, /TESTNET \(test MUSD\)/);
    assert.match(r, /off-chain/);
    assert.match(r, /bitcoin did not move/);
    assert.deepEqual(ops.calls.map((c) => c[0]), ['simulate', 'submit'], 'simulated before it was sent');
    assert.equal(ops.last.recipient, agentAcct.address, 'minted straight to the agent wallet');
    assert.equal(agents.state(agents.byId(agent.id), NOW).budgetTotal, 100n * E18);
    assert.equal(agents.events(agent)[0].kind, 'topup-draw');
  });
  test('a draw that would leave the trove under the owner\'s floor is refused and nothing is sent', async () => {
    const r = await run({ amount: 500n * E18 }); // 4800 / (2000 + 500 + 1) = 191%
    assert.match(r, /refused, nothing was sent on-chain/);
    assert.match(r, /191% collateral ratio, below your floor of 200% \(it is 240% now\)/);
    assert.equal(ops.calls.length, 0);
    assert.equal(agents.state(agents.byId(agent.id), NOW).budgetTotal, 0n);
  });
  test('the floor is per agent and changeable: lowering it lets the same draw through', async () => {
    assert.match(await run({ amount: 500n * E18 }), /refused/);
    agents.setFloor(agents.byId(agent.id), OWNER_TG, 185);
    assert.match(await run({ amount: 500n * E18 }), /Drew 500\.00 MUSD/);
  });
  test('Mezo\'s own 110% is not the floor: a draw to 150% is refused at the default', async () => {
    ops.coll = 5n * 10n ** 16n; ops.debt = 2_300n * E18; // 4000/2300 = 173%
    assert.match(await run({ amount: 400n * E18 }), /below your floor of 200%/);
  });
  test('a signature from anyone but the trove owner is refused', async () => {
    const sig = await stranger.signTypedData(drawTypedData({ domain, amount: 100n * E18, borrower: owner.address, recipient: agentAcct.address, nonce: 5n, deadline: BigInt(NOW + 3600) }));
    assert.match(await run({ signature: sig }), /not made by the trove owner/);
    assert.equal(ops.calls.length, 0);
  });
  test('a signature for another recipient, another amount or an old nonce is refused', async () => {
    assert.match(await run({ recipient: stranger.address }), /not made by the trove owner for this amount, recipient/);
    assert.match(await run({ signature: await sign({ amount: 50n * E18, deadline: NOW + 3600 }) }), /not made by the trove owner/);
    assert.match(await run({ nonce: 4n }), /not made by the trove owner/);
    assert.equal(ops.calls.length, 0);
  });
  test('deadlines outside one minute to 24 hours are refused', async () => {
    assert.match(await run({ deadline: NOW + 30 }), /deadline must be between/);
    assert.match(await run({ deadline: NOW + 90_000 }), /deadline must be between/);
  });
  test('no active trove, Recovery Mode, a revert in simulation: all refused before sending', async () => {
    ops.status = 0; assert.match(await run(), /no active trove/); ops.status = 1;
    ops.recoveryV = true; assert.match(await run(), /Recovery Mode/); ops.recoveryV = false;
    ops.simulateError = 'ICR below MCR'; assert.match(await run(), /Mezo would revert it: ICR below MCR/);
    assert.equal(ops.calls.filter((c) => c[0] === 'submit').length, 0);
  });
  test('a receipt that is not there yet is not called a failure: the bot says so and names /confirm, and credits nothing', async () => {
    ops.receipt = async () => null;
    const r = await run();
    assert.match(r, /could not read its receipt yet/);
    assert.match(r, /\/confirm bot1 0xabab/);
    assert.doesNotMatch(r, /failed|did not succeed/);
    assert.equal(agents.state(agents.byId(agent.id), NOW).budgetTotal, 0n);
  });
  test('a failed transaction, or one that mints nothing to the agent, credits nothing', async () => {
    ops.rcStatus = 'reverted'; assert.match(await run(), /failed on Mezo testnet/);
    ops.rcStatus = 'success'; ops.mintedTo = stranger.address; assert.match(await run(), /no MUSD reached the agent wallet/);
    assert.equal(agents.state(agents.byId(agent.id), NOW).budgetTotal, 0n);
  });
  test('the same draw transaction cannot fund a budget twice', async () => {
    assert.match(await run(), /Drew/);
    ops.nonceV = 5n; // the same signed message presented again
    assert.match(await run(), /already funded a budget/);
    assert.equal(agents.state(agents.byId(agent.id), NOW).budgetTotal, 100n * E18);
  });
  test('Base has no Mezo Borrow', async () => assert.match(await run({ net: base }), /has no Mezo Borrow/));

  test('the bot: /drawmsg shows typed data with the agent wallet as recipient, /draw runs it, /agent then shows the budget', async () => {
    const msg = await bot.handle(OWNER_TG, `/drawmsg bot1 100 ${owner.address} mezo-testnet`);
    assert.match(msg, /"primaryType":"WithdrawMUSD"/);
    assert.ok(msg.toLowerCase().includes(agentAcct.address.toLowerCase()));
    assert.match(msg, /bitcoin stays in the trove/);
    const sig = await sign({ amount: 100n * E18, deadline: NOW + 3600 });
    assert.match(await bot.handle(OWNER_TG, `/draw bot1 100 ${owner.address} ${NOW + 3600} ${sig} mezo-testnet`), /Drew 100\.00 MUSD/);
    assert.match(await bot.handle(OWNER_TG, '/agent bot1'), /budget left 100\.00 of 100\.00 MUSD/);
  });
  test('the bot: another Telegram user cannot draw for your agent', async () => {
    const sig = await sign({ amount: 100n * E18, deadline: NOW + 3600 });
    assert.match(await bot.handle(999, `/draw bot1 100 ${owner.address} ${NOW + 3600} ${sig} mezo-testnet`), /no agent named bot1/);
    assert.equal(ops.calls.length, 0);
  });
});

// The bot's command layer: owners, isolation, top-ups verified against receipts, and the limits it sets for the gateway.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { openStore } from '../src/store.js';
import { openAgents, registerMessage } from '../src/agents.js';
import { makeBotCore, parseMusd, fmtMusd } from '../src/botcore.js';
import { loadConfig } from '../src/config.js';
import { TRANSFER_TOPIC } from '../src/chain.js';

const A = 111, B = 222;
const NOW = 1_800_000_000;
const agentAcct = privateKeyToAccount(generatePrivateKey());
const BASE = 'eip155:8453', TEST = 'eip155:31611';
let store, agents, bot, readers, clock;
const cfg = loadConfig({ NETWORKS: 'mezo-testnet,base', TREASURY_ADDRESS: privateKeyToAccount(generatePrivateKey()).address, SETTLER_PRIVATE_KEY: generatePrivateKey(),
  BASE_TREASURY_ADDRESS: privateKeyToAccount(generatePrivateKey()).address, BASE_SETTLER_PRIVATE_KEY: generatePrivateKey(), CHALLENGE_SECRET: 's', UPSTREAM_KEY: 'k' });
const pad = (a) => `0x${'0'.repeat(24)}${a.slice(2).toLowerCase()}`;
const hash = (n) => `0x${n.toString(16).padStart(64, '0')}`;
const sigFor = (ownerTg, name, acct = agentAcct) => acct.signMessage({ message: registerMessage({ ownerTg, name, address: acct.address }) });

beforeEach(() => {
  clock = { now: NOW };
  store = openStore(':memory:'); agents = openAgents(store.db); readers = { [BASE]: { receipts: new Map(), transferReceipt: async (h) => readers[BASE].receipts.get(h) ?? null }, [TEST]: { receipts: new Map(), transferReceipt: async (h) => readers[TEST].receipts.get(h) ?? null } };
  bot = makeBotCore({ agents, networks: cfg.networks, readers, now: () => clock.now });
});
afterEach(() => store.close());

const transferTo = (network, h, to, wei, { token, status = 'success', confirmations = 3 } = {}) => {
  const n = cfg.networks.find((x) => x.network === network);
  readers[network].receipts.set(h, { status, confirmations, timestamp: NOW, logs: [{ address: token ?? n.asset.address, topics: [TRANSFER_TOPIC, pad('0x' + '11'.repeat(20)), pad(to)], data: `0x${wei.toString(16).padStart(64, '0')}` }] });
};
const newAgent = async (owner = A, name = 'bot1', cap = '0.50') => bot.handle(owner, `/newagent ${name} ${agentAcct.address} ${cap} ${await sigFor(owner, name)}`);

describe('amounts', () => {
  test('MUSD amounts parse strictly and print with at least two decimals', () => {
    assert.equal(parseMusd('0.5'), 5n * 10n ** 17n);
    for (const bad of ['', '0', '-1', '1e3', '1,5', '0.0000001', 'abc', '1000001']) assert.equal(parseMusd(bad), null, bad);
    assert.equal(fmtMusd(5n * 10n ** 17n), '0.50');
    assert.equal(fmtMusd(12345678901234567n), '0.012345');
  });
});

describe('commands', () => {
  test('/help lists the commands', async () => assert.match(await bot.handle(A, '/help'), /\/newagent[\s\S]*\/revoke/));
  test('/regmsg returns the exact text to sign, bound to owner and name', async () => {
    const r = await bot.handle(A, `/regmsg bot1 ${agentAcct.address}`);
    assert.ok(r.includes(registerMessage({ ownerTg: A, name: 'bot1', address: agentAcct.address })));
  });
  test('/newagent with a valid signature registers it with zero budget', async () => {
    const r = await newAgent();
    assert.match(r, /registered/);
    assert.match(r, /Budget is 0 MUSD/);
    assert.match(await bot.handle(A, '/agents'), /bot1 \[active\] left 0\.00 MUSD, today 0\.00 of 0\.50/);
  });
  test('/newagent with someone else\'s signature is refused', async () => {
    const r = await bot.handle(A, `/newagent bot1 ${agentAcct.address} 0.5 ${await sigFor(A, 'bot1', privateKeyToAccount(generatePrivateKey()))}`);
    assert.match(r, /not registered/);
    assert.equal(agents.list(A).length, 0);
  });
  test('one owner cannot see or change another owner\'s agent', async () => {
    await newAgent(A);
    assert.match(await bot.handle(B, '/agent bot1'), /no agent named bot1/);
    assert.match(await bot.handle(B, '/pause bot1'), /no agent named bot1/);
    assert.match(await bot.handle(B, '/revoke bot1 yes'), /no agent named bot1/);
    assert.equal(agents.byAddress(agentAcct.address).status, 'active');
    assert.match(await bot.handle(B, '/agents'), /No agents yet/);
  });
  test('pause, resume, setcap, setfloor change the stored limits', async () => {
    await newAgent();
    assert.match(await bot.handle(A, '/pause bot1'), /paused/);
    assert.equal(agents.byAddress(agentAcct.address).status, 'paused');
    assert.match(await bot.handle(A, '/resume bot1'), /active again/);
    assert.match(await bot.handle(A, '/setcap bot1 2'), /2\.00 MUSD/);
    assert.equal(agents.byAddress(agentAcct.address).daily_cap_wei, String(2n * 10n ** 18n));
    assert.match(await bot.handle(A, '/setfloor bot1 250'), /250%.*off-chain|250%.*checked by the bot/);
    assert.match(await bot.handle(A, '/setfloor bot1 105'), /between 111 and 1000/);
  });
  test('/revoke needs the word yes and is final', async () => {
    await newAgent();
    assert.match(await bot.handle(A, '/revoke bot1'), /final/);
    assert.equal(agents.byAddress(agentAcct.address).status, 'active');
    assert.match(await bot.handle(A, '/revoke bot1 yes'), /revoked/);
    assert.match(await bot.handle(A, '/resume bot1'), /stays revoked/);
  });
  test('unknown commands and missing arguments get a usage line, not a crash', async () => {
    assert.match(await bot.handle(A, '/nope'), /Unknown command/);
    assert.match(await bot.handle(A, '/pause'), /usage/);
    assert.match(await bot.handle(A, '/newagent x'), /usage/);
  });
});

describe('top-up by sending MUSD', () => {
  beforeEach(async () => { await newAgent(); });
  test('/topup says where to send, and flags mainnet as real money', async () => {
    const r = await bot.handle(A, '/topup bot1 2 base');
    assert.match(r, new RegExp(agentAcct.address.slice(2, 10), 'i'));
    assert.match(r, /MAINNET transfer: real MUSD/);
    assert.match(await bot.handle(A, '/topup bot1 2 mezo-testnet'), /testnet transfer: test MUSD/);
  });
  test('/confirm credits the MUSD that arrived at the agent wallet, once', async () => {
    transferTo(BASE, hash(1), agentAcct.address, 3n * 10n ** 18n);
    const r = await bot.handle(A, `/confirm bot1 ${hash(1)} base`);
    assert.match(r, /Credited 3\.00 MUSD/);
    assert.match(r, /basescan\.org\/tx\//);
    assert.equal(agents.state(agents.byAddress(agentAcct.address), NOW).remaining, 3n * 10n ** 18n);
    assert.match(await bot.handle(A, `/confirm bot1 ${hash(1)} base`), /already funded/);
    assert.equal(agents.state(agents.byAddress(agentAcct.address), NOW).remaining, 3n * 10n ** 18n, 'no double credit');
  });
  test('a transfer to someone else, a failed tx, another token, too few confirmations, an unknown tx: nothing credited', async () => {
    transferTo(BASE, hash(2), '0x' + '22'.repeat(20), 10n ** 18n);
    assert.match(await bot.handle(A, `/confirm bot1 ${hash(2)} base`), /No MUSD in that transaction went to/);
    transferTo(BASE, hash(3), agentAcct.address, 10n ** 18n, { status: 'reverted' });
    assert.match(await bot.handle(A, `/confirm bot1 ${hash(3)} base`), /failed on-chain/);
    transferTo(BASE, hash(4), agentAcct.address, 10n ** 18n, { token: '0x000000000000000000000000000000000000dEaD' });
    assert.match(await bot.handle(A, `/confirm bot1 ${hash(4)} base`), /No MUSD in that transaction/);
    transferTo(BASE, hash(5), agentAcct.address, 10n ** 18n, { confirmations: 0 });
    assert.match(await bot.handle(A, `/confirm bot1 ${hash(5)} base`), /confirmation/);
    assert.match(await bot.handle(A, `/confirm bot1 ${hash(6)} base`), /no transaction/);
    assert.equal(agents.state(agents.byAddress(agentAcct.address), NOW).budgetTotal, 0n);
  });
  test('a Base transfer cannot be credited as a testnet one (wrong chain)', async () => {
    transferTo(BASE, hash(7), agentAcct.address, 10n ** 18n);
    assert.match(await bot.handle(A, `/confirm bot1 ${hash(7)} mezo-testnet`), /no transaction/);
  });
  test('another owner cannot credit your agent', async () => {
    transferTo(BASE, hash(8), agentAcct.address, 10n ** 18n);
    assert.match(await bot.handle(B, `/confirm bot1 ${hash(8)} base`), /no agent named/);
  });
});

describe('calls', () => {
  test('/calls lists paid calls with the right explorer per network, newest first', async () => {
    await newAgent();
    const row = (ts, network, route, tx) => store.commit([`k${tx}`], { ts, route, scheme: 'permit', payer: agentAcct.address, amount_wei: String(10n ** 16n), nonce: `n${tx}`, permit_tx: null, tx_hash: hash(tx), upstream_ms: 1, total_ms: 1, network });
    row(NOW + 10, BASE, 'sol-price', 1); row(NOW + 20, TEST, 'btc-price', 2);
    const r = await bot.handle(A, '/calls bot1');
    const lines = r.split('\n');
    assert.match(lines[0], /btc-price 0\.01 MUSD Mezo testnet/);
    assert.ok(lines[1].includes(`https://explorer.test.mezo.org/tx/${hash(2)}`));
    assert.match(lines[2], /sol-price/);
    assert.ok(lines[3].includes(`https://basescan.org/tx/${hash(1)}`));
  });
  test('/agent shows the wallet, budget, today, floor and the labelled off-chain floor', async () => {
    await newAgent();
    const r = await bot.handle(A, '/agent bot1');
    assert.match(r, /bot1 \[active\]/);
    assert.match(r, /trove floor 200% \(checked by this bot, off-chain\)/);
  });
});

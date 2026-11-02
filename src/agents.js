// Per-agent budgets and daily caps, enforced by the gateway before anything is settled.
// An owner registers an agent wallet (proving they control it with a signature), tops its budget up, and the gateway
// refuses any call from that wallet that would go over the remaining budget, over the daily cap, or while the agent is
// paused or revoked. Spending is read from the payments ledger, so there is no second source of truth to drift.
import { recoverMessageAddress, getAddress, isAddress } from 'viem';

export const DAY = 86400;
export const dayStart = (ts) => Math.floor(ts / DAY) * DAY; // caps reset at UTC midnight

export const registerMessage = ({ ownerTg, name, address }) =>
  `AgentFeed-Mezo agent registration\nowner:${ownerTg}\nname:${name}\naddress:${address.toLowerCase()}`;

const fail = (code, message) => ({ ok: false, code, message });
const wei = (v) => BigInt(v);

export function openAgents(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT, owner_tg INTEGER NOT NULL, name TEXT NOT NULL, address TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active', daily_cap_wei TEXT NOT NULL, floor_pct INTEGER NOT NULL DEFAULT 200,
      created_ts INTEGER NOT NULL, UNIQUE (owner_tg, name)
    );
    CREATE TABLE IF NOT EXISTS budget_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id INTEGER NOT NULL, ts INTEGER NOT NULL, kind TEXT NOT NULL,
      amount_wei TEXT NOT NULL, network TEXT, tx_hash TEXT UNIQUE, note TEXT
    );
    CREATE INDEX IF NOT EXISTS budget_events_agent ON budget_events(agent_id);
  `);
  const q = {
    byAddress: db.prepare('SELECT * FROM agents WHERE address = ?'),
    byId: db.prepare('SELECT * FROM agents WHERE id = ?'),
    byOwner: db.prepare('SELECT * FROM agents WHERE owner_tg = ? ORDER BY id'),
    byOwnerName: db.prepare('SELECT * FROM agents WHERE owner_tg = ? AND name = ?'),
    insert: db.prepare('INSERT INTO agents (owner_tg, name, address, daily_cap_wei, floor_pct, created_ts) VALUES (?, ?, ?, ?, ?, ?)'),
    setStatus: db.prepare('UPDATE agents SET status = ? WHERE id = ?'),
    setCap: db.prepare('UPDATE agents SET daily_cap_wei = ? WHERE id = ?'),
    setFloor: db.prepare('UPDATE agents SET floor_pct = ? WHERE id = ?'),
    topups: db.prepare('SELECT amount_wei FROM budget_events WHERE agent_id = ?'),
    addEvent: db.prepare('INSERT INTO budget_events (agent_id, ts, kind, amount_wei, network, tx_hash, note) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    events: db.prepare('SELECT * FROM budget_events WHERE agent_id = ? ORDER BY id DESC LIMIT ?'),
    eventByTx: db.prepare('SELECT 1 FROM budget_events WHERE tx_hash = ?'),
    spent: db.prepare('SELECT amount_wei FROM payments WHERE lower(payer) = ? AND ts >= ?'),
    calls: db.prepare('SELECT ts, network, route, scheme, amount_wei, tx_hash, permit_tx FROM payments WHERE lower(payer) = ? AND ts >= ? ORDER BY id DESC LIMIT ?'),
  };
  const sum = (rows) => rows.reduce((a, r) => a + wei(r.amount_wei), 0n);

  const api = {
    byAddress: (a) => q.byAddress.get(String(a).toLowerCase()),
    byId: (id) => q.byId.get(id),
    list: (ownerTg) => q.byOwner.all(ownerTg),
    find: (ownerTg, name) => q.byOwnerName.get(ownerTg, name),

    // Registration needs a signature from the agent wallet itself, otherwise anyone could register a stranger's wallet
    // with a budget of zero and so block it.
    async register({ ownerTg, name, address, signature, dailyCapWei, now }) {
      if (!/^[a-z0-9][a-z0-9_-]{0,30}$/i.test(name || '')) return fail('bad_name', 'name: 1 to 31 letters, digits, - or _');
      if (!isAddress(address || '')) return fail('bad_address', 'address is not an EVM address');
      const addr = getAddress(address);
      let who;
      try { who = await recoverMessageAddress({ message: registerMessage({ ownerTg, name, address: addr }), signature }); } catch { return fail('bad_signature', 'signature is not valid'); }
      if (who.toLowerCase() !== addr.toLowerCase()) return fail('bad_signature', 'the signature was not made by the agent wallet');
      if (q.byAddress.get(addr.toLowerCase())) return fail('address_taken', 'this wallet is already registered');
      if (q.byOwnerName.get(ownerTg, name)) return fail('name_taken', 'you already have an agent with this name');
      if (!(wei(dailyCapWei) > 0n)) return fail('bad_cap', 'daily cap must be above zero');
      q.insert.run(ownerTg, name, addr.toLowerCase(), String(dailyCapWei), 200, now);
      return { ok: true, agent: q.byAddress.get(addr.toLowerCase()) };
    },

    // Only the owner may change an agent. Revoked is final.
    setStatus(agent, ownerTg, status) {
      if (agent.owner_tg !== ownerTg) return fail('not_owner', 'not your agent');
      if (agent.status === 'revoked') return fail('agent_revoked', 'a revoked agent stays revoked');
      q.setStatus.run(status, agent.id);
      return { ok: true };
    },
    setCap(agent, ownerTg, capWei) {
      if (agent.owner_tg !== ownerTg) return fail('not_owner', 'not your agent');
      if (!(wei(capWei) > 0n)) return fail('bad_cap', 'daily cap must be above zero');
      q.setCap.run(String(capWei), agent.id);
      return { ok: true };
    },
    setFloor(agent, ownerTg, pct) {
      if (agent.owner_tg !== ownerTg) return fail('not_owner', 'not your agent');
      if (!Number.isInteger(pct) || pct < 111 || pct > 1000) return fail('bad_floor', 'floor must be a whole percent between 111 and 1000');
      q.setFloor.run(pct, agent.id);
      return { ok: true };
    },

    // Budget moves only through recorded events; a tx hash can fund a budget once.
    topup(agent, { kind, amountWei, network, txHash, note, now }) {
      if (!(wei(amountWei) > 0n)) return fail('bad_amount', 'amount must be above zero');
      if (txHash && q.eventByTx.get(txHash.toLowerCase())) return fail('tx_used', 'this transaction already funded a budget');
      q.addEvent.run(agent.id, now, kind, String(amountWei), network ?? null, txHash ? txHash.toLowerCase() : null, note ?? null);
      return { ok: true };
    },
    events: (agent, limit = 20) => q.events.all(agent.id, limit),

    spentTotal: (agent) => sum(q.spent.all(agent.address, agent.created_ts)),
    spentToday: (agent, now) => sum(q.spent.all(agent.address, Math.max(dayStart(now), agent.created_ts))),
    budgetTotal: (agent) => q.topups.all(agent.id).reduce((a, r) => a + wei(r.amount_wei), 0n),
    calls: (agent, limit = 10) => q.calls.all(agent.address, agent.created_ts, limit),

    state(agent, now) {
      const total = api.budgetTotal(agent), spent = api.spentTotal(agent), today = api.spentToday(agent, now), cap = wei(agent.daily_cap_wei);
      return { budgetTotal: total, spentTotal: spent, remaining: total > spent ? total - spent : 0n, spentToday: today, dailyCap: cap, dailyRemaining: cap > today ? cap - today : 0n, resetsAt: dayStart(now) + DAY };
    },

    // The gate: called by the gateway after the payer is known and before anything is fetched or settled.
    check(agent, price, now) {
      if (agent.status === 'revoked') return fail('agent_revoked', 'this agent was revoked by its owner');
      if (agent.status === 'paused') return fail('agent_paused', 'this agent is paused by its owner');
      const s = api.state(agent, now);
      if (s.remaining < price) return fail('budget_exceeded', `budget left ${s.remaining} wei MUSD, this call costs ${price}`);
      if (s.spentToday + price > s.dailyCap) return fail('daily_cap_exceeded', `daily cap ${s.dailyCap} wei MUSD would be passed; it resets at ${new Date(s.resetsAt * 1000).toISOString()}`);
      return { ok: true };
    },
  };
  return api;
}

// The Telegram bot's brain, independent of Telegram: handle(userId, text) -> reply text.
// An owner registers agent wallets, sets a budget and a daily cap, watches every paid call with its explorer link, and
// pauses or revokes. Budget top-ups come from MUSD sent to the agent wallet (verified on-chain) or from a draw against
// the owner's own Mezo trove (src/trove.js). The gateway, not the bot, enforces the limits: see src/agents.js.
import { getAddress, isAddress, parseUnits, formatUnits } from 'viem';
import { registerMessage } from './agents.js';
import { TRANSFER_TOPIC } from './chain.js';

const MAX_MUSD = 1_000_000;
export function parseMusd(s) {
  if (!/^\d{1,9}(\.\d{1,6})?$/.test(String(s || ''))) return null;
  const n = Number(s);
  if (!(n > 0) || n > MAX_MUSD) return null;
  return parseUnits(String(s), 18);
}
export const fmtMusd = (wei) => {
  const t = formatUnits(BigInt(wei), 18);
  const [i, f = ''] = t.split('.');
  return `${i}.${(f + '00').slice(0, Math.max(2, f.replace(/0+$/, '').length)).slice(0, 6)}`;
};
const short = (h) => `${h.slice(0, 10)}…${h.slice(-6)}`;

// The menu Telegram shows under "/" (setMyCommands). Order is the order a new owner uses them: sign, register, list, fund, watch, draw.
export const BOT_COMMANDS = [
  { command: 'regmsg', description: 'First step: the message your agent wallet signs' },
  { command: 'newagent', description: 'Register an agent wallet with a daily cap' },
  { command: 'agents', description: 'Your agents and what is left of their budgets' },
  { command: 'topup', description: 'Fund a budget by sending MUSD to the agent wallet' },
  { command: 'calls', description: 'Every paid call, with its explorer link' },
  { command: 'draw', description: 'Fund from your own Mezo trove (floor checked here)' },
  { command: 'help', description: 'What this bot does' },
];

export const HELP = `AgentFeed on Mezo: budgets for your agents. Your agent wallet pays per call in MUSD; the gateway refuses any call over the limits you set here.

/regmsg <name> <address>   the message your agent wallet signs to prove it is yours
/newagent <name> <address> <daily cap MUSD> <signature>
/agents                     your agents and what is left
/agent <name>               one agent in full
/calls <name> [n]           the last paid calls, with explorer links
/topup <name> <MUSD> [network]   how to fund the budget by sending MUSD
/confirm <name> <txhash> [network]   credit a MUSD transfer you sent to the agent wallet
/drawmsg <name> <MUSD> <trove address> [network]   the typed data your trove wallet signs
/draw <name> <MUSD> <trove address> <deadline> <signature> [network]   fund from your own Mezo trove (floor checked here, off-chain)
/setcap <name> <MUSD>       change the daily cap (resets at UTC midnight)
/setfloor <name> <percent>  lowest collateral ratio a draw may leave your trove at (default 200)
/pause <name>   /resume <name>   /revoke <name> yes   (revoke is final)`;

export function makeBotCore({ agents, networks, readers, trove, now = () => Math.floor(Date.now() / 1000) }) {
  const nets = networks;
  const netByArg = (arg) => (arg ? nets.find((n) => n.key === arg || n.network === arg || String(n.chainId) === arg) : nets[0]);
  const explorerTx = (net, h) => `${net.explorer}/tx/${h}`;
  const need = (a, n) => a.length >= n;

  const own = (ownerTg, name) => (name ? agents.find(ownerTg, name) : null);

  async function handle(ownerTg, text) {
    const [cmdRaw, ...a] = String(text || '').trim().split(/\s+/);
    const cmd = (cmdRaw || '').split('@')[0].toLowerCase();
    const t = now();

    if (cmd === '/start' || cmd === '/help' || cmd === '') return HELP;

    if (cmd === '/regmsg') {
      if (!need(a, 2) || !isAddress(a[1])) return 'usage: /regmsg <name> <address>';
      const msg = registerMessage({ ownerTg, name: a[0], address: getAddress(a[1]) });
      return `Sign this exact text with the agent wallet (personal_sign), then send /newagent:\n\n${msg}\n\nWith this repo: AGENT_PRIVATE_KEY=0x... node src/client.js sign-register ${ownerTg} ${a[0]}`;
    }

    if (cmd === '/newagent') {
      if (!need(a, 4)) return 'usage: /newagent <name> <address> <daily cap MUSD> <signature>. Get the signature text from /regmsg.';
      const cap = parseMusd(a[2]);
      if (!cap) return 'the daily cap must be a MUSD amount like 0.50';
      const r = await agents.register({ ownerTg, name: a[0], address: a[1], signature: a[3], dailyCapWei: cap, now: t });
      if (!r.ok) return `not registered: ${r.message}`;
      return `Agent ${a[0]} registered for ${getAddress(a[1])}.\nBudget is 0 MUSD, so every call is refused until you fund it.\nDaily cap ${fmtMusd(cap)} MUSD (resets 00:00 UTC). Next: /topup ${a[0]} 2`;
    }

    if (cmd === '/agents') {
      const list = agents.list(ownerTg);
      if (!list.length) return 'No agents yet. /regmsg <name> <address> to start.';
      return list.map((g) => { const s = agents.state(g, t); return `${g.name} [${g.status}] left ${fmtMusd(s.remaining)} MUSD, today ${fmtMusd(s.spentToday)} of ${fmtMusd(s.dailyCap)}`; }).join('\n');
    }

    // everything below acts on one of the caller's agents; someone else's agent looks the same as a missing one
    const g = own(ownerTg, a[0]);
    const known = ['/agent', '/calls', '/topup', '/confirm', '/draw', '/drawmsg', '/setcap', '/setfloor', '/pause', '/resume', '/revoke'];
    if (!known.includes(cmd)) return 'Unknown command. /help';
    if (!a[0]) return `usage: ${cmd} <agent name> ...`;
    if (!g) return `You have no agent named ${a[0]}. /agents lists yours.`;

    if (cmd === '/agent') {
      const s = agents.state(g, t);
      const ev = agents.events(g, 3).map((e) => `  ${new Date(e.ts * 1000).toISOString().slice(0, 16)}Z ${e.kind} ${fmtMusd(e.amount_wei)} MUSD${e.tx_hash ? ` ${short(e.tx_hash)}` : ''}`).join('\n');
      return `${g.name} [${g.status}]\nwallet ${getAddress(g.address)}\nbudget left ${fmtMusd(s.remaining)} of ${fmtMusd(s.budgetTotal)} MUSD (spent ${fmtMusd(s.spentTotal)})\ntoday ${fmtMusd(s.spentToday)} of ${fmtMusd(s.dailyCap)} MUSD, resets ${new Date(s.resetsAt * 1000).toISOString().slice(11, 16)} UTC\ntrove floor ${g.floor_pct}% (checked by this bot, off-chain)${ev ? `\nlast top-ups:\n${ev}` : ''}`;
    }

    if (cmd === '/calls') {
      const n = Math.min(Math.max(parseInt(a[1] || '10', 10) || 10, 1), 25);
      const rows = agents.calls(g, n);
      if (!rows.length) return `${g.name} has made no paid calls yet.`;
      return rows.map((r) => { const net = nets.find((x) => x.network === r.network) || nets[0]; return `${new Date(r.ts * 1000).toISOString().slice(5, 16)}Z ${r.route} ${fmtMusd(r.amount_wei)} MUSD ${net.label}\n  ${explorerTx(net, r.tx_hash)}`; }).join('\n');
    }

    if (cmd === '/setcap') {
      const cap = parseMusd(a[1]);
      if (!cap) return 'usage: /setcap <name> <MUSD>';
      const r = agents.setCap(g, ownerTg, cap);
      return r.ok ? `Daily cap for ${g.name} is now ${fmtMusd(cap)} MUSD.` : r.message;
    }
    if (cmd === '/setfloor') {
      const r = agents.setFloor(g, ownerTg, Number(a[1]));
      return r.ok ? `Trove floor for ${g.name} is now ${Number(a[1])}%. This is checked by the bot before it submits a draw; Mezo itself only enforces 110%.` : r.message;
    }
    if (cmd === '/pause' || cmd === '/resume') {
      const r = agents.setStatus(g, ownerTg, cmd === '/pause' ? 'paused' : 'active');
      return r.ok ? `${g.name} is ${cmd === '/pause' ? 'paused: the gateway refuses its calls' : 'active again'}.` : r.message;
    }
    if (cmd === '/revoke') {
      if (a[1] !== 'yes') return `Revoking ${g.name} is final: the gateway will refuse that wallet for good. Send /revoke ${g.name} yes to confirm.`;
      const r = agents.setStatus(g, ownerTg, 'revoked');
      return r.ok ? `${g.name} is revoked.` : r.message;
    }

    if (cmd === '/topup') {
      const amt = parseMusd(a[1]); const net = netByArg(a[2]);
      if (!amt || !net) return `usage: /topup <name> <MUSD> [${nets.map((n) => n.key).join('|')}]`;
      return `Send ${fmtMusd(amt)} MUSD (or more) to ${getAddress(g.address)} on ${net.label} (chain ${net.chainId}), from any wallet.\nThen /confirm ${g.name} <txhash> ${net.key} and the budget is credited with what arrived. Each transaction can be credited once.${net.mainnet ? '\nThis is a MAINNET transfer: real MUSD.' : '\nThis is a testnet transfer: test MUSD.'}`;
    }

    if (cmd === '/confirm') {
      const hash = a[1]; const net = netByArg(a[2]);
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash || '') || !net) return `usage: /confirm <name> <txhash> [${nets.map((n) => n.key).join('|')}]`;
      const reader = readers[net.network];
      if (!reader) return `No reader for ${net.label}.`;
      let rc;
      try { rc = await reader.transferReceipt(hash); } catch (e) { return `Could not read ${net.label}: ${e.shortMessage || e.message}`; }
      if (!rc) return `${net.label} has no transaction ${short(hash)} (wrong network, or not mined yet).`;
      if (rc.status !== 'success') return 'That transaction failed on-chain.';
      if (rc.confirmations < net.confirmations) return `Only ${rc.confirmations} confirmation(s); wait for ${net.confirmations}.`;
      const to = g.address.toLowerCase();
      const got = rc.logs.filter((l) => l.address.toLowerCase() === net.asset.address.toLowerCase() && l.topics?.[0] === TRANSFER_TOPIC && l.topics.length === 3 && `0x${l.topics[2].slice(26)}`.toLowerCase() === to)
        .reduce((x, l) => x + BigInt(l.data), 0n);
      if (got === 0n) return `No MUSD in that transaction went to ${getAddress(g.address)} on ${net.label}.`;
      const r = agents.topup(g, { kind: 'topup-send', amountWei: got, network: net.network, txHash: `${net.network}:${hash}`, now: t });
      if (!r.ok) return r.message;
      return `Credited ${fmtMusd(got)} MUSD to ${g.name}. ${explorerTx(net, hash)}\nBudget left ${fmtMusd(agents.state(g, t).remaining)} MUSD.`;
    }

    if (cmd === '/drawmsg') {
      if (!trove) return 'Trove draws are not enabled on this bot.';
      const amt = parseMusd(a[1]); const net = netByArg(a[3]);
      if (!amt || !isAddress(a[2] || '') || !net) return 'usage: /drawmsg <name> <MUSD> <trove address> [network]';
      return trove.drawMessage({ agent: g, amountWei: amt, troveAddress: a[2], net, now: t });
    }
    if (cmd === '/draw') {
      if (!trove) return 'Trove draws are not enabled on this bot.';
      const amt = parseMusd(a[1]); const net = netByArg(a[5]);
      if (!amt || !isAddress(a[2] || '') || !net || !a[3] || !a[4]) return 'usage: /draw <name> <MUSD> <trove address> <deadline unix> <signature> [network]';
      return trove.draw({ ownerTg, agent: g, amountWei: amt, troveAddress: a[2], deadline: Number(a[3]), signature: a[4], net, now: t });
    }
    return 'Unknown command. /help';
  }
  return { handle };
}

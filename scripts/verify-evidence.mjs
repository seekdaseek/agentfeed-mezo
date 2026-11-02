// Re-checks every row of the gateway's public ledger against the chain it was paid on.
//   node scripts/verify-evidence.mjs [evidence/paid-calls.csv]      (default: fetches https://mezo.ochinimus.app/payments.csv)
// For each row: the transferFrom and the permit tx exist and succeeded, the MUSD Transfer goes from the payer to that
// network's treasury for the stated amount. Then, per network: the treasury's MUSD balance against the ledger total.
import { createPublicClient, http, fallback, formatEther, parseEther, parseAbi, getAddress } from 'viem';
import { readFileSync } from 'node:fs';
import { NETWORK_DEFS } from '../src/config.js';
import { TRANSFER_TOPIC } from '../src/chain.js';

const GATEWAY = process.env.GATEWAY_URL || 'https://mezo.ochinimus.app';
const text = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : await (await fetch(`${GATEWAY}/payments.csv`)).text();
const rows = text.trim().split('\n').slice(1).map((l) => l.split(','));
const man = await (await fetch(`${GATEWAY}/.well-known/x402`)).json();
const nets = (man.networks || [{ network: man.network, treasury: man.treasury }]).map((n) => {
  const def = Object.values(NETWORK_DEFS).find((d) => d.network === n.network);
  const urls = def.rpcUrls;
  return { ...n, def, pub: createPublicClient({ transport: urls.length > 1 ? fallback(urls.map((u) => http(u, { retryCount: 1 })), { rank: false }) : http(urls[0]) }) };
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The public RPCs answer from several nodes and the same receipt can read as null on one call and be there on the next
// (measured), and Base's free RPC also rate-limits: a missing receipt is retried up to 20 times before a row is called bad.
async function lookup(net, hash) {
  for (let i = 0; i < 20; i++) {
    try {
      const rc = await net.pub.getTransactionReceipt({ hash });
      const t = rc.logs.filter((l) => l.address.toLowerCase() === net.def.asset.address.toLowerCase() && l.topics[0] === TRANSFER_TOPIC)
        .map((l) => ({ from: getAddress(`0x${l.topics[1].slice(26)}`), to: getAddress(`0x${l.topics[2].slice(26)}`), value: BigInt(l.data) }));
      return { success: rc.status === 'success', transfers: t };
    } catch { await sleep(400); }
  }
  return null;
}
const per = Object.fromEntries(nets.map((n) => [n.network, { ok: 0, total: 0n, rows: 0 }]));
const bad = [];
for (const [, , scheme, payer, musd, tx, permitTx, , network] of rows) {
  const net = nets.find((n) => n.network === (network || 'eip155:31611'));
  const p = per[net.network]; p.rows++;
  try {
    const rc = await lookup(net, tx);
    if (!rc) throw new Error('transaction not found after 20 tries');
    const prc = permitTx ? await lookup(net, permitTx) : { success: true };
    if (!prc) throw new Error('permit transaction not found after 20 tries');
    if (!rc.success || !prc.success) throw new Error('tx not successful');
    const log = rc.transfers.find((t) => t.to === getAddress(net.treasury));
    if (!log) throw new Error('no MUSD Transfer to the treasury');
    if (log.from !== getAddress(payer)) throw new Error('payer mismatch');
    if (log.value !== parseEther(musd)) throw new Error(`amount ${formatEther(log.value)} != ledger ${musd}`);
    p.total += log.value; p.ok++;
  } catch (e) { bad.push(`${network} ${tx}: ${e.message}`); }
}
const abi = parseAbi(['function balanceOf(address) view returns (uint256)']);
const out = { rows: rows.length, verifiedOnChain: Object.values(per).reduce((a, p) => a + p.ok, 0), failed: bad.length, networks: {} };
let short = false;
for (const n of nets) {
  const p = per[n.network];
  const bal = await n.pub.readContract({ address: n.def.asset.address, abi, functionName: 'balanceOf', args: [getAddress(n.treasury)] }).catch(() => null);
  // the treasury may hold more than the ledger total (an unmatched payment, see evidence/unclaimed.md) or less (MUSD recycled out)
  out.networks[n.network] = { rows: p.rows, verified: p.ok, ledgerTotalMusd: formatEther(p.total), treasuryBalanceMusd: bal == null ? 'unread' : formatEther(bal) };
}
console.log(JSON.stringify(out, null, 1));
if (bad.length) console.log(bad.join('\n'));
process.exit(bad.length ? 1 : 0);

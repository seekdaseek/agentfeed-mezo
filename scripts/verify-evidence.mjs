// Re-checks every row of the gateway's public ledger against Mezo testnet itself.
//   node scripts/verify-evidence.mjs [evidence/paid-calls.csv]      (default: fetches https://mezo.ochinimus.app/payments.csv)
// For each row: the transferFrom and the permit tx exist and succeeded, the MUSD Transfer event goes from the payer to the
// treasury for the stated amount. Then: the treasury's MUSD balance equals the ledger total (run it when no call is in flight).
import { createPublicClient, http, formatEther, parseEther, parseAbi, getAddress } from 'viem';
import { readFileSync } from 'node:fs';
import { MEZO_TESTNET, MUSD } from '../src/config.js';
import { TRANSFER_TOPIC } from '../src/chain.js';

const GATEWAY = process.env.GATEWAY_URL || 'https://mezo.ochinimus.app';
const text = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : await (await fetch(`${GATEWAY}/payments.csv`)).text();
const rows = text.trim().split('\n').slice(1).map((l) => l.split(','));
const man = await (await fetch(`${GATEWAY}/.well-known/x402`)).json();
const pub = createPublicClient({ transport: http(MEZO_TESTNET.rpcUrl) });
const treasury = getAddress(man.treasury);
let ok = 0, total = 0n; const bad = [];
// The public RPC answers from several nodes and the same receipt can read as null on one call and be there on the next
// (measured: result, null, result for one hash), so a missing receipt is retried up to 20 times before a row is called bad.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function viaRpc(hash) {
  for (let i = 0; i < 20; i++) {
    try {
      const rc = await pub.getTransactionReceipt({ hash });
      const t = rc.logs.filter((l) => l.address.toLowerCase() === MUSD.address.toLowerCase() && l.topics[0] === TRANSFER_TOPIC)
        .map((l) => ({ from: getAddress(`0x${l.topics[1].slice(26)}`), to: getAddress(`0x${l.topics[2].slice(26)}`), value: BigInt(l.data) }));
      return { success: rc.status === 'success', transfers: t };
    } catch { await sleep(300); }
  }
  return null;
}
const lookup = (hash) => viaRpc(hash);
for (const [ts, route, scheme, payer, musd, tx, permitTx] of rows) {
  try {
    const rc = await lookup(tx);
    if (!rc) throw new Error('transaction not found by RPC after 20 tries');
    const prc = permitTx ? await lookup(permitTx) : { success: true };
    if (!prc) throw new Error('permit transaction not found by RPC after 20 tries');
    if (!rc.success || !prc.success) throw new Error('tx not successful');
    const log = rc.transfers.find((t) => t.to === treasury);
    if (!log) throw new Error('no MUSD Transfer to the treasury');
    if (log.from !== getAddress(payer)) throw new Error('payer mismatch');
    if (log.value !== parseEther(musd)) throw new Error(`amount ${formatEther(log.value)} != ledger ${musd}`);
    total += log.value; ok++;
  } catch (e) { bad.push(`${tx}: ${e.message}`); }
}
const bal = await pub.readContract({ address: MUSD.address, abi: parseAbi(['function balanceOf(address) view returns (uint256)']), functionName: 'balanceOf', args: [treasury] });
console.log(JSON.stringify({ rows: rows.length, verifiedOnChain: ok, failed: bad.length, ledgerTotalMusd: formatEther(total), treasuryBalanceMusd: formatEther(bal), unclaimedInTreasuryMusd: formatEther(bal - total), balanceMatchesLedger: bal === total }, null, 1));
if (bad.length) console.log(bad.join('\n'));
// A balance above the ledger total means MUSD arrived that the gateway never matched to a served call (see evidence/unclaimed.md).
process.exit(bad.length || bal < total ? 1 : 0);

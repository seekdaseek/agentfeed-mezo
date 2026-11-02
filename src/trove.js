// Fund an agent's budget from the owner's own Mezo trove: the bitcoin stays where it is, the owner signs one off-chain
// WithdrawMUSD message, and the bot submits Mezo's own BorrowerOperationsSignatures.withdrawMUSDWithSignature, which mints
// MUSD straight to the agent's wallet.
//
// THE FLOOR IS CHECKED OFF-CHAIN. Mezo itself only enforces a minimum collateral ratio of 110%. The owner's floor (default
// 200%) is enforced here, by this bot, from fresh reads right before it submits. A price move or another transaction
// between that read and the block is not covered, and nothing on-chain would stop a draw this bot did not make. An
// on-chain floor would need its own contract; this does not have one.
import { getAddress, isAddress, isHex, parseAbi, recoverTypedDataAddress, createWalletClient, http, fallback } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mezoChain, TRANSFER_TOPIC } from './chain.js';
import { fmtMusd } from './botcore.js';

export const WITHDRAW_TYPES = {
  WithdrawMUSD: [
    { name: 'amount', type: 'uint256' }, { name: 'borrower', type: 'address' }, { name: 'recipient', type: 'address' },
    { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
  ],
};

const PCT = 10n ** 18n; // Mezo ratios are 1e18 = 100%
export const ratioPct = (coll, price, debt) => (debt === 0n ? null : (coll * price * 100n) / (debt * PCT)); // whole percent, rounded down

// Pure floor rule. coll in BTC wei, price in USD per BTC at 1e18, debts in MUSD wei.
export function floorCheck({ coll, price, debt, drawWei, feeWei, floorPct }) {
  const nowPct = ratioPct(coll, price, debt);
  const afterDebt = debt + drawWei + feeWei;
  const afterPct = ratioPct(coll, price, afterDebt);
  return { ok: afterPct >= BigInt(floorPct), nowPct, afterPct, afterDebt };
}

const ABI = parseAbi([
  'function fetchPrice() view returns (uint256)',
  'function getEntireDebtAndColl(address) view returns (uint256 coll, uint256 principal, uint256 interest, uint256 pendingCollateral, uint256 pendingPrincipal, uint256 pendingInterest)',
  'function getTroveStatus(address) view returns (uint8)',
  'function checkRecoveryMode(uint256) view returns (bool)',
  'function getBorrowingFee(uint256) view returns (uint256)',
  'function getNonce(address) view returns (uint256)',
  'function eip712Domain() view returns (bytes1, string, string, uint256, address, bytes32, uint256[])',
  'function getApproxHint(uint256 _CR, uint256 _numTrials, uint256 _inputRandomSeed) view returns (address, uint256, uint256)',
  'function findInsertPosition(uint256 _NICR, address _prevId, address _nextId) view returns (address, address)',
  'function withdrawMUSDWithSignature(uint256 _amount, address _upperHint, address _lowerHint, address _borrower, address _recipient, bytes _signature, uint256 _deadline)',
]);

// Real chain operations for one Mezo network. Tests pass a fake with the same method names.
export function makeTroveOps(net, reader) {
  const b = net.borrow;
  const pub = reader.pub;
  const rd = (address, functionName, args = []) => pub.readContract({ address, abi: ABI, functionName, args });
  const urls = net.rpcUrls;
  const chain = mezoChain(net.chainId, urls[0], net.label);
  const submitter = privateKeyToAccount(net.settlerKey);
  const wallet = createWalletClient({ account: submitter, chain, transport: urls.length > 1 ? fallback(urls.map((u) => http(u, { retryCount: 1 })), { rank: false }) : http(urls[0]) });
  return {
    submitterAddress: submitter.address,
    price: () => rd(b.priceFeed, 'fetchPrice'),
    async trove(addr) {
      const [status, e] = await Promise.all([rd(b.troveManager, 'getTroveStatus', [addr]), rd(b.troveManager, 'getEntireDebtAndColl', [addr])]);
      return { status: Number(status), coll: e[0] + e[3], debt: e[1] + e[2] + e[4] + e[5] };
    },
    recovery: (price) => rd(b.troveManager, 'checkRecoveryMode', [price]),
    fee: (amount) => rd(b.borrowerOperations, 'getBorrowingFee', [amount]),
    nonce: (addr) => rd(b.signatures, 'getNonce', [addr]),
    async domain() { const d = await rd(b.signatures, 'eip712Domain'); return { name: d[1], version: d[2], chainId: Number(d[3]), verifyingContract: d[4] }; },
    async hints(coll, debt) {
      const nicr = (coll * 10n ** 20n) / debt;
      const [hint] = await rd(b.hintHelpers, 'getApproxHint', [nicr, 15n, 42n]);
      const [upper, lower] = await rd(b.sortedTroves, 'findInsertPosition', [nicr, hint, hint]);
      return { upper, lower };
    },
    simulate: (a) => pub.simulateContract({ address: b.signatures, abi: ABI, functionName: 'withdrawMUSDWithSignature', args: [a.amount, a.upper, a.lower, a.borrower, a.recipient, a.signature, a.deadline], account: submitter.address }),
    submit: (a) => wallet.writeContract({ address: b.signatures, abi: ABI, functionName: 'withdrawMUSDWithSignature', args: [a.amount, a.upper, a.lower, a.borrower, a.recipient, a.signature, a.deadline], gas: 1_500_000n }),
    receipt: (hash) => reader.transferReceipt(hash),
  };
}

// The typed data an owner signs. Used by the bot (to show it) and by scripts/owner-sign-draw.mjs (to sign it).
export const drawTypedData = ({ domain, amount, borrower, recipient, nonce, deadline }) =>
  ({ domain, types: WITHDRAW_TYPES, primaryType: 'WithdrawMUSD', message: { amount, borrower, recipient, nonce, deadline } });

export function makeTrove({ agents, opsFor }) {
  const refuse = (m) => `Draw refused, nothing was sent on-chain: ${m}`;

  async function draw({ ownerTg, agent, amountWei, troveAddress, deadline, signature, net, now }) {
    if (!net.borrow) return refuse(`${net.label} has no Mezo Borrow.`);
    if (!isAddress(troveAddress || '')) return refuse('the trove address is not an address.');
    if (!isHex(signature || '') || signature.length !== 132) return refuse('the signature must be a 65-byte hex signature.');
    if (!(deadline > now + 60) || deadline > now + 86400) return refuse('the deadline must be between 1 minute and 24 hours from now.');
    const ops = opsFor(net);
    const borrower = getAddress(troveAddress), recipient = getAddress(agent.address);

    let price, t, fee, nonce, domain;
    try { [price, t, fee, nonce, domain] = await Promise.all([ops.price(), ops.trove(borrower), ops.fee(amountWei), ops.nonce(borrower), ops.domain()]); }
    catch (e) { return refuse(`could not read ${net.label}: ${e.shortMessage || e.message}`); }
    if (t.status !== 1) return refuse(`${borrower} has no active trove on ${net.label}.`);

    // The signature must be the borrower's, over exactly this amount, this recipient (the agent wallet), this nonce and deadline.
    let signer;
    try { signer = await recoverTypedDataAddress({ ...drawTypedData({ domain, amount: amountWei, borrower, recipient, nonce, deadline: BigInt(deadline) }), signature }); } catch { return refuse('the signature could not be read.'); }
    if (signer.toLowerCase() !== borrower.toLowerCase()) return refuse('the signature was not made by the trove owner for this amount, recipient, nonce and deadline. Get the exact text from /drawmsg.');

    // The floor, off-chain, from the reads above.
    const f = floorCheck({ coll: t.coll, price, debt: t.debt, drawWei: amountWei, feeWei: fee, floorPct: agent.floor_pct });
    if (!f.ok) return refuse(`it would leave the trove at ${f.afterPct}% collateral ratio, below your floor of ${agent.floor_pct}% (it is ${f.nowPct}% now). Draw less or add collateral.`);
    if (await ops.recovery(price).catch(() => false)) return refuse('Mezo is in Recovery Mode right now.');

    let hints;
    try { hints = await ops.hints(t.coll, f.afterDebt); } catch (e) { return refuse(`could not compute hints: ${e.shortMessage || e.message}`); }
    const args = { amount: amountWei, upper: hints.upper, lower: hints.lower, borrower, recipient, signature, deadline: BigInt(deadline) };
    try { await ops.simulate(args); } catch (e) { return refuse(`Mezo would revert it: ${e.shortMessage || e.message}`); }

    let hash;
    try { hash = await ops.submit(args); } catch (e) { return refuse(`submit failed: ${e.shortMessage || e.message}`); }
    const rc = await ops.receipt(hash);
    if (!rc || rc.status !== 'success') return `The draw transaction ${hash} did not succeed on ${net.label}; the budget was not credited.`;
    const minted = rc.logs.filter((l) => l.topics?.[0] === TRANSFER_TOPIC && l.topics.length === 3 && `0x${l.topics[2].slice(26)}`.toLowerCase() === recipient.toLowerCase() && l.address.toLowerCase() === net.asset.address.toLowerCase())
      .reduce((x, l) => x + BigInt(l.data), 0n);
    if (minted === 0n) return `The draw transaction ${hash} succeeded but no MUSD reached the agent wallet; the budget was not credited.`;
    const r = agents.topup(agent, { kind: 'topup-draw', amountWei: minted, network: net.network, txHash: `${net.network}:${hash}`, note: `trove ${borrower}`, now });
    if (!r.ok) return r.message;
    const after = await ops.trove(borrower).catch(() => null);
    const label = net.mainnet ? 'MAINNET' : 'TESTNET (test MUSD)';
    return `Drew ${fmtMusd(minted)} MUSD from ${borrower}'s trove on ${net.label} [${label}] into ${agent.name}. ${net.explorer}/tx/${hash}\nYour bitcoin did not move. Collateral ratio ${f.nowPct}% -> ${after ? ratioPct(after.coll, price, after.debt) : f.afterPct}% (floor ${agent.floor_pct}%, checked by this bot off-chain right before it submitted).\nBudget left ${fmtMusd(agents.state(agent, now).remaining)} MUSD.`;
  }
  // What the owner's trove wallet must sign (shown by /drawmsg): exact typed data as JSON, plus the CLI that signs it.
  async function drawMessage({ agent, amountWei, troveAddress, net, now }) {
    if (!net.borrow) return `${net.label} has no Mezo Borrow.`;
    const ops = opsFor(net);
    const borrower = getAddress(troveAddress), recipient = getAddress(agent.address);
    let nonce, domain;
    try { [nonce, domain] = await Promise.all([ops.nonce(borrower), ops.domain()]); } catch (e) { return `Could not read ${net.label}: ${e.shortMessage || e.message}`; }
    const deadline = now + 3600;
    const td = drawTypedData({ domain, amount: amountWei, borrower, recipient, nonce, deadline: BigInt(deadline) });
    const json = JSON.stringify(td, (k, v) => (typeof v === 'bigint' ? v.toString() : v));
    return `Sign this EIP-712 message with the trove wallet ${borrower} (valid 1 hour, deadline ${deadline}). The MUSD is minted to ${agent.name}'s wallet ${recipient}; the bitcoin stays in the trove.\n\n${json}\n\nWith this repo: OWNER_PRIVATE_KEY=0x... node scripts/owner-sign-draw.mjs ${agent.name} ${net.key} ${amountWei} ${recipient}\nThen: /draw ${agent.name} ${fmtMusd(amountWei)} ${borrower} ${deadline} <signature> ${net.key}`;
  }
  return { draw, drawMessage };
}

// Payment verification for the two MUSD schemes. Pure logic over the chain adapter, no HTTP.
//   permit   : the agent signs an EIP-2612 Permit (spender = the gateway's settler key). The gateway settles
//              with permit() + transferFrom() and pays the gas. MUSD has no EIP-3009, so x402 "exact" is not possible.
//   transfer : the agent sends a plain MUSD transfer to the treasury and presents the tx hash.
import { recoverTypedDataAddress, recoverMessageAddress, keccak256, isAddress, isHex, getAddress } from 'viem';
import { TRANSFER_TOPIC } from './chain.js';
import { checkNonce } from './challenge.js';

export const PERMIT_TYPES = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

export const permitDomain = (cfg) => ({
  name: cfg.musd.name,
  version: cfg.musd.version,
  chainId: cfg.chainId,
  verifyingContract: getAddress(cfg.musd.address),
});

const fail = (code, message) => ({ ok: false, code, message });
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const big = (v) => { try { return BigInt(v); } catch { return null; } };

export function splitSignature(sig) {
  if (!isHex(sig) || sig.length !== 132) return null;
  const r = `0x${sig.slice(2, 66)}`;
  const s = `0x${sig.slice(66, 130)}`;
  let v = parseInt(sig.slice(130, 132), 16);
  if (v < 27) v += 27;
  return { r, s, v };
}

// Checks shared by both schemes: network, token, recipient, echoed amount, challenge nonce.
export function checkEnvelope({ cfg, route, price, payment, now }) {
  if (!payment || typeof payment !== 'object') return fail('malformed_payment', 'payment header is not a JSON object');
  if (payment.scheme !== 'permit' && payment.scheme !== 'transfer') return fail('unsupported_scheme', 'scheme must be "permit" or "transfer"');
  if (payment.network !== cfg.network) return fail('wrong_network', `this gateway settles on ${cfg.network} (Mezo testnet), not ${payment.network}`);
  if (!same(payment.asset, cfg.musd.address)) return fail('wrong_asset', `only MUSD at ${cfg.musd.address} is accepted`);
  if (!same(payment.payTo, cfg.treasury)) return fail('wrong_recipient', `payTo must be the treasury ${cfg.treasury}`);
  if (payment.amount != null) {
    const a = big(payment.amount);
    if (a == null) return fail('malformed_payment', 'amount is not an integer');
    if (a < price) return fail('underpaid', `price is ${price} wei MUSD, payment declares ${a}`);
  }
  const n = checkNonce({ secret: cfg.challengeSecret, nonce: payment.nonce, routeId: route.id, amountWei: price, now });
  if (!n.ok) return fail(n.code, n.code === 'nonce_expired' ? 'challenge expired, request a new 402' : 'nonce does not match this route and price');
  return { ok: true, issuedAt: n.issuedAt, expiresAt: n.expiresAt };
}

export async function verifyPermit({ cfg, chain, store, price, payment, env, now }) {
  const p = payment.payload || {};
  if (!isAddress(p.owner || '')) return fail('malformed_payment', 'payload.owner is not an address');
  const owner = getAddress(p.owner);
  const value = big(p.value);
  const deadline = big(p.deadline);
  if (value == null || deadline == null) return fail('malformed_payment', 'payload.value and payload.deadline must be integers');
  const sig = splitSignature(p.signature);
  if (!sig) return fail('malformed_payment', 'payload.signature must be a 65-byte hex signature');

  if (!same(p.spender, chain.settlerAddress)) return fail('wrong_spender', `permit spender must be the settler ${chain.settlerAddress}`);
  if (value < price) return fail('underpaid', `price is ${price} wei MUSD, permit value is ${value}`);
  if (value > price) return fail('overpaid', 'permit value must equal the price exactly, so no allowance is left over');
  if (deadline < BigInt(now + 5)) return fail('permit_expired', 'permit deadline has passed');
  if (deadline > BigInt(env.expiresAt + 60)) return fail('deadline_too_long', 'permit deadline must not outlive the challenge');

  const keys = [`sig:${keccak256(p.signature)}`, `ch:${payment.nonce}`];
  if (keys.some((k) => store.isUsed(k))) return fail('payment_replayed', 'this signature or challenge was already used');

  const permitNonce = await chain.permitNonce(owner);
  keys.push(`pn:${owner.toLowerCase()}:${permitNonce}`);
  if (store.isUsed(keys[2])) return fail('payment_replayed', 'this permit nonce was already settled');

  let recovered;
  try {
    recovered = await recoverTypedDataAddress({
      domain: permitDomain(cfg), types: PERMIT_TYPES, primaryType: 'Permit',
      message: { owner, spender: chain.settlerAddress, value, nonce: permitNonce, deadline },
      signature: p.signature,
    });
  } catch { return fail('bad_signature', 'signature could not be recovered'); }
  if (!same(recovered, owner)) return fail('bad_signature', 'signature does not recover to payload.owner for the current permit nonce on Mezo testnet');

  if ((await chain.balanceOf(owner)) < value) return fail('insufficient_balance', 'owner holds less MUSD than the price');
  try {
    await chain.simulatePermit({ owner, spender: chain.settlerAddress, value, deadline, ...sig });
  } catch (e) { return fail('permit_rejected', `MUSD.permit would revert: ${e.shortMessage || e.message}`); }

  return { ok: true, keys, owner, value, deadline, ...sig, lockKey: owner.toLowerCase() };
}

const topicAddr = (t) => `0x${t.slice(26)}`;

// Anyone can see a transfer to the treasury on-chain, so the payer also signs this claim; the gateway
// requires it to recover to the transfer's sender, which stops a third party presenting someone else's tx.
export const claimMessage = (nonce, txHash) => `AgentFeed-Mezo claim\nnonce:${nonce}\ntx:${txHash.toLowerCase()}`;

export async function verifyTransfer({ cfg, chain, store, price, payment, env }) {
  const hash = payment.payload?.txHash;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash || '')) return fail('malformed_payment', 'payload.txHash must be a 32-byte hex hash');
  const keys = [`tx:${hash.toLowerCase()}`, `ch:${payment.nonce}`];
  if (keys.some((k) => store.isUsed(k))) return fail('payment_replayed', 'this tx hash or challenge was already used');

  const rc = await chain.transferReceipt(hash);
  if (!rc) return fail('tx_not_found', 'no receipt for this hash on Mezo testnet (wrong chain, or not mined yet)');
  if (rc.status !== 'success') return fail('tx_failed', 'transaction reverted');
  if (rc.confirmations < cfg.confirmations) return fail('not_enough_confirmations', `need ${cfg.confirmations}, have ${rc.confirmations}`);
  if (rc.timestamp < env.issuedAt - 10) return fail('tx_before_challenge', 'transfer is older than the challenge, pay after the 402');

  const transfers = rc.logs.filter((l) => l.topics?.[0] === TRANSFER_TOPIC && l.topics.length === 3);
  const toTreasury = transfers.filter((l) => same(topicAddr(l.topics[2]), cfg.treasury));
  const good = toTreasury.find((l) => same(l.address, cfg.musd.address));
  if (!good) {
    if (toTreasury.length) return fail('wrong_asset', 'the treasury received a token other than MUSD');
    if (transfers.some((l) => same(l.address, cfg.musd.address))) return fail('wrong_recipient', `the MUSD transfer did not go to the treasury ${cfg.treasury}`);
    return fail('no_matching_transfer', 'no MUSD Transfer event in this transaction');
  }
  const value = BigInt(good.data);
  if (value < price) return fail('underpaid', `price is ${price} wei MUSD, transfer is ${value}`);
  const payer = getAddress(topicAddr(good.topics[1]));
  let claimant;
  try {
    claimant = await recoverMessageAddress({ message: claimMessage(payment.nonce, hash), signature: payment.payload.signature });
  } catch { return fail('claim_signature_invalid', 'payload.signature must sign the claim message for this nonce and tx'); }
  if (!same(claimant, payer)) return fail('claim_signature_invalid', 'claim signature does not recover to the sender of the MUSD transfer');
  return { ok: true, keys, owner: payer, value, txHash: hash, lockKey: null };
}

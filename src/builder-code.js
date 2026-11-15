// src/builder-code.js: the Base Builder Code (ERC-8021 transaction attribution) for every Base mainnet transaction THIS code sends itself.
//
// ochinimus' code on dashboard.base.org (project AgentFeed) is bc_g6qgnam4. ERC-8021 appends a data suffix to a transaction's calldata:
//   <codes, ASCII, comma separated><codesLength, 1 byte><schemaId, 1 byte = 0x00><ercMarker, 16 bytes = 0x80218021802180218021802180218021>
// so Base's indexers can attribute the transaction to the builder. The suffix is read from the END of the calldata and ignored by the callee (ABI decoding of a
// fixed-argument function reads only the bytes it needs), so it changes nothing about what the call does.
//
// Scope: Base mainnet (chain 8453) ONLY. dataSuffixFor(chainId) is undefined for every other chain (Mezo testnet 31611, Mezo mainnet 31612), so nothing is appended there.
// Transactions another party submits (a payment the Coinbase facilitator sends for an x402 EIP-3009 authorization) are not ours and carry no suffix.
//
// Use it two ways: createWalletClient({ ..., dataSuffix: dataSuffixFor(chain.id) }) (viem appends it to every sendTransaction / writeContract of that client), or, for a raw send that
// builds its own calldata, appendSuffix(data, chainId).
import { concat } from 'viem';
import { Attribution } from 'ox/erc8021';

export const BASE_CHAIN_ID = 8453;
export const BASE_BUILDER_CODE = 'bc_g6qgnam4';
/** 0x62635f673671676e616d340b0080218021802180218021802180218021 */
export const BASE_DATA_SUFFIX = Attribution.toDataSuffix({ codes: [BASE_BUILDER_CODE] });

/** the suffix for a chain: BASE_DATA_SUFFIX on Base mainnet, undefined anywhere else */
export const dataSuffixFor = (chainId) => (Number(chainId) === BASE_CHAIN_ID ? BASE_DATA_SUFFIX : undefined);

/** `data` (hex calldata, '0x' for a plain transfer) with the suffix appended when the chain is Base mainnet; unchanged elsewhere. For raw sends that build their own calldata. */
export const appendSuffix = (data, chainId) => {
  const s = dataSuffixFor(chainId);
  return s ? concat([data || '0x', s]) : (data || '0x');
};

/** the builder codes an on-chain calldata carries, or null when it has no ERC-8021 suffix */
export const codesOf = (data) => { try { const a = Attribution.fromData(data); return a ? a.codes : null; } catch { return null; } };

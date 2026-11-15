// Nov 11 2026, on Sergiu's explicit yes: forward 0.00002 ETH on Base from base-agent to the fresh mainnet funder for Base gas.
// Destination is read from .secrets/wallets-mainnet.json (role funder-base-mezo), amount is fixed, nothing else is sent.
//   node scripts/forward-base-eth.mjs          dry run (balances, nonce, estimated gas)
//   node scripts/forward-base-eth.mjs --send   do it
import { createPublicClient, createWalletClient, http, fallback, parseEther, formatEther } from 'viem';
import { BASE_DATA_SUFFIX } from '../src/builder-code.js';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import fs from 'node:fs';

const AMOUNT = parseEther('0.00002');
const send = process.argv.includes('--send');
const w2 = JSON.parse(fs.readFileSync(new URL('../.secrets/wallets-wave2.json', import.meta.url), 'utf8'));
const wm = JSON.parse(fs.readFileSync(new URL('../.secrets/wallets-mainnet.json', import.meta.url), 'utf8'));
const from = privateKeyToAccount(fs.readFileSync(w2['base-agent'].keyFile, 'utf8').trim());
if (from.address.toLowerCase() !== w2['base-agent'].address.toLowerCase()) throw new Error('base-agent key does not match its address');
const to = wm['funder-base-mezo'].address;
const transport = fallback([http('https://mainnet.base.org', { retryCount: 1 }), http('https://base.drpc.org', { retryCount: 1 })], { rank: false });
const pub = createPublicClient({ chain: base, transport });
const [b0, d0] = await Promise.all([pub.getBalance({ address: from.address }), pub.getBalance({ address: to })]);
const gas = await pub.estimateGas({ account: from.address, to, value: AMOUNT });
console.log(JSON.stringify({ from: from.address, to, amountEth: formatEther(AMOUNT), fromBalanceEth: formatEther(b0), toBalanceEth: formatEther(d0), estGas: String(gas) }));
if (!send) process.exit(0);
const hash = await createWalletClient({ account: from, chain: base, transport, dataSuffix: BASE_DATA_SUFFIX }).sendTransaction({ to, value: AMOUNT });
const r = await pub.waitForTransactionReceipt({ hash });
const [b1, d1] = await Promise.all([pub.getBalance({ address: from.address }), pub.getBalance({ address: to })]);
console.log(JSON.stringify({ status: r.status, tx: `https://basescan.org/tx/${hash}`, gasUsed: String(r.gasUsed), fromBalanceEth: formatEther(b1), toBalanceEth: formatEther(d1) }));

// Send MUSD from treasury-hot back to base-agent on Base, so evidence runs need no new money. Only these two wallets, nothing else.
//   node scripts/recycle-base.mjs [amount in MUSD | all] [--send]      dry run unless --send
import { createPublicClient, createWalletClient, http, fallback, parseAbi, parseUnits, formatUnits, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import fs from 'node:fs';

const MUSD = '0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186';
const w = JSON.parse(fs.readFileSync(new URL('../.secrets/wallets-wave2.json', import.meta.url), 'utf8'));
const from = privateKeyToAccount(w['treasury-hot'].key);
const to = w['base-agent'].address;
if (from.address.toLowerCase() !== w['treasury-hot'].address.toLowerCase()) throw new Error('treasury-hot key does not match its address');
const transport = fallback([http('https://mainnet.base.org', { retryCount: 1 }), http('https://base.drpc.org', { retryCount: 1 })], { rank: false });
const pub = createPublicClient({ chain: base, transport });
const wallet = createWalletClient({ account: from, chain: base, transport });
const abi = parseAbi(['function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)']);
const bal = await pub.readContract({ address: MUSD, abi, functionName: 'balanceOf', args: [from.address] });
const arg = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'all';
const amount = arg === 'all' ? bal : parseUnits(arg, 18);
const eth0 = await pub.getBalance({ address: from.address });
console.log(JSON.stringify({ from: from.address, to, treasuryMusd: formatUnits(bal, 18), sending: formatUnits(amount, 18), treasuryEth: formatEther(eth0) }));
if (!process.argv.includes('--send')) process.exit(0);
if (amount <= 0n || amount > bal) throw new Error('nothing to send, or more than the balance');
const hash = await wallet.writeContract({ address: MUSD, abi, functionName: 'transfer', args: [to, amount] });
const r = await pub.waitForTransactionReceipt({ hash });
let eth1 = eth0; for (let i = 0; i < 15 && eth1 === eth0; i++) { eth1 = await pub.getBalance({ address: from.address }); if (eth1 === eth0) await new Promise((res) => setTimeout(res, 1000)); }
console.log('recycle', r.status, `https://basescan.org/tx/${hash}`, 'gasUsed', String(r.gasUsed), 'ETH spent', formatEther(eth0 - eth1));

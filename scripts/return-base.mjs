// END OF WAVE 2 ONLY, after the last Base evidence run. Turn every MUSD left in treasury-hot and base-agent back into USDC on
// Base (same PancakeSwap V3 pool) and send that USDC to the AgentFeed x402-test wallet, and to nowhere else.
//   node scripts/return-base.mjs            dry run: balances, quote, expected loss
//   node scripts/return-base.mjs --send     do it
// The destination is fixed in this file on purpose; there is no flag to change it.
import { createPublicClient, createWalletClient, http, fallback, parseAbi, formatUnits, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import fs from 'node:fs';

const DEST = '0x4e64ad598a70D47D33Aa1C6D7FC07d723dd3476e';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', MUSD = '0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186';
const ROUTER = '0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86', QUOTER = '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997', POOL_FEE = 100;
const START_USDC = 900000n + 10000n; // the payer began with 0.91 USDC (0.90 swapped, 0.01 left over)
const send = process.argv.includes('--send');

const w = JSON.parse(fs.readFileSync(new URL('../.secrets/wallets-wave2.json', import.meta.url), 'utf8'));
const agent = privateKeyToAccount(fs.readFileSync(w['base-agent'].keyFile, 'utf8').trim());
const treasury = privateKeyToAccount(w['treasury-hot'].key);
if (agent.address.toLowerCase() !== w['base-agent'].address.toLowerCase() || treasury.address.toLowerCase() !== w['treasury-hot'].address.toLowerCase()) throw new Error('a key does not match its address');

const transport = fallback([http('https://mainnet.base.org', { retryCount: 1 }), http('https://base.drpc.org', { retryCount: 1 })], { rank: false });
const pub = createPublicClient({ chain: base, transport });
const wallet = (acct) => createWalletClient({ account: acct, chain: base, transport });
const erc = parseAbi(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function transfer(address,uint256) returns (bool)']);
const quoter = [{ type: 'function', name: 'quoteExactInputSingle', stateMutability: 'nonpayable', inputs: [{ name: 'params', type: 'tuple', components: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'amountIn', type: 'uint256' }, { name: 'fee', type: 'uint24' }, { name: 'sqrtPriceLimitX96', type: 'uint160' }] }], outputs: [{ type: 'uint256' }, { type: 'uint160' }, { type: 'uint32' }, { type: 'uint256' }] }];
const router = [{ type: 'function', name: 'exactInputSingle', stateMutability: 'payable', inputs: [{ name: 'params', type: 'tuple', components: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'recipient', type: 'address' }, { name: 'amountIn', type: 'uint256' }, { name: 'amountOutMinimum', type: 'uint256' }, { name: 'sqrtPriceLimitX96', type: 'uint160' }] }], outputs: [{ type: 'uint256' }] }];
const bal = (t, a) => pub.readContract({ address: t, abi: erc, functionName: 'balanceOf', args: [a] });
const eth = (a) => pub.getBalance({ address: a });

const [tM, aM, aU, e0t, e0a] = await Promise.all([bal(MUSD, treasury.address), bal(MUSD, agent.address), bal(USDC, agent.address), eth(treasury.address), eth(agent.address)]);
const total = tM + aM;
const quote = total > 0n ? (await pub.simulateContract({ address: QUOTER, abi: quoter, functionName: 'quoteExactInputSingle', args: [{ tokenIn: MUSD, tokenOut: USDC, amountIn: total, fee: POOL_FEE, sqrtPriceLimitX96: 0n }] })).result[0] : 0n;
const minOut = (quote * 995n) / 1000n;
console.log(JSON.stringify({ destination: DEST, treasuryMusd: formatUnits(tM, 18), agentMusd: formatUnits(aM, 18), agentUsdc: formatUnits(aU, 6), swapMusd: formatUnits(total, 18), quoteUsdc: formatUnits(quote, 6), minOutUsdc: formatUnits(minOut, 6), wouldSendUsdc: formatUnits(aU + quote, 6), startedWithUsdc: formatUnits(START_USDC, 6) }, null, 1));
if (!send) process.exit(0);
if (total === 0n) throw new Error('no MUSD to swap');

const log = [];
const wait = async (label, hash) => { const r = await pub.waitForTransactionReceipt({ hash }); log.push({ label, status: r.status, tx: `https://basescan.org/tx/${hash}`, gasUsed: String(r.gasUsed) }); console.log(label, r.status, `https://basescan.org/tx/${hash}`); if (r.status !== 'success') throw new Error(`${label} failed`); };
// 1. gather the MUSD in the payer wallet
if (tM > 0n) await wait('treasury-hot -> base-agent (MUSD)', await wallet(treasury).writeContract({ address: MUSD, abi: erc, functionName: 'transfer', args: [agent.address, tM] }));
// 2. approve exactly the amount, then swap MUSD -> USDC with 0.5% slippage; the proceeds stay in the payer wallet
const swapIn = await (async () => { for (let i = 0; i < 20; i++) { const b = await bal(MUSD, agent.address); if (b >= total) return b; await new Promise((r) => setTimeout(r, 1000)); } return total; })();
if ((await pub.readContract({ address: MUSD, abi: erc, functionName: 'allowance', args: [agent.address, ROUTER] })) < swapIn) await wait('approve MUSD', await wallet(agent).writeContract({ address: MUSD, abi: erc, functionName: 'approve', args: [ROUTER, swapIn] }));
for (let i = 0; i < 20; i++) { if ((await pub.readContract({ address: MUSD, abi: erc, functionName: 'allowance', args: [agent.address, ROUTER] })) >= swapIn) break; await new Promise((r) => setTimeout(r, 1000)); }
const before = await bal(USDC, agent.address);
await wait('swap MUSD -> USDC', await wallet(agent).writeContract({ address: ROUTER, abi: router, functionName: 'exactInputSingle', args: [{ tokenIn: MUSD, tokenOut: USDC, fee: POOL_FEE, recipient: agent.address, amountIn: swapIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }] }));
let usdc = before; for (let i = 0; i < 20 && usdc === before; i++) { usdc = await bal(USDC, agent.address); if (usdc === before) await new Promise((r) => setTimeout(r, 1000)); }
// 3. send all USDC the payer wallet holds to the destination, and only there
await wait('USDC -> destination', await wallet(agent).writeContract({ address: USDC, abi: erc, functionName: 'transfer', args: [DEST, usdc] }));
const [e1t, e1a] = await Promise.all([eth(treasury.address), eth(agent.address)]);
const ethPx = Number((await (await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot')).json()).data.amount);
const gas = Number(formatEther((e0t - e1t) + (e0a - e1a)));
const returned = Number(formatUnits(usdc, 6)), started = Number(formatUnits(START_USDC, 6));
console.log(JSON.stringify({ returnedUsdc: returned, startedWithUsdc: started, lostToSwapFeesAndSlippageUsdc: +(started - returned).toFixed(6), gasEthThisStep: gas, gasUsdThisStep: +(gas * ethPx).toFixed(5), txs: log }, null, 1));

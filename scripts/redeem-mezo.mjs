// Nov 12 2026, on Sergiu's explicit instruction: redeem the Base->Mezo MUSD Portal transfer on Mezo mainnet.
// Auto-relay to Mezo is off, so the signed VAA is fetched from Wormholescan and handed to the Mezo WormholeTransceiver
// (receiveMessage is permissionless; the sender pays BTC gas). Signer = mezo-mainnet-settler.
//   node scripts/redeem-mezo.mjs <base-tx-hash>           dry run (VAA, simulation)
//   node scripts/redeem-mezo.mjs <base-tx-hash> --send
import { createPublicClient, createWalletClient, http, fallback, parseAbi, formatUnits, formatEther, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import fs from 'node:fs';

const tx = process.argv[2], send = process.argv.includes('--send');
if (!/^0x[0-9a-fA-F]{64}$/.test(tx ?? '')) throw new Error('usage: node scripts/redeem-mezo.mjs <base-tx-hash> [--send]');
const MUSD = '0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186', TRANSCEIVER = '0x62DEeaFEe06c7442A21c93edeDc79A0cb5791C83';
const wm = JSON.parse(fs.readFileSync(new URL('../.secrets/wallets-mainnet.json', import.meta.url), 'utf8'));
const account = privateKeyToAccount(wm['mezo-mainnet-settler'].key);
if (account.address.toLowerCase() !== wm['mezo-mainnet-settler'].address.toLowerCase()) throw new Error('settler key does not match its address');
const agent = wm['mezo-mainnet-agent'].address;
const mezo = defineChain({ id: 31612, name: 'Mezo', nativeCurrency: { name: 'BTC', symbol: 'BTC', decimals: 18 }, rpcUrls: { default: { http: ['https://mezo-mainnet.boar.network'] } }, blockExplorers: { default: { name: 'Mezo', url: 'https://explorer.mezo.org' } } });
const transport = fallback([http('https://mezo-mainnet.boar.network', { retryCount: 1 }), http('https://mainnet.mezo.public.validationcloud.io', { retryCount: 1 }), http('https://rpc-http.mezo.boar.network', { retryCount: 1 })], { rank: false });
const pub = createPublicClient({ chain: mezo, transport });
const wallet = createWalletClient({ account, chain: mezo, transport });
const erc = parseAbi(['function balanceOf(address) view returns (uint256)']);
const tr = parseAbi(['function receiveMessage(bytes encodedMessage)']);

const op = (await (await fetch(`https://api.wormholescan.io/api/v1/operations?txHash=${tx}`)).json()).operations?.[0];
if (!op) throw new Error('Wormholescan has no operation for this tx yet');
const vaaUrl = `https://api.wormholescan.io/api/v1/vaas/${op.id}`;
const vj = await (await fetch(vaaUrl)).json();
const b64 = vj.data?.vaa;
if (!b64) throw new Error(`no signed VAA yet (${op.id}); status ${op.sourceChain?.status}; retry later`);
const vaa = '0x' + Buffer.from(b64, 'base64').toString('hex');
const [btc, agentMusd, gp] = await Promise.all([pub.getBalance({ address: account.address }), pub.readContract({ address: MUSD, abi: erc, functionName: 'balanceOf', args: [agent] }), pub.getGasPrice()]);
console.log(JSON.stringify({ op: op.id, vaaBytes: (vaa.length - 2) / 2, settler: account.address, settlerBtc: formatEther(btc), agent, agentMusdBefore: formatUnits(agentMusd, 18), gasPriceWei: String(gp) }));
const g = await pub.estimateContractGas({ account, address: TRANSCEIVER, abi: tr, functionName: 'receiveMessage', args: [vaa] });
console.log('simulation ok, est gas', String(g), 'cost BTC', formatEther(g * gp));
if (!send) process.exit(0);
if (btc < g * gp * 2n) throw new Error('settler has too little BTC for the redeem');
const h = await wallet.writeContract({ address: TRANSCEIVER, abi: tr, functionName: 'receiveMessage', args: [vaa], gas: (g * 13n) / 10n });
const r = await pub.waitForTransactionReceipt({ hash: h });
let after = agentMusd; for (let i = 0; i < 20 && after === agentMusd; i++) { after = await pub.readContract({ address: MUSD, abi: erc, functionName: 'balanceOf', args: [agent] }); if (after === agentMusd) await new Promise((res) => setTimeout(res, 1500)); }
console.log('redeem', r.status, `https://explorer.mezo.org/tx/${h}`, 'gasUsed', String(r.gasUsed), 'BTC paid', formatEther(r.gasUsed * r.effectiveGasPrice), 'agent MUSD', formatUnits(after, 18), 'settler BTC left', formatEther(await pub.getBalance({ address: account.address })));

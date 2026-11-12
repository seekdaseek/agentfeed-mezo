// Nov 12 2026, on Sergiu's explicit instruction: bridge the full tBTC balance of the fresh Ethereum funder to Mezo mainnet,
// recipient = the mainnet settler. approve exactly the amount to the MezoBridge proxy, then bridgeTBTC(amount, recipient).
//   node scripts/bridge-tbtc-eth.mjs          dry run (balances, minimum, gas, simulation)
//   node scripts/bridge-tbtc-eth.mjs --send   do it
import { createPublicClient, createWalletClient, http, fallback, parseAbi, formatUnits, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import fs from 'node:fs';

const BRIDGE = '0xF6680EA3b480cA2b72D96ea13cCAF2cFd8e6908c', TBTC = '0x18084fbA666a33d37592fA2633fD49a74DD93a88';
const send = process.argv.includes('--send');
const wm = JSON.parse(fs.readFileSync(new URL('../.secrets/wallets-mainnet.json', import.meta.url), 'utf8'));
const account = privateKeyToAccount(wm['funder-ethereum'].key);
if (account.address.toLowerCase() !== wm['funder-ethereum'].address.toLowerCase()) throw new Error('funder-ethereum key does not match its address');
const recipient = wm['mezo-mainnet-settler'].address;
const transport = fallback([http('https://ethereum-rpc.publicnode.com', { retryCount: 1 }), http('https://eth.drpc.org', { retryCount: 1 })], { rank: false });
const pub = createPublicClient({ chain: mainnet, transport });
const wallet = createWalletClient({ account, chain: mainnet, transport });
const erc = parseAbi(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)']);
const br = parseAbi(['function minTBTCAmount() view returns (uint256)', 'function bridgeTBTC(uint256 amount, address recipient)']);
const [bal, eth, min, allowance, gp] = await Promise.all([
  pub.readContract({ address: TBTC, abi: erc, functionName: 'balanceOf', args: [account.address] }), pub.getBalance({ address: account.address }),
  pub.readContract({ address: BRIDGE, abi: br, functionName: 'minTBTCAmount' }), pub.readContract({ address: TBTC, abi: erc, functionName: 'allowance', args: [account.address, BRIDGE] }), pub.getGasPrice(),
]);
console.log(JSON.stringify({ from: account.address, recipient, bridge: BRIDGE, tbtc: formatUnits(bal, 18), min: formatUnits(min, 18), eth: formatEther(eth), allowance: formatUnits(allowance, 18), gasPriceGwei: formatUnits(gp, 9) }));
if (bal < min) throw new Error('balance below the live bridge minimum');
if (allowance < bal) {
  const g = await pub.estimateContractGas({ account, address: TBTC, abi: erc, functionName: 'approve', args: [BRIDGE, bal] });
  console.log('estimated approve gas', String(g), 'cost ETH', formatEther(g * gp));
} else {
  const sim = await pub.simulateContract({ account, address: BRIDGE, abi: br, functionName: 'bridgeTBTC', args: [bal, recipient] });
  console.log('bridge simulation ok; est gas', String(await pub.estimateContractGas({ account, address: BRIDGE, abi: br, functionName: 'bridgeTBTC', args: [bal, recipient] })), sim.request.functionName);
}
if (!send) process.exit(0);
if (allowance < bal) {
  const h = await wallet.writeContract({ address: TBTC, abi: erc, functionName: 'approve', args: [BRIDGE, bal] });
  const r = await pub.waitForTransactionReceipt({ hash: h });
  console.log('approve', r.status, `https://etherscan.io/tx/${h}`, 'gasUsed', String(r.gasUsed));
  for (let i = 0; i < 30; i++) { const a = await pub.readContract({ address: TBTC, abi: erc, functionName: 'allowance', args: [account.address, BRIDGE] }); if (a >= bal) break; await new Promise((res) => setTimeout(res, 1500)); }
}
const h = await wallet.writeContract({ address: BRIDGE, abi: br, functionName: 'bridgeTBTC', args: [bal, recipient] });
const r = await pub.waitForTransactionReceipt({ hash: h });
const AL = '0x75aa5616721471b8ab0c49ce59500cbad2b7ef1ad10e5eb9449c693c0a5c8fd1';
const log = r.logs.find((l) => l.topics[0] === AL);
console.log('bridgeTBTC', r.status, `https://etherscan.io/tx/${h}`, 'gasUsed', String(r.gasUsed), 'block', String(r.blockNumber), 'AssetsLocked', log ? { seq: BigInt(log.topics[1]).toString(), recipient: '0x' + log.topics[2].slice(26), amount: formatUnits(BigInt(log.data), 18) } : 'NOT FOUND');
console.log('ETH left', formatEther(await pub.getBalance({ address: account.address })), 'tBTC left', formatUnits(await pub.readContract({ address: TBTC, abi: erc, functionName: 'balanceOf', args: [account.address] }), 18));

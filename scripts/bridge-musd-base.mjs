// Nov 12 2026, on Sergiu's explicit instruction. Fresh Base funder (role funder-base-mezo in .secrets/wallets-mainnet.json):
//   swap   all USDC -> MUSD on the PancakeSwap V3 fee-100 pool used on Nov 2 (0.5% slippage floor)
//   bridge approve the Wormhole NTT manager and transfer all MUSD to Wormhole chain 50 (Mezo), recipient = the mainnet agent.
//          Instruction 0x01010101 = one instruction, transceiver registry index 1 (index 0 was removed, so index 1 is the only enabled one),
//          payload 0x01 = skip the relayer. Auto-relay to Mezo is off, so the redeem on Mezo is sent by hand afterwards.
//   node scripts/bridge-musd-base.mjs swap            dry run
//   node scripts/bridge-musd-base.mjs swap --send
//   node scripts/bridge-musd-base.mjs bridge          dry run (simulates the transfer)
//   node scripts/bridge-musd-base.mjs bridge --send
import { createPublicClient, createWalletClient, http, fallback, parseAbi, formatUnits, formatEther, pad } from 'viem';
import { BASE_DATA_SUFFIX } from '../src/builder-code.js';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import fs from 'node:fs';

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', MUSD = '0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186';
const POOL = '0xa0EED82e20caB62a5698E898e9Fd4c4db412EE7E', ROUTER = '0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86', QUOTER = '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997', FACTORY = '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865';
const NTT = '0x3EB418BdBE95b4b9cf465ecfBD8424685ACD1Bc1', MEZO_WH_CHAIN = 50, INSTR = '0x01010101';
const stage = process.argv[2], send = process.argv.includes('--send');
if (!['swap', 'bridge'].includes(stage)) throw new Error('usage: node scripts/bridge-musd-base.mjs swap|bridge [--send]');
const wm = JSON.parse(fs.readFileSync(new URL('../.secrets/wallets-mainnet.json', import.meta.url), 'utf8'));
const account = privateKeyToAccount(wm['funder-base-mezo'].key);
if (account.address.toLowerCase() !== wm['funder-base-mezo'].address.toLowerCase()) throw new Error('funder-base-mezo key does not match its address');
const agent = wm['mezo-mainnet-agent'].address;
const transport = fallback([http('https://mainnet.base.org', { retryCount: 1 }), http('https://base.drpc.org', { retryCount: 1 })], { rank: false });
const pub = createPublicClient({ chain: base, transport });
const wallet = createWalletClient({ account, chain: base, transport, dataSuffix: BASE_DATA_SUFFIX });
const erc = parseAbi(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)']);
const pool = parseAbi(['function factory() view returns (address)', 'function fee() view returns (uint24)']);
const quoter = [{ type: 'function', name: 'quoteExactInputSingle', stateMutability: 'nonpayable', inputs: [{ name: 'params', type: 'tuple', components: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'amountIn', type: 'uint256' }, { name: 'fee', type: 'uint24' }, { name: 'sqrtPriceLimitX96', type: 'uint160' }] }], outputs: [{ name: 'amountOut', type: 'uint256' }, { name: 'sqrtPriceX96After', type: 'uint160' }, { name: 'initializedTicksCrossed', type: 'uint32' }, { name: 'gasEstimate', type: 'uint256' }] }];
const router = [{ type: 'function', name: 'exactInputSingle', stateMutability: 'payable', inputs: [{ name: 'params', type: 'tuple', components: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'recipient', type: 'address' }, { name: 'amountIn', type: 'uint256' }, { name: 'amountOutMinimum', type: 'uint256' }, { name: 'sqrtPriceLimitX96', type: 'uint160' }] }], outputs: [{ name: 'amountOut', type: 'uint256' }] }];
const ntt = parseAbi(['function transfer(uint256 amount, uint16 recipientChain, bytes32 recipient, bytes32 refundAddress, bool shouldQueue, bytes transceiverInstructions) payable returns (uint64)']);
const waitAllowance = async (token, spender, min) => { for (let i = 0; i < 30; i++) { const a = await pub.readContract({ address: token, abi: erc, functionName: 'allowance', args: [account.address, spender] }); if (a >= min) return; await new Promise((r) => setTimeout(r, 1500)); } throw new Error('allowance not visible'); };
const [eth, usdc, musd, gp] = await Promise.all([pub.getBalance({ address: account.address }), pub.readContract({ address: USDC, abi: erc, functionName: 'balanceOf', args: [account.address] }), pub.readContract({ address: MUSD, abi: erc, functionName: 'balanceOf', args: [account.address] }), pub.getGasPrice()]);
console.log(JSON.stringify({ stage, funder: account.address, ethBalance: formatEther(eth), usdc: formatUnits(usdc, 6), musd: formatUnits(musd, 18), gasPriceGwei: formatUnits(gp, 9) }));

if (stage === 'swap') {
  if (usdc === 0n) throw new Error('no USDC');
  const [pf, fee] = await Promise.all([pub.readContract({ address: POOL, abi: pool, functionName: 'factory' }), pub.readContract({ address: POOL, abi: pool, functionName: 'fee' })]);
  if (pf.toLowerCase() !== FACTORY.toLowerCase()) throw new Error('pool is not from the PancakeSwap V3 factory');
  const q = await pub.simulateContract({ address: QUOTER, abi: quoter, functionName: 'quoteExactInputSingle', args: [{ tokenIn: USDC, tokenOut: MUSD, amountIn: usdc, fee, sqrtPriceLimitX96: 0n }] });
  const minOut = (q.result[0] * 995n) / 1000n;
  console.log(JSON.stringify({ quoteMusd: formatUnits(q.result[0], 18), minOutMusd: formatUnits(minOut, 18), fee }));
  if (!send) process.exit(0);
  const allowance = await pub.readContract({ address: USDC, abi: erc, functionName: 'allowance', args: [account.address, ROUTER] });
  if (allowance < usdc) {
    const h = await wallet.writeContract({ address: USDC, abi: erc, functionName: 'approve', args: [ROUTER, usdc] });
    const r = await pub.waitForTransactionReceipt({ hash: h });
    console.log('approve USDC', r.status, `https://basescan.org/tx/${h}`, 'gasUsed', String(r.gasUsed));
    await waitAllowance(USDC, ROUTER, usdc);
  }
  const h = await wallet.writeContract({ address: ROUTER, abi: router, functionName: 'exactInputSingle', args: [{ tokenIn: USDC, tokenOut: MUSD, fee, recipient: account.address, amountIn: usdc, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }] });
  const r = await pub.waitForTransactionReceipt({ hash: h });
  let m = 0n; for (let i = 0; i < 20 && m === 0n; i++) { m = await pub.readContract({ address: MUSD, abi: erc, functionName: 'balanceOf', args: [account.address] }); if (m === 0n) await new Promise((res) => setTimeout(res, 1000)); }
  console.log('swap', r.status, `https://basescan.org/tx/${h}`, 'gasUsed', String(r.gasUsed), 'MUSD', formatUnits(m, 18), 'ETH left', formatEther(await pub.getBalance({ address: account.address })));
} else {
  if (musd === 0n) throw new Error('no MUSD');
  const recipient = pad(agent, { size: 32 }), refund = pad(account.address, { size: 32 });
  const amt = musd - (musd % 10n ** 10n); // NTT trims to 8 decimals and reverts on dust, so send a multiple of 1e10 wei; the sub-1e-8 remainder stays on the funder
  const args = [amt, MEZO_WH_CHAIN, recipient, refund, false, INSTR];
  const allowance = await pub.readContract({ address: MUSD, abi: erc, functionName: 'allowance', args: [account.address, NTT] });
  console.log(JSON.stringify({ ntt: NTT, toWormholeChain: MEZO_WH_CHAIN, recipientAgent: agent, amountMusd: formatUnits(amt, 18), allowance: formatUnits(allowance, 18) }));
  if (allowance >= amt) { // can simulate the transfer only once the allowance exists
    const g = await pub.estimateContractGas({ account, address: NTT, abi: ntt, functionName: 'transfer', args });
    console.log('transfer simulation ok, est gas', String(g));
  } else console.log('allowance not yet set: transfer is simulated right after the approve, before it is sent');
  if (!send) process.exit(0);
  if (allowance < amt) {
    const h = await wallet.writeContract({ address: MUSD, abi: erc, functionName: 'approve', args: [NTT, amt] });
    const r = await pub.waitForTransactionReceipt({ hash: h });
    console.log('approve MUSD', r.status, `https://basescan.org/tx/${h}`, 'gasUsed', String(r.gasUsed));
    await waitAllowance(MUSD, NTT, amt);
  }
  const g = await pub.estimateContractGas({ account, address: NTT, abi: ntt, functionName: 'transfer', args }); // throws here, before sending, if the call would revert
  const h = await wallet.writeContract({ address: NTT, abi: ntt, functionName: 'transfer', args, gas: (g * 12n) / 10n });
  const r = await pub.waitForTransactionReceipt({ hash: h });
  console.log('NTT transfer', r.status, `https://basescan.org/tx/${h}`, 'gasUsed', String(r.gasUsed), 'msg.value 0 (Wormhole core fee on Base is 0)', 'ETH left', formatEther(await pub.getBalance({ address: account.address })), 'MUSD left', formatUnits(await pub.readContract({ address: MUSD, abi: erc, functionName: 'balanceOf', args: [account.address] }), 18));
}

// Buy MUSD on Base with USDC through PancakeSwap V3 (the deepest pool whose factory is the canonical one):
//   node scripts/swap-base.mjs [--amount 0.90]            dry run: pool facts, quote, gas needed
//   node scripts/swap-base.mjs [--amount 0.90] --send     approve exactly the amount, then swap with 0.5% slippage
// The signer is the base-agent wallet from .secrets/wallets-wave2.json (a pointer to a key file, never printed).
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits, formatUnits, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import fs from 'node:fs';

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', MUSD = '0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186';
const POOL = '0xa0EED82e20caB62a5698E898e9Fd4c4db412EE7E', ROUTER = '0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86', QUOTER = '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997', FACTORY = '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const send = process.argv.includes('--send');
const amountIn = parseUnits(arg('--amount', '0.90'), 6);

const w = JSON.parse(fs.readFileSync(new URL('../.secrets/wallets-wave2.json', import.meta.url), 'utf8'));
const key = fs.readFileSync(w['base-agent'].keyFile, 'utf8').trim();
const account = privateKeyToAccount(key);
if (account.address.toLowerCase() !== w['base-agent'].address.toLowerCase()) throw new Error('base-agent key does not match its address');

const pub = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') });
const wallet = createWalletClient({ account, chain: base, transport: http('https://mainnet.base.org') });
const erc = parseAbi(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)']);
const pool = parseAbi(['function factory() view returns (address)', 'function fee() view returns (uint24)', 'function liquidity() view returns (uint128)']);
const quoter = [{ type: 'function', name: 'quoteExactInputSingle', stateMutability: 'nonpayable', inputs: [{ name: 'params', type: 'tuple', components: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'amountIn', type: 'uint256' }, { name: 'fee', type: 'uint24' }, { name: 'sqrtPriceLimitX96', type: 'uint160' }] }], outputs: [{ name: 'amountOut', type: 'uint256' }, { name: 'sqrtPriceX96After', type: 'uint160' }, { name: 'initializedTicksCrossed', type: 'uint32' }, { name: 'gasEstimate', type: 'uint256' }] }];
const router = [{ type: 'function', name: 'exactInputSingle', stateMutability: 'payable', inputs: [{ name: 'params', type: 'tuple', components: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'recipient', type: 'address' }, { name: 'amountIn', type: 'uint256' }, { name: 'amountOutMinimum', type: 'uint256' }, { name: 'sqrtPriceLimitX96', type: 'uint160' }] }], outputs: [{ name: 'amountOut', type: 'uint256' }] }];

const [poolFactory, fee, eth, usdcBal, allowance, gasPrice] = await Promise.all([
  pub.readContract({ address: POOL, abi: pool, functionName: 'factory' }), pub.readContract({ address: POOL, abi: pool, functionName: 'fee' }),
  pub.getBalance({ address: account.address }), pub.readContract({ address: USDC, abi: erc, functionName: 'balanceOf', args: [account.address] }),
  pub.readContract({ address: USDC, abi: erc, functionName: 'allowance', args: [account.address, ROUTER] }), pub.getGasPrice(),
]);
if (poolFactory.toLowerCase() !== FACTORY.toLowerCase()) throw new Error('pool does not belong to the PancakeSwap V3 factory');
const q = await pub.simulateContract({ address: QUOTER, abi: quoter, functionName: 'quoteExactInputSingle', args: [{ tokenIn: USDC, tokenOut: MUSD, amountIn, fee, sqrtPriceLimitX96: 0n }] });
const quote = q.result[0];
const minOut = (quote * 995n) / 1000n;
console.log(JSON.stringify({ agent: account.address, pool: POOL, fee, ethBalance: formatEther(eth), usdcBalance: formatUnits(usdcBal, 6), amountInUsdc: formatUnits(amountIn, 6), quoteMusd: formatUnits(quote, 18), minOutMusd: formatUnits(minOut, 18), gasPriceWei: String(gasPrice), allowanceUsdc: formatUnits(allowance, 6) }, null, 1));
if (!send) process.exit(0);
if (usdcBal < amountIn) throw new Error('not enough USDC');
if (eth === 0n) throw new Error('no ETH for gas');
const gasBefore = eth;
if (allowance < amountIn) {
  const h = await wallet.writeContract({ address: USDC, abi: erc, functionName: 'approve', args: [ROUTER, amountIn] });
  const r = await pub.waitForTransactionReceipt({ hash: h });
  console.log('approve', r.status, `https://basescan.org/tx/${h}`, 'gasUsed', String(r.gasUsed));
}
const h = await wallet.writeContract({ address: ROUTER, abi: router, functionName: 'exactInputSingle', args: [{ tokenIn: USDC, tokenOut: MUSD, fee, recipient: account.address, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }] });
const r = await pub.waitForTransactionReceipt({ hash: h });
const musd = await pub.readContract({ address: MUSD, abi: erc, functionName: 'balanceOf', args: [account.address] });
const ethAfter = await pub.getBalance({ address: account.address });
console.log('swap', r.status, `https://basescan.org/tx/${h}`, 'MUSD balance', formatUnits(musd, 18), 'ETH spent on gas (approve+swap, incl. L1 fee)', formatEther(gasBefore - ethAfter));

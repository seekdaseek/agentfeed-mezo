// Read-only: balances of the fresh mainnet hot wallets on Ethereum, Base and Mezo mainnet, by RPC. Addresses only, no keys.
//   node scripts/mainnet-balances.mjs
import { createPublicClient, http, fallback, parseAbi, formatUnits, formatEther, defineChain } from 'viem';
import { mainnet, base } from 'viem/chains';
import fs from 'node:fs';

const wm = JSON.parse(fs.readFileSync(new URL('../.secrets/wallets-mainnet.json', import.meta.url), 'utf8'));
const A = Object.fromEntries(Object.entries(wm).map(([k, v]) => [k, v.address]));
const mezo = defineChain({ id: 31612, name: 'Mezo', nativeCurrency: { name: 'BTC', symbol: 'BTC', decimals: 18 }, rpcUrls: { default: { http: ['https://mezo-mainnet.boar.network'] } } });
const erc = parseAbi(['function balanceOf(address) view returns (uint256)']);
const eth = createPublicClient({ chain: mainnet, transport: fallback([http('https://ethereum-rpc.publicnode.com'), http('https://eth.drpc.org')], { rank: false }) });
const bas = createPublicClient({ chain: base, transport: fallback([http('https://mainnet.base.org'), http('https://base.drpc.org')], { rank: false }) });
const mez = createPublicClient({ chain: mezo, transport: fallback([http('https://mezo-mainnet.boar.network'), http('https://mainnet.mezo.public.validationcloud.io'), http('https://rpc-http.mezo.boar.network')], { rank: false }) });
const TBTC = '0x18084fbA666a33d37592fA2633fD49a74DD93a88', USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', MUSD = '0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186';
const out = {};
out.ethereum = { funderEthereum: A['funder-ethereum'], eth: formatEther(await eth.getBalance({ address: A['funder-ethereum'] })), tbtc: formatUnits(await eth.readContract({ address: TBTC, abi: erc, functionName: 'balanceOf', args: [A['funder-ethereum']] }), 18), block: String(await eth.getBlockNumber()) };
out.base = { funderBaseMezo: A['funder-base-mezo'], eth: formatEther(await bas.getBalance({ address: A['funder-base-mezo'] })), usdc: formatUnits(await bas.readContract({ address: USDC, abi: erc, functionName: 'balanceOf', args: [A['funder-base-mezo']] }), 6), musd: formatUnits(await bas.readContract({ address: MUSD, abi: erc, functionName: 'balanceOf', args: [A['funder-base-mezo']] }), 18), block: String(await bas.getBlockNumber()) };
out.mezo = { block: String(await mez.getBlockNumber()) };
for (const r of ['mezo-mainnet-settler', 'mezo-mainnet-agent', 'mezo-mainnet-treasury']) out.mezo[r] = { address: A[r], btc: formatEther(await mez.getBalance({ address: A[r] })), musd: formatUnits(await mez.readContract({ address: MUSD, abi: erc, functionName: 'balanceOf', args: [A[r]] }), 18) };
console.log(JSON.stringify(out, null, 1));

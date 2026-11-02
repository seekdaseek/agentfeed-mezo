// Mezo-native data sold per call: where MUSD trades against a dollar, and how safe one trove is. Both are read from the
// chains on request (nothing cached beyond the call), with the block and the contracts named so a buyer can re-read them.
import { createPublicClient, http, fallback, parseAbi, formatUnits, getAddress, isAddress } from 'viem';
import { NETWORK_DEFS } from './config.js';

const MUSD = '0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186';
const E18 = 10n ** 18n;

// ---- pure arithmetic, tested without a network ----
// deviation of a quote from one dollar, in basis points (negative = MUSD sells for less than a dollar)
export const devBps = (usdPerMusd) => Math.round((usdPerMusd - 1) * 10000);
// price in USD per BTC at which this trove falls to the 110% liquidation line, and how far below the current price that is
export function liquidation({ coll, debt, price, mcr = 11n * E18 / 10n }) {
  if (coll === 0n) return null;
  const liqPrice = (debt * mcr) / coll; // 1e18-scaled USD per BTC
  const distancePct = price > 0n ? Number(((price - liqPrice) * 10000n) / price) / 100 : null;
  return { liqPrice, distancePct };
}
export const icrPct = (coll, price, debt) => (debt === 0n ? null : Number((coll * price * 10000n) / (debt * E18)) / 100);

const clientFor = (key) => {
  const urls = NETWORK_DEFS[key].rpcUrls;
  return createPublicClient({ transport: urls.length > 1 ? fallback(urls.map((u) => http(u, { retryCount: 1, timeout: 10000 })), { rank: false }) : http(urls[0], { timeout: 10000 }) });
};
const clients = {};
const client = (key) => (clients[key] ||= clientFor(key));

const POOL_ABI = parseAbi(['function getAmountOut(uint256,address) view returns (uint256)', 'function getReserves() view returns (uint256,uint256,uint256)']);
const FEED = parseAbi(['function fetchPrice() view returns (uint256)']);
const QUOTER = [{ type: 'function', name: 'quoteExactInputSingle', stateMutability: 'nonpayable', inputs: [{ name: 'params', type: 'tuple', components: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'amountIn', type: 'uint256' }, { name: 'fee', type: 'uint24' }, { name: 'sqrtPriceLimitX96', type: 'uint160' }] }], outputs: [{ name: 'amountOut', type: 'uint256' }, { name: 'sqrtPriceX96After', type: 'uint160' }, { name: 'initializedTicksCrossed', type: 'uint32' }, { name: 'gasEstimate', type: 'uint256' }] }];

// Mezo mainnet Solidly-style pools (docs: mezo.org/docs/users/resources/contracts-reference) and the Base PancakeSwap V3 pool.
const MEZO_POOLS = [
  { venue: 'mezo-dex MUSD/mUSDC (stable)', pool: '0xEd812AEc0Fecc8fD882Ac3eccC43f3aA80A6c356', quoteSymbol: 'mUSDC', quoteDecimals: 6 },
  { venue: 'mezo-dex MUSD/mUSDT (stable)', pool: '0x10906a9E9215939561597b4C8e4b98F93c02031A', quoteSymbol: 'mUSDT', quoteDecimals: 6 },
];
const BTC_POOL = '0x52e604c44417233b6CcEDDDc0d640A405Caacefb';
const MAIN_FEED = NETWORK_DEFS['mezo-mainnet'].borrow.priceFeed;

async function quoteMezo(mz, p, sizeMusd) {
  const out = await mz.readContract({ address: p.pool, abi: POOL_ABI, functionName: 'getAmountOut', args: [BigInt(sizeMusd) * E18, MUSD] });
  return Number(formatUnits(out, p.quoteDecimals)) / sizeMusd; // dollars per MUSD, treating mUSDC and mUSDT as a dollar each
}

export async function pegReport() {
  const mz = client('mezo-mainnet'), bs = client('base');
  const [block, price] = await Promise.all([mz.getBlockNumber(), mz.readContract({ address: MAIN_FEED, abi: FEED, functionName: 'fetchPrice' })]);
  const venues = [];
  for (const p of MEZO_POOLS) {
    const [small, large] = await Promise.all([quoteMezo(mz, p, 1), quoteMezo(mz, p, 100)]);
    const [r0, r1] = await mz.readContract({ address: p.pool, abi: POOL_ABI, functionName: 'getReserves' });
    const quoteReserve = Number(formatUnits(p.venue.includes('mUSDC') ? r0 : r1, 6));
    venues.push({ venue: p.venue, chain: 'Mezo mainnet', pool: p.pool, quote_asset: p.quoteSymbol, sell_1_musd_usd: small, sell_100_musd_usd: large, deviation_bps_1: devBps(small), deviation_bps_100: devBps(large), quote_side_reserve: Math.round(quoteReserve) });
  }
  // MUSD/BTC priced through Mezo's own BTC oracle: how many dollars of BTC one MUSD buys
  const btcOut = await mz.readContract({ address: BTC_POOL, abi: POOL_ABI, functionName: 'getAmountOut', args: [E18, MUSD] });
  const viaBtc = Number(formatUnits(btcOut, 18)) * Number(formatUnits(price, 18));
  venues.push({ venue: 'mezo-dex MUSD/BTC (volatile), valued with Mezo PriceFeed', chain: 'Mezo mainnet', pool: BTC_POOL, quote_asset: 'BTC', sell_1_musd_usd: viaBtc, deviation_bps_1: devBps(viaBtc), note: 'depends on the oracle price, which is itself the number the trove system uses' });
  // Base PancakeSwap V3, MUSD to USDC
  try {
    const BASE_QUOTER = '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997', USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
    const q = async (n) => Number(formatUnits((await bs.simulateContract({ address: BASE_QUOTER, abi: QUOTER, functionName: 'quoteExactInputSingle', args: [{ tokenIn: MUSD, tokenOut: USDC, amountIn: BigInt(n) * E18, fee: 100, sqrtPriceLimitX96: 0n }] })).result[0], 6)) / n;
    const [s1, s100] = await Promise.all([q(1), q(100)]);
    venues.push({ venue: 'pancakeswap-v3 MUSD/USDC 0.01%', chain: 'Base', pool: '0xa0EED82e20caB62a5698E898e9Fd4c4db412EE7E', quote_asset: 'USDC', sell_1_musd_usd: s1, sell_100_musd_usd: s100, deviation_bps_1: devBps(s1), deviation_bps_100: devBps(s100) });
  } catch (e) { venues.push({ venue: 'pancakeswap-v3 MUSD/USDC 0.01%', chain: 'Base', error: 'quote failed' }); }
  const ok = venues.filter((v) => v.sell_1_musd_usd);
  const worst = ok.reduce((w, v) => (Math.abs(v.deviation_bps_1) > Math.abs(w.deviation_bps_1) ? v : w), ok[0]);
  return {
    as_of: new Date().toISOString(), mezo_block: Number(block), unit: 'USD received for selling MUSD, 1 MUSD and 100 MUSD; mUSDC, mUSDT and USDC are counted as one dollar each',
    musd_address: MUSD, venues, worst_deviation_bps: worst ? worst.deviation_bps_1 : null, worst_venue: worst ? worst.venue : null,
    best_venue: ok.length ? ok.reduce((x, v) => (v.sell_1_musd_usd > x.sell_1_musd_usd ? v : x), ok[0]).venue : null,
    venues_within_100_bps: `${ok.filter((v) => Math.abs(v.deviation_bps_1) <= 100).length} of ${ok.length}`,
    note: 'Quotes include each pool\'s swap fee, so a stable pool sits a few bps under a dollar even when MUSD is fine; thin pools also move on size, so read the 100 MUSD column too',
  };
}

const TM_ABI = parseAbi(['function getEntireDebtAndColl(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)', 'function getTroveStatus(address) view returns (uint8)', 'function getTroveOwnersCount() view returns (uint256)', 'function checkRecoveryMode(uint256) view returns (bool)', 'function MCR() view returns (uint256)']);
const TM_OWNERS = parseAbi(['function getTroveFromTroveOwnersArray(uint256) view returns (address)']);
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const IC_ABI = parseAbi(['function getCurrentICR(address,uint256) view returns (uint256)']);

export async function troveHealth({ address, network = 'mainnet' }) {
  if (!isAddress(address || '')) throw Object.assign(new Error('address is not an EVM address'), { status: 400 });
  const key = network === 'testnet' ? 'mezo-testnet' : 'mezo-mainnet';
  const b = NETWORK_DEFS[key].borrow, c = client(key);
  const who = getAddress(address);
  const [block, status, price] = await Promise.all([c.getBlockNumber(), c.readContract({ address: b.troveManager, abi: TM_ABI, functionName: 'getTroveStatus', args: [who] }), c.readContract({ address: b.priceFeed, abi: FEED, functionName: 'fetchPrice' })]);
  if (Number(status) !== 1) return { network: key, mezo_block: Number(block), address: who, has_trove: false, note: 'no active trove for this address on this network' };
  const [e, icr, count, recovery] = await Promise.all([
    c.readContract({ address: b.troveManager, abi: TM_ABI, functionName: 'getEntireDebtAndColl', args: [who] }),
    c.readContract({ address: b.troveManager, abi: IC_ABI, functionName: 'getCurrentICR', args: [who, price] }),
    c.readContract({ address: b.troveManager, abi: TM_ABI, functionName: 'getTroveOwnersCount' }),
    c.readContract({ address: b.troveManager, abi: TM_ABI, functionName: 'checkRecoveryMode', args: [price] }),
  ]);
  const coll = e[0] + e[3], debt = e[1] + e[2] + e[4] + e[5];
  const liq = liquidation({ coll, debt, price });
  // Redemption queue: Mezo redeems the lowest collateral ratios first (troves under 110% are liquidated, not redeemed).
  // Read every trove's ratio and debt with Multicall3 (a few RPC calls, not hundreds) and add up the debt that sits below this one.
  const MAX_TROVES = 1500;
  let ahead = 0n, trovesAhead = 0, complete = Number(count) <= MAX_TROVES;
  if (complete) {
    const mc = (contracts) => c.multicall({ contracts, allowFailure: false, multicallAddress: MULTICALL3, batchSize: 32_768 });
    const owners = await mc(Array.from({ length: Number(count) }, (_, i) => ({ address: b.troveManager, abi: TM_OWNERS, functionName: 'getTroveFromTroveOwnersArray', args: [BigInt(i)] })));
    const [icrs, debts] = await Promise.all([
      mc(owners.map((o) => ({ address: b.troveManager, abi: IC_ABI, functionName: 'getCurrentICR', args: [o, price] }))),
      mc(owners.map((o) => ({ address: b.troveManager, abi: TM_ABI, functionName: 'getEntireDebtAndColl', args: [o] }))),
    ]);
    owners.forEach((o, i) => {
      if (o.toLowerCase() === who.toLowerCase()) return;
      if (icrs[i] >= (11n * E18) / 10n && icrs[i] < icr) { ahead += debts[i][1] + debts[i][2] + debts[i][4] + debts[i][5]; trovesAhead++; }
    });
  }
  return {
    network: key, mezo_block: Number(block), address: who, has_trove: true,
    collateral_btc: formatUnits(coll, 18), debt_musd: formatUnits(debt, 18), btc_price_usd: formatUnits(price, 18),
    collateral_ratio_pct: Number(formatUnits(icr, 16)), liquidation_price_usd: liq ? formatUnits(liq.liqPrice, 18) : null, distance_to_liquidation_pct: liq ? liq.distancePct : null,
    redemption: { troves_ahead: complete ? trovesAhead : null, musd_ahead: complete ? formatUnits(ahead, 18) : null, queue_walk_complete: complete, note: 'MUSD that Mezo would redeem from lower-ratio troves before touching this one' },
    system: { trove_count: Number(count), recovery_mode: recovery }, contracts: { troveManager: b.troveManager, priceFeed: b.priceFeed },
  };
}

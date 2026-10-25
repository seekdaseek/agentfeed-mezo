// The AgentFeed routes this gateway resells, priced in MUSD cents per call.
// Upstream list prices are $0.001-$0.02; the gateway calls them with a prepaid key at half price.
const CENT = 10n ** 16n; // 0.01 MUSD in wei (18 decimals)

export const ROUTES = [
  { id: 'sol-price', upstream: '/api/sol-price', cents: 1, params: {}, title: 'SOL spot price', description: 'Live SOL/USD spot price.' },
  { id: 'btc-price', upstream: '/api/btc-price', cents: 1, params: {}, title: 'BTC spot price', description: 'Live BTC/USD spot price.' },
  { id: 'liq-pulse', upstream: '/api/liq-pulse', cents: 1, params: {}, title: 'Liquidation pulse', description: 'What is being liquidated right now, in one small payload.' },
  { id: 'funding-pulse', upstream: '/api/funding-pulse', cents: 1, params: {}, title: 'Funding pulse', description: 'The most extreme perp funding rates right now.' },
  { id: 'liquidations', upstream: '/api/liquidations', cents: 2, params: { symbol: 'string', scope: 'string', limit: 'int', min_usd: 'number' }, title: 'Recent liquidations', description: 'Live liquidation tape across venues. Optional symbol, scope, limit, min_usd.' },
  { id: 'market-snapshot', upstream: '/api/market-snapshot', cents: 2, params: {}, title: 'Market snapshot', description: 'Crypto market snapshot in one call.' },
  { id: 'trade-context', upstream: '/api/trade-context', cents: 3, params: {}, title: 'Trade context', description: 'Crypto trading context in one call: prices, funding, liquidations.' },
  { id: 'summarize', upstream: '/api/summarize', cents: 5, params: { url: 'string!', length: 'string' }, title: 'Summarize a web page', description: 'Fixed-purpose language task: summarize the page at ?url=. Optional length.' },
];

export const priceWei = (route) => BigInt(route.cents) * CENT;
export const priceMusd = (route) => (route.cents / 100).toFixed(2);
export const findRoute = (id) => ROUTES.find((r) => r.id === id);

// Keep only declared params; reject a missing required one. Returns { ok, query } or { ok:false, error }.
export function cleanParams(route, searchParams) {
  const query = new URLSearchParams();
  for (const [name, spec] of Object.entries(route.params)) {
    const required = spec.endsWith('!');
    const type = spec.replace('!', '');
    const v = searchParams.get(name);
    if (v == null || v === '') {
      if (required) return { ok: false, error: `missing required query parameter: ${name}` };
      continue;
    }
    if (v.length > 2048) return { ok: false, error: `${name} is too long` };
    if (type === 'int' && !/^\d{1,6}$/.test(v)) return { ok: false, error: `${name} must be an integer` };
    if (type === 'number' && !/^\d{1,15}(\.\d{1,6})?$/.test(v)) return { ok: false, error: `${name} must be a number` };
    query.set(name, v);
  }
  return { ok: true, query };
}

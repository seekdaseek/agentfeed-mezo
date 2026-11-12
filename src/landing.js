const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Everything about the networks is rendered from `nets` (what the gateway really offers), Mezo mainnet first, then the others in config order.
const order = (nets) => [...nets].sort((a, b) => (a.key === 'mezo-mainnet' ? 0 : 1) - (b.key === 'mezo-mainnet' ? 0 : 1));
const list = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

export function landingHtml({ cfg, nets: allNets, routes, priceMusd, settler, settlerOf }) {
  const nets = order(allNets && allNets.length ? allNets : [{ key: 'mezo-testnet', network: cfg.network, chainId: cfg.chainId, label: 'Mezo testnet', explorer: cfg.explorer, asset: cfg.musd, treasury: cfg.treasury, surchargeCents: 0, mainnet: false }]);
  const names = nets.map((n) => n.label);
  const settlerFor = (n) => (settlerOf ? settlerOf(n) : settler);
  const surcharged = nets.filter((n) => n.surchargeCents > 0);
  const head = surcharged.map((n) => `<th class="n">${esc(n.label)}</th>`).join('');
  const rows = routes.map((r) => `<tr><td><code>/api/${esc(r.id)}</code></td><td>${esc(r.title)}</td><td class="n">${priceMusd(r)} MUSD</td>${surcharged.map((n) => `<td class="n">${priceMusd(r, n.surchargeCents)} MUSD</td>`).join('')}</tr>`).join('');
  const rule = (n) => (n.surchargeCents > 0 ? `route price + ${(n.surchargeCents / 100).toFixed(2)} MUSD for gas` : 'route price');
  const link = (n, kind, a) => `<a href="${esc(n.explorer)}/${kind}/${esc(a)}"><code class="addr">${esc(a)}</code></a>`;
  const netRows = nets.map((n) => `<tr><td><b>${esc(n.label)}</b>${n.mainnet ? '' : ' <span class="mut">(test money)</span>'}</td><td class="n">${esc(n.chainId)}</td><td>${esc(rule(n))}</td><td>${link(n, 'address', settlerFor(n))}</td><td>${link(n, 'token', n.asset.address)}</td><td>${link(n, 'address', n.treasury)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgentFeed on Mezo: pay per call in MUSD</title>
<meta name="description" content="Live AgentFeed market data for AI agents, paid per call in MUSD on ${esc(list(names))}.">
<style>
:root{--bg:#0e0f13;--fg:#e8e6e3;--mut:#9a9aa3;--card:#16181f;--line:#262a35;--acc:#f7931a;--ok:#4cd08a}
@media (prefers-color-scheme:light){:root{--bg:#f6f5f2;--fg:#17181c;--mut:#5d5f69;--card:#fff;--line:#e0ded8;--acc:#c46a00;--ok:#13804a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 16px 64px}h1{font-size:28px;margin:0 0 6px}h2{font-size:18px;margin:32px 0 10px}
p{margin:8px 0}.mut{color:var(--mut)}code,pre{font:13px/1.5 ui-monospace,Menlo,monospace}pre{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;overflow-x:auto}
code{background:var(--card);padding:1px 5px;border-radius:5px}pre code{background:none;padding:0}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}td,th{padding:9px 12px;text-align:left;border-bottom:1px solid var(--line)}tr:last-child td{border:0}.n{text-align:right;white-space:nowrap}
.scroll{overflow-x:auto}
.stats{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0}.stat{flex:1 1 150px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.stat b{display:block;font-size:24px;color:var(--acc)}
a{color:var(--acc)}.addr{word-break:break-all}
</style></head><body><main>
<h1>AgentFeed on Mezo</h1>
<p class="mut">A live crypto data API for AI agents. Pay per call in <b>MUSD</b>, Mezo's Bitcoin-backed stablecoin. No account, no API key, and with the permit scheme no gas for the agent.</p>
<div class="stats"><div class="stat"><b id="n">...</b>paid calls settled</div><div class="stat"><b id="m">...</b>MUSD settled</div><div class="stat"><b id="p">...</b>distinct payers</div></div>
<h2>Try it</h2>
<pre><code>curl -i ${esc(cfg.publicUrl)}/api/sol-price</code></pre>
<p>Answers <code>402 Payment Required</code> with a <code>PAYMENT-REQUIRED</code> header naming MUSD on ${esc(list(names))}, the price, the treasury and a nonce. An agent signs an EIP-2612 permit (or sends a plain MUSD transfer), retries with <code>PAYMENT-SIGNATURE</code>, and gets the data plus an explorer link to the settlement.</p>
<pre><code>git clone https://github.com/seekdaseek/agentfeed-mezo &amp;&amp; cd agentfeed-mezo &amp;&amp; npm i
AGENT_PRIVATE_KEY=0x... node src/client.js sol-price</code></pre>
<h2>Networks</h2>
<div class="scroll"><table><tr><th>Network</th><th class="n">Chain id</th><th>Price</th><th>Settler (spender, pays gas)</th><th>MUSD</th><th>Treasury (receives MUSD)</th></tr>${netRows}</table></div>
<p class="mut">MUSD is 18 decimals with EIP-2612 permit. Mezo mainnet and Base are real money; Mezo testnet is test money. Live counts per network: <a href="/stats">stats</a>.</p>
<h2>Routes</h2>
<div class="scroll"><table><tr><th>Route</th><th>What</th><th class="n">Price</th>${head}</tr>${rows}</table></div>
<p class="mut">The first price column is the route price, used on every network without a gas surcharge.</p>
<p><a href="/.well-known/x402">manifest</a> · <a href="/stats">stats</a> · <a href="/payments.csv">every settled payment (csv)</a> · <a href="https://github.com/seekdaseek/agentfeed-mezo">source</a> · <a href="https://x402.ochinimus.app">AgentFeed</a></p>
<script>
fetch('/stats').then(r=>r.json()).then(s=>{n.textContent=s.settled_calls;m.textContent=s.musd_settled;p.textContent=s.distinct_payers}).catch(()=>{});
</script>
</main></body></html>`;
}

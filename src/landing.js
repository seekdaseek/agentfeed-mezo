const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function landingHtml({ cfg, routes, priceMusd, settler }) {
  const rows = routes.map((r) => `<tr><td><code>/api/${esc(r.id)}</code></td><td>${esc(r.title)}</td><td class="n">${priceMusd(r)} MUSD</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgentFeed on Mezo: pay per call in MUSD</title>
<meta name="description" content="Live AgentFeed market data for AI agents, paid per call in MUSD on Mezo testnet.">
<style>
:root{--bg:#0e0f13;--fg:#e8e6e3;--mut:#9a9aa3;--card:#16181f;--line:#262a35;--acc:#f7931a;--ok:#4cd08a}
@media (prefers-color-scheme:light){:root{--bg:#f6f5f2;--fg:#17181c;--mut:#5d5f69;--card:#fff;--line:#e0ded8;--acc:#c46a00;--ok:#13804a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 16px 64px}h1{font-size:28px;margin:0 0 6px}h2{font-size:18px;margin:32px 0 10px}
p{margin:8px 0}.mut{color:var(--mut)}code,pre{font:13px/1.5 ui-monospace,Menlo,monospace}pre{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;overflow-x:auto}
code{background:var(--card);padding:1px 5px;border-radius:5px}pre code{background:none;padding:0}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}td,th{padding:9px 12px;text-align:left;border-bottom:1px solid var(--line)}tr:last-child td{border:0}.n{text-align:right;white-space:nowrap}
.stats{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0}.stat{flex:1 1 150px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.stat b{display:block;font-size:24px;color:var(--acc)}
a{color:var(--acc)}.addr{word-break:break-all}
</style></head><body><main>
<h1>AgentFeed on Mezo</h1>
<p class="mut">A live crypto data API for AI agents. Pay per call in <b>MUSD</b>, Mezo's Bitcoin-backed stablecoin. No account, no API key, and with the permit scheme no gas for the agent.</p>
<div class="stats"><div class="stat"><b id="n">...</b>paid calls settled</div><div class="stat"><b id="m">...</b>MUSD settled</div><div class="stat"><b id="p">...</b>distinct payers</div></div>
<h2>Try it</h2>
<pre><code>curl -i ${esc(cfg.publicUrl)}/api/sol-price</code></pre>
<p>Answers <code>402 Payment Required</code> with a <code>PAYMENT-REQUIRED</code> header naming MUSD on Mezo testnet, the price, the treasury and a nonce. An agent signs an EIP-2612 permit (or sends a plain MUSD transfer), retries with <code>PAYMENT-SIGNATURE</code>, and gets the data plus an explorer link to the settlement.</p>
<pre><code>git clone https://github.com/seekdaseek/agentfeed-mezo &amp;&amp; cd agentfeed-mezo &amp;&amp; npm i
AGENT_PRIVATE_KEY=0x... node src/client.js sol-price</code></pre>
<h2>Routes</h2>
<table><tr><th>Route</th><th>What</th><th class="n">Price</th></tr>${rows}</table>
<h2>Where things are</h2>
<p>Network: Mezo testnet, <code>${esc(cfg.network)}</code>. Token: MUSD <code class="addr">${esc(cfg.musd.address)}</code> (18 decimals, EIP-2612).</p>
<p>Treasury (receives MUSD): <code class="addr">${esc(cfg.treasury)}</code><br>Settler (spender, pays gas): <code class="addr">${esc(settler)}</code></p>
<p><a href="/.well-known/x402">manifest</a> · <a href="/stats">stats</a> · <a href="/payments.csv">every settled payment (csv)</a> · <a href="https://github.com/seekdaseek/agentfeed-mezo">source</a> · <a href="https://x402.ochinimus.app">AgentFeed</a></p>
<script>
fetch('/stats').then(r=>r.json()).then(s=>{n.textContent=s.settled_calls;m.textContent=s.musd_settled;p.textContent=s.distinct_payers}).catch(()=>{});
</script>
</main></body></html>`;
}

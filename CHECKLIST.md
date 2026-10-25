**67 paid calls, 1.26 MUSD settled on Mezo testnet (chain 31611), each one a transaction on explorer.test.mezo.org, from a live API (AgentFeed) with 83 paid routes.** Counted from the gateway's own ledger at `/payments.csv` at the time of writing; the live number is at https://mezo.ochinimus.app/stats.

# Mezo Buildathon, Wave 1: submission checklist

Project: **agentfeed-mezo**, Track 2 (Access and Distribution). Repo: https://github.com/seekdaseek/agentfeed-mezo. Live: https://mezo.ochinimus.app. MIT.

## 1. Rubric, and where each point is met

| criterion (weight) | where it is met |
|---|---|
| **Mezo Integration (30%)**: depth over surface | MUSD is the settlement asset of a real payment protocol, not a badge. The 402 challenge names the MUSD contract and chain 31611; payments are EIP-2612 permits verified against MUSD's live EIP-712 domain, its on-chain `nonces()` and `balanceOf()`, simulated with `eth_call permit()`, then settled with `permit` + `transferFrom` on Mezo testnet. A second scheme verifies plain MUSD `Transfer` events. MUSD is minted for the demo through Mezo Borrow's `openTrove` (`scripts/fund-musd.mjs`). We found and documented that MUSD has no EIP-3009, which is why x402 `exact` cannot be used and permit is the design (README, "Why permit"). |
| **Product and Business Viability (30%)** | Track 2 question: make MUSD easier to use. AI agents are a new class of MUSD user that cannot sign up, hold API keys or hold gas. They get data for cents with only MUSD in the wallet. It extends a product that already sells: AgentFeed is live with real paid calls, 83 paid routes, an MCP server on the official registry and an elizaOS plugin, so MUSD becomes one more rail on existing demand rather than a new app looking for users. Wave 2 adds the Telegram bot that tops up and spends MUSD for agents (README, Wave 2). |
| **Technical Implementation (20%)** | Separate gateway service, production AgentFeed untouched. Replay ledger in sqlite on four keys, atomic reserve, restart-safe. Fetch-before-settle so an upstream outage never charges. HMAC-bound, expiring nonces. One in-flight permit per owner. Claim signature on the transfer scheme so third parties cannot claim someone else's payment. 52 tests (`npm test`) covering happy paths, replay, underpayment, wrong token, wrong chain, wrong recipient, expired nonce, upstream down. Deployed behind PM2 and its own Cloudflare tunnel. |
| **User Experience (10%)** | One curl shows the whole contract (402 with a base64 `PAYMENT-REQUIRED` header and the same JSON in the body). Client is one command; the MCP server gives an agent two tools. The agent signs one message and pays no gas. The client refuses a challenge for another token, network or a price above its cap. Landing page, manifest, `/stats` and a public CSV need no wallet. |
| **Submission Materials Quality (10%)** | README written as tech docs with a five-minute judge path, addresses and sample explorer links; this checklist; deck PDF (`deck/agentfeed-mezo-deck.pdf`); 2-minute pitch video narrated and captured against the live service; `SUBMISSION.md` with the form answers. |

## 2. Sponsor primitives used, by name

- **MUSD** (Mezo USD) testnet token `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503`: the payment asset; its `permit`, `nonces`, `balanceOf`, `transferFrom`, `transfer` and `Transfer` event.
- **EIP-2612 permit** on MUSD (OpenZeppelin `ERC20Permit`, domain `Mezo USD` v1).
- **Mezo Borrow** `BorrowerOperations.openTrove`, `HintHelpers.getApproxHint`, `SortedTroves.findInsertPosition`, `PriceFeed.fetchPrice`, `TroveManager.getTCR/MCR/CCR`: how the demo wallet minted MUSD.
- **Mezo testnet** chain 31611, RPC `rpc.test.mezo.org`, explorer `explorer.test.mezo.org` (Blockscout), BTC as gas token, the testnet faucet.
- Wave 2: MUSD on Base (the same contract answers on Base mainnet), Mezo mainnet.

## 3. What a judge can do in five minutes

README, "Judge it in five minutes": curl the 402; open `/stats`, `/payments.csv` and any explorer link; read the manifest. With a wallet, about three minutes: faucet BTC, `node scripts/fund-musd.mjs --send` to mint MUSD, then `node src/client.js sol-price` and watch the settlement land on the explorer. `npm test` needs no network.

## 4. Live evidence

67 settled paid calls and 1.26 MUSD, one payer wallet, both schemes, all 8 routes; every `transfer_tx` in [`evidence/paid-calls.csv`](evidence/paid-calls.csv) is a successful `transferFrom` on Mezo testnet, with its `permit` transaction beside it. Every row was re-read from the chain by `node scripts/verify-evidence.mjs` (67 of 67: transferFrom and permit succeeded, the MUSD `Transfer` goes from the payer to the treasury for the ledger amount). The treasury holds the ledger total plus 0.01 MUSD from one `transfer` payment the gateway refused with `tx_not_found` because of a lagging RPC node; that is a bug we hit and fixed, written up in [`evidence/unclaimed.md`](evidence/unclaimed.md). Not simulated, not counted from mocks. Nothing is on Mezo mainnet: this is a testnet entry.

## 5. Rival entries and our angle

Known rival: **Liqvera**, x402 in MUSD. Our angle is not a demo of the idea but a production API adding MUSD as a rail: 83 paid routes behind a working business, an MCP server and an elizaOS plugin that agents already install, a design that works against MUSD as deployed (permit, because there is no EIP-3009), and a ledger that anyone can audit at `/payments.csv`. Other submissions are not known to us; the Wave 1 page showed 59 submissions on Oct 25.

## 6. Exact format (AKINDO form)

Testnet link, public GitHub repo, deck, 2-minute pitch video, and the form fields (name, 3-5 word category, TL;DR, how it works, target group, tech stack, track, chain, status, readiness, three milestones, team). All drafted in [`SUBMISSION.md`](SUBMISSION.md). Track 2. Chain: Mezo (testnet). Status: existing project (AgentFeed, https://x402.ochinimus.app) with a new MUSD integration built during Wave 1. Readiness: testnet deployment.

## 7. Liveness through Nov 1 (judging) and Nov 23 (demo session)

Gateway runs as PM2 `agentfeed-mezo` (port 3034) behind the dedicated tunnel `agentfeed-mezo-tunnel`, both saved in the PM2 dump. The settler holds testnet BTC for gas (gas price on Mezo testnet is about 146 wei, so the balance lasts for years of calls). The AgentFeed prepaid key funds about 10,000 upstream calls, capped at 5,000 a day. Payments, not the process, are the only thing a judge can exhaust, and they cost testnet MUSD only. Check: `curl https://mezo.ochinimus.app/health`. If a service restart is ever needed the cycle is `pm2 delete` then `pm2 start` then `pm2 save`.

## 8. Social

Nothing is posted yet; a draft post is in [`SUBMISSION.md`](SUBMISSION.md) and posting it, and joining the Mezo Discord, is the owner's call. The pitch video is made for YouTube upload by the owner.

## 9. Organiser push

To do before the deadline, by the team (not automated here): join the Mezo Discord and ask for the Developer role; post the repo and a short thread in the buildathon channel; submit on AKINDO; comment on the Wave 1 submission page with the live URL and the `/payments.csv` link so Mezo's core team can audit the evidence without running anything.

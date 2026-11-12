**Wave 2 of the Mezo Buildathon, agentfeed-mezo. Real money on two mainnets: 79 paid calls and 3.14 MUSD on Mezo mainnet (chain 31612), 52 paid calls and 0.96 MUSD on Base, plus 68 test calls on Mezo testnet. Outside payers: 0.** Counted from the gateway's own ledger at [`/payments.csv`](https://mezo.ochinimus.app/payments.csv) on Nov 12 2026; the live numbers are at https://mezo.ochinimus.app/stats. Every mainnet payer so far is our own wallet. The Wave 1 checklist is kept as [`CHECKLIST-wave1.md`](CHECKLIST-wave1.md).

# Mezo Buildathon, Wave 2: checklist

Project: **agentfeed-mezo**, Track 2 (Access and Distribution). Repo https://github.com/seekdaseek/agentfeed-mezo. Live https://mezo.ochinimus.app. MIT. Wave 2 deadline Nov 15 2026, 17:00 Chisinau. The demo video is on YouTube (https://youtu.be/vcQcw8-vMkg); nothing has been submitted to AKINDO or posted on X.

## 1. What the Wave 1 judges said, and what changed

Wave 1 scores: Mezo Integration 4, Product and Business 6, Technical 8, UX 6, Materials 8.

| gap | what changed | proof |
|---|---|---|
| MUSD was only a payment token, on testnet (4) | MUSD is spent on **Mezo mainnet** and on Base with real money. A Telegram bot lets an owner fund an agent from their own **Mezo trove**, with a floor, so the bitcoin never moves. Two routes sell data about Mezo itself: `mezo-peg`, `mezo-trove`. | mainnet calls in [`evidence/paid-calls-mainnet.csv`](evidence/paid-calls-mainnet.csv); trove draw tx `0x9bcd592c…d06d` (testnet, labelled); `/stats` |
| one payer, our own test agent (6) | the budget bot, the npm package and the MCP Registry listing exist so that outside agents can arrive; `/stats` counts outside payers apart from our own wallets. **That count is still 0**, and the mainnet payer is our own agent. | `/stats` `outside_payers` |

## 2. Rubric (Wave 2 weights), and where each point is met

| criterion (weight) | where it is met |
|---|---|
| **Mezo Integration (30%)** | MUSD on Mezo mainnet as the settlement asset of a payment protocol: EIP-2612 permit verified against MUSD's live EIP-712 domain and on-chain nonce, simulated with `eth_call permit()`, settled with `permit` plus `transferFrom`; 79 settled calls, each checked back on chain by `scripts/verify-evidence.mjs` (79 of 79, the treasury holds exactly the ledger total). Mezo Borrow reads for the trove route and the draw floor. The Mezo funding path was done by hand and is documented, including two traps in the bridges (the native bridge's real minimum is 0.0001 tBTC, the Wormhole NTT manager's quote view reverts) and that auto relay to Mezo is off, so someone must send the redeem. Mezo BTC and MEZO both accept permit on mainnet (one real permit transaction each) but are **not** gateway payment assets. |
| **Product and Business Viability (30%)** | A live API with real paid routes gets one more rail. The owner's problem is agents with a spending limit: budget, daily cap, pause, revoke, a call over budget refused before anything is settled. Honest gap: no outside payer yet. |
| **Technical Implementation (20%)** | Gateway keeps one ledger with the network on every row; replay protection per network; fetch before settle; 148 tests (`npm test`, no network). A stale-permit-nonce defect on a fast chain was found with real Base payments and fixed. |
| **User Experience (10%)** | One curl shows the 402; the client and the MCP server are one command; the agent signs one message and pays no gas; `/stats` and `/payments.csv` need no wallet. |
| **Submission Materials (10%)** | README with the sample transactions and the funding path; this checklist; the 8-slide deck [`deck/agentfeed-mezo-deck-wave2.pdf`](deck/agentfeed-mezo-deck-wave2.pdf) (public, built from live `/stats`); the 2 min 59 s video https://youtu.be/vcQcw8-vMkg ; `WAVE2-UPDATE.txt` (under 3,000 characters). |

## 3. Judge it in five minutes

`curl -s https://mezo.ochinimus.app/api/sol-price` shows a 402 with three networks; `/stats` shows Mezo mainnet as its own line; any explorer link in the README, for example the first mainnet call https://explorer.mezo.org/tx/0xa9cc85f2201133c141b44472760283fac137a40c0fb82dbddc6368e39d7b44c5 ; `node scripts/verify-evidence.mjs evidence/paid-calls-mainnet.csv` re-reads all 79 mainnet rows from the chain.

## 4. Where the video and deck show it

Video v4 (2 min 59 s, https://youtu.be/vcQcw8-vMkg; file sha256 `92e791c5d5c7bf34b469946eaca075a17a2009a4523b4d750223e4b47caef71b`): the owner sets a budget and a cap in Telegram, a refused draw under the floor, a trove draw on testnet, a paid call on testnet with its explorer link, the cap refusing the next call, a call on Base, and **a real paid call on Mezo mainnet with the Mezo mainnet line of `/stats`, narrated as paid by our own agent**. Deck [`deck/agentfeed-mezo-deck-wave2.pdf`](deck/agentfeed-mezo-deck-wave2.pdf), 8 slides: slide 6 shows the mainnet funding and first call, slide 7 the live numbers, slide 8 the honest status and the video link.

## 5. Honest status

- **Done**: Mezo mainnet and Base in the same 402; the Telegram budget bot; trove draw with a floor (testnet); two Mezo routes; a mainnet scene in the video; the public Wave 2 deck; npm `@seekdaseek/agentfeed-mezo` 0.2.1 and MCP Registry 0.2.1 published, registry 0.2.0 and npm 0.0.0-stage deprecated (npm 0.2.0 left as is).
- **Not done**: Mezo BTC and MEZO as payment assets (the gateway has one asset per network, prices in MUSD cents, has no MEZO price source, and no wallet of ours holds MEZO); a mainnet trove draw (the draw is shown on testnet and labelled so); any outside payer (0, and the 79 mainnet calls are from our own agent); the `transfer` payment scheme on Mezo mainnet (needs BTC in the payer wallet for gas, not tested).
- **Mainnet gas**: measured 3.3e-7 BTC per settlement, about 2.4 cents, against a 2 cent surcharge; the settler holds about 235 more settlements of BTC.
- Rules 36 to 44 of the owner's what-wins list are not in this repository, so this checklist follows the rubric above and does not claim them line by line.

## 6. Rival entries and our angle

Read on the AKINDO submissions tab on Nov 2: **Sternpost** (agent credit from a Mezo trove, floor enforced by a contract, a Telegram bot; page hidden, so unread beyond the tagline), **Liqvera** (BTC depth and trove risk reports paid per report in MUSD over x402, testnet), **Vigil** (Telegram alerts and a pre-signed rescue for a loan near liquidation). Our angle: a production API with real revenue lines, MUSD spent on two mainnets with a public ledger anyone can re-read from the chain, and the owner's spending limits as the product. Nothing of their code or wording is reused.

## 7. Liveness

Gateway PM2 `agentfeed-mezo` (port 3034) behind the tunnel `agentfeed-mezo-tunnel`, both in the PM2 dump. Mainnet was enabled on Nov 12 2026 by an `.env` change only (backup `.env.bak-20261112` on the box), using `pm2 delete`, `pm2 start`, `pm2 save`. Check: `curl https://mezo.ochinimus.app/health` lists the three chains. The upstream AgentFeed key is capped at 5,000 calls a day.

## 8. Still owed before the deadline

Nov 15, not before: refresh the `/stats` numbers in `WAVE2-UPDATE.txt`, the deck, the README, this checklist and `SUBMISSION-wave2.md` (`node deck-w2/check-update.mjs`, then `node deck-w2/build.mjs`, which also rewrites the public deck copy); the owner's go to submit. Nothing is submitted to AKINDO or posted on X.

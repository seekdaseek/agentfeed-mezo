# AKINDO product update: Wave 2 submission sheet

Mezo Buildathon, Wave 2 (deadline Nov 15 2026, 17:00 Chisinau). Written Nov 12 2026. Nothing here has been submitted or posted. The numbers in the update text are the /stats numbers of Nov 12 2026; they are refreshed on Nov 15 before submitting. Each field below is plain text, ready to paste.

Project name:
agentfeed-mezo

Project category (3 to 5 words):
agent payments, data access

TL;DR:
AgentFeed on Mezo lets AI agents pay per call for live crypto data in MUSD on Mezo mainnet and Base, with no account and no gas, and lets the owner cap each agent's budget from Telegram.

How it works:
An AI agent cannot open an account or hold an API key, so MUSD, Mezo's Bitcoin-backed dollar, is hard for it to spend. agentfeed-mezo puts an HTTP 402 gateway in front of AgentFeed, a live paid data API. A call without payment gets a 402 that names MUSD on each network the gateway accepts, the price, the treasury and a one-time nonce. The agent signs an EIP-2612 permit and retries. The gateway checks the signature against MUSD's live EIP-712 domain, the on-chain nonce and balance, simulates the permit, fetches the data first, and only then settles with permit plus transferFrom, paying the gas. If the data cannot be fetched nothing is charged. Mezo mainnet prices carry 2 cents for gas. The owner registers an agent in the Telegram bot, sets a budget and a daily cap, and can fund the agent from the owner's own Mezo trove with a collateral floor, so the bitcoin never moves. A call over budget or cap is refused before anything is settled. Two routes sell data about Mezo itself, the MUSD peg and trove health.

Target group:
AI agent developers and the people who run agents, such as trading bots, eliza agents and MCP clients, who want data per call and a spending limit they control. Desktop and server, global. Track 2 is access and distribution: MUSD becomes spendable by software with no sign-up.

Tech stack:
Node 22, viem, better-sqlite3, the MCP SDK, grammY for Telegram, Cloudflare tunnel and PM2. Mezo mainnet (chain 31612), Mezo testnet (chain 31611) and Base (chain 8453). MUSD as ERC-20 with EIP-2612 permit, Mezo Borrow contracts for trove reads and draws. The mainnet wallets were funded with the Mezo native tBTC bridge and Wormhole NTT.

Track:
Track 2, Access and Distribution

Chain deployed on:
Mezo mainnet (chain 31612), Mezo testnet (chain 31611), Base (chain 8453)

Project status:
An existing project with new features added during the hackathon. Existing product: AgentFeed at https://x402.ochinimus.app. New in Wave 1: the MUSD gateway on Mezo testnet. New in Wave 2: Mezo mainnet and Base, the Telegram budget bot, the trove draw with a floor, and two Mezo routes.

Project readiness:
Mainnet deployment, live at https://mezo.ochinimus.app. Real money moves on Mezo mainnet and on Base. Outside payers: 0. All 79 mainnet paid calls come from our own agent wallet.

Update text:
Wave 2 update: AgentFeed on Mezo

Wave 1 scored 4 on Mezo Integration, because MUSD was only the payment token and only on testnet, and 6 on Business, because the gateway had a single payer, our own test agent. This update answers both and says plainly what is not done.

Milestone 1, MUSD on Mezo mainnet: live with real money, and the payer is our own agent. The same 402 challenge now offers MUSD on Mezo mainnet, chain 31612, at the route price plus 2 cents for gas. So far 79 paid calls, 3.14 MUSD, all ten routes. One example: https://explorer.mezo.org/tx/0xa9cc85f2201133c141b44472760283fac137a40c0fb82dbddc6368e39d7b44c5 . I funded that wallet from SOL: tBTC bridged from Ethereum to give the settler BTC for gas, USDC swapped to MUSD on Base and sent over Wormhole Portal, redeemed by hand because auto relay to Mezo is off. /stats shows Mezo mainnet as its own line. The Mezo BTC and MEZO tokens both accept EIP-2612 permit on mainnet, one real permit transaction each, but the gateway still prices in MUSD only.

Milestone 2, MUSD on Base: live with real money. The gateway offers MUSD on Base next to Mezo testnet in the same 402 challenge, with permit and plain transfer, and keeps one ledger with the network on every row. So far 52 paid calls on Base, 0.96 MUSD, all ten routes. One example: 0xa931...938e.

Milestone 3, Telegram bot: live. The owner registers an agent by having the agent wallet sign a message, sets a budget and a daily cap, sees every paid call with its explorer link, and can pause or revoke the agent. Budget comes from MUSD sent in, or drawn from the owner's own Mezo trove with a signed draw, so the bitcoin never moves. The trove floor defaults to 200 percent and is checked by the bot off chain; Mezo itself only liquidates at 110 percent. In the video the first draw is refused at 160 percent, the owner sets the floor to 150, and the next draw of 50 MUSD succeeds on testnet in transaction 0x9bcd...d06d. A paid call of 0.02 MUSD follows in transaction 0x2af1...a44c, and after the daily cap is lowered the gateway refuses the next call before any payment is settled, with nothing charged.

Mezo is also the subject of the data: two routes, mezo-peg and mezo-trove, sold per call in MUSD.

Outside payers: still zero. /stats counts them separately from our own wallets: 199 settled calls, 5.38 MUSD, 4 payers, all ours. To be findable, the MCP server is on npm as @seekdaseek/agentfeed-mezo and in the official MCP Registry as io.github.seekdaseek/agentfeed-mezo.

About the video: the bot reported the second draw as failed although it had mined, because it stopped waiting for the receipt too early. I cut that stretch and blurred the message where it still shows in the chat scroll-back. The bot credited the 50 MUSD afterwards with its confirm command, so the agent was funded twice. It now waits 90 seconds and says it could not read the receipt yet instead of failed, and a test covers it.

148 tests pass. Code: github.com/seekdaseek/agentfeed-mezo

Links:
Live gateway: https://mezo.ochinimus.app
Stats: https://mezo.ochinimus.app/stats
Repo: https://github.com/seekdaseek/agentfeed-mezo
Deck: https://github.com/seekdaseek/agentfeed-mezo/blob/main/deck/agentfeed-mezo-deck-wave2.pdf
Video: https://youtu.be/vcQcw8-vMkg
Mainnet example transaction: https://explorer.mezo.org/tx/0xa9cc85f2201133c141b44472760283fac137a40c0fb82dbddc6368e39d7b44c5
Mainnet ledger rows: https://github.com/seekdaseek/agentfeed-mezo/blob/main/evidence/paid-calls-mainnet.csv

Future milestones:
Wave 3 (deadline Nov 30 2026), milestone 1, the first outside payer. Done when /stats shows outside_payers of at least 1 on Mezo mainnet or Base, with at least 10 settled calls from a wallet that is not in our own wallet list, and node scripts/verify-evidence.mjs reads those rows back from the chain.
Wave 3, milestone 2, the plain transfer scheme on Mezo mainnet. Done when one paid call that uses the transfer scheme settles on chain 31612 and appears in /payments.csv with that scheme.
Wave 3, milestone 3, honest mainnet gas pricing. Done when the surcharge is set from 100 consecutive mainnet settlements, the settler's measured BTC gas per settlement is at or below the surcharge, and the README shows the numbers. Measured on Nov 12 2026: about 2.4 cents of gas against a 2 cent surcharge.
The wave after, milestone 4, Mezo BTC and MEZO as payment assets. Done when the 402 offers permit in each on chain 31612, priced from a verified source, one real mainnet paid call per asset settles and shows in the ledger with the asset on the row, and the tests pass.
The wave after, milestone 5, a mainnet trove draw. Done when an owner funds an agent from a real Mezo mainnet trove through the bot, the collateral ratio after the draw is at or above the owner's floor, and the transaction is on explorer.mezo.org.

Team info:
To be filled in by the submitter in the AKINDO form: members, roles, X or LinkedIn. It is not stored in this repository.

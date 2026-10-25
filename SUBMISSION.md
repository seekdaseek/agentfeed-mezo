# AKINDO submission: draft answers

Mezo Buildathon, Wave 1 (deadline 26 Oct 2026, 17:00 Chisinau / 15:00 UTC). Nothing here has been submitted. Fields follow the AKINDO form.

**Project name:** agentfeed-mezo

**Project category (3-5 words):** agent payments, data access

**TL;DR:** A gateway that lets AI agents buy live crypto market data from the AgentFeed API per call in MUSD, by signing one EIP-2612 permit and paying no gas.

**How it works:** AI agents cannot open accounts, hold API keys or keep gas on every chain, so MUSD, Mezo's Bitcoin-backed dollar, is hard for them to spend. agentfeed-mezo puts an HTTP 402 gateway in front of AgentFeed, a live paid data API (83 paid routes, MCP server, elizaOS plugin). A call without payment gets a 402 naming MUSD on Mezo testnet, the price (1 to 5 cents), the treasury and a one-time nonce. The agent signs an EIP-2612 permit with its own key and retries. The gateway verifies the signature against MUSD's live EIP-712 domain and on-chain nonce, balance and a simulated `permit()`, fetches the data from AgentFeed, then settles with `permit` + `transferFrom` and pays the gas. MUSD has no EIP-3009, so x402's standard `exact` scheme cannot be used; permit is the one-signature equivalent. A plain MUSD transfer with a signed claim is also accepted. Replay protection is a sqlite ledger over signature, permit nonce, challenge nonce and every settlement hash. If AgentFeed is down the payer is not charged. MUSD for the demo is minted through Mezo Borrow's `openTrove`.

**Target group:** AI agent developers and agents (trading bots, eliza agents, MCP clients) that need market data and hold, or can be funded with, MUSD; desktop and server, global. Track 2 (access and distribution): MUSD becomes spendable by software with no sign-up.

**Tech stack:** Node 22, viem, better-sqlite3, MCP SDK, Cloudflare tunnel, PM2; Mezo testnet (chain 31611), MUSD (ERC-20 + EIP-2612), Mezo Borrow contracts.

**Track:** Track 2

**Chain deployed on:** Mezo (testnet)

**Project status:** An existing project with new features added during the hackathon. Existing product: https://x402.ochinimus.app (AgentFeed, live with paid calls). New in Wave 1: the whole MUSD gateway, client, MCP tool, tests, ledger and docs in this repo.

**Project readiness:** Testnet deployment (live at https://mezo.ochinimus.app).

**Future milestones:**
1. Nov 2-8: Mezo mainnet MUSD, same code with a mainnet config, plus a per-call gas surcharge.
2. Nov 9-12: MUSD on Base (the token is already deployed there), added to the 402 `accepts`.
3. Nov 13-15: Telegram bot that tops up and spends MUSD for agents (budget, daily caps, permit signing for the user's agents).

**Team info:** @@TEAM@@ (to be filled in by the submitter: members, roles, X or LinkedIn).

## Links

- Live project: https://mezo.ochinimus.app
- Public repo: https://github.com/seekdaseek/agentfeed-mezo
- Deck: `deck/agentfeed-mezo-deck.pdf` in the repo
- 2-minute pitch video: @@VIDEO@@
- Evidence: https://mezo.ochinimus.app/payments.csv, `evidence/paid-calls.csv`

## Draft social post

> AI agents can now pay for crypto data in MUSD. One signed permit, no account, no API key, no gas. 67 real paid calls on Mezo testnet so far, every one a tx on the explorer. Built on a live API (AgentFeed) for the Mezo Buildathon. https://mezo.ochinimus.app https://github.com/seekdaseek/agentfeed-mezo

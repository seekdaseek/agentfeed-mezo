# AgentFeed on Mezo

Live crypto data for AI agents, paid per call in **MUSD**, the Bitcoin-backed dollar on Mezo. The agent signs one permit and pays no gas. There is no account and no API key.

The gateway at https://mezo.ochinimus.app answers `402 Payment Required` with a price, the token, the network and a one-time nonce. The agent signs an EIP-2612 permit for exactly that amount, sends the request again, and gets the data back with a link to the settlement. If the data cannot be fetched, nothing is charged.

It sells AgentFeed's market data (prices, liquidations, funding, a page summary) and two routes about Mezo itself: where MUSD trades against a dollar, and the health of a Mezo trove. The people who run agents can keep them on a budget from Telegram.

## Use it from an MCP client

The server is on npm and in the official MCP Registry as `io.github.seekdaseek/agentfeed-mezo`. Add it to your client's MCP config:

```json
{ "mcpServers": { "agentfeed-mezo": { "command": "npx", "args": ["-y", "@seekdaseek/agentfeed-mezo"],
  "env": { "NETWORK": "mezo-testnet", "AGENT_PRIVATE_KEY": "0x...", "MAX_PRICE_MUSD": "0.10" } } } }
```

| variable | meaning |
|---|---|
| `NETWORK` | `mezo-testnet` (default, test MUSD with no value), `base` (**real MUSD on Base**), or `mezo-mainnet` (not offered by the live gateway yet, see Limits) |
| `AGENT_PRIVATE_KEY` | the wallet that pays. Use a dedicated wallet with a small balance. Optional: without it the server still starts and `list_routes` works |
| `MAX_PRICE_MUSD` | refuse any call that costs more than this many MUSD (default `0.10`) |
| `GATEWAY_URL` | another gateway (default `https://mezo.ochinimus.app`) |

Two tools: `list_routes` (free, reads the prices) and `call_route { route, params?, scheme? }` (signs one permit, returns the data and the explorer link). The server signs only for the network and the MUSD token it was configured for, and never above `MAX_PRICE_MUSD`. It sends the key nowhere.

**`NETWORK=base` spends real money.** To get MUSD on Base, swap USDC for it in the PancakeSwap V3 MUSD/USDC pool (0.01% fee): [`0xa0EED82e…EE7E`](https://basescan.org/address/0xa0EED82e20caB62a5698E898e9Fd4c4db412EE7E). MUSD on Base is `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186`. That pool is thin: buy only what you need and check the quote first. On Mezo testnet, test MUSD comes from opening a trove against test BTC from the faucet: `AGENT_PRIVATE_KEY=0x... TARGET_ICR_PCT=165 node scripts/fund-musd.mjs --send` in a clone (165 keeps the trove within what one faucet request provides).

## From the command line

```sh
git clone https://github.com/seekdaseek/agentfeed-mezo && cd agentfeed-mezo && npm install
AGENT_PRIVATE_KEY=0x... NETWORK=mezo-testnet node src/client.js sol-price --pretty
AGENT_PRIVATE_KEY=0x... NETWORK=base node src/client.js liquidations symbol=SOL limit=5
```

Options: `--scheme permit|transfer`, `--n 5` (repeat), `--pretty`. `permit` (default) costs the agent no gas. `transfer` sends a plain MUSD transfer and presents its hash with a signed claim; the agent pays the gas.

## Routes and prices

Prices are MUSD per call on Mezo testnet and Base. A Mezo mainnet gateway would add 2 cents for gas.

| route | MUSD | what |
|---|---|---|
| `sol-price`, `btc-price` | 0.01 | spot price |
| `liq-pulse` | 0.01 | what is being liquidated right now |
| `funding-pulse` | 0.01 | the most extreme perp funding rates |
| `liquidations` | 0.02 | liquidation tape (`symbol`, `scope`, `limit`, `min_usd`) |
| `market-snapshot` | 0.02 | market snapshot in one call |
| `trade-context` | 0.03 | prices, funding and liquidations in one call |
| `mezo-peg` | 0.03 | where MUSD sells against a dollar on Mezo and Base, at 1 and 100 MUSD, in basis points |
| `mezo-trove` | 0.02 | one address on Mezo Borrow: collateral ratio, liquidation price, how much MUSD Mezo would redeem first (`address`, `network=mainnet\|testnet`) |
| `summarize` | 0.05 | summary of a web page (`url`) |

Free: `GET /` (page), `/.well-known/x402` (manifest with the prices per network), `/stats`, `/payments.csv` (every settled payment with its transaction), `GET /agents/<address>` (a registered agent's remaining budget), `GET /nonce/<chainId>/<address>`.

## Budgets for agents, from Telegram

**[@AgentFeedBudgetBot](https://t.me/AgentFeedBudgetBot)** lets the person who runs an agent set what it may spend. The gateway enforces it: a call from a registered wallet that would go over its budget or its daily cap is refused before anything is fetched or settled, and nothing is charged. The bot answers private chats only.

| command | what it does |
|---|---|
| `/regmsg <name> <address>` | first step: the exact message your agent wallet signs to prove the wallet is yours (`AGENT_PRIVATE_KEY=0x... node src/client.js sign-register <your telegram id> <name>` signs it) |
| `/newagent <name> <address> <daily cap MUSD> <signature>` | register the wallet. The budget starts at 0 |
| `/agents`, `/agent <name>` | your agents; one in full (budget left, spent today, floor) |
| `/topup <name> <MUSD> [network]`, then `/confirm <name> <txhash> [network]` | fund the budget by sending MUSD to the agent wallet; the bot checks the transaction on-chain and credits what arrived, once per transaction |
| `/drawmsg <name> <MUSD> <trove address>`, then `/draw <name> <MUSD> <trove address> <deadline> <signature> [network]` | fund it from your own Mezo trove: you sign one message, Mezo mints MUSD straight to the agent, your bitcoin does not move (`scripts/owner-sign-draw.mjs` signs it) |
| `/calls <name>` | the last paid calls, each with its explorer link |
| `/setcap <name> <MUSD>` | daily cap, resets at 00:00 UTC |
| `/setfloor <name> <percent>` | the lowest collateral ratio a draw may leave your trove at (default 200) |
| `/pause <name>`, `/resume <name>`, `/revoke <name> yes` | stop or end an agent. Revoked is final |

**The floor is checked by the bot, off-chain**, from fresh reads right before it submits the draw. Mezo itself only enforces 110%. A price move between the check and the block is not covered, and nothing on-chain would stop a draw the bot did not make.

## Sample paid transactions

- Base, `mezo-peg` called from an MCP client with `NETWORK=base`: [`0xa931415c…938e`](https://basescan.org/tx/0xa931415c9a0a761c757e46ba3f0f865bf5bb8d413e31ee1bccdbb4a3b341938e)
- Mezo testnet, a trove draw funding an agent: 50 MUSD minted to the agent wallet, trove from 156% to 153% with a 150% floor: [`0x9bcd592c…d06d`](https://explorer.test.mezo.org/tx/0x9bcd592c3acffa27899d827a6e0e523cf24a86fc86c87af87365dacce1b7d06d)
- Mezo testnet, that agent paying 0.02 MUSD for `liquidations` out of the drawn MUSD: [`0x2af1ae19…a44c`](https://explorer.test.mezo.org/tx/0x2af1ae19e306f6d5ac3861167ea703defa6f988cee096f3caccb41324218a44c)

The Telegram session behind the two testnet transactions is in [`evidence/bot-demo-transcript.md`](evidence/bot-demo-transcript.md), with the user id removed. The gateway's ledger is public at [`/payments.csv`](https://mezo.ochinimus.app/payments.csv), and `node scripts/verify-evidence.mjs` re-reads every row from its chain.

## How a payment works

1. `GET /api/<route>` without payment returns `402` with a `PAYMENT-REQUIRED` header (and the same JSON in the body): for each network, the MUSD contract, the price in wei, the treasury, the gateway's settler address, and a nonce bound to the route, the network and the price.
2. The agent reads its permit nonce, signs `Permit(owner, settler, price, nonce, deadline)` with the token's own EIP-712 domain, and retries with a `PAYMENT-SIGNATURE` header.
3. The gateway checks the network, the token, the recipient and the nonce; recovers the signature; reads the balance; simulates `permit()` on-chain; and, for a registered agent, checks its budget and cap.
4. It fetches the data first. Only if that works does it call `permit()` and `transferFrom()` from its settler key, paying the gas, and return the data with the settlement transaction. A failed fetch or a failed settlement charges nothing.
5. Every signature, permit nonce, challenge nonce and settlement hash is recorded per network and refused a second time. MUSD has no EIP-3009 `transferWithAuthorization`, which is why this uses a permit.

## Addresses

| | Mezo testnet (31611) | Base (8453) |
|---|---|---|
| MUSD | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` | `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186` |
| gateway treasury | `0xf01d65DBd1B946C48b7dB1f0A02AaBd021c89227` | `0x3a110E3306Eac48C6531325797B2aa92D9d096c7` |
| gateway settler | `0xaB7323cB6aaB188D7Dca697496534BA6C95ddbC2` | `0x735Cd2E2F4E4c87e7587A099a21b4d3fe15d763e` |

Mezo mainnet MUSD (chain 31612) is at the same address as on Base. The Mezo Borrow addresses are in `src/config.js`, taken from the Mezo MUSD repository.

## Run your own gateway

```sh
npm install && npm test
cat > .env <<'EOF2'
NETWORKS=mezo-testnet,base            # which networks to sell on
TREASURY_ADDRESS=0x...                # mezo-testnet: receives the MUSD
SETTLER_PRIVATE_KEY=0x...             # mezo-testnet: permit spender, needs a little BTC for gas
BASE_TREASURY_ADDRESS=0x...           # base; the same pair for mezo-mainnet is MEZO_MAINNET_*
BASE_SETTLER_PRIVATE_KEY=0x...        # needs a little ETH for gas
CHALLENGE_SECRET=<random hex>
UPSTREAM_KEY=afk_...                  # an AgentFeed prepaid key
PUBLIC_URL=http://localhost:3034
OWN_WALLETS=0x...,0x...               # your own payers, counted apart from outside payers in /stats
EOF2
chmod 600 .env && npm start           # the gateway
npm run bot                           # the budget bot, with TELEGRAM_BOT_TOKEN added to .env
```

A network without its own treasury and settler key refuses to start. More settings are in `src/config.js`.

## Tests

`npm test` runs 148 tests with no network: the gateway over a fake chain and a fake data source with real signatures (payment checks, replay, wrong token, wrong chain, wrong recipient, expired nonce, upstream down), the three networks, budgets and caps, the bot's commands, trove draws and the floor, the two Mezo routes, and the MCP server driven through a client. The last run passed all 148.

## Limits, as they stand today

- **Mezo testnet is test money.** Base is real MUSD. The live gateway sells on those two. Mezo mainnet is supported in the code and tested, but not turned on.
- **MUSD on Base is thinly traded.** The pool above held about $430 of liquidity when checked, and selling 100 MUSD there returned about 0.968 USDC per MUSD. Buy small.
- **The trove floor is off-chain** and only as good as the bot's reads (see above). Draws work on Mezo only, and the demo above is on testnet.
- **One permit at a time per wallet**, and one call at a time per registered agent across networks.
- **Use `permit` for registered agents.** With the `transfer` scheme the agent has already paid when the gateway checks its budget, so an over-budget call would be refused after the payment. Read `GET /agents/<address>` first if you must use it.
- **The public RPC nodes lag.** A permit nonce that was just used can still read as current, so the gateway keeps its own ledger as a floor and the client takes the highest value it can see. A refusal caused by lag charges nothing with `permit`. With `transfer`, a payment can be refused if the gateway's node has not yet seen the receipt; the gateway retries for about 8 seconds, and a payment that was sent but never accepted cannot be redeemed ([one case](evidence/unclaimed.md)).
- **The data behind the routes comes from AgentFeed through one prepaid key**, with a daily cap on upstream calls. When it runs out a call fails with 503 and charges nothing.
- **The bot** answers one command a second per person and runs on a small server, so it can be down. A registered wallet stays gated by its budget for good, and revoke is final.
- **Not audited.** Use dedicated wallets with small balances.

## License

MIT, see [LICENSE](LICENSE).

# AgentFeed on Mezo

Live crypto data for AI agents, paid per call in **MUSD**, the Bitcoin-backed dollar on Mezo. The agent signs one permit and pays no gas. There is no account and no API key.

The gateway at https://mezo.ochinimus.app answers `402 Payment Required` with a price, the token, the network and a one-time nonce. The agent signs an EIP-2612 permit for exactly that amount, sends the request again, and gets the data back with a link to the settlement. If the data cannot be fetched, nothing is charged.

It sells AgentFeed's market data (prices, liquidations, funding, a page summary) and two routes about Mezo itself: where MUSD trades against a dollar, and the health of a Mezo trove. The people who run agents can keep them on a budget from Telegram.

## What changed since Wave 1

Wave 1 was Mezo testnet only, one payer, our own test agent. Now, read from the gateway's ledger on Nov 12 2026 (live numbers at [`/stats`](https://mezo.ochinimus.app/stats)): **79 paid calls and 3.14 MUSD on Mezo mainnet, 52 paid calls and 0.96 MUSD on Base, both real money; outside payers: 0.** Every payer so far is our own wallet.

- MUSD is spent on **Mezo mainnet** (chain 31612) and on **Base**, in the same 402 challenge as Mezo testnet; one ledger, with the network on every row, and `/stats` shows each network apart.
- A **Telegram budget bot** gives the owner of an agent a budget, a daily cap, pause and revoke, and can fund the agent from the owner's own Mezo trove with a collateral floor.
- Two routes about Mezo itself: `mezo-peg` and `mezo-trove`.
- The MCP server is on npm and in the MCP Registry.

## Use it from an MCP client

The server is on npm and in the official MCP Registry as `io.github.seekdaseek/agentfeed-mezo`. Add it to your client's MCP config:

```json
{ "mcpServers": { "agentfeed-mezo": { "command": "npx", "args": ["-y", "@seekdaseek/agentfeed-mezo"],
  "env": { "NETWORK": "mezo-testnet", "AGENT_PRIVATE_KEY": "0x...", "MAX_PRICE_MUSD": "0.10" } } } }
```

| variable | meaning |
|---|---|
| `NETWORK` | `mezo-testnet` (default, test MUSD with no value), `base` (**real MUSD on Base**), or `mezo-mainnet` (**real MUSD on Mezo mainnet**, live since Nov 12 2026) |
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

Prices are MUSD per call on Mezo testnet and Base. On Mezo mainnet every route costs 2 cents more, because the settler pays gas there in BTC.

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

### Mezo mainnet (chain 31612), our own agent as the payer

79 paid calls, 3.14 MUSD, all ten routes, permit scheme, read back from the chain by `node scripts/verify-evidence.mjs evidence/paid-calls-mainnet.csv` (79 of 79; the treasury holds exactly the ledger total). **The payer is our own agent wallet, not an outside user.** `/stats` lists Mezo mainnet as its own line and counts outside payers apart; that count is still zero. The calls are in [`evidence/mainnet-batch.jsonl`](evidence/mainnet-batch.jsonl) and [`evidence/paid-calls-mainnet.csv`](evidence/paid-calls-mainnet.csv).

- First paid call, `sol-price`, 0.03 MUSD: [`0xa9cc85f2…44c5`](https://explorer.mezo.org/tx/0xa9cc85f2201133c141b44472760283fac137a40c0fb82dbddc6368e39d7b44c5)

How the mainnet wallets were funded, from SOL, because MUSD reaches Mezo from Base and gas on Mezo is BTC:

1. Ethereum, tBTC into the Mezo native bridge, recipient the mainnet settler: approve [`0x7bc162d2…5188`](https://etherscan.io/tx/0x7bc162d2093d9d6b408aeda3edb5178dc523c8f31bbc406a1b0cddc0ed325188), `bridgeTBTC` [`0xf4885c84…d9c7`](https://etherscan.io/tx/0xf4885c841e9035cd201c8c988090057f145e667abf72c0dc960b47837131d9c7). 17 minutes later Mezo credited exactly 0.000104 BTC to the settler in a system transaction, [`0x66f5a20d…ab44`](https://explorer.mezo.org/tx/0x66f5a20d2f99428e02a2f73d52e4d77b8ebfe9d0e8b697f8f0f7b89474b2ab44), with no claim transaction. The bridge enforces a minimum of 0.0001 tBTC, although its docs say there is none.
2. Base, USDC to MUSD on the PancakeSwap V3 pool ([`0x711ca0c1…94da`](https://basescan.org/tx/0x711ca0c1ae5cdb16756fa2e463a3e121c417c48389246cbb8a21bfc6a06d94da)), then Wormhole Portal (NTT) to Mezo, recipient the mainnet agent: [`0x4232f791…c37c`](https://basescan.org/tx/0x4232f791d86c5b5a9f67b3d116e89ac445a1a7cdf26e1fcfc30803127fa2c37c). No fee was paid on Base beyond gas.
3. Mezo, redeem by hand with the signed VAA from Wormholescan, because auto relay to Mezo is switched off in the Wormhole transceivers: [`0xda1da971…59d4`](https://explorer.mezo.org/tx/0xda1da971cd198177290fd1a766717f7b96a9ddf6fc27b07cbad5713f1ea759d4), 0.0000005 BTC of gas. The agent then held 3.168 MUSD. The scripts are `scripts/bridge-tbtc-eth.mjs`, `scripts/bridge-musd-base.mjs` and `scripts/redeem-mezo.mjs`.

The Mezo BTC token (`0x7b7C…0000`) and MEZO (`0x7B7c…0001`) both implement EIP-2612 permit on mainnet: their domain separators match name, version 1, chain 31612, and a real `permit()` transaction succeeded on each ([BTC](https://explorer.mezo.org/tx/0xfd9619244dfb87d474b0cee4073cd918d508a99dbf5a9290faabab893b0ec445), [MEZO](https://explorer.mezo.org/tx/0x76cb140709a9ec7e102756c49915e4ca41b832d20b5183939f414879726b9359)). They are **not** payment assets of the gateway.

The Telegram session behind the two testnet transactions is in [`evidence/bot-demo-transcript.md`](evidence/bot-demo-transcript.md), with the user id removed. The gateway's ledger is public at [`/payments.csv`](https://mezo.ochinimus.app/payments.csv), and `node scripts/verify-evidence.mjs` re-reads every row from its chain.

## How a payment works

1. `GET /api/<route>` without payment returns `402` with a `PAYMENT-REQUIRED` header (and the same JSON in the body): for each network, the MUSD contract, the price in wei, the treasury, the gateway's settler address, and a nonce bound to the route, the network and the price.
2. The agent reads its permit nonce, signs `Permit(owner, settler, price, nonce, deadline)` with the token's own EIP-712 domain, and retries with a `PAYMENT-SIGNATURE` header.
3. The gateway checks the network, the token, the recipient and the nonce; recovers the signature; reads the balance; simulates `permit()` on-chain; and, for a registered agent, checks its budget and cap.
4. It fetches the data first. Only if that works does it call `permit()` and `transferFrom()` from its settler key, paying the gas, and return the data with the settlement transaction. A failed fetch or a failed settlement charges nothing.
5. Every signature, permit nonce, challenge nonce and settlement hash is recorded per network and refused a second time. MUSD has no EIP-3009 `transferWithAuthorization`, which is why this uses a permit.

## Addresses

| | Mezo testnet (31611) | Base (8453) | Mezo mainnet (31612) |
|---|---|---|---|
| MUSD | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` | `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186` | `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186` |
| gateway treasury | `0xf01d65DBd1B946C48b7dB1f0A02AaBd021c89227` | `0x3a110E3306Eac48C6531325797B2aa92D9d096c7` | `0xB128982D3737CDfE6DA8467A7a05F62535e2bF5B` |
| gateway settler | `0xaB7323cB6aaB188D7Dca697496534BA6C95ddbC2` | `0x735Cd2E2F4E4c87e7587A099a21b4d3fe15d763e` | `0x5D41E85833eF8ba943930b8006CBc1c326279F35` |

The Mezo mainnet agent that made the 79 calls is `0x62529F90927af6162C7a731B240eDA821A43dA2B`. The Mezo Borrow addresses are in `src/config.js`, taken from the Mezo MUSD repository.

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

- **Mezo testnet is test money.** Base and Mezo mainnet are real MUSD. The only payer on Mezo mainnet so far is our own agent, so mainnet shows that it works, not that anyone outside wants it.
- **Mezo mainnet gas is about 2.4 cents a call** (measured: 79 settlements cost the settler 0.000026 BTC, 3.3e-7 BTC each, at BTC near $73,700), a little above the 2 cent surcharge. The mainnet settler held 0.0000775 BTC after the batch, about 235 more settlements. Only the `permit` scheme was used on mainnet; the `transfer` scheme there needs BTC in the payer wallet for gas and was not tested.
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

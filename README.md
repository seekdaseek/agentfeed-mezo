# agentfeed-mezo

**AI agents pay [AgentFeed](https://x402.ochinimus.app) per call in MUSD, Mezo's Bitcoin-backed stablecoin.**

AgentFeed is a live, paid crypto-data API for agents: liquidations, funding, prices, Solana pre-trade checks and language tasks, 83 paid routes, an MCP server and an elizaOS plugin, already settling real USDC. This repo is the gateway that lets the same data be bought in **MUSD on Mezo**: the agent signs one EIP-2612 permit, the gateway settles it on-chain and pays the gas, and the data comes back in the same HTTP call.

- Live gateway: **https://mezo.ochinimus.app** (Mezo testnet, chain 31611)
- Paid calls settled so far: **67 calls, 1.26 MUSD**, every one a transaction on the [Mezo explorer](https://explorer.test.mezo.org). The full list is [`evidence/paid-calls.csv`](evidence/paid-calls.csv), and live at [`/payments.csv`](https://mezo.ochinimus.app/payments.csv).
- Track 2, Access and Distribution: an agent needs no account, no API key and no gas, only MUSD.

```
$ curl -i https://mezo.ochinimus.app/api/sol-price
HTTP/2 402
payment-required: eyJ4NDAyVmVyc2lvbiI6Mi...   (base64 JSON: MUSD, eip155:31611, 0.01 MUSD, treasury, nonce)
```

## Judge it in five minutes

No wallet needed for steps 1 to 3.

1. **See the 402 challenge.** `curl -s https://mezo.ochinimus.app/api/sol-price | head -40`. It names the token (MUSD `0x118917a4...Ac503`), the network (`eip155:31611`), the price in wei, the treasury and an HMAC-bound nonce.
2. **See real settlements.** Open [`/stats`](https://mezo.ochinimus.app/stats) and [`/payments.csv`](https://mezo.ochinimus.app/payments.csv), then click any `transfer_tx_url`. The explorer shows a `transferFrom` from the gateway's settler moving 0.01 to 0.05 MUSD from the agent wallet to the treasury, and the matching `permit` transaction.
3. **Read the manifest.** [`/.well-known/x402`](https://mezo.ochinimus.app/.well-known/x402) lists the 8 routes with MUSD prices.
4. **Pay a call yourself** (about 3 minutes, needs a Mezo testnet wallet):
   ```sh
   git clone https://github.com/seekdaseek/agentfeed-mezo && cd agentfeed-mezo && npm install
   # 1. testnet BTC to your address: https://faucet.test.mezo.org  (0.05 BTC)
   # 2. mint testnet MUSD by opening a trove on Mezo Borrow (about 0.042 BTC in, 1850 MUSD out):
   AGENT_PRIVATE_KEY=0x... TARGET_ICR_PCT=165 node scripts/fund-musd.mjs --send
   # 3. pay for data:
   AGENT_PRIVATE_KEY=0x... node src/client.js sol-price
   AGENT_PRIVATE_KEY=0x... node src/client.js liquidations limit=5 symbol=SOL
   AGENT_PRIVATE_KEY=0x... node src/client.js summarize url=https://mezo.org
   ```
   The client prints the status, latency, the answer and the explorer link. `--scheme transfer` pays with a plain MUSD transfer instead of a permit.
5. **Run the tests:** `npm test` (52 tests, no network needed).
6. **Re-check the evidence against the chain:** `node scripts/verify-evidence.mjs` reads every row of the public ledger from Mezo testnet (receipt status, the MUSD `Transfer` from payer to treasury, the amount) and prints `verifiedOnChain` and the treasury balance.

## How it works

```
agent                         gateway (mezo.ochinimus.app)                  Mezo testnet         AgentFeed
  | GET /api/liquidations          |                                              |                    |
  |------------------------------->|                                              |                    |
  | 402 + PAYMENT-REQUIRED         |                                              |                    |
  |<-------------------------------|  MUSD, 0.02, treasury, spender, nonce        |                    |
  | read nonces(agent) -------------------------------------------------------->|                    |
  | sign Permit(agent -> settler, 0.02 MUSD, deadline)   (off-chain, no gas)     |                    |
  | GET + PAYMENT-SIGNATURE        |                                              |                    |
  |------------------------------->| verify: network, token, payTo, nonce, sig,   |                    |
  |                                |         balance, eth_call permit()  -------->|                    |
  |                                | GET /api/liquidations (prepaid key) --------------------------->  |
  |                                |<-------------------------------------------------- data ---------|
  |                                | permit() + transferFrom(agent -> treasury) ->| (gateway pays gas) |
  | 200 + data + explorer link     |                                              |                    |
  |<-------------------------------|                                              |                    |
```

Order matters: the gateway fetches the data **before** it settles, so if AgentFeed is down the agent is never charged and can retry with the same signed payment (`upstream_unavailable`, `charged:false`). A settlement that fails after a good answer withholds the data.

### Why permit, not x402 "exact"

x402's EVM `exact` scheme uses EIP-3009 `transferWithAuthorization`. MUSD does not implement it. Checked on the deployed testnet token `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` (OpenZeppelin `ERC20Permit`, `"Mezo USD"`, version `"1"`, 18 decimals): the bytecode has the `permit` and `nonces` selectors and none of `transferWithAuthorization`, `receiveWithAuthorization`, `authorizationState`. So the gateway defines two schemes on the same 402:

| scheme | the agent | gas paid by | how it is verified |
|---|---|---|---|
| `permit` (default) | signs an EIP-2612 `Permit(owner, settler, price, nonce, deadline)` | **the gateway** | signature recovered against the live domain and on-chain nonce, balance read, `permit()` simulated with `eth_call`, then `permit` + `transferFrom` from the settler key |
| `transfer` | sends a plain MUSD `transfer` to the treasury, presents the tx hash plus a signed claim | the agent | receipt is successful, has enough confirmations, is newer than the challenge, has a MUSD `Transfer` event to the treasury of at least the price, and the claim signature recovers to that transfer's sender (so nobody can claim someone else's transfer) |

Permit is the default because it gives the agent a one-shot, gasless call: the only thing an agent must hold is MUSD.

### Replay and abuse protection

Every payment is recorded in sqlite and refused on a second use, under all of these keys: the signature hash, the `(owner, permit nonce)` pair, the challenge nonce, and every settlement tx hash (so a settled permit's `transferFrom` cannot be re-presented as a `transfer` payment). Reservation is atomic and survives restarts. The challenge nonce is `issuedAt.expiresAt.random.hmac`, bound to one route and one price, expires in 300 s, and a permit deadline may not outlive it. Only one permit per owner address is in flight at a time. Over-payment is refused so no allowance is left behind. Failed payments never call AgentFeed.

## Routes

| route | MUSD per call | what |
|---|---|---|
| `/api/sol-price` | 0.01 | SOL/USD spot |
| `/api/btc-price` | 0.01 | BTC/USD spot |
| `/api/liq-pulse` | 0.01 | what is being liquidated right now |
| `/api/funding-pulse` | 0.01 | the most extreme perp funding rates |
| `/api/liquidations` | 0.02 | live liquidation tape (`symbol`, `scope`, `limit`, `min_usd`) |
| `/api/market-snapshot` | 0.02 | market snapshot in one call |
| `/api/trade-context` | 0.03 | prices, funding and liquidations in one call |
| `/api/summarize` | 0.05 | language task: summarize `?url=` |

Unknown query parameters are dropped before the call is forwarded. `HEAD`, `POST` and the rest are refused with 405, so there is no free verb.

## Addresses (Mezo testnet, chain 31611)

| | address |
|---|---|
| MUSD token | [`0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503`](https://explorer.test.mezo.org/address/0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503) |
| Treasury (receives MUSD) | [`0xf01d65DBd1B946C48b7dB1f0A02AaBd021c89227`](https://explorer.test.mezo.org/address/0xf01d65DBd1B946C48b7dB1f0A02AaBd021c89227) |
| Settler (permit spender, pays gas) | [`0xaB7323cB6aaB188D7Dca697496534BA6C95ddbC2`](https://explorer.test.mezo.org/address/0xaB7323cB6aaB188D7Dca697496534BA6C95ddbC2) |
| Demo agent wallet | [`0x9691FedC701cD8bbDF4D0b06Dd7C9ABf2e9037B4`](https://explorer.test.mezo.org/address/0x9691FedC701cD8bbDF4D0b06Dd7C9ABf2e9037B4) |
| Mezo Borrow (used to mint testnet MUSD) | [`0xCdF7028ceAB81fA0C6971208e83fa7872994beE5`](https://explorer.test.mezo.org/address/0xCdF7028ceAB81fA0C6971208e83fa7872994beE5) |

Source of the token address: `solidity/artifacts/deployments/matsnet/MUSD.json` in [mezo-org/musd](https://github.com/mezo-org/musd). The `mainnet` and `ethereum` deployment folders in that repo list `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186`, and a contract named "Mezo USD / MUSD", 18 decimals, with the same `permit` selectors, answers at that address on Base mainnet (checked by `eth_getCode` and `eth_call` against `mainnet.base.org`). That is the Wave 2 target below.

## Sample paid transactions

| route | scheme | MUSD | settlement (`transferFrom` / transfer) | permit tx |
|---|---|---|---|---|
| `liquidations` | permit | 0.02 | [`0xeb5a798a…01972d`](https://explorer.test.mezo.org/tx/0xeb5a798a1aa0fe7039cd429f0b2fa21e2fd0b35a7eb1d75ee734672d3401972d) | [`0xe1c3029d…935ce6`](https://explorer.test.mezo.org/tx/0xe1c3029d3d198d3eec4bce260c0afaee981b25a5b7251f117ac5ad3583935ce6) |
| `summarize` | permit | 0.05 | [`0xa5326990…590264`](https://explorer.test.mezo.org/tx/0xa532699004c6fb0c7444e69ae482de72507f367f9cfde6f587945fc06c590264) | [`0xc7feba69…3b1c14`](https://explorer.test.mezo.org/tx/0xc7feba69ab0cc640a0b497faabd1125fd3d6181e534bbc10feecbc59c33b1c14) |
| `trade-context` | permit | 0.03 | [`0xa7bfc89e…db27d0`](https://explorer.test.mezo.org/tx/0xa7bfc89e66b4425b9b8964915c78bb258712cbc0ce4b69e3965c98047ddb27d0) | [`0xf8a292bf…d9fdfd`](https://explorer.test.mezo.org/tx/0xf8a292bf36568ec1b8ab9d2ac26958485297dd99ca27f2d95c0782bd01d9fdfd) |
| `funding-pulse` | transfer | 0.01 | [`0xf05aa01b…00de4e`](https://explorer.test.mezo.org/tx/0xf05aa01bfb4f32ba72a6f5efcb556772b97a18bf1e949c11b3332d4fe000de4e) | none, agent paid gas |

How the demo agent got its MUSD: faucet BTC, then [`openTrove`](https://explorer.test.mezo.org/tx/0x3449564ce5f35584f9ca424c5565a45bc8e6653252b35adf51eb4b75a335a45c) on Mezo Borrow (0.042 BTC collateral at 165% ICR, 1850 MUSD out), the same flow `scripts/fund-musd.mjs` automates.

## For agents: client and MCP tool

```sh
AGENT_PRIVATE_KEY=0x... GATEWAY_URL=https://mezo.ochinimus.app node src/client.js <route> [key=value ...] [--scheme permit|transfer] [--n 5]
```

[`src/client.js`](src/client.js) refuses to sign a challenge for another network or token, or one above `MAX_PRICE_MUSD` (default 0.10). The MCP server is [`src/mcp.js`](src/mcp.js) (stdio):

```json
{ "mcpServers": { "agentfeed-mezo": { "command": "node", "args": ["/path/to/agentfeed-mezo/src/mcp.js"],
  "env": { "AGENT_PRIVATE_KEY": "0x...", "GATEWAY_URL": "https://mezo.ochinimus.app" } } } }
```

Tools: `list_routes` (free) and `call_route { route, params?, scheme? }`, which pays in MUSD and returns the data and the explorer link. `node scripts/mcp-smoke.mjs` drives it end to end over stdio.

## How it extends AgentFeed

AgentFeed ([x402.ochinimus.app](https://x402.ochinimus.app), 83 paid routes, MCP server on the official registry, elizaOS plugin `@seekdaseek/plugin-agentfeed`) already takes USDC on Solana, Base, Polygon, Arbitrum and Arc, but every one of those rails depends on EIP-3009 or SPL transfers. MUSD is a different kind of token: ERC-20 plus EIP-2612 permit. This gateway adds that rail **without touching the production server**: it is a separate service that buys from AgentFeed with a prepaid API key (half list price) and resells in MUSD at 1 to 5 cents. Nothing in `/opt/agentfeed` was restarted or edited.

## Run your own

```sh
npm install && npm test
cat > .env <<'EOF2'
TREASURY_ADDRESS=0x...        # receives the MUSD
SETTLER_PRIVATE_KEY=0x...     # permit spender; needs a little testnet BTC for gas
CHALLENGE_SECRET=<random hex> # HMAC key for challenge nonces
UPSTREAM_KEY=afk_...          # an AgentFeed prepaid key (x402.ochinimus.app/keys)
PUBLIC_URL=http://localhost:3034
EOF2
chmod 600 .env && npm start
```

Optional: `PORT`, `HOST`, `MEZO_RPC_URL`, `MUSD_ADDRESS`, `UPSTREAM_URL`, `DB_PATH`, `CHALLENGE_TTL_SEC`, `CONFIRMATIONS`, `DAILY_UPSTREAM_CAP` (defaults in [`src/config.js`](src/config.js)). Deployed here as PM2 `agentfeed-mezo` on port 3034 behind its own Cloudflare tunnel.

## Tests

`npm test` runs 52 tests with Node's built-in runner: the real gateway code over a fake chain adapter and a fake AgentFeed, with real EIP-712 and EIP-191 signatures. They cover the happy path for both schemes, replay (same permit, same challenge, same tx hash, a settlement tx re-presented as a transfer), underpayment, over-payment, wrong token, wrong chain (network field and a permit signed for another chain id), wrong recipient, wrong spender, stale permit nonce, a signature by someone else, expired nonce, a nonce for another route, RPC down, AgentFeed down (clean 502, payer not charged, same payment works after recovery), settlement failure, and a concurrent double spend. Mocks are used only here; none of the paid-call evidence above is simulated.

## Status and honest limits

- One payment was refused after the agent had paid: the first `transfer`-scheme call hit a Mezo RPC node that had not indexed the receipt and got `tx_not_found`. The 0.01 MUSD stays in the treasury as unmatched dust ([`evidence/unclaimed.md`](evidence/unclaimed.md)). The gateway now retries a missing receipt for about 8 seconds and the client retries that refusal with the same payment; 6 `transfer` calls afterwards all succeeded.
- The public Mezo RPC answers from several nodes and the same receipt can read as null on one call and be present on the next (measured). The gateway's reads can therefore, rarely, refuse a good payment; refusals never take money in the `permit` scheme.
- Testnet only. MUSD on Mezo testnet has no dollar value; the point is that the full payment path runs against the real contract and chain.
- Gas for settlement is paid by the gateway's settler key, funded from the faucet. On mainnet that cost has to be priced into the call or fronted by a fee, see Wave 2.
- One permit in flight per agent address. An agent that wants parallel calls uses several addresses or the `transfer` scheme.
- The gateway calls AgentFeed with one prepaid key and a daily cap (`DAILY_UPSTREAM_CAP`, default 5000 calls).

## Wave 2 plan

1. **Mezo mainnet MUSD.** Same code with a mainnet chain id, RPC and token address from the Mezo docs; add a per-call gas surcharge.
2. **MUSD on Base.** MUSD already trades on Base, so agents that live on Base can pay without bridging. Add the Base network to the 402 `accepts`, and a read-only price check against the Base pools.
3. **A Telegram bot that tops up and spends MUSD for agents.** A person funds a bot-held budget in MUSD, sets per-day caps, and the bot signs permits for their agents, so a trading bot or eliza agent gets data without ever holding a key. This is the Track 2 distribution surface.
4. A `permit`-based spend allowance per agent (one signature, many calls) to remove the one-in-flight limit.

## License

MIT, see [LICENSE](LICENSE).

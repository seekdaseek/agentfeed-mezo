# Base Builder Code (ERC-8021) evidence, 15 Nov 2026

Every Base mainnet transaction this gateway's code sends itself carries the ERC-8021 suffix for the builder code `bc_g6qgnam4` (suffix `0x62635f673671676e616d340b0080218021802180218021802180218021`). The code lives in `src/builder-code.js`; `createWalletClient({ dataSuffix })` appends it on chain 8453 only (Mezo chains get none), in the settler (`src/chain.js`), the agent's own transfer (`src/client.js`) and the one-off Base scripts. `test/builder-code.test.js` decodes the suffix from the raw transactions.

One real paid call on Base through the normal path (`NETWORK=base node src/client.js sol-price`, 0.01 MUSD, status 200). Both transactions were sent by the Base settler `0x735Cd2E2F4E4c87e7587A099a21b4d3fe15d763e`, and both read back from Base end in `80218021802180218021802180218021` and decode to `["bc_g6qgnam4"]`:

| tx | function | hash |
|---|---|---|
| permit | `permit` | [0x15b853993e66d1df8a3448bf2ed0ea61a146a1c38b7d9b129383f1a5f24a4248](https://basescan.org/tx/0x15b853993e66d1df8a3448bf2ed0ea61a146a1c38b7d9b129383f1a5f24a4248) |
| settlement | `transferFrom` | [0x5c569d08bb0030db55ff76e891f63262476b7901f9d0e3479ae63164370fba68](https://basescan.org/tx/0x5c569d08bb0030db55ff76e891f63262476b7901f9d0e3479ae63164370fba68) |

builder-code-checker.vercel.app on the settlement hash: "8021 Attributed", schema 0 (canonical registry), builder code `bc_g6qgnam4`.

Funding the payer for it (it held no MUSD): a 0.10 USDC EIP-3009 transfer from our x402 test wallet ([0x1e5d6bc8…3534](https://basescan.org/tx/0x1e5d6bc8b0628d7e6fd9ca68d68c4295b192ad2e540567161797fd7c58153534)), then approve ([0xac83bd64…d9798](https://basescan.org/tx/0xac83bd64c11c1875ec62bb4fc8c39000c43f83d632c6d1a4491a750bc73d9798)) and swap to 0.1008 MUSD ([0x95508cf5…d31f](https://basescan.org/tx/0x95508cf5ff79a4beaae130cb6543078cad30523fb10c0f0a2c76ffeefb33d31f)); all three also carry the code.

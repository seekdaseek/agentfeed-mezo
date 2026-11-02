# Base mainnet evidence, Wave 2 (Nov 2 2026)

Real MUSD on Base (`0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186`), paid to the gateway's Base treasury `0x3a110E3306Eac48C6531325797B2aa92D9d096c7`, settled by the Base settler `0x735Cd2E2F4E4c87e7587A099a21b4d3fe15d763e`. The payer is one wallet we run, `0xB96c536A2b01584c5Dd8967AF0d8Ba97eBC2417F`; it is listed in `OWN_WALLETS`, so `/stats` counts it as ours, not as an outside payer.

**51 paid calls on Base so far, all 10 routes, both schemes.** Every row is in [`paid-calls.csv`](paid-calls.csv) (network column `eip155:8453`) and was re-read from Base by `node scripts/verify-evidence.mjs`.

How the payer got its MUSD (no new money): 0.90 USDC from an existing test wallet, [approved](https://basescan.org/tx/0x6698705fa5744bbdfbf27a793a910be090e46d9d76cc881efcce9176ec418934) (block 53409010, 55,437 gas; recovered from the USDC `Approval` event because the first run's output was lost), then swapped on PancakeSwap V3 (USDC/MUSD 0.01% pool) for 0.908797545 MUSD: [swap](https://basescan.org/tx/0x3ea3a03ddba8783af11855fc86cf69db088d18f578926d149c40370240798e78). Spent MUSD collects in the treasury and is sent back to the payer by [`scripts/recycle-base.mjs`](../scripts/recycle-base.mjs): [recycle of 0.9 MUSD](https://basescan.org/tx/0x357a13c31426d3ffab6eb127183a7643f7e0ce3d827fe0fa83b26ddae78a0d75), 29,785 gas.

| route | scheme | MUSD | settlement | permit tx |
|---|---|---|---|---|
| mezo-peg | permit | 0.03 | [0xaa92e2f1fb…](https://basescan.org/tx/0xaa92e2f1fb5dd0cb2181f70c89bd2f470d71072393e0a9fa5f94fb38b9e9fd5a) | [0xf3608bfae5…](https://basescan.org/tx/0xf3608bfae56fd5179e197f63f90bd3af532bc4c1472aec04fe3fbd2d270e7299) |
| mezo-trove (testnet address) | permit | 0.02 | [0x247cd0b0d9…](https://basescan.org/tx/0x247cd0b0d90a96b38f7cbbaa83212aecc89fc1509596541f78b4d51c4e1c6c7e) | [0x380aafa896…](https://basescan.org/tx/0x380aafa896d2163f6243b6278c58f4c118a7f4875e4e744aa5e5a31488b42407) |
| summarize | permit | 0.05 | [0xe7f074537f…](https://basescan.org/tx/0xe7f074537f9510dfeaf1384b3fffd443332cff424559f2bd291ce85a13411fd6) | [0x281e67ff44…](https://basescan.org/tx/0x281e67ff44f5963ae2881c0f66faf26ad1e29b9d9fc2c306e1db085e31a84829) |
| sol-price by transfer | transfer | 0.01 | [0x1f21a3eafa…](https://basescan.org/tx/0x1f21a3eafa7afa2a1561fa146056fc746d641ddc446a021ef7abbe394004e844) | agent paid gas |
| liquidations | permit | 0.02 | [0x4f452d78e0…](https://basescan.org/tx/0x4f452d78e02c16409e5fbd9325626755f305edaafb78f41b550687dbeba4760d) | [0xce583ae32a…](https://basescan.org/tx/0xce583ae32a9aec862e274932d77f52d311a43dc283c4c801cbd5ab0b4f95266f) |

Calls by route on Base: btc-price 5, funding-pulse 6, liq-pulse 7, liquidations 5, market-snapshot 4, mezo-peg 4, mezo-trove 3, sol-price 10, summarize 4, trade-context 3.

## Gas, from the chain (ETH on Base at about $2,285)
The three Base wallets were funded with 0.0002 ETH in total. The settler spent 3.57e-5 ETH on 84 transactions (the permit and transferFrom of each paid call, about 4.3e-7 ETH or $0.001 per call), the payer 3.3e-6 ETH (approve, swap, three transfer-scheme payments), the treasury 1.8e-7 ETH (the one recycle). **Total 3.92e-5 ETH, about $0.09.**

## What went wrong on the way, and the fix
The first two Base batches had 13 of 27 and 8 of 23 calls refused, none charged. Base blocks are 2 seconds and the public RPC answers from nodes at different heights, so a nonce that had just been used still read as current, on the client and on the gateway: `payment_replayed` or `bad_signature`. Fix: the gateway now treats its own ledger as a floor for the permit nonce (the nonce only goes up), publishes it at `GET /nonce/<chainId>/<address>`, and the client takes the highest of every RPC and the gateway. After the fix, 0 of 23 were refused for that reason (the 8 refusals in the last batch were `insufficient_balance`, the payer had spent its 0.91 MUSD; MUSD was then recycled from the treasury).

The three setup transactions (approve, swap, recycle) are listed with their gas in [`setup-txs.csv`](setup-txs.csv).

# One payment the gateway refused, and why

While running the first batch of paid calls, the first `transfer`-scheme call (route `sol-price`) sent 0.01 MUSD on-chain
and was then refused with `tx_not_found`: the gateway's RPC read hit a Mezo testnet node that had not indexed the
fresh receipt yet. The payer was charged on-chain and got no data.

- Transfer: [`0x31e93efcfd15fae2ca0140417cf6bc8be146d4bfd20b32cb728cf16572d811fc`](https://explorer.test.mezo.org/tx/0x31e93efcfd15fae2ca0140417cf6bc8be146d4bfd20b32cb728cf16572d811fc), 0.01 MUSD from the demo agent to the treasury.
- It is not in `paid-calls.csv` (no call was served), so the treasury holds the ledger total plus 0.01 MUSD.
- Fix, shipped the same day: the gateway now retries a missing receipt for about 4 seconds, and the client retries a refusal of that kind with the same payment while the challenge is still valid.
- The challenge for that payment has expired, so the transfer cannot be redeemed afterwards (the `tx_before_challenge` rule refuses it): the 0.01 MUSD stays as testnet dust.

`node scripts/verify-evidence.mjs` prints this as `unclaimedInTreasuryMusd: 0.01`.

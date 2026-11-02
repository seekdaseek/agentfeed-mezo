#!/bin/sh
# Real paid calls on one network, all routes including the two Mezo-native ones; the last calls use the plain-transfer scheme.
# AGENT_PRIVATE_KEY=0x... NETWORK=base GATEWAY_URL=https://mezo.ochinimus.app sh scripts/run-batch-wave2.sh [rounds]
ROUNDS=${1:-3}
TROVE=${TROVE_ADDRESS:-0x9691FedC701cD8bbDF4D0b06Dd7C9ABf2e9037B4}
i=0
while [ $i -lt $ROUNDS ]; do
  for r in sol-price btc-price liq-pulse funding-pulse market-snapshot trade-context "liquidations limit=5 symbol=SOL" "summarize url=https://mezo.org" mezo-peg "mezo-trove address=$TROVE network=testnet"; do
    node src/client.js $r
  done
  i=$((i+1))
done
for r in sol-price liq-pulse funding-pulse; do node src/client.js $r --scheme transfer; done

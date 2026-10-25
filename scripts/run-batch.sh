#!/bin/sh
# Real paid calls against the live gateway, cycling every route; the last calls use the plain-transfer scheme.
# AGENT_PRIVATE_KEY=0x... GATEWAY_URL=https://mezo.ochinimus.app sh scripts/run-batch.sh [rounds]
ROUNDS=${1:-6}
i=0
while [ $i -lt $ROUNDS ]; do
  for r in sol-price btc-price liq-pulse funding-pulse market-snapshot trade-context "liquidations limit=5 symbol=SOL" "summarize url=https://mezo.org"; do
    node src/client.js $r
  done
  i=$((i+1))
done
for r in sol-price btc-price liq-pulse funding-pulse; do node src/client.js $r --scheme transfer; done

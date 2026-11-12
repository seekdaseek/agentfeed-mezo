#!/bin/sh
# Real paid calls in MUSD on Mezo MAINNET (chain 31612) from our own mainnet agent wallet. Permit scheme only: the agent holds no BTC for gas.
# The key is read from the gitignored wallets file into the environment of the child processes and never printed.
#   sh scripts/run-batch-mainnet.sh [rounds]
ROUNDS=${1:-1}
cd "$(dirname "$0")/.." || exit 1
export AGENT_PRIVATE_KEY=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('.secrets/wallets-mainnet.json','utf8'))['mezo-mainnet-agent'].key)")
export NETWORK=mezo-mainnet GATEWAY_URL=https://mezo.ochinimus.app
AGENT=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('.secrets/wallets-mainnet.json','utf8'))['mezo-mainnet-agent'].address)")
i=0
while [ $i -lt $ROUNDS ]; do
  for r in sol-price btc-price liq-pulse funding-pulse market-snapshot trade-context "liquidations limit=5 symbol=SOL" "summarize url=https://mezo.org" mezo-peg "mezo-trove address=$AGENT network=mainnet"; do
    node src/client.js $r
  done
  i=$((i+1))
done

#!/bin/sh
# Nov 12 2026: turn Mezo mainnet on in the live gateway (VPS solwatch, /opt/agentfeed-mezo). Runs on the MAC.
# Adds the mainnet treasury and settler key (key piped over ssh from the gitignored wallets file, never printed),
# appends mezo-mainnet to NETWORKS and the mainnet agent to OWN_WALLETS, then pm2 delete + start + save (never restart: PM2 freezes env).
# Refuses to run when MemAvailable on the box is below 1,500 MB. Source files on the box are unchanged: no code change is needed.
#   sh scripts/enable-mainnet-vps.sh            dry run (checks only)
#   sh scripts/enable-mainnet-vps.sh --apply
cd "$(dirname "$0")/.." || exit 1
W=.secrets/wallets-mainnet.json
get() { node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$W','utf8'))['$1'].$2)"; }
TREAS=$(get mezo-mainnet-treasury address); SETKEY=$(get mezo-mainnet-settler key); AGENT=$(get mezo-mainnet-agent address)
echo "treasury $TREAS agent $AGENT settler key length ${#SETKEY}"
MEM=$(ssh -o BatchMode=yes solwatch "awk '/MemAvailable/{print int(\$2/1024)}' /proc/meminfo")
echo "MemAvailable MB $MEM"
[ "$MEM" -ge 1500 ] || { echo "REFUSED: MemAvailable below 1500 MB"; exit 1; }
ssh -o BatchMode=yes solwatch "cd /opt/agentfeed-mezo && grep -c '^MEZO_MAINNET_' .env; grep -E '^(NETWORKS|OWN_WALLETS)=' .env | cut -c1-200"
[ "$1" = "--apply" ] || { echo "dry run done"; exit 0; }
ssh -o BatchMode=yes solwatch "cd /opt/agentfeed-mezo && cp -p .env .env.bak-20261112 && grep -q '^MEZO_MAINNET_' .env && { echo 'already has MEZO_MAINNET_ lines, stopping'; exit 1; }; true" || exit 1
printf 'MEZO_MAINNET_TREASURY_ADDRESS=%s\nMEZO_MAINNET_SETTLER_PRIVATE_KEY=%s\n' "$TREAS" "$SETKEY" | ssh -o BatchMode=yes solwatch "cd /opt/agentfeed-mezo && cat >> .env && sed -i 's/^NETWORKS=.*/&,mezo-mainnet/' .env && sed -i 's/^OWN_WALLETS=.*/&,$AGENT/' .env && grep -c '^MEZO_MAINNET_' .env && grep -E '^(NETWORKS|OWN_WALLETS)=' .env | cut -c1-260"
ssh -o BatchMode=yes solwatch "cd /opt/agentfeed-mezo && pm2 delete agentfeed-mezo && pm2 start src/main.js --name agentfeed-mezo --node-args='--env-file=/opt/agentfeed-mezo/.env' --cwd /opt/agentfeed-mezo && pm2 save && sleep 3 && pm2 logs agentfeed-mezo --lines 5 --nostream | sed -E 's/0x[0-9a-fA-F]{64}/<key>/g'"

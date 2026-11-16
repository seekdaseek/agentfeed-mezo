# agentfeed-mezo LOG

## 2026-11-16 Gas top-up on Mezo mainnet (chain 31612)
- Requested by Sergiu in chat: exactly 0.00002 BTC (native) from the settler 0x5D41E85833eF8ba943930b8006CBc1c326279F35 to the Base/EVM treasury 0x22DB3A9686EE5261e7Bf3ed4f91277232E8076e6.
- Script run on the box from /opt/agentfeed-mezo (viem; the settler key read from .env into memory only, never printed; the script checked that the key matches the named address and that the RPC answers chain 31612; the temporary script file was deleted after). A dry run first read the balances: settler 0.000074378881625 BTC, treasury 0.00000296261265 BTC.
- Sent: tx **0x984aa0a73d5ee1663b17e04b5518146939719b804b9bdcb2ed597b69739390a9**, block 13265626, receipt status success (1), gas used 21,000 at an effective gas price of 1,462,500 wei (3.07e-8 BTC).
- After: settler 0.000054348169125 BTC (= before - 0.00002 - gas), treasury 0.00002296261265 BTC (= before + 0.00002 exactly).
- No pm2 process was touched; nothing else was sent.

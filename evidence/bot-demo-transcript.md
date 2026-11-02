# Telegram demo, Nov 2 2026: a trove draw refused at the 200% floor, then allowed at 150%

The bot's own transcript (@AgentFeedBudgetBot, running on the VPS), with the Telegram user id replaced by OWNER-ID. Everything below ran on **Mezo testnet** (test MUSD, test BTC): the trove is a testnet trove. Mezo itself liquidates at 110%; the 200% and 150% floors are this bot's own, checked off-chain.

The first successful draw transaction was mined but the bot reported failure (its receipt poll gave up too early); that is the "did not succeed" reply, fixed in commit ee45ae7, and the MUSD it minted was credited afterwards with /confirm. See REPORT-wave2.

**09:02:01Z owner**

```
/start
```

**09:02:01Z bot**

```
AgentFeed on Mezo: budgets for your agents. Your agent wallet pays per call in MUSD; the gateway refuses any call over the limits you set here.

/regmsg <name> <address>   the message your agent wallet signs to prove it is yours
/newagent <name> <address> <daily cap MUSD> <signature>
/agents                     your agents and what is left
/agent <name>               one agent in full
/calls <name> [n]           the last paid calls, with explorer links
/topup <name> <MUSD> [network]   how to fund the budget by sending MUSD
/confirm <name> <txhash> [network]   credit a MUSD transfer you sent to the agent wallet
/drawmsg <name> <MUSD> <trove address> [network]   the typed data your trove wallet signs
/draw <name> <MUSD> <trove address> <deadline> <signature> [network]   fund from your own Mezo trove (floor checked here, off-chain)
/setcap <name> <MUSD>       change the daily cap (resets at UTC midnight)
/setfloor <name> <percent>  lowest collateral ratio a draw may leave your trove at (default 200)
/pause <name>   /resume <name>   /revoke <name> yes   (revoke is final)
```

**09:02:47Z owner**

```
/regmsg demo1 0xeA0a44e3bFBCf9Be7B43881f2DdA2Ed3A7f498EF
```

**09:02:47Z bot**

```
Sign this exact text with the agent wallet (personal_sign), then send /newagent:

AgentFeed-Mezo agent registration
owner:OWNER-ID
name:demo1
address:0xea0a44e3bfbcf9be7b43881f2dda2ed3a7f498ef

With this repo: AGENT_PRIVATE_KEY=0x... node src/client.js sign-register OWNER-ID demo1
```

**09:03:05Z owner**

```
/newagent demo1 0xeA0a44e3bFBCf9Be7B43881f2DdA2Ed3A7f498EF 0.50 0x4b3ccd62d06777ba41cbf85f1f07839b5108c083d5ca637769ed65bf8b26a535344070cf6b24755705ea4ca1e84800288ec8e93b1961873b95f4d4381214f3651b
```

**09:03:05Z bot**

```
Agent demo1 registered for 0xeA0a44e3bFBCf9Be7B43881f2DdA2Ed3A7f498EF.
Budget is 0 MUSD, so every call is refused until you fund it.
Daily cap 0.50 MUSD (resets 00:00 UTC). Next: /topup demo1 2
```

**09:03:19Z owner**

```
/agent demo1
```

**09:03:19Z bot**

```
demo1 [active]
wallet 0xeA0a44e3bFBCf9Be7B43881f2DdA2Ed3A7f498EF
budget left 0.00 of 0.00 MUSD (spent 0.00)
today 0.00 of 0.50 MUSD, resets 00:00 UTC
trove floor 200% (checked by this bot, off-chain)
```

**09:03:40Z owner**

```
/draw demo1 50 0x9691FedC701cD8bbDF4D0b06Dd7C9ABf2e9037B4 1793613739 0x970f59e47518018b5374145ee879fb817f7fae481a406fc3a8ca40f72f83f9394101175e954118b6dd2fb8f70d4d166d1af98702f1c590d79bccdfd5c6ccbdb11c mezo-testnet
```

**09:03:41Z bot**

```
Draw refused, nothing was sent on-chain: it would leave the trove at 156% collateral ratio, below your floor of 200% (it is 160% now). Draw less or add collateral.
```

**09:04:05Z owner**

```
/setfloor demo1 150
```

**09:04:05Z bot**

```
Trove floor for demo1 is now 150%. This is checked by the bot before it submits a draw; Mezo itself only enforces 110%.
```

**09:04:14Z owner**

```
/draw demo1 50 0x9691FedC701cD8bbDF4D0b06Dd7C9ABf2e9037B4 1793613739 0x970f59e47518018b5374145ee879fb817f7fae481a406fc3a8ca40f72f83f9394101175e954118b6dd2fb8f70d4d166d1af98702f1c590d79bccdfd5c6ccbdb11c mezo-testnet
```

**09:04:24Z bot**

```
The draw transaction 0xf60c3f77f9f450ccc4b4ba2cffd82af520e865ed6f49825e31243a56b634e568 did not succeed on Mezo testnet; the budget was not credited.
```

**09:05:57Z owner**

```
/draw demo1 50 0x9691FedC701cD8bbDF4D0b06Dd7C9ABf2e9037B4 1793613936 0x06c462ef6132fded7db47a83e694e6af990572ec5bc7c9bcf2b473d25e8510635a8eae24cef9ecbb78a6e5f3eae4c72aaaffdf8f4d3b91551d627fc6c7e6183e1b mezo-testnet
```

**09:06:08Z bot**

```
Drew 50.00 MUSD from 0x9691FedC701cD8bbDF4D0b06Dd7C9ABf2e9037B4's trove on Mezo testnet [TESTNET (test MUSD)] into demo1. https://explorer.test.mezo.org/tx/0x9bcd592c3acffa27899d827a6e0e523cf24a86fc86c87af87365dacce1b7d06d
Your bitcoin did not move. Collateral ratio 156% -> 153% (floor 150%, checked by this bot off-chain right before it submitted).
Budget left 50.00 MUSD.
```

**09:06:31Z owner**

```
/agent demo1
```

**09:06:31Z bot**

```
demo1 [active]
wallet 0xeA0a44e3bFBCf9Be7B43881f2DdA2Ed3A7f498EF
budget left 50.00 of 50.00 MUSD (spent 0.00)
today 0.00 of 0.50 MUSD, resets 00:00 UTC
trove floor 150% (checked by this bot, off-chain)
last top-ups:
  2026-11-02T09:05Z topup-draw 50.00 MUSD eip155:316…b7d06d
```

**09:06:59Z owner**

```
/setcap demo1 0.03
```

**09:06:59Z bot**

```
Daily cap for demo1 is now 0.03 MUSD.
```

**09:07:22Z owner**

```
/calls demo1
```

**09:07:22Z bot**

```
11-02T09:06Z liquidations 0.02 MUSD Mezo testnet
  https://explorer.test.mezo.org/tx/0x2af1ae19e306f6d5ac3861167ea703defa6f988cee096f3caccb41324218a44c
```

**09:07:50Z owner**

```
/confirm demo1 0xf60c3f77f9f450ccc4b4ba2cffd82af520e865ed6f49825e31243a56b634e568 mezo-testnet
```

**09:07:50Z bot**

```
Credited 50.00 MUSD to demo1. https://explorer.test.mezo.org/tx/0xf60c3f77f9f450ccc4b4ba2cffd82af520e865ed6f49825e31243a56b634e568
Budget left 99.98 MUSD.
```


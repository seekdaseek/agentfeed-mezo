// Telegram front end for src/botcore.js. Long polling, private chats only. Run as its own process:
//   node --env-file=.env src/bot.js          (needs TELEGRAM_BOT_TOKEN from @BotFather, plus the gateway's .env)
import { Bot } from 'grammy';
import { loadConfig } from './config.js';
import { openStore } from './store.js';
import { openAgents } from './agents.js';
import { makeReader } from './chain.js';
import { makeBotCore, HELP } from './botcore.js';
import { makeTrove, makeTroveOps } from './trove.js';

const token = process.env.TELEGRAM_BOT_TOKEN || '';
if (token.length < 30) { console.error(`TELEGRAM_BOT_TOKEN missing or too short (length ${token.length})`); process.exit(2); }

const cfg = loadConfig();
const store = openStore(cfg.dbPath);
const agents = openAgents(store.db);
const readers = Object.fromEntries(cfg.networks.map((n) => [n.network, makeReader(n)]));
const opsCache = new Map();
const opsFor = (net) => { if (!opsCache.has(net.network)) opsCache.set(net.network, makeTroveOps(net, readers[net.network])); return opsCache.get(net.network); };
const core = makeBotCore({ agents, networks: cfg.networks, readers, trove: makeTrove({ agents, opsFor }) });

const bot = new Bot(token);
const last = new Map(); // simple per-user rate limit: one command per second
bot.on('message:text', async (ctx) => {
  if (ctx.chat.type !== 'private') return; // never answer in groups: budgets are private
  const id = ctx.from.id;
  const t = Date.now();
  if (t - (last.get(id) || 0) < 1000) return;
  last.set(id, t);
  let reply;
  try { reply = await core.handle(id, ctx.message.text); } catch (e) { console.error('handler error', e.message); reply = 'Something went wrong on my side. Nothing was changed.'; }
  await ctx.reply(String(reply).slice(0, 4000), { link_preview_options: { is_disabled: true } });
});
bot.catch((e) => console.error('bot error', e.message));
await bot.api.setMyCommands([{ command: 'help', description: 'what this bot does' }, { command: 'agents', description: 'your agents and budgets' }, { command: 'newagent', description: 'register an agent wallet' }]);
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { bot.stop(); store.close(); process.exit(0); });
console.log(`agentfeed-mezo bot started; networks=${cfg.networks.map((n) => n.key).join(',')}; help is ${HELP.split('\n')[0].length} chars`);
bot.start();

// Process entry. Kept separate from server.js because PM2 fork mode makes argv[1] its own container,
// so an "is this the main module" check never fires under PM2.
import { loadConfig } from './config.js';
import { openStore } from './store.js';
import { makeChain } from './chain.js';
import { createGateway } from './server.js';

const cfg = loadConfig();
const store = openStore(cfg.dbPath);
const chain = makeChain(cfg);
const server = createGateway({ cfg, chain, store });
server.listen(cfg.port, cfg.host, () => console.log(`agentfeed-mezo listening on ${cfg.host}:${cfg.port} settler=${chain.settlerAddress} treasury=${cfg.treasury}`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(); store.close(); process.exit(0); });

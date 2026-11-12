// Adds one fresh hot wallet role to .secrets/wallets-mainnet.json (mode 600). Refuses to overwrite a role. Prints the address only.
//   node scripts/add-wallet-role.mjs <role>
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import fs from 'node:fs';

const role = process.argv[2];
if (!/^[a-z0-9-]{3,40}$/.test(role ?? '')) throw new Error('usage: node scripts/add-wallet-role.mjs <role>');
const P = new URL('../.secrets/wallets-mainnet.json', import.meta.url);
const o = JSON.parse(fs.readFileSync(P, 'utf8'));
if (o[role]) throw new Error(`${role} already exists, not overwritten`);
const k = generatePrivateKey();
o[role] = { address: privateKeyToAccount(k).address, key: k, created: new Date().toISOString(), note: 'fresh hot wallet, Nov 11 2026, own funds only' };
fs.writeFileSync(P, JSON.stringify(o, null, 1), { mode: 0o600 });
fs.chmodSync(P, 0o600);
console.log(role, o[role].address);

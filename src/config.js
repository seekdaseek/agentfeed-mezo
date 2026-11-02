// Runtime configuration. Everything comes from the environment so the same code runs on the VPS and in tests.
export const MEZO_TESTNET = {
  chainId: 31611,
  network: 'eip155:31611',
  rpcUrl: 'https://rpc.test.mezo.org',
  explorer: 'https://explorer.test.mezo.org',
};

// MUSD on Mezo testnet ("matsnet"): github.com/mezo-org/musd solidity/artifacts/deployments/matsnet/MUSD.json
export const MUSD = {
  address: '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503',
  name: 'Mezo USD',
  version: '1',
  symbol: 'MUSD',
  decimals: 18,
};

// MUSD on Mezo mainnet and on Base is one address with the same EIP-2612 permit and the domain name "Mezo USD" v"1";
// only the chain id in the domain differs. Verified on-chain on Nov 2 2026 (eip712Domain + recomputed DOMAIN_SEPARATOR).
const MUSD_MAIN = { ...MUSD, address: '0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186' };

// Mezo Borrow contracts per Mezo network (mezo-org/musd, solidity/artifacts/deployments/{matsnet,mainnet}); Base has none.
const BORROW_TEST = { borrowerOperations: '0xCdF7028ceAB81fA0C6971208e83fa7872994beE5', signatures: '0xD757e3646AF370b15f32EB557F0F8380Df7D639e', troveManager: '0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0', priceFeed: '0x86bCF0841622a5dAC14A313a15f96A95421b9366', hintHelpers: '0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6', sortedTroves: '0x722E4D24FD6Ff8b0AC679450F3D91294607268fA' };
const BORROW_MAIN = { borrowerOperations: '0x44b1bac67dDA612a41a58AAf779143B181dEe031', signatures: '0xB57ab578BF20b3e318f3EFAA587C51DBccE5df7a', troveManager: '0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193', priceFeed: '0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88', hintHelpers: '0xD267b3bE2514375A075fd03C3D9CBa6b95317DC3', sortedTroves: '0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f' };

// Every network the gateway can sell on. `envPrefix` names the variables of a non-legacy network; the testnet keeps the
// Wave 1 names (TREASURY_ADDRESS, SETTLER_PRIVATE_KEY) so the running deployment needs no change.
export const NETWORK_DEFS = {
  'mezo-testnet': {
    network: MEZO_TESTNET.network, chainId: MEZO_TESTNET.chainId, label: 'Mezo testnet', mainnet: false,
    rpcUrls: [MEZO_TESTNET.rpcUrl], explorer: MEZO_TESTNET.explorer, asset: MUSD, surchargeCents: 0, envPrefix: '', keyPrefix: '', borrow: BORROW_TEST,
  },
  'mezo-mainnet': {
    network: 'eip155:31612', chainId: 31612, label: 'Mezo mainnet', mainnet: true,
    rpcUrls: ['https://mezo-mainnet.boar.network', 'https://mainnet.mezo.public.validationcloud.io', 'https://rpc-http.mezo.boar.network'],
    explorer: 'https://explorer.mezo.org', asset: MUSD_MAIN, borrow: BORROW_MAIN,
    // BTC gas on Mezo mainnet was 1,462,500 wei on Nov 2 2026: about 1.5 cents for a permit + transferFrom pair.
    surchargeCents: 2, envPrefix: 'MEZO_MAINNET_', keyPrefix: '31612:',
  },
  base: {
    network: 'eip155:8453', chainId: 8453, label: 'Base', mainnet: true,
    rpcUrls: ['https://mainnet.base.org', 'https://base.drpc.org'], explorer: 'https://basescan.org', asset: MUSD_MAIN,
    surchargeCents: 0, envPrefix: 'BASE_', keyPrefix: '8453:',
  },
};

export function loadConfig(env = process.env) {
  const need = (k) => {
    if (!env[k]) throw new Error(`${k} is required`);
    return env[k];
  };
  const hex = (k) => {
    const v = need(k);
    if (!/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${k} must be a 32-byte 0x hex key`);
    return v;
  };
  const keys = (env.NETWORKS || 'mezo-testnet').split(',').map((s) => s.trim()).filter(Boolean);
  const networks = keys.map((k) => {
    const d = NETWORK_DEFS[k];
    if (!d) throw new Error(`unknown network ${k}; known: ${Object.keys(NETWORK_DEFS).join(', ')}`);
    const p = d.envPrefix;
    const rpc = env[`${p || 'MEZO_'}RPC_URL${p ? 'S' : ''}`];
    return {
      key: k, ...d,
      rpcUrls: rpc ? rpc.split(',').map((s) => s.trim()) : d.rpcUrls,
      asset: k === 'mezo-testnet' && env.MUSD_ADDRESS ? { ...d.asset, address: env.MUSD_ADDRESS } : d.asset,
      treasury: need(`${p}TREASURY_ADDRESS`),
      settlerKey: hex(`${p}SETTLER_PRIVATE_KEY`),
      confirmations: Number(env[`${p}CONFIRMATIONS`] || env.CONFIRMATIONS || 1),
    };
  });
  const first = networks[0];
  return {
    port: Number(env.PORT || 3034),
    host: env.HOST || '127.0.0.1',
    publicUrl: (env.PUBLIC_URL || 'https://mezo.ochinimus.app').replace(/\/$/, ''),
    networks,
    // top-level aliases of the first network keep the Wave 1 call sites and tests working
    chainId: first.chainId, network: first.network, rpcUrl: first.rpcUrls[0], explorer: first.explorer,
    musd: first.asset, treasury: first.treasury, settlerKey: first.settlerKey,
    challengeSecret: need('CHALLENGE_SECRET'),
    upstreamUrl: (env.UPSTREAM_URL || 'https://x402.ochinimus.app').replace(/\/$/, ''),
    upstreamKey: need('UPSTREAM_KEY'),
    upstreamTimeoutMs: Number(env.UPSTREAM_TIMEOUT_MS || 15000),
    dbPath: env.DB_PATH || './agentfeed-mezo.db',
    challengeTtlSec: Number(env.CHALLENGE_TTL_SEC || 300),
    confirmations: first.confirmations,
    dailyUpstreamCap: Number(env.DAILY_UPSTREAM_CAP || 5000),
    // wallets we run ourselves: their calls are counted apart from outside payers in /stats
    ownWallets: (env.OWN_WALLETS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  };
}

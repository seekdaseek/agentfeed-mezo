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
  return {
    port: Number(env.PORT || 3034),
    host: env.HOST || '127.0.0.1',
    publicUrl: (env.PUBLIC_URL || 'https://mezo.ochinimus.app').replace(/\/$/, ''),
    chainId: MEZO_TESTNET.chainId,
    network: MEZO_TESTNET.network,
    rpcUrl: env.MEZO_RPC_URL || MEZO_TESTNET.rpcUrl,
    explorer: MEZO_TESTNET.explorer,
    musd: { ...MUSD, address: env.MUSD_ADDRESS || MUSD.address },
    treasury: need('TREASURY_ADDRESS'),
    settlerKey: hex('SETTLER_PRIVATE_KEY'),
    challengeSecret: need('CHALLENGE_SECRET'),
    upstreamUrl: (env.UPSTREAM_URL || 'https://x402.ochinimus.app').replace(/\/$/, ''),
    upstreamKey: need('UPSTREAM_KEY'),
    upstreamTimeoutMs: Number(env.UPSTREAM_TIMEOUT_MS || 15000),
    dbPath: env.DB_PATH || './agentfeed-mezo.db',
    challengeTtlSec: Number(env.CHALLENGE_TTL_SEC || 300),
    confirmations: Number(env.CONFIRMATIONS || 1),
    dailyUpstreamCap: Number(env.DAILY_UPSTREAM_CAP || 5000),
  };
}

// Agent client: pays AgentFeed-on-Mezo routes in MUSD. Library + CLI.
import { createPublicClient, createWalletClient, http, parseAbi, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { pathToFileURL } from 'node:url';
import { MEZO_TESTNET, MUSD } from './config.js';
import { mezoChain } from './chain.js';
import { PERMIT_TYPES, claimMessage } from './payments.js';

const abi = parseAbi(['function nonces(address) view returns (uint256)', 'function balanceOf(address) view returns (uint256)', 'function transfer(address to, uint256 amount) returns (bool)']);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
const unb64 = (s) => JSON.parse(Buffer.from(s, 'base64').toString('utf8'));

export function createAgent({
  privateKey, baseUrl = 'https://mezo.ochinimus.app', rpcUrl = MEZO_TESTNET.rpcUrl, fetchImpl = fetch,
  maxPriceMusd = 0.1, token = MUSD.address, network = MEZO_TESTNET.network, explorer = MEZO_TESTNET.explorer,
}) {
  const account = privateKeyToAccount(privateKey);
  const chainId = Number(network.split(':')[1]);
  const chain = mezoChain(chainId, rpcUrl);
  const pub = createPublicClient({ chain, transport: http(rpcUrl) });
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  baseUrl = baseUrl.replace(/\/$/, "");

  const urlFor = (route, params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)]));
    return `${baseUrl}/api/${route}${q.size ? `?${q}` : ''}`;
  };

  async function readChallenge(res) {
    const h = res.headers.get('payment-required');
    if (h) return unb64(h);
    return res.json();
  }

  // Never sign what the 402 says without checking it against what this agent expects.
  function guard(accept) {
    if (accept.network !== network) throw new Error(`refusing: challenge is for ${accept.network}, expected ${network}`);
    if (getAddress(accept.asset) !== getAddress(token)) throw new Error(`refusing: challenge asks for token ${accept.asset}, expected MUSD ${token}`);
    const musd = Number(BigInt(accept.amount) / 10n ** 12n) / 1e6;
    if (musd > maxPriceMusd) throw new Error(`refusing: price ${musd} MUSD is above the cap of ${maxPriceMusd}`);
  }

  async function call(route, params = {}, { scheme = 'permit' } = {}) {
    const url = urlFor(route, params);
    const t0 = Date.now();
    const first = await fetchImpl(url);
    if (first.status !== 402) {
      const body = await first.json().catch(() => ({}));
      return { ok: first.ok, status: first.status, body, ms: Date.now() - t0, paid: null };
    }
    const challenge = await readChallenge(first);
    const accept = challenge.accepts.find((a) => a.scheme === scheme);
    if (!accept) throw new Error(`gateway offers no "${scheme}" scheme`);
    guard(accept);
    const owner = account.address;
    let payment;
    if (scheme === 'permit') {
      const nonce = await pub.readContract({ address: token, abi, functionName: 'nonces', args: [owner] });
      const deadline = BigInt(accept.extra.expiresAt);
      const signature = await account.signTypedData({
        domain: { name: accept.extra.name, version: accept.extra.version, chainId, verifyingContract: getAddress(accept.asset) },
        types: PERMIT_TYPES, primaryType: 'Permit',
        message: { owner, spender: accept.extra.spender, value: BigInt(accept.amount), nonce, deadline },
      });
      payment = { x402Version: 2, scheme, network: accept.network, asset: accept.asset, payTo: accept.payTo, amount: accept.amount, nonce: accept.extra.nonce,
        payload: { owner, spender: accept.extra.spender, value: accept.amount, deadline: String(deadline), signature } };
    } else {
      const hash = await wallet.writeContract({ address: token, abi, functionName: 'transfer', args: [accept.payTo, BigInt(accept.amount)] });
      await pub.waitForTransactionReceipt({ hash, confirmations: accept.extra.confirmations || 1 });
      const signature = await account.signMessage({ message: claimMessage(accept.extra.nonce, hash) });
      payment = { x402Version: 2, scheme, network: accept.network, asset: accept.asset, payTo: accept.payTo, amount: accept.amount, nonce: accept.extra.nonce, payload: { txHash: hash, signature } };
    }
    const send = () => fetchImpl(url, { headers: { 'payment-signature': b64(payment) } });
    let second = await send();
    let body = await second.json().catch(() => ({}));
    // A transfer is already on-chain, so a refusal that only means "the gateway's RPC node has not seen it yet" is retried
    // with the same payment while the challenge is still valid (it is never retried for permit: that signature is single-use).
    for (let i = 0; i < 4 && scheme === 'transfer' && !second.ok && ['tx_not_found', 'not_enough_confirmations', 'chain_unavailable'].includes(body.error); i++) {
      await new Promise((r) => setTimeout(r, 2500));
      second = await send();
      body = await second.json().catch(() => ({}));
    }
    const receipt = second.headers.get('payment-response') ? unb64(second.headers.get('payment-response')) : null;
    return { ok: second.ok, status: second.status, body, receipt, ms: Date.now() - t0, paid: second.ok ? { tx: receipt?.transaction, url: `${explorer}/tx/${receipt?.transaction}` } : null };
  }

  return { address: account.address, call, urlFor, balance: () => pub.readContract({ address: token, abi, functionName: 'balanceOf', args: [account.address] }), nonce: () => pub.readContract({ address: token, abi, functionName: 'nonces', args: [account.address] }) };
}

// ---- CLI ----
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const flag = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
  const scheme = flag('--scheme', 'permit');
  const n = Number(flag('--n', '1'));
  const gap = Number(flag('--gap-ms', '0'));
  const pretty = args.includes('--pretty') ? (args.splice(args.indexOf('--pretty'), 1), true) : false;
  const [route, ...kv] = args;
  if (!route || !process.env.AGENT_PRIVATE_KEY) {
    console.error('usage: AGENT_PRIVATE_KEY=0x... [GATEWAY_URL=...] node src/client.js <route> [k=v ...] [--scheme permit|transfer] [--n N]');
    process.exit(2);
  }
  const params = Object.fromEntries(kv.map((x) => x.split(/=(.*)/s).slice(0, 2)));
  const agent = createAgent({ privateKey: process.env.AGENT_PRIVATE_KEY, baseUrl: process.env.GATEWAY_URL || undefined, maxPriceMusd: Number(process.env.MAX_PRICE_MUSD || 0.1) });
  let okCount = 0;
  for (let i = 0; i < n; i++) {
    try {
      const r = await agent.call(route, params, { scheme });
      if (r.ok) okCount++;
      const preview = JSON.stringify(r.body.data ?? r.body).slice(0, 160);
      if (pretty) {
        console.log(`${r.ok ? 'paid' : 'refused'}  status ${r.status}  ${(r.ms / 1000).toFixed(1)} s  ${scheme}  ${r.body.paid ? `${r.body.paid.amount_musd} MUSD` : r.body.error}`);
        if (r.paid) console.log(`tx    ${r.paid.tx}\nlink  ${r.paid.url}`);
        console.log(`data  ${preview}`);
      } else console.log(JSON.stringify({ i: i + 1, route, scheme, status: r.status, ms: r.ms, tx: r.paid?.tx, explorer: r.paid?.url, error: r.ok ? undefined : r.body.error, preview }));
    } catch (e) { console.log(JSON.stringify({ i: i + 1, route, scheme, error: e.message })); }
    if (gap) await new Promise((r) => setTimeout(r, gap));
  }
  console.log(`# ${okCount}/${n} paid calls succeeded`);
}

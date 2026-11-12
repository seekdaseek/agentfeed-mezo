// Nov 12 2026: does EIP-2612 permit() really work on the Mezo BTC token (0x7b7C...0000) and MEZO (0x7B7c...0001) on mainnet?
// The mainnet agent signs a Permit for 1 wei with the settler as spender (the agent needs no tokens and no gas for a signature);
// the mainnet settler submits permit() (costs a little BTC), then the allowance and nonce are read back.
//   node scripts/permit-probe-mainnet.mjs          dry run: domain check + signature + simulation
//   node scripts/permit-probe-mainnet.mjs --send
import { createPublicClient, createWalletClient, http, fallback, parseAbi, parseSignature, formatEther, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import fs from 'node:fs';

const send = process.argv.includes('--send');
const wm = JSON.parse(fs.readFileSync(new URL('../.secrets/wallets-mainnet.json', import.meta.url), 'utf8'));
const agent = privateKeyToAccount(wm['mezo-mainnet-agent'].key), settler = privateKeyToAccount(wm['mezo-mainnet-settler'].key);
if (agent.address !== wm['mezo-mainnet-agent'].address || settler.address !== wm['mezo-mainnet-settler'].address) throw new Error('key/address mismatch');
const mezo = defineChain({ id: 31612, name: 'Mezo', nativeCurrency: { name: 'BTC', symbol: 'BTC', decimals: 18 }, rpcUrls: { default: { http: ['https://mezo-mainnet.boar.network'] } } });
const transport = fallback([http('https://mezo-mainnet.boar.network', { retryCount: 1 }), http('https://mainnet.mezo.public.validationcloud.io', { retryCount: 1 }), http('https://rpc-http.mezo.boar.network', { retryCount: 1 })], { rank: false });
const pub = createPublicClient({ chain: mezo, transport });
const wallet = createWalletClient({ account: settler, chain: mezo, transport });
const abi = parseAbi(['function nonces(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)']);
const types = { Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] };
for (const [name, address] of [['BTC', '0x7b7C000000000000000000000000000000000000'], ['MEZO', '0x7B7c000000000000000000000000000000000001']]) {
  const nonce = await pub.readContract({ address, abi, functionName: 'nonces', args: [agent.address] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const sig = await agent.signTypedData({ domain: { name, version: '1', chainId: 31612, verifyingContract: address }, types, primaryType: 'Permit', message: { owner: agent.address, spender: settler.address, value: 1n, nonce, deadline } });
  const { v, r, s } = parseSignature(sig);
  const args = [agent.address, settler.address, 1n, deadline, Number(v ?? (sig.endsWith('1c') ? 28 : 27)), r, s];
  let est; try { est = await pub.estimateContractGas({ account: settler, address, abi, functionName: 'permit', args }); } catch (e) { console.log(name, 'permit simulation REVERTED:', String(e.shortMessage ?? e).split('\n')[0]); continue; }
  console.log(name, 'simulation ok, est gas', String(est), 'nonce before', String(nonce));
  if (!send) continue;
  const h = await wallet.writeContract({ address, abi, functionName: 'permit', args, gas: (est * 13n) / 10n });
  const rc = await pub.waitForTransactionReceipt({ hash: h });
  let al = 0n, n2 = nonce; for (let i = 0; i < 15 && al === 0n; i++) { al = await pub.readContract({ address, abi, functionName: 'allowance', args: [agent.address, settler.address] }); n2 = await pub.readContract({ address, abi, functionName: 'nonces', args: [agent.address] }); if (al === 0n) await new Promise((res) => setTimeout(res, 1500)); }
  console.log(name, 'permit', rc.status, `https://explorer.mezo.org/tx/${h}`, 'gasUsed', String(rc.gasUsed), 'BTC paid', formatEther(rc.gasUsed * rc.effectiveGasPrice), 'allowance(agent,settler)', String(al), 'nonce after', String(n2));
}

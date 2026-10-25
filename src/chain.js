// The only module that talks to the Mezo RPC. server.js depends on this interface, so tests inject a fake.
import { createPublicClient, createWalletClient, http, defineChain, parseAbi, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const MUSD_ABI = parseAbi([
  'function nonces(address owner) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);

export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export const mezoChain = (id, rpcUrl) =>
  defineChain({
    id,
    name: 'Mezo Testnet',
    nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });

export function makeChain(cfg) {
  const chain = mezoChain(cfg.chainId, cfg.rpcUrl);
  const pub = createPublicClient({ chain, transport: http(cfg.rpcUrl, { retryCount: 2 }) });
  const settler = privateKeyToAccount(cfg.settlerKey);
  const wallet = createWalletClient({ account: settler, chain, transport: http(cfg.rpcUrl) });
  const token = getAddress(cfg.musd.address);
  let sendQueue = Promise.resolve(); // serialises nonce assignment; receipts are awaited outside the queue

  return {
    settlerAddress: settler.address,
    permitNonce: (owner) => pub.readContract({ address: token, abi: MUSD_ABI, functionName: 'nonces', args: [owner] }),
    balanceOf: (owner) => pub.readContract({ address: token, abi: MUSD_ABI, functionName: 'balanceOf', args: [owner] }),

    // eth_call of permit() from the settler: ground truth that the signature, nonce and deadline are valid on-chain now.
    async simulatePermit(p) {
      await pub.simulateContract({
        address: token, abi: MUSD_ABI, functionName: 'permit',
        args: [p.owner, p.spender, p.value, p.deadline, p.v, p.r, p.s], account: settler.address,
      });
    },

    // permit() then transferFrom() back to back from the settler key; the agent pays no gas.
    async settlePermit(p) {
      const gasPrice = ((await pub.getGasPrice()) * 3n) / 2n + 1n;
      const sent = await new Promise((resolve, reject) => {
        sendQueue = sendQueue.then(async () => {
          try {
            const nonce = await pub.getTransactionCount({ address: settler.address, blockTag: 'pending' });
            const permitTx = await wallet.writeContract({
              address: token, abi: MUSD_ABI, functionName: 'permit',
              args: [p.owner, p.spender, p.value, p.deadline, p.v, p.r, p.s], nonce, gas: 150000n, gasPrice,
            });
            const transferTx = await wallet.writeContract({
              address: token, abi: MUSD_ABI, functionName: 'transferFrom',
              args: [p.owner, p.to, p.amount], nonce: nonce + 1, gas: 150000n, gasPrice,
            });
            resolve({ permitTx, transferTx });
          } catch (e) { reject(e); }
        });
      });
      const [a, b] = await Promise.all([
        pub.waitForTransactionReceipt({ hash: sent.permitTx, timeout: 60000 }),
        pub.waitForTransactionReceipt({ hash: sent.transferTx, timeout: 60000 }),
      ]);
      if (a.status !== 'success') throw new Error(`permit tx reverted: ${sent.permitTx}`);
      if (b.status !== 'success') throw new Error(`transferFrom tx reverted: ${sent.transferTx}`);
      return sent;
    },

    // Normalised receipt for the plain-transfer scheme.
    async transferReceipt(hash) {
      // The public RPC is several nodes that index at different speeds: give a fresh receipt a few seconds to appear.
      let r = null;
      for (let i = 0; i < 8 && !r; i++) {
        try { r = await pub.getTransactionReceipt({ hash }); } catch { if (i < 7) await new Promise((res) => setTimeout(res, 1000)); }
      }
      if (!r) return null;
      const [block, head] = await Promise.all([pub.getBlock({ blockNumber: r.blockNumber }), pub.getBlockNumber()]);
      return {
        status: r.status,
        from: r.from,
        confirmations: Number(head - r.blockNumber) + 1,
        timestamp: Number(block.timestamp),
        logs: r.logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data })),
      };
    },
  };
}

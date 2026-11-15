// ERC-8021 Base Builder Code (bc_g6qgnam4): every Base mainnet transaction this code sends itself carries the suffix, and no other chain's does.
// Real signing, a stub JSON-RPC node on 127.0.0.1 that records every eth_sendRawTransaction; nothing here touches a network or spends anything.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { parseTransaction, decodeFunctionData, parseAbi, keccak256, concat, toHex } from 'viem';
import { Attribution } from 'ox/erc8021';
import { BASE_BUILDER_CODE, BASE_DATA_SUFFIX, dataSuffixFor, appendSuffix, codesOf } from '../src/builder-code.js';
import { makeChain } from '../src/chain.js';
import { createAgent } from '../src/client.js';
import { NETWORK_DEFS } from '../src/config.js';

const ABI = parseAbi([
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);
const MARKER = '80218021802180218021802180218021';

/** a stub node: answers the few reads viem makes, records the raw transactions it is sent */
function stubNode(chainId) {
  const raw = [];
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const one = (q) => {
        const r = (result) => ({ jsonrpc: '2.0', id: q.id, result });
        switch (q.method) {
          case 'eth_chainId': return r(toHex(chainId));
          case 'eth_getTransactionCount': return r('0x7');
          case 'eth_gasPrice': return r('0x3b9aca00');
          case 'eth_maxPriorityFeePerGas': return r('0x3b9aca00');
          case 'eth_estimateGas': return r('0x30d40');
          case 'eth_blockNumber': return r('0x10');
          case 'eth_getBlockByNumber': return r({ number: '0x10', hash: '0x' + '11'.repeat(32), baseFeePerGas: '0x3b9aca00', timestamp: '0x1', transactions: [], gasLimit: '0x1c9c380', gasUsed: '0x0', parentHash: '0x' + '00'.repeat(32) });
          case 'eth_sendRawTransaction': { raw.push(q.params[0]); return r(keccak256(q.params[0])); }
          case 'eth_getTransactionReceipt': return r({ transactionHash: q.params[0], blockNumber: '0x10', blockHash: '0x' + '11'.repeat(32), transactionIndex: '0x0', status: '0x1', gasUsed: '0x5208', cumulativeGasUsed: '0x5208', effectiveGasPrice: '0x3b9aca00', logs: [], logsBloom: '0x' + '00'.repeat(256), from: '0x' + '00'.repeat(20), to: null, type: '0x2', contractAddress: null });
          default: return { jsonrpc: '2.0', id: q.id, error: { code: -32601, message: `stub: ${q.method}` } };
        }
      };
      const j = JSON.parse(b);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(Array.isArray(j) ? j.map(one) : one(j)));
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${srv.address().port}`, raw, close: () => srv.close() })));
}

describe('the suffix itself', () => {
  test('it is the ERC-8021 encoding of bc_g6qgnam4: the code in ASCII, its length, schema 0, then eight times 8021', () => {
    assert.equal(BASE_BUILDER_CODE, 'bc_g6qgnam4');
    assert.ok(BASE_DATA_SUFFIX.endsWith(MARKER), BASE_DATA_SUFFIX);
    assert.equal(BASE_DATA_SUFFIX, '0x62635f673671676e616d34' + '0b' + '00' + MARKER);
    assert.equal(Buffer.from(BASE_DATA_SUFFIX.slice(2, 24), 'hex').toString('ascii'), 'bc_g6qgnam4');
  });
  test('it decodes back to bc_g6qgnam4, alone and at the end of real calldata', () => {
    assert.deepEqual(Attribution.fromData(BASE_DATA_SUFFIX), { codes: ['bc_g6qgnam4'], id: 0 });
    const data = appendSuffix('0xa9059cbb' + '00'.repeat(64), 8453);
    assert.ok(data.endsWith(MARKER));
    assert.deepEqual(codesOf(data), ['bc_g6qgnam4']);
  });
  test('only Base mainnet gets it: Mezo testnet, Mezo mainnet and anything else get none, and plain calldata is left as it was', () => {
    assert.equal(dataSuffixFor(8453), BASE_DATA_SUFFIX);
    for (const id of [31611, 31612, 1, 10, 137, undefined]) assert.equal(dataSuffixFor(id), undefined, String(id));
    assert.equal(appendSuffix('0xa9059cbb', 31612), '0xa9059cbb');
    assert.equal(appendSuffix(undefined, 31611), '0x');
    assert.equal(appendSuffix(undefined, 8453), BASE_DATA_SUFFIX, 'a plain value transfer has no calldata: the suffix alone');
    assert.equal(codesOf('0xa9059cbb'), null, 'calldata with no suffix has no code');
  });
});

describe('the settler (src/chain.js): permit() and transferFrom() on the wire', () => {
  let node;
  before(async () => { node = await stubNode(8453); });
  after(() => node.close());
  const owner = privateKeyToAccount(generatePrivateKey()).address;
  const to = privateKeyToAccount(generatePrivateKey()).address;
  const permit = { owner, spender: privateKeyToAccount(generatePrivateKey()).address, value: 10n ** 16n, deadline: 2n ** 40n, v: 27, r: '0x' + '11'.repeat(32), s: '0x' + '22'.repeat(32), to, amount: 10n ** 16n };

  for (const [chainId, label, suffixed] of [[8453, 'Base mainnet', true], [31612, 'Mezo mainnet', false], [31611, 'Mezo testnet', false]]) {
    test(`${label} (${chainId}): both settler transactions ${suffixed ? 'end in 8021 x8 and decode to bc_g6qgnam4' : 'carry no suffix'}, and still call the right function with the right arguments`, async () => {
      const n = await stubNode(chainId);
      try {
        const settlerKey = generatePrivateKey();
        const chain = makeChain({ chainId, label, rpcUrls: [n.url], settlerKey, asset: { address: '0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186' } });
        const sent = await chain.settlePermit(permit);
        assert.equal(n.raw.length, 2, 'permit and transferFrom');
        const [t1, t2] = n.raw.map((r) => parseTransaction(r));
        assert.equal(t1.chainId, chainId);
        for (const t of [t1, t2]) {
          assert.equal(t.data.endsWith(MARKER), suffixed, `${label} ends with the ERC-8021 marker: ${suffixed}`);
          assert.deepEqual(codesOf(t.data), suffixed ? ['bc_g6qgnam4'] : null);
        }
        // the call itself is unchanged: the callee's ABI decoding reads the same function and arguments with the suffix on the end
        const d1 = decodeFunctionData({ abi: ABI, data: t1.data });
        const d2 = decodeFunctionData({ abi: ABI, data: t2.data });
        assert.equal(d1.functionName, 'permit'); assert.equal(d1.args[0], owner); assert.equal(d1.args[2], 10n ** 16n);
        assert.equal(d2.functionName, 'transferFrom'); assert.deepEqual(d2.args, [owner, to, 10n ** 16n]);
        assert.ok(sent.permitTx && sent.transferTx);
        if (suffixed) assert.equal(t1.data.length, 2 + 2 * (4 + 7 * 32) + (BASE_DATA_SUFFIX.length - 2), 'the permit calldata is the 4 + 7 words it always was, plus the suffix');
        else assert.equal(t1.data.length, 2 + 2 * (4 + 7 * 32));
      } finally { n.close(); }
    });
  }
});

describe('the agent client (src/client.js), transfer scheme: the agent sends its own MUSD transfer', () => {
  for (const [key, suffixed] of [['base', true], ['mezo-mainnet', false], ['mezo-testnet', false]]) {
    test(`${key}: the transfer ${suffixed ? 'carries the suffix' : 'carries none'}`, async () => {
      const def = NETWORK_DEFS[key];
      const chainId = Number(def.network.split(':')[1]);
      const n = await stubNode(chainId);
      try {
        const payTo = privateKeyToAccount(generatePrivateKey()).address;
        let calls = 0;
        const fetchImpl = async (url, init) => {
          calls++;
          if (calls === 1) {
            const challenge = { x402Version: 2, accepts: [{ scheme: 'transfer', network: def.network, asset: def.asset.address, amount: '10000000000000000', payTo, extra: { nonce: 'n1', confirmations: 1 } }] };
            return { status: 402, ok: false, headers: new Headers({ 'payment-required': Buffer.from(JSON.stringify(challenge)).toString('base64') }), json: async () => challenge };
          }
          return { status: 200, ok: true, headers: new Headers(), json: async () => ({ paid: { amount_musd: 0.01 } }) };
        };
        const agent = createAgent({ privateKey: generatePrivateKey(), baseUrl: 'http://gw.test', networkKey: key, rpcUrl: n.url, fetchImpl });
        const r = await agent.call('sol-price', {}, { scheme: 'transfer' });
        assert.equal(r.status, 200);
        assert.equal(n.raw.length, 1);
        const t = parseTransaction(n.raw[0]);
        assert.equal(t.data.endsWith(MARKER), suffixed);
        assert.deepEqual(codesOf(t.data), suffixed ? ['bc_g6qgnam4'] : null);
        const d = decodeFunctionData({ abi: ABI, data: t.data });
        assert.equal(d.functionName, 'transfer'); assert.equal(d.args[0], payTo); assert.equal(d.args[1], 10n ** 16n);
      } finally { n.close(); }
    });
  }
});

test('control: the stub records what it is sent, so a missing suffix would show (a plain concat of calldata and suffix is what the decoder reads)', () => {
  const data = concat(['0xa9059cbb', '0x' + '00'.repeat(64), BASE_DATA_SUFFIX]);
  assert.deepEqual(codesOf(data), ['bc_g6qgnam4']);
  assert.equal(codesOf(concat(['0xa9059cbb', '0x' + '00'.repeat(64)])), null);
});

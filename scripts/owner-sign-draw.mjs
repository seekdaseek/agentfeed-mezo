// The trove owner signs the WithdrawMUSD message that funds an agent's budget. No transaction, no gas, no key sent anywhere.
//   OWNER_PRIVATE_KEY=0x... node scripts/owner-sign-draw.mjs <agent name> <mezo-testnet|mezo-mainnet> <amount in wei> <agent wallet>
// Prints the /draw line to send to the Telegram bot. Same typed data as the bot's /drawmsg.
import { createPublicClient, http, parseAbi, getAddress, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { NETWORK_DEFS } from '../src/config.js';
import { drawTypedData } from '../src/trove.js';

const [name, netKey, amountWei, recipient] = process.argv.slice(2);
const net = NETWORK_DEFS[netKey];
if (!process.env.OWNER_PRIVATE_KEY || !net?.borrow || !/^\d+$/.test(amountWei || '') || !recipient) {
  console.error('usage: OWNER_PRIVATE_KEY=0x... node scripts/owner-sign-draw.mjs <agent name> <mezo-testnet|mezo-mainnet> <amount in wei> <agent wallet>');
  process.exit(2);
}
const owner = privateKeyToAccount(process.env.OWNER_PRIVATE_KEY);
const pub = createPublicClient({ transport: http(net.rpcUrls[0]) });
const abi = parseAbi(['function getNonce(address) view returns (uint256)', 'function eip712Domain() view returns (bytes1, string, string, uint256, address, bytes32, uint256[])']);
const [nonce, d] = await Promise.all([pub.readContract({ address: net.borrow.signatures, abi, functionName: 'getNonce', args: [owner.address] }), pub.readContract({ address: net.borrow.signatures, abi, functionName: 'eip712Domain' })]);
const deadline = Math.floor(Date.now() / 1000) + 3600;
const td = drawTypedData({ domain: { name: d[1], version: d[2], chainId: Number(d[3]), verifyingContract: d[4] }, amount: BigInt(amountWei), borrower: owner.address, recipient: getAddress(recipient), nonce, deadline: BigInt(deadline) });
const signature = await owner.signTypedData(td);
console.log(`/draw ${name} ${formatUnits(BigInt(amountWei), 18)} ${owner.address} ${deadline} ${signature} ${netKey}`);

// Get testnet MUSD the way anyone does: open a trove on Mezo testnet (BTC collateral in, MUSD out).
//   AGENT_PRIVATE_KEY=0x... node scripts/fund-musd.mjs            # dry run: prints what it would do
//   AGENT_PRIVATE_KEY=0x... node scripts/fund-musd.mjs --send     # opens the trove
// Addresses: github.com/mezo-org/musd solidity/artifacts/deployments/matsnet
import { createPublicClient, createWalletClient, http, parseAbi, formatEther, parseEther, zeroAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mezoChain } from '../src/chain.js';
import { MEZO_TESTNET, MUSD } from '../src/config.js';

const A = {
  borrowerOperations: '0xCdF7028ceAB81fA0C6971208e83fa7872994beE5',
  priceFeed: '0x86bCF0841622a5dAC14A313a15f96A95421b9366',
  hintHelpers: '0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6',
  sortedTroves: '0x722E4D24FD6Ff8b0AC679450F3D91294607268fA',
  troveManager: '0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0',
};
const abi = parseAbi([
  'function openTrove(uint256 _debtAmount, address _upperHint, address _lowerHint) payable',
  'function minNetDebt() view returns (uint256)',
  'function getBorrowingFee(uint256 _debt) view returns (uint256)',
  'function MUSD_GAS_COMPENSATION() view returns (uint256)',
  'function fetchPrice() view returns (uint256)',
  'function MCR() view returns (uint256)',
  'function CCR() view returns (uint256)',
  'function getTCR(uint256 _price) view returns (uint256)',
  'function getApproxHint(uint256 _CR, uint256 _numTrials, uint256 _inputRandomSeed) view returns (address, uint256, uint256)',
  'function findInsertPosition(uint256 _NICR, address _prevId, address _nextId) view returns (address, address)',
  'function balanceOf(address) view returns (uint256)',
]);
const key = process.env.AGENT_PRIVATE_KEY;
if (!key) { console.error('AGENT_PRIVATE_KEY is required'); process.exit(2); }
const send = process.argv.includes('--send');
const extra = BigInt(process.env.EXTRA_MUSD || '50'); // borrow minNetDebt + this many MUSD
const targetIcr = BigInt(process.env.TARGET_ICR_PCT || '200');

const chain = mezoChain(MEZO_TESTNET.chainId, MEZO_TESTNET.rpcUrl);
const pub = createPublicClient({ chain, transport: http() });
const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain, transport: http() });
const rd = (address, functionName, args = []) => pub.readContract({ address, abi, functionName, args });

const [minNet, gasComp, price, mcr, ccr] = await Promise.all([
  rd(A.borrowerOperations, 'minNetDebt'), rd(A.borrowerOperations, 'MUSD_GAS_COMPENSATION'),
  rd(A.priceFeed, 'fetchPrice'), rd(A.troveManager, 'MCR'), rd(A.troveManager, 'CCR'),
]);
const tcr = await rd(A.troveManager, 'getTCR', [price]);
const debtAmount = minNet + extra * 10n ** 18n;
const fee = await rd(A.borrowerOperations, 'getBorrowingFee', [debtAmount]);
const totalDebt = debtAmount + fee + gasComp;
const icr = tcr < ccr && targetIcr * 10n ** 16n < ccr ? ccr : targetIcr * 10n ** 16n; // recovery mode needs >= CCR
const coll = (totalDebt * icr) / price + 10n ** 14n; // price is 1e18 USD per BTC
const bal = await pub.getBalance({ address: account.address });
console.log(JSON.stringify({
  agent: account.address, btcPriceUsd: formatEther(price), minNetDebtMusd: formatEther(minNet), borrowMusd: formatEther(debtAmount),
  feeMusd: formatEther(fee), gasCompMusd: formatEther(gasComp), totalDebtMusd: formatEther(totalDebt), mcr: formatEther(mcr), ccr: formatEther(ccr), tcr: formatEther(tcr),
  collateralBtcNeeded: formatEther(coll), btcBalance: formatEther(bal), enough: bal > coll + parseEther('0.0005'),
}, null, 2));
if (!send) process.exit(0);
if (bal < coll + parseEther('0.0005')) { console.error('not enough testnet BTC for collateral plus gas'); process.exit(1); }

const nicr = (coll * 10n ** 20n) / totalDebt;
const [hint] = await rd(A.hintHelpers, 'getApproxHint', [nicr, 15n, 42n]);
const [upper, lower] = await rd(A.sortedTroves, 'findInsertPosition', [nicr, hint, hint]);
const hash = await wallet.writeContract({ address: A.borrowerOperations, abi, functionName: 'openTrove', args: [debtAmount, upper, lower], value: coll, gas: 3_500_000n });
const rc = await pub.waitForTransactionReceipt({ hash });
console.log('openTrove', rc.status, `${MEZO_TESTNET.explorer}/tx/${hash}`);
console.log('MUSD balance', formatEther(await rd(MUSD.address, 'balanceOf', [account.address])));

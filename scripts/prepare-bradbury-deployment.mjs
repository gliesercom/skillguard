// Bradbury Phase 2 (chainId = 4221) 只读部署请求预检器（绝不生成密钥、不签名、不发送交易）
// 生成带同区块 eth_estimateGas + eth_call 证明的部署请求包，供前端钱包或用户授权确认后提交。

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abi, createClient, createFeesDistribution, decodeInputData, normalizeTransactionFees } from 'genlayer-js';
import { testnetBradbury } from 'genlayer-js/chains';
import {
  createPublicClient,
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  http,
  parseAbi,
  zeroAddress,
} from 'viem';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BRADBURY = Object.freeze({
  rpcUrl: 'https://rpc-bradbury.genlayer.com',
  l2RpcUrl: 'https://rpc.testnet-chain.genlayer.com',
  chainId: 4221,
  genesisHash: '0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4',
  addressManager: '0x3F71AE080BD6270A91dBcc7960d88797828538E0',
  manifestUrl: 'https://docs.genlayer.com/validators/bradbury.protocol-manifest.json',
  explorerUrl: 'https://scan.bradbury.genlayer.com',
});

const REQUIRED_NAMES = Object.freeze([
  'ConsensusMain',
  'ConsensusData',
  'Staking',
  'FeeManager',
  'RoundsStorage',
  'Appeals',
  'ConsensusDataBigRounds',
  'TransactionManager',
]);

const ARB_GAS_INFO_ADDRESS = '0x000000000000000000000000000000000000006C';
const BOUNDED_GAS_LIMIT = 31800000n;
const MAX_TX_GAS_LIMIT = 32000000n;
const DEFAULT_ACTOR = '0x5d89aa5eaa6dc6734ded7ebe060f4b8682c504bd';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const quantity = (n) => '0x' + BigInt(n).toString(16);
const publicJson = (value) =>
  JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);

export async function connectVerifiedBradbury() {
  const manifestRes = await fetch(BRADBURY.manifestUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(manifestRes.ok, true, `Manifest HTTP ${manifestRes.status}`);
  const manifest = await manifestRes.json();
  assert.equal(String(manifest.chainId), '4221');
  assert.equal(String(manifest.registry).toLowerCase(), BRADBURY.addressManager.toLowerCase());

  const expected = {};
  for (const name of REQUIRED_NAMES) {
    const found = manifest.entries.filter((e) => e?.key === name);
    assert.equal(found.length, 1, `Missing manifest entry ${name}`);
    expected[name] = getAddress(found[0].addr);
  }

  const publicClient = createPublicClient({
    transport: http(BRADBURY.rpcUrl, { retryCount: 0, timeout: 25000 }),
  });
  const l2Client = createPublicClient({
    transport: http(BRADBURY.l2RpcUrl, { retryCount: 0, timeout: 25000 }),
  });

  const [chainId, genesis, headPrimary, headSecondary] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getBlock({ blockNumber: 0n }),
    publicClient.getBlockNumber(),
    l2Client.getBlockNumber(),
  ]);
  assert.equal(chainId, 4221);
  assert.equal(genesis.hash.toLowerCase(), BRADBURY.genesisHash);

  const commonBlock = headPrimary < headSecondary ? headPrimary : headSecondary;
  const head = await l2Client.getBlock({ blockNumber: commonBlock });
  assert.equal((await publicClient.getBlock({ blockNumber: head.number })).hash, head.hash);

  const regAbi = parseAbi(['function getAddress(string) view returns (address)']);
  const addresses = {};
  for (const name of REQUIRED_NAMES) {
    const resolved = getAddress(
      await publicClient.readContract({
        address: BRADBURY.addressManager,
        abi: regAbi,
        functionName: 'getAddress',
        args: [name],
        blockNumber: head.number,
      })
    );
    assert.equal(resolved.toLowerCase(), expected[name].toLowerCase());
    addresses[name] = resolved;
  }

  const chain = {
    ...testnetBradbury,
    id: BRADBURY.chainId,
    isStudio: false,
    rpcUrls: { default: { http: [BRADBURY.rpcUrl] } },
    consensusMainContract: { ...testnetBradbury.consensusMainContract, address: addresses.ConsensusMain },
    consensusDataContract: { ...testnetBradbury.consensusDataContract, address: addresses.ConsensusData },
    stakingContract: { ...testnetBradbury.stakingContract, address: addresses.Staking },
    feeManagerContract: { ...testnetBradbury.feeManagerContract, address: addresses.FeeManager },
    roundsStorageContract: { ...testnetBradbury.roundsStorageContract, address: addresses.RoundsStorage },
    appealsContract: { ...testnetBradbury.appealsContract, address: addresses.Appeals },
  };
  const client = createClient({ chain, endpoint: BRADBURY.rpcUrl });
  return { client, publicClient, l2Client, chain, addresses, head };
}

export async function prepareBradburyDeployment(actor = DEFAULT_ACTOR) {
  const actorAddr = actor.toLowerCase();
  const compactPath = resolve(ROOT, 'contracts/skill_guard_compact.py');
  const canonicalPath = resolve(ROOT, 'contracts/skill_guard.py');
  const compactBytes = await readFile(compactPath);
  const canonicalBytes = await readFile(canonicalPath);
  const source = new TextDecoder('utf-8', { fatal: true }).decode(compactBytes);
  const compactSha256 = sha256(compactBytes);
  const canonicalSha256 = sha256(canonicalBytes);

  const feeProfile = JSON.parse(await readFile(resolve(ROOT, 'src/fee-profile.json'), 'utf8'));
  const { client, publicClient, l2Client, chain, addresses, head } = await connectVerifiedBradbury();

  const arbGasAbi = parseAbi([
    'function getGasAccountingParams() view returns (uint256 speedLimitPerSecond, uint256 gasPoolMax, uint256 maxTxGasLimit)',
  ]);
  const gasParams = await l2Client.readContract({
    address: ARB_GAS_INFO_ADDRESS,
    abi: arbGasAbi,
    functionName: 'getGasAccountingParams',
    blockNumber: head.number,
  });
  const maxTxGasLimit = gasParams[2];
  assert.ok(BOUNDED_GAS_LIMIT < maxTxGasLimit && maxTxGasLimit <= MAX_TX_GAS_LIMIT);

  const schema = await client.getContractSchemaForCode(source);
  assert.deepEqual(schema.ctor.params, []);

  const feeAbi = parseAbi([
    'function GENPerTimeUnit() view returns (uint256)',
    'function storageUnitPrice() view returns (uint256)',
    'function quoteGasPrice() view returns (uint256)',
    'function useChainDerivedReceiptPrice() view returns (bool)',
    'function calculateRoundFees((uint256 leaderTimeunitsAllocation,uint256 validatorTimeunitsAllocation,uint256 appealRounds,uint256 executionBudgetPerRound,uint256 executionConsumed,uint256 totalMessageFees,uint256[] rotations,uint256 maxPriceGenPerTimeUnit,uint256 storageFeeMaxGasPrice,uint256 receiptFeeMaxGasPrice),uint256,uint256) view returns (uint256)',
  ]);
  const feeAddr = addresses.FeeManager;
  const [genPerTu, storagePrice, quotedGas, derived, gasPrice, latestNonce, pendingNonce, balance] =
    await Promise.all([
      publicClient.readContract({ address: feeAddr, abi: feeAbi, functionName: 'GENPerTimeUnit' }),
      publicClient.readContract({ address: feeAddr, abi: feeAbi, functionName: 'storageUnitPrice' }),
      publicClient.readContract({ address: feeAddr, abi: feeAbi, functionName: 'quoteGasPrice' }),
      publicClient.readContract({
        address: feeAddr,
        abi: feeAbi,
        functionName: 'useChainDerivedReceiptPrice',
      }),
      l2Client.getGasPrice(),
      l2Client.getTransactionCount({ address: actorAddr, blockNumber: head.number }),
      l2Client.getTransactionCount({ address: actorAddr, blockTag: 'pending' }),
      l2Client.getBalance({ address: actorAddr, blockNumber: head.number }),
    ]);

  assert.equal(latestNonce, pendingNonce, 'Actor has a pending transaction on Bradbury');
  const enabled = derived || genPerTu > 0n || storagePrice > 0n || quotedGas > 0n;
  const receiptGas = quotedGas > (enabled ? gasPrice : 0n) ? quotedGas : enabled ? gasPrice : 0n;
  const cap = (v) => (v === 0n ? 0n : (v * 12000n + 9999n) / 10000n);
  const distribution = createFeesDistribution({
    leaderTimeunitsAllocation: BigInt(feeProfile.leaderTimeunitsAllocation),
    validatorTimeunitsAllocation: BigInt(feeProfile.validatorTimeunitsAllocation),
    executionBudgetPerRound: BigInt(feeProfile.executionBudgetPerRound),
    appealRounds: BigInt(feeProfile.appealRounds),
    rotations: [BigInt(chain.defaultConsensusMaxRotations)],
    maxPriceGenPerTimeUnit: cap(genPerTu),
    storageFeeMaxGasPrice: cap(storagePrice),
    receiptFeeMaxGasPrice: cap(receiptGas),
  });
  const roundFees = await publicClient.readContract({
    address: feeAddr,
    abi: feeAbi,
    functionName: 'calculateRoundFees',
    args: [distribution, BigInt(chain.defaultNumberOfInitialValidators), 0n],
  });
  const feeValue = roundFees + distribution.totalMessageFees;
  const normalizedFees = normalizeTransactionFees({ distribution, feeValue });

  const ctor = abi.calldata.makeCalldataObject(undefined, []);
  const appData = abi.transactions.serialize([source, abi.calldata.encode(ctor), false]);
  const decoded = decodeInputData(appData, zeroAddress);
  assert.equal(decoded?.type, 'deploy');
  assert.equal(decoded.code, source);

  const validUntil = String(head.timestamp + 3600n);
  const params = {
    sender: actorAddr,
    recipient: zeroAddress,
    numOfInitialValidators: 5n,
    maxRotations: 3n,
    validUntil: BigInt(validUntil),
    saltNonce: 0n,
    userValue: 0n,
    feesDistribution: normalizedFees.distribution,
    txCalldata: appData,
    messageAllocations: [],
  };
  const data = encodeFunctionData({
    abi: chain.consensusMainContract.abi,
    functionName: 'addTransaction',
    args: [params],
  }).toLowerCase();
  const roundtrip = decodeFunctionData({ abi: chain.consensusMainContract.abi, data });
  assert.equal(roundtrip.functionName, 'addTransaction');

  const callObj = {
    from: actorAddr,
    to: addresses.ConsensusMain.toLowerCase(),
    data,
    value: quantity(feeValue),
    gas: quantity(BOUNDED_GAS_LIMIT),
    gasPrice: quantity(gasPrice),
  };

  // 同区块 eth_estimateGas 与 eth_call 验证
  const [estRes, callRes] = await Promise.all([
    fetch(BRADBURY.l2RpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_estimateGas',
        params: [callObj, quantity(head.number)],
      }),
      signal: AbortSignal.timeout(30000),
    }),
    fetch(BRADBURY.l2RpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'eth_call',
        params: [callObj, quantity(head.number)],
      }),
      signal: AbortSignal.timeout(30000),
    }),
  ]);
  const estBody = await estRes.json();
  const callBody = await callRes.json();
  assert.ok(estRes.ok && !estBody.error && /^0x[0-9a-fA-F]+$/.test(estBody.result || ''), 'eth_estimateGas failed');
  assert.ok(callRes.ok && !callBody.error && /^0x[0-9a-fA-F]{64}$/.test(callBody.result || ''), 'eth_call failed');

  const estimatedGas = BigInt(estBody.result);
  const maxTotalCostWei = feeValue + BOUNDED_GAS_LIMIT * gasPrice;
  assert.ok(balance >= maxTotalCostWei, 'Actor balance insufficient for deployment');

  const bundle = {
    format: 'skillguard/bradbury-deployment-review/1',
    verified: true,
    verifiedAt: new Date().toISOString(),
    actor: actorAddr,
    chainId: 4221,
    genesisHash: BRADBURY.genesisHash,
    addressManager: BRADBURY.addressManager,
    registryAddresses: addresses,
    canonicalSourceSha256: canonicalSha256,
    compactSourceSha256: compactSha256,
    compactSourceBytes: compactBytes.length,
    blockNumber: String(head.number),
    blockHash: head.hash,
    nonce: String(latestNonce),
    balanceWei: String(balance),
    estimatedGas: String(estimatedGas),
    selectedGasLimit: String(BOUNDED_GAS_LIMIT),
    maxTxGasLimit: String(maxTxGasLimit),
    gasPriceWei: String(gasPrice),
    protocolDepositWei: String(feeValue),
    maxTotalCostWei: String(maxTotalCostWei),
    validUntil,
    ethEstimateGasResult: estBody.result,
    ethCallResult: callBody.result,
    walletTransactionRequest: {
      from: actorAddr,
      to: addresses.ConsensusMain.toLowerCase(),
      data,
      value: quantity(feeValue),
      gas: quantity(BOUNDED_GAS_LIMIT),
      gasPrice: quantity(gasPrice),
      chainId: '0x107d',
      nonce: quantity(latestNonce),
      type: '0x0',
    },
  };

  const outFile = resolve(ROOT, 'public/bradbury-deploy-review.json');
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, publicJson(bundle) + '\n', 'utf8');

  const artifactFile = resolve(ROOT, 'artifacts/bradbury-deploy-review.json');
  await mkdir(dirname(artifactFile), { recursive: true });
  await writeFile(artifactFile, publicJson(bundle) + '\n', 'utf8');

  return {
    verified: true,
    actor: actorAddr,
    blockNumber: String(head.number),
    nonce: String(latestNonce),
    estimatedGas: String(estimatedGas),
    selectedGasLimit: String(BOUNDED_GAS_LIMIT),
    maxTotalCostWei: String(maxTotalCostWei),
    balanceWei: String(balance),
    compactSourceSha256: compactSha256,
    ethCallResult: callBody.result,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const actorArg = process.argv[2] || DEFAULT_ACTOR;
  prepareBradburyDeployment(actorArg)
    .then((res) => console.log(publicJson(res)))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}

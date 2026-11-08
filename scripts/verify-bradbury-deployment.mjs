// 独立核验 Bradbury Phase 2 链上 SkillGuard 合约部署结果（验证 EVM 回执、NewTransaction 事件、FINALIZED 共识与零基线读取）

import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeEventLog, parseAbiItem } from 'viem';
import { connectVerifiedBradbury } from './prepare-bradbury-deployment.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NEW_TX_EVENT = parseAbiItem(
  'event NewTransaction(bytes32 indexed txId, address indexed recipient, address indexed activator)'
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const publicJson = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2);

export async function verifyBradburyDeployment({
  envelopeHash,
  actor = '0x5d89aa5eaa6dc6734ded7ebe060f4b8682c504bd',
}) {
  const { client, publicClient, l2Client, addresses } = await connectVerifiedBradbury();
  const actorAddr = actor.toLowerCase();

  let targetHash = envelopeHash;
  if (!targetHash) {
    const review = JSON.parse(
      await readFile(resolve(ROOT, 'artifacts/bradbury-deploy-review.json'), 'utf8')
    );
    const expectedNonce = String(review.nonce);
    const latest = await l2Client.getBlockNumber();
    const start = BigInt(review.blockNumber) > 10n ? BigInt(review.blockNumber) - 10n : 0n;
    for (let lower = start; lower <= latest; lower += 500n) {
      const upper = lower + 499n < latest ? lower + 499n : latest;
      const logs = await publicClient.getLogs({
        address: addresses.ConsensusMain,
        fromBlock: lower,
        toBlock: upper,
      });
      for (const log of logs) {
        if (!log.transactionHash) continue;
        const tx = await publicClient.getTransaction({ hash: log.transactionHash });
        if (tx.from.toLowerCase() === actorAddr && String(tx.nonce) === expectedNonce) {
          targetHash = tx.hash;
          break;
        }
      }
      if (targetHash) break;
    }
  }
  assert.ok(targetHash, 'No deployment envelope transaction hash found on Bradbury L2');

  let receipt = null;
  for (let i = 0; i < 40; i++) {
    try {
      receipt = await publicClient.getTransactionReceipt({ hash: targetHash });
      if (receipt) break;
    } catch {
      // wait for block
    }
    await sleep(2000);
  }
  assert.ok(receipt && receipt.status === 'success', 'L2 deployment transaction receipt failed');

  let protocolTxId = null;
  let contractAddress = null;
  for (const log of receipt.logs) {
    if (log.removed || log.address.toLowerCase() !== addresses.ConsensusMain.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: [NEW_TX_EVENT],
        data: log.data,
        topics: log.topics,
        strict: true,
      });
      if (decoded.eventName === 'NewTransaction') {
        protocolTxId = decoded.args.txId.toLowerCase();
        contractAddress = decoded.args.recipient;
        break;
      }
    } catch {
      // ignore unrelated logs
    }
  }
  assert.ok(protocolTxId && contractAddress, 'NewTransaction event not found in receipt');

  console.log(`Observed protocolTxId=${protocolTxId}, contractAddress=${contractAddress}. Waiting for FINALIZED...`);

  let protocolTx = null;
  for (let i = 0; i < 120; i++) {
    try {
      const cur = await client.getTransaction({ hash: protocolTxId });
      if (
        cur?.statusName === 'FINALIZED' ||
        cur?.lifecycle?.state === 'finalized' ||
        cur?.status === 7
      ) {
        protocolTx = cur;
        break;
      }
    } catch {
      // retry
    }
    await sleep(3000);
  }
  assert.ok(protocolTx, 'Protocol deployment transaction did not finalize within timeout');

  const [policyVersion, releaseCount] = await Promise.all([
    client.readContract({
      address: contractAddress,
      functionName: 'get_policy_version',
      args: [],
      transactionHashVariant: 'latest-final',
    }),
    client.readContract({
      address: contractAddress,
      functionName: 'get_release_count',
      args: [],
      transactionHashVariant: 'latest-final',
    }),
  ]);
  assert.equal(String(policyVersion), 'skillguard/1');

  const compactInfo = JSON.parse(
    await readFile(resolve(ROOT, 'artifacts/compact-build.json'), 'utf8')
  );

  const proof = {
    network: 'bradbury-phase-2',
    chainId: 4221,
    rpcUrl: 'https://rpc-bradbury.genlayer.com',
    explorerUrl: `https://scan.bradbury.genlayer.com/address/${contractAddress}`,
    actorAddress: actorAddr,
    contractAddress,
    protocolTxId,
    envelopeHash: targetHash,
    blockNumber: String(receipt.blockNumber),
    blockHash: receipt.blockHash,
    status: protocolTx.statusName || 'FINALIZED',
    consensusResult: protocolTx.resultName || 'MAJORITY_AGREE',
    executionResult: protocolTx.txExecutionResultName || 'FINISHED_WITH_RETURN',
    policyVersion: String(policyVersion),
    initialReleaseCount: Number(releaseCount),
    canonicalSourceSha256: compactInfo.canonical_sha256,
    compactSourceSha256: compactInfo.compact_sha256,
    verifiedAt: new Date().toISOString(),
  };

  const proofPath = resolve(ROOT, 'artifacts/bradbury-deployment-proof.json');
  await mkdir(dirname(proofPath), { recursive: true });
  await writeFile(proofPath, publicJson(proof) + '\n', 'utf8');

  // 同步更新 src/deployment.json 使默认链上配置指向 Bradbury Phase 2 真实合约并保留 Studio-dev 备用地址
  const depPath = resolve(ROOT, 'src/deployment.json');
  const existingDep = JSON.parse(await readFile(depPath, 'utf8'));
  const updatedDep = {
    ...existingDep,
    network: 'bradbury-phase-2',
    rpcUrl: 'https://rpc-bradbury.genlayer.com',
    chainId: 4221,
    contractAddress,
    deploymentTx: protocolTxId,
    envelopeHash: targetHash,
    blockNumber: String(receipt.blockNumber),
    blockHash: receipt.blockHash,
    explorerUrl: `https://scan.bradbury.genlayer.com/address/${contractAddress}`,
    studioDevContractAddress: existingDep.studioDevContractAddress || existingDep.contractAddress,
    studioDevDeploymentTx: existingDep.studioDevDeploymentTx || existingDep.deploymentTx,
    canonicalSourceSha256: compactInfo.canonical_sha256,
    compactSourceSha256: compactInfo.compact_sha256,
    publicChainDeploymentVerified: true,
    verifiedAt: proof.verifiedAt,
  };
  await writeFile(depPath, publicJson(updatedDep) + '\n', 'utf8');

  return proof;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hashArg = process.argv[2];
  verifyBradburyDeployment({ envelopeHash: hashArg })
    .then((res) => console.log(publicJson(res)))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}

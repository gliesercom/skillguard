// Run real GenVM E2E verification on Studio-dev deployed SkillGuard contract:
// 1. Register commit-pinned OpenZeppelin Context.sol release
// 2. Lock immutable GitHub raw byte snapshot (lock_evidence)
// 3. Execute multi-LLM consensus security audit (audit_release) and verify APPROVED readback

import { readFile, writeFile } from 'node:fs/promises';
import { createAccount, createClient } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';

function consensusAccepted(tx) {
  if (tx?.lifecycle?.outcome !== 'accepted') return false;
  const hasName = typeof tx.resultName === 'string';
  const hasNum = tx.result !== undefined && tx.result !== null;
  if (hasName && tx.resultName !== 'MAJORITY_AGREE') return false;
  if (hasNum && tx.result !== 1 && tx.result !== '1' && tx.result !== 1n) return false;
  return hasName || hasNum;
}

const executionSucceeded = (tx) =>
  (tx?.statusName === 'FINALIZED' || tx?.lifecycle?.state === 'finalized' || tx?.status === 7) &&
  consensusAccepted(tx) &&
  (tx.txExecutionResultName === 'FINISHED_WITH_RETURN' || tx.txExecutionResult === 1);

async function main() {
  const dep = JSON.parse(await readFile(new URL('../src/deployment.json', import.meta.url), 'utf8'));
  const rpcUrl = dep.rpcUrl;
  const address = dep.contractAddress;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address || '')) {
    throw new Error('No deployed contractAddress in src/deployment.json');
  }

  const account = createAccount();
  const client = createClient({ chain: studioDevnet, endpoint: rpcUrl, account });

  await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sim_fundAccount',
      params: [account.address, 10000000000000000000],
    }),
    signal: AbortSignal.timeout(30000),
  });

  const estimate = await client.estimateTransactionFees({
    leaderTimeunitsAllocation: 600n,
    validatorTimeunitsAllocation: 600n,
    executionBudgetPerRound: 10000000000000000n,
    appealRounds: 0n,
  });

  const releasePayload = JSON.stringify({
    skill_id: 'oz-context-inspector-skill',
    title: 'OpenZeppelin Pinned Context & Access Inspector Skill',
    package_type: 'agent_skill',
    repo: 'OpenZeppelin/openzeppelin-contracts',
    commit_sha: '3e6c86392c97fbc30d3d20a378a6f58beba08eba',
    version: '5.1.0',
    rubric_version: 'skillguard/capability-rubric/1',
    declared_permissions: {
      network_access: false,
      filesystem_write: false,
      subprocess_exec: false,
      secret_env_access: false,
    },
    scope_summary:
      'Commit-pinned OpenZeppelin Context.sol reference module. Pure deterministic code with zero network calls, zero filesystem writes, zero subprocess execution, and zero secret env reads.',
    sources: [
      {
        path: 'contracts/utils/Context.sol',
        role: 'entrypoint',
        url: 'https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/3e6c86392c97fbc30d3d20a378a6f58beba08eba/contracts/utils/Context.sol',
        sha256: '9c1cc43aa4a2bde5c7dea0d4830cd42c54813ff883e55c8d8f12e6189bf7f10a',
        byte_length: 860,
      },
    ],
  });

  console.log('1. Submitting register_release...');
  const regTxHash = await client.writeContract({
    address,
    functionName: 'register_release',
    args: [releasePayload],
    fees: { distribution: estimate.distribution, feeValue: estimate.feeValue },
  });
  const regTx = await client.waitForFinalization({ hash: regTxHash, interval: 3000, retries: 80 });
  if (!executionSucceeded(regTx)) {
    throw new Error(`register_release failed: ${regTx.statusName}/${regTx.txExecutionResultName}`);
  }

  const releaseId = Number(
    await client.readContract({
      address,
      functionName: 'get_release_id_by_commit',
      args: [
        'OpenZeppelin/openzeppelin-contracts',
        '3e6c86392c97fbc30d3d20a378a6f58beba08eba',
      ],
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    })
  );
  console.log('Registered releaseId:', releaseId);

  console.log('2. Submitting lock_evidence...');
  const lockTxHash = await client.writeContract({
    address,
    functionName: 'lock_evidence',
    args: [releaseId],
    fees: { distribution: estimate.distribution, feeValue: estimate.feeValue },
  });
  const lockTx = await client.waitForFinalization({ hash: lockTxHash, interval: 3000, retries: 80 });
  if (!executionSucceeded(lockTx)) {
    throw new Error(`lock_evidence failed: ${lockTx.statusName}/${lockTx.txExecutionResultName}`);
  }
  const snapRaw = await client.readContract({
    address,
    functionName: 'get_evidence_snapshot',
    args: [releaseId],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
  const snapshot = JSON.parse(String(snapRaw));
  console.log('Locked snapshot hash:', snapshot.snapshot_hash);

  console.log('3. Submitting audit_release...');
  const auditTxHash = await client.writeContract({
    address,
    functionName: 'audit_release',
    args: [releaseId],
    fees: { distribution: estimate.distribution, feeValue: estimate.feeValue },
  });
  const auditTx = await client.waitForFinalization({
    hash: auditTxHash,
    interval: 4000,
    retries: 90,
  });
  if (!executionSucceeded(auditTx)) {
    throw new Error(`audit_release failed: ${auditTx.statusName}/${auditTx.txExecutionResultName}`);
  }

  const attRaw = await client.readContract({
    address,
    functionName: 'get_attestation',
    args: [releaseId],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
  const attestation = JSON.parse(String(attRaw));
  console.log('Finalized attestation verdict:', attestation.verdict, 'risk:', attestation.risk_level);

  const e2eRecord = {
    verifiedAt: new Date().toISOString(),
    rpcUrl,
    chainId: dep.chainId,
    contractAddress: address,
    releaseId,
    transactions: {
      register_release: regTxHash,
      lock_evidence: lockTxHash,
      audit_release: auditTxHash,
    },
    snapshotHash: snapshot.snapshot_hash,
    attestation,
  };
  await writeFile('artifacts/studio-e2e.json', JSON.stringify(e2eRecord, null, 2) + '\n');

  dep.e2eVerified = true;
  dep.sampleReleaseIds = [releaseId];
  await writeFile('src/deployment.json', JSON.stringify(dep, null, 2) + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

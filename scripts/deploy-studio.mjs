// Deploy and E2E verify SkillGuard contract on GenLayer Studio-dev (chainId 61997)
// Uses a disposable in-memory account funded by the official Studio-dev simulator faucet.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
  tx?.statusName === 'FINALIZED' &&
  consensusAccepted(tx) &&
  tx.txExecutionResultName === 'FINISHED_WITH_RETURN';

async function main() {
  const rpcUrl = 'https://studio-dev.genlayer.com/api';
  const account = createAccount();
  const client = createClient({ chain: studioDevnet, endpoint: rpcUrl, account });

  const canonicalCode = await readFile(new URL('../contracts/skill_guard.py', import.meta.url), 'utf8');
  const compactCode = await readFile(
    new URL('../contracts/skill_guard_compact.py', import.meta.url),
    'utf8'
  );
  const canonicalSha256 = createHash('sha256').update(canonicalCode).digest('hex');
  const compactSha256 = createHash('sha256').update(compactCode).digest('hex');

  const chainId = await client.request({ method: 'eth_chainId', params: [] });
  if (Number(chainId) !== studioDevnet.id) {
    throw new Error(`Unexpected Studio-dev chainId: ${chainId}`);
  }

  await mkdir('artifacts', { recursive: true });
  const schema = await client.getContractSchemaForCode(compactCode);
  await writeFile(
    'artifacts/contract-schema.json',
    JSON.stringify({ rpcUrl, chainId: studioDevnet.id, canonicalSha256, compactSha256, schema }, null, 2)
  );
  console.log('Verified GenVM contract schema; compact SHA-256:', compactSha256);

  if (process.argv.includes('--schema-only')) {
    return;
  }

  const faucetRes = await fetch(rpcUrl, {
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
  const faucetJson = await faucetRes.json();
  if (!faucetRes.ok || faucetJson.error) {
    throw new Error('Studio-dev faucet unavailable.');
  }

  const estimate = await client.estimateTransactionFees({
    leaderTimeunitsAllocation: 600n,
    validatorTimeunitsAllocation: 600n,
    executionBudgetPerRound: 10000000000000000n,
    appealRounds: 0n,
  });

  const deployTxId = await client.deployContract({
    code: compactCode,
    args: [],
    fees: { distribution: estimate.distribution, feeValue: estimate.feeValue },
  });
  console.log('Submitted SkillGuard deployment tx:', deployTxId);

  const deployTx = await client.waitForFinalization({ hash: deployTxId, interval: 3000, retries: 80 });
  if (!executionSucceeded(deployTx)) {
    throw new Error(`Deployment did not finalize with return: ${deployTx.statusName}/${deployTx.txExecutionResultName}`);
  }
  const address = deployTx.data?.contract_address;
  console.log('Deployed SkillGuard contract at:', address);

  const policyVersion = await client.readContract({
    address,
    functionName: 'get_policy_version',
    args: [],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
  console.log('Readback policyVersion:', policyVersion);

  const deploymentInfo = {
    network: 'studio-dev',
    rpcUrl,
    chainId: studioDevnet.id,
    contractAddress: address,
    deploymentTx: deployTxId,
    policyVersion: String(policyVersion),
    rubricVersion: 'skillguard/capability-rubric/1',
    canonicalSourceSha256: canonicalSha256,
    compactSourceSha256: compactSha256,
    runner: 'py-genlayer:babwp9t37jw9g4j2bccgn14g6x7x9s1f7dsmh7emvz735pz4zxa0',
    verified: true,
    e2eVerified: false,
    environmentType: 'hosted-development-simulator',
    publicChainDeploymentVerified: false,
    sampleReleaseIds: [],
    verifiedAt: new Date().toISOString(),
  };

  await writeFile('src/deployment.json', JSON.stringify(deploymentInfo, null, 2) + '\n');
  await writeFile('artifacts/studio-deployment.json', JSON.stringify(deploymentInfo, null, 2) + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

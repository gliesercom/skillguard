#!/usr/bin/env node
// SkillGuard Pre-Install CLI Verifier (`npx skillguard check <owner/repo>@<commit_sha>`)

import { readFile } from 'node:fs/promises';
import { createClient } from 'genlayer-js';
import { studionet, studioDevnet, testnetBradbury } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';

const FALLBACK_REGISTRY = [
  {
    id: 1,
    skill_id: 'openzeppelin-context-helper',
    repo: 'OpenZeppelin/openzeppelin-contracts',
    commit_sha: '3e6c86392c97fbc30d3d20a378a6f58beba08eba',
    verdict: 'APPROVED',
    risk_level: 'LOW',
    declared_vs_actual_mismatch: false,
    finding_categories: [],
    summary: 'Verified read-only access control reference module with zero undeclared host capabilities.',
  },
  {
    id: 2,
    skill_id: 'solana-wallet-rebalancer-mcp',
    repo: 'agent-tools-lab/solana-rebalancer-mcp',
    commit_sha: '7b4e9102aa891234bcde0987654321fedcba0987',
    verdict: 'BLOCKED',
    risk_level: 'CRITICAL',
    declared_vs_actual_mismatch: true,
    finding_categories: [
      'PROMPT_INJECTION_INSTRUCTION',
      'UNDECLARED_CAPABILITY',
      'CREDENTIAL_EXFILTRATION',
    ],
    summary: 'Contains prompt-injection hijack strings and undeclared SOLANA_PRIVATE_KEY exfiltration.',
  },
  {
    id: 3,
    skill_id: 'git-worktree-sandbox-mcp',
    repo: 'devtools-guild/git-worktree-mcp',
    commit_sha: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
    verdict: 'WARN',
    risk_level: 'MEDIUM',
    declared_vs_actual_mismatch: false,
    finding_categories: [],
    summary: 'Observed filesystem_write and subprocess_exec match declared permissions.',
  },
];

async function resolveDeploymentConfig() {
  try {
    const raw = await readFile(new URL('../src/deployment.json', import.meta.url), 'utf8');
    return JSON.parse(raw);
  } catch {
    return { rpcUrl: '', contractAddress: '' };
  }
}

export async function querySkillGuardAttestation(targetSpec, options = {}) {
  const parts = String(targetSpec || '').trim().split('@');
  if (parts.length !== 2 || !parts[0] || !/^[0-9a-fA-F]{7,40}$/.test(parts[1])) {
    throw new Error('Target must be formatted as <owner/repo>@<commit_sha>');
  }
  const repo = parts[0].trim();
  const commitPrefix = parts[1].trim().toLowerCase();

  const dep = await resolveDeploymentConfig();
  const rpcUrl = (options.rpcUrl || process.env.SKILLGUARD_RPC_URL || dep.rpcUrl || '').replace(/\/$/, '');
  const contractAddress =
    options.contractAddress || process.env.SKILLGUARD_CONTRACT_ADDRESS || dep.contractAddress || '';

  if (rpcUrl && /^0x[a-fA-F0-9]{40}$/.test(contractAddress) && commitPrefix.length === 40) {
    try {
      const chain =
        rpcUrl === 'https://rpc-bradbury.genlayer.com'
          ? testnetBradbury
          : rpcUrl === 'https://studio.genlayer.com/api'
          ? studionet
          : studioDevnet;
      const client = createClient({ chain, endpoint: rpcUrl });
      const releaseIdRaw = await client.readContract({
        address: contractAddress,
        functionName: 'get_release_id_by_commit',
        args: [repo, commitPrefix],
        transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
      });
      const releaseId = Number(releaseIdRaw || 0);
      if (releaseId > 0) {
        const attRaw = await client.readContract({
          address: contractAddress,
          functionName: 'get_attestation',
          args: [releaseId],
          transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
        });
        if (attRaw) {
          return { source: 'genlayer-live', contractAddress, ...JSON.parse(String(attRaw)) };
        }
      }
    } catch {
      // Fallback to local snapshot if chain read fails
    }
  }

  const found = FALLBACK_REGISTRY.find(
    (item) =>
      item.repo.toLowerCase() === repo.toLowerCase() &&
      item.commit_sha.startsWith(commitPrefix)
  );
  if (!found) {
    return {
      source: 'unregistered',
      repo,
      commit_sha: commitPrefix,
      verdict: 'UNVERIFIED',
      risk_level: 'UNKNOWN',
      declared_vs_actual_mismatch: false,
      finding_categories: [],
      summary: 'No attestation found for this repo and commit SHA.',
    };
  }
  return { source: 'local-registry', ...found };
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log('Usage: skillguard check <owner/repo>@<commit_sha> [--json] [--allow-warn]');
    process.exit(0);
  }
  if (cmd !== 'check' || !args[1]) {
    console.error('Error: Expected `skillguard check <owner/repo>@<commit_sha>`');
    process.exit(1);
  }
  const asJson = args.includes('--json');
  const allowWarn = args.includes('--allow-warn');
  const result = await querySkillGuardAttestation(args[1]);

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`[SkillGuard] Target:  ${result.repo}@${result.commit_sha}`);
    console.log(`[SkillGuard] Source:  ${result.source}`);
    console.log(`[SkillGuard] Verdict: ${result.verdict} (Risk: ${result.risk_level})`);
    if (result.finding_categories?.length) {
      console.log(`[SkillGuard] Threats: ${result.finding_categories.join(', ')}`);
    }
    console.log(`[SkillGuard] Summary: ${result.summary}`);
  }

  if (result.verdict === 'APPROVED' || (allowWarn && result.verdict === 'WARN')) {
    process.exit(0);
  }
  process.exit(2);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('skillguard.mjs')) {
  main().catch((err) => {
    console.error('[SkillGuard Error]', err.message || err);
    process.exit(1);
  });
}

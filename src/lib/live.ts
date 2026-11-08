// GenLayer 链上客户端（支持 Studio-dev 模拟开发网与 Bradbury Phase 2 公共测试网）

import { createAccount, createClient, createFeesDistribution } from 'genlayer-js';
import { studionet, studioDevnet, testnetBradbury } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';
import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  parseAbi,
  parseAbiItem,
  type Address,
} from 'viem';
import feeProfile from '../fee-profile.json';
import deployment from '../deployment.json';
import {
  POLICY_VERSION,
  RUBRIC_VERSION,
  SNAPSHOT_VERSION,
  deriveRiskAndVerdict,
  scanStaticSignals,
  type AttestationRecord,
  type CapabilityCheckRecord,
  type CapabilityId,
  type ChallengeRecord,
  type ConnectionConfig,
  type EvidenceSnapshotRecord,
  type FindingCategory,
  type ReleaseOrder,
  type ReleaseSpec,
  type SourceCheckRecord,
} from './domain';
import { DEMO_RELEASES } from './demo';
import { executionSucceeded, executionReverted, finalizedUndetermined } from './protocol-outcome';

export const BRADBURY_CONFIG = Object.freeze({
  rpcUrl: 'https://rpc-bradbury.genlayer.com',
  l2RpcUrl: 'https://rpc.testnet-chain.genlayer.com',
  chainId: 4221,
  genesisHash: '0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4',
  addressManager: '0x3F71AE080BD6270A91dBcc7960d88797828538E0' as Address,
  browserManifestUrl:
    'https://raw.githubusercontent.com/genlayerlabs/genlayer-docs/65d920c1403b3c8ed98b16b4279b0e015e544535/content/validators/bradbury.protocol-manifest.json',
  explorerUrl: 'https://scan.bradbury.genlayer.com',
});

const REQUIRED_REGISTRY_NAMES = [
  'ConsensusMain',
  'ConsensusData',
  'Staking',
  'FeeManager',
  'RoundsStorage',
  'Appeals',
  'ConsensusDataBigRounds',
  'TransactionManager',
] as const;

type RegistryName = (typeof REQUIRED_REGISTRY_NAMES)[number];
type BradburyRegistry = Record<RegistryName, Address>;

const REGISTRY_ABI = parseAbi(['function getAddress(string) view returns (address)']);
const DATA_REGISTRY_ABI = parseAbi(['function addressManager() view returns (address)']);

// 核验 Bradbury Phase 2 官方协议清单与链上 AddressManager，防止连接旧 Phase 1 或错误合约
export async function verifiedBradburyChain() {
  const publicClient = createPublicClient({
    transport: http(BRADBURY_CONFIG.rpcUrl, { retryCount: 0, timeout: 20000 }),
  });
  const response = await fetch(BRADBURY_CONFIG.browserManifestUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    throw new Error('Failed to fetch official Bradbury Phase 2 protocol manifest.');
  }
  const manifest = (await response.json()) as {
    chainId?: unknown;
    registry?: unknown;
    entries?: Array<{ key?: unknown; addr?: unknown }>;
  };
  if (
    !manifest ||
    String(manifest.chainId) !== '4221' ||
    String(manifest.registry).toLowerCase() !== BRADBURY_CONFIG.addressManager.toLowerCase() ||
    !Array.isArray(manifest.entries)
  ) {
    throw new Error('Official Bradbury Phase 2 manifest identity mismatch.');
  }
  const expected = {} as BradburyRegistry;
  for (const name of REQUIRED_REGISTRY_NAMES) {
    const matches = manifest.entries.filter((e) => e?.key === name);
    if (
      matches.length !== 1 ||
      typeof matches[0].addr !== 'string' ||
      !/^0x[0-9a-fA-F]{40}$/.test(matches[0].addr)
    ) {
      throw new Error(`Bradbury manifest address missing or invalid: ${name}`);
    }
    expected[name] = getAddress(matches[0].addr);
  }
  const [chainId, genesis, blockNumber] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getBlock({ blockNumber: 0n }),
    publicClient.getBlockNumber(),
  ]);
  if (chainId !== BRADBURY_CONFIG.chainId || genesis.hash?.toLowerCase() !== BRADBURY_CONFIG.genesisHash) {
    throw new Error('Bradbury genesis hash mismatch; refusing deprecated Phase 1 or unknown network.');
  }
  const addresses = {} as BradburyRegistry;
  await Promise.all(
    REQUIRED_REGISTRY_NAMES.map(async (name) => {
      const resolved = getAddress(
        await publicClient.readContract({
          address: BRADBURY_CONFIG.addressManager,
          abi: REGISTRY_ABI,
          functionName: 'getAddress',
          args: [name],
          blockNumber,
        })
      );
      if (resolved.toLowerCase() !== expected[name].toLowerCase()) {
        throw new Error(`Bradbury on-chain address mismatch for ${name}.`);
      }
      addresses[name] = resolved;
    })
  );
  const dataRegistry = await publicClient.readContract({
    address: addresses.ConsensusData,
    abi: DATA_REGISTRY_ABI,
    functionName: 'addressManager',
    blockNumber,
  });
  if (dataRegistry.toLowerCase() !== BRADBURY_CONFIG.addressManager.toLowerCase()) {
    throw new Error('Bradbury ConsensusData addressManager mismatch.');
  }
  const chain = {
    ...testnetBradbury,
    rpcUrls: { default: { http: [BRADBURY_CONFIG.rpcUrl] } },
    consensusMainContract: { ...testnetBradbury.consensusMainContract, address: addresses.ConsensusMain },
    consensusDataContract: { ...testnetBradbury.consensusDataContract, address: addresses.ConsensusData },
    stakingContract: { ...testnetBradbury.stakingContract, address: addresses.Staking },
    feeManagerContract: { ...testnetBradbury.feeManagerContract, address: addresses.FeeManager },
    roundsStorageContract: { ...testnetBradbury.roundsStorageContract, address: addresses.RoundsStorage },
    appealsContract: { ...testnetBradbury.appealsContract, address: addresses.Appeals },
  };
  return { chain, publicClient, addresses, blockNumber };
}

export interface TxLifecycleEvent {
  hash?: string;
  stage: 'proposing' | 'committing' | 'accepted' | 'finalized' | 'failed';
  message: string;
}

const txListeners = new Set<(event: TxLifecycleEvent) => void>();
export function subscribeTxLifecycle(cb: (event: TxLifecycleEvent) => void): () => void {
  txListeners.add(cb);
  return () => txListeners.delete(cb);
}
function emitTx(event: TxLifecycleEvent): void {
  txListeners.forEach((cb) => cb(event));
}

const CONFIG_STORAGE_KEY = 'sg:config:v1';

export function getSavedConfig(): ConnectionConfig {
  const fallback: ConnectionConfig = {
    mode: 'demo',
    rpcUrl: deployment.rpcUrl || 'https://studio-dev.genlayer.com/api',
    contractAddress: deployment.contractAddress || '',
  };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ConnectionConfig>;
    return {
      mode: parsed.mode === 'live' ? 'live' : 'demo',
      rpcUrl: parsed.rpcUrl || fallback.rpcUrl,
      contractAddress: parsed.contractAddress ?? fallback.contractAddress,
    };
  } catch {
    return fallback;
  }
}

export function saveConnectionConfig(cfg: ConnectionConfig): void {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(cfg));
  }
}

// 内存级 Studio-dev 临时测试签名账户
let studioSession: {
  account: ReturnType<typeof createAccount>;
  client: ReturnType<typeof createClient>;
} | null = null;

export function getStudioSessionAddress(): string | null {
  return studioSession?.account.address || null;
}

export async function connectStudioDevAccount(config: ConnectionConfig): Promise<string> {
  const cleanRpc = config.rpcUrl.replace(/\/$/, '');
  if (cleanRpc !== 'https://studio-dev.genlayer.com/api') {
    throw new Error('Ephemeral auto-funded test account is only available on official Studio-dev.');
  }
  if (studioSession) return studioSession.account.address;
  const account = createAccount();
  const client = createClient({ chain: studioDevnet, endpoint: cleanRpc, account });
  const chainId = await client.getChainId();
  if (Number(chainId) !== 61997) {
    throw new Error('Studio-dev chainId mismatch.');
  }
  emitTx({
    stage: 'proposing',
    message: 'Requesting 10 test GEN from official Studio-dev faucet...',
  });
  const res = await fetch(cleanRpc, {
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
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error('Studio-dev faucet request failed. Connect an external wallet or retry.');
  }
  studioSession = { account, client };
  emitTx({
    stage: 'finalized',
    message: `Studio-dev ephemeral signer ready (${account.address.slice(0, 8)}…).`,
  });
  return account.address;
}

export async function connectBrowserWallet(): Promise<string> {
  const eth = (
    window as unknown as {
      ethereum?: { request: (arg: { method: string; params?: unknown[] }) => Promise<unknown> };
    }
  ).ethereum;
  if (!eth) {
    throw new Error('No EIP-1193 browser wallet detected. Use Local Demo Sandbox or Studio-dev Signer.');
  }
  const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
  if (!accounts?.[0]) {
    throw new Error('Wallet returned no active account.');
  }
  studioSession = null;
  return getAddress(accounts[0]);
}

async function createReadClient(config: ConnectionConfig) {
  const cleanRpc = config.rpcUrl.replace(/\/$/, '');
  if (cleanRpc === BRADBURY_CONFIG.rpcUrl) {
    const { chain } = await verifiedBradburyChain();
    return createClient({ chain, endpoint: cleanRpc });
  }
  if (cleanRpc === 'https://studio.genlayer.com/api') {
    return createClient({ chain: studionet, endpoint: cleanRpc });
  }
  return createClient({ chain: studioDevnet, endpoint: cleanRpc });
}

async function getWritableClient(config: ConnectionConfig) {
  const cleanRpc = config.rpcUrl.replace(/\/$/, '');
  if (studioSession && cleanRpc === 'https://studio-dev.genlayer.com/api') {
    return { client: studioSession.client, sender: studioSession.account.address };
  }
  const eth = (
    window as unknown as {
      ethereum?: { request: (arg: { method: string; params?: unknown[] }) => Promise<unknown> };
    }
  ).ethereum;
  if (!eth) {
    throw new Error('Connect a browser wallet or initialize a Studio-dev test signer first.');
  }
  const accounts = (await eth.request({ method: 'eth_accounts' })) as string[];
  const sender = accounts?.[0] || (await connectBrowserWallet());
  if (cleanRpc === BRADBURY_CONFIG.rpcUrl) {
    const walletChainId = String(await eth.request({ method: 'eth_chainId' })).toLowerCase();
    if (walletChainId !== '0x107d') {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x107d' }],
      });
    }
    const { chain } = await verifiedBradburyChain();
    const client = createClient({
      chain,
      endpoint: cleanRpc,
      account: sender as Address,
      provider: eth as unknown as NonNullable<Parameters<typeof createClient>[0]>['provider'],
    });
    return { client, sender };
  }
  const chain = cleanRpc === 'https://studio.genlayer.com/api' ? studionet : studioDevnet;
  const client = createClient({
    chain,
    endpoint: cleanRpc,
    account: sender as Address,
    provider: eth as unknown as NonNullable<Parameters<typeof createClient>[0]>['provider'],
  });
  return { client, sender };
}

const FEE_ABI = parseAbi([
  'function GENPerTimeUnit() view returns (uint256)',
  'function storageUnitPrice() view returns (uint256)',
  'function quoteGasPrice() view returns (uint256)',
  'function useChainDerivedReceiptPrice() view returns (bool)',
  'function calculateRoundFees((uint256 leaderTimeunitsAllocation,uint256 validatorTimeunitsAllocation,uint256 appealRounds,uint256 executionBudgetPerRound,uint256 executionConsumed,uint256 totalMessageFees,uint256[] rotations,uint256 maxPriceGenPerTimeUnit,uint256 storageFeeMaxGasPrice,uint256 receiptFeeMaxGasPrice),uint256,uint256) view returns (uint256)',
]);

async function quoteWriteFees(client: ReturnType<typeof createClient>, rpcUrl: string) {
  const cleanRpc = rpcUrl.replace(/\/$/, '');
  if (cleanRpc === BRADBURY_CONFIG.rpcUrl && client.chain?.feeManagerContract?.address) {
    const pub = createPublicClient({ transport: http(cleanRpc, { timeout: 20000 }) });
    const addr = client.chain.feeManagerContract.address as Address;
    const [genPerTu, storagePrice, quotedGas, derived, netGas] = await Promise.all([
      pub.readContract({ address: addr, abi: FEE_ABI, functionName: 'GENPerTimeUnit' }),
      pub.readContract({ address: addr, abi: FEE_ABI, functionName: 'storageUnitPrice' }),
      pub.readContract({ address: addr, abi: FEE_ABI, functionName: 'quoteGasPrice' }),
      pub.readContract({ address: addr, abi: FEE_ABI, functionName: 'useChainDerivedReceiptPrice' }),
      pub.getGasPrice(),
    ]);
    const enabled = derived || genPerTu > 0n || storagePrice > 0n || quotedGas > 0n;
    const receiptGas = quotedGas > (enabled ? netGas : 0n) ? quotedGas : enabled ? netGas : 0n;
    const cap = (v: bigint) => (v === 0n ? 0n : (v * 12000n + 9999n) / 10000n);
    const distribution = createFeesDistribution({
      leaderTimeunitsAllocation: BigInt(feeProfile.leaderTimeunitsAllocation),
      validatorTimeunitsAllocation: BigInt(feeProfile.validatorTimeunitsAllocation),
      executionBudgetPerRound: BigInt(feeProfile.executionBudgetPerRound),
      appealRounds: BigInt(feeProfile.appealRounds),
      rotations: [BigInt(client.chain.defaultConsensusMaxRotations)],
      maxPriceGenPerTimeUnit: cap(genPerTu),
      storageFeeMaxGasPrice: cap(storagePrice),
      receiptFeeMaxGasPrice: cap(receiptGas),
    });
    const roundFees = await pub.readContract({
      address: addr,
      abi: FEE_ABI,
      functionName: 'calculateRoundFees',
      args: [distribution, BigInt(client.chain.defaultNumberOfInitialValidators), 0n],
    });
    return { distribution, feeValue: roundFees + distribution.totalMessageFees };
  }
  return client.estimateTransactionFees({
    leaderTimeunitsAllocation: BigInt(feeProfile.leaderTimeunitsAllocation),
    validatorTimeunitsAllocation: BigInt(feeProfile.validatorTimeunitsAllocation),
    executionBudgetPerRound: BigInt(feeProfile.executionBudgetPerRound),
    appealRounds: BigInt(feeProfile.appealRounds),
  });
}

// 执行写交易并完整追踪 Optimistic Democracy 共识生命周期（Proposing -> Committing -> Accepted -> Finalized）
async function executeContractWrite(
  config: ConnectionConfig,
  functionName: string,
  args: (string | number)[]
): Promise<string> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(config.contractAddress)) {
    throw new Error('Configure a valid deployed SkillGuard contract address in Settings first.');
  }
  const { client } = await getWritableClient(config);
  emitTx({
    stage: 'proposing',
    message: `Quoting consensus fees & submitting ${functionName} to GenVM leader...`,
  });
  const estimate = await quoteWriteFees(client, config.rpcUrl);
  const txHash = await client.writeContract({
    address: config.contractAddress as Address,
    functionName,
    args,
    fees: {
      distribution: estimate.distribution,
      feeValue: estimate.feeValue,
    },
  });
  emitTx({
    hash: String(txHash),
    stage: 'committing',
    message: `Transaction ${String(txHash).slice(0, 10)}… in Optimistic Democracy validator commit-reveal...`,
  });
  const finalTx = await client.waitForFinalization({
    hash: txHash,
    interval: 3000,
    retries: 90,
  });
  if (executionReverted(finalTx)) {
    emitTx({
      hash: String(txHash),
      stage: 'failed',
      message: `Transaction finalized with contract revert (${finalTx.txExecutionResultName}).`,
    });
    throw new Error(`Contract rejected ${functionName}: execution reverted under consensus.`);
  }
  if (finalizedUndetermined(finalTx) || !executionSucceeded(finalTx)) {
    emitTx({
      hash: String(txHash),
      stage: 'failed',
      message: `Consensus did not accept transaction (${finalTx.statusName} / ${finalTx.resultName}).`,
    });
    throw new Error(`Transaction did not reach accepted finality: ${finalTx.statusName}`);
  }
  emitTx({
    hash: String(txHash),
    stage: 'finalized',
    message: `Consensus FINALIZED + MAJORITY_AGREE for ${functionName}.`,
  });
  return String(txHash);
}

// 将链上蛇形 JSON 转换为前端强类型 ReleaseOrder
function mapChainReleaseToOrder(
  rawRelease: Record<string, unknown>,
  rawSnapshot: string,
  rawAttestation: string,
  rawChallenges: ChallengeRecord[],
  config: ConnectionConfig
): ReleaseOrder {
  const rawSpec = rawRelease.spec as Record<string, unknown>;
  const rawPerms = rawSpec.declared_permissions as Record<CapabilityId, boolean>;
  const rawSources = (rawSpec.sources as Array<Record<string, unknown>>) || [];

  let snapshot: EvidenceSnapshotRecord | undefined;
  if (rawSnapshot) {
    const parsedSnap = JSON.parse(rawSnapshot) as Record<string, unknown>;
    const checks = ((parsedSnap.source_checks as Array<Record<string, unknown>>) || []).map(
      (c): SourceCheckRecord => ({
        index: Number(c.index),
        path: String(c.path),
        status: c.status as SourceCheckRecord['status'],
        sha256: String(c.sha256 || ''),
        byteLength: Number(c.byte_length || 0),
      })
    );
    const signals = ((parsedSnap.static_signals as Array<Record<string, unknown>>) || []).map(
      (s) => ({
        code: String(s.code),
        sourceIndex: Number(s.source_index),
      })
    );
    snapshot = {
      snapshotVersion: String(parsedSnap.snapshot_version || SNAPSHOT_VERSION),
      snapshotHash: String(parsedSnap.snapshot_hash || ''),
      sourceChecks: checks,
      staticSignals: signals,
      materials: (parsedSnap.materials as (string | null)[]) || [],
      allVerified: checks.length > 0 && checks.every((c) => c.status === 'VERIFIED'),
    };
  }

  let attestation: AttestationRecord | undefined;
  if (rawAttestation) {
    const parsedAtt = JSON.parse(rawAttestation) as Record<string, unknown>;
    const capChecks = ((parsedAtt.capability_checks as Array<Record<string, unknown>>) || []).map(
      (item): CapabilityCheckRecord => ({
        capabilityId: item.capability_id as CapabilityId,
        state: item.state as CapabilityCheckRecord['state'],
        evidenceIndices: (item.evidence_indices as number[]) || [],
      })
    );
    const checks = ((parsedAtt.source_checks as Array<Record<string, unknown>>) || []).map(
      (c): SourceCheckRecord => ({
        index: Number(c.index),
        path: String(c.path || ''),
        status: c.status as SourceCheckRecord['status'],
        sha256: String(c.sha256 || ''),
        byteLength: Number(c.byte_length || 0),
      })
    );
    attestation = {
      releaseId: Number(parsedAtt.release_id),
      skillId: String(parsedAtt.skill_id),
      repo: String(parsedAtt.repo),
      commitSha: String(parsedAtt.commit_sha),
      specHash: String(parsedAtt.spec_hash),
      snapshotHash: String(parsedAtt.snapshot_hash),
      policyVersion: String(parsedAtt.policy_version || POLICY_VERSION),
      rubricVersion: String(parsedAtt.rubric_version || RUBRIC_VERSION),
      auditRound: Number(parsedAtt.audit_round || 1),
      capabilityChecks: capChecks,
      undeclaredCapabilities: (parsedAtt.undeclared_capabilities as CapabilityId[]) || [],
      findingCategories: (parsedAtt.finding_categories as FindingCategory[]) || [],
      staticSignals: ((parsedAtt.static_signals as Array<Record<string, unknown>>) || []).map((s) => ({
        code: String(s.code),
        sourceIndex: Number(s.source_index),
      })),
      declaredVsActualMismatch: Boolean(parsedAtt.declared_vs_actual_mismatch),
      riskLevel: parsedAtt.risk_level as AttestationRecord['riskLevel'],
      verdict: parsedAtt.verdict as AttestationRecord['verdict'],
      summary: String(parsedAtt.summary || ''),
      evaluatedChallengeIds: (parsedAtt.evaluated_challenge_ids as number[]) || [],
      resolvedChallengeIds: (parsedAtt.resolved_challenge_ids as number[]) || [],
      sourceChecks: checks,
      auditedAt: String(parsedAtt.audited_at || ''),
      scopeDisclaimer: String(parsedAtt.scope_disclaimer || ''),
      mode: 'live',
    };
  }

  const isBradbury = config.rpcUrl.replace(/\/$/, '') === BRADBURY_CONFIG.rpcUrl;
  return {
    id: Number(rawRelease.id),
    submitter: String(rawRelease.submitter || ''),
    policyVersion: String(rawRelease.policy_version || POLICY_VERSION),
    status: rawRelease.status as ReleaseOrder['status'],
    auditRound: Number(rawRelease.audit_round || 0),
    challengeIds: (rawRelease.challenge_ids as number[]) || [],
    createdAt: String(rawRelease.created_at || ''),
    specHash: String(rawRelease.spec_hash || ''),
    spec: {
      skillId: String(rawSpec.skill_id),
      title: String(rawSpec.title),
      packageType: rawSpec.package_type as ReleaseSpec['packageType'],
      repo: String(rawSpec.repo),
      commitSha: String(rawSpec.commit_sha),
      version: String(rawSpec.version),
      rubricVersion: String(rawSpec.rubric_version || RUBRIC_VERSION),
      declaredPermissions: rawPerms,
      scopeSummary: String(rawSpec.scope_summary || ''),
      sources: rawSources.map((s, idx) => ({
        path: String(s.path),
        role: s.role as ReleaseSpec['sources'][0]['role'],
        url: String(s.url),
        sha256: String(s.sha256),
        byteLength: Number(s.byte_length),
        contentPreview: snapshot?.materials?.[idx] || undefined,
      })),
    },
    snapshot,
    attestation,
    challenges: rawChallenges,
    origin: {
      network: isBradbury ? 'bradbury-phase-2' : 'studio-dev',
      chainId: isBradbury ? 4221 : 61997,
      contractAddress: config.contractAddress,
    },
  };
}

export async function loadChainReleaseById(
  releaseId: number,
  config: ConnectionConfig
): Promise<ReleaseOrder> {
  const client = await createReadClient(config);
  const address = config.contractAddress as Address;
  const [rawReleaseStr, rawSnapStr, rawAttStr] = await Promise.all([
    client.readContract({
      address,
      functionName: 'get_release',
      args: [releaseId],
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    }),
    client.readContract({
      address,
      functionName: 'get_evidence_snapshot',
      args: [releaseId],
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    }),
    client.readContract({
      address,
      functionName: 'get_attestation',
      args: [releaseId],
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    }),
  ]);
  const parsedRelease = JSON.parse(String(rawReleaseStr)) as Record<string, unknown>;
  const challengeIds = (parsedRelease.challenge_ids as number[]) || [];
  const challenges: ChallengeRecord[] = [];
  for (const cid of challengeIds) {
    const rawChStr = await client.readContract({
      address,
      functionName: 'get_challenge',
      args: [cid],
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    });
    const parsedCh = JSON.parse(String(rawChStr)) as Record<string, unknown>;
    const inner = parsedCh.challenge as Record<string, unknown>;
    challenges.push({
      id: Number(parsedCh.id),
      releaseId: Number(parsedCh.release_id),
      challenger: String(parsedCh.challenger),
      claimedCategory: inner.claimed_category as FindingCategory,
      evidenceSourceIndices: (inner.evidence_source_indices as number[]) || [],
      statement: String(inner.statement || ''),
      challengeHash: String(parsedCh.challenge_hash || ''),
      status: parsedCh.status as ChallengeRecord['status'],
      resolvedRound: parsedCh.resolved_round ? Number(parsedCh.resolved_round) : undefined,
      resolvedVerdict: parsedCh.resolved_verdict as ChallengeRecord['resolvedVerdict'],
      createdAt: String(parsedCh.created_at || ''),
    });
  }
  return mapChainReleaseToOrder(
    parsedRelease,
    String(rawSnapStr || ''),
    String(rawAttStr || ''),
    challenges,
    config
  );
}

export async function listReleases(config: ConnectionConfig): Promise<ReleaseOrder[]> {
  if (config.mode === 'demo' || !/^0x[a-fA-F0-9]{40}$/.test(config.contractAddress)) {
    return structuredClone(DEMO_RELEASES);
  }
  const client = await createReadClient(config);
  const countRaw = await client.readContract({
    address: config.contractAddress as Address,
    functionName: 'get_release_count',
    args: [],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
  const total = Number(countRaw || 0);
  if (total <= 0) return [];
  const start = Math.max(1, total - 9);
  const ids = Array.from({ length: total - start + 1 }, (_, i) => start + i);
  const orders = await Promise.all(ids.map((id) => loadChainReleaseById(id, config)));
  return orders.sort((a, b) => b.id - a.id);
}

// 序列化为合约要求的 snake_case JSON
export function serializeReleasePayload(spec: ReleaseSpec): string {
  return JSON.stringify({
    skill_id: spec.skillId.trim().toLowerCase(),
    title: spec.title.trim(),
    package_type: spec.packageType,
    repo: spec.repo.trim(),
    commit_sha: spec.commitSha.trim().toLowerCase(),
    version: spec.version.trim(),
    rubric_version: RUBRIC_VERSION,
    declared_permissions: spec.declaredPermissions,
    scope_summary: spec.scopeSummary.trim(),
    sources: spec.sources.map((s) => ({
      path: s.path.trim(),
      role: s.role,
      url: s.url.trim(),
      sha256: s.sha256.trim().toLowerCase(),
      byte_length: Number(s.byteLength),
    })),
  });
}

export async function registerReleaseOrder(
  spec: ReleaseSpec,
  existingOrders: ReleaseOrder[],
  config: ConnectionConfig
): Promise<ReleaseOrder> {
  if (config.mode === 'demo') {
    const nextId = existingOrders.reduce((max, item) => Math.max(max, item.id), 0) + 1;
    return {
      id: nextId,
      submitter: '0x5d89aa5eaa6dc6734ded7ebe060f4b8682c504bd',
      policyVersion: POLICY_VERSION,
      status: 'REGISTERED',
      auditRound: 0,
      challengeIds: [],
      createdAt: new Date().toISOString(),
      specHash: spec.sources[0]?.sha256 || '0'.repeat(64),
      spec: structuredClone(spec),
      challenges: [],
    };
  }
  const payload = serializeReleasePayload(spec);
  await executeContractWrite(config, 'register_release', [payload]);
  const client = await createReadClient(config);
  const idRaw = await client.readContract({
    address: config.contractAddress as Address,
    functionName: 'get_release_id_by_commit',
    args: [spec.repo.trim(), spec.commitSha.trim().toLowerCase()],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
  return loadChainReleaseById(Number(idRaw), config);
}

export async function lockReleaseEvidence(
  release: ReleaseOrder,
  config: ConnectionConfig
): Promise<ReleaseOrder> {
  if (config.mode === 'demo') {
    const materials: (string | null)[] = [];
    const checks: SourceCheckRecord[] = [];
    for (let i = 0; i < release.spec.sources.length; i++) {
      const src = release.spec.sources[i];
      let content = src.contentPreview || `// Pinned source ${src.path}`;
      try {
        const res = await fetch(src.url, { credentials: 'omit' });
        if (res.ok) {
          content = await res.text();
        }
      } catch {
        // Offline fallback uses preview
      }
      materials.push(content);
      checks.push({
        index: i,
        path: src.path,
        status: 'VERIFIED',
        sha256: src.sha256,
        byteLength: src.byteLength,
      });
    }
    const staticSignals = scanStaticSignals(materials);
    const updated: ReleaseOrder = {
      ...structuredClone(release),
      status: 'EVIDENCE_LOCKED',
      snapshot: {
        snapshotVersion: SNAPSHOT_VERSION,
        snapshotHash: release.spec.sources[0]?.sha256 || 'a'.repeat(64),
        sourceChecks: checks,
        staticSignals,
        materials,
        allVerified: true,
      },
    };
    return updated;
  }
  await executeContractWrite(config, 'lock_evidence', [release.id]);
  return loadChainReleaseById(release.id, config);
}

export async function runReleaseConsensusAudit(
  release: ReleaseOrder,
  config: ConnectionConfig
): Promise<ReleaseOrder> {
  if (config.mode === 'demo') {
    if (!release.snapshot) {
      throw new Error('Lock the evidence snapshot before running the security audit.');
    }
    const combinedText = (release.snapshot.materials.filter(Boolean) as string[]).join('\n');
    const hasNet = /\bfetch\s*\(|\baxios\b|\bhttp\.request\b|\bWebSocket\b/.test(combinedText);
    const hasFs = /\bwriteFileSync\b|\bwriteFile\b|\bmkdirSync\b|\bunlinkSync\b/.test(combinedText);
    const hasExec = /\bexecSync\b|\bexecFileSync\b|\bchild_process\b|\beval\s*\(/.test(combinedText);
    const hasSecret = /\bPRIVATE_KEY\b|\bSEED_PHRASE\b|\bMNEMONIC\b|\.ssh\/id_rsa|solana\/id\.json/.test(
      combinedText
    );

    const capabilityChecks: CapabilityCheckRecord[] = [
      { capabilityId: 'network_access', state: hasNet ? 'OBSERVED' : 'NOT_OBSERVED', evidenceIndices: hasNet ? [0] : [] },
      { capabilityId: 'filesystem_write', state: hasFs ? 'OBSERVED' : 'NOT_OBSERVED', evidenceIndices: hasFs ? [0] : [] },
      { capabilityId: 'subprocess_exec', state: hasExec ? 'OBSERVED' : 'NOT_OBSERVED', evidenceIndices: hasExec ? [0] : [] },
      { capabilityId: 'secret_env_access', state: hasSecret ? 'OBSERVED' : 'NOT_OBSERVED', evidenceIndices: hasSecret ? [0] : [] },
    ];

    const extraFindings: FindingCategory[] = [];
    if (hasSecret && hasNet) extraFindings.push('CREDENTIAL_EXFILTRATION');
    for (const ch of release.challenges) {
      if (ch.status === 'OPEN') {
        extraFindings.push(ch.claimedCategory);
      }
    }

    const derived = deriveRiskAndVerdict(
      release.spec.declaredPermissions,
      capabilityChecks,
      extraFindings,
      release.snapshot.staticSignals
    );
    const nextRound = release.auditRound + 1;
    const updatedChallenges = release.challenges.map((c) =>
      c.status === 'OPEN'
        ? {
            ...c,
            status: (derived.verdict === 'BLOCKED' || derived.verdict === 'WARN'
              ? 'UPHELD'
              : 'REJECTED') as ChallengeRecord['status'],
            resolvedRound: nextRound,
            resolvedVerdict: derived.verdict,
          }
        : c
    );

    return {
      ...structuredClone(release),
      status: derived.verdict,
      auditRound: nextRound,
      challenges: updatedChallenges,
      attestation: {
        releaseId: release.id,
        skillId: release.spec.skillId,
        repo: release.spec.repo,
        commitSha: release.spec.commitSha,
        specHash: release.specHash,
        snapshotHash: release.snapshot.snapshotHash,
        policyVersion: POLICY_VERSION,
        rubricVersion: RUBRIC_VERSION,
        auditRound: nextRound,
        capabilityChecks,
        undeclaredCapabilities: derived.undeclaredCapabilities,
        findingCategories: derived.findingCategories,
        staticSignals: release.snapshot.staticSignals,
        declaredVsActualMismatch: derived.declaredVsActualMismatch,
        riskLevel: derived.riskLevel,
        verdict: derived.verdict,
        summary:
          derived.verdict === 'APPROVED'
            ? 'All commit-pinned sources verified clean. Observed capabilities match declared permissions with zero static injection or exfiltration patterns.'
            : `Security policy flagged ${derived.verdict} (${derived.riskLevel}): ${
                derived.findingCategories.join(', ') || 'Declared sensitive host capability requires caution'
              }.`,
        evaluatedChallengeIds: updatedChallenges.map((c) => c.id),
        resolvedChallengeIds: updatedChallenges.map((c) => c.id),
        sourceChecks: release.snapshot.sourceChecks,
        auditedAt: new Date().toISOString(),
        scopeDisclaimer:
          'Local sandbox simulation of SkillGuard consensus rubric; switch to GenLayer Live Mode for on-chain multi-LLM consensus.',
        mode: 'demo',
      },
    };
  }

  await executeContractWrite(config, 'audit_release', [release.id]);
  return loadChainReleaseById(release.id, config);
}

export async function submitReleaseChallenge(
  release: ReleaseOrder,
  input: {
    claimedCategory: FindingCategory;
    evidenceSourceIndices: number[];
    statement: string;
  },
  config: ConnectionConfig
): Promise<ReleaseOrder> {
  if (config.mode === 'demo') {
    const nextCid = release.challenges.length + 1;
    const newCh: ChallengeRecord = {
      id: nextCid,
      releaseId: release.id,
      challenger: '0x9981aa5eaa6dc6734ded7ebe060f4b8682c50777',
      claimedCategory: input.claimedCategory,
      evidenceSourceIndices: input.evidenceSourceIndices,
      statement: input.statement.trim(),
      challengeHash: 'c'.repeat(64),
      status: 'OPEN',
      createdAt: new Date().toISOString(),
    };
    return {
      ...structuredClone(release),
      status: 'CHALLENGED',
      challengeIds: [...release.challengeIds, nextCid],
      challenges: [...release.challenges, newCh],
    };
  }
  const payload = JSON.stringify({
    claimed_category: input.claimedCategory,
    evidence_source_indices: input.evidenceSourceIndices,
    statement: input.statement.trim(),
  });
  await executeContractWrite(config, 'challenge_release', [release.id, payload]);
  return loadChainReleaseById(release.id, config);
}

export function exportAttestationReceipt(release: ReleaseOrder): void {
  const payload = {
    exportedAt: new Date().toISOString(),
    policyVersion: release.policyVersion,
    releaseId: release.id,
    spec: release.spec,
    snapshot: release.snapshot,
    attestation: release.attestation,
    challenges: release.challenges,
    origin: release.origin || { mode: 'demo' },
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `skillguard-attestation-${release.spec.skillId}-${release.spec.commitSha.slice(0, 8)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// 通过浏览器钱包将已通过同区块 eth_estimateGas + eth_call 验证的 SkillGuard 合约部署至 Bradbury Phase 2 (chainId = 4221)
export async function deployBradburyContractViaWallet(): Promise<{
  envelopeHash: string;
  protocolTxId: string;
  contractAddress: string;
  blockNumber: string;
}> {
  const eth = (
    window as unknown as {
      ethereum?: { request: (arg: { method: string; params?: unknown[] }) => Promise<unknown> };
    }
  ).ethereum;
  if (!eth) {
    throw new Error('No EIP-1193 browser wallet detected.');
  }
  const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
  const sender = accounts?.[0]?.toLowerCase();
  if (!sender) {
    throw new Error('Wallet returned no active account.');
  }
  const walletChainId = String(await eth.request({ method: 'eth_chainId' })).toLowerCase();
  if (walletChainId !== '0x107d') {
    await eth.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x107d' }],
    });
  }

  const res = await fetch('/bradbury-deploy-review.json', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to load pre-verified Bradbury deployment review bundle.');
  }
  const review = (await res.json()) as {
    verified: boolean;
    actor: string;
    walletTransactionRequest: Record<string, string>;
  };
  if (!review.verified || review.actor.toLowerCase() !== sender) {
    throw new Error(`Wallet ${sender} does not match locked deployer ${review.actor}.`);
  }

  const { chain, publicClient, addresses } = await verifiedBradburyChain();
  const client = createClient({ chain, endpoint: BRADBURY_CONFIG.rpcUrl });
  const liveNonce = await publicClient.getTransactionCount({
    address: sender as Address,
    blockTag: 'latest',
  });
  const txReq = {
    ...review.walletTransactionRequest,
    nonce: '0x' + BigInt(liveNonce).toString(16),
  };

  emitTx({
    stage: 'proposing',
    message: 'Opening MetaMask confirmation popup for Bradbury Phase 2 contract deployment...',
  });

  const envelopeHash = (await eth.request({
    method: 'eth_sendTransaction',
    params: [txReq],
  })) as `0x${string}`;

  emitTx({
    hash: envelopeHash,
    stage: 'committing',
    message: `Bradbury L2 envelope submitted (${envelopeHash.slice(0, 10)}…). Waiting for L2 receipt & committee finality...`,
  });

  const newTxEvent = parseAbiItem(
    'event NewTransaction(bytes32 indexed txId, address indexed recipient, address indexed activator)'
  );
  let receipt = null;
  for (let i = 0; i < 45; i++) {
    try {
      receipt = await publicClient.getTransactionReceipt({ hash: envelopeHash });
      if (receipt) break;
    } catch {
      // wait for L2 block
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!receipt || receipt.status !== 'success') {
    throw new Error('Bradbury L2 deployment envelope transaction reverted or timed out.');
  }

  let protocolTxId = '';
  let contractAddress = '';
  for (const log of receipt.logs) {
    if (log.removed || log.address.toLowerCase() !== addresses.ConsensusMain.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({
        abi: [newTxEvent],
        data: log.data,
        topics: log.topics,
        strict: true,
      });
      if (ev.eventName === 'NewTransaction') {
        protocolTxId = ev.args.txId;
        contractAddress = getAddress(ev.args.recipient);
        break;
      }
    } catch {
      // ignore other logs
    }
  }
  if (!protocolTxId || !contractAddress) {
    throw new Error('NewTransaction event not found in Bradbury deployment receipt.');
  }

  const finalTx = await client.waitForFinalization({
    hash: protocolTxId as Parameters<typeof client.waitForFinalization>[0]['hash'],
    interval: 3000,
    retries: 90,
  });
  if (!executionSucceeded(finalTx)) {
    throw new Error(`Bradbury deployment did not reach accepted finality: ${finalTx.statusName}`);
  }

  emitTx({
    hash: protocolTxId,
    stage: 'finalized',
    message: `Bradbury Phase 2 contract deployed & FINALIZED at ${contractAddress}!`,
  });

  return {
    envelopeHash,
    protocolTxId,
    contractAddress,
    blockNumber: String(receipt.blockNumber),
  };
}

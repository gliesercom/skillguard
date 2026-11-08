// 领域模型、能力评分表常量与客户端确定性校验逻辑

export const POLICY_VERSION = 'skillguard/1';
export const SNAPSHOT_VERSION = 'skillguard/evidence-snapshot/1';
export const RUBRIC_VERSION = 'skillguard/capability-rubric/1';
export const SOURCE_HOST = 'raw.githubusercontent.com';
export const MAX_SOURCE_BYTES = 16384;
export const MAX_SOURCES = 4;

export type CapabilityId =
  | 'network_access'
  | 'filesystem_write'
  | 'subprocess_exec'
  | 'secret_env_access';

export type FindingCategory =
  | 'PROMPT_INJECTION_INSTRUCTION'
  | 'UNDECLARED_CAPABILITY'
  | 'CREDENTIAL_EXFILTRATION'
  | 'REMOTE_CODE_EXECUTION'
  | 'OBFUSCATED_PAYLOAD';

export type ObservedState = 'OBSERVED' | 'NOT_OBSERVED';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Verdict = 'APPROVED' | 'WARN' | 'BLOCKED' | 'INSUFFICIENT_EVIDENCE';
export type ReleaseStatus = 'REGISTERED' | 'EVIDENCE_LOCKED' | 'CHALLENGED' | Verdict;
export type PackageType = 'mcp_server' | 'agent_skill';
export type SourceRole = 'manifest' | 'entrypoint' | 'permissions' | 'module';

export interface CapabilityDefinition {
  id: CapabilityId;
  labelEn: string;
  labelZh: string;
  questionEn: string;
  questionZh: string;
}

export const CAPABILITIES: CapabilityDefinition[] = [
  {
    id: 'network_access',
    labelEn: 'Outbound Network / HTTP Access',
    labelZh: '外部网络与 HTTP 请求访问',
    questionEn: 'Does the inspected source code perform outbound HTTP/HTTPS/WebSocket requests, open network sockets, or transmit data to external endpoints?',
    questionZh: '被审计源码是否发起外部 HTTP/HTTPS/WebSocket 请求、打开网络套接字或向外部端点传输数据？',
  },
  {
    id: 'filesystem_write',
    labelEn: 'Filesystem Write / Mutation',
    labelZh: '本地文件系统写入或修改',
    questionEn: 'Does the inspected source code write, modify, delete, or create files or directories on the host filesystem?',
    questionZh: '被审计源码是否在宿主机文件系统上写入、修改、删除或创建文件与目录？',
  },
  {
    id: 'subprocess_exec',
    labelEn: 'Subprocess / Shell / Dynamic Code Execution',
    labelZh: '子进程、Shell 命令或动态代码执行',
    questionEn: 'Does the inspected source code spawn child processes, execute shell commands, or evaluate dynamic code (eval, exec, child_process, subprocess)?',
    questionZh: '被审计源码是否派生子进程、执行 Shell 命令或运行动态代码（如 eval、exec、child_process、subprocess）？',
  },
  {
    id: 'secret_env_access',
    labelEn: 'Credentials / Private Key / Sensitive Env Access',
    labelZh: '环境变量凭据、私钥或助记词访问',
    questionEn: 'Does the inspected source code read environment variables containing secrets/keys/tokens, wallet files, seed phrases, or browser credential stores?',
    questionZh: '被审计源码是否读取含密钥/Token 的环境变量、钱包文件、助记词、私钥或浏览器凭据存储？',
  },
];

export const FINDING_CATEGORY_META: Record<
  FindingCategory,
  { labelEn: string; labelZh: string; severity: 'HIGH' | 'CRITICAL' }
> = {
  PROMPT_INJECTION_INSTRUCTION: {
    labelEn: 'Prompt Injection / Auditor Hijack Instruction',
    labelZh: '提示词注入 / 审计模型劫持指令',
    severity: 'CRITICAL',
  },
  UNDECLARED_CAPABILITY: {
    labelEn: 'Undeclared System Capability Usage',
    labelZh: '使用未声明的系统敏感权限',
    severity: 'HIGH',
  },
  CREDENTIAL_EXFILTRATION: {
    labelEn: 'Credential / Private Key Exfiltration',
    labelZh: '凭据、私钥或助记词窃取外传',
    severity: 'CRITICAL',
  },
  REMOTE_CODE_EXECUTION: {
    labelEn: 'Arbitrary Command / Remote Code Execution',
    labelZh: '任意命令或远程代码执行',
    severity: 'CRITICAL',
  },
  OBFUSCATED_PAYLOAD: {
    labelEn: 'Obfuscated Payload / Covert Telemetry',
    labelZh: '混淆载荷或隐蔽遥测后门',
    severity: 'CRITICAL',
  },
};

export interface PinnedSource {
  path: string;
  role: SourceRole;
  url: string;
  sha256: string;
  byteLength: number;
  contentPreview?: string;
}

export type DeclaredPermissions = Record<CapabilityId, boolean>;

export interface ReleaseSpec {
  skillId: string;
  title: string;
  packageType: PackageType;
  repo: string;
  commitSha: string;
  version: string;
  rubricVersion: string;
  declaredPermissions: DeclaredPermissions;
  scopeSummary: string;
  sources: PinnedSource[];
}

export interface SourceCheckRecord {
  index: number;
  path: string;
  status: 'VERIFIED' | 'UNAVAILABLE' | 'TOO_LARGE' | 'HASH_MISMATCH' | 'INVALID_ENCODING';
  sha256: string;
  byteLength: number;
}

export interface StaticSignal {
  code: string;
  sourceIndex: number;
}

export interface EvidenceSnapshotRecord {
  snapshotVersion: string;
  snapshotHash: string;
  sourceChecks: SourceCheckRecord[];
  staticSignals: StaticSignal[];
  materials: (string | null)[];
  allVerified: boolean;
}

export interface CapabilityCheckRecord {
  capabilityId: CapabilityId;
  state: ObservedState;
  evidenceIndices: number[];
}

export interface AttestationRecord {
  releaseId: number;
  skillId: string;
  repo: string;
  commitSha: string;
  specHash: string;
  snapshotHash: string;
  policyVersion: string;
  rubricVersion: string;
  auditRound: number;
  capabilityChecks: CapabilityCheckRecord[];
  undeclaredCapabilities: CapabilityId[];
  findingCategories: FindingCategory[];
  staticSignals: StaticSignal[];
  declaredVsActualMismatch: boolean;
  riskLevel: RiskLevel;
  verdict: Verdict;
  summary: string;
  evaluatedChallengeIds: number[];
  resolvedChallengeIds: number[];
  sourceChecks: SourceCheckRecord[];
  auditedAt: string;
  scopeDisclaimer: string;
  mode?: 'demo' | 'live';
}

export interface ChallengeRecord {
  id: number;
  releaseId: number;
  challenger: string;
  claimedCategory: FindingCategory;
  evidenceSourceIndices: number[];
  statement: string;
  challengeHash: string;
  status: 'OPEN' | 'UPHELD' | 'REJECTED';
  resolvedRound?: number;
  resolvedVerdict?: Verdict;
  createdAt: string;
}

export interface ReleaseOrder {
  id: number;
  submitter: string;
  spec: ReleaseSpec;
  specHash: string;
  policyVersion: string;
  status: ReleaseStatus;
  auditRound: number;
  challengeIds: number[];
  createdAt: string;
  snapshot?: EvidenceSnapshotRecord;
  attestation?: AttestationRecord;
  challenges: ChallengeRecord[];
  origin?: {
    network: string;
    chainId: number;
    contractAddress: string;
  };
}

export interface ConnectionConfig {
  mode: 'demo' | 'live';
  rpcUrl: string;
  contractAddress: string;
}

// 构造固定 commit 的 raw.githubusercontent.com URL
export function buildPinnedRawUrl(repo: string, commitSha: string, path: string): string {
  const cleanRepo = repo.trim().replace(/^\/+|\/+$/g, '');
  const cleanSha = commitSha.trim().toLowerCase();
  const cleanPath = path.trim().replace(/^\/+/, '');
  return `https://raw.githubusercontent.com/${cleanRepo}/${cleanSha}/${cleanPath}`;
}

// 校验固定 commit 源码 URL
export function validatePinnedUrl(url: string, repo?: string, commitSha?: string): string {
  const trimmed = url.trim();
  const match = /^https:\/\/raw\.githubusercontent\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/([0-9a-f]{40})\/([A-Za-z0-9_./-]+)$/.exec(trimmed);
  if (!match) {
    throw new Error('Source URL must follow https://raw.githubusercontent.com/<owner>/<repo>/<40-hex-commit>/<path>');
  }
  if (repo && match[1].toLowerCase() !== repo.trim().toLowerCase()) {
    throw new Error('Source URL repository does not match declared repo');
  }
  if (commitSha && match[2] !== commitSha.trim().toLowerCase()) {
    throw new Error('Source URL commit SHA does not match declared commit_sha');
  }
  return trimmed;
}

// 确定性静态提示词注入扫描（与合约 Python 规则对齐）
const STATIC_PATTERNS: Array<{ code: string; regex: RegExp }> = [
  { code: 'PROMPT_INJECTION_IGNORE', regex: /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/i },
  { code: 'PROMPT_INJECTION_OVERRIDE', regex: /disregard\s+(?:all\s+)?(?:previous|prior|system)\s+(?:instructions|prompts|rules)/i },
  { code: 'PROMPT_INJECTION_FAKE_SAFE', regex: /you\s+must\s+output\s+["']?(?:low|approved|safe)["']?/i },
  { code: 'PROMPT_INJECTION_SYSTEM_TAG', regex: /<\s*\/?\s*system\s*>/i },
];

export function scanStaticSignals(materials: (string | null)[]): StaticSignal[] {
  const signals: StaticSignal[] = [];
  materials.forEach((content, index) => {
    if (typeof content !== 'string') return;
    for (const item of STATIC_PATTERNS) {
      if (item.regex.test(content)) {
        signals.push({ code: item.code, sourceIndex: index });
      }
    }
  });
  return signals;
}

// 根据能力观测与静态注入信号确定性推导风险等级与裁决（与合约 derive_risk_and_verdict 完全一致）
export function deriveRiskAndVerdict(
  declaredPermissions: DeclaredPermissions,
  capabilityChecks: CapabilityCheckRecord[],
  findingCategories: FindingCategory[],
  staticSignals: StaticSignal[]
): {
  undeclaredCapabilities: CapabilityId[];
  findingCategories: FindingCategory[];
  declaredVsActualMismatch: boolean;
  riskLevel: RiskLevel;
  verdict: Verdict;
} {
  const undeclared: CapabilityId[] = [];
  for (const check of capabilityChecks) {
    if (check.state === 'OBSERVED' && !declaredPermissions[check.capabilityId]) {
      undeclared.push(check.capabilityId);
    }
  }
  const catSet = new Set<FindingCategory>(findingCategories);
  if (staticSignals.length > 0) catSet.add('PROMPT_INJECTION_INSTRUCTION');
  if (undeclared.length > 0) catSet.add('UNDECLARED_CAPABILITY');

  const orderedCategories: FindingCategory[] = (
    [
      'PROMPT_INJECTION_INSTRUCTION',
      'UNDECLARED_CAPABILITY',
      'CREDENTIAL_EXFILTRATION',
      'REMOTE_CODE_EXECUTION',
      'OBFUSCATED_PAYLOAD',
    ] as FindingCategory[]
  ).filter((c) => catSet.has(c));

  const criticalSet = new Set<FindingCategory>([
    'CREDENTIAL_EXFILTRATION',
    'REMOTE_CODE_EXECUTION',
    'OBFUSCATED_PAYLOAD',
    'PROMPT_INJECTION_INSTRUCTION',
  ]);
  const hasCriticalCat = orderedCategories.some((c) => criticalSet.has(c));

  let riskLevel: RiskLevel;
  let verdict: Verdict;

  if (
    hasCriticalCat ||
    undeclared.includes('subprocess_exec') ||
    undeclared.includes('secret_env_access')
  ) {
    riskLevel = 'CRITICAL';
    verdict = 'BLOCKED';
  } else if (undeclared.length > 0) {
    riskLevel = 'HIGH';
    verdict = 'BLOCKED';
  } else if (
    capabilityChecks.some(
      (c) =>
        c.state === 'OBSERVED' &&
        ['subprocess_exec', 'secret_env_access', 'filesystem_write'].includes(c.capabilityId)
    )
  ) {
    riskLevel = 'MEDIUM';
    verdict = 'WARN';
  } else {
    riskLevel = 'LOW';
    verdict = 'APPROVED';
  }

  return {
    undeclaredCapabilities: undeclared,
    findingCategories: orderedCategories,
    declaredVsActualMismatch: undeclared.length > 0,
    riskLevel,
    verdict,
  };
}

// 生成可嵌入 README 的 SVG 徽章与 Markdown 代码
export function generateShieldBadgeMarkdown(release: ReleaseOrder): {
  markdown: string;
  cliCommand: string;
  mcpConfigJson: string;
} {
  const verdict = release.attestation?.verdict || release.status;
  const risk = release.attestation?.riskLevel || 'UNVERIFIED';
  const color =
    verdict === 'APPROVED'
      ? '10b981'
      : verdict === 'WARN'
      ? 'f59e0b'
      : verdict === 'BLOCKED'
      ? 'ef4444'
      : '64748b';
  const shortSha = release.spec.commitSha.slice(0, 8);
  const badgeUrl = `https://img.shields.io/badge/SkillGuard-${encodeURIComponent(
    `${verdict}_${risk}_${shortSha}`
  )}-${color}?style=flat-square`;
  const markdown = `[![SkillGuard Attestation](${badgeUrl})](https://github.com/${release.spec.repo}/tree/${release.spec.commitSha})`;
  const cliCommand = `npx skillguard check ${release.spec.repo}@${release.spec.commitSha}`;
  const mcpConfigJson = JSON.stringify(
    {
      mcpServers: {
        skillguard: {
          command: 'node',
          args: ['./cli/mcp-server.mjs'],
          env: {
            SKILLGUARD_RPC_URL: release.origin?.network === 'bradbury-phase-2'
              ? 'https://rpc-bradbury.genlayer.com'
              : 'https://studio-dev.genlayer.com/api',
            SKILLGUARD_CONTRACT_ADDRESS: release.origin?.contractAddress || '0xYourSkillGuardContract',
          },
        },
      },
    },
    null,
    2
  );
  return { markdown, cliCommand, mcpConfigJson };
}

// 双语（英文默认 EN / 简体中文 ZH）文案与状态本地化模块

import {
  CAPABILITIES,
  FINDING_CATEGORY_META,
  type CapabilityId,
  type FindingCategory,
} from './domain';

export type Language = 'en' | 'zh';
const LANG_STORAGE_KEY = 'sg:lang:v1';

export function getLanguage(): Language {
  if (typeof window === 'undefined') return 'en';
  try {
    const saved = window.localStorage.getItem(LANG_STORAGE_KEY);
    return saved === 'zh' ? 'zh' : 'en';
  } catch {
    return 'en';
  }
}

export function setLanguage(lang: Language): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      // ignore storage errors
    }
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
  }
}

export function getCapabilityLabel(id: CapabilityId, lang: Language): string {
  const found = CAPABILITIES.find((item) => item.id === id);
  if (!found) return id;
  return lang === 'zh' ? found.labelZh : found.labelEn;
}

export function getCapabilityQuestion(id: CapabilityId, lang: Language): string {
  const found = CAPABILITIES.find((item) => item.id === id);
  if (!found) return id;
  return lang === 'zh' ? found.questionZh : found.questionEn;
}

export function getFindingCategoryLabel(cat: FindingCategory, lang: Language): string {
  const meta = FINDING_CATEGORY_META[cat];
  if (!meta) return cat;
  return lang === 'zh' ? meta.labelZh : meta.labelEn;
}

export function formatVerdictLabel(verdict: string | undefined, lang: Language): string {
  if (!verdict) return lang === 'zh' ? '待审计' : 'PENDING AUDIT';
  const mapEn: Record<string, string> = {
    REGISTERED: 'REGISTERED',
    EVIDENCE_LOCKED: 'SNAPSHOT LOCKED',
    CHALLENGED: 'CHALLENGED · RE-AUDIT DUE',
    APPROVED: 'APPROVED · VERIFIED CLEAN',
    WARN: 'WARN · DECLARED PRIVILEGE',
    BLOCKED: 'BLOCKED · HIGH RISK',
    INSUFFICIENT_EVIDENCE: 'INSUFFICIENT EVIDENCE',
  };
  const mapZh: Record<string, string> = {
    REGISTERED: '已登记待锁快照',
    EVIDENCE_LOCKED: '快照已锁定待审计',
    CHALLENGED: '被挑战 · 待重审',
    APPROVED: '认证通过 · 低风险',
    WARN: '风险提示 · 已声明敏感权限',
    BLOCKED: '拦截阻断 · 高危/权限越界',
    INSUFFICIENT_EVIDENCE: '证据不足 / 哈希不匹配',
  };
  return (lang === 'zh' ? mapZh[verdict] : mapEn[verdict]) || verdict;
}

export function formatRiskLabel(risk: string | undefined, lang: Language): string {
  if (!risk) return lang === 'zh' ? '未评级' : 'UNRATED';
  const mapZh: Record<string, string> = {
    LOW: '低风险 (LOW)',
    MEDIUM: '中等风险 (MEDIUM)',
    HIGH: '高风险 (HIGH)',
    CRITICAL: '严重高危 (CRITICAL)',
  };
  return lang === 'zh' ? mapZh[risk] || risk : `${risk} RISK`;
}

export const UI_TEXT = {
  en: {
    pageTitle: 'SkillGuard · Decentralized MCP & Agent Skill Security Registry',
    sidebarCaption: 'AGENT SUPPLY-CHAIN ATTESTATION',
    navRegistry: 'Attestation Registry',
    navRegister: 'Register Release',
    navSdk: 'CLI & MCP Guard',
    navSettings: 'Network & Contract',
    sidebarCalloutTitle: 'Commit-Pinned & Multi-LLM Audited',
    sidebarCalloutBody:
      'Every attestation binds a 40-hex Git commit SHA and exact SHA-256 source bytes before multi-model Optimistic Democracy review.',
    langSwitchLabel: 'EN / 中文',
    langSwitchTitle: 'Switch between English and Simplified Chinese',
    modeDemo: 'Local Demo Sandbox',
    modeLive: 'GenLayer Live Chain',
    btnDevAccountCreate: 'Get Studio Test Account',
    btnDevAccountReady: 'Studio Test Signer Ready',
    btnConnectWallet: 'Connect Wallet',
    heroEyebrow: 'DECENTRALIZED AGENT SECURITY LAYER',
    heroTitle: 'Verify MCP Servers & Agent Skills Before They Touch Your Keys.',
    heroSubtitle:
      'SkillGuard locks commit-pinned GitHub source snapshots on GenLayer, runs prompt-injection static screening + multi-LLM capability consensus, and lets anyone challenge suspicious releases.',
    btnHeroRegister: 'Register Skill / MCP Release',
    btnHeroCli: 'Integrate Pre-Install Guard',
    statReleasesLabel: 'Tracked Releases',
    statReleasesSubDemo: 'Curated supply-chain cases',
    statReleasesSubLive: 'On-chain registered releases',
    statApprovedLabel: 'Verified Approved',
    statApprovedSub: 'Zero undeclared capabilities',
    statBlockedLabel: 'Blocked / Challenged',
    statBlockedSub: 'Injection or privilege mismatch caught',
    searchPlaceholder: 'Lookup by Release ID or repo@commit...',
    btnLookup: 'Lookup',
    tabMatrix: 'Capability Matrix',
    tabSources: 'Pinned Sources & Snapshot',
    tabChallenges: 'Challenges & Dispute',
    tabIntegrate: 'Badge, CLI & MCP Guard',
    stage1Btn: 'Step 1 · Lock Pinned Source Snapshot',
    stage2Btn: 'Step 2 · Run Consensus Security Audit',
    stageReauditBtn: 'Run Challenge Re-Audit',
    btnExportAttestation: 'Export Attestation JSON',
    btnChallengeModal: 'Submit Security Challenge',
    declaredCol: 'Declared by Publisher',
    observedCol: 'Consensus Observed',
    statusCol: 'Match Status',
    matchOk: 'COMPLIANT',
    matchViolation: 'UNDECLARED VIOLATION',
    staticInjectionTitle: 'Deterministic Prompt-Injection Guard Triggered',
    staticInjectionClean: 'Zero static prompt-injection patterns detected in locked source bytes.',
    registerTitle: 'Register Commit-Pinned MCP / Skill Release',
    registerSubtitle:
      'Bind your repository, 40-character commit SHA, declared capability matrix, and exact raw.githubusercontent.com file SHA-256 digests.',
    btnFillLiveTemplate: 'Fill Verified OpenZeppelin Pinned Template',
    btnComputeSha: 'Fetch & Hash Raw GitHub Bytes',
    btnSubmitRegister: 'Register Release on SkillGuard',
    challengeModalTitle: 'Challenge Release Attestation',
    challengeModalSub:
      'Cite specific source file indices and threat category to escalate this release into a new multi-model re-audit round.',
    btnSubmitChallenge: 'Submit Challenge',
    cliPageTitle: 'Pre-Install CLI & Self-Protecting MCP Server',
    cliPageSubtitle:
      'Stop autonomous agents from installing unverified or backdoored skills. Query SkillGuard directly from your terminal or inside Claude / Cursor / Antigravity.',
    settingsTitle: 'GenLayer Network & Contract Configuration',
    settingsSubtitle:
      'Switch between the deterministic local sandbox, GenLayer Studio-dev simulator, or public Testnet Bradbury Phase 2.',
    btnSaveSettings: 'Save Configuration',
  },
  zh: {
    pageTitle: 'SkillGuard · AI 智能体技能与 MCP 服务器去中心化安全认证注册表',
    sidebarCaption: '智能体供应链安全认证',
    navRegistry: '安全认证注册表',
    navRegister: '登记新版本审计',
    navSdk: 'CLI 与 MCP 防护接入',
    navSettings: '网络与合约配置',
    sidebarCalloutTitle: 'Commit 锁定 + 多模型共识审计',
    sidebarCalloutBody:
      '每份认证均先锁定 40 位 Git Commit SHA 与原始字节 SHA-256 快照，再由多模型乐观民主共识裁决，支持公开挑战重审。',
    langSwitchLabel: '中文 / EN',
    langSwitchTitle: '切换简体中文与英文界面',
    modeDemo: '本地演练沙箱',
    modeLive: 'GenLayer 链上模式',
    btnDevAccountCreate: '创建 Studio 临时测试账户',
    btnDevAccountReady: 'Studio 测试签名账户已就绪',
    btnConnectWallet: '连接钱包',
    heroEyebrow: '去中心化智能体供应链安全层',
    heroTitle: '在 MCP 与智能体技能接触你的私钥前，先验明正身。',
    heroSubtitle:
      'SkillGuard 在 GenLayer 链上锁定不可篡改的 GitHub 源码快照，结合确定性提示词注入扫描与多模型能力边界共识，支持任何人发起带证据挑战。',
    btnHeroRegister: '登记技能 / MCP 版本',
    btnHeroCli: '接入安装前自动拦截',
    statReleasesLabel: '已收录版本数',
    statReleasesSubDemo: '内置供应链正反典型样本',
    statReleasesSubLive: '链上已注册版本记录',
    statApprovedLabel: '认证通过 (APPROVED)',
    statApprovedSub: '无未声明越权能力',
    statBlockedLabel: '已阻断 / 挑战存疑',
    statBlockedSub: '捕获注入指令或越权窃密行为',
    searchPlaceholder: '输入版本编号 ID 或 owner/repo@commit 查询...',
    btnLookup: '链上查询',
    tabMatrix: '权限与能力对比矩阵',
    tabSources: '固定 Commit 源码与快照',
    tabChallenges: '安全挑战与重审记录',
    tabIntegrate: '徽章、CLI 与 MCP 接入',
    stage1Btn: '第一步 · 锁定 GitHub 源码哈希快照',
    stage2Btn: '第二步 · 执行多模型共识安全审计',
    stageReauditBtn: '执行挑战后重新审计',
    btnExportAttestation: '导出链上认证回执 JSON',
    btnChallengeModal: '发起安全挑战 (Challenge)',
    declaredCol: '发布者声明权限',
    observedCol: '多模型共识实测',
    statusCol: '合规状态',
    matchOk: '符合声明',
    matchViolation: '未声明越权 (VIOLATION)',
    staticInjectionTitle: '确定性静态提示词注入防线已触发',
    staticInjectionClean: '已锁定源码字节中未检出静态提示词注入或审计劫持模式。',
    registerTitle: '登记固定 Commit 的 MCP / 智能体技能版本',
    registerSubtitle:
      '锁定 GitHub 仓库、40 位完整 Commit SHA、声明权限矩阵以及 raw.githubusercontent.com 源码文件的精确 SHA-256 摘要。',
    btnFillLiveTemplate: '一键填入 OpenZeppelin 真实固定源码模板',
    btnComputeSha: '拉取 GitHub 原始字节并计算 SHA-256',
    btnSubmitRegister: '提交版本登记',
    challengeModalTitle: '对当前版本认证发起安全挑战',
    challengeModalSub:
      '指出具体高危代码所在源文件下标与威胁类别，将该版本置为 CHALLENGED 状态并触发新一轮多模型重审。',
    btnSubmitChallenge: '提交链上挑战',
    cliPageTitle: '安装前 CLI 检查器与自保护 MCP 服务器',
    cliPageSubtitle:
      '防止智能体自动安装带后门或未认证插件。支持终端一行命令核验，或作为 MCP 工具供 Claude / Cursor / Antigravity 在安装前自检。',
    settingsTitle: 'GenLayer 网络与智能合约接入设置',
    settingsSubtitle:
      '支持在本地确定性沙箱、官方 Studio-dev 模拟开发网与 Bradbury Phase 2 公共测试网之间无缝切换。',
    btnSaveSettings: '保存接入设置',
  },
} as const;

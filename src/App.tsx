import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Plus,
  Terminal,
  Settings,
  Search,
  ExternalLink,
  Download,
  RefreshCw,
  Lock,
  AlertTriangle,
  Copy,
  Check,
  Wallet,
  Sparkles,
} from 'lucide-react';
import {
  CAPABILITIES,
  FINDING_CATEGORY_META,
  RUBRIC_VERSION,
  buildPinnedRawUrl,
  generateShieldBadgeMarkdown,
  validatePinnedUrl,
  type CapabilityId,
  type ConnectionConfig,
  type FindingCategory,
  type PinnedSource,
  type ReleaseOrder,
  type ReleaseSpec,
} from './lib/domain';
import { DEMO_LOCALIZED_META, buildPublicLiveTemplateSpec } from './lib/demo';
import {
  UI_TEXT,
  formatRiskLabel,
  formatVerdictLabel,
  getCapabilityLabel,
  getCapabilityQuestion,
  getFindingCategoryLabel,
  getLanguage,
  setLanguage,
  type Language,
} from './lib/i18n';
import {
  BRADBURY_CONFIG,
  connectBrowserWallet,
  connectStudioDevAccount,
  deployBradburyContractViaWallet,
  exportAttestationReceipt,
  getSavedConfig,
  getStudioSessionAddress,
  listReleases,
  loadChainReleaseById,
  lockReleaseEvidence,
  registerReleaseOrder,
  runReleaseConsensusAudit,
  saveConnectionConfig,
  submitReleaseChallenge,
  subscribeTxLifecycle,
  type TxLifecycleEvent,
} from './lib/live';
import deployment from './deployment.json';
import './App.css';

type NavPage = 'registry' | 'register' | 'sdk' | 'settings';
type DetailTab = 'matrix' | 'sources' | 'challenges' | 'integrate';

const shortenHex = (value: string, head = 8, tail = 6) =>
  value && value.length > head + tail + 2 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;

const badgeClassForStatus = (status?: string) => {
  if (status === 'APPROVED') return 'approved';
  if (status === 'WARN') return 'warn';
  if (status === 'BLOCKED' || status === 'INSUFFICIENT_EVIDENCE' || status === 'CHALLENGED') {
    return 'blocked';
  }
  return 'neutral';
};

const emptySourceDraft = (): PinnedSource => ({
  path: 'src/index.ts',
  role: 'entrypoint',
  url: '',
  sha256: '',
  byteLength: 0,
});

const emptyReleaseDraft = (): ReleaseSpec => ({
  skillId: '',
  title: '',
  packageType: 'mcp_server',
  repo: '',
  commitSha: '',
  version: '1.0.0',
  rubricVersion: RUBRIC_VERSION,
  declaredPermissions: {
    network_access: false,
    filesystem_write: false,
    subprocess_exec: false,
    secret_env_access: false,
  },
  scopeSummary: '',
  sources: [emptySourceDraft()],
});

export default function App() {
  const [lang, setLangState] = useState<Language>(() => getLanguage());
  const t = UI_TEXT[lang];

  const [page, setPage] = useState<NavPage>('registry');
  const [tab, setTab] = useState<DetailTab>('matrix');
  const [config, setConfig] = useState<ConnectionConfig>(() => getSavedConfig());
  const [settingsDraft, setSettingsDraft] = useState<ConnectionConfig>(() => getSavedConfig());

  const [releases, setReleases] = useState<ReleaseOrder[]>([]);
  const [selectedId, setSelectedId] = useState<number>(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [walletAddr, setWalletAddr] = useState<string>('');

  const [busyMessage, setBusyMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [noticeMessage, setNoticeMessage] = useState('');
  const [txEvent, setTxEvent] = useState<TxLifecycleEvent | null>(null);
  const [copiedKey, setCopiedKey] = useState('');

  // 新版本登记表单状态
  const [draft, setDraft] = useState<ReleaseSpec>(() => buildPublicLiveTemplateSpec());

  // 挑战弹窗状态
  const [showChallengeModal, setShowChallengeModal] = useState(false);
  const [challengeCategory, setChallengeCategory] = useState<FindingCategory>('CREDENTIAL_EXFILTRATION');
  const [challengeStatement, setChallengeStatement] = useState('');
  const [challengeIndices, setChallengeIndices] = useState<number[]>([0]);

  useEffect(() => {
    setLanguage(lang);
    document.title = t.pageTitle;
  }, [lang, t.pageTitle]);

  useEffect(() => subscribeTxLifecycle((ev) => setTxEvent(ev)), []);

  useEffect(() => {
    let cancelled = false;
    setBusyMessage(lang === 'zh' ? '正在加载安全认证注册表...' : 'Loading SkillGuard registry...');
    listReleases(config)
      .then((items) => {
        if (cancelled) return;
        setReleases(items);
        if (items.length > 0) setSelectedId(items[0].id);
      })
      .catch((err) => {
        if (!cancelled) setErrorMessage(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setBusyMessage('');
      });
    return () => {
      cancelled = true;
    };
  }, [config]);

  const filteredReleases = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return releases;
    return releases.filter(
      (r) =>
        String(r.id) === q ||
        r.spec.skillId.toLowerCase().includes(q) ||
        r.spec.title.toLowerCase().includes(q) ||
        `${r.spec.repo}@${r.spec.commitSha}`.toLowerCase().includes(q)
    );
  }, [releases, searchQuery]);

  const selected = useMemo(
    () => releases.find((r) => r.id === selectedId) || filteredReleases[0] || null,
    [releases, selectedId, filteredReleases]
  );

  const stats = useMemo(() => {
    const approved = releases.filter((r) => r.status === 'APPROVED').length;
    const blocked = releases.filter(
      (r) => r.status === 'BLOCKED' || r.status === 'CHALLENGED' || r.status === 'INSUFFICIENT_EVIDENCE'
    ).length;
    return { total: releases.length, approved, blocked };
  }, [releases]);

  function toggleLang() {
    const next: Language = lang === 'en' ? 'zh' : 'en';
    setLanguage(next);
    setLangState(next);
  }

  function upsertRelease(updated: ReleaseOrder) {
    setReleases((prev) => {
      const exists = prev.some((item) => item.id === updated.id);
      return exists ? prev.map((item) => (item.id === updated.id ? updated : item)) : [updated, ...prev];
    });
    setSelectedId(updated.id);
  }

  async function runAction(label: string, fn: () => Promise<void>) {
    setErrorMessage('');
    setNoticeMessage('');
    setBusyMessage(label);
    try {
      await fn();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyMessage('');
    }
  }

  async function handleConnectWallet() {
    await runAction(lang === 'zh' ? '正在连接浏览器钱包...' : 'Connecting wallet...', async () => {
      const addr = await connectBrowserWallet();
      setWalletAddr(addr);
      setNoticeMessage(
        lang === 'zh'
          ? `钱包已连接：${shortenHex(addr, 6, 4)}`
          : `Connected wallet ${shortenHex(addr, 6, 4)}`
      );
    });
  }

  async function handleInitStudioAccount() {
    await runAction(
      lang === 'zh' ? '正在初始化 Studio-dev 临时测试签名账户...' : 'Initializing Studio-dev ephemeral signer...',
      async () => {
        const addr = await connectStudioDevAccount(config);
        setWalletAddr(addr);
        setNoticeMessage(
          lang === 'zh'
            ? `Studio-dev 临时测试账户已就绪：${shortenHex(addr, 8, 6)}`
            : `Studio-dev test signer ready: ${shortenHex(addr, 8, 6)}`
        );
      }
    );
  }

  async function handleLookupSubmit(e: FormEvent) {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q || config.mode === 'demo') return;
    const idNum = Number(q);
    if (Number.isInteger(idNum) && idNum > 0) {
      await runAction(
        lang === 'zh' ? `正在从链上读取版本 #${idNum}...` : `Loading release #${idNum} from GenLayer...`,
        async () => {
          const order = await loadChainReleaseById(idNum, config);
          upsertRelease(order);
          setNoticeMessage(
            lang === 'zh' ? `已从链上加载版本 #${idNum}。` : `Loaded release #${idNum} from chain.`
          );
        }
      );
    }
  }

  async function handleHashSourceFile(index: number) {
    const src = draft.sources[index];
    if (!src) return;
    await runAction(
      lang === 'zh'
        ? '正在拉取 GitHub 原始字节并计算 SHA-256...'
        : 'Fetching raw GitHub bytes & computing SHA-256...',
      async () => {
        const autoUrl =
          src.url.trim() ||
          (draft.repo && draft.commitSha && src.path
            ? buildPinnedRawUrl(draft.repo, draft.commitSha, src.path)
            : '');
        const validUrl = validatePinnedUrl(autoUrl, draft.repo || undefined, draft.commitSha || undefined);
        const res = await fetch(validUrl, { credentials: 'omit', redirect: 'error' });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} when fetching ${validUrl}`);
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.byteLength === 0 || buf.byteLength > 16384) {
          throw new Error(`File size (${buf.byteLength} bytes) must be between 1 and 16,384 bytes.`);
        }
        const hashBuf = await crypto.subtle.digest('SHA-256', buf);
        const sha256 = Array.from(new Uint8Array(hashBuf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        const preview = new TextDecoder('utf-8').decode(buf).slice(0, 600);
        setDraft((prev) => ({
          ...prev,
          sources: prev.sources.map((item, i) =>
            i === index
              ? { ...item, url: validUrl, sha256, byteLength: buf.byteLength, contentPreview: preview }
              : item
          ),
        }));
        setNoticeMessage(
          lang === 'zh'
            ? `已计算 SHA-256（${shortenHex(sha256, 12, 8)}，共 ${buf.byteLength} 字节）。`
            : `Computed SHA-256 (${shortenHex(sha256, 12, 8)}, ${buf.byteLength} bytes).`
        );
      }
    );
  }

  async function handleRegisterSubmit(e: FormEvent) {
    e.preventDefault();
    await runAction(
      lang === 'zh' ? '正在向 SkillGuard 登记新版本...' : 'Registering release on SkillGuard...',
      async () => {
        const created = await registerReleaseOrder(draft, releases, config);
        upsertRelease(created);
        setPage('registry');
        setTab('sources');
        setNoticeMessage(
          lang === 'zh'
            ? `版本 #${created.id} 已登记！请点击底部按钮执行【第一步：锁定源码哈希快照】。`
            : `Release #${created.id} registered! Proceed to Step 1: Lock Pinned Source Snapshot.`
        );
      }
    );
  }

  async function handleLockEvidence() {
    if (!selected) return;
    await runAction(
      lang === 'zh'
        ? '正在锁定固定 Commit 的 GitHub 快照并扫描静态提示词注入信号...'
        : 'Locking commit-pinned GitHub snapshot & scanning static signals...',
      async () => {
        const updated = await lockReleaseEvidence(selected, config);
        upsertRelease(updated);
        setTab('sources');
        setNoticeMessage(
          lang === 'zh'
            ? '源码快照已不可变锁定！现在可执行【第二步：多模型共识安全审计】。'
            : 'Immutable source snapshot locked! Proceed to Step 2: Run Consensus Security Audit.'
        );
      }
    );
  }

  async function handleAuditRelease() {
    if (!selected) return;
    await runAction(
      lang === 'zh'
        ? '正在执行多模型乐观民主（Optimistic Democracy）共识安全审计...'
        : 'Running multi-LLM Optimistic Democracy security audit...',
      async () => {
        const updated = await runReleaseConsensusAudit(selected, config);
        upsertRelease(updated);
        setTab('matrix');
        setNoticeMessage(
          lang === 'zh'
            ? `审计完成：最终裁决 ${updated.status}（风险等级 ${updated.attestation?.riskLevel}）。`
            : `Consensus audit finalized: Verdict ${updated.status} (${updated.attestation?.riskLevel} Risk).`
        );
      }
    );
  }

  async function handleChallengeSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    await runAction(
      lang === 'zh' ? '正在提交链上安全挑战...' : 'Submitting security challenge...',
      async () => {
        const updated = await submitReleaseChallenge(
          selected,
          {
            claimedCategory: challengeCategory,
            evidenceSourceIndices: challengeIndices.length ? challengeIndices : [0],
            statement: challengeStatement,
          },
          config
        );
        upsertRelease(updated);
        setShowChallengeModal(false);
        setChallengeStatement('');
        setTab('challenges');
        setNoticeMessage(
          lang === 'zh'
            ? '挑战已登记上链，状态已变更为 CHALLENGED，请点击底部按钮触发重审！'
            : 'Challenge recorded! Status is now CHALLENGED — click Run Challenge Re-Audit below.'
        );
      }
    );
  }

  function handleSaveSettings(e: FormEvent) {
    e.preventDefault();
    saveConnectionConfig(settingsDraft);
    setConfig(settingsDraft);
    setPage('registry');
    setNoticeMessage(
      settingsDraft.mode === 'demo'
        ? lang === 'zh'
          ? '已切换至本地确定性演练沙箱。'
          : 'Switched to Local Demo Sandbox.'
        : lang === 'zh'
        ? `已连接至 GenLayer 链上 RPC（${settingsDraft.rpcUrl}）。`
        : `Connected to GenLayer Live RPC (${settingsDraft.rpcUrl}).`
    );
  }

  function copyText(key: string, value: string) {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(''), 1800);
  }

  const integrationSnippets = useMemo(
    () => (selected ? generateShieldBadgeMarkdown(selected) : null),
    [selected]
  );

  return (
    <div className="sg-layout">
      <aside className="sg-sidebar">
        <div>
          <div className="sg-brand">
            <div className="sg-brand-mark">
              <Shield size={21} />
            </div>
            <div>
              <div className="sg-brand-title">
                Skill<span>Guard</span>
              </div>
              <span className="sg-brand-sub">GENLAYER ATTESTATION</span>
            </div>
          </div>

          <div className="sg-side-caption">{t.sidebarCaption}</div>
          <nav className="sg-nav">
            <button
              className={page === 'registry' ? 'active' : ''}
              onClick={() => setPage('registry')}
            >
              <ShieldCheck size={18} />
              <span>{t.navRegistry}</span>
            </button>
            <button
              className={page === 'register' ? 'active' : ''}
              onClick={() => setPage('register')}
            >
              <Plus size={18} />
              <span>{t.navRegister}</span>
            </button>
            <button className={page === 'sdk' ? 'active' : ''} onClick={() => setPage('sdk')}>
              <Terminal size={18} />
              <span>{t.navSdk}</span>
            </button>
            <button
              className={page === 'settings' ? 'active' : ''}
              onClick={() => {
                setSettingsDraft(config);
                setPage('settings');
              }}
            >
              <Settings size={18} />
              <span>{t.navSettings}</span>
            </button>
          </nav>
        </div>

        <div className="sg-side-callout">
          <strong>{t.sidebarCalloutTitle}</strong>
          <span>{t.sidebarCalloutBody}</span>
        </div>
      </aside>

      <main className="sg-main">
        <header className="sg-topbar">
          <div className="sg-breadcrumb">
            <span>SKILLGUARD</span>
            <span>/</span>
            <b>
              {page === 'registry'
                ? t.navRegistry
                : page === 'register'
                ? t.navRegister
                : page === 'sdk'
                ? t.navSdk
                : t.navSettings}
            </b>
          </div>

          <div className="sg-top-actions">
            <button className="sg-btn" title={t.langSwitchTitle} onClick={toggleLang}>
              <span>{t.langSwitchLabel}</span>
            </button>

            <button
              className="sg-mode-pill"
              onClick={() => {
                setSettingsDraft(config);
                setPage('settings');
              }}
            >
              <span className={`sg-dot ${config.mode === 'demo' ? 'demo' : ''}`} />
              <span>{config.mode === 'demo' ? t.modeDemo : t.modeLive}</span>
            </button>

            {config.mode === 'live' &&
              config.rpcUrl.replace(/\/$/, '') === 'https://studio-dev.genlayer.com/api' && (
                <button
                  className="sg-btn"
                  disabled={!!busyMessage}
                  onClick={handleInitStudioAccount}
                >
                  <Sparkles size={15} />
                  <span>
                    {getStudioSessionAddress() ? t.btnDevAccountReady : t.btnDevAccountCreate}
                  </span>
                </button>
              )}

            <button className="sg-btn" disabled={!!busyMessage} onClick={handleConnectWallet}>
              <Wallet size={15} />
              <span>{walletAddr ? shortenHex(walletAddr, 6, 4) : t.btnConnectWallet}</span>
            </button>
          </div>
        </header>

        <div className="sg-content">
          {txEvent && (
            <div className={`sg-banner ${txEvent.stage === 'failed' ? 'error' : ''}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <RefreshCw size={16} />
                <span>
                  <b>[{txEvent.stage.toUpperCase()}]</b> {txEvent.message}
                </span>
              </div>
              <button className="sg-btn" onClick={() => setTxEvent(null)}>
                ×
              </button>
            </div>
          )}

          {(busyMessage || errorMessage || noticeMessage) && (
            <div
              className={`sg-banner ${
                errorMessage ? 'error' : noticeMessage && !busyMessage ? 'success' : ''
              }`}
            >
              <span>{errorMessage || busyMessage || noticeMessage}</span>
              {!busyMessage && (
                <button
                  className="sg-btn"
                  onClick={() => {
                    setErrorMessage('');
                    setNoticeMessage('');
                  }}
                >
                  ×
                </button>
              )}
            </div>
          )}

          {page === 'registry' && (
            <>
              <section className="sg-hero">
                <div>
                  <div className="sg-eyebrow">{t.heroEyebrow}</div>
                  <h1>{t.heroTitle}</h1>
                  <p>{t.heroSubtitle}</p>
                </div>
                <div className="sg-hero-actions">
                  <button
                    className="sg-btn sg-btn-primary"
                    onClick={() => {
                      setDraft(buildPublicLiveTemplateSpec(String(releases.length + 1)));
                      setPage('register');
                    }}
                  >
                    <Plus size={16} />
                    <span>{t.btnHeroRegister}</span>
                  </button>
                  <button className="sg-btn" onClick={() => setPage('sdk')}>
                    <Terminal size={16} />
                    <span>{t.btnHeroCli}</span>
                  </button>
                </div>
              </section>

              <div className="sg-stats">
                <div className="sg-stat-card">
                  <span>{t.statReleasesLabel}</span>
                  <strong>{String(stats.total).padStart(2, '0')}</strong>
                  <small>
                    {config.mode === 'demo' ? t.statReleasesSubDemo : t.statReleasesSubLive}
                  </small>
                </div>
                <div className="sg-stat-card">
                  <span>{t.statApprovedLabel}</span>
                  <strong style={{ color: '#34d399' }}>
                    {String(stats.approved).padStart(2, '0')}
                  </strong>
                  <small>{t.statApprovedSub}</small>
                </div>
                <div className="sg-stat-card">
                  <span>{t.statBlockedLabel}</span>
                  <strong style={{ color: '#f87171' }}>
                    {String(stats.blocked).padStart(2, '0')}
                  </strong>
                  <small>{t.statBlockedSub}</small>
                </div>
              </div>

              <div className="sg-workspace-grid">
                <div className="sg-release-list">
                  <form className="sg-search-bar" onSubmit={handleLookupSubmit}>
                    <input
                      placeholder={t.searchPlaceholder}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {config.mode === 'live' && (
                      <button type="submit" className="sg-btn" title={t.btnLookup}>
                        <Search size={15} />
                      </button>
                    )}
                  </form>

                  {filteredReleases.length === 0 && (
                    <div className="sg-source-card" style={{ textAlign: 'center', padding: '24px 16px' }}>
                      <strong style={{ display: 'block', marginBottom: 8 }}>
                        {lang === 'zh'
                          ? '当前链上合约暂无已登记的技能版本'
                          : 'No releases registered on this contract yet'}
                      </strong>
                      <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: '0 0 14px' }}>
                        {lang === 'zh'
                          ? '当前连接的是全新的链上合约实例，您可以立即登记首个固定 Commit 技能版本，或切换至 Studio-dev / 本地演练沙箱查看预置样本。'
                          : 'This deployed contract has 0 releases so far. Register the first commit-pinned skill release now, or switch to Studio-dev (Chain 61997) / Local Demo Sandbox.'}
                      </p>
                      <button
                        type="button"
                        className="sg-btn sg-btn-primary"
                        onClick={() => {
                          setDraft(buildPublicLiveTemplateSpec('1'));
                          setPage('register');
                        }}
                      >
                        <Plus size={15} />
                        <span>{t.btnHeroRegister}</span>
                      </button>
                    </div>
                  )}

                  {filteredReleases.map((item) => (
                    <button
                      key={item.id}
                      className={`sg-release-card ${selected?.id === item.id ? 'selected' : ''}`}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <div className="sg-card-top">
                        <span>
                          SG-#{String(item.id).padStart(3, '0')} · {item.spec.packageType.toUpperCase()}
                        </span>
                        <span>v{item.spec.version}</span>
                      </div>
                      <h4>
                        {lang === 'zh' && DEMO_LOCALIZED_META[item.id]?.titleZh
                          ? DEMO_LOCALIZED_META[item.id].titleZh
                          : item.spec.title}
                      </h4>
                      <div className="sg-card-repo">
                        {item.spec.repo}@{item.spec.commitSha.slice(0, 8)}
                      </div>
                      <div className="sg-card-foot">
                        <span className={`sg-badge ${badgeClassForStatus(item.status)}`}>
                          {formatVerdictLabel(item.status, lang)}
                        </span>
                        {item.attestation && (
                          <span className="sg-badge neutral">
                            {formatRiskLabel(item.attestation.riskLevel, lang)}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>

                {selected && (
                  <div className="sg-detail-panel">
                    <div className="sg-detail-head">
                      <div>
                        <div className="sg-eyebrow">
                          {lang === 'zh'
                            ? `版本编号 SG-#${String(selected.id).padStart(3, '0')} · 第 ${selected.auditRound} 轮共识审计`
                            : `RELEASE SG-#${String(selected.id).padStart(3, '0')} · ROUND ${selected.auditRound}`}
                        </div>
                        <h2>
                          {lang === 'zh' && DEMO_LOCALIZED_META[selected.id]?.titleZh
                            ? DEMO_LOCALIZED_META[selected.id].titleZh
                            : selected.spec.title}
                        </h2>
                        <div className="sg-meta-row">
                          <span>
                            {lang === 'zh' ? '仓库' : 'Repo'}: {selected.spec.repo}
                          </span>
                          <span>Commit: {selected.spec.commitSha}</span>
                          <span>
                            {lang === 'zh' ? '提交者' : 'Submitter'}:{' '}
                            {shortenHex(selected.submitter, 8, 6)}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <span className={`sg-badge ${badgeClassForStatus(selected.status)}`}>
                          {formatVerdictLabel(selected.status, lang)}
                        </span>
                        <button
                          className="sg-btn"
                          title={t.btnExportAttestation}
                          onClick={() => exportAttestationReceipt(selected)}
                        >
                          <Download size={16} />
                        </button>
                      </div>
                    </div>

                    <div className="sg-tabs">
                      <button
                        className={tab === 'matrix' ? 'active' : ''}
                        onClick={() => setTab('matrix')}
                      >
                        {t.tabMatrix}
                      </button>
                      <button
                        className={tab === 'sources' ? 'active' : ''}
                        onClick={() => setTab('sources')}
                      >
                        {t.tabSources} ({selected.spec.sources.length})
                      </button>
                      <button
                        className={tab === 'challenges' ? 'active' : ''}
                        onClick={() => setTab('challenges')}
                      >
                        {t.tabChallenges} ({selected.challenges.length})
                      </button>
                      <button
                        className={tab === 'integrate' ? 'active' : ''}
                        onClick={() => setTab('integrate')}
                      >
                        {t.tabIntegrate}
                      </button>
                    </div>

                    {tab === 'matrix' && (
                      <div>
                        <div className="sg-summary-box">
                          <strong>
                            {lang === 'zh'
                              ? '版本功能声明与多模型共识结论摘要'
                              : 'Declared Scope & Multi-LLM Consensus Summary'}
                          </strong>
                          <p>
                            {lang === 'zh' && DEMO_LOCALIZED_META[selected.id]
                              ? selected.attestation
                                ? DEMO_LOCALIZED_META[selected.id].attestationSummaryZh
                                : DEMO_LOCALIZED_META[selected.id].scopeSummaryZh
                              : selected.attestation?.summary || selected.spec.scopeSummary}
                          </p>
                          {selected.attestation &&
                            selected.attestation.findingCategories.length > 0 && (
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                                {selected.attestation.findingCategories.map((cat) => (
                                  <span key={cat} className="sg-badge blocked">
                                    <AlertTriangle size={13} />
                                    {getFindingCategoryLabel(cat, lang)}
                                  </span>
                                ))}
                              </div>
                            )}
                        </div>

                        {selected.snapshot && (
                          <div
                            className={`sg-banner ${
                              selected.snapshot.staticSignals.length > 0 ? 'error' : 'success'
                            }`}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              {selected.snapshot.staticSignals.length > 0 ? (
                                <ShieldAlert size={18} />
                              ) : (
                                <ShieldCheck size={18} />
                              )}
                              <span>
                                {selected.snapshot.staticSignals.length > 0
                                  ? `${t.staticInjectionTitle}: ${selected.snapshot.staticSignals
                                      .map((s) => `${s.code} (source #${s.sourceIndex})`)
                                      .join(', ')}`
                                  : t.staticInjectionClean}
                              </span>
                            </div>
                          </div>
                        )}

                        <table className="sg-matrix-table">
                          <thead>
                            <tr>
                              <th>{lang === 'zh' ? '安全能力维度' : 'Capability Dimension'}</th>
                              <th>{t.declaredCol}</th>
                              <th>{t.observedCol}</th>
                              <th>{t.statusCol}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {CAPABILITIES.map((cap) => {
                              const declared = selected.spec.declaredPermissions[cap.id];
                              const check = selected.attestation?.capabilityChecks.find(
                                (c) => c.capabilityId === cap.id
                              );
                              const observed = check?.state === 'OBSERVED';
                              const violation = observed && !declared;
                              return (
                                <tr key={cap.id}>
                                  <td>
                                    <strong>{getCapabilityLabel(cap.id, lang)}</strong>
                                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 3 }}>
                                      {getCapabilityQuestion(cap.id, lang)}
                                    </div>
                                  </td>
                                  <td>
                                    <span className={`sg-badge ${declared ? 'warn' : 'neutral'}`}>
                                      {lang === 'zh'
                                        ? declared
                                          ? '已声明：是'
                                          : '已声明：否'
                                        : declared
                                        ? 'DECLARED: YES'
                                        : 'DECLARED: NO'}
                                    </span>
                                  </td>
                                  <td>
                                    {check ? (
                                      <span
                                        className={`sg-badge ${
                                          observed ? (violation ? 'blocked' : 'warn') : 'approved'
                                        }`}
                                      >
                                        {lang === 'zh'
                                          ? observed
                                            ? '实测检出'
                                            : '未检出'
                                          : check.state}
                                        {check.evidenceIndices.length > 0 &&
                                          (lang === 'zh'
                                            ? ` (文件 #${check.evidenceIndices.join(', #')})`
                                            : ` (File #${check.evidenceIndices.join(', #')})`)}
                                      </span>
                                    ) : (
                                      <span className="sg-badge neutral">
                                        {lang === 'zh' ? '待审计' : 'AWAITING AUDIT'}
                                      </span>
                                    )}
                                  </td>
                                  <td>
                                    {check ? (
                                      <span
                                        className={`sg-badge ${violation ? 'blocked' : 'approved'}`}
                                      >
                                        {violation ? t.matchViolation : t.matchOk}
                                      </span>
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {tab === 'sources' && (
                      <div>
                        {selected.snapshot && (
                          <div className="sg-summary-box">
                            <strong>
                              {lang === 'zh'
                                ? '不可篡改源码快照哈希：'
                                : 'Immutable Evidence Snapshot Hash: '}
                              <code>{selected.snapshot.snapshotHash}</code>
                            </strong>
                            <p>
                              {lang === 'zh'
                                ? '第一阶段已通过 GenLayer 验证节点拉取 GitHub 原始文件并核验 SHA-256 与字节长度，第二阶段审计完全基于该快照进行，零外部网络依赖。'
                                : 'Stage 1 fetched raw GitHub bytes across validators and locked exact SHA-256 & byte-length commitments. Stage 2 audits this snapshot with zero external HTTP calls.'}
                            </p>
                          </div>
                        )}

                        {selected.spec.sources.map((src, i) => {
                          const check = selected.snapshot?.sourceChecks.find((c) => c.index === i);
                          return (
                            <div key={src.path} className="sg-source-card">
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                }}
                              >
                                <div>
                                  <strong>
                                    [{String(i).padStart(2, '0')}] {src.path}
                                  </strong>{' '}
                                  <span className="sg-badge neutral">{src.role.toUpperCase()}</span>
                                </div>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                  {check && (
                                    <span
                                      className={`sg-badge ${
                                        check.status === 'VERIFIED' ? 'approved' : 'blocked'
                                      }`}
                                    >
                                      {lang === 'zh' && check.status === 'VERIFIED'
                                        ? '哈希已核验 (VERIFIED)'
                                        : check.status}
                                    </span>
                                  )}
                                  <a
                                    href={src.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="sg-btn"
                                  >
                                    <ExternalLink size={14} />
                                  </a>
                                </div>
                              </div>
                              <div className="sg-meta-row" style={{ marginTop: 8 }}>
                                <span>SHA-256: {src.sha256}</span>
                                <span>
                                  {lang === 'zh'
                                    ? `字节大小：${src.byteLength} 字节`
                                    : `Size: ${src.byteLength} bytes`}
                                </span>
                              </div>
                              {(selected.snapshot?.materials[i] || src.contentPreview) && (
                                <pre className="sg-code-preview">
                                  {selected.snapshot?.materials[i] || src.contentPreview}
                                </pre>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {tab === 'challenges' && (
                      <div>
                        <div className="sg-summary-box">
                          <strong>
                            {lang === 'zh'
                              ? '乐观民主公开挑战与重审机制'
                              : 'Optimistic Democracy Challenge & Re-Audit Escalation'}
                          </strong>
                          <p>
                            {lang === 'zh'
                              ? '任何安全研究员发现漏报或隐蔽后门，均可指定具体源码下标与威胁类别发起链上挑战。挑战会将版本置为 CHALLENGED 并强制新一轮多模型重审。'
                              : 'Any security researcher can challenge an existing attestation by citing source file indices and a threat category, forcing an on-chain multi-LLM re-audit.'}
                          </p>
                        </div>

                        {selected.challenges.length === 0 ? (
                          <div className="sg-source-card">
                            {lang === 'zh'
                              ? '当前版本暂无挑战记录。'
                              : 'No challenges submitted for this release yet.'}
                          </div>
                        ) : (
                          selected.challenges.map((ch) => (
                            <div key={ch.id} className="sg-source-card">
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <strong>
                                  {lang === 'zh' ? `挑战 #${ch.id}` : `Challenge #${ch.id}`} ·{' '}
                                  {getFindingCategoryLabel(ch.claimedCategory, lang)}
                                </strong>
                                <span
                                  className={`sg-badge ${
                                    ch.status === 'UPHELD'
                                      ? 'blocked'
                                      : ch.status === 'OPEN'
                                      ? 'warn'
                                      : 'neutral'
                                  }`}
                                >
                                  {lang === 'zh'
                                    ? ch.status === 'UPHELD'
                                      ? '挑战成立 (UPHELD)'
                                      : ch.status === 'OPEN'
                                      ? '待重审 (OPEN)'
                                      : '已驳回 (REJECTED)'
                                    : ch.status}
                                </span>
                              </div>
                              <p style={{ fontSize: '0.86rem', color: '#cbd5e1', margin: '8px 0' }}>
                                {lang === 'zh' &&
                                DEMO_LOCALIZED_META[selected.id]?.challengeStatementZh
                                  ? DEMO_LOCALIZED_META[selected.id].challengeStatementZh
                                  : ch.statement}
                              </p>
                              <div className="sg-meta-row">
                                <span>
                                  {lang === 'zh' ? '挑战者' : 'Challenger'}:{' '}
                                  {shortenHex(ch.challenger, 8, 6)}
                                </span>
                                <span>
                                  {lang === 'zh' ? '证据源文件下标' : 'Evidence Source Indices'}: [
                                  {ch.evidenceSourceIndices.join(', ')}]
                                </span>
                                {ch.resolvedRound && (
                                  <span>
                                    {lang === 'zh'
                                      ? `于第 #${ch.resolvedRound} 轮重审裁决`
                                      : `Resolved in Round #${ch.resolvedRound}`}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    {tab === 'integrate' && integrationSnippets && (
                      <div>
                        <div className="sg-source-card">
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <strong>
                              {lang === 'zh'
                                ? '1. 安装前终端安全拦截 CLI 命令'
                                : '1. Pre-Install Terminal Guard CLI'}
                            </strong>
                            <button
                              className="sg-btn"
                              onClick={() => copyText('cli', integrationSnippets.cliCommand)}
                            >
                              {copiedKey === 'cli' ? <Check size={14} /> : <Copy size={14} />}
                              <span>{lang === 'zh' ? '复制' : 'Copy'}</span>
                            </button>
                          </div>
                          <pre className="sg-code-preview">{integrationSnippets.cliCommand}</pre>
                        </div>

                        <div className="sg-source-card">
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <strong>
                              {lang === 'zh'
                                ? '2. 可嵌入 GitHub README 的动态安全认证徽章'
                                : '2. Embeddable GitHub README Attestation Badge'}
                            </strong>
                            <button
                              className="sg-btn"
                              onClick={() => copyText('badge', integrationSnippets.markdown)}
                            >
                              {copiedKey === 'badge' ? <Check size={14} /> : <Copy size={14} />}
                              <span>{lang === 'zh' ? '复制' : 'Copy'}</span>
                            </button>
                          </div>
                          <pre className="sg-code-preview">{integrationSnippets.markdown}</pre>
                        </div>

                        <div className="sg-source-card">
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <strong>
                              {lang === 'zh'
                                ? '3. 自保护 MCP 服务器接入配置'
                                : '3. Self-Protecting MCP Server Configuration'}
                            </strong>
                            <button
                              className="sg-btn"
                              onClick={() => copyText('mcp', integrationSnippets.mcpConfigJson)}
                            >
                              {copiedKey === 'mcp' ? <Check size={14} /> : <Copy size={14} />}
                              <span>{lang === 'zh' ? '复制' : 'Copy'}</span>
                            </button>
                          </div>
                          <pre className="sg-code-preview">{integrationSnippets.mcpConfigJson}</pre>
                        </div>
                      </div>
                    )}

                    <div className="sg-detail-footer">
                      <div style={{ display: 'flex', gap: 10 }}>
                        {!selected.snapshot && (
                          <button
                            className="sg-btn sg-btn-primary"
                            disabled={!!busyMessage}
                            onClick={handleLockEvidence}
                          >
                            <Lock size={15} />
                            <span>{t.stage1Btn}</span>
                          </button>
                        )}
                        {selected.snapshot &&
                          (!selected.attestation || selected.status === 'CHALLENGED') && (
                            <button
                              className="sg-btn sg-btn-primary"
                              disabled={!!busyMessage}
                              onClick={handleAuditRelease}
                            >
                              <ShieldCheck size={15} />
                              <span>
                                {selected.status === 'CHALLENGED' ? t.stageReauditBtn : t.stage2Btn}
                              </span>
                            </button>
                          )}
                      </div>

                      <div style={{ display: 'flex', gap: 10 }}>
                        {selected.attestation && selected.status !== 'CHALLENGED' && (
                          <button
                            className="sg-btn sg-btn-danger"
                            disabled={!!busyMessage}
                            onClick={() => setShowChallengeModal(true)}
                          >
                            <AlertTriangle size={15} />
                            <span>{t.btnChallengeModal}</span>
                          </button>
                        )}
                        <button
                          className="sg-btn"
                          onClick={() => exportAttestationReceipt(selected)}
                        >
                          <Download size={15} />
                          <span>{t.btnExportAttestation}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {page === 'register' && (
            <section>
              <div className="sg-eyebrow">
                {lang === 'zh' ? '固定 COMMIT 版本审计登记' : 'COMMIT-PINNED RELEASE SUBMISSION'}
              </div>
              <h1>{t.registerTitle}</h1>
              <p style={{ color: '#94a3b8' }}>{t.registerSubtitle}</p>

              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button
                  type="button"
                  className="sg-btn"
                  onClick={() => {
                    setDraft(buildPublicLiveTemplateSpec(String(releases.length + 1)));
                    setNoticeMessage(
                      lang === 'zh'
                        ? '已填入经过验证的 OpenZeppelin 固定 Commit 源码模板。'
                        : 'Filled verified OpenZeppelin commit-pinned source template.'
                    );
                  }}
                >
                  <Sparkles size={15} />
                  <span>{t.btnFillLiveTemplate}</span>
                </button>
                <button
                  type="button"
                  className="sg-btn"
                  onClick={() => setDraft(emptyReleaseDraft())}
                >
                  <span>{lang === 'zh' ? '清空表单' : 'Clear Form'}</span>
                </button>
              </div>

              <form className="sg-form-card" onSubmit={handleRegisterSubmit}>
                <div className="sg-grid-2">
                  <div className="sg-field">
                    <label>
                      {lang === 'zh'
                        ? '技能 / MCP 唯一标识 (slug) *'
                        : 'Skill / MCP Identifier (slug) *'}
                    </label>
                    <input
                      required
                      value={draft.skillId}
                      onChange={(e) => setDraft({ ...draft, skillId: e.target.value })}
                      placeholder="e.g. mcp-github-reader"
                    />
                  </div>
                  <div className="sg-field">
                    <label>{lang === 'zh' ? '显示标题 *' : 'Display Title *'}</label>
                    <input
                      required
                      value={draft.title}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                      placeholder="e.g. GitHub Commit Reader MCP Server"
                    />
                  </div>
                  <div className="sg-field">
                    <label>{lang === 'zh' ? '组件类型 *' : 'Package Type *'}</label>
                    <select
                      value={draft.packageType}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          packageType: e.target.value as ReleaseSpec['packageType'],
                        })
                      }
                    >
                      <option value="mcp_server">
                        {lang === 'zh' ? 'MCP 服务器 (mcp_server)' : 'MCP Server (mcp_server)'}
                      </option>
                      <option value="agent_skill">
                        {lang === 'zh' ? 'AI 智能体技能 (agent_skill)' : 'Agent Skill (agent_skill)'}
                      </option>
                    </select>
                  </div>
                  <div className="sg-field">
                    <label>{lang === 'zh' ? '语义化版本号 *' : 'Semantic Version *'}</label>
                    <input
                      required
                      value={draft.version}
                      onChange={(e) => setDraft({ ...draft, version: e.target.value })}
                      placeholder="1.0.0"
                    />
                  </div>
                  <div className="sg-field">
                    <label>
                      {lang === 'zh'
                        ? 'GitHub 仓库 (owner/repo) *'
                        : 'GitHub Repository (owner/repo) *'}
                    </label>
                    <input
                      required
                      value={draft.repo}
                      onChange={(e) => setDraft({ ...draft, repo: e.target.value })}
                      placeholder="OpenZeppelin/openzeppelin-contracts"
                    />
                  </div>
                  <div className="sg-field">
                    <label>
                      {lang === 'zh'
                        ? '40 位完整 Git Commit SHA *'
                        : '40-Character Git Commit SHA *'}
                    </label>
                    <input
                      required
                      pattern="[0-9a-fA-F]{40}"
                      value={draft.commitSha}
                      onChange={(e) => setDraft({ ...draft, commitSha: e.target.value })}
                      placeholder="3e6c86392c97fbc30d3d20a378a6f58beba08eba"
                    />
                  </div>
                </div>

                <div className="sg-field">
                  <label>
                    {lang === 'zh'
                      ? '功能范围与安全行为声明摘要 *'
                      : 'Scope & Security Behavior Summary *'}
                  </label>
                  <textarea
                    required
                    rows={3}
                    value={draft.scopeSummary}
                    onChange={(e) => setDraft({ ...draft, scopeSummary: e.target.value })}
                  />
                </div>

                <label style={{ fontSize: '0.84rem', color: '#94a3b8', fontWeight: 600 }}>
                  {lang === 'zh'
                    ? '发布者声明的宿主机敏感能力（勾选该版本合法使用的全部敏感权限）'
                    : 'Declared Host Capabilities (Check all capabilities this release legitimately uses)'}
                </label>
                <div className="sg-perm-grid">
                  {CAPABILITIES.map((cap) => (
                    <label key={cap.id} className="sg-perm-item">
                      <input
                        type="checkbox"
                        checked={draft.declaredPermissions[cap.id]}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            declaredPermissions: {
                              ...draft.declaredPermissions,
                              [cap.id]: e.target.checked,
                            },
                          })
                        }
                      />
                      <div>
                        <strong style={{ display: 'block', fontSize: '0.85rem' }}>
                          {getCapabilityLabel(cap.id, lang)}
                        </strong>
                        <small style={{ color: '#64748b', fontSize: '0.75rem' }}>
                          {getCapabilityQuestion(cap.id, lang)}
                        </small>
                      </div>
                    </label>
                  ))}
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    margin: '16px 0 10px',
                  }}
                >
                  <strong>
                    {lang === 'zh'
                      ? '固定 Commit 源码文件列表（1–4 个文件，单文件 ≤ 16,384 字节）'
                      : 'Commit-Pinned Source Files (1–4 files, ≤ 16,384 bytes each)'}
                  </strong>
                  <button
                    type="button"
                    className="sg-btn"
                    disabled={draft.sources.length >= 4}
                    onClick={() =>
                      setDraft({ ...draft, sources: [...draft.sources, emptySourceDraft()] })
                    }
                  >
                    <Plus size={14} /> {lang === 'zh' ? '添加源文件' : 'Add File'}
                  </button>
                </div>

                {draft.sources.map((src, idx) => (
                  <div key={idx} className="sg-source-card">
                    <div className="sg-grid-2">
                      <div className="sg-field">
                        <label>
                          {lang === 'zh' ? '仓库内相对文件路径 *' : 'Relative File Path in Repo *'}
                        </label>
                        <input
                          required
                          value={src.path}
                          onChange={(e) => {
                            const nextPath = e.target.value;
                            const nextUrl =
                              draft.repo && draft.commitSha && nextPath
                                ? buildPinnedRawUrl(draft.repo, draft.commitSha, nextPath)
                                : src.url;
                            setDraft({
                              ...draft,
                              sources: draft.sources.map((s, i) =>
                                i === idx ? { ...s, path: nextPath, url: nextUrl } : s
                              ),
                            });
                          }}
                        />
                      </div>
                      <div className="sg-field">
                        <label>{lang === 'zh' ? '文件角色 *' : 'File Role *'}</label>
                        <select
                          value={src.role}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              sources: draft.sources.map((s, i) =>
                                i === idx
                                  ? { ...s, role: e.target.value as PinnedSource['role'] }
                                  : s
                              ),
                            })
                          }
                        >
                          <option value="entrypoint">entrypoint</option>
                          <option value="manifest">manifest</option>
                          <option value="permissions">permissions</option>
                          <option value="module">module</option>
                        </select>
                      </div>
                    </div>

                    <div className="sg-field">
                      <label>
                        {lang === 'zh'
                          ? '固定 Commit 的 raw.githubusercontent.com 地址 *'
                          : 'Pinned raw.githubusercontent.com URL *'}
                      </label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          required
                          style={{ flex: 1 }}
                          value={src.url}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              sources: draft.sources.map((s, i) =>
                                i === idx ? { ...s, url: e.target.value } : s
                              ),
                            })
                          }
                        />
                        <button
                          type="button"
                          className="sg-btn"
                          disabled={!!busyMessage}
                          onClick={() => handleHashSourceFile(idx)}
                        >
                          <span>{t.btnComputeSha}</span>
                        </button>
                      </div>
                    </div>

                    <div className="sg-grid-2">
                      <div className="sg-field">
                        <label>
                          {lang === 'zh'
                            ? '原始字节精确 SHA-256 (64 位十六进制) *'
                            : 'Exact Raw Byte SHA-256 (64 hex) *'}
                        </label>
                        <input
                          required
                          pattern="[0-9a-fA-F]{64}"
                          value={src.sha256}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              sources: draft.sources.map((s, i) =>
                                i === idx ? { ...s, sha256: e.target.value } : s
                              ),
                            })
                          }
                        />
                      </div>
                      <div className="sg-field">
                        <label>
                          {lang === 'zh'
                            ? '精确字节长度 (1–16384) *'
                            : 'Exact Byte Length (1–16384) *'}
                        </label>
                        <input
                          required
                          type="number"
                          min={1}
                          max={16384}
                          value={src.byteLength || ''}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              sources: draft.sources.map((s, i) =>
                                i === idx ? { ...s, byteLength: Number(e.target.value) } : s
                              ),
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>
                ))}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 18 }}>
                  <button
                    type="button"
                    className="sg-btn"
                    onClick={() => setPage('registry')}
                  >
                    {lang === 'zh' ? '取消' : 'Cancel'}
                  </button>
                  <button
                    type="submit"
                    className="sg-btn sg-btn-primary"
                    disabled={!!busyMessage}
                  >
                    <Shield size={16} />
                    <span>{t.btnSubmitRegister}</span>
                  </button>
                </div>
              </form>
            </section>
          )}

          {page === 'sdk' && (
            <section>
              <div className="sg-eyebrow">
                {lang === 'zh' ? '智能体生态持续防护工具' : 'CONTINUOUS AGENT ECOSYSTEM UTILITY'}
              </div>
              <h1>{t.cliPageTitle}</h1>
              <p style={{ color: '#94a3b8' }}>{t.cliPageSubtitle}</p>

              <div className="sg-form-card">
                <h3>
                  {lang === 'zh'
                    ? '1. 命令行安装前安全核验器 (`cli/skillguard.mjs`)'
                    : '1. Command-Line Pre-Install Verifier (`cli/skillguard.mjs`)'}
                </h3>
                <p style={{ color: '#94a3b8', fontSize: '0.88rem' }}>
                  {lang === 'zh' ? (
                    <>
                      在安装任何社区 MCP 服务器或智能体技能前运行。仅当该固定 Commit 版本在
                      SkillGuard 上处于 <code>APPROVED</code> 状态时返回退出码 <code>0</code>；若处于{' '}
                      <code>BLOCKED</code> 或未认证状态则返回非零退出码 <code>2</code> 自动拦截。
                    </>
                  ) : (
                    <>
                      Run before installing any MCP server or Agent Skill. Exits with code{' '}
                      <code>0</code> only if the commit-pinned release is <code>APPROVED</code> on
                      SkillGuard; exits with code <code>2</code> if <code>BLOCKED</code> or
                      unverified.
                    </>
                  )}
                </p>
                <pre className="sg-code-preview">
{`# Verify a commit-pinned release on SkillGuard before installing
node cli/skillguard.mjs check OpenZeppelin/openzeppelin-contracts@3e6c86392c97fbc30d3d20a378a6f58beba08eba

# Test against a blocked / backdoored release (exits with non-zero code 2)
node cli/skillguard.mjs check agent-tools-lab/solana-rebalancer-mcp@7b4e9102aa891234bcde0987654321fedcba0987`}
                </pre>

                <h3 style={{ marginTop: 24 }}>
                  {lang === 'zh'
                    ? '2. 自保护 MCP 服务器 (`cli/mcp-server.mjs`)'
                    : '2. Self-Protecting MCP Server (`cli/mcp-server.mjs`)'}
                </h3>
                <p style={{ color: '#94a3b8', fontSize: '0.88rem' }}>
                  {lang === 'zh' ? (
                    <>
                      通过标准输入输出（stdio）暴露 JSON-RPC 2.0 MCP 工具{' '}
                      <code>skillguard_check_attestation</code>，供 Claude、Cursor 或 Antigravity
                      等编程智能体在调用外部技能前自主完成链上安全自检。
                    </>
                  ) : (
                    <>
                      Exposes JSON-RPC 2.0 MCP tool <code>skillguard_check_attestation</code> over
                      stdio so AI coding agents can verify external tools autonomously before
                      invoking them.
                    </>
                  )}
                </p>
                <pre className="sg-code-preview">
{`{
  "mcpServers": {
    "skillguard": {
      "command": "node",
      "args": ["./cli/mcp-server.mjs"],
      "env": {
        "SKILLGUARD_RPC_URL": "https://rpc-bradbury.genlayer.com",
        "SKILLGUARD_CONTRACT_ADDRESS": "${deployment.contractAddress}"
      }
    }
  }
}`}
                </pre>
              </div>
            </section>
          )}

          {page === 'settings' && (
            <section>
              <div className="sg-eyebrow">
                {lang === 'zh' ? 'GENLAYER 网络与智能合约连接' : 'GENLAYER NETWORK CONNECTION'}
              </div>
              <h1>{t.settingsTitle}</h1>
              <p style={{ color: '#94a3b8' }}>{t.settingsSubtitle}</p>

              <form className="sg-form-card" onSubmit={handleSaveSettings}>
                <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="sg-btn"
                    onClick={() =>
                      setSettingsDraft({
                        mode: 'demo',
                        rpcUrl: settingsDraft.rpcUrl,
                        contractAddress: settingsDraft.contractAddress,
                      })
                    }
                  >
                    {lang === 'zh' ? '使用本地演练沙箱' : 'Use Local Demo Sandbox'}
                  </button>
                  <button
                    type="button"
                    className="sg-btn"
                    onClick={() =>
                      setSettingsDraft({
                        mode: 'live',
                        rpcUrl: 'https://studio-dev.genlayer.com/api',
                        contractAddress:
                          deployment.studioDevContractAddress || deployment.contractAddress || '',
                      })
                    }
                  >
                    {lang === 'zh'
                      ? '使用官方 Studio-dev 模拟器 (Chain 61997)'
                      : 'Use Official Studio-dev Simulator (Chain 61997)'}
                  </button>
                  <button
                    type="button"
                    className="sg-btn"
                    onClick={() =>
                      setSettingsDraft({
                        mode: 'live',
                        rpcUrl: BRADBURY_CONFIG.rpcUrl,
                        contractAddress: deployment.contractAddress || settingsDraft.contractAddress,
                      })
                    }
                  >
                    {lang === 'zh'
                      ? '使用公共测试网 Bradbury Phase 2 (Chain 4221)'
                      : 'Use Public Testnet Bradbury Phase 2 (Chain 4221)'}
                  </button>
                </div>

                <div className="sg-grid-2">
                  <div className="sg-field">
                    <label>{lang === 'zh' ? '运行模式' : 'Execution Mode'}</label>
                    <select
                      value={settingsDraft.mode}
                      onChange={(e) =>
                        setSettingsDraft({
                          ...settingsDraft,
                          mode: e.target.value as ConnectionConfig['mode'],
                        })
                      }
                    >
                      <option value="demo">
                        {lang === 'zh'
                          ? '本地演练沙箱（无需连接钱包）'
                          : 'Local Demo Sandbox (No Wallet Needed)'}
                      </option>
                      <option value="live">
                        {lang === 'zh'
                          ? 'GenLayer 链上实时模式（Studio-dev / Bradbury）'
                          : 'GenLayer Live Chain (Studio-dev / Bradbury)'}
                      </option>
                    </select>
                  </div>

                  <div className="sg-field">
                    <label>{lang === 'zh' ? 'GenLayer RPC 节点地址' : 'GenLayer RPC Endpoint'}</label>
                    <input
                      value={settingsDraft.rpcUrl}
                      onChange={(e) =>
                        setSettingsDraft({ ...settingsDraft, rpcUrl: e.target.value })
                      }
                    />
                  </div>
                </div>

                <div className="sg-field">
                  <label>
                    {lang === 'zh'
                      ? '已部署的 SkillGuard 智能合约地址 (0x...)'
                      : 'Deployed SkillGuard Intelligent Contract Address (0x...)'}
                  </label>
                  <input
                    value={settingsDraft.contractAddress}
                    onChange={(e) =>
                      setSettingsDraft({ ...settingsDraft, contractAddress: e.target.value })
                    }
                    placeholder="0x..."
                  />
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    marginTop: 16,
                    flexWrap: 'wrap',
                  }}
                >
                  <button
                    type="button"
                    className="sg-btn"
                    disabled={!!busyMessage}
                    onClick={() =>
                      runAction(
                        lang === 'zh'
                          ? '正在通过 MetaMask 部署 SkillGuard 合约至 Bradbury Phase 2...'
                          : 'Deploying SkillGuard contract to Bradbury Phase 2 via wallet...',
                        async () => {
                          const res = await deployBradburyContractViaWallet();
                          const nextCfg: ConnectionConfig = {
                            mode: 'live',
                            rpcUrl: BRADBURY_CONFIG.rpcUrl,
                            contractAddress: res.contractAddress,
                          };
                          setSettingsDraft(nextCfg);
                          saveConnectionConfig(nextCfg);
                          setConfig(nextCfg);
                          setNoticeMessage(
                            lang === 'zh'
                              ? `Bradbury Phase 2 部署成功！合约地址：${res.contractAddress}（区块 #${res.blockNumber}）`
                              : `Bradbury Phase 2 deployed! Contract: ${res.contractAddress} (Block #${res.blockNumber})`
                          );
                        }
                      )
                    }
                  >
                    <Shield size={15} />
                    <span>
                      {lang === 'zh'
                        ? '使用钱包一键部署合约至 Bradbury Phase 2 (4221)'
                        : 'Deploy Contract to Bradbury Phase 2 (4221) via Wallet'}
                    </span>
                  </button>

                  <button type="submit" className="sg-btn sg-btn-primary">
                    <span>{t.btnSaveSettings}</span>
                  </button>
                </div>
              </form>
            </section>
          )}
        </div>
      </main>

      {showChallengeModal && selected && (
        <div
          className="sg-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowChallengeModal(false);
          }}
        >
          <div className="sg-modal">
            <h3>{t.challengeModalTitle}</h3>
            <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>{t.challengeModalSub}</p>
            <form onSubmit={handleChallengeSubmit}>
              <div className="sg-field">
                <label>
                  {lang === 'zh' ? '指控威胁类别 *' : 'Claimed Threat Category *'}
                </label>
                <select
                  value={challengeCategory}
                  onChange={(e) => setChallengeCategory(e.target.value as FindingCategory)}
                >
                  {(Object.keys(FINDING_CATEGORY_META) as FindingCategory[]).map((cat) => (
                    <option key={cat} value={cat}>
                      {getFindingCategoryLabel(cat, lang)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sg-field">
                <label>
                  {lang === 'zh' ? '涉及源文件下标 *' : 'Evidence Source File Indices *'}
                </label>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {selected.spec.sources.map((src, idx) => (
                    <label key={src.path} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={challengeIndices.includes(idx)}
                        onChange={(e) =>
                          setChallengeIndices((prev) =>
                            e.target.checked
                              ? [...new Set([...prev, idx])]
                              : prev.filter((i) => i !== idx)
                          )
                        }
                      />
                      <span>
                        [{idx}] {src.path}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="sg-field">
                <label>
                  {lang === 'zh'
                    ? '详细技术证据与代码行说明 *'
                    : 'Detailed Technical Evidence Statement *'}
                </label>
                <textarea
                  required
                  rows={4}
                  value={challengeStatement}
                  onChange={(e) => setChallengeStatement(e.target.value)}
                  placeholder={
                    lang === 'zh'
                      ? '请说明具体源码行号、未声明的敏感 API 调用或提示词注入载荷...'
                      : 'Describe the exact line numbers, undeclared API calls, or prompt-injection payload...'
                  }
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                <button
                  type="button"
                  className="sg-btn"
                  onClick={() => setShowChallengeModal(false)}
                >
                  {lang === 'zh' ? '取消' : 'Cancel'}
                </button>
                <button type="submit" className="sg-btn sg-btn-danger" disabled={!!busyMessage}>
                  <span>{t.btnSubmitChallenge}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

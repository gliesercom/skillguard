# SkillGuard — GenLayer Portal Contribution Draft (Do Not Submit Without User Confirmation)

## 1. Project Identity
- **Project Name**: `SkillGuard`
- **Primary Tag (主标签)**: `Developer Tools` (`开发者工具`) — or `AI & Agents` (`AI 与智能体`)
- **Secondary Tags (子标签)**: `AI & Agents` (`AI 与智能体`), `Identity & Reputation` (`身份与信誉`)

## 2. One-Line Description (一句话简介, ≤ 180 chars)
- **English**: A commit-pinned MCP server & AI agent skill security attestation registry on GenLayer using multi-LLM consensus, static injection guards, and open challenges.
- **中文参考**: 基于 GenLayer 多模型共识的 MCP 服务器与 AI 智能体技能安全认证注册表，按 Git Commit 锁定源码哈希并支持公开挑战重审。

## 3. Detailed Description (描述, ≤ 1000 chars)
SkillGuard solves a critical supply-chain trust problem in the AI agent economy: developers and autonomous agents frequently install community MCP servers and skill plugins that can secretly access private keys, environment credentials, or host shells, or embed prompt-injection strings designed to trick single-LLM code scanners.

SkillGuard introduces a two-stage GenLayer Intelligent Contract (`skillguard/1`):
1. `lock_evidence`: Validators independently fetch commit-pinned `raw.githubusercontent.com/<owner>/<repo>/<40-hex-commit>/<path>` files, verify exact byte lengths and SHA-256 digests, and run deterministic static prompt-injection detection to lock an immutable evidence snapshot.
2. `audit_release`: Validators evaluate the locked snapshot with zero external HTTP calls, comparing observed capabilities (`network_access`, `filesystem_write`, `subprocess_exec`, `secret_env_access`) against publisher declarations under a canonical Equivalence Principle projection to derive `APPROVED`, `WARN`, `BLOCKED`, or `INSUFFICIENT_EVIDENCE`.
3. `challenge_release`: Researchers can cite file indices and threat categories to challenge an attestation and trigger a re-audit round.

Includes a bilingual React workbench, a pre-install CLI (`skillguard check`), README badges, and a stdio MCP server so agents can self-verify tools before installation.

## 4. Step-by-Step Reviewer Guide (写明具体步骤)
1. **Explore Curated & Live Registry**: Open `https://glieser2.github.io/skillguard/` (or run locally). Toggle between English and Chinese (`EN / 中文`) in the top bar. Inspect the three pre-loaded supply-chain cases (`APPROVED` OpenZeppelin read-only skill, `BLOCKED` Solana MCP server with prompt injection & key exfiltration, and `WARN` Git worktree runner).
2. **Switch to GenLayer Live Mode**: Open `Network & Contract` to inspect the live **Testnet Bradbury Phase 2 (Chain 4221)** deployment (`0x7de3BF9F73d512291f2623DCd3C618d4a83b9bb5`) or switch to `Official Studio-dev Simulator (Chain 61997)` (`0x80C412F90Ad2d3E5F57437C753F9202b5090Fd18`) and click `Get Studio Test Account` in the top bar.
3. **Register a Commit-Pinned Release**: Navigate to `Register Release`, click `Fill Verified OpenZeppelin Pinned Template` (or enter any public GitHub repo + 40-char commit SHA), click `Fetch & Hash Raw GitHub Bytes` to compute the exact SHA-256 digest, and submit `register_release`.
4. **Lock Snapshot & Run Consensus Audit**: On the release detail page, click `Step 1 · Lock Pinned Source Snapshot` (`lock_evidence`), wait for `FINALIZED` consensus, then click `Step 2 · Run Consensus Security Audit` (`audit_release`) to inspect the finalized capability matrix and export the JSON receipt.
5. **Challenge & CLI Verification**: Click `Submit Security Challenge` (`challenge_release`) to escalate a release to `CHALLENGED` and re-audit it, or run `node cli/skillguard.mjs check OpenZeppelin/openzeppelin-contracts@3e6c86392c97fbc30d3d20a378a6f58beba08eba` in the terminal.

## 5. Expected Verification Outcome (证明步骤可行)
Stewards will observe:
1. Verified on-chain deployment on **GenLayer Testnet Bradbury Phase 2 (`chainId = 4221`)** at `0x7de3BF9F73d512291f2623DCd3C618d4a83b9bb5` (`https://scan.bradbury.genlayer.com/address/0x7de3BF9F73d512291f2623DCd3C618d4a83b9bb5`, protocol tx `0x80bc276d37b19d044e7b72d4d4de950d38bc118c180b0e390976a8ca91d72a0d`, block `250216`, `FINALIZED` / `MAJORITY_AGREE`, `get_policy_version() == "skillguard/1"`) and Studio-dev Simulator (`0x80C412F90Ad2d3E5F57437C753F9202b5090Fd18`).
2. Exact SHA-256 and byte-length verification of commit-pinned `raw.githubusercontent.com` source files inside the locked evidence snapshot (`VERIFIED` vs `HASH_MISMATCH`).
3. Full GenLayer transaction lifecycle banners (`PROPOSING` -> `COMMITTING` -> `FINALIZED`) for `register_release`, `lock_evidence`, `audit_release`, and `challenge_release`.
4. Deterministic static prompt-injection interception (`PROMPT_INJECTION_IGNORE` / `PROMPT_INJECTION_FAKE_SAFE`) forcing `CRITICAL / BLOCKED`, plus exportable JSON attestation receipts, README badge snippets, and CLI / MCP JSON-RPC tool responses.

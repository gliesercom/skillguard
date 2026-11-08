# SkillGuard · Decentralized MCP Server & Agent Skill Security Attestation Registry

SkillGuard is a GenLayer-powered supply-chain security attestation registry for **Model Context Protocol (MCP) servers** and **AI Agent Skills**. It binds every security attestation to an immutable **40-character Git commit SHA** and exact `raw.githubusercontent.com` **SHA-256 source byte snapshots**, combines deterministic static prompt-injection screening with multi-LLM **Optimistic Democracy** capability consensus, and supports open on-chain security challenges (`challenge_release` -> `audit_release`).

## Why SkillGuard Needs GenLayer

1. **Solving a Real Trust Problem**: Autonomous coding and crypto agents routinely install community MCP servers and skill packages that can read local `.env` secrets, SSH keys, or wallet files, or embed prompt-injection comments that hijack single-LLM code reviewers. Trusting a single centralized marketplace or author self-declaration is insufficient.
2. **Real-Time & Authoritative Pinned Evidence (`lock_evidence`)**: Stage 1 fetches commit-pinned `https://raw.githubusercontent.com/<owner>/<repo>/<40-hex-commit>/<path>` files directly inside GenVM validators, verifies exact byte length and SHA-256 digests, and locks an immutable snapshot on-chain.
3. **Zero-HTTP Multi-Model Consensus Audit (`audit_release`)**: Stage 2 evaluates the locked snapshot with zero external HTTP calls. Source code is wrapped as untrusted data (`UNTRUSTED_EVIDENCE_JSON`), screened by deterministic regex rules against prompt-injection strings (`ignore previous instructions`, fake verdict overrides), and evaluated across 4 core host capabilities (`network_access`, `filesystem_write`, `subprocess_exec`, `secret_env_access`).
4. **Optimistic Democracy Challenge & Re-Audit (`challenge_release`)**: Any security researcher can challenge an audited release by citing source file indices and a threat category, transitioning the release to `CHALLENGED` and triggering a new multi-LLM re-audit round.
5. **Continuous Ecosystem Usage**: Includes a Web Registry Workbench (Bilingual `EN / 中文`), a pre-install CLI (`node cli/skillguard.mjs check <repo>@<commit>`), an embeddable GitHub README badge generator, and a stdio MCP server (`cli/mcp-server.mjs`) so AI agents can self-check skills before installing them.

## Architecture & Two-Stage Consensus Workflow

| Stage | Contract Method | Execution Boundary | Consensus Verification |
| --- | --- | --- | --- |
| **0. Registration** | `register_release(release_json)` | Deterministic GenVM write | Locks `repo@commit_sha`, declared permissions matrix, and expected file SHA-256 hashes |
| **1. Evidence Lock** | `lock_evidence(release_id)` | `gl.vm.run_nondet_default` (`gl.nondet.web.request`) | Leader & validators independently fetch raw GitHub bytes, verify SHA-256, and run static injection regex checks |
| **2. Consensus Audit** | `audit_release(release_id)` | `gl.vm.run_nondet_default` (`gl.nondet.exec_prompt`) | Zero HTTP; compares canonical projection (`capability_states`, `undeclared_capabilities`, `finding_categories`, `risk_level`, `verdict`) |
| **3. Challenge Escalation** | `challenge_release(release_id, challenge_json)` | Deterministic GenVM write -> `audit_release` | Records challenger evidence and forces a new multi-model audit round (`UPHELD` / `REJECTED`) |

## Verified On-Chain Deployments

| Network | Chain ID | Contract Address | Deployment / Protocol Tx | Explorer / RPC |
| --- | --- | --- | --- | --- |
| **GenLayer Testnet Bradbury Phase 2** | `4221` | `0x7de3BF9F73d512291f2623DCd3C618d4a83b9bb5` | `0x80bc276d37b19d044e7b72d4d4de950d38bc118c180b0e390976a8ca91d72a0d` (Block `250216`, `FINALIZED` / `MAJORITY_AGREE`) | [View on Bradbury Explorer](https://scan.bradbury.genlayer.com/address/0x7de3BF9F73d512291f2623DCd3C618d4a83b9bb5) (`https://rpc-bradbury.genlayer.com`) |
| **GenLayer Official Studio-dev Simulator** | `61997` | `0x80C412F90Ad2d3E5F57437C753F9202b5090Fd18` | `0x5968834be1eef7ad61032792afd120ba67661c667e5c1dd40debef7fb9ec70b9` (`FINALIZED` E2E verified) | `https://studio-dev.genlayer.com/api` |

- **Live Web Workbench**: `https://glieser2.github.io/skillguard/`
- **GitHub Repository**: `https://github.com/glieser2/skillguard`
- **Security Audit Report**: [`docs/audit-report.md`](./docs/audit-report.md)
- **Bradbury Deployment Proof**: [`artifacts/bradbury-deployment-proof.json`](./artifacts/bradbury-deployment-proof.json)

## Quick Start & Verification

Requires **Node.js 22+**, **pnpm 11** (`corepack pnpm`), and **Python 3.13**.

```bash
# Install dependencies
corepack pnpm install

# Run Python GenVM stub contract unit tests (9 tests covering canonical & compact AST-equivalent artifacts)
corepack pnpm run test:contract

# Run TypeScript Vitest & Node CLI/MCP integration tests
corepack pnpm test

# Test the Pre-Install CLI Guard
node cli/skillguard.mjs check OpenZeppelin/openzeppelin-contracts@3e6c86392c97fbc30d3d20a378a6f58beba08eba

# Build production web bundle
corepack pnpm build

# Start local interactive workbench
corepack pnpm dev
```

## Security & Scope Disclaimer

SkillGuard produces decentralized consensus risk signals over commit-pinned source files (`<= 16,384` bytes per file, up to 4 files per release). It does not constitute a formal verification proof, runtime sandbox guarantee, or financial warranty.

# SkillGuard Code & Security Audit Report

- **Project**: `SkillGuard` (`E:\UserData\jinjw\Documents\ChatGPT\Portal\skillguard`)
- **Policy Version**: `skillguard/1`
- **Audit Date**: 2026-11-08
- **Canonical Contract**: `contracts/skill_guard.py` (`42,087` bytes, SHA-256 `fa9015ce128336d4035f3341c5a54ca10894d287b82e54424f8bdd1301607095`)
- **Compact Contract (AST-Equivalent)**: `contracts/skill_guard_compact.py` (`31,505` bytes, SHA-256 `a591abe96d1d15edd20695125871bc7a19361286874fe20fa3e4085c6a6486af`)

---

## 1. Audit Scope & Methodology

We audited the entire SkillGuard repository across five dimensions required for a high-scoring GenLayer Points Portal contribution:
1. **GenVM Intelligent Contract Determinism & Consensus Safety** (`contracts/skill_guard.py`, `contracts/skill_guard_compact.py`)
2. **Prompt-Injection Resilience & Untrusted Input Isolation**
3. **Bradbury Phase 2 (`chainId = 4221`) & Studio-dev (`chainId = 61997`) Protocol Verification** (`src/lib/live.ts`, `src/lib/protocol-outcome.ts`)
4. **Frontend UX, Bilingual (`EN / 中文`) Completeness & CLI/MCP Integration** (`src/`, `cli/`)
5. **Repository Hygiene, Secret Scanning & Automated Test Coverage**

---

## 2. Findings & Resolutions

| ID | Severity | Component | Description | Status |
| --- | --- | --- | --- | --- |
| **SG-AUD-01** | Low (Code Hygiene) | `contracts/skill_guard.py` | Unused local list comprehension `raw_Categories` in `validate_audit_report` before calling `decode_model_audit`. | **Fixed** (Removed unused variable, regenerated `skill_guard_compact.py`, verified AST equivalence). |
| **SG-AUD-02** | Medium (Network Safety) | `src/lib/live.ts` | Public Bradbury Phase 2 reads/writes initially used the default `testnetBradbury` chain object without verifying `AddressManager` (`0x3F71AE080BD6270A91dBcc7960d88797828538E0`) and genesis hash (`0x17d897...`) against the official Phase 2 manifest. | **Fixed** (Added `verifiedBradburyChain()` and automatic wallet chain switch to `0x107d`). |
| **SG-AUD-03** | Low (Bradbury L2 Gas) | `contracts/skill_guard_compact.py` | Canonical 42 KB contract risks exceeding default 15M gas estimate on Bradbury L2. | **Mitigated & Verified** (`scripts/generate-compact.py` produces a 31,505-byte AST-equivalent compact contract that fits safely within a bounded `31,800,000` gas envelope below Bradbury's `32,000,000` `maxTxGasLimit`). |
| **SG-AUD-04** | Informational | `src/lib/i18n.ts` | Verified default language (`en`) contains zero residual Chinese strings in English mode, and complete Simplified Chinese localization in `zh` mode. | **Verified** |

---

## 3. GenLayer Consensus Invariants Verification

1. **Strict Separation of Non-Deterministic I/O and Model Reasoning**:
   - Stage 1 (`lock_evidence`) performs all HTTP GET requests (`gl.nondet.web.request`) and locks raw UTF-8 materials + SHA-256 checks on-chain.
   - Stage 2 (`audit_release`) performs **zero HTTP requests** and evaluates only the committed snapshot.
2. **Protection Against Leader Forgery**:
   - In `lock_evidence`, `validator_fn` runs `validate_evidence` on the leader's calldata, independently fetches the commit-pinned URLs, and requires exact canonical equality.
   - In `audit_release`, `validator_fn` runs `validate_audit_report` (which recomputes `derive_risk_and_verdict` from raw capability states and static signals so a malicious leader cannot forge `APPROVED` when an undeclared capability or static injection signal is present) and compares `stable_audit_projection`.
3. **Zero Unhandled Exceptions in `validator_fn`**:
   - Both `validator_fn` callbacks check `isinstance(leader_result, gl.vm.Return)` first and wrap validation in `try ... except Exception: return False`.

---

## 4. Verification Suite Summary

- **Python Contract Unit Tests (`corepack pnpm run test:contract`)**: `9 / 9` passed (including clean approval, undeclared capability block, static prompt-injection critical block, hash-mismatch zero-LLM `INSUFFICIENT_EVIDENCE`, challenge & re-audit `UPHELD` flow, single format repair, duplicate registration rejection, and compact AST equivalence).
- **TypeScript Domain & Node CLI/MCP Tests (`corepack pnpm test`)**: `6 / 6` passed (`4` Vitest + `2` Node integration tests).
- **Production Bundle (`corepack pnpm build`)**: Passed (`tsc -b && vite build`).

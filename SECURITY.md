# SkillGuard Security Boundaries & Threat Model

SkillGuard (`skillguard/1`) is a non-custodial, commit-pinned security attestation registry for Model Context Protocol (MCP) servers and AI Agent Skills on GenLayer. This document defines its security boundaries, consensus verification invariants, and operational limits.

## 1. Non-Custodial & Non-Financial Scope
- SkillGuard performs **zero token transfers, zero asset custody, zero staking operations, and zero automated financial execution**.
- Attestations represent decentralized multi-model consensus risk signals over locked source files at a specific 40-character Git commit SHA. They do **not** constitute a formal verification proof, runtime OS sandbox guarantee, or financial warranty.

## 2. Commit-Pinned Evidence Integrity (`lock_evidence`)
- Every release is uniquely keyed by `<owner/repo>@<40-hex-commit-sha>` (`release_keys`) and allows 1 to 4 source files (`<= 16,384` UTF-8 bytes per file).
- Source URLs are strictly restricted to `https://raw.githubusercontent.com/<owner>/<repo>/<40-hex-commit>/<path>`. Mutable branch refs (`main`, `master`), path traversal segments (`.`, `..`), query strings, credentials, and alternative origins are rejected deterministically.
- In Stage 1 (`lock_evidence`), both the leader and validators independently fetch raw bytes via `gl.nondet.web.request`, verify exact byte length and SHA-256 digests against the publisher's commitment, run deterministic static prompt-injection regex checks (`scan_static_signals`), and require byte-for-byte canonical equivalence (`canonical(leader) == canonical(validator)`) before locking the immutable `evidence_snapshot`.
- Any file failing HTTP 200 retrieval, size limits, SHA-256 matching, or strict UTF-8 decoding is recorded with a non-verified status (`UNAVAILABLE`, `TOO_LARGE`, `HASH_MISMATCH`, `INVALID_ENCODING`) and `null` material.

## 3. Zero-HTTP Consensus Audit & Prompt-Injection Defense (`audit_release`)
- Stage 2 (`audit_release`) executes with **zero external HTTP requests**, operating exclusively over the locked `evidence_snapshot` from Stage 1.
- If any source file in the snapshot is not `VERIFIED`, `deterministic_unverified_audit` immediately returns `INSUFFICIENT_EVIDENCE` (`HIGH` risk) with **zero LLM invocations**.
- When all sources are `VERIFIED`, source code is embedded inside `UNTRUSTED_EVIDENCE_JSON` with explicit instructions that file contents are untrusted data, never instructions.
- **Deterministic Static Override**: Even if a malicious source file tricks an LLM into outputting `NOT_OBSERVED` across all capabilities, any static regex signal (`PROMPT_INJECTION_IGNORE`, `PROMPT_INJECTION_OVERRIDE`, `PROMPT_INJECTION_FAKE_SAFE`, `PROMPT_INJECTION_SYSTEM_TAG`) deterministically injects `PROMPT_INJECTION_INSTRUCTION` and forces `risk_level = CRITICAL` and `verdict = BLOCKED` in contract code (`derive_risk_and_verdict`).
- **Equivalence Principle Projection**: Validators independently run `independent_audit`, verify that the leader did not forge derived fields (`validate_audit_report`), and compare `stable_audit_projection` (which locks `snapshot_hash`, `capability_states`, `undeclared_capabilities`, `finding_categories`, `static_signals`, `declared_vs_actual_mismatch`, `risk_level`, and `verdict` while ignoring free-text `summary` phrasing differences).
- **Bounded Format Repair**: At most one format-only repair prompt is allowed per invocation when JSON parsing or schema validation fails, and `preserved_audit_states` forbids the repair pass from flipping previously valid capability states.

## 4. Challenge & Re-Audit Escalation (`challenge_release`)
- Any security researcher can challenge an audited release (up to `MAX_CHALLENGES = 3` per release) by citing specific source indices and a threat category (`claimed_category`).
- Challenging transitions the release status to `CHALLENGED` and unlocks a new `audit_release` round that includes `active_challenges` in the audit prompt and resolves open challenges as `UPHELD` or `REJECTED`.

## 5. Wallet & Network Safety Guards
- **Bradbury Phase 2 Verification**: Before reading or writing on GenLayer Bradbury Phase 2 (`chainId = 4221`), the client verifies the genesis block hash (`0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4`), official `AddressManager` (`0x3F71AE080BD6270A91dBcc7960d88797828538E0`), and all 8 core consensus contract addresses against the sealed protocol manifest.
- **Bounded L2 Deployment Gas**: Compact AST-equivalent contract deployment (`contracts/skill_guard_compact.py`) uses an explicit bounded gas limit (`31,800,000` gas) verified via same-block `eth_estimateGas` and `eth_call` below Bradbury L2's `32,000,000` `maxTxGasLimit`.
- **No Private Key Exfiltration**: The web application and CLI never request, read, store, or transmit private keys or seed phrases.

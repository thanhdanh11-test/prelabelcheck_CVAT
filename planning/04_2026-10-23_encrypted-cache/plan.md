# Encrypted cache v1.14.0
Status: local implementation verified; local and company gates separate. Date: 2026-10-23.
Authorization: user requested password-encrypted cache after reviewing the proposed flow.
## Decisions
2026-10-23: use browser Web Crypto, no new dependency or server. Locked default = RAM-only. Encrypt cloud and origin records; no plaintext fallback writes. Keep checklist IDs/panel position outside vault, disclose this.
Superseded: unencrypted cloud IndexedDB and origin localStorage persistence.
## Packages
🔴 contracts/security; 🟠 implementation/tests; 🟢 docs. Owner: primary agent.
## Checklist
- [x] Inspect readers/writers and specify migration.
- [x] Implement vault, adapter and UI.
- [x] Verify crypto, race/failure and migration behavior locally.
- [x] Sync docs/version.
- [ ] Company CVAT acceptance.
## Specs
[Architecture](specs/00-ARCHITECTURE.md), [Contracts](specs/01-CONTRACTS.md), [Operations](specs/OPERATIONS.md), [Tests](specs/TESTING-ACCEPTANCE.md).

2026-10-23 review: independent agent verified AAD/tamper; origin multiwriter and reset/unlock races found and fixed. 139 Node tests, 5 browser checks; fixture UI no server data.

2026-10-23 adversarial audit: source unchanged. Browser confirms same-page password capture and tab-local lock; Node additionally confirms replay/weak-password limits. Release recommendation pending remediation/explicit threat-model acceptance; see docs/CACHE-SECURITY-AUDIT.md.


2026-10-23: user approved A1/A2 remediation. Password UI moved to extension popup; activeTab permission; one-use runtime challenges; shared revocation token and reset fence. Supersedes in-page password UI and user-facing tab-local lock. Local147/147; installed Chrome/company acceptance remains open.

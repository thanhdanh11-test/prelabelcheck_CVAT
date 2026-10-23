# Persist split origins — PATCH v1.13.6

- Status: local implementation verified; company-server acceptance pending
- Date: 2026-10-23
- Scope: content.js origin storage, focused tests, current usage docs and brain sync
- Tier: 🟠 implementation/tests; 🟢 documentation

## Decisions
- 2026-10-23: User reports origin labels/navigation disappear on reload. Persist browser-local origin links by server/job, resolve by server ID or unique pre-Save geometry; never persist client IDs as identities.
- Superseded: v1.13.4 RAM-only origin contract. Last-Apply receipt remains RAM-only.
- Contract/runbook/failure behavior: [TRACK-SPLIT.md](../../docs/TRACK-SPLIT.md), section v1.13.6.
- Rollback: restore v1.13.5 scripts; new localStorage key is ignored. No annotation migration.

## Checklist and acceptance
- [x] Trace itemOrigins.clear on reload/job switch and RAM-only storage.
- [x] Implement snapshot-based persistence and safe resolution; no annotation mutation.
- [x] Node suite: 128 tests / 128 pass / 0 fail / 0 skip.
- [x] Regression mutation: disable persistence, 4 new cases fail.
- [x] Syntax check content.js and synchronize docs/version.
- [ ] Company CVAT: split, Save, reload, select child, verify label and parent navigation.
- [ ] Commit/push on user request.

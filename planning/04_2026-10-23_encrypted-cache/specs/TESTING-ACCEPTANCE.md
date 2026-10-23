# Acceptance
- [x] local: crypto roundtrip, wrong password/tamper/AAD, distinct IVs, locked reload, no key persistence.
- [x] local: lock during crypto, reset/header change, concurrent initialization, clear during write.
- [x] local: migrate all origins preserving exact records; failures keep originals.
- [x] local: real IndexedDB encrypted bytes, reopen, legacy upgrade and old writer denial.
- [x] local: full Node suite, JS syntax, diff checks.
- [ ] company: actual unlock/Apply/Save/reload/parent navigation and lock with draft.
MUST report actual counts; do not equate mocked tests to live company acceptance. Negative test disables encryption and must fail confidentiality assertion. No server annotation mutation during local browser tests.

Observed: 139/139 Node, 0 skip; plaintext-write mutation fails confidentiality test. Browser5/5; UI 0 JS errors/preload1/1. Company gate open.


Hardening gate: ✅ local147/147 Node (0fail/skip), spoofed senders/nonce races/global lock/empty-vault reset. Reset mutation exit1. ⬜ installed Chrome popup + real runtime sender + two-tab draft recovery; Ego loadUnpacked unavailable. ⬜ company Apply/Save/reload. Prior5 browser checks do not establish new popup behavior.

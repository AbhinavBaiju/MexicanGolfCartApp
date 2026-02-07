# Next Chat Prompt (M6 Start)

Use this as the first message in a new chat:

---

Project root: `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp`

Read these documents first, in order:
1. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/context-milestones.md`
2. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/00-executive-summary.md`
3. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/06-m1-implementation-log.md`
4. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/07-m2-implementation-log.md`
5. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/09-m3-implementation-log.md`
6. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/11-m4-implementation-log.md`
7. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/14-m5-implementation-log.md`
8. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/15-m5-handoff-context.md`
9. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/03-issues-register.md`
10. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/04-endpoints-and-data-contracts.md`
11. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/05-test-and-verification-plan.md`

Current state:
- M1 complete.
- M2 complete and re-audited/signed off.
- M3 complete and validated.
- M4 complete and validated.
- M5 complete and validated.
- Latest M5 context and exact modifications are documented in `15-m5-handoff-context.md`.

Your task:
1. Start M6 implementation (Security & Proxy Hardening) end-to-end.
2. Cover ISS-014, ISS-015, ISS-016, ISS-020:
   - ISS-014: Restrict CORS for admin APIs (remove wildcard behavior, allow trusted admin origin(s)).
   - ISS-015: Enforce App Proxy signature verification for all `/proxy/*` routes in production (not just agreement sign).
   - ISS-016: Persist Shopify store timezone during OAuth (`shop.iana_timezone`) into `shops.timezone` and use per-shop timezone in date logic.
   - ISS-020: Centralize Shopify API version constants and remove hardcoded version drift.
3. Keep backend D1 as source of truth and avoid client-authoritative business logic.
4. Preserve no-overselling guarantees and atomic inventory patterns.
5. Keep webhook idempotency guarantees.
6. Keep strict TypeScript (no `any`).
7. Run relevant validation and report exact command outputs.
8. Update audit docs with M6 implementation notes and any delta findings.

Constraints:
- Keep changes consistent with existing architecture and milestone docs.
- Do not regress M1/M2/M3/M4/M5 behavior.
- Keep local dev workflow functional (Shopify dev tunnel + worker/admin dev).
- If changing auth/security behavior, include explicit compatibility notes for dev vs production modes.
- If removing/changing config values, ensure build/lint/typecheck remain clean except documented pre-existing warnings.

---

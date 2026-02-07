# Next Chat Prompt (M5 Start)

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
7. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/12-m4-handoff-context.md`
8. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/03-issues-register.md`
9. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/04-endpoints-and-data-contracts.md`
10. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/05-test-and-verification-plan.md`

Current state:
- M1 complete.
- M2 complete and re-audited/signed off.
- M3 complete and validated.
- M4 complete and validated.
- Latest M4 context and exact modifications are documented in `12-m4-handoff-context.md`.

Your task:
1. Start M5 implementation (Shopify Remix Cleanup) end-to-end.
2. Cover ISS-008 and ISS-009:
   - Remove/replace Shopify Remix template demo behavior ("Generate a product") from `app/routes/app._index.tsx`.
   - Resolve placeholder Remix routes (`/app/bookings`, `/app/inventory`, `/app/products`, `/app/locations`) by either:
     - redirecting to the real admin SPA paths, or
     - replacing with production-safe behavior consistent with current architecture.
3. Ensure Shopify Remix nav links align with real app paths and do not lead to dead placeholder experiences.
4. Keep backend D1 as source of truth and avoid client-authoritative business logic.
5. Preserve no-overselling guarantees and atomic inventory patterns.
6. Keep strict TypeScript (no `any`).
7. Run relevant validation and report exact command outputs.
8. Update audit docs with M5 implementation notes and any delta findings.

Constraints:
- Keep changes consistent with existing architecture and milestone docs.
- Do not regress M1/M2/M3/M4 behavior.
- If removing placeholder routes/code, keep local dev tunnel flow intact.
- If removing code/dependencies, ensure build/lint/typecheck remain clean except documented pre-existing warnings.

---

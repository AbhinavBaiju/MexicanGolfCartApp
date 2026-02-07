# Next Chat Prompt (M4 Start)

Project root: `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp`

Read these documents first, in order:
1. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/context-milestones.md`
2. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/00-executive-summary.md`
3. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/06-m1-implementation-log.md`
4. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/07-m2-implementation-log.md`
5. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/09-m3-implementation-log.md`
6. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/10-m3-handoff-context.md`
7. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/03-issues-register.md`
8. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/04-endpoints-and-data-contracts.md`
9. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/05-test-and-verification-plan.md`

Current state:
- M1 complete.
- M2 complete and re-audited/signed off.
- M3 complete and validated.
- Latest M3 context and exact modifications are documented in `10-m3-handoff-context.md`.

Your task:
1. Start M4 implementation (Dashboard Polishing) end-to-end.
2. Cover ISS-005, ISS-010, ISS-018, ISS-019, ISS-007:
   - Wire Dashboard `FAQ` and `+ New service` actions.
   - Fix “All teammates” label/behavior to reflect locations (or implement real teammate model if in scope).
   - Show service labels using Shopify product titles instead of numeric IDs where applicable.
   - Remove/clean dead code and unused dependencies that are safe to remove in this milestone.
   - Resolve Products page route/dead-code decision (`/products` route vs removal), consistent with current architecture.
3. Keep backend D1 as source of truth and avoid client-authoritative business logic.
4. Preserve no-overselling guarantees and atomic inventory patterns.
5. Keep strict TypeScript (no `any`).
6. Run relevant validation and report exact command outputs.
7. Update audit docs with M4 implementation notes and any delta findings.

Constraints:
- Keep changes consistent with existing architecture and milestone docs.
- Do not regress M1/M2/M3 behavior.
- If removing code/dependencies, ensure build/lint/typecheck remain clean except documented pre-existing warnings.

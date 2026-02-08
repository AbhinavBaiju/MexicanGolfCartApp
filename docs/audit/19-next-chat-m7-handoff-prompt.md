# Next Chat Prompt (M7 Start)

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
8. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/17-m6-implementation-log.md`
9. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/18-m6-handoff-context.md`
10. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/03-issues-register.md`
11. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/04-endpoints-and-data-contracts.md`
12. `/Users/abhinav/Developement/MexicanGolfCarts/MexicanGolfCartApp/docs/audit/05-test-and-verification-plan.md`

Current state:
- M1 complete.
- M2 complete and re-audited/signed off.
- M3 complete and validated.
- M4 complete and validated.
- M5 complete and validated.
- M6 complete and validated.
- Latest M6 context and exact modifications are documented in `18-m6-handoff-context.md`.

Your task:
1. Start M7 implementation (Testing & Regression Guardrails) end-to-end.
2. Prioritize and implement the M7 backlog in `05-test-and-verification-plan.md`:
   - Backend (P0): strengthen coverage for booking filters/status handling, proxy signature behavior, inventory conflict/concurrency protection, and per-shop timezone date-rule behavior.
   - Frontend (P1): add focused tests for Bookings/Dashboard/BookingCard/BookingsCalendar regressions where feasible.
   - Integration/E2E (P2): implement practical high-value path(s) possible in current workspace setup.
3. Keep backend D1 as source of truth and avoid client-authoritative business logic.
4. Preserve no-overselling guarantees and atomic inventory patterns.
5. Preserve webhook idempotency guarantees.
6. Keep strict TypeScript (no `any` in new code).
7. Run relevant validation and report exact command outputs.
8. Update audit docs with M7 implementation notes and any delta findings.

Constraints:
- Keep changes consistent with existing architecture and milestone docs.
- Do not regress M1/M2/M3/M4/M5/M6 behavior.
- Keep local dev workflow functional (Shopify dev tunnel + worker/admin dev).
- If adding CI/scripts, keep them deterministic and workspace-compatible.
- If adding tests that require env/mocks, document assumptions clearly.
- Ensure lint/typecheck/tests/build remain clean except documented pre-existing warnings.

---

# Weekly roles

Agreed: calendar weeks in MSK; Monday 09:00 selects the previous week's voice-time winner. Admins configure default_role, weekly_role and the announcement channel. Restore default_role to all weekly_role holders before awarding the winner; exclude bots and members without eligibility. Existing channel command is admin-only.

1. Change time.ts to calendar weeks, keep report deadline separate. Test midnight boundaries and 09:00 scheduling.
2. Extend settings with default role and durable award progress; retain existing MVP role configuration. Add admin role commands with validation and keep mvprole as alias.
3. Fetch all guild members using paginated REST. Save winner before mutations, restore every previous holder, grant weekly role and remove default role from winner. Retry failures without choosing a new winner; serialize scheduler runs.
4. Publish report with eligible winner only after successful role changes; retry failed delivery independently. Document configuration and the historical aggregation limitation.
5. Run tests and typecheck, review diff. No deployment or commit requested.

Decisions: previous holders remain eligible after restoration; ties resolve by user ID ascending; zero activity means no winner. Historical Sunday aggregates stay available in lifetime totals but cannot be reconstructed into calendar weeks.

## Completion

Implemented all five steps. Independent review found and verified two recovery fixes:
- Configuration changes during asynchronous member/role fetch: configuration guard and revalidation prevent stale writes; regression test failed before fix and passes afterward.
- Deleted role with a pending award: `off` now cancels pending state outside active rotation, allowing replacement configuration; regression test failed before fix and passes afterward.

Validation: `pnpm test` 45/45, `pnpm typecheck`, `git diff --check`. Network role operations tested with mocks; no live server mutation or deployment performed. Existing user changes in compose.yaml and README deployment instructions preserved.

## Follow-up: minimum competition size

Require at least two eligible humans with positive voice time in the previous calendar week.
A sole active participant does not win; reset existing weekly roles as usual.
Regression test failed before implementation; exactly-two boundary is covered as well.

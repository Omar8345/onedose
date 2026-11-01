# Durable fencing release rollout

This is a maintenance-window rollout, not a rolling or blue/green writer upgrade.
Do not execute it until the staged release and rollout are approved.

## Target and prerequisites

- Frankfurt endpoint: `https://fra.cloud.appwrite.io/v1`.
- Project: `6ad61f280034f679d696`; database: `6ad61f7e003988501658`.
- `occurrence_fences` must exist before activating the application. It is already
  present in this target; do not reset, reseed, or run a data backfill.
- Required columns: `circleId` varchar(36), `occurrenceId` varchar(36), `version`
  integer. All are required. Key indexes: `by_circle(circleId)` and
  `by_occurrence(occurrenceId)`; all schema elements must be available.
- Table permissions must be empty, row security enabled, and fence rows must have
  no client permissions. Runtime server credentials need row read/write access.
- No new environment variables or dependencies are required. Preserve the approved
  demo-project/origin/identity allowlist, OTP restrictions, and session settings.
- Existing occurrences initialize one deterministic private fence row lazily.
  Concurrent creation conflicts reread that row; its counter is read before the
  occurrence used for decisions. The legacy-version and lost-response audits
  passed without rewriting existing occurrence data.

## Writer inventory and activation gate

At release preparation, two local servers were listening on port 3000. The
`OneDose reminders` Function was enabled, with a 15-second execution timeout and
no configured schedule. These observations must be refreshed at cutover.
The reminder engine creates occurrences; it does not delete occurrences or
change claims/outcomes, but pause it during cutover to simplify the drain.

The current local credential cannot read Site settings (`sites.read` unavailable).
An operator must verify in the Appwrite Console the exact Site, all domains and
preview/deployment URLs, activation policy, maximum runtime, and old deployments.
Do not assume a normal activation immediately terminates old request handlers.

1. After approval, record the reviewed commit and current deployment IDs. Disable
   automatic activation/deployment before any push that could trigger it. Build
   the candidate with activation disabled; do not exercise candidate mutations
   against this database while old writers remain accessible.
2. Close public ingress by disabling the Site. Confirm that mutation routes are
   inaccessible through the public domain, aliases, preview URLs and old deployment
   URLs. Disabling a Site does not block privileged server-key callers: stop those
   callers separately. If any old URL remains writable, keep the gate closed and
   resolve it before continuing.
3. Pause the reminder Function and other schedules, manual jobs, test runners,
   local servers and privileged administrative callers using this database. Stop
   both old local servers after identifying their current processes. Do not reuse
   stale PIDs from this document or an earlier session.
4. Confirm all old Site/Function executions have finished or been terminated using
   execution/traffic records. Read the actual configured runtime limits. Waiting
   an arbitrary number of seconds alone is not proof that old writers stopped.
5. After the last old execution ends, allow its outstanding transactions to settle
   or expire. Application transactions have a 60-second TTL. Inspect unresolved
   transaction states; a 503 is not evidence of rollback. Do not reopen writes
   while any old commit is unresolved or any old caller can still issue requests.
6. Reverify target/schema and activate only the reviewed fenced deployment while
   public ingress remains closed. Confirm the active deployment ID and that old
   deployment URLs cannot invoke unfenced writers.
7. With every old writer stopped, perform controlled authenticated smoke checks
   using isolated synthetic fixtures against the new deployment. Verify all three
   demo-login buttons and normal OTP availability without modifying the protected
   Mitchell scenario. Check claims, outcomes, corrections and Realtime using the
   isolated fixture, then clean up only that fixture.
8. Reenable public ingress to the fenced deployment, then resume the verified
   background Function. Monitor conflicts, provider errors and receipt replay.

This gate prevents mixed writers only when every check above succeeds. If the
platform cannot block old deployment URLs or establish that old executions have
stopped, abort the activation/reopening step. Site controls and drain status have
not been changed or certified as quiescent during release preparation.

Appwrite documents Site disabling and non-activated deployments in its
[Sites API reference](https://appwrite.io/docs/references/cloud/server-nodejs/sites)
and [deployment guide](https://appwrite.io/docs/products/sites/deployments).

## Rollback

- Close ingress, stop writers and drain executions/transactions again before
  changing the active deployment.
- Keep the fence table and every production fence counter. Do not reset versions,
  restore old counters, or delete counters for removed/recreated occurrences.
- Prefer fixing forward or selecting a previously verified fence-aware build.
  The pre-release unfenced build is not a safe writable rollback target. If it
  must be restored for diagnosis, keep public writes disabled.
- This is an additive schema release: no rollback requires deleting histories,
  receipts, Auth accounts, Teams, or Mitchell records. Do not reset or reseed.
- For ambiguous provider errors, read transaction state and affected rows/receipts
  before deciding what happened. Do not blindly retry the write.

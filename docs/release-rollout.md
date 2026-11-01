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
Separate local QA listeners on `127.0.0.1:3001` and `127.0.0.1:3002` were also
running after verification. Include both in the refreshed inventory and drain;
the two older port-3000 listeners are not the complete local writer set. None
was stopped during this verification.
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

## Authorization and worker hardening

The follow-up hardening revision also requires a coordinated app/Function
cutover: the reminder Function must include `src/occurrence-identity.js` from its
own deployment root. Next.js imports that same module. Do not keep an old worker
running alongside the new application; older workers use a different occurrence
ID length. Existing random and older worker IDs are adopted by schedule/local
date, without rewriting history. The compatibility lookup fails closed at 100
occurrences in its three-day UTC lookup window or if that date already has duplicates; investigate
such records before enabling writers. No automatic migration or deletion runs.

The existing private `occurrence_fences` table also holds membership counters.
`auth_` row IDs fence `mem_` resource IDs; the legacy `occurrenceId` column stores
that member ID in this namespace. `fence_` rows retain their existing occurrence
semantics. Both namespaces must remain private and permanent in production.
No new table, column, environment variable, or backfill is needed. Test cleanup
may delete only counters in the test's independently owned synthetic circle.

Claim, release, outcome/correction and availability transactions read the
membership counter before their authoritative membership read and stage a bounded
increment with their writes. Revocation atomically advances that same counter
(without an upper bound) and marks membership revoked before attempting Team
removal. A failed Team removal does not restore app access; login must not
reactivate a revoked member row. Restoring a previously revoked caregiver now
requires an explicit owner/admin recovery; a fresh sign-in or invitation
activation alone cannot restore access. Simultaneous operations by one caregiver can
conflict even when they target different occurrences; show the conflict and let
the user refresh rather than silently retrying writes. Provider errors and
ambiguous commits still require authoritative read-back, not blind retries.

Confirmed Team membership/ownership is checked for privileged operations,
including onboarding recovery. Appwrite Team changes made directly with the
shared accounts' credentials cannot participate in the database transaction.
The previously accepted shared-account/Team credential limitation remains; this
revision transactionally fences application-managed membership revocation.

Appwrite Team removal is a separate service operation after the database
revocation commits. If that removal fails, the application reports failure and
keeps the database member revoked; it does not reactivate access. Direct Appwrite
Team-derived read rights can remain until Team removal is confirmed. Resolve an
ambiguous Team response by inspecting the membership rather than assuming that
the database transaction also revoked external credentials.

A final hardening preflight still found the reminder Function enabled with
`execute: ["any"]`, no schedule, Node 26 and a 15-second timeout. Public manual
invocation remains possible despite the empty schedule. Include it in the
maintenance gate and review invocation permissions before reopening traffic.
These settings were read only, not changed by the hardening pass.

## Mandatory reminder invocation gate (separate approval required)

The prepared operator change is in
[`functions/reminders/permission-plan.json`](../functions/reminders/permission-plan.json).
It is a proposal, not an automatically applied Appwrite configuration. Change
`execute: ["any"]` to `execute: []` only after explicit operator approval.
There is no client-side Function execution flow in OneDose: the app independently
materializes occurrences and uses Appwrite Realtime. Empty client execute access
still permits authorized server-key, scheduled, and platform-event execution
([Appwrite execute access](https://appwrite.io/docs/products/functions/functions)).
Schedule and event triggers are currently empty; do not introduce a scheduler as
part of this hardening change. Operator/server invocation remains available.

Select only TablesDB row read/write, Teams read, and Messaging write runtime
capabilities. Remove unused `users.read` and `users.write`. Review document/vector
scope entries with the operator: retain only automatic compatibility aliases of
row scopes if the provider adds them, not independent permissions. Do not remove
required aliases blindly or grant them to make a failing test pass.

After approval and application, run `npm run release:reminder-preflight` against
the verified target. This command only reads metadata. Exit 2 means the deployment
gate is BLOCKED; it is not an application assertion or an automatic permission
update. Do not reopen traffic until it passes and the operator confirms scope
alias behavior, source/deployment identity, URL coverage, and all writer drains.

## Schedule lifecycle and recovery protocol

Permanent `sched_` rows in the existing private fence table identify schedule IDs
in the legacy `occurrenceId` column. All three namespaces (`fence_`, `auth_`,
`sched_`) must remain private and must never be reset/pruned in production.
Materializers read this counter before the authoritative schedule and commit a
bounded increment with creation. Schedule edits/archive/timezone propagation use
the same counter; edits commit the parent and today's pending-occurrence change
atomically. Retiming also fences the occurrence against a concurrent completion.
The shared implementation lives inside the reminder Function deployment root and
is imported by Next.js; no new schema, dependency, or backfill is required.

Restoration remains an explicit, separately approved owner/admin action. Verify
confirmed Team membership and the intended circle/user/role first. In a single
database transaction, advance that member's permanent `auth_` counter (never reset
it) and set the member row active. Do not delete/recreate the counter or merely
reissue an invitation. Login/activation preserves existing roles and counters;
newly invited members are created with a bounded counter increment in the same
transaction. No public restoration endpoint is introduced by this change.

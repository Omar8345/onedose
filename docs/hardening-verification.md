# Targeted security and correctness verification

Historical first hardening pass. See the [subsequent lifecycle verification](lifecycle-hardening-verification.md) for the current revision, expanded file list, infrastructure result, and deployment gates.

Verified on 1 November 2026 against the configured Frankfurt Appwrite environment.
Baseline: `317f7a756aef4dece2bb6a1f268101032968fc3a`.
Changes remain local and uncommitted. No deployment, reset, reseed, production
configuration change, or service shutdown was performed.

## Reproduced findings and corrections

### Team authorization

The baseline onboarding function accepted a Team ID from editable account
preferences without confirming ownership. A synthetic non-owner triggered the
unique-Team conflict path, renamed the Team, and recovered its existing circle ID.

Onboarding now requires confirmed Team ownership before staging writes and again
on recovery. Recovery also requires the caller's active owner row in that circle
and never renames an established Team. Invitation creation verifies the circle's
Team matches the selected Team. Schedule, recipient, caregiver, and alert
administration also check the appropriate confirmed Team membership/ownership.
The existing public-demo schedule exception remains limited to the approved
identities and protected circle.

Tests use real isolated Auth accounts and Teams. Forged caregiver preferences
received HTTP 403; legitimate owner recovery received HTTP 201. Non-owners and
non-members could not rename another Team, gain recovered preferences, or create
unrelated circle data.

### Authorization revocation

A baseline completion paused after reading its valid lease committed after the
owner revoked the caregiver: one accepted outcome, one event, and one receipt.
Touching `lastMutationAt` did not provide commit-time authorization invalidation.

The existing private `occurrence_fences` table now also holds permanent `auth_`
counters keyed by deterministic member IDs. The legacy `occurrenceId` field stores
the member ID in that namespace. Caregiver writes read the counter before the
membership used for decisions and stage a bounded positive increment with their
writes. Revocation advances the same counter without an upper bound and marks the
member revoked in one database transaction, before removing Team membership.
Claims, releases, completions/corrections, and availability use this guard.

Both reproduced pauses now fail: after the lease read and after all writes are
staged immediately before commit. Neither creates an event or receipt. Valid
caregivers subsequently take over and complete successfully. Login/invitation
activation cannot overwrite an already-revoked member row or change existing
membership roles.

The new guard uses the same bounded-increment mechanism as durable occurrence
fencing. Commit-time rejection was empirically verified on Appwrite 2.6.2 with
node-appwrite 30.0.1; this is not an assertion that ordinary version writes are
compare-and-swap. A zero-increment experiment was rejected by Appwrite with HTTP
400 `general_argument_invalid` (`Value must be numeric and greater than 0`), so
that alternative was not used. No schema change or backfill is required.

### Occurrence identity

The app previously used 30 hash characters and the reminder worker 32, despite
hashing the same schedule/date input. Both now import one generator, including
initial onboarding. Notification and Messaging ID formats are unchanged.
Before creating an occurrence, both adopt an existing row for the schedule's local
date, including old worker and random onboarding IDs. The database lookup uses a
three-day UTC window, followed by the exact timezone date comparison. Duplicate
existing dates or 100 rows in that window fail closed for inspection; no history
is renamed or deleted as a migration.

### Logout and People polling

Logout no longer swallows revocation failures: it returns 503 and leaves the
cookie available for retry. An already-invalid session (401) can still clear the
cookie. All logout entry points show failure rather than refreshing as if logout
succeeded. A real HTTP logout rejected subsequent use of its old Appwrite secret;
a second session belonging to the same synthetic account remained valid.

People polling calls the existing guarded snapshot refresh. It retains confirmed
data on transient failure, prevents overlapping refreshes, and pauses on error
until recovery. Existing snapshot error/recovery tests passed. No new browser
layout or screenshot verification was performed in this pass.

## Executed verification

| Check | Result |
| --- | --- |
| Original suites: schedules, reminders, safety, caregivers, recipients, race, demo, snapshot, demo-protection | 9/9 passed serially |
| Full fencing | 6 rounds of 25 contenders: 6 winners, 144 accurate claim conflicts; 150 non-holder completions blocked |
| Controlled fencing interleavings | All 5 passed with zero stale commits; all 3 natural release/completion races had one successful transition |
| Lifecycle | All 3 deletion/recreation cases passed, including concurrent edits; zero stale commits/events/receipts |
| Fixture cleanup | Uncertain membership creation discovered and removed; independent circle unchanged |
| Hardening | Team/HTTP authorization checks, both paused revocation cases, valid-caregiver progress, and revoked activation guard passed |
| App/worker identity | All 3 ID formats passed 25 concurrent generators and 3 rescheduling rounds each; real audit events, receipts, and replay preserved |
| Logout | Simulated failure propagated; real HTTP cookie clearing/current-session revocation/second-session isolation passed |
| Extended HTTP/contention audit | 5 expired-takeover rounds: 5 winners, 120 accurate conflicts, 125 non-holder HTTP 409 responses, 5 accepted winner completions, zero unexpected responses |
| Legacy/lost-response audit | Legacy version 7 initialized safely; injected lost response after confirmed commit produced one event/receipt and safe replay |
| Final schedule/reminder rechecks | Both passed after the date-window refinement |
| Lint, TypeScript, production build, whitespace | Passed |
| Reminder Function | Engine exercised against isolated records; main, engine, shared module syntax checks passed; live deployed Function not invoked |

The two natural HTTP claim rounds each returned 25 HTTP 200 responses, but only
one body reported `claimed`; 24 reported `already_claimed`. Authoritative claim
rows and returned holder/timestamp state matched. The remaining three extended
rounds used instrumented domain calls; all non-holder completion checks used HTTP.

### Infrastructure interruption: retained separately

The initial serial verification passed 13 suites, then stopped during the third
app/worker identity case on an occurrence lookup read:

- `TypeError: fetch failed`
- Cause: `getaddrinfo ENOTFOUND fra.cloud.appwrite.io`, errno `-3008`.
- Request: TablesDB `GET /databases/{database}/tables/occurrences/rows`.
- No HTTP response or Appwrite error type was received.

This was an infrastructure failure, not a successful test or an assertion failure.
Logout HTTP, extended contention, and lost-response checks had not run in that
attempt. All in-flight generator calls were drained and cleanup was verified
read-only. No ambiguous write was retried. Five spaced DNS/authenticated-read
checks then passed. A separate run with fresh fixtures passed all six follow-up
checks: identity, logout, extended contention, lost-response audit, and the two
schedule/reminder rechecks. The initial failed result and private diagnostic logs
remain preserved locally. This is not a claim that one uninterrupted 17-check run
passed. No retry loop or weakened assertion was added.

The 503-shaped lost-response fault and logout fault were deliberate test
injections, not observed provider 503 responses.

## Preservation and release limitations

Final read-only discovery found zero synthetic resources across all 12 tables,
Auth users, and Teams in the verification namespaces. Per-suite session cleanup
also passed. Mitchell's rows, Team, memberships, and three identity snapshot were
unchanged. Its 38 occurrences have no duplicate schedule/local-date pairs.

- No schema, dependency, production permission, or environment changes were made.
  The existing private fence table and indexes were verified ready.
- Existing occurrence counters remain permanent; no production code deletes either
  fence namespace. Fixture cleanup is restricted to each test-owned circle.
- Simultaneous writes by one caregiver can conflict on the shared member counter,
  including writes to different tasks; an explicit refresh may be required.
- Revoked memberships cannot be restored automatically by a fresh login or
  invitation activation. Explicit owner/admin recovery is required; no restoration
  endpoint was added in this pass. This conservative behavior needs release review.
- Appwrite Team removal remains a separate service operation. A failed removal
  leaves app access revoked but can leave direct Team-derived read rights until
  confirmed removal. The accepted shared-account/JWT/Team credential risks remain.
- A final read-only Function check found it enabled, `execute: ["any"]`, with
  no schedule, Node 26 runtime and a 15-second timeout. Deployment
  `6ae5dfe01def1704bf8e` remains active. Public manual invocation is still
  possible; this setting was not changed and remains an operator review item.
- The live reminder Function and Site settings were not changed. All old app,
  Function, local, preview, and privileged writers must be drained before the
  coordinated rollout. Site configuration/URL coverage remains an operator gate.
  See [release rollout](release-rollout.md).
- The two original local servers remain running; the additional QA listener on
  `127.0.0.1:3001` also remains running. Nothing was stopped.
- All reset/seed/admin tools, credentials, manifests, journals, logs, generated
  records, and screenshots remain excluded. Nothing is staged or committed.

## Changed files
- `README.md`
- `docs/data-model.md`
- `docs/hardening-verification.md`
- `docs/release-rollout.md`
- `functions/reminders/src/engine.js`
- `functions/reminders/src/occurrence-identity.js`
- `package.json`
- `scripts/caregiver-policy-test.mts`
- `scripts/demo-protection-test.mts`
- `scripts/hardening-test.mts`
- `scripts/logout-test.mts`
- `scripts/occurrence-identity-test.mts`
- `scripts/race-test.mts`
- `scripts/safety-test.mts`
- `src/app/api/auth/logout/route.ts`
- `src/app/api/invitations/route.ts`
- `src/app/api/onboarding/route.ts`
- `src/components/access-revoked-screen.tsx`
- `src/components/care-dashboard.tsx`
- `src/components/onboarding-screen.tsx`
- `src/lib/auth/invitation.ts`
- `src/lib/auth/revoke-session.ts`
- `src/lib/data/complete-occurrence.ts`
- `src/lib/data/create-care-circle.ts`
- `src/lib/data/ensure-occurrences.ts`
- `src/lib/data/manage-alerts.ts`
- `src/lib/data/manage-caregivers.ts`
- `src/lib/data/manage-occurrence-claim.ts`
- `src/lib/data/manage-recipient.ts`
- `src/lib/data/manage-schedule.ts`
- `src/lib/data/membership-fence.ts`
- `src/lib/data/team-authorization.ts`

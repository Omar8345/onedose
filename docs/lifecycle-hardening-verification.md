# Lifecycle hardening verification — 1 November 2026

Baseline: `317f7a756aef4dece2bb6a1f268101032968fc3a`. This report covers the
complete local hardening diff, including the preceding authorization fixes.
Nothing is staged, committed, pushed, deployed, reset, or reseeded. No live
Function settings were changed and no running servers were stopped.

## Reproductions and targeted corrections

1. **Stale materialization reproduced:** a paused worker read a daily schedule,
   an edit made it future-only and removed today's pending occurrence, then the
   old worker created one obsolete occurrence. The app and worker now import one
   schedule-lifecycle implementation. Permanent private `sched_` counters in the
   existing fence table bound creation against the authoritative schedule and
   parent lifecycle changes in the same transaction. This is commit-time
   arbitration, not a dashboard filter or a post-commit reread. Parent batches
   are atomic; failed initial batches cannot expose parents to a worker before
   compensating deletion. Ordinary views of already materialized tasks stay
   read-only. No schema change, backfill, identity migration, or dependency was added.
2. **Function exposure verified read-only:** no application client invokes the
   Function. Live execution still allows `any`; the proposed permission plan
   removes client execution and unused user scopes. Required runtime capabilities
   are `rows.read`, `rows.write`, `teams.read`, and `messages.write`. Document/vector
   compatibility aliases need operator confirmation. The metadata-only preflight
   correctly remains BLOCKED (exit 2). It is a mandatory deployment gate, not an
   applied settings change.
3. **Completed retiming reproduced:** completion committed after an editor read
   a pending occurrence; the old editor then changed its completed timing. Edits
   now commit parent and pending-occurrence changes atomically, using both the
   permanent schedule and occurrence fences. If completion wins, the editor's
   whole transaction fails and timing, events, and receipts remain unchanged.
4. **Counter conflict classification:** membership-counter contention with no
   occurrence change now returns `caregiver_conflict` (HTTP 409), rather than
   alleging a different claim holder. Availability uses the same classification.
   Genuine ownership/state changes retain authoritative conflict handling;
   failed transactions never report success. Provider failures are not normalized
   into successful mutations or automatically retried.
5. **Revoked recovery:** activation checks confirmed Team membership and the
   permanent member counter. Fresh membership creation and counter advancement
   are atomic. Revoked caregivers require explicit owner/admin restoration;
   a new invitation or profile update cannot restore them. Profile activation
   failures cannot return successful activation. UI wording explains this policy;
   confirmed invitation intent is retained to support a subsequent authorized
   restoration. Login does not reset counters or change existing roles.

The counter bound relies on Appwrite atomic increments being replayed with the
other staged operations at commit. The stale-transaction rejection behavior was
empirically verified on the configured Appwrite environment; a bare version
increment or a reread is not used as compare-and-swap.

## Executed verification

The main serial run completed **20/20 checks successfully** from 04:08:50 to
04:36:10 UTC on 1 November 2026:

- Original nine: schedules, reminders, safety, caregivers, recipients, race,
  demo authentication, snapshot recovery, and demo protection.
- Existing fencing, lifecycle, fixture cleanup, hardening, occurrence identity,
  and current-session logout suites.
- New materialization, conflict-classification, and recovery suites.
- Strict HTTP replay/takeover and legacy-fence/ambiguous-response audits.

Detailed race evidence:

| Check | Observed result |
| --- | --- |
| New materialization suite | 14 groups passed: six future-only exclusions, four retiming races, 25 simultaneous app/worker creators, two completion-winning retimes, and failed-parent-batch isolation |
| Stale materializers | Zero stale commits; same-ID deletion/recreation remained safe |
| Simultaneous app/worker creation | Exactly one occurrence from 25 contenders on an empty day |
| Completion-winning retiming | Zero editor commits; completed timing, audit events, and receipts unchanged at both occurrence-read and pre-commit barriers |
| Counter contention | Four paused losing mutations; zero partial writes or false claim changes |
| HTTP availability contention | 12 requests: one committed success, 11 recoverable conflicts, zero unexpected responses |
| Existing fencing takeover | Six 25-way rounds: six winners, 144 accurate conflicts; 150 non-holder completions rejected |
| Holder completion contention | Six 25-way rounds: one accepted completion per round, 24 already-recorded responses per round |
| Controlled stale-holder interleavings | Five scenarios; zero stale commits |
| Natural release/completion races | Three rounds; one successful transition each |
| Existing lifecycle regression | Three same-ID recreation rounds; zero stale commits/events/receipts; concurrent edits had one winner |
| Strict HTTP expired takeover | Five 25-way rounds: five winners, 120 conflicts; 125 non-holder completions rejected, five holder completions accepted |
| HTTP initial claims | Two rounds of 25 HTTP 200 responses: one `claimed` and 24 `already_claimed` bodies each; not 25 claim transitions |
| Cross-runtime identity | Three ID formats, 25 generators, three retiming rounds per format; original history/receipts preserved |
| Ambiguous committed response | Deliberately injected post-commit 503 surfaced; authoritative event/receipt existed once; replay did not add another transition |
| Recovery | Fresh activation, revoked rejection, manual restoration, absent/unavailable invitation, and commit-paused activation versus revocation passed |

The initial development run exposed a CJS/ESM Appwrite exception-class mismatch;
shared lifecycle error classification was corrected to inspect exact numeric
status/type fields. The subsequent formal materialization suite passed. That
initial failed run is not represented as passing.

After final lifecycle fast-exit and atomic-parent-batch changes, affected
schedule/reminder/recipient suites were rechecked. The first supplemental schedule
run passed its business assertions but **exited 1 during cleanup**: TablesDB row
DELETE raised `TypeError: fetch failed`, cause `UND_ERR_CONNECT_TIMEOUT`, after
10 seconds connecting to `151.101.131.52:443`. There was no HTTP status or Appwrite
error type; the SDK exception did not identify the individual row. This is a
separate infrastructure failure, not a passing cleanup or an application assertion.

No ambiguous deletion was blindly retried. Authoritative reads found zero
synthetic resources, then five spaced DNS/authenticated-read checks passed.
One fresh-fixture supplemental run subsequently passed all three affected suites
serially (04:42:36, 04:42:59, 04:43:21 UTC), followed by successful cleanup and
Mitchell snapshot audits. The earlier timeout remains recorded independently.

Final lint, TypeScript, production build, Function JavaScript syntax checks, and
`git diff --check` passed. Dependencies and lockfiles are unchanged. README is
290 lines. Public files were checked against configured secret values and for
private tooling/artifacts; no secrets, generated fixtures, logs, backups, or
private journals are included in the changed-file list.

## Preservation and limitations

- Final authoritative audit: zero test-owned rows across all 12 application
  tables, zero synthetic Auth users, and zero synthetic Teams.
- Mitchell rows, Team, memberships, and three identities match the before-run
  snapshot (SHA-256 `1c9cdc5923e8610eacbe295dea0ecf83450621281b9ac6b6fbda17061e218ead`).
- No production fence cleanup was performed. All three counter namespaces remain
  permanent and private; existing records initialize lazily.
- Actual confirmed synthetic Team memberships and profile HTTP routes were
  tested. SMTP delivery and a real emailed invitation-secret round trip were not.
- Local worker engine behavior was exercised against Appwrite; the live Function
  was not invoked because it sweeps production circles. Its reduced runtime key,
  hosted Node 26 execution, timeout, and scope aliases require approved operator
  verification before release. No client workflow needs public execution.
- Existing shared-account/direct Appwrite credential limitations remain accepted;
  database membership fencing cannot make external Team service changes atomic.
- Deployment remains blocked by Function permissions and the existing operator
  Site/URL/maintenance gates. Inventory and drain all four local listeners (two
  port-3000 servers, QA ports 3001 and 3002), hosted old writers and Function
  execution before coordinated app/worker activation. None was stopped here.
- Manual restoration is deliberately not a public endpoint. Follow the atomic
  counter-and-membership restoration protocol in `release-rollout.md`.
- Same-caregiver cross-task conflicts require an explicit refresh/retry; there
  is no automatic write retry. Uncertain provider outcomes need read-back.

## Complete changed-file list

This includes the earlier hardening changes still uncommitted against the baseline,
not only the files newly edited in this follow-up. Local evidence/tooling remains
ignored and private.

47 files; nothing staged.

- `README.md`
- `docs/data-model.md`
- `docs/hardening-verification.md`
- `docs/lifecycle-hardening-verification.md`
- `docs/release-rollout.md`
- `functions/reminders/permission-plan.json`
- `functions/reminders/src/engine.js`
- `functions/reminders/src/occurrence-identity.js`
- `functions/reminders/src/schedule-lifecycle.js`
- `package.json`
- `scripts/caregiver-policy-test.mts`
- `scripts/conflict-classification-test.mts`
- `scripts/demo-protection-test.mts`
- `scripts/hardening-test.mts`
- `scripts/logout-test.mts`
- `scripts/materialization-test.mts`
- `scripts/occurrence-identity-test.mts`
- `scripts/race-test.mts`
- `scripts/recovery-test.mts`
- `scripts/reminder-preflight.mts`
- `scripts/safety-test.mts`
- `src/app/api/auth/logout/route.ts`
- `src/app/api/auth/profile/route.ts`
- `src/app/api/circle/availability/route.ts`
- `src/app/api/invitations/accept/route.ts`
- `src/app/api/invitations/route.ts`
- `src/app/api/occurrences/[occurrenceId]/claim/route.ts`
- `src/app/api/occurrences/[occurrenceId]/complete/route.ts`
- `src/app/api/onboarding/route.ts`
- `src/components/access-revoked-screen.tsx`
- `src/components/care-dashboard.tsx`
- `src/components/invite-screen.tsx`
- `src/components/onboarding-screen.tsx`
- `src/lib/auth/activate-circle-member.ts`
- `src/lib/auth/activation-policy.ts`
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

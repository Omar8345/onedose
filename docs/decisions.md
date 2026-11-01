# Decision log

## 001 — use TablesDB

**Status:** accepted

OneDose uses Appwrite TablesDB because the core data is structured and related:
care circles have members and recipients, schedules produce occurrences, and
occurrences have attempts and audit events.

TablesDB transactions and conflict detection are part of the product's central
guarantee. Relationships, indexes, row permissions, and Realtime support the
surrounding collaboration experience.

## 002 — prove concurrency before building the interface

**Status:** accepted

The atomic completion path and its automated race test will be implemented
before the full application shell. A polished interface cannot compensate for
a duplicate-completion race.

## 003 — keep history append-only

**Status:** accepted

Corrections add an event that supersedes a previous event. The original record
remains available for the handoff timeline and audit view.

## 004 — serialize completion through the occurrence row

**Status:** accepted

Claim acquisition, expired takeover, release, completion, and correction share
bounded atomic increments in their existing TablesDB transactions. An unbounded
increment or assigning `observedVersion + 1` is not compare-and-swap.

The occurrence's own version is insufficient: schedule editing can delete a due
occurrence and recreate its deterministic ID at version zero. Live lifecycle
regressions reproduced stale completions committing across that reset.

`occurrence_fences` holds a server-private, permanent counter per occurrence ID.
Each mutation reads that counter **before** the occurrence used for decisions,
then increments it with `max: observedCounter + 1` in the same transaction as its
occurrence/lease/event/receipt changes. The existing occurrence-version bound is
retained. Lifecycle deletion advances the permanent counter and removes the old
lease atomically; it never removes the counter. Recreation and background
generation may reset the occurrence version but cannot reset its durable fence.
Do not prune these counters when occurrences or schedules are removed.

Atomic numeric bounds and transaction rollback are documented Appwrite primitives;
their combination is empirically verified against the configured server, including
increment-first commit-time bound rejection. A post-commit reread is response data,
not a concurrency guard. Reverify against new Appwrite server/SDK versions.

`npm run test:fencing` covers distinct-caregiver contention and paused lease
transitions; `npm run test:lifecycle` covers real schedule deletion/recreation,
concurrent edits, fresh-generation completion, and completed history preservation.
`npm run test:fixture-cleanup` simulates a lost membership-creation response and
checks that discovery removes only the owning fixture's rows.

The same transaction touches active membership, creates an append-only audit
event, and writes a deterministic idempotency receipt. A partial history or a
completion without its audit evidence cannot be committed.

## 005 — use Appwrite Teams as the invitation boundary

**Status:** accepted

Circle owners invite caregivers through an authenticated Appwrite Team request.
Recipients must accept the emailed membership secret and then confirm their
identity through OneDose's Email OTP flow. Before linking a user to a circle,
the server verifies that the signed-in account has a confirmed membership in
that Team. The browser never supplies a trusted circle or membership role.

## 006 — route reminders by availability and deduplicate delivery in TablesDB

**Status:** accepted

An Appwrite Function runs every 60 minutes, the minimum interval supported by
the current Appwrite plan, to create missing daily occurrences
and evaluate due items. The owner selects a first contact and a delay. The first
available contact receives the due reminder, which starts the escalation timer;
if the action remains incomplete when that timer expires, every available
caregiver receives the escalation. Availability and circle settings
determine routing. If the selected contact is unavailable, the available owner
receives the first reminder; if neither is available, one available caregiver
is selected deterministically before the later group escalation. Availability
and circle settings live in separate TablesDB tables so access membership
remains an independent safety boundary. Each `occurrenceId:kind` pair claims one server-only delivery
row and one deterministic Messaging ID, so retries do not spam caregivers.

## 007 — authenticate Realtime with short-lived user tokens

**Status:** accepted

The site keeps the long-lived Appwrite session secret in an HTTP-only cookie.
An authenticated server route exchanges the current session for a one-hour JWT,
which the browser uses only for Appwrite Realtime. Subscriptions listen to
occurrences, audit events, schedules, and memberships, while existing Team row
permissions decide which events each caregiver may receive.

## 008 — archive care actions instead of deleting history

**Status:** accepted

Only the care-circle owner can remove a care action. Removal disables the
schedule and records `archivedAt`, so it creates no future occurrences or
reminders while existing occurrences and handoff events remain auditable.


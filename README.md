# OneDose

OneDose is a shared care handoff that prevents two caregivers from recording
the same scheduled action twice.

The product focuses on one claim: when two authorized caregivers act on the
same due item concurrently, exactly one completion is accepted and every
attempt remains explainable.

Built for the 2026 Appwrite Databases Hackathon with Appwrite TablesDB.

**Live app:** [onedose.appwrite.network](https://onedose.appwrite.network)

## Current foundation

The current foundation includes:

- a responsive Today view for shared scheduled actions
- a handoff timeline that preserves corrections
- a guided outcome-recording flow
- an interactive conflict demo showing which concurrent attempt won
- Appwrite browser and server client boundaries
- passwordless Email OTP authentication and private Appwrite Teams
- authenticated Appwrite Realtime updates across caregiver sessions
- secure caregiver invitations with Appwrite Team acceptance
- caregiver availability that suppresses alerts without removing access
- owner-configured first-contact and overdue escalation rules
- an owner-only alert activity ledger backed by TablesDB delivery records
- transactional onboarding for a user's first circle and daily action
- 15-minute handling leases that stop two caregivers from performing the same action
- owner-managed daily, weekday, and one-time actions with pause, resume, and history-preserving removal
- multiple care-recipient profiles with per-person time zones, context, and one-person or bulk action assignment
- a shared recipient filter across Today and Handoff, with recipient-aware history and alert records
- a scheduled Appwrite Function for recurrence-aware generation, first-contact reminders, and overdue escalation
- a provisioned TablesDB schema and atomic completion service
- a live seeded dashboard and completion flow backed by TablesDB

The seed remains available for repeatable testing, while real users can sign in,
create their own private care circle, and record a shared outcome.

## Live deployment

OneDose is deployed with server-side rendering on Appwrite Sites. The live app
uses Appwrite Email OTP authentication, private Teams for care-circle access,
and TablesDB for schedules, completion attempts, and the audit trail.

## Run locally

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The public Appwrite
endpoint, project ID, and database ID are included in `.env.example`. Add your
own server API key to `.env.local`; never commit it. The key needs TablesDB
schema/read/write permissions, `sessions.read`, `sessions.write`, `users.read`,
`users.write`, `teams.read`, and `teams.write` for the server-rendered Email OTP,
invitation, caregiver revocation, Messaging target, and short-lived Realtime
token flows.

Provision the TablesDB schema after adding an API key with database schema
permissions:

```bash
npm run db:provision
```

The command is idempotent: it creates missing tables and verifies tables that
already exist. It stops instead of silently changing an incomplete schema.

Seed a synthetic care circle after provisioning the schema:

```bash
npm run db:seed
```

The seed command is also idempotent. It creates Nora's care circle, two demo
caregivers, a daily midday schedule, and one due occurrence for the current
Dubai date. The rows use deterministic IDs and remain server-only until the
Appwrite Auth and Teams onboarding flow is connected.

Run the live concurrency proof after provisioning and seeding:

```bash
npm run test:race
```

Verify reminder routing and idempotency after provisioning:

```bash
npm run test:reminders
```

The reminder proof creates one due item and one overdue item, runs competing
sweeps, and verifies that the first contact gets the due reminder while every
available caregiver gets the escalation. An unavailable caregiver is excluded.
It runs in dry-run mode and removes its synthetic rows afterward.

Verify that outsiders are rejected and retries remain idempotent:

```bash
npm run test:safety
```

The safety proof rejects a non-member completion, accepts one authorized
completion, replays an identical request without another write, and rejects a
changed payload that reuses the same idempotency key. It then races 25
corrections against the winning event, accepts exactly one, preserves both
audit entries, and rejects a stale correction without overwriting the winner.

Verify caregiver revocation policy protections:

```bash
npm run test:caregivers
```

The caregiver proof creates temporary Appwrite users and a Team, revokes a real
Team membership, verifies the persisted member is revoked, and confirms the
caregiver's next mutation is rejected. It also checks owner protection and the
pending-invitation cancellation policy, then removes all temporary data.

Verify care-profile ownership, assignment, and archival protections:

```bash
npm run test:recipients
```

The recipient proof creates and edits synthetic profiles, rejects a caregiver
write, assigns one action to multiple profiles as independent schedules,
prevents archival while those actions remain active, then confirms
history-preserving archival.

The production worker lives in [`functions/reminders`](functions/reminders).
Deploy that folder as an Appwrite Function with a 60-minute interval, grant
`rows.read`, `rows.write`, `messages.write`, and `teams.read`, and configure an
Appwrite email provider. Full settings are in the function's README.

The race test confirms two caregiver views see the same due occurrence, sends
25 simultaneous handling claims and accepts exactly one, then sends
25 completion requests at the same time through the real completion service.
It requires exactly one accepted request, one audit event, one command receipt,
and a final version of one. The other 24 requests must return the recorded
winner, and both refreshed views must converge on that result. Test rows are
removed when the run finishes; set `KEEP_RACE_DATA=1` to inspect them afterward.

## Product contract

The safety invariants and edge cases are documented in
[`docs/product.md`](docs/product.md). Technical choices are recorded in
[`docs/decisions.md`](docs/decisions.md). The TablesDB tables, indexes,
permissions, and completion transaction are described in
[`docs/data-model.md`](docs/data-model.md).

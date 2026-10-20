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
- secure caregiver invitations with Appwrite Team acceptance
- transactional onboarding for a user's first circle and daily action
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
schema/read/write permissions plus `sessions.read` and `sessions.write` for the
server-rendered Email OTP session flow.

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

The test confirms two caregiver views see the same due occurrence, then sends
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

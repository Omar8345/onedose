# OneDose

**Shared care. One clear record.**

![OneDose — shared care, one clear record](public/onedose-hero.png)

### 🎬 Product Demo

**[▶ Watch the OneDose Demo (1:51)](https://cap.so/s/41tw3xw36n2g1yj)**

A 1-minute, 51-second walkthrough of OneDose's shared care coordination, handling claims, and real-time handoffs.

When care is shared across a family, messages and memory aren't enough.

Did someone handle the medication? Who's taking care of the next task? Was an action completed, skipped, or simply forgotten?

**OneDose replaces uncertainty with a shared, real-time record of care.**

Caregivers can coordinate recurring tasks, claim responsibility, record outcomes, and follow a clear history of what happened — all inside a private care circle.

**[🚀 Live App](https://onedose.appwrite.network)** · **[🎬 Watch Demo](https://cap.so/s/41tw3xw36n2g1yj)** · **[Source Code](https://github.com/Omar8345/onedose)**

Built for the **2026 Appwrite Databases Hackathon**.

> **Live demo note:** Automated email reminders and overdue alerts are disabled in the hosted demo due to Appwrite plan limitations. The notification functionality is implemented in the source code and can be enabled with the appropriate plan and email provider configuration. Core care-coordination features remain available.

---

## What OneDose does

OneDose brings everyday care coordination into a single shared workflow.

| Feature                  | How it works                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Today dashboard**      | View due, upcoming, and overdue actions for each care recipient.                                                                                 |
| **Handling claims**      | Claim responsibility so other caregivers know an action is being handled.                                                                        |
| **Guided outcomes**      | Record completed, skipped, refused, or unavailable actions, with optional notes.                                                                 |
| **Live handoffs**        | See updates across caregiver sessions without refreshing.                                                                                        |
| **Flexible schedules**   | Create daily, weekly, selected-weekday, or one-time actions with time-zone awareness.                                                            |
| **Private care circles** | Invite trusted caregivers, manage roles, and coordinate multiple recipients.                                                                     |
| **Preserved history**    | Review past actions and corrections without silently overwriting earlier records.                                                                |
| **Smart reminders**      | An implemented notification workflow that prioritizes available caregivers and escalates overdue actions. Currently inactive in the hosted demo. |

### Designed around accountability

Each care action follows a simple sequence:

1. **Due** — An action appears on the shared schedule.
2. **Claimed** — A caregiver takes responsibility.
3. **Recorded** — The caregiver submits an outcome.
4. **Synchronized** — Other caregivers see the updated state.
5. **Preserved** — The outcome becomes part of an auditable history.

The result is a shared record that answers three essential questions:

**What needs to happen? Who is handling it? What actually happened?**

---

## Built on Appwrite

Appwrite powers OneDose's authentication, data persistence, permissions, synchronization, background processing, and deployment.

| Service       | Role                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **TablesDB**  | Stores care circles, recipients, schedules, occurrences, handling leases, outcomes, audit events, and command receipts. |
| **Auth**      | Provides passwordless Email OTP authentication.                                                                         |
| **Teams**     | Manages private care-circle membership, invitations, roles, and access revocation.                                      |
| **Realtime**  | Synchronizes care updates across authenticated sessions.                                                                |
| **Functions** | Supports scheduled occurrence generation and reminder processing.                                                       |
| **Messaging** | Implements notification delivery and escalation workflows, currently inactive in the hosted demo.                       |
| **Sites**     | Hosts the Next.js application.                                                                                          |

### Architecture

```mermaid
flowchart TD
    A[Caregivers] --> B[Next.js · Appwrite Sites]
    B --> C[Auth + Teams]
    B <--> D[(Appwrite TablesDB)]
    D --> E[Appwrite Realtime]
    E --> B
    F[Scheduled Functions] --> D
    F -.-> G[Messaging · Optional Alerts]
    G -.-> A
```

Appwrite isn't merely used to store data. Its database and permission model support the consistency and access controls behind the entire product.

---

## One completion. Even under contention.

What happens when two caregivers try to complete the same action simultaneously?

OneDose is designed to accept **one authoritative completion**, reject conflicting writes, and keep every authenticated caregiver's view consistent.

The repository includes an integration race test against live Appwrite TablesDB infrastructure.

### Verified concurrency test

25 concurrent handling claims and 25 concurrent completion requests were executed against the same logical care action.

| Verification                     |     Result |
| -------------------------------- | ---------: |
| Handling claims accepted         | **1 / 25** |
| Competing claims rejected        |    24 / 25 |
| Completions accepted             | **1 / 25** |
| Conflicting completions rejected |    24 / 25 |
| Audit events created             |          1 |
| Command receipts created         |          1 |
| Authenticated views converged    |        Yes |

**50 competing requests. Two successful writes across the two phases. No duplicate completion.**

### How it works

OneDose combines:

- **Handling leases** to coordinate temporary responsibility.
- **Optimistic version checks** to detect conflicting updates.
- **Idempotency receipts** to prevent duplicate command processing.
- **Append-only audit events** to preserve recorded history.
- **Realtime synchronization** to propagate authoritative state to connected caregivers.

Retries can return the previously recorded result without creating a second completion.

---

## Hosted demo and feature availability

The hosted version focuses on the core coordination experience: private care circles, schedules, handling claims, recorded outcomes, history, and live synchronization.

**Automated email reminders and overdue escalation are currently disabled in the hosted demo due to Appwrite plan limitations.**

The reminder and escalation implementation remains in the repository, along with integration tests for caregiver selection, availability fallback, overdue escalation, and duplicate-delivery prevention.

These notification features require separate delivery configuration and can be re-enabled in a suitable deployment.

Passwordless authentication remains available through Appwrite's built-in email delivery service.

OneDose is a coordination and record-keeping application, not a medical monitoring service. It should not be relied upon for emergency alerts or time-critical medical notifications.

---

## Run locally

### Requirements

- Node.js 20 or newer
- An Appwrite project with TablesDB enabled
- An Appwrite API key with the necessary permissions

### 1. Clone the repository

```bash
git clone https://github.com/Omar8345/onedose.git
cd onedose
npm install
```

### 2. Configure the environment

```bash
cp .env.example .env.local
```

The example environment documents the public endpoint, project ID, and database ID.

Add your own server API key to `.env.local`.

Required permissions include:

- TablesDB schema, read, and write access
- `sessions.read`, `sessions.write`
- `users.read`, `users.write`
- `teams.read`, `teams.write`

**Never commit API keys or other secrets to version control.**

### 3. Provision TablesDB

```bash
npm run db:provision
```

Provisioning is idempotent: it creates missing tables, validates existing structures, and stops when it detects an incompatible or incomplete schema.

Optional synthetic development data:

```bash
npm run db:seed
```

Seed data is isolated from authenticated production care circles.

### 4. Start the development server

```bash
npm run dev
```

Visit **http://localhost:3000**.

---

## Tests and verification

OneDose includes integration tests covering its scheduling, access-control, notification, and concurrency behavior.

```bash
npm run lint
npm run build
npm run test:schedules
npm run test:reminders
npm run test:safety
npm run test:caregivers
npm run test:recipients
npm run test:race
```

| Test              | Coverage                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| `test:schedules`  | Recurrence, schedule changes, pause/resume, removal permissions, and history preservation.         |
| `test:reminders`  | Caregiver selection, availability fallback, overdue escalation, and duplicate-delivery protection. |
| `test:safety`     | Membership authorization, idempotent retries, concurrent corrections, and stale-write rejection.   |
| `test:caregivers` | Membership revocation, invitation cancellation, owner protection, and access removal.              |
| `test:recipients` | Profile permissions, bulk assignment, recipient isolation, and archival.                           |
| `test:race`       | Concurrent claims and completion requests with a single accepted winner per phase.                 |

Integration tests interact with real Appwrite services and clean up their temporary test records.

To retain race-test data for inspection:

```bash
KEEP_RACE_DATA=1 npm run test:race
```

---

## Scheduled automation and reminders

The automation worker is located in [`functions/reminders`](functions/reminders).

Its implementation supports:

1. Generating scheduled occurrences.
2. Finding due and overdue actions.
3. Selecting the first available caregiver.
4. Delivering an initial reminder.
5. Escalating unresolved actions to other available caregivers.
6. Preventing repeated deliveries through durable notification records.

The hosted demo does not currently send automated reminder or escalation emails.

### Optional deployment

To enable the complete worker in your own Appwrite project:

| Setting        | Value                                                     |
| -------------- | --------------------------------------------------------- |
| Root directory | `functions/reminders`                                     |
| Entrypoint     | `src/main.js`                                             |
| Build command  | `npm install`                                             |
| Schedule       | Every 60 minutes                                          |
| Scopes         | `rows.read`, `rows.write`, `messages.write`, `teams.read` |

Configure an Appwrite Messaging email provider before enabling real email delivery.

Keep delivery in dry-run mode until provider configuration and recipient routing have been verified.

See [`functions/reminders/README.md`](functions/reminders/README.md) for the full setup.

---

## Technical documentation

For a closer look at the system:

- **[Product specification](docs/product.md)** — User journeys, safety invariants, application boundaries, and edge cases.
- **[Data model](docs/data-model.md)** — TablesDB schema, indexes, permissions, occurrence generation, and concurrency handling.
- **[Architecture decisions](docs/decisions.md)** — Tradeoffs behind concurrency, auditing, access control, Realtime, reminders, and archival.

---

## Why OneDose?

Shared care depends on more than remembering a schedule.

It depends on knowing whether someone has taken responsibility, whether the action actually happened, and whether everyone is looking at the same information.

**OneDose turns scattered coordination into one clear, traceable handoff.**

Built with **Next.js and Appwrite** for the **2026 Appwrite Databases Hackathon**.

**[🚀 Launch OneDose](https://onedose.appwrite.network)** · **[🎬 Watch Demo (1:51)](https://cap.so/s/41tw3xw36n2g1yj)**

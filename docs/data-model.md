# TablesDB data model

OneDose stores structured care coordination data in Appwrite TablesDB. The
database is part of the product guarantee: transactions and conflict detection
decide which concurrent completion wins.

## Tables

### `care_circles`

| Column | Type | Notes |
| --- | --- | --- |
| `name` | string(100) | Display name |
| `teamId` | string(36) | Appwrite Team that owns the circle |
| `timezone` | string(64) | IANA timezone such as `Asia/Dubai` |
| `archivedAt` | datetime, nullable | Soft archive marker |

Indexes: unique `teamId`; key `archivedAt`.

### `circle_members`

Row ID is a deterministic hash of `circleId:userId`.

| Column | Type | Notes |
| --- | --- | --- |
| `circleId` | string(36) | Care circle |
| `userId` | string(36) | Appwrite user |
| `role` | enum | `owner`, `caregiver`, or `viewer` |
| `status` | enum | `active` or `revoked` |
| `lastMutationAt` | datetime, nullable | Touched by writes to detect concurrent revocation |

Indexes: unique composite `circleId,userId`; key `userId,status`.

### `care_recipients`

| Column | Type | Notes |
| --- | --- | --- |
| `circleId` | string(36) | Owning circle |
| `displayName` | string(100) | Synthetic or user-provided display name |
| `archivedAt` | datetime, nullable | Soft archive marker |

Index: key `circleId,archivedAt`.

### `schedules`

| Column | Type | Notes |
| --- | --- | --- |
| `circleId` | string(36) | Owning circle |
| `recipientId` | string(36) | Recipient |
| `title` | string(120) | Human-readable action |
| `instruction` | string(500), nullable | Coordination instructions only |
| `localTime` | string(5) | `HH:mm` in the circle timezone |
| `timezone` | string(64) | IANA timezone captured with schedule |
| `rrule` | string(500) | Recurrence rule |
| `active` | boolean | Whether new occurrences are generated |
| `archivedAt` | datetime, nullable | Soft archive marker; history remains linked |

Indexes: key `circleId,active`; key `recipientId,active`; key `circleId,archivedAt`.

### `occurrences`

This is the contested row. Every completion transaction updates the same
occurrence, so simultaneous caregivers cannot both commit.

| Column | Type | Notes |
| --- | --- | --- |
| `circleId` | string(36) | Owning circle |
| `teamId` | string(36) | Read-permission target |
| `scheduleId` | string(36) | Source schedule |
| `dueAt` | datetime | UTC instant |
| `status` | enum | `due`, `completed`, `skipped`, `refused`, `unavailable` |
| `outcome` | enum, nullable | Recorded outcome |
| `completedBy` | string(36), nullable | Winning caregiver |
| `completedAt` | datetime, nullable | User-confirmed occurrence time |
| `activeEventId` | string(36), nullable | Current audit event |
| `claimedBy` | string(36), nullable | Caregiver currently handling the action |
| `claimedAt` | datetime, nullable | When the current handling lease began |
| `claimExpiresAt` | datetime, nullable | Lease expiry; another caregiver may claim afterward |
| `version` | integer | Incremented by every accepted mutation |

Indexes: unique composite `scheduleId,dueAt`; key `circleId,status,dueAt`; key
`circleId,claimExpiresAt`.

### Handling lease

Before performing a due action, a caregiver selects **I’m handling this**.
TablesDB serializes concurrent updates to the occurrence row, so one caregiver
receives a 15-minute lease and every other session immediately sees who is
handling it. The caregiver may release the lease, completion clears it, and an
expired lease can be taken over. Initial completion requires a live lease owned
by the authenticated caregiver; corrections remain append-only and do not need
a lease.

### `audit_events`

Append-only history. Corrections create another event whose
`supersedesEventId` points to the earlier event.

| Column | Type | Notes |
| --- | --- | --- |
| `circleId` | string(36) | Owning circle |
| `occurrenceId` | string(36) | Affected occurrence |
| `actorId` | string(36) | Caregiver who acted |
| `type` | enum | Initially `outcome_recorded` or `outcome_corrected` |
| `outcome` | enum | Recorded outcome |
| `note` | string(500), nullable | Handoff context |
| `occurredAt` | datetime | User-confirmed time |
| `recordedAt` | datetime | Server write time |
| `supersedesEventId` | string(36), nullable | Prior event for corrections |

Indexes: key `circleId,recordedAt`; key `occurrenceId,recordedAt`.

### `occurrence_claims`

The deterministic row ID is derived from the occurrence ID. Creating this row
is the database arbitration point for simultaneous **I’m handling this**
requests, so only one transaction can own the active lease.

| Column | Type | Notes |
| --- | --- | --- |
| `circleId` | string(36) | Owning circle |
| `occurrenceId` | string(36) | Due occurrence; unique |
| `actorId` | string(36) | Caregiver holding the lease |
| `claimedAt` | datetime | Lease start |
| `expiresAt` | datetime | Lease expiry |

Indexes: unique `occurrenceId`; key `circleId,expiresAt`.

### `command_receipts`

Internal idempotency records. Row ID is a deterministic hash of
`actorId:idempotencyKey`; clients cannot read or write this table directly.

| Column | Type | Notes |
| --- | --- | --- |
| `occurrenceId` | string(36) | Target occurrence |
| `actorId` | string(36) | Authenticated caller |
| `requestFingerprint` | string(64) | Detects key reuse with different data |
| `result` | enum | Initially `accepted` |
| `eventId` | string(36) | Audit event created by the command |
| `completedAt` | datetime | Recorded occurrence time |

Indexes: key `occurrenceId`; key `actorId`.

### `notification_deliveries`

Server-only delivery ledger for reminders and overdue escalations. The row ID
and unique index are derived from `occurrenceId:kind`, so repeated or concurrent
function executions cannot enqueue the same notification twice.

| Column | Type | Notes |
| --- | --- | --- |
| `circleId` | string(36) | Owning circle |
| `occurrenceId` | string(36) | Due occurrence |
| `kind` | enum | `due` or `overdue` |
| `status` | enum | `claimed`, `sent`, `failed`, or `dry_run` |
| `recipientCount` | integer | Active caregivers targeted |
| `claimedAt` | datetime | Claim time for retry control |
| `sentAt` | datetime, nullable | Message enqueue time |
| `lastError` | string(500), nullable | Retry-safe failure detail |
| `messageId` | string(36) | Deterministic Appwrite Messaging ID |

Indexes: unique composite `occurrenceId,kind`; key `circleId,claimedAt`; key
`status,claimedAt`.

### `caregiver_preferences`

Stores each caregiver's alert availability independently from their access.
Rows are unique by `circleId,userId` and contain `availability` plus `updatedAt`.

### `care_circle_settings`

Stores one circle-level alert policy: `primaryUserId`, `escalationMinutes`, and
`updatedAt`. Escalation is limited to 60–720 minutes to match the deployment
plan's hourly Function schedule.

## Reminder sweep

1. The hourly function materializes missing daily occurrences in each circle's
   timezone.
2. It selects active, due occurrences and excludes unavailable caregivers.
3. The first run targets the selected contact, an available owner, or one
   deterministic available fallback.
4. The successful first reminder starts the configured escalation timer.
5. A later hourly run targets every available caregiver when the timer expires.
6. A deterministic delivery row and Messaging ID protect retries after partial
   failure.
7. Failed claims can be retried after 15 minutes; completed claims are skipped.

## Atomic completion

1. Return the existing receipt when an idempotency key has already committed.
2. Start a short TablesDB transaction.
3. Read the occurrence and active membership inside the transaction.
4. Require an unexpired handling lease owned by the caregiver.
5. Touch membership so a simultaneous revocation conflicts with the write.
6. Update the contested occurrence row and clear its handling lease.
7. Create an immutable audit event whose deterministic ID is derived from the
   occurrence. Concurrent contenders therefore claim the same unique row, so
   Appwrite can commit only one of their transactions.
8. Create the winning request's private command receipt.
9. Commit all operations together.
10. On a `409` conflict, fetch the occurrence and return the winning state.

The free TablesDB tier supports up to 100 operations per transaction. This
flow uses four staged writes.

## Permissions

- Care-circle rows are readable by the circle's Appwrite Team.
- Owners invite caregivers through Appwrite Team memberships; acceptance is
  followed by Email OTP before OneDose activates the matching member row.
- Browser clients do not receive direct create, update, or delete permission
  for occurrences, events, memberships, or command receipts.
- A server route authenticates the user, derives `actorId` from the session,
  checks active membership, and performs mutations with the server SDK.
- `actorId`, `circleId`, and team permissions are never trusted from browser
  display state.

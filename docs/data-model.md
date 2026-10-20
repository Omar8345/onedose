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

Indexes: key `circleId,active`; key `recipientId,active`.

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
| `version` | integer | Incremented by every accepted mutation |

Indexes: unique composite `scheduleId,dueAt`; key `circleId,status,dueAt`.

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

## Atomic completion

1. Return the existing receipt when an idempotency key has already committed.
2. Start a short TablesDB transaction.
3. Read the occurrence and active membership inside the transaction.
4. Touch membership so a simultaneous revocation conflicts with the write.
5. Update the contested occurrence row.
6. Create an immutable audit event whose deterministic ID is derived from the
   occurrence. Concurrent contenders therefore claim the same unique row, so
   Appwrite can commit only one of their transactions.
7. Create the winning request's private command receipt.
8. Commit all operations together.
9. On a `409` conflict, fetch the occurrence and return the winning state.

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

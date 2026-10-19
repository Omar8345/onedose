# Product contract

## User

OneDose is for family members and trusted helpers coordinating routine care at
home. It gives everyone the same view of what is due, what happened, and what
still needs attention.

## Core promise

For each scheduled occurrence, OneDose accepts at most one active completion.
Concurrent clicks, repeated requests, stale screens, and network retries must
not create duplicate completions.

## Product boundaries

OneDose coordinates and records care. It does not diagnose conditions,
recommend medication, calculate dosages, replace professional advice, or claim
that a recorded action occurred without human confirmation.

The demonstration uses synthetic people and schedules.

## Primary flow

1. A caregiver opens the shared Today view.
2. They select a due action and review its instructions.
3. They record it as completed, skipped, refused, or unavailable.
4. Appwrite commits the occurrence state and audit event together.
5. Every connected caregiver receives the resulting state.
6. A later correction adds history instead of rewriting it.

## Safety invariants

- A scheduled occurrence has no more than one active completion.
- Every mutation has an idempotency key.
- A successful completion and its audit event are committed atomically.
- Corrections never erase the original event.
- Revoked members cannot read or change new care-circle data.
- The client never presents an unconfirmed write as saved.
- Times are stored in UTC and shown in the care circle's selected timezone.
- The server, rather than the browser, decides whether a completion wins.

## Proof scenario

Two authorized caregiver sessions attempt to complete the same occurrence at
nearly the same time. One transaction succeeds. The other receives the winning
state and identifies who recorded it and when. A repeat of either request
returns the existing result without creating another completion.

## Edge-case checklist

### Concurrency and delivery

- simultaneous caregivers
- accidental double-click
- request retry after a timeout
- response lost after a successful commit
- stale browser tab
- offline client reconnect
- duplicate idempotency key with different data

### Scheduling

- schedule edited while an occurrence is due
- care-circle timezone change
- daylight-saving transition
- action crossing midnight
- optional and as-needed actions
- skipped, refused, unavailable, and missed outcomes

### History and access

- correction of the wrong outcome
- correction of the wrong timestamp
- caregiver removed while a tab remains open
- expired or replayed invitation
- care recipient archived with existing history
- attempted deletion of referenced records

### Experience and failure

- empty and first-run states
- slow Appwrite response
- temporary Appwrite failure
- Realtime disconnect and recovery
- keyboard-only operation
- reduced motion and screen-reader labels

## Success criteria

- An automated race test sends at least 25 completion attempts and observes one
  active completion.
- Retry tests produce no duplicate audit events.
- Permission tests prove care circles cannot read one another's rows.
- Transaction failure leaves neither a partial completion nor a partial audit.
- Two browser sessions visibly converge on the same state.
- The complete demonstration can be understood in under three minutes.


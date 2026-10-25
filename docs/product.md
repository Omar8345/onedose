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

1. An owner invites a caregiver through their private Appwrite Team.
2. The owner creates one or more care profiles and assigns a daily, weekday, or one-time action to
   one or several people. Multi-person assignment creates an independent action
   and completion record for every selected person.
3. The caregiver accepts the emailed link and confirms their identity with OTP.
4. Both caregivers open the shared Today view.
   They can view everyone together or focus Today and Handoff on one recipient.
5. One selects a due action and reviews its instructions.
6. One caregiver claims the action before performing it; every other session sees who is handling it.
7. They record it as completed, skipped, refused, or unavailable.
8. Appwrite commits the occurrence state and audit event together.
9. Every connected caregiver receives the resulting state.
10. A later correction adds history instead of rewriting it.
11. Caregivers can pause alerts while unavailable without losing circle access.
12. The owner chooses a first contact and an escalation delay; overdue alerts
    then fan out to all available caregivers.

## Safety invariants

- A scheduled occurrence has no more than one active completion.
- A due occurrence has no more than one active 15-minute handling lease.
- Every mutation has an idempotency key.
- A successful completion and its audit event are committed atomically.
- Corrections never erase the original event.
- Revoked members cannot read or change new care-circle data.
- The client never presents an unconfirmed write as saved.
- Times are stored in UTC and shown in the care circle's selected timezone.
- The server, rather than the browser, decides whether a completion wins.
- Unavailable caregivers never receive due or overdue notifications.
- Notification retries do not create duplicate deliveries.
- Alert delivery metadata is shown only to the care-circle owner.
- Every daily action belongs to one active care profile; archiving a profile
  cannot orphan an active action.
- A bulk assignment is a creation shortcut, never a shared completion state.
- Occurrences are generated only when the action's recurrence rule matches the
  recipient's local date.

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
- Two caregiver views visibly converge on the same state.
- The complete demonstration can be understood in under three minutes.


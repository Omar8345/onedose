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

Every outcome mutation updates its occurrence inside a TablesDB transaction.
Two caregivers acting concurrently therefore contend on the same row. Appwrite
allows one transaction to commit and rejects the stale transaction with a
conflict; the rejected request refetches and returns the winner.

The same transaction touches active membership, creates an append-only audit
event, and writes a deterministic idempotency receipt. A partial history or a
completion without its audit evidence cannot be committed.


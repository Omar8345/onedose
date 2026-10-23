import { z } from "zod";
import type { Models } from "node-appwrite";

export const TABLES = {
  circles: "care_circles",
  members: "circle_members",
  recipients: "care_recipients",
  schedules: "schedules",
  occurrences: "occurrences",
  events: "audit_events",
  commands: "command_receipts",
  notifications: "notification_deliveries",
} as const;

export const completionInputSchema = z.object({
  occurrenceId: z.string().min(1).max(36),
  actorId: z.string().min(1).max(36),
  idempotencyKey: z.string().min(16).max(200),
  outcome: z.enum(["completed", "skipped", "refused", "unavailable"]),
  note: z.string().trim().max(500).optional(),
  occurredAt: z.iso.datetime(),
  correctsEventId: z.string().min(1).max(36).optional(),
});

export type CompletionInput = z.infer<typeof completionInputSchema>;

export type OccurrenceRow = Models.Row & {
  circleId: string;
  teamId: string;
  scheduleId: string;
  dueAt: string;
  status: "due" | "completed" | "skipped" | "refused" | "unavailable";
  outcome: "completed" | "skipped" | "refused" | "unavailable" | null;
  completedBy: string | null;
  completedAt: string | null;
  activeEventId: string | null;
  version: number;
};

export type MemberRow = Models.Row & {
  circleId: string;
  userId: string;
  role: "owner" | "caregiver" | "viewer";
  status: "active" | "revoked";
  lastMutationAt: string | null;
};

export type CommandReceiptRow = Models.Row & {
  occurrenceId: string;
  actorId: string;
  requestFingerprint: string;
  result: "accepted";
  eventId: string;
  completedAt: string;
};

export type CompletionResult =
  | { kind: "accepted"; occurrence: OccurrenceRow; eventId: string }
  | { kind: "corrected"; occurrence: OccurrenceRow; eventId: string }
  | { kind: "replayed"; occurrence: OccurrenceRow; eventId: string }
  | { kind: "already_recorded"; occurrence: OccurrenceRow };

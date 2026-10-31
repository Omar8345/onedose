export type RecordedOutcome = "completed" | "skipped" | "refused" | "unavailable";
export type OccurrenceStatus = "overdue" | "due" | "upcoming" | RecordedOutcome;

export type Occurrence = {
  id: string;
  recipientId: string;
  recipientName: string;
  time: string;
  title: string;
  detail: string;
  instruction: string;
  status: OccurrenceStatus;
  completedBy?: string;
  completedAt?: string;
  activeEventId?: string;
  claimedBy?: string;
  claimedByName?: string;
  claimedAt?: string;
  claimExpiresAt?: string;
  claimIsMine?: boolean;
};

export type TimelineEvent = {
  occurrenceId?: string;
  occurredAt?: string;
  actorName?: string;
  outcome?: RecordedOutcome;
  id: string;
  recipientId: string;
  recipientName: string;
  dateKey: string;
  dateLabel: string;
  time: string;
  title: string;
  detail: string;
  tone: "success" | "neutral" | "attention";
};

export type CareSchedule = {
  id: string;
  recipientId: string;
  recipientName: string;
  title: string;
  instruction: string;
  localTime: string;
  timezone: string;
  rrule: string;
  active: boolean;
};

export type CareRecipient = {
  id: string;
  displayName: string;
  relationship: string;
  careNotes: string;
  timezone: string;
};

export type Caregiver = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: "owner" | "caregiver" | "viewer";
  status: "active" | "pending";
  availability: "available" | "unavailable";
};

export type AlertActivity = {
  id: string;
  recipientId: string;
  recipientName: string;
  kind: "due" | "overdue";
  status: "claimed" | "sent" | "failed" | "dry_run";
  title: string;
  dateLabel: string;
  time: string;
  recipientCount: number;
};

export type CareCircle = {
  id: string;
  teamId: string;
  recipient: string;
  recipients: CareRecipient[];
  timezone: string;
  dateLabel: string;
  viewerRole: "owner" | "caregiver" | "viewer";
  viewerAvailability: "available" | "unavailable";
  alertSettings: { primaryUserId: string; escalationMinutes: number };
  alertActivity: AlertActivity[];
  members: { id: string; name: string; initials: string; color: string; availability: "available" | "unavailable" }[];
  caregivers: Caregiver[];
  schedules: CareSchedule[];
  occurrences: Occurrence[];
  timeline: TimelineEvent[];
};

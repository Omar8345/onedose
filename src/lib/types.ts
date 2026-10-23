export type RecordedOutcome = "completed" | "skipped" | "refused" | "unavailable";
export type OccurrenceStatus = "overdue" | "due" | "upcoming" | RecordedOutcome;

export type Occurrence = {
  id: string;
  time: string;
  title: string;
  detail: string;
  instruction: string;
  status: OccurrenceStatus;
  completedBy?: string;
  completedAt?: string;
  activeEventId?: string;
};

export type TimelineEvent = {
  id: string;
  dateKey: string;
  dateLabel: string;
  time: string;
  title: string;
  detail: string;
  tone: "success" | "neutral" | "attention";
};

export type CareSchedule = {
  id: string;
  title: string;
  instruction: string;
  localTime: string;
  active: boolean;
};

export type CareCircle = {
  id: string;
  recipient: string;
  timezone: string;
  dateLabel: string;
  viewerRole: "owner" | "caregiver" | "viewer";
  members: { id: string; name: string; initials: string; color: string }[];
  schedules: CareSchedule[];
  occurrences: Occurrence[];
  timeline: TimelineEvent[];
};

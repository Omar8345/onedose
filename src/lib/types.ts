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

export type Caregiver = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: "owner" | "caregiver" | "viewer";
  status: "active" | "pending";
  availability: "available" | "unavailable";
};

export type CareCircle = {
  id: string;
  teamId: string;
  recipient: string;
  timezone: string;
  dateLabel: string;
  viewerRole: "owner" | "caregiver" | "viewer";
  viewerAvailability: "available" | "unavailable";
  alertSettings: { primaryUserId: string; escalationMinutes: number };
  members: { id: string; name: string; initials: string; color: string; availability: "available" | "unavailable" }[];
  caregivers: Caregiver[];
  schedules: CareSchedule[];
  occurrences: Occurrence[];
  timeline: TimelineEvent[];
};

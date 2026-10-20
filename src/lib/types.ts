export type OccurrenceStatus = "due" | "upcoming" | "completed";

export type Occurrence = {
  id: string;
  time: string;
  title: string;
  detail: string;
  instruction: string;
  status: OccurrenceStatus;
  completedBy?: string;
  completedAt?: string;
};

export type TimelineEvent = {
  id: string;
  time: string;
  title: string;
  detail: string;
  tone: "success" | "neutral" | "attention";
};

export type CareCircle = {
  recipient: string;
  timezone: string;
  dateLabel: string;
  viewerRole: "owner" | "caregiver" | "viewer";
  members: { id: string; name: string; initials: string; color: string }[];
  occurrences: Occurrence[];
  timeline: TimelineEvent[];
};

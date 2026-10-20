import type { CareCircle } from "@/lib/types";

export const demoCircle: CareCircle = {
  viewerRole: "owner",
  recipient: "Nora’s care",
  timezone: "Asia/Dubai · UTC+4",
  dateLabel: "Monday, 19 October",
  members: [
    { name: "Omar", initials: "OM", color: "coral" },
    { name: "Maya", initials: "MC", color: "sage" },
    { name: "Sam", initials: "SK", color: "amber" },
  ],
  occurrences: [
    {
      id: "occ-morning-checkin",
      time: "8:00 AM",
      title: "Morning check-in",
      detail: "With breakfast",
      instruction: "Confirm after breakfast and add a note if anything changed.",
      status: "completed",
      completedBy: "Maya",
      completedAt: "8:04 AM",
    },
    {
      id: "occ-midday-action",
      time: "12:30 PM",
      title: "Midday routine",
      detail: "One scheduled action",
      instruction: "Record the outcome once the routine is complete.",
      status: "due",
    },
    {
      id: "occ-evening-checkin",
      time: "7:00 PM",
      title: "Evening check-in",
      detail: "After dinner",
      instruction: "Confirm after dinner and leave a short handoff note.",
      status: "upcoming",
    },
  ],
  timeline: [
    {
      id: "evt-1",
      time: "8:04 AM",
      title: "Morning check-in completed",
      detail: "Maya recorded it · Breakfast finished normally",
      tone: "success",
    },
    {
      id: "evt-2",
      time: "Yesterday · 9:18 PM",
      title: "Handoff note added",
      detail: "Sam: Tomorrow’s schedule is ready. Nothing unusual to flag.",
      tone: "neutral",
    },
    {
      id: "evt-3",
      time: "Yesterday · 7:06 PM",
      title: "Evening check-in corrected",
      detail: "Omar corrected “skipped” to “completed”; both events remain in history.",
      tone: "attention",
    },
  ],
};

import { localDateKey, localDateTimeAsUtc } from "@/lib/domain/time";

export const WEEKDAYS = [
  { code: "MO", label: "Monday", short: "Mon" },
  { code: "TU", label: "Tuesday", short: "Tue" },
  { code: "WE", label: "Wednesday", short: "Wed" },
  { code: "TH", label: "Thursday", short: "Thu" },
  { code: "FR", label: "Friday", short: "Fri" },
  { code: "SA", label: "Saturday", short: "Sat" },
  { code: "SU", label: "Sunday", short: "Sun" },
] as const;

export type WeekdayCode = (typeof WEEKDAYS)[number]["code"];
export type ScheduleFrequency = "daily" | "weekly" | "once";
export type ScheduleRule =
  | { frequency: "daily"; weekdays: []; date: "" }
  | { frequency: "weekly"; weekdays: WeekdayCode[]; date: "" }
  | { frequency: "once"; weekdays: []; date: string };

const WEEKDAY_ORDER = new Map(WEEKDAYS.map((day, index) => [day.code, index]));

export function buildScheduleRrule(input: {
  frequency?: ScheduleFrequency;
  weekdays?: WeekdayCode[];
  date?: string;
}) {
  if (input.frequency === "weekly") {
    const weekdays = [...new Set(input.weekdays ?? [])]
      .sort((left, right) => (WEEKDAY_ORDER.get(left) ?? 0) - (WEEKDAY_ORDER.get(right) ?? 0));
    return `FREQ=WEEKLY;BYDAY=${weekdays.join(",")}`;
  }
  if (input.frequency === "once") return `FREQ=ONCE;DATE=${input.date ?? ""}`;
  return "FREQ=DAILY";
}

export function parseScheduleRrule(rrule: string): ScheduleRule {
  const values = new Map(rrule.split(";").map((part) => {
    const [key, ...rest] = part.split("=");
    return [key, rest.join("=")];
  }));
  if (values.get("FREQ") === "WEEKLY") {
    const allowed = new Set<WeekdayCode>(WEEKDAYS.map((day) => day.code));
    const weekdays = (values.get("BYDAY") ?? "")
      .split(",")
      .filter((value): value is WeekdayCode => allowed.has(value as WeekdayCode));
    return { frequency: "weekly", weekdays, date: "" };
  }
  if (values.get("FREQ") === "ONCE") {
    return { frequency: "once", weekdays: [], date: values.get("DATE") ?? "" };
  }
  return { frequency: "daily", weekdays: [], date: "" };
}

export function weekdayCode(date: Date, timezone: string): WeekdayCode {
  const label = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: timezone }).format(date);
  const match = WEEKDAYS.find((day) => day.short === label);
  return match?.code ?? "MO";
}

export function scheduleOccursToday(rrule: string, timezone: string, now = new Date()) {
  const rule = parseScheduleRrule(rrule);
  if (rule.frequency === "daily") return true;
  if (rule.frequency === "weekly") return rule.weekdays.includes(weekdayCode(now, timezone));
  return rule.date === localDateKey(now, timezone);
}

export function scheduleRuleLabel(rrule: string) {
  const rule = parseScheduleRrule(rrule);
  if (rule.frequency === "daily") return "Every day";
  if (rule.frequency === "weekly") {
    const labels = WEEKDAYS.filter((day) => rule.weekdays.includes(day.code)).map((day) => day.short);
    return labels.length === 7 ? "Every day" : labels.join(", ");
  }
  if (!rule.date) return "One time";
  const [year, month, day] = rule.date.split("-").map(Number);
  return `Once · ${new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(new Date(Date.UTC(year, month - 1, day)))}`;
}

export function nextScheduleOccurrence(
  rrule: string,
  localTime: string,
  timezone: string,
  now = new Date(),
) {
  const rule = parseScheduleRrule(rrule);
  if (rule.frequency === "once") {
    if (!rule.date) return null;
    const dueAt = new Date(localDateTimeAsUtc(rule.date, localTime, timezone));
    return dueAt.getTime() >= now.getTime() ? dueAt : null;
  }

  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(now.getTime() + offset * 24 * 60 * 60_000);
    if (!scheduleOccursToday(rrule, timezone, candidate)) continue;
    const dueAt = new Date(localDateTimeAsUtc(localDateKey(candidate, timezone), localTime, timezone));
    if (dueAt.getTime() >= now.getTime()) return dueAt;
  }
  return null;
}

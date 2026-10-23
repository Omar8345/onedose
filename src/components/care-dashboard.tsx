"use client";

import {
  Activity,
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Home,
  LogOut,
  Menu,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  X,
} from "lucide-react";
import { Channel, type RealtimeSubscription } from "appwrite";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { createRealtime } from "@/lib/appwrite/client";
import { TABLES } from "@/lib/domain/schema";
import type { CareCircle, CareSchedule, Occurrence } from "@/lib/types";

type View = "today" | "handoff" | "schedules";
type DemoState = "idle" | "confirm" | "saving" | "saved" | "race" | "error";
type LiveStatus = "connecting" | "live" | "reconnecting" | "offline";

type CompletionResponse = {
  kind: "accepted" | "replayed" | "already_recorded";
  occurrence: {
    id: string;
    status: string;
    completedBy: string | null;
    completedAt: string | null;
  };
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "CG";
}

export function CareDashboard({ circle, viewer }: { circle: CareCircle; viewer: { id: string; name: string; email: string } }) {
  const router = useRouter();
  const [view, setView] = useState<View>("today");
  const [demoState, setDemoState] = useState<DemoState>("idle");
  const [selected, setSelected] = useState<Occurrence | null>(null);
  const [occurrenceOverrides, setOccurrenceOverrides] = useState<Record<string, Occurrence>>({});
  const [note, setNote] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [scheduleEditor, setScheduleEditor] = useState<CareSchedule | "new" | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");
  const [isRefreshing, startRefresh] = useTransition();

  const occurrences = circle.occurrences.map((item) => occurrenceOverrides[item.id] ?? item);
  const dueCount = occurrences.filter((item) => item.status === "due").length;

  useEffect(() => {
    let disposed = false;
    let realtime: ReturnType<typeof createRealtime> | null = null;
    let subscription: RealtimeSubscription | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let renewalTimer: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      try {
        setLiveStatus("connecting");
        const response = await fetch("/api/auth/realtime", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok || typeof payload.jwt !== "string") {
          throw new Error(payload.message ?? "Live updates are unavailable.");
        }
        if (disposed) return;

        realtime = createRealtime(payload.jwt);
        realtime.onOpen(() => {
          if (!disposed) setLiveStatus("live");
        });
        realtime.onClose(() => {
          if (!disposed) setLiveStatus("reconnecting");
        });
        realtime.onError(() => {
          if (!disposed) setLiveStatus("offline");
        });

        const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID;
        if (!databaseId) throw new Error("The Appwrite database is not configured.");
        const channels = [
          Channel.tablesdb(databaseId).table(TABLES.occurrences).row(),
          Channel.tablesdb(databaseId).table(TABLES.events).row(),
          Channel.tablesdb(databaseId).table(TABLES.schedules).row(),
          Channel.tablesdb(databaseId).table(TABLES.members).row(),
        ];
        subscription = await realtime.subscribe(channels, (event) => {
          const changed = event.payload as { circleId?: string };
          if (disposed || changed.circleId !== circle.id) return;
          setLiveStatus("live");
          setOccurrenceOverrides({});
          if (refreshTimer) clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => startRefresh(() => router.refresh()), 120);
        });
        const renewAfterSeconds = Math.max(60, Number(payload.expiresIn ?? 3600) - 60);
        renewalTimer = setTimeout(() => {
          const currentSubscription = subscription;
          const currentRealtime = realtime;
          subscription = null;
          realtime = null;
          void Promise.allSettled([
            currentSubscription?.unsubscribe(),
            currentRealtime?.disconnect(),
          ]).then(() => {
            if (!disposed) void connect();
          });
        }, renewAfterSeconds * 1000);
      } catch (error) {
        if (!disposed) {
          console.error("Unable to connect OneDose live updates", error);
          setLiveStatus("offline");
        }
      }
    }

    void connect();
    return () => {
      disposed = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (renewalTimer) clearTimeout(renewalTimer);
      void subscription?.unsubscribe();
      void realtime?.disconnect();
    };
  }, [circle.id, router, startRefresh]);

  const openCompletion = (occurrence: Occurrence) => {
    setSelected(occurrence);
    setIdempotencyKey(crypto.randomUUID());
    setNote("");
    setErrorMessage("");
    setDemoState("confirm");
  };

  const confirmCompletion = async () => {
    if (!selected) return;
    setDemoState("saving");
    try {
      const response = await fetch(`/api/occurrences/${selected.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey, note: note || undefined }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "The outcome could not be recorded.");

      const result = payload as CompletionResponse;
      const completedBy = result.occurrence.completedBy
        ? result.occurrence.completedBy === viewer.id ? "You" : "Another caregiver"
        : "Caregiver";
      const completedAt = result.occurrence.completedAt
        ? new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(result.occurrence.completedAt))
        : "Now";

      const completed = { ...selected, status: "completed" as const, completedBy, completedAt };
      setOccurrenceOverrides((items) => ({ ...items, [completed.id]: completed }));
      setSelected(completed);
      setDemoState(result.kind === "already_recorded" ? "race" : "saved");
      startRefresh(() => router.refresh());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "The outcome could not be recorded.");
      setDemoState("error");
    }
  };

  const closeDialog = () => {
    setDemoState("idle");
    setSelected(null);
    setNote("");
    setIdempotencyKey("");
    setErrorMessage("");
  };

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.refresh();
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand-row">
          <Logo />
          <button className="icon-button mobile-only" aria-label="Open menu">
            <Menu size={19} />
          </button>
        </div>

        <div className="circle-switcher">
          <span className="eyebrow">Care circle</span>
          <div className="circle-switcher-row">
            <span className="avatar avatar--large">{initials(circle.recipient).slice(0, 1)}</span>
            <span>
              <strong>{circle.recipient}</strong>
              <small>{circle.members.length} caregivers</small>
            </span>
          </div>
        </div>

        <nav>
          <NavButton active={view === "today"} onClick={() => setView("today")} icon={<Home size={18} />}>
            Today
          </NavButton>
          <NavButton active={view === "handoff"} onClick={() => setView("handoff")} icon={<MessageSquareText size={18} />}>
            Handoff
          </NavButton>
          {circle.viewerRole === "owner" ? (
            <NavButton active={view === "schedules"} onClick={() => setView("schedules")} icon={<CalendarClock size={18} />}>
              Daily actions
            </NavButton>
          ) : null}
          {circle.viewerRole === "owner" ? (
            <NavButton onClick={() => setInviteOpen(true)} icon={<UserPlus size={18} />}>
              Invite caregiver
            </NavButton>
          ) : null}
        </nav>

        <div className="sidebar-proof">
          <ShieldCheck size={20} />
          <div>
            <strong>One clear record</strong>
            <p>Retries and double taps cannot create two completions.</p>
          </div>
        </div>

        <div className="profile-row">
          <span className="avatar avatar--coral">{initials(viewer.name)}</span>
          <span>
            <strong>{viewer.name}</strong>
            <small>{circle.viewerRole === "owner" ? "Owner" : "Caregiver"}</small>
          </span>
          <button className="sidebar-signout" onClick={signOut} title="Sign out" aria-label="Sign out">
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-mobile"><Logo /></div>
          <div className="presence">
            <div className="avatar-stack" aria-label={`${circle.members.length} caregivers in this circle`}>
              {circle.members.map((member) => (
                <span key={member.id} className={`avatar avatar--${member.color}`} title={member.name}>
                  {member.initials}
                </span>
              ))}
            </div>
            <span><i className={dueCount ? "presence-dot--due" : ""} /> {dueCount ? `${dueCount} due now` : "All caught up"}</span>
          </div>
          <span className={`live-sync live-sync--${liveStatus}`} role="status">
            <i /> {liveStatus === "live" ? "Live" : liveStatus === "offline" ? "Offline" : liveStatus === "reconnecting" ? "Reconnecting" : "Connecting"}
          </span>
          <button className="secondary-button" onClick={() => startRefresh(() => router.refresh())} disabled={isRefreshing}>
            <RefreshCw size={16} /> {isRefreshing ? "Refreshing…" : "Refresh live data"}
          </button>
        </header>

        {view === "today" ? (
          <TodayView
            circle={circle}
            occurrences={occurrences}
            onComplete={openCompletion}
            onOpenHandoff={() => setView("handoff")}
          />
        ) : view === "handoff" ? (
          <HandoffView circle={circle} occurrences={occurrences} />
        ) : (
          <ScheduleView circle={circle} onEdit={setScheduleEditor} />
        )}
      </section>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <button className={view === "today" ? "is-active" : ""} onClick={() => setView("today")}>
          <Home size={19} /><span>Today</span>
        </button>
        <button className={view === "handoff" ? "is-active" : ""} onClick={() => setView("handoff")}>
          <MessageSquareText size={19} /><span>Handoff</span>
        </button>
        {circle.viewerRole === "owner" ? (
          <button className={view === "schedules" ? "is-active" : ""} onClick={() => setView("schedules")}>
            <CalendarClock size={19} /><span>Actions</span>
          </button>
        ) : null}
        {circle.viewerRole === "owner" ? (
          <button onClick={() => setInviteOpen(true)}>
            <UserPlus size={19} /><span>Invite</span>
          </button>
        ) : null}
      </nav>

      {demoState !== "idle" && selected ? (
        <CompletionDialog
          state={demoState}
          occurrence={selected}
          note={note}
          errorMessage={errorMessage}
          onNoteChange={setNote}
          onConfirm={confirmCompletion}
          onClose={closeDialog}
          circleName={circle.recipient}
        />
      ) : null}

      {inviteOpen ? <InviteDialog onClose={() => setInviteOpen(false)} viewerEmail={viewer.email} /> : null}
      {scheduleEditor ? (
        <ScheduleDialog
          schedule={scheduleEditor === "new" ? null : scheduleEditor}
          onClose={() => setScheduleEditor(null)}
        />
      ) : null}
    </main>
  );
}

function ScheduleView({ circle, onEdit }: { circle: CareCircle; onEdit: (schedule: CareSchedule | "new") => void }) {
  return (
    <div className="page-content schedule-view">
      <div className="page-heading schedule-page-heading">
        <div>
          <span className="eyebrow">Care plan</span>
          <h1>Daily actions</h1>
          <p>Each active action creates one fresh record every local day.</p>
        </div>
        <button className="primary-button" onClick={() => onEdit("new")}><Plus size={18} /> Add action</button>
      </div>

      <div className="schedule-management-list">
        {circle.schedules.map((schedule) => (
          <article className={`schedule-management-card ${schedule.active ? "" : "is-paused"}`} key={schedule.id}>
            <div className="schedule-management-time">{formatLocalTime(schedule.localTime)}</div>
            <div>
              <div className="schedule-title-line">
                <h2>{schedule.title}</h2>
                <span className={`status-pill ${schedule.active ? "status-pill--completed" : "status-pill--upcoming"}`}>
                  {schedule.active ? "Active" : "Paused"}
                </span>
              </div>
              <p>{schedule.instruction || "No additional instructions."}</p>
            </div>
            <button className="secondary-button" onClick={() => onEdit(schedule)}><Pencil size={15} /> Edit</button>
          </article>
        ))}
        {!circle.schedules.length ? (
          <div className="schedule-empty">
            <CalendarClock size={28} />
            <h2>No daily actions yet</h2>
            <p>Add the first recurring care action for this circle.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatLocalTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })
    .format(new Date(Date.UTC(2020, 0, 1, hour, minute)));
}

function ScheduleDialog({ schedule, onClose }: { schedule: CareSchedule | null; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(schedule?.title ?? "");
  const [instruction, setInstruction] = useState(schedule?.instruction ?? "");
  const [localTime, setLocalTime] = useState(schedule?.localTime ?? "09:00");
  const [active, setActive] = useState(schedule?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) setClosing(true);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [saving]);

  function close() {
    if (!saving) setClosing(true);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(schedule ? `/api/schedules/${schedule.id}` : "/api/schedules", {
        method: schedule ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, instruction: instruction || undefined, localTime, active }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "The daily action could not be saved.");
      close();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The daily action could not be saved.");
      setSaving(false);
    }
  }

  return (
    <div className={`dialog-backdrop ${closing ? "dialog-backdrop--closing" : ""}`} role="presentation" onMouseDown={close} onAnimationEnd={() => { if (closing) onClose(); }}>
      <section className={`dialog schedule-dialog ${closing ? "dialog--closing" : ""}`} role="dialog" aria-modal="true" aria-labelledby="schedule-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="dialog-close" type="button" onClick={close} aria-label="Close" disabled={saving}><X size={19} /></button>
        <form onSubmit={save}>
          <span className="section-kicker">Daily schedule</span>
          <h2 id="schedule-title">{schedule ? "Edit daily action" : "Add a daily action"}</h2>
          <label className="invite-field">
            <span>Action name</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Morning routine" required />
          </label>
          <label className="invite-field">
            <span>Daily time</span>
            <input type="time" value={localTime} onChange={(event) => setLocalTime(event.target.value)} required />
          </label>
          <label className="note-field schedule-note-field">
            <span>Instructions <small>optional</small></span>
            <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="What should the caregiver know?" />
          </label>
          {schedule ? (
            <label className="schedule-active-field">
              <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
              <span><strong>Active every day</strong><small>Pause this to stop creating new daily records.</small></span>
            </label>
          ) : null}
          {message ? <p className="form-error">{message}</p> : null}
          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={close}>Cancel</button>
            <button className="primary-button" disabled={saving || title.trim().length < 2}>
              {saving ? "Saving…" : "Save action"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function InviteDialog({ onClose, viewerEmail }: { onClose: () => void; viewerEmail: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"form" | "sending" | "sent" | "error">("form");
  const [message, setMessage] = useState("");
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setClosing(true);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  async function sendInvitation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (email.trim().toLowerCase() === viewerEmail.trim().toLowerCase()) {
      setMessage("You cannot invite yourself to this care circle.");
      setStatus("error");
      return;
    }
    setStatus("sending");
    setMessage("");

    try {
      const response = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "The invitation could not be sent.");
      setStatus("sent");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The invitation could not be sent.");
      setStatus("error");
    }
  }

  function close() {
    setClosing(true);
  }

  return (
    <div className={`dialog-backdrop ${closing ? "dialog-backdrop--closing" : ""}`} role="presentation" onMouseDown={close} onAnimationEnd={() => { if (closing) onClose(); }}>
      <section className={`dialog invite-dialog ${closing ? "dialog--closing" : ""}`} role="dialog" aria-modal="true" aria-labelledby="invite-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="dialog-close" type="button" onClick={close} aria-label="Close"><X size={19} /></button>

        {status === "sent" ? (
          <div className="result-state">
            <span className="result-icon result-icon--success"><CheckCircle2 size={32} /></span>
            <span className="section-kicker">Invitation sent</span>
            <h2 id="invite-title">Check {email}</h2>
            <p>We sent an invitation link to their email. Once they accept it and sign in, they’ll have access to this shared care circle.</p>
            <button className="primary-button full-button" onClick={close}>Done</button>
          </div>
        ) : (
          <form onSubmit={sendInvitation}>
            <span className="section-kicker">Share this circle</span>
            <h2 id="invite-title">Invite a caregiver</h2>
            <p className="dialog-lead">They’ll get an email with a secure invitation to join this care circle.</p>
            <label className="invite-field">
              <span>Email address</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="caregiver@example.com"
                autoComplete="email"
                required
              />
            </label>
            {status === "error" ? <p className="form-error">{message}</p> : null}
            <div className="dialog-actions">
              <button className="secondary-button" type="button" onClick={close}>Cancel</button>
              <button className="primary-button" disabled={status === "sending" || !email.trim()}>
                <UserPlus size={18} /> {status === "sending" ? "Sending…" : "Send invitation"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function Logo() {
  return (
    <div className="logo" aria-label="OneDose">
      <span className="logo-mark"><i /><i /></span>
      <span>OneDose</span>
    </div>
  );
}

function NavButton({
  active = false,
  icon,
  children,
  onClick,
}: {
  active?: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button className={active ? "nav-button is-active" : "nav-button"} onClick={onClick}>
      {icon}<span>{children}</span>
    </button>
  );
}

function TodayView({
  circle,
  occurrences,
  onComplete,
  onOpenHandoff,
}: {
  circle: CareCircle;
  occurrences: Occurrence[];
  onComplete: (occurrence: Occurrence) => void;
  onOpenHandoff: () => void;
}) {
  const dueCount = occurrences.filter((item) => item.status === "due" || item.status === "overdue").length;
  const focus = occurrences.find((item) => item.status === "overdue")
    ?? occurrences.find((item) => item.status === "due")
    ?? occurrences.find((item) => item.status === "upcoming");

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <span className="eyebrow">{circle.dateLabel}</span>
          <h1>Today</h1>
          <p>{dueCount ? `${dueCount} action needs attention.` : "Everything due so far is recorded."}</p>
        </div>
        <div className="timezone"><Clock3 size={15} /> {circle.timezone}</div>
      </div>

      {focus ? <section className={`focus-card ${focus.status === "overdue" ? "focus-card--overdue" : ""}`}>
        <div className="focus-copy">
          <span className="section-kicker">Next up</span>
          <p className="focus-time">{focus.time.replace(/\s[AP]M$/, "")}</p>
          <span className="focus-meridiem">{focus.time.match(/[AP]M$/)?.[0]}</span>
        </div>
        <div className="focus-details">
          <span className={`status-pill status-pill--${focus.status}`}>
            {focus.status === "overdue" ? "Overdue" : focus.status === "due" ? "Due now" : "Upcoming"}
          </span>
          <h2>{focus.title}</h2>
          <p>{focus.detail}</p>
        </div>
        <button className="primary-button" onClick={() => onComplete(focus)}>
          Record outcome <ArrowRight size={18} />
        </button>
      </section> : (
        <section className="focus-card focus-card--complete">
          <div className="focus-complete-icon"><CheckCircle2 size={28} /></div>
          <div className="focus-details">
            <span className="status-pill status-pill--completed">All done</span>
            <h2>{occurrences.length ? "Everything is recorded" : "No actions scheduled"}</h2>
            <p>{occurrences.length ? "There is nothing left to record for today." : "Your care circle has no actions scheduled today."}</p>
          </div>
        </section>
      )}

      <div className="content-grid">
        <section>
          <div className="section-heading">
            <div><span className="eyebrow">Schedule</span><h2>Today’s care</h2></div>
          </div>
          <div className="schedule-list">
            {occurrences.map((item) => (
              <ScheduleRow key={item.id} item={item} onComplete={() => onComplete(item)} />
            ))}
          </div>
        </section>

        <aside className="activity-panel">
          <div className="section-heading">
            <div><span className="eyebrow">Live handoff</span><h2>What happened</h2></div>
            <Activity size={18} />
          </div>
          <div className="timeline">
            {circle.timeline.slice(0, 2).map((event) => (
              <div className={`timeline-item timeline-item--${event.tone}`} key={event.id}>
                <i />
                <span className="timeline-time">{event.time}</span>
                <strong>{event.title}</strong>
                <p>{event.detail}</p>
              </div>
            ))}
            {!circle.timeline.length ? <p className="empty-copy">No outcomes have been recorded yet.</p> : null}
          </div>
          <button className="wide-link" onClick={onOpenHandoff}>Open full handoff <ArrowRight size={16} /></button>
        </aside>
      </div>
    </div>
  );
}

function ScheduleRow({ item, onComplete }: { item: Occurrence; onComplete: () => void }) {
  return (
    <article className={`schedule-row schedule-row--${item.status}`}>
      <div className="schedule-time">{item.time}</div>
      <div className="schedule-marker">{item.status === "completed" ? <Check size={15} /> : <i />}</div>
      <div className="schedule-copy">
        <div className="schedule-title-line">
          <h3>{item.title}</h3>
          <span className={`status-pill status-pill--${item.status}`}>
            {item.status === "completed" ? "Completed" : item.status === "overdue" ? "Overdue" : item.status === "due" ? "Due now" : "Upcoming"}
          </span>
        </div>
        <p>{item.detail}</p>
        {item.completedBy ? <small>Recorded by {item.completedBy} · {item.completedAt}</small> : null}
      </div>
      {item.status === "due" || item.status === "overdue" ? <button className="row-action" onClick={onComplete}>Record <ArrowRight size={15} /></button> : null}
    </article>
  );
}

function HandoffView({ circle, occurrences }: { circle: CareCircle; occurrences: Occurrence[] }) {
  const dueCount = occurrences.filter((item) => item.status === "due" || item.status === "overdue").length;
  const eventGroups = circle.timeline.reduce<Array<{ key: string; label: string; events: CareCircle["timeline"] }>>(
    (groups, event) => {
      const current = groups.at(-1);
      if (current?.key === event.dateKey) current.events.push(event);
      else groups.push({ key: event.dateKey, label: event.dateLabel, events: [event] });
      return groups;
    },
    [],
  );
  return (
    <div className="page-content handoff-view">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Shared context</span>
          <h1>Handoff</h1>
          <p>A readable history for whoever takes over next.</p>
        </div>
      </div>

      <div className="handoff-layout">
        <section className="handoff-feed">
          {eventGroups.map((group) => (
            <div className="handoff-day" key={group.key}>
              <div className="date-divider"><span>{group.label}</span></div>
              {group.events.map((event) => (
                <article className="handoff-event" key={event.id}>
                  <span className={`event-icon event-icon--${event.tone}`}>
                    {event.tone === "success" ? <Check size={17} /> : event.tone === "attention" ? <CircleAlert size={17} /> : <MessageSquareText size={17} />}
                  </span>
                  <div>
                    <span className="timeline-time">{event.time}</span>
                    <h3>{event.title}</h3>
                    <p>{event.detail}</p>
                  </div>
                </article>
              ))}
            </div>
          ))}
          {!circle.timeline.length ? <p className="empty-copy">The handoff will appear here after the first recorded outcome.</p> : null}
        </section>
        <aside className="handoff-summary">
          <span className="section-kicker">Shift summary</span>
          <h2>Nothing urgent to carry forward.</h2>
          <p>{dueCount ? "The midday routine still needs an outcome." : "Every scheduled outcome is recorded."}</p>
          <div className="summary-stat"><strong>{dueCount}</strong><span>{dueCount === 1 ? "action due" : "actions due"}</span></div>
          <div className="summary-stat"><strong>{circle.members.length}</strong><span>caregivers synced</span></div>
        </aside>
      </div>
    </div>
  );
}

function CompletionDialog({
  state,
  occurrence,
  note,
  errorMessage,
  onNoteChange,
  onConfirm,
  onClose,
  circleName,
}: {
  state: DemoState;
  occurrence: Occurrence;
  note: string;
  errorMessage: string;
  onNoteChange: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
  circleName: string;
}) {
  const isResult = state === "saved" || state === "race" || state === "error";
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && state !== "saving") setClosing(true);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [state]);

  function close() {
    if (state !== "saving") setClosing(true);
  }

  return (
    <div className={`dialog-backdrop ${closing ? "dialog-backdrop--closing" : ""}`} role="presentation" onMouseDown={close} onAnimationEnd={() => { if (closing) onClose(); }}>
      <section className={`dialog ${state === "race" ? "dialog--race" : ""} ${closing ? "dialog--closing" : ""}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="dialog-close" type="button" onClick={close} aria-label="Close" disabled={state === "saving"}><X size={19} /></button>

        {state === "confirm" ? (
          <>
            <span className="section-kicker">Confirm outcome</span>
            <h2 id="dialog-title">Record {occurrence.title.toLowerCase()}</h2>
            <p className="dialog-lead">{occurrence.instruction}</p>
            <div className="detail-strip"><Clock3 size={17} /><span><small>Scheduled</small><strong>{occurrence.time}</strong></span></div>
            <label className="note-field">
              <span>Optional handoff note</span>
              <textarea value={note} onChange={(event) => onNoteChange(event.target.value)} placeholder="Anything the next caregiver should know?" />
            </label>
            <div className="dialog-actions">
              <button className="secondary-button" type="button" onClick={close}>Cancel</button>
              <button className="primary-button" type="button" onClick={onConfirm}><Check size={18} /> Confirm completion</button>
            </div>
          </>
        ) : null}

        {state === "saving" ? (
          <div className="result-state">
            <span className="spinner" />
            <span className="section-kicker">Checking the shared record</span>
            <h2 id="dialog-title">Saving this care update…</h2>
            <p>We’re making sure it is recorded only once.</p>
          </div>
        ) : null}

        {state === "saved" ? (
          <div className="result-state">
            <span className="result-icon result-icon--success"><CheckCircle2 size={32} /></span>
            <span className="section-kicker">Recorded</span>
            <h2 id="dialog-title">{occurrence.title} completed</h2>
            <p>Everyone in {circleName} now sees the same result.</p>
            <div className="proof-row"><ShieldCheck size={19} /><span><strong>Update and history saved together</strong><small>One confirmed record for everyone in the care circle</small></span></div>
          </div>
        ) : null}

        {state === "race" ? (
          <div className="result-state">
            <span className="result-icon result-icon--protected"><ShieldCheck size={34} /></span>
            <span className="section-kicker section-kicker--coral">Duplicate prevented</span>
            <h2 id="dialog-title">{occurrence.completedBy} already recorded this</h2>
            <p>Another caregiver confirmed this update first. Your screen now shows the shared record instead of creating a duplicate.</p>
          </div>
        ) : null}

        {state === "error" ? (
          <div className="result-state">
            <span className="result-icon result-icon--protected"><CircleAlert size={34} /></span>
            <span className="section-kicker section-kicker--coral">Not recorded</span>
            <h2 id="dialog-title">Please try again</h2>
            <p>{errorMessage}</p>
          </div>
        ) : null}

        {isResult ? <button className="primary-button full-button" type="button" onClick={close}>Back to today</button> : null}
      </section>
    </div>
  );
}

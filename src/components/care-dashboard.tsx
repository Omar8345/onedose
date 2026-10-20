"use client";

import {
  Activity,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Home,
  LogOut,
  Menu,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { CareCircle, Occurrence } from "@/lib/types";

type View = "today" | "handoff";
type DemoState = "idle" | "confirm" | "saving" | "saved" | "race" | "error";

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

export function CareDashboard({ circle, viewer }: { circle: CareCircle; viewer: { id: string; name: string } }) {
  const router = useRouter();
  const [view, setView] = useState<View>("today");
  const [demoState, setDemoState] = useState<DemoState>("idle");
  const [selected, setSelected] = useState<Occurrence | null>(null);
  const [occurrenceOverrides, setOccurrenceOverrides] = useState<Record<string, Occurrence>>({});
  const [note, setNote] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isRefreshing, startRefresh] = useTransition();

  const occurrences = circle.occurrences.map((item) => occurrenceOverrides[item.id] ?? item);
  const dueCount = occurrences.filter((item) => item.status === "due").length;

  const openCompletion = (occurrence: Occurrence) => {
    setSelected(occurrence);
    setIdempotencyKey(crypto.randomUUID());
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
        </nav>

        <div className="sidebar-proof">
          <ShieldCheck size={20} />
          <div>
            <strong>One clear record</strong>
            <p>Retries and double taps cannot create two completions.</p>
          </div>
        </div>

        <button className="profile-row" onClick={signOut} title="Sign out">
          <span className="avatar avatar--coral">{initials(viewer.name)}</span>
          <span>
            <strong>{viewer.name}</strong>
            <small>Owner · Sign out</small>
          </span>
          <LogOut size={15} />
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-mobile"><Logo /></div>
          <div className="presence">
            <div className="avatar-stack" aria-label={`${circle.members.length} caregivers in this circle`}>
              {circle.members.map((member) => (
                <span key={member.name} className={`avatar avatar--${member.color}`} title={member.name}>
                  {member.initials}
                </span>
              ))}
            </div>
            <span><i className={dueCount ? "presence-dot--due" : ""} /> {dueCount ? `${dueCount} due now` : "All caught up"}</span>
          </div>
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
        ) : (
          <HandoffView circle={circle} occurrences={occurrences} />
        )}
      </section>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <button className={view === "today" ? "is-active" : ""} onClick={() => setView("today")}>
          <Home size={19} /><span>Today</span>
        </button>
        <button className={view === "handoff" ? "is-active" : ""} onClick={() => setView("handoff")}>
          <MessageSquareText size={19} /><span>Handoff</span>
        </button>
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
    </main>
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
  const dueCount = occurrences.filter((item) => item.status === "due").length;
  const focus = occurrences.find((item) => item.status === "due") ?? occurrences.find((item) => item.status === "upcoming") ?? occurrences[0];

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

      {focus ? <section className="focus-card">
        <div className="focus-copy">
          <span className="section-kicker">Next up</span>
          <p className="focus-time">{focus.time.replace(/\s[AP]M$/, "")}</p>
          <span className="focus-meridiem">{focus.time.match(/[AP]M$/)?.[0]}</span>
        </div>
        <div className="focus-details">
          <span className={`status-pill status-pill--${focus.status}`}>{focus.status === "completed" ? "Recorded" : focus.status === "due" ? "Due now" : "Upcoming"}</span>
          <h2>{focus.title}</h2>
          <p>{focus.detail}</p>
        </div>
        <button className="primary-button" onClick={() => onComplete(focus)} disabled={focus.status === "completed"}>
          {focus.status === "completed" ? <><Check size={18} /> Recorded</> : <>Record outcome <ArrowRight size={18} /></>}
        </button>
      </section> : null}

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
            {item.status === "completed" ? "Completed" : item.status === "due" ? "Due now" : "Upcoming"}
          </span>
        </div>
        <p>{item.detail}</p>
        {item.completedBy ? <small>Recorded by {item.completedBy} · {item.completedAt}</small> : null}
      </div>
      {item.status === "due" ? <button className="row-action" onClick={onComplete}>Record <ArrowRight size={15} /></button> : null}
    </article>
  );
}

function HandoffView({ circle, occurrences }: { circle: CareCircle; occurrences: Occurrence[] }) {
  const dueCount = occurrences.filter((item) => item.status === "due").length;
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
          <div className="date-divider"><span>Today</span></div>
          {circle.timeline.map((event) => (
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

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className={`dialog ${state === "race" ? "dialog--race" : ""}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="dialog-close" onClick={onClose} aria-label="Close"><X size={19} /></button>

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
              <button className="secondary-button" onClick={onClose}>Cancel</button>
              <button className="primary-button" onClick={onConfirm}><Check size={18} /> Confirm completion</button>
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
            <p>Another completion reached Appwrite first. Your screen now shows the winning record instead of creating a duplicate.</p>
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

        {isResult ? <button className="primary-button full-button" onClick={onClose}>Back to today</button> : null}
      </section>
    </div>
  );
}

"use client";

import {
  Activity,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  History,
  Home,
  Menu,
  MessageSquareText,
  Plus,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { CareCircle, Occurrence } from "@/lib/types";

type View = "today" | "handoff";
type DemoState = "idle" | "confirm" | "saving" | "saved" | "race";

export function CareDashboard({ circle }: { circle: CareCircle }) {
  const [view, setView] = useState<View>("today");
  const [demoState, setDemoState] = useState<DemoState>("idle");
  const [selected, setSelected] = useState<Occurrence | null>(null);
  const [completed, setCompleted] = useState(false);
  const [completedBy, setCompletedBy] = useState<"You" | "Maya">("You");
  const [note, setNote] = useState("");

  const occurrences = useMemo(
    () =>
      circle.occurrences.map((item) =>
        completed && item.id === "occ-midday-action"
          ? {
              ...item,
              status: "completed" as const,
              completedBy,
              completedAt: "Now",
            }
          : item,
      ),
    [circle.occurrences, completed, completedBy],
  );

  const openCompletion = (occurrence: Occurrence) => {
    setSelected(occurrence);
    setDemoState("confirm");
  };

  const confirmCompletion = () => {
    setDemoState("saving");
    window.setTimeout(() => {
      setCompletedBy("You");
      setCompleted(true);
      setDemoState("saved");
    }, 750);
  };

  const runRace = () => {
    setSelected(circle.occurrences[1]);
    setDemoState("saving");
    window.setTimeout(() => {
      setCompletedBy("Maya");
      setCompleted(true);
      setDemoState("race");
    }, 900);
  };

  const closeDialog = () => {
    setDemoState("idle");
    setSelected(null);
    setNote("");
  };

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
          <button>
            <span className="avatar avatar--large">N</span>
            <span>
              <strong>{circle.recipient}</strong>
              <small>3 caregivers</small>
            </span>
            <ChevronDown size={16} />
          </button>
        </div>

        <nav>
          <NavButton active={view === "today"} onClick={() => setView("today")} icon={<Home size={18} />}>
            Today
          </NavButton>
          <NavButton active={view === "handoff"} onClick={() => setView("handoff")} icon={<MessageSquareText size={18} />}>
            Handoff
          </NavButton>
          <NavButton icon={<History size={18} />}>History</NavButton>
          <NavButton icon={<Users size={18} />}>Care circle</NavButton>
        </nav>

        <div className="sidebar-proof">
          <ShieldCheck size={20} />
          <div>
            <strong>One clear record</strong>
            <p>Retries and double taps cannot create two completions.</p>
          </div>
        </div>

        <div className="profile-row">
          <span className="avatar avatar--coral">OM</span>
          <span>
            <strong>Omar</strong>
            <small>Caregiver</small>
          </span>
          <ChevronDown size={15} />
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-mobile"><Logo /></div>
          <div className="presence">
            <div className="avatar-stack" aria-label="Three caregivers online">
              {circle.members.map((member) => (
                <span key={member.name} className={`avatar avatar--${member.color}`} title={member.name}>
                  {member.initials}
                </span>
              ))}
            </div>
            <span><i /> All caught up</span>
          </div>
          <button className="secondary-button" onClick={runRace}>
            <Sparkles size={16} /> Run conflict demo
          </button>
        </header>

        {view === "today" ? (
          <TodayView
            circle={circle}
            occurrences={occurrences}
            onComplete={openCompletion}
          />
        ) : (
          <HandoffView circle={circle} />
        )}
      </section>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <button className={view === "today" ? "is-active" : ""} onClick={() => setView("today")}>
          <Home size={19} /><span>Today</span>
        </button>
        <button className={view === "handoff" ? "is-active" : ""} onClick={() => setView("handoff")}>
          <MessageSquareText size={19} /><span>Handoff</span>
        </button>
        <button><History size={19} /><span>History</span></button>
        <button><Users size={19} /><span>Circle</span></button>
      </nav>

      {demoState !== "idle" && selected ? (
        <CompletionDialog
          state={demoState}
          occurrence={selected}
          note={note}
          onNoteChange={setNote}
          onConfirm={confirmCompletion}
          onClose={closeDialog}
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
}: {
  circle: CareCircle;
  occurrences: Occurrence[];
  onComplete: (occurrence: Occurrence) => void;
}) {
  const dueCount = occurrences.filter((item) => item.status === "due").length;

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

      <section className="focus-card">
        <div className="focus-copy">
          <span className="section-kicker">Next up</span>
          <p className="focus-time">12:30</p>
          <span className="focus-meridiem">PM</span>
        </div>
        <div className="focus-details">
          <span className="status-pill status-pill--due">Due now</span>
          <h2>Midday routine</h2>
          <p>One scheduled action · record the outcome when complete.</p>
        </div>
        <button className="primary-button" onClick={() => onComplete(occurrences[1])} disabled={occurrences[1].status === "completed"}>
          {occurrences[1].status === "completed" ? <><Check size={18} /> Recorded</> : <>Record outcome <ArrowRight size={18} /></>}
        </button>
      </section>

      <div className="content-grid">
        <section>
          <div className="section-heading">
            <div><span className="eyebrow">Schedule</span><h2>Today’s care</h2></div>
            <button className="text-button"><Plus size={16} /> Add action</button>
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
          </div>
          <button className="wide-link">Open full handoff <ArrowRight size={16} /></button>
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

function HandoffView({ circle }: { circle: CareCircle }) {
  return (
    <div className="page-content handoff-view">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Shared context</span>
          <h1>Handoff</h1>
          <p>A readable history for whoever takes over next.</p>
        </div>
        <button className="primary-button"><Plus size={17} /> Add note</button>
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
        </section>
        <aside className="handoff-summary">
          <span className="section-kicker">Shift summary</span>
          <h2>Nothing urgent to carry forward.</h2>
          <p>One correction is preserved in history. The midday routine still needs an outcome.</p>
          <div className="summary-stat"><strong>1</strong><span>action due</span></div>
          <div className="summary-stat"><strong>3</strong><span>caregivers synced</span></div>
        </aside>
      </div>
    </div>
  );
}

function CompletionDialog({
  state,
  occurrence,
  note,
  onNoteChange,
  onConfirm,
  onClose,
}: {
  state: DemoState;
  occurrence: Occurrence;
  note: string;
  onNoteChange: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const isResult = state === "saved" || state === "race";

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
            <span className="section-kicker">Checking current state</span>
            <h2 id="dialog-title">Saving one clear record…</h2>
            <p>The server decides which attempt wins.</p>
          </div>
        ) : null}

        {state === "saved" ? (
          <div className="result-state">
            <span className="result-icon result-icon--success"><CheckCircle2 size={32} /></span>
            <span className="section-kicker">Recorded</span>
            <h2 id="dialog-title">Midday routine completed</h2>
            <p>Everyone in Nora’s care circle now sees the same result.</p>
            <div className="proof-row"><ShieldCheck size={19} /><span><strong>Completion + audit event</strong><small>Committed together with one idempotency key</small></span></div>
          </div>
        ) : null}

        {state === "race" ? (
          <div className="result-state">
            <span className="result-icon result-icon--protected"><ShieldCheck size={34} /></span>
            <span className="section-kicker section-kicker--coral">Duplicate prevented</span>
            <h2 id="dialog-title">Maya’s completion won</h2>
            <p>You and Maya acted at nearly the same time. One completion was accepted; your screen received the winning state.</p>
            <div className="race-proof">
              <div><span className="race-dot race-dot--won" /><strong>Maya</strong><small>Accepted · 12:31:04.218</small></div>
              <div><span className="race-dot race-dot--stopped" /><strong>You</strong><small>Matched existing result · 12:31:04.241</small></div>
            </div>
          </div>
        ) : null}

        {isResult ? <button className="primary-button full-button" onClick={onClose}>Back to today</button> : null}
      </section>
    </div>
  );
}

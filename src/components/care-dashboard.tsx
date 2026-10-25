"use client";

import {
  Activity,
  ArrowRight,
  BellRing,
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
  ShieldCheck,
  Trash2,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import { Channel, type RealtimeSubscription } from "appwrite";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { createRealtime } from "@/lib/appwrite/client";
import { TABLES } from "@/lib/domain/schema";
import type {
  CareCircle,
  CareRecipient,
  CareSchedule,
  Occurrence,
  RecordedOutcome,
} from "@/lib/types";

type View = "today" | "handoff" | "schedules" | "caregivers";
type DemoState = "idle" | "confirm" | "saving" | "saved" | "race" | "error";
type LiveStatus = "connecting" | "live" | "reconnecting" | "offline";

type CompletionResponse = {
  kind: "accepted" | "corrected" | "replayed" | "already_recorded";
  occurrence: {
    id: string;
    status: string;
    outcome: RecordedOutcome | null;
    completedBy: string | null;
    completedAt: string | null;
    activeEventId: string | null;
  };
};

type ClaimResponse = {
  kind:
    | "claimed"
    | "already_claimed"
    | "already_recorded"
    | "released"
    | "not_claimed";
  occurrence: {
    id: string;
    status: string;
    claimedBy: string | null;
    claimedAt: string | null;
    claimExpiresAt: string | null;
  };
};

const OUTCOME_LABELS: Record<RecordedOutcome, string> = {
  completed: "Completed",
  skipped: "Skipped",
  refused: "Refused",
  unavailable: "Unavailable",
};

function isRecordedOutcome(
  value: Occurrence["status"],
): value is RecordedOutcome {
  return (
    value === "completed" ||
    value === "skipped" ||
    value === "refused" ||
    value === "unavailable"
  );
}

function occurrenceStatusLabel(value: Occurrence["status"]) {
  if (isRecordedOutcome(value)) return OUTCOME_LABELS[value];
  if (value === "overdue") return "Overdue";
  if (value === "due") return "Due now";
  return "Upcoming";
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "CG"
  );
}

function ClaimNote({
  occurrence,
  featured = false,
}: {
  occurrence: Occurrence;
  featured?: boolean;
}) {
  if (!occurrence.claimedByName) return null;
  return (
    <small className={`claim-note${featured ? " claim-note--featured" : ""}`}>
      {occurrence.claimIsMine
        ? "You’re handling this"
        : `${occurrence.claimedByName} is handling this`}{" "}
      · <ClaimCountdown expiresAt={occurrence.claimExpiresAt} />
    </small>
  );
}

function ClaimCountdown({ expiresAt }: { expiresAt?: string }) {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!expiresAt) return;
    const update = () =>
      setRemainingSeconds(
        Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000)),
      );
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  if (remainingSeconds === null) return <>hold expires soon</>;
  if (remainingSeconds === 0) return <>hold expired — available to claim</>;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return (
    <>
      unassigns in{" "}
      {minutes
        ? `${minutes}m ${String(seconds).padStart(2, "0")}s`
        : `${seconds}s`}
    </>
  );
}

export function CareDashboard({
  circle,
  viewer,
}: {
  circle: CareCircle;
  viewer: { id: string; name: string; email: string };
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("today");
  const [demoState, setDemoState] = useState<DemoState>("idle");
  const [selected, setSelected] = useState<Occurrence | null>(null);
  const [selectedOutcome, setSelectedOutcome] =
    useState<RecordedOutcome>("completed");
  const [correctionMode, setCorrectionMode] = useState(false);
  const [occurrenceOverrides, setOccurrenceOverrides] = useState<
    Record<string, Occurrence>
  >({});
  const [note, setNote] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [scheduleEditor, setScheduleEditor] = useState<
    CareSchedule | "new" | null
  >(null);
  const [recipientEditor, setRecipientEditor] = useState<
    CareRecipient | "new" | null
  >(null);
  const [recipientFilter, setRecipientFilter] = useState("all");
  const [scheduleToRemove, setScheduleToRemove] = useState<CareSchedule | null>(
    null,
  );
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");
  const [isRefreshing, startRefresh] = useTransition();
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [coordinationError, setCoordinationError] = useState("");

  const occurrences = circle.occurrences.map(
    (item) => occurrenceOverrides[item.id] ?? item,
  );
  const activeRecipientFilter =
    recipientFilter === "all" ||
    circle.recipients.some((recipient) => recipient.id === recipientFilter)
      ? recipientFilter
      : "all";
  const filteredOccurrences =
    activeRecipientFilter === "all"
      ? occurrences
      : occurrences.filter(
          (item) => item.recipientId === activeRecipientFilter,
        );
  const filteredTimeline =
    activeRecipientFilter === "all"
      ? circle.timeline
      : circle.timeline.filter(
          (event) => event.recipientId === activeRecipientFilter,
        );
  const dueCount = occurrences.filter(
    (item) => item.status === "due" || item.status === "overdue",
  ).length;
  const liveLabel =
    liveStatus === "live"
      ? isRefreshing
        ? "Syncing"
        : "Live updates"
      : liveStatus === "offline"
        ? "Offline"
        : liveStatus === "reconnecting"
          ? "Reconnecting"
          : "Connecting";

  useEffect(() => {
    let disposed = false;
    let realtime: ReturnType<typeof createRealtime> | null = null;
    let subscription: RealtimeSubscription | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let renewalTimer: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      try {
        setLiveStatus("connecting");
        const response = await fetch("/api/auth/realtime", {
          cache: "no-store",
        });
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
        if (!databaseId)
          throw new Error("The Appwrite database is not configured.");
        const channels = [
          Channel.team(circle.teamId),
          Channel.tablesdb(databaseId).table(TABLES.occurrences).row(),
          Channel.tablesdb(databaseId).table(TABLES.claims).row(),
          Channel.tablesdb(databaseId).table(TABLES.events).row(),
          Channel.tablesdb(databaseId).table(TABLES.schedules).row(),
          Channel.tablesdb(databaseId).table(TABLES.recipients).row(),
          Channel.tablesdb(databaseId).table(TABLES.members).row(),
          Channel.tablesdb(databaseId).table(TABLES.caregiverPreferences).row(),
          Channel.tablesdb(databaseId).table(TABLES.circleSettings).row(),
        ];
        subscription = await realtime.subscribe(channels, (event) => {
          const changed = event.payload as { circleId?: string };
          const isCircleChange = changed.circleId === circle.id;
          const isTeamChange = event.channels.some(
            (channel) => channel === Channel.team(circle.teamId).toString(),
          );
          if (disposed || (!isCircleChange && !isTeamChange)) return;
          setLiveStatus("live");
          setOccurrenceOverrides({});
          if (refreshTimer) clearTimeout(refreshTimer);
          refreshTimer = setTimeout(
            () => startRefresh(() => router.refresh()),
            120,
          );
        });
        const renewAfterSeconds = Math.max(
          60,
          Number(payload.expiresIn ?? 3600) - 60,
        );
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
  }, [circle.id, circle.teamId, router, startRefresh]);

  const openCompletion = (occurrence: Occurrence) => {
    setSelected(occurrence);
    setSelectedOutcome(
      isRecordedOutcome(occurrence.status) ? occurrence.status : "completed",
    );
    setCorrectionMode(Boolean(occurrence.activeEventId));
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
        body: JSON.stringify({
          idempotencyKey,
          outcome: selectedOutcome,
          note: note || undefined,
          correctsEventId: selected.activeEventId,
        }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.message ?? "The outcome could not be recorded.",
        );

      const result = payload as CompletionResponse;
      const completedBy = result.occurrence.completedBy
        ? result.occurrence.completedBy === viewer.id
          ? "You"
          : "Another caregiver"
        : "Caregiver";
      const completedAt = result.occurrence.completedAt
        ? new Intl.DateTimeFormat("en", {
            hour: "numeric",
            minute: "2-digit",
          }).format(new Date(result.occurrence.completedAt))
        : "Now";

      const recordedOutcome = result.occurrence.outcome ?? selectedOutcome;
      const recorded: Occurrence = {
        ...selected,
        status: recordedOutcome,
        completedBy,
        completedAt,
        activeEventId:
          result.occurrence.activeEventId ?? selected.activeEventId,
      };
      setOccurrenceOverrides((items) => ({
        ...items,
        [recorded.id]: recorded,
      }));
      setSelected(recorded);
      setDemoState(result.kind === "already_recorded" ? "race" : "saved");
      startRefresh(() => router.refresh());
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "The outcome could not be recorded.",
      );
      setDemoState("error");
    }
  };

  const closeDialog = () => {
    setDemoState("idle");
    setSelected(null);
    setCorrectionMode(false);
    setNote("");
    setIdempotencyKey("");
    setErrorMessage("");
  };

  async function updateClaim(
    occurrence: Occurrence,
    method: "POST" | "DELETE",
  ) {
    setClaimingId(occurrence.id);
    setCoordinationError("");
    try {
      const response = await fetch(`/api/occurrences/${occurrence.id}/claim`, {
        method,
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.message ?? "The care action could not be updated.",
        );
      const result = payload as ClaimResponse;
      if (result.kind === "already_recorded") {
        startRefresh(() => router.refresh());
        return;
      }
      const claimIsMine = result.occurrence.claimedBy === viewer.id;
      setOccurrenceOverrides((items) => ({
        ...items,
        [occurrence.id]: {
          ...occurrence,
          claimedBy: result.occurrence.claimedBy ?? undefined,
          claimedByName: result.occurrence.claimedBy
            ? claimIsMine
              ? "You"
              : "Another caregiver"
            : undefined,
          claimedAt: result.occurrence.claimedAt
            ? new Intl.DateTimeFormat("en", {
                hour: "numeric",
                minute: "2-digit",
              }).format(new Date(result.occurrence.claimedAt))
            : undefined,
          claimExpiresAt: result.occurrence.claimExpiresAt ?? undefined,
          claimIsMine: result.occurrence.claimedBy ? claimIsMine : undefined,
        },
      }));
      startRefresh(() => router.refresh());
    } catch (error) {
      setCoordinationError(
        error instanceof Error
          ? error.message
          : "The care action could not be updated.",
      );
    } finally {
      setClaimingId(null);
    }
  }

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
            <span className="avatar avatar--large">
              {initials(circle.recipient).slice(0, 1)}
            </span>
            <span>
              <strong>{circle.recipient}</strong>
              <small>{circle.members.length} caregivers</small>
            </span>
          </div>
        </div>

        <nav>
          <NavButton
            active={view === "today"}
            onClick={() => setView("today")}
            icon={<Home size={18} />}
          >
            Today
          </NavButton>
          <NavButton
            active={view === "handoff"}
            onClick={() => setView("handoff")}
            icon={<MessageSquareText size={18} />}
          >
            Handoff
          </NavButton>
          {circle.viewerRole === "owner" ? (
            <NavButton
              active={view === "schedules"}
              onClick={() => setView("schedules")}
              icon={<CalendarClock size={18} />}
            >
              Daily actions
            </NavButton>
          ) : null}
          <NavButton
            active={view === "caregivers"}
            onClick={() => setView("caregivers")}
            icon={<UsersRound size={18} />}
          >
            Caregivers
          </NavButton>
          {circle.viewerRole === "owner" ? (
            <NavButton
              onClick={() => setInviteOpen(true)}
              icon={<UserPlus size={18} />}
            >
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
            <small>
              {circle.viewerRole === "owner" ? "Owner" : "Caregiver"}
            </small>
          </span>
          <button
            className="sidebar-signout"
            onClick={signOut}
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-mobile">
            <Logo />
          </div>
          <div className="presence">
            <div
              className="avatar-stack"
              aria-label={`${circle.members.length} caregivers in this circle`}
            >
              {circle.members.map((member) => (
                <span
                  key={member.id}
                  className={`avatar avatar--${member.color}`}
                  title={member.name}
                >
                  {member.initials}
                </span>
              ))}
            </div>
            <span>
              <i className={dueCount ? "presence-dot--due" : ""} />{" "}
              {dueCount ? `${dueCount} due now` : "All caught up"}
            </span>
          </div>
          <span
            className={`live-sync live-sync--${liveStatus}`}
            role="status"
            title="Changes from your care circle appear automatically"
          >
            <i aria-hidden="true" /> {liveLabel}
          </span>
        </header>

        {view === "today" ? (
          <TodayView
            circle={circle}
            occurrences={filteredOccurrences}
            timeline={filteredTimeline}
            recipientFilter={activeRecipientFilter}
            onRecipientFilterChange={setRecipientFilter}
            onComplete={openCompletion}
            onClaim={(occurrence) => updateClaim(occurrence, "POST")}
            onRelease={(occurrence) => updateClaim(occurrence, "DELETE")}
            claimingId={claimingId}
            coordinationError={coordinationError}
            onOpenHandoff={() => setView("handoff")}
          />
        ) : view === "handoff" ? (
          <HandoffView
            circle={circle}
            occurrences={filteredOccurrences}
            timeline={filteredTimeline}
            recipientFilter={activeRecipientFilter}
            onRecipientFilterChange={setRecipientFilter}
          />
        ) : view === "caregivers" ? (
          <CaregiversView circle={circle} viewerId={viewer.id} />
        ) : (
          <ScheduleView
            circle={circle}
            onEdit={setScheduleEditor}
            onRemove={setScheduleToRemove}
            onEditRecipient={setRecipientEditor}
          />
        )}
      </section>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <button
          className={view === "today" ? "is-active" : ""}
          onClick={() => setView("today")}
        >
          <Home size={19} />
          <span>Today</span>
        </button>
        <button
          className={view === "handoff" ? "is-active" : ""}
          onClick={() => setView("handoff")}
        >
          <MessageSquareText size={19} />
          <span>Handoff</span>
        </button>
        {circle.viewerRole === "owner" ? (
          <button
            className={view === "schedules" ? "is-active" : ""}
            onClick={() => setView("schedules")}
          >
            <CalendarClock size={19} />
            <span>Actions</span>
          </button>
        ) : null}
        <button
          className={view === "caregivers" ? "is-active" : ""}
          onClick={() => setView("caregivers")}
        >
          <UsersRound size={19} />
          <span>People</span>
        </button>
        {circle.viewerRole === "owner" ? (
          <button onClick={() => setInviteOpen(true)}>
            <UserPlus size={19} />
            <span>Invite</span>
          </button>
        ) : null}
      </nav>

      {demoState !== "idle" && selected ? (
        <CompletionDialog
          state={demoState}
          occurrence={selected}
          note={note}
          outcome={selectedOutcome}
          isCorrection={correctionMode}
          errorMessage={errorMessage}
          onNoteChange={setNote}
          onOutcomeChange={setSelectedOutcome}
          onConfirm={confirmCompletion}
          onClose={closeDialog}
          circleName={circle.recipient}
        />
      ) : null}

      {inviteOpen ? (
        <InviteDialog
          onClose={() => setInviteOpen(false)}
          viewerEmail={viewer.email}
        />
      ) : null}
      {scheduleEditor ? (
        <ScheduleDialog
          schedule={scheduleEditor === "new" ? null : scheduleEditor}
          recipients={circle.recipients}
          onClose={() => setScheduleEditor(null)}
        />
      ) : null}
      {recipientEditor ? (
        <RecipientDialog
          recipient={recipientEditor === "new" ? null : recipientEditor}
          defaultTimezone={circle.timezone}
          onClose={() => setRecipientEditor(null)}
        />
      ) : null}
      {scheduleToRemove ? (
        <RemoveScheduleDialog
          schedule={scheduleToRemove}
          onClose={() => setScheduleToRemove(null)}
        />
      ) : null}
    </main>
  );
}

function CaregiversView({
  circle,
  viewerId,
}: {
  circle: CareCircle;
  viewerId: string;
}) {
  const router = useRouter();
  const [revoking, setRevoking] = useState<string | null>(null);
  const [caregiverToRevoke, setCaregiverToRevoke] = useState<
    CareCircle["caregivers"][number] | null
  >(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [availability, setAvailability] = useState(circle.viewerAvailability);
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [primaryUserId, setPrimaryUserId] = useState(
    circle.alertSettings.primaryUserId,
  );
  const [escalationMinutes, setEscalationMinutes] = useState(
    circle.alertSettings.escalationMinutes,
  );
  const [savingRules, setSavingRules] = useState(false);

  useEffect(() => {
    if (circle.viewerRole !== "owner") return;
    const timer = window.setInterval(() => router.refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [circle.viewerRole, router]);

  async function changeAvailability(next: CareCircle["viewerAvailability"]) {
    setSavingAvailability(true);
    setErrorMessage("");
    try {
      const response = await fetch("/api/circle/availability", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ availability: next }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.message ?? "Availability could not be updated.",
        );
      setAvailability(next);
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Availability could not be updated.",
      );
    } finally {
      setSavingAvailability(false);
    }
  }

  async function saveAlertRules() {
    setSavingRules(true);
    setErrorMessage("");
    try {
      const response = await fetch("/api/circle/alert-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryUserId, escalationMinutes }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.message ?? "Alert rules could not be updated.");
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Alert rules could not be updated.",
      );
    } finally {
      setSavingRules(false);
    }
  }

  async function revoke() {
    if (!caregiverToRevoke) return;
    const { membershipId } = caregiverToRevoke;
    setRevoking(membershipId);
    setErrorMessage("");
    try {
      const response = await fetch(`/api/circle/caregivers/${membershipId}`, {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.message ?? "The caregiver could not be revoked.",
        );
      setCaregiverToRevoke(null);
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "The caregiver could not be revoked.",
      );
    } finally {
      setRevoking(null);
    }
  }

  const active = circle.caregivers.filter(
    (caregiver) => caregiver.status === "active",
  );
  const pending = circle.caregivers.filter(
    (caregiver) => caregiver.status === "pending",
  );

  return (
    <div className="page-content caregivers-view">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Care circle</span>
          <h1>Caregivers</h1>
          <p>
            {circle.viewerRole === "owner"
              ? `Control who can view and record care for ${circle.recipient}.`
              : `Manage when you receive alerts for ${circle.recipient}.`}
          </p>
        </div>
        {circle.viewerRole === "owner" ? (
          <div className="caregiver-overview">
            <div>
              <strong>{active.length}</strong>
              <span>active</span>
            </div>
            <div>
              <strong>{pending.length}</strong>
              <span>pending</span>
            </div>
          </div>
        ) : null}
      </div>

      {errorMessage ? (
        <p className="form-error caregivers-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <section className="caregiver-section availability-panel">
        <div>
          <span className="eyebrow">Your alerts</span>
          <h2>Availability</h2>
          <p>
            Unavailable caregivers stay in the circle but do not receive due or
            overdue alerts.
          </p>
        </div>
        <div className="availability-actions" aria-label="Your availability">
          <button
            className={availability === "available" ? "is-selected" : ""}
            type="button"
            disabled={savingAvailability}
            onClick={() => changeAvailability("available")}
          >
            <CheckCircle2 size={17} /> Available
          </button>
          <button
            className={
              availability === "unavailable" ? "is-selected is-unavailable" : ""
            }
            type="button"
            disabled={savingAvailability}
            onClick={() => changeAvailability("unavailable")}
          >
            <X size={17} /> Unavailable
          </button>
        </div>
      </section>

      {circle.viewerRole === "owner" ? (
        <section className="caregiver-section escalation-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Alert sequence</span>
              <h2>Escalation rules</h2>
            </div>
            <span className="alert-activity-heading-icon">
              <BellRing size={18} />
            </span>
          </div>
          <p className="panel-copy">
            The first contact receives the due reminder. If no outcome is
            recorded, every available caregiver receives the escalation.
          </p>
          <div className="alert-rule-fields">
            <label>
              <span>First contact</span>
              <select
                value={primaryUserId}
                onChange={(event) => setPrimaryUserId(event.target.value)}
              >
                {active.map((caregiver) => (
                  <option key={caregiver.userId} value={caregiver.userId}>
                    {caregiver.name}
                    {caregiver.availability === "unavailable"
                      ? " (unavailable)"
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Escalate after</span>
              <select
                value={escalationMinutes}
                onChange={(event) =>
                  setEscalationMinutes(Number(event.target.value))
                }
              >
                <option value={60}>1 hour</option>
                <option value={120}>2 hours</option>
                <option value={240}>4 hours</option>
                <option value={360}>6 hours</option>
                <option value={720}>12 hours</option>
              </select>
            </label>
            <button
              className="primary-button"
              type="button"
              disabled={savingRules || !primaryUserId}
              onClick={saveAlertRules}
            >
              {savingRules ? "Saving…" : "Save rules"}
            </button>
          </div>
        </section>
      ) : null}

      {circle.viewerRole === "owner" ? (
        <AlertActivityPanel circle={circle} />
      ) : null}

      {circle.viewerRole === "owner" ? (
        <section className="caregiver-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Access granted</span>
              <h2>Active caregivers</h2>
              <p className="section-description">
                People who can currently view the circle and record outcomes.
              </p>
            </div>
            <span className="section-count">{active.length}</span>
          </div>
          <div className="caregiver-list">
            {active.map((caregiver) => (
              <CaregiverCard
                key={caregiver.membershipId}
                caregiver={caregiver}
                canRevoke={
                  caregiver.userId !== viewerId && caregiver.role !== "owner"
                }
                revoking={revoking === caregiver.membershipId}
                onRevoke={() => setCaregiverToRevoke(caregiver)}
              />
            ))}
            {!active.length ? (
              <p className="schedule-empty">No active caregivers yet.</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {circle.viewerRole === "owner" ? (
        <section className="caregiver-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Awaiting acceptance</span>
              <h2>Pending invitations</h2>
              <p className="section-description">
                Invitations that have not been accepted yet.
              </p>
            </div>
            <span className="section-count">{pending.length}</span>
          </div>
          <div className="caregiver-list">
            {pending.map((caregiver) => (
              <CaregiverCard
                key={caregiver.membershipId}
                caregiver={caregiver}
                canRevoke
                revoking={revoking === caregiver.membershipId}
                onRevoke={() => setCaregiverToRevoke(caregiver)}
              />
            ))}
            {!pending.length ? (
              <p className="schedule-empty">No pending invitations.</p>
            ) : null}
          </div>
        </section>
      ) : null}
      {caregiverToRevoke ? (
        <RevokeCaregiverDialog
          caregiver={caregiverToRevoke}
          saving={revoking === caregiverToRevoke.membershipId}
          onCancel={() => {
            if (!revoking) setCaregiverToRevoke(null);
          }}
          onConfirm={revoke}
        />
      ) : null}
    </div>
  );
}

function AlertActivityPanel({ circle }: { circle: CareCircle }) {
  return (
    <section className="caregiver-section alert-activity-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Delivery ledger</span>
          <h2>Alert activity</h2>
          <p className="section-description">
            A recent record of reminders and escalations sent by OneDose.
          </p>
        </div>
        <BellRing size={21} />
      </div>
      {circle.alertActivity.length ? (
        <div className="alert-activity-list">
          {circle.alertActivity.map((activity) => {
            const delivered =
              activity.status === "sent" || activity.status === "dry_run";
            const label =
              activity.kind === "due" ? "First reminder" : "Escalation";
            const recipientLabel = `${activity.recipientCount} ${activity.recipientCount === 1 ? "caregiver" : "caregivers"}`;
            return (
              <article
                className={`alert-activity-row alert-activity-row--${activity.status}`}
                key={activity.id}
              >
                <span className="alert-activity-icon">
                  {delivered ? <Check size={16} /> : <CircleAlert size={16} />}
                </span>
                <div>
                  <div className="alert-activity-title">
                    <strong>{label}</strong>
                    <span className="alert-activity-action">
                      {activity.title}
                    </span>
                  </div>
                  <span className="recipient-label">{activity.recipientName}</span>
                  <p>
                    {activity.status === "failed"
                      ? "Delivery failed"
                      : activity.status === "claimed"
                        ? "Delivery in progress"
                        : `${recipientLabel} notified`}
                  </p>
                </div>
                <time>
                  <strong>{activity.time}</strong>
                  <small>{activity.dateLabel}</small>
                </time>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="alert-activity-empty">
          <BellRing size={22} />
          <span>
            <strong>No alerts sent yet</strong>
            <small>
              Reminder activity will appear here after the scheduled Function
              runs.
            </small>
          </span>
        </div>
      )}
    </section>
  );
}

function RevokeCaregiverDialog({
  caregiver,
  saving,
  onCancel,
  onConfirm,
}: {
  caregiver: CareCircle["caregivers"][number];
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
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

  return (
    <div
      className={`dialog-backdrop ${closing ? "dialog-backdrop--closing" : ""}`}
      role="presentation"
      onMouseDown={close}
      onAnimationEnd={() => {
        if (closing) onCancel();
      }}
    >
      <section
        className={`dialog revoke-dialog ${closing ? "dialog--closing" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="revoke-dialog-title"
        aria-describedby="revoke-dialog-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          className="dialog-close"
          type="button"
          onClick={close}
          aria-label="Close"
          disabled={saving}
        >
          <X size={19} />
        </button>
        <div className="revoke-dialog-heading">
          <span className="result-icon result-icon--protected revoke-dialog-icon">
            <ShieldCheck size={25} />
          </span>
          <div>
            <span className="section-kicker section-kicker--coral">
              Access change
            </span>
            <h2 id="revoke-dialog-title">Revoke access?</h2>
          </div>
        </div>
        <div className="revoke-dialog-person">
          <span className="avatar avatar--coral">
            {initials(caregiver.name)}
          </span>
          <span>
            <strong>{caregiver.name}</strong>
            <small>{caregiver.email}</small>
          </span>
        </div>
        <p className="dialog-lead" id="revoke-dialog-description">
          {caregiver.status === "pending"
            ? "This cancels their pending invitation."
            : "They will be removed from this care circle and will no longer be able to view or record updates."}
        </p>
        <div className="revoke-dialog-note">
          <CircleAlert size={17} />
          <span>This action takes effect across their open sessions.</span>
        </div>
        <div className="dialog-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={close}
            disabled={saving}
          >
            Keep access
          </button>
          <button
            className="primary-button revoke-confirm-button"
            type="button"
            onClick={onConfirm}
            disabled={saving}
          >
            {saving ? "Revoking…" : "Revoke access"}
          </button>
        </div>
      </section>
    </div>
  );
}

function CaregiverCard({
  caregiver,
  canRevoke,
  revoking,
  onRevoke,
}: {
  caregiver: CareCircle["caregivers"][number];
  canRevoke: boolean;
  revoking: boolean;
  onRevoke: () => void;
}) {
  const displayName =
    caregiver.status === "pending" && caregiver.name === caregiver.email
      ? "Invited caregiver"
      : caregiver.name;
  return (
    <article className="caregiver-card">
      <span className="avatar avatar--sage">{initials(displayName)}</span>
      <div className="caregiver-copy">
        <div className="caregiver-title">
          <h3>{displayName}</h3>
          <span
            className={`status-pill status-pill--${caregiver.status === "pending" ? "upcoming" : "completed"}`}
          >
            {caregiver.status === "pending"
              ? "Pending"
              : caregiver.role === "owner"
                ? "Owner"
                : "Active"}
          </span>
          {caregiver.status === "active" ? (
            <span
              className={`availability-chip availability-chip--${caregiver.availability}`}
            >
              {caregiver.availability === "available"
                ? "Available"
                : "Unavailable"}
            </span>
          ) : null}
        </div>
        <p>{caregiver.email}</p>
      </div>
      {canRevoke ? (
        <button
          className="text-button text-button--danger"
          type="button"
          disabled={revoking}
          onClick={onRevoke}
        >
          {revoking ? "Revoking…" : "Revoke access"}
        </button>
      ) : (
        <span className="caregiver-owner-label">You</span>
      )}
    </article>
  );
}

function ScheduleView({
  circle,
  onEdit,
  onRemove,
  onEditRecipient,
}: {
  circle: CareCircle;
  onEdit: (schedule: CareSchedule | "new") => void;
  onRemove: (schedule: CareSchedule) => void;
  onEditRecipient: (recipient: CareRecipient | "new") => void;
}) {
  return (
    <div className="page-content schedule-view">
      <div className="page-heading schedule-page-heading">
        <div>
          <span className="eyebrow">Care plan</span>
          <h1>Daily actions</h1>
          <p>Each active action creates one fresh record every local day.</p>
        </div>
        <div className="page-heading-actions">
          <button
            className="secondary-button"
            onClick={() => onEditRecipient("new")}
          >
            <UserPlus size={17} /> Add person
          </button>
          <button
            className="primary-button"
            onClick={() => onEdit("new")}
            disabled={!circle.recipients.length}
          >
            <Plus size={18} /> Add action
          </button>
        </div>
      </div>

      <section
        className="recipient-profiles"
        aria-labelledby="recipient-profiles-title"
      >
        <div className="section-heading">
          <div>
            <span className="eyebrow">People receiving care</span>
            <h2 id="recipient-profiles-title">Care profiles</h2>
          </div>
          <span className="section-count">{circle.recipients.length}</span>
        </div>
        <div className="recipient-profile-grid">
          {circle.recipients.map((recipient) => (
            <article className="recipient-profile-card" key={recipient.id}>
              <span className="avatar avatar--large recipient-avatar">
                {initials(recipient.displayName).slice(0, 1)}
              </span>
              <div>
                <h3>{recipient.displayName}</h3>
                <p>{recipient.relationship || "Care recipient"}</p>
                <small>
                  <Clock3 size={13} /> {recipient.timezone}
                </small>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => onEditRecipient(recipient)}
              >
                <Pencil size={15} /> Edit
              </button>
              {recipient.careNotes ? (
                <p className="recipient-care-notes">{recipient.careNotes}</p>
              ) : null}
            </article>
          ))}
          {!circle.recipients.length ? (
            <div className="schedule-empty">
              <UsersRound size={28} />
              <h2>No care profiles yet</h2>
              <p>Add a person before creating daily actions.</p>
            </div>
          ) : null}
        </div>
      </section>

      <div className="schedule-management-list">
        {circle.schedules.map((schedule) => (
          <article
            className={`schedule-management-card ${schedule.active ? "" : "is-paused"}`}
            key={schedule.id}
          >
            <div className="schedule-management-time">
              {formatLocalTime(schedule.localTime)}
            </div>
            <div>
              <div className="schedule-title-line">
                <h2>{schedule.title}</h2>
                <span
                  className={`status-pill ${schedule.active ? "status-pill--completed" : "status-pill--upcoming"}`}
                >
                  {schedule.active ? "Active" : "Paused"}
                </span>
              </div>
              <span className="recipient-label">{schedule.recipientName}</span>
              <p>{schedule.instruction || "No additional instructions."}</p>
            </div>
            <div className="schedule-management-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => onEdit(schedule)}
              >
                <Pencil size={15} /> Edit
              </button>
              <button
                className="secondary-button secondary-button--danger"
                type="button"
                onClick={() => onRemove(schedule)}
              >
                <Trash2 size={15} /> Remove
              </button>
            </div>
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
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2020, 0, 1, hour, minute)));
}

function ScheduleDialog({
  schedule,
  recipients,
  onClose,
}: {
  schedule: CareSchedule | null;
  recipients: CareRecipient[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(schedule?.title ?? "");
  const [instruction, setInstruction] = useState(schedule?.instruction ?? "");
  const [localTime, setLocalTime] = useState(schedule?.localTime ?? "09:00");
  const [active, setActive] = useState(schedule?.active ?? true);
  const [recipientIds, setRecipientIds] = useState<string[]>(
    schedule?.recipientId
      ? [schedule.recipientId]
      : recipients[0]?.id
        ? [recipients[0].id]
        : [],
  );
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
      const response = await fetch(
        schedule ? `/api/schedules/${schedule.id}` : "/api/schedules",
        {
          method: schedule ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(schedule ? { recipientId: recipientIds[0] } : { recipientIds }),
            title,
            instruction: instruction || undefined,
            localTime,
            active,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.message ?? "The daily action could not be saved.",
        );
      close();
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The daily action could not be saved.",
      );
      setSaving(false);
    }
  }

  return (
    <div
      className={`dialog-backdrop ${closing ? "dialog-backdrop--closing" : ""}`}
      role="presentation"
      onMouseDown={close}
      onAnimationEnd={() => {
        if (closing) onClose();
      }}
    >
      <section
        className={`dialog schedule-dialog ${closing ? "dialog--closing" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          className="dialog-close"
          type="button"
          onClick={close}
          aria-label="Close"
          disabled={saving}
        >
          <X size={19} />
        </button>
        <form onSubmit={save}>
          <span className="section-kicker">Daily schedule</span>
          <h2 id="schedule-title">
            {schedule ? "Edit daily action" : "Add a daily action"}
          </h2>
          {schedule ? (
            <label className="invite-field">
              <span>For</span>
              <select
                value={recipientIds[0]}
                onChange={(event) => setRecipientIds([event.target.value])}
                required
              >
                {recipients.map((recipient) => (
                  <option value={recipient.id} key={recipient.id}>
                    {recipient.displayName}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <fieldset className="schedule-recipient-field">
              <div className="schedule-recipient-heading">
                <div>
                  <legend>For</legend>
                  <small>Each person gets a separate record.</small>
                </div>
                {recipients.length > 1 ? (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      setRecipientIds(
                        recipientIds.length === recipients.length
                          ? []
                          : recipients.map((recipient) => recipient.id),
                      )
                    }
                  >
                    {recipientIds.length === recipients.length
                      ? "Clear all"
                      : "Select all"}
                  </button>
                ) : null}
              </div>
              <div className="schedule-recipient-options">
                {recipients.map((recipient) => {
                  const selected = recipientIds.includes(recipient.id);
                  return (
                    <label
                      className={`schedule-recipient-option ${selected ? "is-selected" : ""}`}
                      key={recipient.id}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() =>
                          setRecipientIds((current) =>
                            selected
                              ? current.filter((id) => id !== recipient.id)
                              : [...current, recipient.id],
                          )
                        }
                      />
                      <span className="avatar">
                        {initials(recipient.displayName).slice(0, 1)}
                      </span>
                      <span>
                        <strong>{recipient.displayName}</strong>
                        <small>
                          {recipient.relationship || "Care recipient"}
                        </small>
                      </span>
                      <span className="schedule-recipient-check">
                        <Check size={15} />
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
          <label className="invite-field">
            <span>Action name</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Morning routine"
              required
            />
          </label>
          <label className="invite-field">
            <span>Daily time</span>
            <input
              type="time"
              value={localTime}
              onChange={(event) => setLocalTime(event.target.value)}
              required
            />
          </label>
          <label className="note-field schedule-note-field">
            <span>
              Instructions <small>optional</small>
            </span>
            <textarea
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="What should the caregiver know?"
            />
          </label>
          {schedule ? (
            <label className="schedule-active-field">
              <input
                type="checkbox"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
              />
              <span>
                <strong>Active every day</strong>
                <small>Pause this to stop creating new daily records.</small>
              </span>
            </label>
          ) : null}
          {message ? <p className="form-error">{message}</p> : null}
          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={close}>
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={
                saving || title.trim().length < 2 || !recipientIds.length
              }
            >
              {saving
                ? "Saving…"
                : recipientIds.length > 1
                  ? `Add ${recipientIds.length} actions`
                  : "Save action"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function RecipientDialog({
  recipient,
  defaultTimezone,
  onClose,
}: {
  recipient: CareRecipient | null;
  defaultTimezone: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const detectedTimezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || defaultTimezone,
    [defaultTimezone],
  );
  const timezones = useMemo(() => {
    const supported =
      typeof Intl.supportedValuesOf === "function"
        ? Intl.supportedValuesOf("timeZone")
        : [];
    return [
      ...new Set(
        [
          recipient?.timezone,
          defaultTimezone,
          detectedTimezone,
          "UTC",
          ...supported,
        ].filter(Boolean) as string[],
      ),
    ].sort();
  }, [defaultTimezone, detectedTimezone, recipient?.timezone]);
  const [displayName, setDisplayName] = useState(recipient?.displayName ?? "");
  const [relationship, setRelationship] = useState(
    recipient?.relationship ?? "",
  );
  const [careNotes, setCareNotes] = useState(recipient?.careNotes ?? "");
  const [timezone, setTimezone] = useState(
    recipient?.timezone ?? defaultTimezone,
  );
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [message, setMessage] = useState("");
  const [closing, setClosing] = useState(false);

  function close() {
    if (!saving && !archiving) setClosing(true);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(
        recipient ? `/api/recipients/${recipient.id}` : "/api/recipients",
        {
          method: recipient ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName,
            relationship: relationship || undefined,
            careNotes: careNotes || undefined,
            timezone,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.message ?? "The care profile could not be saved.",
        );
      setClosing(true);
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The care profile could not be saved.",
      );
      setSaving(false);
    }
  }

  async function archive() {
    if (!recipient) return;
    setArchiving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/recipients/${recipient.id}`, {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.message ?? "The care profile could not be archived.",
        );
      setClosing(true);
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The care profile could not be archived.",
      );
      setArchiving(false);
    }
  }

  return (
    <div
      className={`dialog-backdrop ${closing ? "dialog-backdrop--closing" : ""}`}
      role="presentation"
      onMouseDown={close}
      onAnimationEnd={() => {
        if (closing) onClose();
      }}
    >
      <section
        className={`dialog recipient-dialog ${closing ? "dialog--closing" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recipient-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          className="dialog-close"
          type="button"
          onClick={close}
          aria-label="Close"
          disabled={saving || archiving}
        >
          <X size={19} />
        </button>
        <form onSubmit={save}>
          <span className="section-kicker">Care profile</span>
          <h2 id="recipient-dialog-title">
            {recipient ? `Edit ${recipient.displayName}` : "Add a person"}
          </h2>
          <div className="field-grid">
            <label className="invite-field">
              <span>Name</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Nora"
                required
              />
            </label>
            <label className="invite-field">
              <span>
                Relationship <small>optional</small>
              </span>
              <input
                value={relationship}
                onChange={(event) => setRelationship(event.target.value)}
                placeholder="Parent"
              />
            </label>
          </div>
          <label className="invite-field">
            <span>Time zone</span>
            <select
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            >
              {timezones.map((zone) => (
                <option value={zone} key={zone}>
                  {zone}
                  {zone === detectedTimezone ? " (Detected)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="note-field schedule-note-field">
            <span>
              Care context <small>optional</small>
            </span>
            <textarea
              value={careNotes}
              onChange={(event) => setCareNotes(event.target.value)}
              maxLength={1000}
              placeholder="Stable context caregivers should know. Do not include dosing decisions."
            />
          </label>
          {message ? <p className="form-error">{message}</p> : null}
          <div className="dialog-actions recipient-dialog-actions">
            {recipient ? (
              <button
                className="text-button text-button--danger"
                type="button"
                disabled={saving || archiving}
                onClick={archive}
              >
                {archiving ? "Archiving…" : "Archive profile"}
              </button>
            ) : null}
            <span />
            <button className="secondary-button" type="button" onClick={close}>
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={saving || archiving || displayName.trim().length < 2}
            >
              {saving ? "Saving…" : "Save profile"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function RemoveScheduleDialog({
  schedule,
  onClose,
}: {
  schedule: CareSchedule;
  onClose: () => void;
}) {
  const router = useRouter();
  const [removing, setRemoving] = useState(false);
  const [message, setMessage] = useState("");
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !removing) setClosing(true);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [removing]);

  function close() {
    if (!removing) setClosing(true);
  }

  async function remove() {
    setRemoving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/schedules/${schedule.id}`, {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.message ?? "The daily action could not be removed.",
        );
      setClosing(true);
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The daily action could not be removed.",
      );
      setRemoving(false);
    }
  }

  return (
    <div
      className={`dialog-backdrop ${closing ? "dialog-backdrop--closing" : ""}`}
      role="presentation"
      onMouseDown={close}
      onAnimationEnd={() => {
        if (closing) onClose();
      }}
    >
      <section
        className={`dialog remove-schedule-dialog ${closing ? "dialog--closing" : ""}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="remove-schedule-title"
        aria-describedby="remove-schedule-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          className="dialog-close"
          type="button"
          onClick={close}
          aria-label="Close"
          disabled={removing}
        >
          <X size={19} />
        </button>
        <div className="remove-schedule-heading">
          <span className="result-icon result-icon--protected">
            <Trash2 size={22} />
          </span>
          <div>
            <span className="section-kicker section-kicker--coral">
              Remove daily action
            </span>
            <h2 id="remove-schedule-title">Remove {schedule.title}?</h2>
          </div>
        </div>
        <p className="dialog-lead" id="remove-schedule-description">
          This will stop the action from appearing in the care plan and creating
          new reminders. Existing handoff history will stay intact.
        </p>
        <div className="remove-schedule-note">
          <CircleAlert size={17} />
          <span>Future occurrences will no longer be created.</span>
        </div>
        {message ? <p className="form-error">{message}</p> : null}
        <div className="dialog-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={removing}
            onClick={close}
          >
            Keep action
          </button>
          <button
            className="primary-button remove-confirm-button"
            type="button"
            disabled={removing}
            onClick={remove}
          >
            <Trash2 size={16} /> {removing ? "Removing…" : "Remove action"}
          </button>
        </div>
      </section>
    </div>
  );
}

function InviteDialog({
  onClose,
  viewerEmail,
}: {
  onClose: () => void;
  viewerEmail: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"form" | "sending" | "sent" | "error">(
    "form",
  );
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
      if (!response.ok)
        throw new Error(payload.message ?? "The invitation could not be sent.");
      setStatus("sent");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The invitation could not be sent.",
      );
      setStatus("error");
    }
  }

  function close() {
    setClosing(true);
  }

  return (
    <div
      className={`dialog-backdrop ${closing ? "dialog-backdrop--closing" : ""}`}
      role="presentation"
      onMouseDown={close}
      onAnimationEnd={() => {
        if (closing) onClose();
      }}
    >
      <section
        className={`dialog invite-dialog ${closing ? "dialog--closing" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          className="dialog-close"
          type="button"
          onClick={close}
          aria-label="Close"
        >
          <X size={19} />
        </button>

        {status === "sent" ? (
          <div className="result-state">
            <span className="result-icon result-icon--success">
              <CheckCircle2 size={32} />
            </span>
            <span className="section-kicker">Invitation sent</span>
            <h2 id="invite-title">Check {email}</h2>
            <p>
              We sent an invitation link to their email. Once they accept it and
              sign in, they’ll have access to this shared care circle.
            </p>
            <button className="primary-button full-button" onClick={close}>
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={sendInvitation}>
            <span className="section-kicker">Share this circle</span>
            <h2 id="invite-title">Invite a caregiver</h2>
            <p className="dialog-lead">
              They’ll get an email with a secure invitation to join this care
              circle.
            </p>
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
            {status === "error" ? (
              <p className="form-error">{message}</p>
            ) : null}
            <div className="dialog-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={close}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={status === "sending" || !email.trim()}
              >
                <UserPlus size={18} />{" "}
                {status === "sending" ? "Sending…" : "Send invitation"}
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
      <span className="logo-mark">
        <i />
        <i />
      </span>
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
    <button
      className={active ? "nav-button is-active" : "nav-button"}
      onClick={onClick}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

function RecipientFilter({
  recipients,
  value,
  onChange,
}: {
  recipients: CareRecipient[];
  value: string;
  onChange: (recipientId: string) => void;
}) {
  if (recipients.length < 2) return null;
  return (
    <div className="recipient-filter" role="group" aria-label="Filter by care recipient">
      <button
        className={value === "all" ? "is-active" : ""}
        type="button"
        onClick={() => onChange("all")}
      >
        All people
      </button>
      {recipients.map((recipient) => (
        <button
          className={value === recipient.id ? "is-active" : ""}
          type="button"
          key={recipient.id}
          onClick={() => onChange(recipient.id)}
        >
          <span className="recipient-filter-avatar" aria-hidden="true">
            {initials(recipient.displayName).slice(0, 1)}
          </span>
          {recipient.displayName}
        </button>
      ))}
    </div>
  );
}

function TodayView({
  circle,
  occurrences,
  timeline,
  recipientFilter,
  onRecipientFilterChange,
  onComplete,
  onClaim,
  onRelease,
  claimingId,
  coordinationError,
  onOpenHandoff,
}: {
  circle: CareCircle;
  occurrences: Occurrence[];
  timeline: CareCircle["timeline"];
  recipientFilter: string;
  onRecipientFilterChange: (recipientId: string) => void;
  onComplete: (occurrence: Occurrence) => void;
  onClaim: (occurrence: Occurrence) => void;
  onRelease: (occurrence: Occurrence) => void;
  claimingId: string | null;
  coordinationError: string;
  onOpenHandoff: () => void;
}) {
  const dueCount = occurrences.filter(
    (item) => item.status === "due" || item.status === "overdue",
  ).length;
  const focus =
    occurrences.find((item) => item.status === "overdue") ??
    occurrences.find((item) => item.status === "due") ??
    occurrences.find((item) => item.status === "upcoming");

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <span className="eyebrow">{circle.dateLabel}</span>
          <h1>Today</h1>
          <p>
            {dueCount
              ? `${dueCount} ${dueCount === 1 ? "action needs" : "actions need"} attention.`
              : "Everything due so far is recorded."}
          </p>
        </div>
        <div className="timezone">
          <Clock3 size={15} /> {circle.timezone}
        </div>
      </div>

      <RecipientFilter
        recipients={circle.recipients}
        value={recipientFilter}
        onChange={onRecipientFilterChange}
      />

      {coordinationError ? (
        <p className="coordination-error" role="alert">
          {coordinationError}
        </p>
      ) : null}

      {focus ? (
        <section
          className={`focus-card ${focus.status === "overdue" ? "focus-card--overdue" : ""}`}
        >
          <div className="focus-copy">
            <span className="section-kicker">Next up</span>
            <p className="focus-time">{focus.time.replace(/\s[AP]M$/, "")}</p>
            <span className="focus-meridiem">
              {focus.time.match(/[AP]M$/)?.[0]}
            </span>
          </div>
          <div className="focus-details">
            <span className={`status-pill status-pill--${focus.status}`}>
              {focus.status === "overdue"
                ? "Overdue"
                : focus.status === "due"
                  ? "Due now"
                  : "Upcoming"}
            </span>
            {circle.recipients.length > 1 ? (
              <span className="recipient-label">{focus.recipientName}</span>
            ) : null}
            <h2>{focus.title}</h2>
            <p>{focus.detail}</p>
            <ClaimNote occurrence={focus} featured />
          </div>
          <ClaimAction
            occurrence={focus}
            busy={claimingId === focus.id}
            onClaim={onClaim}
            onRelease={onRelease}
            onComplete={onComplete}
            featured
          />
        </section>
      ) : (
        <section className="focus-card focus-card--complete">
          <div className="focus-complete-icon">
            <CheckCircle2 size={28} />
          </div>
          <div className="focus-details">
            <span className="status-pill status-pill--completed">All done</span>
            <h2>
              {occurrences.length
                ? "Everything is recorded"
                : "No actions scheduled"}
            </h2>
            <p>
              {occurrences.length
                ? "There is nothing left to record for today."
                : "Your care circle has no actions scheduled today."}
            </p>
          </div>
        </section>
      )}

      <div className="content-grid">
        <section>
          <div className="section-heading">
            <div>
              <span className="eyebrow">Schedule</span>
              <h2>Today’s care</h2>
            </div>
          </div>
          <div className="schedule-list">
            {occurrences.map((item) => (
              <ScheduleRow
                key={item.id}
                item={item}
                busy={claimingId === item.id}
                onComplete={() => onComplete(item)}
                onClaim={() => onClaim(item)}
                onRelease={() => onRelease(item)}
              />
            ))}
          </div>
        </section>

        <aside className="activity-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Live handoff</span>
              <h2>What happened</h2>
            </div>
            <Activity size={18} />
          </div>
          <div className="timeline">
            {timeline.slice(0, 2).map((event) => (
              <div
                className={`timeline-item timeline-item--${event.tone}`}
                key={event.id}
              >
                <i />
                <span className="timeline-time">{event.time}</span>
                <span className="recipient-label">{event.recipientName}</span>
                <strong>{event.title}</strong>
                <p>{event.detail}</p>
              </div>
            ))}
            {!timeline.length ? (
              <p className="empty-copy">No outcomes have been recorded yet.</p>
            ) : null}
          </div>
          <button className="wide-link" onClick={onOpenHandoff}>
            Open full handoff <ArrowRight size={16} />
          </button>
        </aside>
      </div>
    </div>
  );
}

function ClaimAction({
  occurrence,
  busy,
  onClaim,
  onRelease,
  onComplete,
  featured = false,
}: {
  occurrence: Occurrence;
  busy: boolean;
  onClaim: (occurrence: Occurrence) => void;
  onRelease: (occurrence: Occurrence) => void;
  onComplete: (occurrence: Occurrence) => void;
  featured?: boolean;
}) {
  if (isRecordedOutcome(occurrence.status)) {
    return (
      <button
        className={featured ? "primary-button" : "row-action"}
        onClick={() => onComplete(occurrence)}
      >
        Correct <ArrowRight size={15} />
      </button>
    );
  }
  if (occurrence.status === "upcoming") return null;
  if (occurrence.claimIsMine) {
    return (
      <div
        className={
          featured ? "claim-actions claim-actions--featured" : "claim-actions"
        }
      >
        <button
          className={featured ? "primary-button" : "row-action"}
          onClick={() => onComplete(occurrence)}
        >
          Record outcome <ArrowRight size={15} />
        </button>
        <button
          className="claim-release"
          disabled={busy}
          onClick={() => onRelease(occurrence)}
        >
          {busy ? "Releasing…" : "Release"}
        </button>
      </div>
    );
  }
  if (occurrence.claimedBy) {
    return (
      <button className={featured ? "primary-button" : "row-action"} disabled>
        {occurrence.claimedByName ?? "Another caregiver"} is handling
      </button>
    );
  }
  return (
    <button
      className={featured ? "primary-button" : "row-action"}
      disabled={busy}
      onClick={() => onClaim(occurrence)}
    >
      {busy ? "Claiming…" : "I’m handling this"} <ArrowRight size={15} />
    </button>
  );
}

function ScheduleRow({
  item,
  busy,
  onComplete,
  onClaim,
  onRelease,
}: {
  item: Occurrence;
  busy: boolean;
  onComplete: () => void;
  onClaim: () => void;
  onRelease: () => void;
}) {
  const recorded = isRecordedOutcome(item.status);
  return (
    <article className={`schedule-row schedule-row--${item.status}`}>
      <div className="schedule-time">{item.time}</div>
      <div className="schedule-marker">
        {recorded ? <Check size={15} /> : <i />}
      </div>
      <div className="schedule-copy">
        <div className="schedule-title-line">
          <h3>{item.title}</h3>
          <span className={`status-pill status-pill--${item.status}`}>
            {occurrenceStatusLabel(item.status)}
          </span>
        </div>
        <span className="recipient-label">{item.recipientName}</span>
        <p>{item.detail}</p>
        {item.completedBy ? (
          <small>
            Recorded by {item.completedBy} · {item.completedAt}
          </small>
        ) : null}
        {!recorded ? <ClaimNote occurrence={item} /> : null}
      </div>
      <ClaimAction
        occurrence={item}
        busy={busy}
        onClaim={onClaim}
        onRelease={onRelease}
        onComplete={onComplete}
      />
    </article>
  );
}

function HandoffView({
  circle,
  occurrences,
  timeline,
  recipientFilter,
  onRecipientFilterChange,
}: {
  circle: CareCircle;
  occurrences: Occurrence[];
  timeline: CareCircle["timeline"];
  recipientFilter: string;
  onRecipientFilterChange: (recipientId: string) => void;
}) {
  const dueCount = occurrences.filter(
    (item) => item.status === "due" || item.status === "overdue",
  ).length;
  const eventGroups = timeline.reduce<
    Array<{ key: string; label: string; events: CareCircle["timeline"] }>
  >((groups, event) => {
    const current = groups.at(-1);
    if (current?.key === event.dateKey) current.events.push(event);
    else
      groups.push({
        key: event.dateKey,
        label: event.dateLabel,
        events: [event],
      });
    return groups;
  }, []);
  return (
    <div className="page-content handoff-view">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Shared context</span>
          <h1>Handoff</h1>
          <p>A readable history for whoever takes over next.</p>
        </div>
      </div>

      <RecipientFilter
        recipients={circle.recipients}
        value={recipientFilter}
        onChange={onRecipientFilterChange}
      />

      <div className="handoff-layout">
        <section className="handoff-feed">
          {eventGroups.map((group) => (
            <div className="handoff-day" key={group.key}>
              <div className="date-divider">
                <span>{group.label}</span>
              </div>
              {group.events.map((event) => (
                <article className="handoff-event" key={event.id}>
                  <span className={`event-icon event-icon--${event.tone}`}>
                    {event.tone === "success" ? (
                      <Check size={17} />
                    ) : event.tone === "attention" ? (
                      <CircleAlert size={17} />
                    ) : (
                      <MessageSquareText size={17} />
                    )}
                  </span>
                  <div>
                    <span className="timeline-time">{event.time}</span>
                    <span className="recipient-label">{event.recipientName}</span>
                    <h3>{event.title}</h3>
                    <p>{event.detail}</p>
                  </div>
                </article>
              ))}
            </div>
          ))}
          {!timeline.length ? (
            <p className="empty-copy">
              The handoff will appear here after the first recorded outcome.
            </p>
          ) : null}
        </section>
        <aside className="handoff-summary">
          <span className="section-kicker">Shift summary</span>
          <h2>Nothing urgent to carry forward.</h2>
          <p>
            {dueCount
              ? `${dueCount} ${dueCount === 1 ? "action still needs" : "actions still need"} an outcome.`
              : "Every scheduled outcome is recorded."}
          </p>
          <div className="summary-stat">
            <strong>{dueCount}</strong>
            <span>{dueCount === 1 ? "action due" : "actions due"}</span>
          </div>
          <div className="summary-stat">
            <strong>{circle.members.length}</strong>
            <span>caregivers synced</span>
          </div>
        </aside>
      </div>
    </div>
  );
}

function CompletionDialog({
  state,
  occurrence,
  note,
  outcome,
  isCorrection,
  errorMessage,
  onNoteChange,
  onOutcomeChange,
  onConfirm,
  onClose,
  circleName,
}: {
  state: DemoState;
  occurrence: Occurrence;
  note: string;
  outcome: RecordedOutcome;
  isCorrection: boolean;
  errorMessage: string;
  onNoteChange: (value: string) => void;
  onOutcomeChange: (value: RecordedOutcome) => void;
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
    <div
      className={`dialog-backdrop ${closing ? "dialog-backdrop--closing" : ""}`}
      role="presentation"
      onMouseDown={close}
      onAnimationEnd={() => {
        if (closing) onClose();
      }}
    >
      <section
        className={`dialog ${state === "race" ? "dialog--race" : ""} ${closing ? "dialog--closing" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          className="dialog-close"
          type="button"
          onClick={close}
          aria-label="Close"
          disabled={state === "saving"}
        >
          <X size={19} />
        </button>

        {state === "confirm" ? (
          <>
            <span className="section-kicker">
              {isCorrection ? "Correct outcome" : "Confirm outcome"}
            </span>
            <h2 id="dialog-title">
              {isCorrection ? "Update" : "Record"}{" "}
              {occurrence.title.toLowerCase()}
            </h2>
            <p className="dialog-lead">{occurrence.instruction}</p>
            <div className="detail-strip">
              <Clock3 size={17} />
              <span>
                <small>Scheduled</small>
                <strong>{occurrence.time}</strong>
              </span>
            </div>
            {isCorrection && isRecordedOutcome(occurrence.status) ? (
              <div className="correction-note">
                <ShieldCheck size={18} />
                <span>
                  <strong>
                    Currently {OUTCOME_LABELS[occurrence.status].toLowerCase()}
                  </strong>
                  <small>
                    This correction adds to the history instead of replacing it.
                  </small>
                </span>
              </div>
            ) : null}
            <fieldset className="outcome-picker">
              <legend>Outcome</legend>
              <div>
                {(
                  Object.entries(OUTCOME_LABELS) as Array<
                    [RecordedOutcome, string]
                  >
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className={`outcome-choice outcome-choice--${value} ${outcome === value ? "is-selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="outcome"
                      value={value}
                      checked={outcome === value}
                      onChange={() => onOutcomeChange(value)}
                    />
                    <span className="outcome-choice-icon" aria-hidden="true">
                      {value === "completed" ? (
                        <Check size={17} />
                      ) : value === "skipped" ? (
                        <ArrowRight size={17} />
                      ) : value === "refused" ? (
                        <X size={17} />
                      ) : (
                        <CircleAlert size={17} />
                      )}
                    </span>
                    <span className="outcome-choice-copy">
                      <strong>{label}</strong>
                      <small>
                        {value === "completed"
                          ? "Done as planned"
                          : value === "skipped"
                            ? "Not done this time"
                            : value === "refused"
                              ? "Person declined"
                              : "Could not be done"}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="note-field">
              <span>Optional handoff note</span>
              <textarea
                value={note}
                onChange={(event) => onNoteChange(event.target.value)}
                placeholder="Anything the next caregiver should know?"
              />
            </label>
            <div className="dialog-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={close}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={onConfirm}
              >
                <Check size={18} />{" "}
                {isCorrection
                  ? "Save correction"
                  : `Confirm ${OUTCOME_LABELS[outcome].toLowerCase()}`}
              </button>
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
            <span className="result-icon result-icon--success">
              <CheckCircle2 size={32} />
            </span>
            <span className="section-kicker">Recorded</span>
            <h2 id="dialog-title">
              {occurrence.title} {OUTCOME_LABELS[outcome].toLowerCase()}
            </h2>
            <p>Everyone in {circleName} now sees the same result.</p>
            <div className="proof-row">
              <ShieldCheck size={19} />
              <span>
                <strong>
                  {isCorrection
                    ? "Correction added without erasing history"
                    : "Update and history saved together"}
                </strong>
                <small>
                  One confirmed record for everyone in the care circle
                </small>
              </span>
            </div>
          </div>
        ) : null}

        {state === "race" ? (
          <div className="result-state">
            <span className="result-icon result-icon--protected">
              <ShieldCheck size={34} />
            </span>
            <span className="section-kicker section-kicker--coral">
              Duplicate prevented
            </span>
            <h2 id="dialog-title">
              {occurrence.completedBy} already updated this
            </h2>
            <p>
              Another caregiver saved an outcome first. Your screen now shows
              the shared record instead of overwriting it.
            </p>
          </div>
        ) : null}

        {state === "error" ? (
          <div className="result-state">
            <span className="result-icon result-icon--protected">
              <CircleAlert size={34} />
            </span>
            <span className="section-kicker section-kicker--coral">
              Not recorded
            </span>
            <h2 id="dialog-title">Please try again</h2>
            <p>{errorMessage}</p>
          </div>
        ) : null}

        {isResult ? (
          <button
            className="primary-button full-button"
            type="button"
            onClick={close}
          >
            Back to today
          </button>
        ) : null}
      </section>
    </div>
  );
}

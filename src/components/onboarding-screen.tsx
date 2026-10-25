"use client";

import { ArrowRight, Check, LogOut, Search, ShieldCheck, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { OneDoseLogo } from "@/components/onedose-logo";

function currentTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

export function OnboardingScreen({ name }: { name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [timezoneDialogOpen, setTimezoneDialogOpen] = useState(false);
  const [timezoneDialogClosing, setTimezoneDialogClosing] = useState(false);
  const [timezoneSearch, setTimezoneSearch] = useState("");
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const timezones = useMemo(() => {
    const supported = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    return [...new Set([timezone, "UTC", ...supported])].sort();
  }, [timezone]);
  const [selectedTimezone, setSelectedTimezone] = useState(timezone);
  const filteredTimezones = useMemo(() => {
    const query = timezoneSearch.trim().toLowerCase();
    return query ? timezones.filter((zone) => zone.toLowerCase().includes(query)) : timezones;
  }, [timezones, timezoneSearch]);

  useEffect(() => {
    if (!timezoneDialogOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closeTimezoneDialog();
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [timezoneDialogOpen]);

  function closeTimezoneDialog() {
    setTimezoneDialogClosing(true);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Please try again.");
      setBusy(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Please try again.");
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.refresh();
  }

  return (
    <main className="onboarding-shell">
      <section className="onboarding-intro">
        <OneDoseLogo className="logo--auth" />
        <div>
          <span className="section-kicker">Welcome, {name}</span>
          <h1>Set up the first shared handoff.</h1>
          <p>Start with one person and one daily care action. You can invite the rest of the circle afterward.</p>
        </div>
        <div className="onboarding-proof">
          <ShieldCheck size={21} aria-hidden="true" />
          <span>
            <strong>Private care circle ready</strong>
            <small>Care data stays inside your circle.</small>
          </span>
        </div>
      </section>

      <section className="onboarding-panel">
        <form className="onboarding-form" onSubmit={submit}>
          <span className="eyebrow">About the circle</span>
          <h2>Create your care circle</h2>
          <div className="field-grid">
            <label>
              <span>Circle name</span>
              <input name="circleName" defaultValue="Family care" required minLength={2} maxLength={80} />
            </label>
            <label>
              <span>Person receiving care</span>
              <input name="recipientName" placeholder="e.g. Nora" required minLength={2} maxLength={80} />
            </label>
          </div>

          <span className="eyebrow form-section-label">First care action</span>
          <label>
            <span>Action name</span>
            <input name="routineTitle" placeholder="e.g. Midday routine" required minLength={2} maxLength={100} />
          </label>
          <div className="field-grid">
            <label>
              <span>Time</span>
              <input name="localTime" type="time" defaultValue={currentTime()} required />
            </label>
            <label>
              <span>Time zone</span>
              <input type="hidden" name="timezone" value={selectedTimezone} />
              <button
                className="timezone-trigger"
                type="button"
                onClick={() => {
                  setTimezoneSearch("");
                  setTimezoneDialogClosing(false);
                  setTimezoneDialogOpen(true);
                }}
              >
                <span>{selectedTimezone}</span>
                <Search size={17} aria-hidden="true" />
              </button>
            </label>
          </div>
          <label>
            <span>
              Instructions <small>optional</small>
            </span>
            <textarea name="instruction" placeholder="What should the caregiver know?" maxLength={500} />
          </label>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="primary-button full-button"
            type="submit"
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? (
              "Creating your circle…"
            ) : (
              <>
                Create care circle <ArrowRight size={17} />
              </>
            )}
          </button>
          <button className="onboarding-signout" type="button" onClick={signOut} disabled={busy}>
            <LogOut size={15} aria-hidden="true" /> Sign out
          </button>
        </form>
        <div className="onboarding-team-note">
          <Users size={18} aria-hidden="true" />
          <span>
            <strong>You start as the owner</strong>
            <small>Your membership and first schedule are created together.</small>
          </span>
        </div>
      </section>
      {timezoneDialogOpen ? (
        <div
          className={`dialog-backdrop ${timezoneDialogClosing ? "dialog-backdrop--closing" : ""}`}
          role="presentation"
          onMouseDown={closeTimezoneDialog}
          onAnimationEnd={() => {
            if (timezoneDialogClosing) {
              setTimezoneDialogOpen(false);
              setTimezoneDialogClosing(false);
            }
          }}
        >
          <section
            className={`dialog timezone-dialog ${timezoneDialogClosing ? "dialog--closing" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="timezone-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="dialog-close" type="button" onClick={closeTimezoneDialog} aria-label="Close">
              <X size={19} aria-hidden="true" />
            </button>
            <span className="eyebrow">Schedule location</span>
            <h2 id="timezone-dialog-title">Choose a time zone</h2>
            <label className="timezone-search">
              <span className="sr-only">Search time zones</span>
              <Search size={17} aria-hidden="true" />
              <input
                value={timezoneSearch}
                onChange={(event) => setTimezoneSearch(event.target.value)}
                placeholder="Search cities or regions"
                autoFocus
              />
            </label>
            <div className="timezone-options" role="listbox" aria-label="Time zones">
              {filteredTimezones.map((zone) => (
                <button
                  className="timezone-option"
                  type="button"
                  role="option"
                  aria-selected={zone === selectedTimezone}
                  key={zone}
                  onClick={() => {
                    setSelectedTimezone(zone);
                    closeTimezoneDialog();
                  }}
                >
                  <span>
                    {zone}
                    {zone === timezone ? " (Detected)" : ""}
                  </span>
                  {zone === selectedTimezone ? <Check size={17} aria-hidden="true" /> : null}
                </button>
              ))}
              {!filteredTimezones.length ? <p className="timezone-empty">No matching time zones.</p> : null}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

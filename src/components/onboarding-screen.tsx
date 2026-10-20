"use client";

import { ArrowRight, LogOut, ShieldCheck, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

function currentTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

export function OnboardingScreen({ name }: { name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);

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
        <div className="logo logo--auth"><span className="logo-mark"><i /><i /></span><span>OneDose</span></div>
        <div>
          <span className="section-kicker">Welcome, {name}</span>
          <h1>Set up the first shared handoff.</h1>
          <p>Start with one person and one daily care action. You can invite the rest of the circle afterward.</p>
        </div>
        <div className="onboarding-proof"><ShieldCheck size={21} /><span><strong>Private Appwrite Team ready</strong><small>Care data stays inside your circle.</small></span></div>
      </section>

      <section className="onboarding-panel">
        <form className="onboarding-form" onSubmit={submit}>
          <span className="eyebrow">About the circle</span>
          <h2>Create your care circle</h2>
          <div className="field-grid">
            <label><span>Circle name</span><input name="circleName" defaultValue="Family care" required minLength={2} /></label>
            <label><span>Person receiving care</span><input name="recipientName" placeholder="e.g. Nora" required minLength={2} /></label>
          </div>

          <span className="eyebrow form-section-label">First daily action</span>
          <label><span>Action name</span><input name="routineTitle" placeholder="e.g. Midday routine" required minLength={2} /></label>
          <div className="field-grid">
            <label><span>Time</span><input name="localTime" type="time" defaultValue={currentTime()} required /></label>
            <label><span>Time zone</span><input name="timezone" defaultValue={timezone} required /></label>
          </div>
          <label><span>Instructions <small>optional</small></span><textarea name="instruction" placeholder="What should the caregiver know?" maxLength={500} /></label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="primary-button full-button" disabled={busy}>{busy ? "Creating your circle…" : <>Create care circle <ArrowRight size={17} /></>}</button>
          <button className="onboarding-signout" type="button" onClick={signOut} disabled={busy}><LogOut size={15} /> Sign out</button>
        </form>
        <div className="onboarding-team-note"><Users size={18} /><span><strong>You start as the owner</strong><small>Your membership and first schedule are created atomically.</small></span></div>
      </section>
    </main>
  );
}

"use client";

import { Check, LogOut, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function OnboardingPlaceholder({ name }: { name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.refresh();
  }

  return (
    <main className="setup-shell">
      <section className="setup-card">
        <span className="result-icon result-icon--success"><Check size={30} /></span>
        <span className="section-kicker">Account protected by Appwrite</span>
        <h1>Welcome, {name}.</h1>
        <p>Your session and private Team are ready. The next step is creating your first care circle.</p>
        <div className="setup-proof"><Users size={19} /><span><strong>Private Team created</strong><small>Only invited caregivers can join.</small></span></div>
        <button className="secondary-button" onClick={signOut} disabled={busy}><LogOut size={16} /> Sign out</button>
      </section>
    </main>
  );
}

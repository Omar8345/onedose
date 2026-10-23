"use client";

import { CircleAlert, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

export function AccessRevokedScreen() {
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.refresh();
  }

  return (
    <main className="setup-shell">
      <section className="setup-card">
        <span className="result-icon result-icon--protected"><CircleAlert size={31} /></span>
        <span className="section-kicker section-kicker--coral">Access updated</span>
        <h1>This care circle is no longer available.</h1>
        <p>The owner revoked your caregiver access. You can sign out or ask the owner for a new invitation.</p>
        <button className="secondary-button full-button" type="button" onClick={signOut}><LogOut size={17} /> Sign out</button>
      </section>
    </main>
  );
}

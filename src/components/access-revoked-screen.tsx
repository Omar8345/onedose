"use client";

import { CAREGIVER_RECOVERY_MESSAGE } from "@/lib/auth/activation-policy";

import { CircleAlert, LogOut } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function AccessRevokedScreen() {
  const router = useRouter();
  const [error, setError] = useState("");

  async function signOut() {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Logout unavailable");
      router.refresh();
    } catch { setError("Sign out could not be confirmed. Please try again."); }
  }

  return (
    <main className="setup-shell">
      <section className="setup-card">
        <span className="result-icon result-icon--protected"><CircleAlert size={31} /></span>
        <span className="section-kicker section-kicker--coral">Access updated</span>
        <h1>This care circle is no longer available.</h1>
        <p>{CAREGIVER_RECOVERY_MESSAGE}</p>
        {error ? <p role="alert">{error}</p> : null}
        <button className="secondary-button full-button" type="button" onClick={signOut}><LogOut size={17} /> Sign out</button>
      </section>
    </main>
  );
}

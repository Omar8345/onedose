"use client";

import { CircleAlert, RefreshCw } from "lucide-react";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="setup-shell">
      <section className="setup-card">
        <span className="result-icon result-icon--protected"><CircleAlert size={31} /></span>
        <span className="section-kicker section-kicker--coral">Couldn’t load the circle</span>
        <h1>Let’s try that again.</h1>
        <p>Your data is still safe. OneDose could not reach the latest shared record.</p>
        <button className="primary-button" type="button" onClick={reset}>
          <RefreshCw size={17} /> Retry
        </button>
      </section>
    </main>
  );
}

"use client";

import { CheckCircle2, CircleAlert, Mail, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type InviteDetails = {
  teamId: string;
  membershipId: string;
  userId: string;
  secret: string;
};

type State =
  | { kind: "loading" }
  | { kind: "accepted"; signedIn: boolean; circleName: string }
  | { kind: "error"; message: string };

export function InviteScreen({ details }: { details: InviteDetails | null }) {
  const requested = useRef(false);
  const [state, setState] = useState<State>(
    details ? { kind: "loading" } : { kind: "error", message: "This invitation link is incomplete." },
  );

  useEffect(() => {
    if (!details || requested.current) return;
    requested.current = true;

    fetch("/api/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(details),
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message ?? "The invitation could not be accepted.");
        setState({
          kind: "accepted",
          signedIn: Boolean(payload.signedIn),
          circleName: payload.circleName || "your shared care circle",
        });
      })
      .catch((error) => {
        setState({
          kind: "error",
          message: error instanceof Error ? error.message : "The invitation could not be accepted.",
        });
      });
  }, [details]);

  return (
    <main className="invite-shell">
      <section className="invite-card" aria-live="polite">
        <div className="logo logo--invite" aria-label="OneDose">
          <span className="logo-mark"><i /><i /></span>
          <span>OneDose</span>
        </div>

        {state.kind === "loading" ? (
          <>
            <span className="spinner" />
            <span className="section-kicker">Checking invitation</span>
            <h1>Joining your care circle…</h1>
            <p>OneDose is confirming your secure invitation.</p>
          </>
        ) : null}

        {state.kind === "accepted" ? (
          <>
            <span className="invite-icon invite-icon--success"><CheckCircle2 size={31} /></span>
            <span className="section-kicker">Invitation accepted</span>
            <h1>You’re part of {state.circleName}.</h1>
            <p>
              {state.signedIn
                ? "Your shared schedule is ready."
                : "Sign in with the invited email to open the shared schedule."}
            </p>
            <div className="setup-proof">
              <ShieldCheck size={20} />
              <span><strong>Private by default</strong><small>Only accepted caregivers can access this circle.</small></span>
            </div>
            <Link className="primary-button full-button" href="/">
              {state.signedIn ? "Open care circle" : <><Mail size={18} /> Continue with email</>}
            </Link>
          </>
        ) : null}

        {state.kind === "error" ? (
          <>
            <span className="invite-icon invite-icon--error"><CircleAlert size={31} /></span>
            <span className="section-kicker section-kicker--coral">Invitation unavailable</span>
            <h1>This link cannot be used.</h1>
            <p>{state.message}</p>
            <Link className="secondary-button full-button" href="/">Return to OneDose</Link>
          </>
        ) : null}
      </section>
    </main>
  );
}

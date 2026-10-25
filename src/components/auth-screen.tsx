"use client";

import { ArrowLeft, ArrowRight, MailCheck, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { OneDoseLogo } from "@/components/onedose-logo";

export function AuthScreen({
  initialStep = "email",
}: {
  initialStep?: "email" | "profile";
}) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code" | "profile">(initialStep);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function sendCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Please try again.");
      setUserId(payload.userId);
      setStep("code");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const secret = String(
      new FormData(event.currentTarget).get("secret") ?? "",
    ).trim();
    try {
      const response = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, secret }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Please try again.");
      if (payload.needsProfile) {
        setBusy(false);
        setStep("profile");
      } else {
        router.refresh();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Please try again.");
      setBusy(false);
    }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Please try again.");
      setBusy(false);
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Please try again.");
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-story">
        <OneDoseLogo className="logo--auth" />
        <div>
          <span className="section-kicker">Shared care, one clear record</span>
          <h1>
            Know what happened.
            <br />
            Prevent the duplicate.
          </h1>
          <p>
            A shared record for scheduled care, so everyone knows what
            happened—even when two caregivers act at the same moment.
          </p>
        </div>
        <div className="auth-proof">
          <ShieldCheck size={22} aria-hidden="true" />
          <span>
            <strong>Database-enforced handoff</strong>
            <small>One accepted completion. One readable history.</small>
          </span>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          {step === "email" ? (
            <>
              <span className="eyebrow">Passwordless sign in</span>
              <h2>Continue with email</h2>
              <p>
                We’ll send you a six-digit code. New accounts are created
                automatically.
              </p>
              <form onSubmit={sendCode}>
                <label>
                  <span>Email</span>
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    type="email"
                    autoComplete="email"
                    autoFocus
                    required
                  />
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
                    "Sending code…"
                  ) : (
                    <>
                      Email me a code <ArrowRight size={17} aria-hidden="true" />
                    </>
                  )}
                </button>
              </form>
            </>
          ) : step === "code" ? (
            <>
              <span className="auth-mail-icon">
                <MailCheck size={24} aria-hidden="true" />
              </span>
              <span className="eyebrow">Check your inbox</span>
              <h2>Enter your code</h2>
              <p>
                We sent a six-digit sign-in code to <strong>{email}</strong>.
              </p>
              <form onSubmit={verifyCode}>
                <label>
                  <span>Verification code</span>
                  <input
                    className="otp-input"
                    name="secret"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    required
                    minLength={6}
                    maxLength={6}
                    autoFocus
                  />
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
                    "Verifying…"
                  ) : (
                    <>
                      Verify and continue <ArrowRight size={17} aria-hidden="true" />
                    </>
                  )}
                </button>
              </form>
              <button
                className="auth-switch"
                type="button"
                onClick={() => {
                  setStep("email");
                  setError("");
                }}
              >
                <span className="auth-switch-content">
                  <ArrowLeft size={15} aria-hidden="true" />
                  <span>Use a different email</span>
                </span>
              </button>
            </>
          ) : (
            <>
              <span className="eyebrow">One last detail</span>
              <h2>What should we call you?</h2>
              <p>
                This is the name other caregivers will see in the shared
                handoff.
              </p>
              <form onSubmit={saveProfile}>
                <label>
                  <span>Your name</span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    required
                    minLength={2}
                    maxLength={100}
                    autoFocus
                  />
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
                    "Saving…"
                  ) : (
                    <>
                      Continue <ArrowRight size={17} aria-hidden="true" />
                    </>
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

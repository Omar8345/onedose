import { OneDoseLogo } from "@/components/onedose-logo";

export function AppLoading() {
  return (
    <main className="loading-shell" aria-busy="true" aria-label="Loading OneDose">
      <OneDoseLogo />
      <span className="spinner" aria-hidden="true" />
      <p>Preparing your care circle…</p>
    </main>
  );
}

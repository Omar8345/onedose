export function AppLoading() {
  return (
    <main className="loading-shell" aria-busy="true" aria-label="Loading OneDose">
      <div className="logo"><span className="logo-mark"><i /><i /></span><span>OneDose</span></div>
      <span className="spinner" />
      <p>Preparing your care circle…</p>
    </main>
  );
}

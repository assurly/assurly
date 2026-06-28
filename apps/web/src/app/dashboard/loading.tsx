export default function DashboardLoading(): React.ReactElement {
  return (
    <main className="route-state" aria-busy="true" aria-live="polite">
      <div className="route-state-card">
        <span className="route-state-spinner" aria-hidden="true" />
        <h1>Loading workspace</h1>
        <p>Verifying your session and repositories…</p>
      </div>
    </main>
  );
}

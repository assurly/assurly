'use client';

export default function DashboardError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  return (
    <main className="route-state" role="alert">
      <div className="route-state-card route-state-error">
        <h1>Workspace unavailable</h1>
        <p>We could not load your tenant workspace. Please retry the protected request.</p>
        <button className="btn btn-primary" type="button" onClick={reset}>
          Retry
        </button>
      </div>
    </main>
  );
}

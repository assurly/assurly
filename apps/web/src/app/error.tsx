'use client';

export default function RootError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  return (
    <main className="route-state" role="alert">
      <div className="route-state-card route-state-error">
        <h1>Assurly could not load</h1>
        <p>The request failed safely. No project data was exposed.</p>
        <button className="btn btn-primary" type="button" onClick={reset}>
          Try again
        </button>
      </div>
    </main>
  );
}

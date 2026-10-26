// Vercel adds ASSURLY_LIVE_LOCK_ID when a Live Lock is connected to this
// project. It is not a secret and nothing needs it; the page only uses it to
// say whether the lock is on. It is read on the server and never sent as-is.
const isGuarded = Boolean(process.env.ASSURLY_LIVE_LOCK_ID);

export default function Home() {
  return (
    <main>
      <p className="eyebrow">Assurly Live Lock</p>
      <h1>Every production deploy is checked before it ships.</h1>
      <p className={isGuarded ? 'status on' : 'status off'}>
        {isGuarded
          ? 'Live Lock is connected to this project.'
          : 'Live Lock is not connected yet. Connect it to this project in Vercel.'}
      </p>
      <ol>
        <li>Deploy to production as usual.</li>
        <li>
          Open the deployment in Vercel and find the <strong>Assurly Live Lock</strong> check.
        </li>
        <li>
          Start in Monitor mode; switch to Enforce (Pro plan) to hold back a deploy with a proven
          blocker.
        </li>
      </ol>
      <p>
        <a href="https://assurly.dev/live-lock/getting-started">Read the guide</a>
      </p>
    </main>
  );
}

# Next.js, guarded by Assurly Live Lock

A minimal Next.js app whose production deploys are checked by
[Assurly Live Lock](https://assurly.dev/live-lock/getting-started) before they
reach your domain.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fassurly%2Flive-lock-nextjs&project-name=live-lock-nextjs&repository-name=live-lock-nextjs&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22assurly-live-lock%22%2C%22productSlug%22%3A%22live-lock%22%7D%5D)

The button clones this repository, creates a Vercel project and adds a Live
Lock to it from the Vercel Marketplace.

## What happens on each deploy

1. Vercel builds the production deployment.
2. The **Assurly Live Lock** deployment check runs a fresh, read-only check of
   that exact build on its `*.vercel.app` address.
3. In **Monitor** mode the result is reported. In **Enforce** mode (Pro plan) a
   proven high-severity blocker keeps your domain on the previous deployment.
   Anything Assurly cannot decide is released, never held.

## Environment variables

| Name                   | Set by                                | Used for                                                                                                |
| ---------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `ASSURLY_LIVE_LOCK_ID` | Vercel, when a Live Lock is connected | Naming the lock in support requests. Not a secret; the app only uses it to show whether the lock is on. |

No other configuration is needed.

## Run locally

```bash
npm install
npm run dev
```

## Learn more

- [Get started with Live Lock on Vercel](https://assurly.dev/live-lock/getting-started)
- [Assurly](https://assurly.dev)

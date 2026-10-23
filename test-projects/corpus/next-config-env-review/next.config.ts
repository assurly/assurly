import type { NextConfig } from 'next'

const basePath = '/chat'

// Next.js inlines these at build time from this file; nobody sets them in the
// deploy environment, so they do not belong in .env.example.
const nextConfig: NextConfig = {
  basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_APP_VERSION: '1.4.0',
  },
}

export default nextConfig

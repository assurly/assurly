import type { Metadata } from 'next'
import type { ReactElement } from 'react'

export const metadata: Metadata = {
  title: 'Assurly live test target',
  description:
    'Deliberately vulnerable mini app for Assurly active-probe and repo↔URL binding. Fake data only.',
}

export default function RootLayout({ children }: LayoutProps<'/'>): ReactElement {
  const verifyToken = process.env.NEXT_PUBLIC_ASSURLY_VERIFY_TOKEN ?? ''

  return (
    <html lang="en">
      <head>
        {verifyToken ? (
          <meta name="assurly-verify" content={verifyToken} />
        ) : (
          <meta name="assurly-verify" content="" />
        )}
      </head>
      <body>{children}</body>
    </html>
  )
}

import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { CookieNotice } from './_components/CookieNotice';
import './design-tokens.css';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'ShipReady | Production-Readiness Verifier for B2B SaaS & Next.js',
  description:
    'Detect integration errors, environment misconfigurations, and security vulnerabilities in your Next.js, Supabase, and Stripe apps before deploying.',
  other: {
    google: 'notranslate',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      translate="no"
      className={`${geistSans.variable} ${geistMono.variable} notranslate`}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        {children}
        <CookieNotice />
      </body>
    </html>
  );
}

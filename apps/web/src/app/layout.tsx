import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { CookieNotice } from './_components/CookieNotice';
import { ThemeProvider } from './_components/ThemeProvider';
import { getApplicationUrl } from '../utils/env';
import { publicPageUrl } from '../utils/siteMetadata';
import { THEME_BOOTSTRAP_SCRIPT, THEME_COLOR_HEX } from '../utils/theme';
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

const SITE_TITLE = 'Assurly | Pre-deploy Ship Gate for AI-built SaaS';
const SITE_DESCRIPTION =
  'Scan your deployed URL in 60 seconds, get a Ship Score, fix blockers with one click, and monitor every deploy — before you ship to Vercel, Supabase, and Stripe.';

const applicationUrl = getApplicationUrl();
const homeUrl = publicPageUrl(applicationUrl, '/');

export const metadata: Metadata = {
  // Resolves relative `canonical` / `openGraph.url` on child pages. Homepage
  // canonical is a real `<link>` in `page.tsx`: Next's Metadata API strips the
  // origin trailing slash, which would disagree with sitemap.xml.
  metadataBase: new URL(applicationUrl),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  // Icons. `app/favicon.ico` is auto-linked by the file convention; these add the
  // scalable SVG (preferred by modern browsers), the PNG fallbacks, and the iOS
  // home-screen icon. The maskable PNGs for Android live in the web manifest.
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  manifest: '/site.webmanifest',
  // Installed-PWA / iOS home-screen behaviour.
  appleWebApp: {
    capable: true,
    title: 'Assurly',
    statusBarStyle: 'black-translucent',
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    type: 'website',
    url: homeUrl,
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLOR_HEX.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLOR_HEX.dark },
  ],
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
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider>
          {children}
          <CookieNotice />
        </ThemeProvider>
      </body>
    </html>
  );
}

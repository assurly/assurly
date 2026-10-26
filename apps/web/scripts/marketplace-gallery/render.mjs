#!/usr/bin/env node
// Renders the Vercel Marketplace gallery images from gallery.html.
// Usage (from apps/web): node scripts/marketplace-gallery/render.mjs
// Output: public/marketplace/live-lock-gallery-<n>.png, 1920×1080 each.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = pathToFileURL(join(here, 'gallery.html')).href;
const outDir = join(here, '..', '..', 'public', 'marketplace');

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  await page.goto(source);
  const slides = await page.locator('section[data-slide]').all();
  for (const slide of slides) {
    const n = await slide.getAttribute('data-slide');
    const file = join(outDir, `live-lock-gallery-${n}.png`);
    await slide.screenshot({ path: file });
    console.log(`wrote ${file}`);
  }
} finally {
  await browser.close();
}

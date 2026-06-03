#!/usr/bin/env node

/**
 * screenshot.mjs — Capture a full-page screenshot of a running local app.
 *
 * Usage:
 *   node screenshot.mjs <url> [label]
 *
 * Examples:
 *   node screenshot.mjs http://localhost:3000
 *   node screenshot.mjs http://localhost:3000 bidding-phase
 *   node screenshot.mjs http://localhost:3000 trump-reveal
 *
 * Output:
 *   ./temporary screenshots/screenshot-N.png          (no label)
 *   ./temporary screenshots/screenshot-N-label.png    (with label)
 *
 * The counter N auto-increments. Files are never overwritten.
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const url = process.argv[2];
const label = process.argv[3] || '';

if (!url) {
  console.error('Usage: node screenshot.mjs <url> [label]');
  process.exit(1);
}

const OUTPUT_DIR = path.join(process.cwd(), 'temporary screenshots');
const VIEWPORT = { width: 1280, height: 800 };

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Find the next available counter
function getNextCounter() {
  const files = fs.readdirSync(OUTPUT_DIR);
  let max = 0;
  for (const f of files) {
    const match = f.match(/^screenshot-(\d+)/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

async function captureScreenshot() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  } catch (err) {
    console.error(`Failed to load ${url}: ${err.message}`);
    await browser.close();
    process.exit(1);
  }

  // Small delay to let animations / transitions settle
  await new Promise(r => setTimeout(r, 1000));

  const counter = getNextCounter();
  const suffix = label ? `-${label}` : '';
  const filename = `screenshot-${counter}${suffix}.png`;
  const filepath = path.join(OUTPUT_DIR, filename);

  await page.screenshot({ path: filepath, fullPage: true });
  console.log(`Saved: ${filepath}`);

  await browser.close();
}

captureScreenshot();

// يولّد أيقونات PNG من icons/icon.svg باستخدام Chromium (Playwright).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = fs.readFileSync(path.join(root, 'icons/icon.svg'), 'utf8');
const exe = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
async function render(size, name, maskable) {
  const inner = maskable
    ? `<div style="width:${size}px;height:${size}px;background:#1e3a5f;display:grid;place-items:center"><div style="width:${size * 0.7}px;height:${size * 0.7}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></div>`
    : `<div style="width:${size}px;height:${size}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div>`;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:transparent">${inner}</body>`);
  await page.screenshot({ path: path.join(root, 'icons', name), omitBackground: true });
}
await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(512, 'icon-maskable-512.png', true);
await browser.close();
console.log('تم توليد الأيقونات');

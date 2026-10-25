// Fills the live numbers into deck.html and renders the PDF with system Chrome.
//   node deck/build.mjs
// needs playwright (npm i playwright) and Google Chrome installed
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir = path.dirname(fileURLToPath(import.meta.url));
const s = await (await fetch('https://mezo.ochinimus.app/stats')).json();
const rows = (await (await fetch('https://mezo.ochinimus.app/payments.csv')).text()).trim().split('\n').slice(1);
const html = readFileSync(`${dir}/deck.html`, 'utf8')
  .replaceAll('@@COUNT@@', String(s.settled_calls)).replaceAll('@@MUSD@@', s.musd_settled)
  .replaceAll('@@MEDIAN@@', process.env.MEDIAN_S || '12').replaceAll('@@WHEN@@', new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
writeFileSync(`${dir}/.deck-filled.html`, html);
const b = await chromium.launch({ headless: true, channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto(`file://${dir}/.deck-filled.html`);
await p.pdf({ path: `${dir}/agentfeed-mezo-deck.pdf`, width: '1280px', height: '720px', printBackground: true });
await b.close();
console.log('deck built from', rows.length, 'payments');

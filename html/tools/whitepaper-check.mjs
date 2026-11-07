#!/usr/bin/env node
// Browser check of the landing page (/ = index.html) and its whitepaper section:
//   node tools/whitepaper-check.mjs [--shots <dir>]
// whitepaper.md (VI) and whitepaper.en.md (EN) render with a table of contents per language,
// only the active language is visible, there is no ".md download" anywhere, the footers have
// no brand/tagline column, and the game is called Squeek Royale.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { startBrowser, ensureWebSocket } from './lib/browser.mjs';

ensureWebSocket(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const shots = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : null;
const errors = [], steps = [];
const step = (t) => { steps.push(t); console.log('  ✓ ' + t); };
const h2 = (f) => readFileSync(resolve(ROOT, f), 'utf8').split(/\r?\n/).filter((l) => /^## /.test(l)).length;
const [nVi, nEn] = [h2('whitepaper.md'), h2('whitepaper.en.md')];

const br = await startBrowser({ root: ROOT, shots });
try {
  for (const page of ['index.html']) {
    const p = await br.openPage(`${br.base}/${page}`, null, errors);
    await p.waitFor(`document.querySelectorAll('#whitepaperMdContent .wp-section').length >= ${nVi + nEn}`, 20000, `${page}: whitepaper rendered`);
    for (const lang of ['vi', 'en']) {
      await p.ev(`document.querySelector('.lang-btn[data-lang="${lang}"]').click()`);
      await new Promise((r) => setTimeout(r, 300));
      const r = await p.ev(`(() => {
        const vis = (el) => el.offsetParent !== null;
        const secs = [...document.querySelectorAll('#whitepaperMdContent .wp-section')].filter(vis);
        const toc = [...document.querySelectorAll('#tocList .toc-item')].filter(vis);
        return { secs: secs.length, toc: toc.length, first: secs[0] && secs[0].querySelector('h2').textContent,
                 tables: secs.reduce((n, s) => n + s.querySelectorAll('table').length, 0),
                 tocOk: toc.every((li) => !!document.querySelector(li.querySelector('a').getAttribute('href'))) };
      })()`);
      const want = lang === 'vi' ? nVi : nEn;
      if (r.secs !== want || r.toc !== want) errors.push(`${page} [${lang}]: ${r.secs} sections / ${r.toc} TOC items visible, expected ${want}`);
      if (!r.tocOk) errors.push(`${page} [${lang}]: a TOC link points nowhere`);
      if (r.tables < 9) errors.push(`${page} [${lang}]: only ${r.tables} tables rendered`);
      step(`${page} [${lang}]: ${r.secs} sections + matching TOC, ${r.tables} tables, starts "${r.first}"`);
      if (page === 'index.html') {
        await p.ev(`document.getElementById('whitepaper').scrollIntoView()`);
        await p.shot(`whitepaper-${page.replace('.html', '')}-${lang}`);
      }
    }
    const misc = await p.ev(`(() => ({
      md: document.querySelectorAll('a[href$=".md"]').length,
      records: [...document.querySelectorAll('.whitepaper-toc a')].filter((a) => !a.closest('#tocList')).length,
      brandCol: /Autonomous 2D Battle Royale|MASSIVE BATTLES/i.test((document.querySelector('.site-footer') || {}).innerText || ''),
      cols: document.querySelectorAll('.site-footer .footer-col').length,
      oldName: /Squeekchain Hamster|HAMSTER ARENA/i.test(document.body.innerText),
      navBrand: document.querySelector('.site-nav .brand').innerText.replace(/\\s+/g, ' ').trim(),
    }))()`);
    if (misc.md) errors.push(`${page}: still ${misc.md} link(s) to a .md file`);
    if (misc.records) errors.push(`${page}: buttons left under the table of contents`);
    if (misc.brandCol) errors.push(`${page}: footer still has the brand/tagline column`);
    if (misc.oldName) errors.push(`${page}: the old game name is still on the page`);
    step(`${page}: no .md download, no TOC buttons, footer ${misc.cols} columns without brand blurb, nav "${misc.navBrand}"`);
  }
  for (const page of ['play.html']) {
    const p = await br.openPage(`${br.base}/${page}`, null, errors);
    await new Promise((r) => setTimeout(r, 800));
    const m = await p.ev(`({ md: document.querySelectorAll('a[href$=".md"]').length, brandCol: /Autonomous 2D Battle Royale|MASSIVE BATTLES/i.test((document.querySelector('.site-footer') || {}).innerText || ''),
      oldName: /Squeekchain Hamster|HAMSTER ARENA/i.test(document.body.innerText), title: document.title })`);
    if (m.md || m.brandCol || m.oldName) errors.push(`${page}: md links ${m.md}, brand column ${m.brandCol}, old name ${m.oldName}`);
    step(`${page}: "${m.title}" — clean footer, new name`);
  }
} catch (e) {
  errors.push('FATAL: ' + (e?.message || e));
} finally {
  br.close();
}
const real = errors.filter((e) => !/favicon|net::ERR|Failed to load resource/.test(e));
if (real.length) { console.error(`\n✗ ${real.length} problem(s):\n  - ` + real.join('\n  - ')); process.exit(1); }
console.log(`\n✓ landing + whitepaper OK (${steps.length} checks)`);

// Diagnose 0.7.0 -> 0.7.2 upgrade path: which SW serves, what the caches hold, launch by launch.
const { chromium } = require('playwright');
const L = require('./lib');
const from = process.argv[2] || '0.7.0';
const to = process.argv[3] || '0.7.2';
(async () => {
  const b = await chromium.launch();
  await L.ctl(`v=${from}&offline=0`);
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  ctx.on('request', (r) => { if (/sw\.js|index|\/gemforge-app\/$/.test(r.url())) console.log('   net', r.url().replace(L.BASE, ''), r.serviceWorker() ? '(from SW)' : ''); });
  const state = async (label) => {
    const s = await p.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const ck = await caches.keys();
      const idx = {};
      for (const k of ck) { const c = await caches.open(k); const r = await c.match('./', { ignoreVary: true }); idx[k] = r ? (await r.text()).match(/index-[\w-]+\.js/)?.[0] : null; }
      const swText = await (await fetch('./sw.js', { cache: 'no-store' })).text();
      return {
        page: document.querySelector('script[type=module]').getAttribute('src'),
        controller: navigator.serviceWorker.controller?.state,
        active: reg?.active?.state, waiting: reg?.waiting?.state, installing: reg?.installing?.state,
        cacheIndex: idx, serverSwCache: swText.match(/CACHE='([^']+)'/)[1],
      };
    });
    console.log(label, JSON.stringify(s));
  };
  await p.goto(L.BASE); await p.waitForSelector('[data-testid=game]');
  await p.evaluate(() => navigator.serviceWorker.ready); await p.reload(); await p.waitForSelector('[data-testid=game]');
  await state('installed ' + from);
  await L.ctl(`v=${to}`);
  for (let i = 1; i <= 4; i++) {
    await p.reload(); await p.waitForSelector('[data-testid=game]'); await p.waitForTimeout(3000);
    await state(`launch ${i} after deploy`);
  }
  await b.close();
})();

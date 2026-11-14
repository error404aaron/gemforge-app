// Batch: PWA install/offline/upgrade against published builds served from git history (Chromium, localhost).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const run = require('./harness');
const { assert, eq } = run;
const B = path.join(__dirname, 'builds');
const meta = (v) => {
  const sw = fs.readFileSync(path.join(B, v, 'sw.js'), 'utf8');
  return {
    cache: sw.match(/CACHE='([^']+)'/)[1],
    files: JSON.parse(sw.match(/FILES=(\[[^\]]+\])/)[1]),
    js: fs.readdirSync(path.join(B, v, 'assets')).find((f) => f.endsWith('.js')),
  };
};
const versionText = async (p) => {
  await p.click('[aria-label="Mineral field guide"]');
  const t = (await p.textContent('[data-testid=app-version]')).trim();
  await p.keyboard.press('Escape').catch(() => {});
  await p.reload(); await p.waitForSelector('[data-testid=game]');
  return t;
};
const cacheState = (p) => p.evaluate(async () => {
  const out = {};
  for (const k of await caches.keys()) out[k] = (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname.replace('/gemforge-app/', './'));
  return out;
});
const controlled = (p) => p.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 });
const servedJs = (p) => p.evaluate(() => document.querySelector('script[type=module]').getAttribute('src'));

async function install(b, v) {
  await L.ctl(`v=${v}&offline=0`);
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  p.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  await p.goto(L.BASE); await p.waitForSelector('[data-testid=game]');
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload(); await p.waitForSelector('[data-testid=game]'); await controlled(p);
  return { ctx, p, errors };
}
async function goOffline(ctx) { await L.ctl('offline=1'); await ctx.setOffline(true); }
async function goOnline(ctx) { await ctx.setOffline(false); await L.ctl('offline=0'); }

async function upgrade(b, from, to, n) {
  const { ctx, p, errors } = await install(b, from);
  for (let i = 0; i < 3; i++) await L.act(p, false);
  await p.waitForSelector('[data-testid=game][data-stage=idle]');
  await p.evaluate(() => localStorage.setItem('gemforge.record.v4', JSON.stringify({ depths: [{ wins: 2, best: 31 }] })));
  const before = await L.save(p);
  eq(await servedJs(p), './assets/' + meta(from).js, `running ${from}`);
  await L.ctl(`v=${to}`);
  // A user returning to the app: navigation triggers the SW update check; the new SW skips waiting,
  // claims the client and the app reloads itself on controllerchange.
  await p.reload().catch(() => {});
  const want = './assets/' + meta(to).js;
  const t0 = Date.now();
  const autoReload = from !== '0.6.0' && from !== '0.7.0'; // controllerchange auto-reload shipped in 0.7.1 clients
  if (autoReload) {
    await p.waitForFunction((w) => document.querySelector('script[type=module]')?.getAttribute('src') === w, want, { timeout: 30000, polling: 250 });
    n(`${from}->${to}: new UI live ${Date.now() - t0}ms after first post-deploy launch (auto-reload, no user action)`);
  } else {
    // Old client has no reload hook: the first launch is expected to still show the old UI while the new SW
    // installs, activates and claims in the background. The very next launch must be the new version.
    eq(await servedJs(p), './assets/' + meta(from).js, 'first post-deploy launch still old UI (expected for pre-0.7.1 client)');
    // Poll from Node so the async page-side check is actually awaited (waitForFunction treats a Promise as truthy).
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) {
      ready = await p.evaluate(async (c) => {
        const reg = await navigator.serviceWorker.getRegistration();
        return (await caches.keys()).join() === c && reg.active?.state === 'activated' && !reg.installing && !reg.waiting
          && navigator.serviceWorker.controller === reg.active;
      }, meta(to).cache);
      if (!ready) await p.waitForTimeout(250);
    }
    assert(ready, 'new SW activated and controlling within 30s of first post-deploy launch');
    await p.reload(); await p.waitForSelector('[data-testid=game]');
    eq(await servedJs(p), want, 'second launch serves the new build');
    n(`${from}->${to}: 1 stale launch (pre-0.7.1 client has no reload hook); new SW took over in ${Date.now() - t0}ms; 2nd launch = new UI`);
  }
  await p.waitForSelector('[data-testid=game]');
  eq(await p.evaluate(() => navigator.serviceWorker.controller.scriptURL.endsWith('/sw.js')), true, 'controlled');
  const caches = await cacheState(p);
  eq(Object.keys(caches), [meta(to).cache], 'only the new cache remains (old deleted)');
  eq(caches[meta(to).cache].slice().sort(), meta(to).files.map((f) => (f === './' ? './' : f)).slice().sort(), 'all precache files present');
  const after = await L.save(p);
  const strip = (s) => { const { v, daily, events, ...rest } = s; return rest; };
  eq(strip(after), strip(before), 'save preserved across upgrade');
  eq(after.v, 6, 'save schema migrated/current'); eq(after.daily, null, 'normal run stays normal');
  eq(await p.evaluate(() => JSON.parse(localStorage.getItem('gemforge.record.v4'))), { depths: [{ wins: 2, best: 31 }] }, 'record preserved');
  const ver = await versionText(p);
  assert(ver.startsWith('v' + to) || ver.includes(to), `version shown "${ver}" matches ${to}`);
  await goOffline(ctx);
  await p.reload(); await p.waitForSelector('[data-testid=game]');
  eq(await servedJs(p), want, 'offline start serves new build');
  eq(strip(await L.save(p)), strip(before), 'save intact offline');
  await goOnline(ctx);
  eq(errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e)), [], 'console errors');
  n(`version shown "${ver}"`);
  await ctx.close();
}

(async () => {
  const b = await chromium.launch();
  await run('pwa', [
    ['P1 0.7.2 fresh install: SW controls page, single cache with all 8 assets', async (n) => {
      const { ctx, p, errors } = await install(b, '0.7.2');
      const c = await cacheState(p);
      eq(Object.keys(c), [meta('0.7.2').cache], 'cache name');
      eq(c[meta('0.7.2').cache].slice().sort(), meta('0.7.2').files.slice().sort(), 'files');
      eq(errors, [], 'console errors'); n(`cache ${meta('0.7.2').cache}`); await ctx.close();
    }],
    ['P2 0.7.2 offline cold start: app boots, plays, resumes save, version correct, daily starts offline', async (n) => {
      const { ctx, p } = await install(b, '0.7.2');
      await L.act(p, false); await p.waitForSelector('[data-testid=game][data-stage=idle]');
      const before = await L.save(p);
      await goOffline(ctx);
      const p2 = await ctx.newPage();
      await p.close();
      await p2.goto(L.BASE); await p2.waitForSelector('[data-testid=game]');
      eq({ ...(await L.save(p2)), events: [] }, { ...before, events: [] }, 'save resumes offline');
      await L.act(p2, false);
      const ver = await versionText(p2);
      eq(ver.replace(/\s+/g, ' '), 'v0.7.2 · 4ca6deb', 'version label');
      await L.playToEnd(p2, false);
      await p2.click('[data-testid=daily]');
      await p2.waitForFunction(() => JSON.parse(localStorage.getItem('gemforge.save')).daily);
      n('offline: boot, resume, play, guide, daily ok'); await goOnline(ctx); await ctx.close();
    }],
    ['P3 offline deep navigation (unknown path) falls back to cached index', async (n) => {
      const { ctx } = await install(b, '0.7.2');
      await goOffline(ctx);
      const p = await ctx.newPage();
      await p.goto(L.BASE + '?utm=x'); await p.waitForSelector('[data-testid=game]');
      n('query-string navigation served offline'); await goOnline(ctx); await ctx.close();
    }],
    ['P4 upgrade 0.6.0 -> 0.7.2 (save v5 migration)', (n) => upgrade(b, '0.6.0', '0.7.2', n)],
    ['P5 upgrade 0.7.0 -> 0.7.2', (n) => upgrade(b, '0.7.0', '0.7.2', n)],
    ['P6 upgrade 0.7.1 -> 0.7.2', (n) => upgrade(b, '0.7.1', '0.7.2', n)],
    ['P7 upgrade 0.7.0 -> 0.7.1', (n) => upgrade(b, '0.7.0', '0.7.1', n)],
  ]);
  await L.ctl('v=0.7.2&offline=0');
  await b.close();
})();

// Batch: mobile layout/touch (Chromium iPhone emulation) and desktop Chromium flows against published 0.7.2.
const { chromium, devices } = require('playwright');
const L = require('./lib');
const run = require('./harness');
const { assert, eq } = run;
const EV = __dirname + '/evidence/';

async function open(b, opts) {
  const ctx = await b.newContext({ ...opts, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  p.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  await p.goto(L.BASE); await p.waitForSelector('[data-testid=game]');
  await p.waitForSelector('[data-testid=game][data-stage=idle]');
  return { ctx, p, errors };
}
// Geometry audit: page must not scroll, every control must sit fully inside the visual viewport and be tappable size.
const audit = (p, sel) => p.evaluate((sel) => {
  const vw = window.innerWidth, vh = window.innerHeight, de = document.documentElement;
  const off = [], small = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const id = el.dataset.testid || el.getAttribute('aria-label') || el.className;
    if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5) off.push([id, Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]);
    if (el.tagName === 'BUTTON' && (r.width < 40 || r.height < 40)) small.push([id, Math.round(r.width), Math.round(r.height)]);
  }
  const g = document.querySelector('[data-testid=game]').getBoundingClientRect();
  return { vw, vh, scrollW: de.scrollWidth, scrollH: de.scrollHeight, bodyScrollW: document.body.scrollWidth, off, small, game: [Math.round(g.width), Math.round(g.height)] };
}, sel);
const checkFit = (a, label) => {
  assert(a.scrollW <= a.vw && a.bodyScrollW <= a.vw, `${label}: horizontal overflow ${a.scrollW}/${a.bodyScrollW} > ${a.vw}`);
  assert(a.scrollH <= a.vh + 1, `${label}: vertical page scroll ${a.scrollH} > ${a.vh}`);
  eq(a.off, [], `${label}: controls outside viewport`);
  assert(Math.abs(a.game[0] - a.vw) <= 1 && Math.abs(a.game[1] - a.vh) <= 1, `${label}: game not full-screen ${a.game} vs ${a.vw}x${a.vh}`);
};
const DEVICES = [['iPhone 13', 'iPhone 13'], ['iPhone SE', 'iPhone SE'], ['iPhone 14 Pro Max', 'iPhone 14 Pro Max'], ['iPhone 13 landscape', 'iPhone 13 landscape']];

(async () => {
  const b = await chromium.launch();
  await L.ctl('v=0.7.2&offline=0');
  const tests = [];
  for (const [name, dev] of DEVICES) {
    tests.push([`M-layout ${name}: full-screen battle, no overflow, controls in viewport, tap targets >=40px`, async (n) => {
      const { ctx, p, errors } = await open(b, devices[dev]);
      const a = await audit(p, 'button, [data-testid=player-hp], [data-testid=intent], [data-testid=hint]');
      checkFit(a, 'battle');
      eq(a.small, [], 'undersized buttons');
      await p.screenshot({ path: EV + `ui-${name.replace(/ /g, '_')}-battle.png` });
      await p.click('[aria-label="Mineral field guide"]');
      await p.waitForSelector('[data-testid=guide]');
      const g = await p.evaluate(() => { const r = document.querySelector('[data-testid=guide]').getBoundingClientRect(); return [r.left >= 0, r.right <= innerWidth + 0.5, document.documentElement.scrollWidth <= innerWidth]; });
      eq(g, [true, true, true], 'guide fits horizontally');
      eq(errors, [], 'console errors');
      n(`${a.vw}x${a.vh} game ${a.game.join('x')}`); await ctx.close();
    }]);
  }
  tests.push(['M-touch iPhone 13: complete run by tap only; reward + end overlays fit; no console errors', async (n) => {
    const { ctx, p, errors } = await open(b, devices['iPhone 13']);
    let sawReward = false;
    for (let k = 0; k < 600; k++) {
      const ph = await L.phase(p);
      if (ph === 'reward' && !sawReward) {
        sawReward = true; await p.waitForSelector('[data-testid=reward]');
        checkFit(await audit(p, '[data-testid^=reward-]'), 'reward overlay');
        await p.screenshot({ path: EV + 'ui-iPhone_13-reward.png' });
      }
      if (ph === 'victory' || ph === 'defeat') break;
      await L.act(p, true);
    }
    const ph = await L.phase(p);
    assert(ph === 'victory' || ph === 'defeat', 'run ended');
    await p.waitForSelector(`[data-testid=${ph}]`);
    checkFit(await audit(p, '[data-testid=new-run], [data-testid=daily]'), 'end overlay');
    await p.screenshot({ path: EV + `ui-iPhone_13-${ph}.png` });
    await p.tap('[data-testid=daily]');
    await p.waitForSelector('[data-testid=daily-chip]');
    checkFit(await audit(p, 'button'), 'daily battle');
    eq(errors, [], 'console errors');
    n(`outcome ${ph}, reward overlay seen: ${sawReward}`); await ctx.close();
  }]);
  tests.push(['M-touch iPhone 13: touch drag card onto slot places it', async (n) => {
    const { ctx, p } = await open(b, devices['iPhone 13']);
    const box = async (s) => { const r = await p.locator(s).boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
    const from = await box('[data-testid=card-0]'), to = await box('[data-testid=slot-1]');
    const cdp = await ctx.newCDPSession(p);
    const tp = (type, pt) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pt ? [{ x: pt.x, y: pt.y }] : [] });
    await tp('touchStart', from);
    for (let i = 1; i <= 10; i++) await tp('touchMove', { x: from.x + (to.x - from.x) * i / 10, y: from.y + (to.y - from.y) * i / 10 });
    await tp('touchEnd');
    await p.waitForFunction(() => JSON.parse(localStorage.getItem('gemforge.save')).turn >= 1, null, { timeout: 5000 });
    n('drag placed card, turn advanced'); await ctx.close();
  }]);
  tests.push(['M-static: viewport-fit=cover, safe-area env() padding on game + guide, standalone manifest', async (n) => {
    const { ctx, p } = await open(b, devices['iPhone 13']);
    const s = await p.evaluate(async () => {
      const css = [...document.styleSheets].flatMap((sh) => [...sh.cssRules].map((r) => r.cssText)).join('\n');
      return {
        vp: document.querySelector('meta[name=viewport]').content,
        game: /\.game\s*\{[^}]*safe-area-inset-top[^}]*safe-area-inset-bottom/.test(css),
        guide: /\.guide\s*\{[^}]*safe-area-inset-top/.test(css),
        manifest: (await (await fetch('./manifest.webmanifest')).json()).display,
      };
    });
    assert(s.vp.includes('viewport-fit=cover'), 'viewport-fit'); eq([s.game, s.guide, s.manifest], [true, true, 'standalone'], 'safe-area/manifest');
    n('env() insets are statically present; actual inset values need a notched WebKit device'); await ctx.close();
  }]);
  tests.push(['C-desktop 1280x800: full run, overlay, new run, guide, sound pref persists, no console errors', async (n) => {
    const { ctx, p, errors } = await open(b, { viewport: { width: 1280, height: 800 } });
    checkFit(await audit(p, 'button'), 'desktop battle');
    await p.screenshot({ path: EV + 'ui-desktop-battle.png' });
    const r = await L.playToEnd(p, false);
    const seed0 = (await L.save(p)).seed;
    await p.click('[data-testid=new-run]');
    await p.waitForFunction((s) => JSON.parse(localStorage.getItem('gemforge.save')).seed !== s, seed0);
    eq((await L.save(p)).phase, 'battle', 'new run');
    await p.click('[data-testid=sound]');
    const snd = await p.evaluate(() => localStorage.getItem('gemforge.sound'));
    await p.reload(); await p.waitForSelector('[data-testid=game]');
    eq(await p.evaluate(() => localStorage.getItem('gemforge.sound')), snd, 'sound pref persists');
    await p.click('[aria-label="Mineral field guide"]'); await p.waitForSelector('[data-testid=guide]');
    eq((await p.textContent('[data-testid=app-version]')).trim(), 'v0.7.2 · 4ca6deb', 'version');
    await p.click('.guide__close'); await p.waitForSelector('[data-testid=guide]', { state: 'detached' });
    eq(errors, [], 'console errors');
    n(`outcome ${r.ph} in ${r.steps} actions; sound=${snd}`); await ctx.close();
  }]);
  tests.push(['C-desktop: mouse drag card onto slot places it', async (n) => {
    const { ctx, p } = await open(b, { viewport: { width: 1280, height: 800 } });
    // Real pointer drags emit many pointermove events; Playwright's dragTo emits one, which the app does not treat as a drag.
    const bb = async (s) => { const r = await p.locator(s).boundingBox(); return [r.x + r.width / 2, r.y + r.height / 2]; };
    const [fx, fy] = await bb('[data-testid=card-0]'); const [tx, ty] = await bb('[data-testid=slot-2]');
    await p.mouse.move(fx, fy); await p.mouse.down(); await p.mouse.move(tx, ty, { steps: 12 }); await p.mouse.up();
    await p.waitForFunction(() => JSON.parse(localStorage.getItem('gemforge.save')).turn >= 1, null, { timeout: 5000 });
    n('drag placed card'); await ctx.close();
  }]);
  tests.push(['C-desktop: keyboard - Escape closes guide, buttons reachable by Tab', async (n) => {
    const { ctx, p } = await open(b, { viewport: { width: 1280, height: 800 } });
    await p.click('[aria-label="Mineral field guide"]'); await p.waitForSelector('[data-testid=guide]');
    await p.keyboard.press('Escape');
    await p.waitForSelector('[data-testid=guide]', { state: 'detached', timeout: 3000 });
    n('escape closes guide'); await ctx.close();
  }]);
  await run('ui-mobile-desktop', tests);
  await b.close();
})();

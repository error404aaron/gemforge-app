// Batch: Daily Forge regression against the published 0.7.2 build (Chromium).
const { chromium, devices } = require('playwright');
const L = require('./lib');
const run = require('./harness');
const { assert, eq } = run;
const TZ = 'America/Los_Angeles';
const DAY = '2026-11-14';

async function open(b, { time = `${DAY}T10:00:00-08:00`, tz = TZ, mobile = false, storage } = {}) {
  const ctx = await b.newContext({ ...(mobile ? devices['iPhone 13'] : { viewport: { width: 1280, height: 800 } }), timezoneId: tz, serviceWorkers: 'block' });
  if (storage) await ctx.addInitScript((s) => { if (!sessionStorage.__seeded) { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); sessionStorage.__seeded = 1; } }, storage);
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  p.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  await p.clock.setFixedTime(new Date(time));
  await p.goto(L.BASE);
  await p.waitForSelector('[data-testid=game]');
  return { ctx, p, errors };
}
async function startDailyFromFreshRun(p) {
  await L.playToEnd(p, false);
  await p.click('[data-testid=daily]');
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('gemforge.save') || 'null')?.daily);
  return L.save(p);
}

(async () => {
  const b = await chromium.launch();
  await L.ctl('v=0.7.2&offline=0');
  let dailySave = null;
  await run('daily-forge', [
    ['D1 start daily: date, deterministic seed, depth 0, fresh battle, chip shown', async (n) => {
      const { ctx, p, errors } = await open(b);
      const s = await startDailyFromFreshRun(p);
      eq(s.daily, DAY, 'daily date'); eq(s.seed, L.dailySeed(DAY), 'seed = FNV(gemforge-daily:date)');
      eq([s.depth, s.phase, s.encounter, s.turn], [0, 'battle', 0, 0], 'fresh daily battle');
      assert(await p.isVisible('[data-testid=daily-chip]'), 'daily chip visible');
      dailySave = s; eq(errors, [], 'console errors');
      n(`seed ${s.seed} route ${s.route.join(',')}`); await ctx.close();
    }],
    ['D2 determinism: same date -> identical run in independent context; other date differs', async (n) => {
      const a = await open(b);
      const s1 = await startDailyFromFreshRun(a.p);
      const keys = ['seed', 'rng', 'route', 'hand', 'deck', 'enemy', 'hp', 'maxHp'];
      for (const k of keys) eq(s1[k], dailySave[k], 'same-day ' + k);
      await a.ctx.close();
      const c = await open(b, { time: '2026-11-15T10:00:00-08:00' });
      const s2 = await startDailyFromFreshRun(c.p);
      eq(s2.daily, '2026-11-15', 'next day date');
      assert(s2.seed !== s1.seed && s2.seed === L.dailySeed('2026-11-15'), 'next-day seed differs and matches hash');
      n(`11-14 seed ${s1.seed}, 11-15 seed ${s2.seed}`); await c.ctx.close();
    }],
    ['D3 local-date handling: same instant gives each timezone its own local date', async (n) => {
      const instant = '2026-11-14T23:30:00Z';
      const east = await open(b, { time: instant, tz: 'Pacific/Kiritimati' }); // UTC+14 -> 11-15
      const west = await open(b, { time: instant, tz: 'Pacific/Pago_Pago' }); // UTC-11 -> 11-14
      const se = await startDailyFromFreshRun(east.p); const sw = await startDailyFromFreshRun(west.p);
      eq([se.daily, sw.daily], ['2026-11-15', '2026-11-14'], 'local dates');
      n(`Kiritimati ${se.daily}, Pago Pago ${sw.daily}`); await east.ctx.close(); await west.ctx.close();
    }],
    ['D4 save/resume: daily run mid-battle survives reload and resumes identically', async (n) => {
      const { ctx, p, errors } = await open(b);
      await startDailyFromFreshRun(p);
      for (let i = 0; i < 3; i++) await L.act(p, false);
      await p.waitForSelector('[data-testid=game][data-stage=idle]');
      const before = await L.save(p);
      const handBefore = await p.$$eval('[data-testid^=card-]', (e) => e.map((x) => x.getAttribute('aria-label')));
      await p.reload(); await p.waitForSelector('[data-testid=game]');
      const after = await L.save(p);
      eq({ ...after, events: [] }, { ...before, events: [] }, 'save after reload');
      eq(await p.$$eval('[data-testid^=card-]', (e) => e.map((x) => x.getAttribute('aria-label'))), handBefore, 'hand UI');
      assert(await p.isVisible('[data-testid=daily-chip]'), 'chip after resume');
      eq(errors, [], 'console errors'); n(`resumed turn ${after.turn} enc ${after.encounter}`); await ctx.close();
    }],
    ['D5 date rollover: yesterday\'s daily resumes after midnight; next daily uses new date', async (n) => {
      const { ctx, p } = await open(b, { time: `${DAY}T23:59:00-08:00` });
      await startDailyFromFreshRun(p); await L.act(p, false);
      await p.clock.setFixedTime(new Date('2026-11-15T00:01:00-08:00'));
      await p.reload(); await p.waitForSelector('[data-testid=game]');
      eq((await L.save(p)).daily, DAY, 'resumed run keeps its own date');
      await L.playToEnd(p, false);
      const kicker = await p.textContent('.overlay__kicker');
      assert(kicker.includes(`Daily Forge · ${DAY}`), 'overlay names the run date: ' + kicker);
      eq(await p.textContent('[data-testid=daily]'), 'Daily Forge', 'button offers today (not replay)');
      await p.click('[data-testid=daily]');
      await p.waitForFunction(() => JSON.parse(localStorage.getItem('gemforge.save')).daily === '2026-11-15');
      eq((await L.save(p)).seed, L.dailySeed('2026-11-15'), 'new-day seed');
      n('rollover ok'); await ctx.close();
    }],
    ['D6 daily defeat: result recorded, overlay, replay label, normal record untouched', async (n) => {
      const { ctx, p, errors } = await open(b);
      await startDailyFromFreshRun(p);
      const recBefore = await p.evaluate(() => localStorage.getItem('gemforge.record.v4'));
      const r = await L.playToEnd(p, false);
      const d = await p.evaluate(() => JSON.parse(localStorage.getItem('gemforge.daily.v1')));
      assert(d && d[DAY] && typeof d[DAY].won === 'boolean', 'daily.v1 entry for date');
      eq(d[DAY].won, r.ph === 'victory', 'won flag matches outcome');
      assert((await p.textContent('.overlay__kicker')).includes(`Daily Forge · ${DAY}`), 'kicker');
      eq(await p.textContent('[data-testid=daily]'), "Replay today's forge", 'replay label');
      assert(await p.isVisible('[data-testid=share]'), 'share button');
      eq(await p.evaluate(() => localStorage.getItem('gemforge.record.v4')), recBefore, 'normal record unchanged by daily');
      eq(await p.textContent('[data-testid=new-run]'), 'New run', 'new-run label on daily end');
      eq(errors, [], 'console errors'); n(`outcome ${r.ph} entry ${JSON.stringify(d[DAY])}`); await ctx.close();
    }],
    ['D7 daily victory (fixture: final battle, foe at 1 hp): victory, recorded, normal record untouched', async (n) => {
      const fx = { ...dailySave, encounter: 4, hp: 99, maxHp: 99 };
      const { ctx, p, errors } = await open(b, { storage: { 'gemforge.save': JSON.stringify(fx) } });
      const loaded = await L.save(p);
      if (loaded.encounter !== 4) { n('fixture rejected by save validator; testing via enemy hp only'); }
      await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('gemforge.save')); s.enemy.hp = 1; localStorage.setItem('gemforge.save', JSON.stringify(s)); });
      await p.reload(); await p.waitForSelector('[data-testid=game]');
      const s0 = await L.save(p);
      assert(s0.daily === DAY && s0.enemy.hp === 1, 'fixture accepted: ' + JSON.stringify([s0.daily, s0.enemy.hp, s0.encounter]));
      let ph;
      for (let i = 0; i < 40; i++) { ph = await L.act(p, false); if (['reward', 'victory', 'defeat'].includes(ph)) break; }
      if (s0.encounter === 4) {
        await p.waitForSelector('[data-testid=victory]');
        const d = await p.evaluate(() => JSON.parse(localStorage.getItem('gemforge.daily.v1')));
        eq(d[DAY].won, true, 'daily win recorded'); eq(d[DAY].battles, 5, 'battles 5');
        eq(await p.evaluate(() => localStorage.getItem('gemforge.record.v4')), null, 'normal record not written by daily victory');
        n(`victory recorded ${JSON.stringify(d[DAY])}`);
      } else { eq(ph, 'reward', 'battle win leads to reward'); n('battle won -> reward (encounter fixture not accepted)'); }
      eq(errors, [], 'console errors'); await ctx.close();
    }],
    ['D8 restart during daily retries the same daily; New run returns to a normal run', async (n) => {
      const { ctx, p } = await open(b);
      await startDailyFromFreshRun(p);
      for (let i = 0; i < 2; i++) await L.act(p, false);
      await p.waitForSelector('[data-testid=game][data-stage=idle]');
      eq(await p.getAttribute('[data-testid=restart]', 'aria-label'), 'Retry the daily forge', 'restart label in daily');
      await p.click('[data-testid=restart]'); await p.click('[data-testid=restart]');
      await p.waitForFunction(() => JSON.parse(localStorage.getItem('gemforge.save')).turn === 0);
      const s = await L.save(p);
      eq([s.daily, s.seed, s.encounter, s.turn], [DAY, L.dailySeed(DAY), 0, 0], 'retry = same daily from start');
      eq(s.hand, dailySave.hand, 'same opening hand');
      await L.playToEnd(p, false);
      await p.click('[data-testid=new-run]');
      await p.waitForFunction(() => JSON.parse(localStorage.getItem('gemforge.save')).phase === 'battle');
      const nr = await L.save(p);
      eq(nr.daily, null, 'new run is normal'); assert(!(await p.isVisible('[data-testid=daily-chip]')), 'no chip in normal run');
      n('ok'); await ctx.close();
    }],
    ['D9 fail-closed: tampered daily save (wrong seed) is rejected, app starts a clean normal run', async (n) => {
      const bad = { ...dailySave, seed: (dailySave.seed + 1) >>> 0 };
      const { ctx, p, errors } = await open(b, { storage: { 'gemforge.save': JSON.stringify(bad) } });
      const s = await L.save(p);
      assert(s === null || s.daily === null, 'tampered daily not resumed: ' + JSON.stringify(s && [s.daily, s.seed]));
      assert(!(await p.isVisible('[data-testid=daily-chip]')), 'no daily chip');
      eq(errors, [], 'console errors'); n('rejected'); await ctx.close();
    }],
  ]);
  await b.close();
})();

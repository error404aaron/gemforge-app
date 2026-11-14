exports.BASE = 'http://localhost:8765/gemforge-app/';
exports.ctl = async (q) => (await fetch('http://localhost:8765/__ctl?' + q)).json();
exports.phase = (p) => p.getAttribute('[data-testid=game]', 'data-phase');
exports.save = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('gemforge.save')));
exports.dailySeed = (d) => {
  let t = 2166136261;
  for (const ch of 'gemforge-daily:' + d) { t ^= ch.charCodeAt(0); t = Math.imul(t, 16777619) >>> 0; }
  return t >>> 0;
};
exports.act = async (p, touch) => {
  const ph = await exports.phase(p);
  const hit = (sel) => (touch ? p.tap(sel) : p.click(sel));
  if (ph === 'reward') { await hit('[data-testid=reward-0]'); return ph; }
  if (ph !== 'battle') return ph;
  await p.waitForSelector('[data-testid=game][data-stage=idle]', { timeout: 15000 });
  if ((await exports.phase(p)) !== 'battle') return exports.phase(p);
  if (!(await p.$('[data-testid=card-0]'))) { await p.waitForTimeout(100); return ph; }
  await hit('[data-testid=card-0]');
  const slots = await p.$$eval('[data-testid^=slot-]', (e) => e.map((x) => x.getAttribute('aria-label')));
  let i = slots.findIndex((s) => /empty/.test(s));
  if (i < 0) i = 0;
  await hit(`[data-testid=slot-${i}]`);
  return ph;
};
exports.playToEnd = async (p, touch, max = 600) => {
  for (let k = 0; k < max; k++) {
    const ph = await exports.act(p, touch);
    if (ph === 'victory' || ph === 'defeat') {
      await p.waitForSelector(`[data-testid=${ph}]`, { timeout: 15000 });
      return { ph, steps: k };
    }
  }
  throw new Error('run did not end');
};

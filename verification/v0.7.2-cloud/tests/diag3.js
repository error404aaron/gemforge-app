const { chromium, devices } = require('playwright');
const L = require('./lib');
(async () => {
  const b = await chromium.launch();
  // 1. landscape geometry
  const c1 = await b.newContext({ ...devices['iPhone 13 landscape'], serviceWorkers: 'block' });
  const p1 = await c1.newPage();
  await p1.goto(L.BASE); await p1.waitForSelector('[data-testid=game][data-stage=idle]');
  console.log('landscape', await p1.evaluate(() => {
    const q = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; };
    return { vw: innerWidth, vh: innerHeight, card: q('[data-testid=card-0]'), slot: q('[data-testid=slot-0]'), hp: q('[data-testid=player-hp]'), scrollH: document.documentElement.scrollHeight, overflow: getComputedStyle(document.querySelector('[data-testid=game]')).overflow };
  }));
  await p1.screenshot({ path: __dirname + '/evidence/ui-iPhone_13_landscape-battle.png' });
  // also a slightly taller landscape (iPhone 14 Pro Max)
  const c3 = await b.newContext({ ...devices['iPhone 14 Pro Max landscape'], serviceWorkers: 'block' });
  const p3 = await c3.newPage();
  await p3.goto(L.BASE); await p3.waitForSelector('[data-testid=game][data-stage=idle]');
  console.log('14PM landscape', await p3.evaluate(() => { const r = document.querySelector('[data-testid=card-0]').getBoundingClientRect(); return { vw: innerWidth, vh: innerHeight, cardBottom: Math.round(r.bottom) }; }));
  await p3.screenshot({ path: __dirname + '/evidence/ui-iPhone_14_Pro_Max_landscape-battle.png' });
  // 2. desktop mouse drag with gradual moves
  const c2 = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const p2 = await c2.newPage();
  await p2.goto(L.BASE); await p2.waitForSelector('[data-testid=game][data-stage=idle]');
  const bb = async (s) => { const r = await p2.locator(s).boundingBox(); return [r.x + r.width / 2, r.y + r.height / 2]; };
  const [fx, fy] = await bb('[data-testid=card-0]'); const [tx, ty] = await bb('[data-testid=slot-2]');
  await p2.mouse.move(fx, fy); await p2.mouse.down(); await p2.mouse.move(tx, ty, { steps: 12 }); await p2.mouse.up();
  await p2.waitForTimeout(1500);
  console.log('mouse drag (12 steps) turn', (await L.save(p2)).turn, 'board', JSON.stringify((await L.save(p2)).board));
  await b.close();
})();

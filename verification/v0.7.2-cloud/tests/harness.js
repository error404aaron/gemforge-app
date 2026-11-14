// Minimal recorded test harness: each test is independent; results persist as JSON per batch.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
module.exports = async function run(batch, tests) {
  const results = [];
  const commit = execSync('git -C /home/user/gemforge-app rev-parse HEAD').toString().trim();
  const only = process.env.ONLY;
  for (const [name, fn] of tests) {
    if (only && !name.includes(only)) continue;
    const t0 = Date.now();
    const notes = [];
    try {
      await fn((m) => notes.push(m));
      results.push({ name, status: 'PASS', ms: Date.now() - t0, notes });
      console.log('PASS', name, notes.join(' | '));
    } catch (e) {
      results.push({ name, status: 'FAIL', ms: Date.now() - t0, notes, error: String(e && e.stack || e).slice(0, 1500) });
      console.log('FAIL', name, notes.join(' | '), '\n  ', String(e && e.message || e).slice(0, 600));
    }
  }
  const out = {
    batch, appRepoCommit: commit, servedBuild: 'see test names', at: new Date().toISOString(),
    browser: require('playwright').chromium.name() + ' (playwright ' + require('playwright/package.json').version + ')',
    passed: results.filter((r) => r.status === 'PASS').length, total: results.length, results,
  };
  fs.writeFileSync(path.join(__dirname, 'evidence', `results-${batch}.json`), JSON.stringify(out, null, 2));
  console.log(`${batch}: ${out.passed}/${out.total} PASS`);
};
module.exports.assert = (c, m) => { if (!c) throw new Error('assert: ' + m); };
module.exports.eq = (a, b, m) => {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error(`assert eq: ${m}: ${A.slice(0, 300)} !== ${B.slice(0, 300)}`);
};

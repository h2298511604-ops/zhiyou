/* 离线重判：用已保存的结果重新跑检查器，不调模型
   前提：结果里存了 jdText 和 gaps（v9 之后的新结果） */
const fs = require('fs');
const path = require('path');
const checks = require('./lib/synthchecks');

const dir = path.join(__dirname, 'out');
const files = fs.readdirSync(dir).filter(f => /^synth-.*\.json$/.test(f)).sort();
const f = files[files.length - 1];
const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

const stat = {};
let missingJd = 0;

for (const r of d.results) {
  if (!r || r.error) continue;
  if (!r.jdText) { missingJd++; continue; }

  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'seeds', r.case.major + '.json'), 'utf8'));
  const fb = seed.tiers[r.case.quality];
  const alive = new Set(), exps = new Set();
  (fb.experiences || []).forEach((e) => {
    exps.add(e.id);
    (e.bullets || []).forEach(b => alive.add(b.id));
  });

  const proj = {
    verdict: r.verdict,
    greeting: { text: r.greeting },
    gaps: r.gapsList || [],
    hits: [],
    highlights: []
  };
  const judged = checks.runAll({ case: r.case, proj, jdText: r.jdText, aliveIds: alive, expIds: exps });

  for (const c of judged.checks) {
    if (!stat[c.id]) stat[c.id] = { t: 0, fail: 0 };
    stat[c.id].t++;
    if (!c.pass) stat[c.id].fail++;
  }
}

console.log('离线重判：' + f + '（' + d.results.length + ' 条）');
if (missingJd) console.log('⚠ ' + missingJd + ' 条没有 jdText，已跳过');
console.log('');
Object.keys(stat).sort((a, b) => stat[b].fail - stat[a].fail).forEach((k) => {
  const s = stat[k];
  console.log('  ' + k.padEnd(16) + String(s.fail).padStart(4) + '/' + String(s.t).padEnd(4) +
    '  (' + Math.round(s.fail * 100 / s.t) + '%)');
});

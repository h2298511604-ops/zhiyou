/* 基线失败案例抽样：按检查项各抽几条，人工判断是工具的错还是测试的错 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'out');
const files = fs.readdirSync(OUT).filter(f => /^synth-.*\.json$/.test(f)).sort();
const f = files[files.length - 1];
const d = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));

const byCheck = {};
for (const r of d.results) {
  if (!r || r.error) continue;
  for (const c of r.judged.checks) {
    if (c.pass) continue;
    (byCheck[c.id] = byCheck[c.id] || []).push({ r, c });
  }
}

const only = process.argv.slice(2);
const checks = only.length ? only : Object.keys(byCheck);

for (const id of checks) {
  const list = byCheck[id] || [];
  console.log('\n' + '='.repeat(70));
  console.log('【' + id + '】 共 ' + list.length + ' 条，抽 3 条');
  console.log('='.repeat(70));
  list.slice(0, 3).forEach(({ r, c }) => {
    console.log('');
    console.log('  专业 ' + r.case.major + ' / ' + r.case.quality + ' / ' + r.case.fit);
    console.log('  JD   ' + r.jd.job.slice(0, 50) + ' @ ' + r.jd.company.slice(0, 20));
    console.log('  判定 ' + r.verdict.score + ' / ' + r.verdict.level +
      '   事实库 ' + r.fact.bullets + ' 条 bullet, ' + r.fact.personas + ' 个身份');
    console.log('  问题 ' + c.detail);
    console.log('  话术 ' + r.greeting.slice(0, 120));
    if (id === 'no_crash' || id === 'no_ghost_bullet') {
      const ids = (r.greeting || '').length ? '' : '';
      console.log('  (原始 greeting 字段可能在 proj 里缺失)');
    }
  });
}

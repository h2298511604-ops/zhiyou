#!/usr/bin/env node
/* ============================================================
   两个不需要 API Key 的检查

   1) 验证面板导出的事实库是否完整、引用是否有断链
      —— 数据错了，后面所有评测都是垃圾
   2) 用 Skill 里的真实话术算"人类基准线"
      —— 你自己的 4 条有多分散，就是模型该达到的下限

   用法：node eval/inspect.js --fact factbase-2026-11-19.json
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { loadPlugin } = require('./lib/load');
const metrics = require('./lib/metrics');
const T = require('./lib/text');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const FACT = path.resolve(ROOT, arg('fact', 'factbase.json'));
const line = (s) => console.log(s == null ? '' : s);

/* ---------------- 1. 事实库体检 ---------------- */
function inspectFactBase() {
  line('='.repeat(58));
  line('① 事实库体检：' + path.basename(FACT));
  line('='.repeat(58));

  if (!fs.existsSync(FACT)) {
    line('✗ 文件不存在：' + FACT);
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(FACT, 'utf8'));
  const fb = raw.factBase || raw;

  if (raw.exportedAt) line('导出时间：' + raw.exportedAt + '   面板版本：' + (raw.appVersion || '?'));
  line('');

  const persona = fb.personas || [];
  const exps = fb.experiences || [];

  /* 收集所有 bullet */
  const bullets = [];
  exps.forEach(e => (e.bullets || []).forEach(b => bullets.push(b)));
  const ids = new Set(bullets.map(b => b.id));

  line('规模');
  line('  身份       ' + persona.length + ' 个');
  line('  经历       ' + exps.length + ' 段');
  line('  bullet     ' + bullets.length + ' 条');
  line('  技能标签   ' + (fb.skills || []).length + ' 个');
  line('  教育       ' + (fb.education || []).length + ' 条');
  line('');

  const major = ((fb.education || [])[0] || {}).major || '';
  line('专业：' + (major || '（空 —— 专业开场的校验会失效）'));
  line('');

  /* 身份结构 */
  line('身份结构');
  let broken = 0;
  persona.forEach((p) => {
    const refs = p.bulletIds || [];
    const missing = refs.filter(id => !ids.has(id));
    broken += missing.length;
    line('  · ' + (p.name || '(无名)').padEnd(22) +
      ' 星级 ' + (p.strength || '?') +
      ' 引用 ' + refs.length + ' 条' +
      (missing.length ? '  ✗ 断链 ' + missing.join(',') : ''));
    if ((p.jobs || []).length) line('      可投：' + p.jobs.join('、'));
    if ((p.focus || []).length) line('      叙事：' + p.focus.join('、'));
  });
  line('');

  /* 体检结论 */
  const problems = [];
  if (!persona.length) problems.push('没有 personas —— 评测根本无法做身份匹配');
  if (broken) problems.push(broken + ' 处 bulletId 断链，缺口/亮点会引用到不存在的证据');
  if (!major) problems.push('education 里没有 major —— 专业开场校验失效');
  if (bullets.length < 5) problems.push('bullet 只有 ' + bullets.length + ' 条，样本太薄，评测结论没有代表性');

  const noSkill = bullets.filter(b => !(b.skills || []).length).length;
  if (noSkill > bullets.length * 0.4) {
    problems.push(noSkill + '/' + bullets.length + ' 条 bullet 没有 skills 标签，身份匹配会变钝');
  }

  line('体检结论');
  if (!problems.length) line('  ✓ 结构完整，可以进入评测');
  else problems.forEach(p => line('  ✗ ' + p));

  return { fb, major, problems };
}

/* ---------------- 2. 人类基准线 ---------------- */
function humanBaseline(plugin) {
  line('');
  line('='.repeat(58));
  line('② 人类基准线：用你真实的 ' + plugin.meta.exampleCount + ' 条话术算');
  line('='.repeat(58));

  const examples = (plugin.skill && plugin.skill.examples) || [];
  if (!examples.length) {
    line('Skill 里没有 examples，无法计算');
    return;
  }

  const samples = examples.map(t => ({ greeting: { text: t } }));
  const m = metrics.scoreSet(samples);

  examples.forEach((t, i) => {
    line('  ' + (i + 1) + '. [' + T.len(t) + ' 字] ' + t);
  });
  line('');

  line('开头 ' + metrics.OPENING_N + ' 字分布：');
  m.opening.ranked.forEach(r => line('  ' + (r.word + '              ').slice(0, 14) +
    r.count + ' 条 (' + Math.round(r.count * 100 / m.n) + '%)'));
  line('');
  line('  不同开头        ' + m.opening.distinct + ' / ' + m.n + ' 种');
  line('  开头 top1 占比  ' + Math.round(m.opening.top1 * 100) + '%   （仅供参考：开头重复本身不算错，' +
    'JD 要哪个专业就该用哪个开头）');
  line('  两两相似度均值  ' + Math.round(m.similarity.avg * 100) + '%   （高于 '
    + Math.round(metrics.LIMITS.avgSimilarity * 100) + '% 算换 JD 没换话）');
  line('  条件句收尾率    ' + Math.round(m.conditionTailRate * 100) + '%');
  line('  开头跟着 JD 走  ' + (m.tailoring === null
    ? '算不了（这 4 条没有对应 JD 文本）'
    : Math.round(m.tailoring * 100) + '%'));
  line('');

  line('怎么用这个基准线：');
  line('  · 两两相似度 ' + Math.round(m.similarity.avg * 100) + '% 就是"自然人写"的量级 ——' +
    ' 模型跑到 40% 以上说明在套模板');
  line('  · 开头重复不必强求分散，但必须跟着 JD 变。这条要等真实跑测才算得出来。');
  line('  · 样本只有 ' + m.n + ' 条，熵和对应率都不下结论，只看量级。');
}

/* ---------------- main ---------------- */
const plugin = loadPlugin();
const info = inspectFactBase();
humanBaseline(plugin);

line('');
line('='.repeat(58));
if (!fs.existsSync(path.join(__dirname, '.env.local')) && !process.env.DEEPSEEK_API_KEY) {
  line('下一步：eval/.env.local 里写 DEEPSEEK_API_KEY=sk-xxx，然后');
  line('  node eval/run.js --fact ' + path.basename(FACT) + ' --limit 20');
} else {
  line('Key 就位，可以跑：node eval/run.js --fact ' + path.basename(FACT) + ' --limit 20');
}

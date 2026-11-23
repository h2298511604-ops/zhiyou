/* ============================================================
   种子审计：跑评测之前，先确认夹具本身没问题

   因为「工具失败」和「夹具写错」在结果里长得一样，
   不先审一遍，跑出来分不清是谁的错。

   查这些：
     · 非 IT 专业的种子有没有混进技术词（有的话夹具错了，不是工具的错）
     · 四档 bullet 数量是否单调递减
     · persona 的 bulletIds 是否都能对上
     · 是否有空经历、空身份
     · 专业名是否与目录一致

   用法：node eval/audit-seeds.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const SEEDS = path.join(__dirname, 'fixtures', 'seeds');
const MAJORS = path.join(__dirname, 'fixtures', 'majors.json');

const TECH = ['Docker', 'Function Calling', 'LangChain', 'LangGraph', 'RAG', 'FastAPI', 'pytest',
  'Kubernetes', 'K8s', '微服务', 'Redis', 'MySQL', 'Kafka', 'React', 'Vue', 'Java', 'Golang'];

function main() {
  const dir = JSON.parse(fs.readFileSync(MAJORS, 'utf8'));
  const meta = new Map();
  dir.majorGroups.forEach(g => g.majors.forEach(m => meta.set(m.major, Object.assign({ discipline: g.discipline }, m))));

  const files = fs.readdirSync(SEEDS).filter(f => f.endsWith('.json'));
  const problems = [];
  const warn = [];
  let checked = 0;

  for (const f of files) {
    const major = f.replace(/\.json$/, '');
    const m = meta.get(major);
    if (!m) { problems.push(major + '：不在专业目录里'); continue; }

    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(SEEDS, f), 'utf8')); }
    catch (e) { problems.push(major + '：JSON 解析失败 ' + e.message); continue; }

    checked++;
    const seed = d.seed || {};
    const tiers = d.tiers || {};

    /* ① 非 IT 专业混进技术词 */
    if (!m.itAdjacent) {
      const text = JSON.stringify(seed);
      const leaked = TECH.filter(t => text.indexOf(t) >= 0);
      if (leaked.length) problems.push(major + '（非 IT）：种子混进技术词 ' + leaked.join('、'));
    }

    /* ② 四档单调递减 */
    const counts = ['rich', 'normal', 'thin', 'minimal'].map(q => (tiers[q] && tiers[q].meta && tiers[q].meta.__bulletCount) || 0);
    for (let i = 1; i < counts.length; i++) {
      if (counts[i] > counts[i - 1]) {
        problems.push(major + '：bullet 档位不单调 ' + counts.join(' > '));
        break;
      }
    }
    if (counts[3] !== 1) warn.push(major + '：minimal 档 ' + counts[3] + ' 条（期望 1）');

    /* ③ persona 引用 */
    const alive = new Set();
    (seed.experiences || []).forEach(e => (e.bullets || []).forEach(b => alive.add(b.id)));
    (seed.personas || []).forEach((p, i) => {
      const bad = (p.bulletIds || []).filter(id => !alive.has(id));
      if (bad.length) problems.push(major + '：persona' + (i + 1) + ' 引用了不存在的 ' + bad.join(','));
    });

    /* ④ 空经历 / 空身份 */
    if (!(seed.experiences || []).length) problems.push(major + '：没有经历');
    if (!(seed.personas || []).length) problems.push(major + '：没有身份');
    (seed.experiences || []).forEach((e, i) => {
      if (!(e.bullets || []).length) problems.push(major + '：第 ' + (i + 1) + ' 段经历没有 bullet');
    });

    /* ⑤ 裁剪后身份还在吗（极简档可能被裁空，属于预期，只提示） */
    if (tiers.minimal && !(tiers.minimal.personas || []).length) {
      warn.push(major + '：minimal 档裁剪后没有身份了');
    }

    /* ⑥ 有没有数字（rich 档应该带量化） */
    const richText = JSON.stringify(tiers.rich || {});
    if (!/[0-9]/.test(richText)) warn.push(major + '：rich 档完全没有数字');
  }

  const byDiscipline = {};
  files.forEach((f) => {
    const m = meta.get(f.replace(/\.json$/, ''));
    if (!m) return;
    byDiscipline[m.discipline] = (byDiscipline[m.discipline] || 0) + 1;
  });

  console.log('种子审计');
  console.log('='.repeat(56));
  console.log('已生成 ' + files.length + ' 个种子，审计 ' + checked + ' 个');
  console.log('');
  console.log('门类覆盖：');
  Object.entries(byDiscipline).sort().forEach(([k, v]) => console.log('  ' + k.padEnd(12, '　') + v));
  console.log('');

  if (problems.length) {
    console.log('✗ 硬问题 ' + problems.length + ' 处：');
    problems.slice(0, 30).forEach(p => console.log('  ' + p));
    if (problems.length > 30) console.log('  …还有 ' + (problems.length - 30) + ' 处');
  } else {
    console.log('✓ 无硬问题');
  }
  console.log('');

  if (warn.length) {
    console.log('⚠ 提示 ' + warn.length + ' 条：');
    warn.slice(0, 15).forEach(p => console.log('  ' + p));
    if (warn.length > 15) console.log('  …还有 ' + (warn.length - 15) + ' 条');
  }

  process.exit(problems.length ? 1 : 0);
}

main();

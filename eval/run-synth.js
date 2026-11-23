/* ============================================================
   合成求职者批量测试

   101 专业 × 4 质量档 = 404 条用例，每条配一条真实 JD：
     fit=matched   → 从索引里取该专业的对口岗
     fit=unrelated → 取一条别的行业的岗

   走的是插件同一套 prompt（PROMPTS.pickPersona / project），
   判定全部走确定性检查，不调模型当裁判。

   用法：
     node eval/run-synth.js --limit 20              先跑 20 条看看
     node eval/run-synth.js --limit 0               全量 404 条
     node eval/run-synth.js --only 会计学,临床医学    只跑指定专业
     node eval/run-synth.js --quality thin          只跑某个质量档

   产出：eval/out/synth-<时间>.{txt,json,csv}
   ============================================================ */

const fs = require('fs');
const path = require('path');

const { loadPlugin } = require('./lib/load');
const { chat, extractJson } = require('./lib/llm');
const { buildMatrix } = require('./variants');
const checks = require('./lib/synthchecks');

const ROOT = path.resolve(__dirname, '..');
const SEEDS = path.join(__dirname, 'fixtures', 'seeds');          /* 应届 */
const SEEDS_WORK = path.join(__dirname, 'fixtures', 'seeds-work'); /* 有 2–3 年经验 */
const INDEX = path.join(__dirname, 'out', 'jd-index.json');
const OUT = path.join(__dirname, 'out');

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const flag = (n) => argv.indexOf('--' + n) >= 0;

const LIMIT = parseInt(arg('limit', '20'), 10);
const MODEL = arg('model', 'deepseek-chat');
const CONCURRENCY = Math.max(1, parseInt(arg('concurrency', '4'), 10));
const ONLY = (arg('only', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const QUALITY = arg('quality', '');
const SPLIT = arg('split', 'tune');      /* tune / holdout / all */

const HOLDOUT_FILE = path.join(__dirname, 'fixtures', 'holdout.json');
const HOLDOUT = fs.existsSync(HOLDOUT_FILE)
  ? new Set(JSON.parse(fs.readFileSync(HOLDOUT_FILE, 'utf8')).majors)
  : new Set();

/* ---------- JD 选择 ---------- */

/* JD 要求的年限（存成数字，用来验证「经验匹配是否加分」） */
function parseJdYears(exp) {
  const s = String(exp || '');
  if (/不限|无经验|在校|应届/.test(s)) return 0;
  const m = s.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function jdTextOf(j) {
  return [j.company, j.job, j.city, j.edu, j.exp, j.salary].filter(Boolean).join(' · ') + '\n' + j.jd;
}

function pickJd(c, index, rotation) {
  if (c.fit === 'unrelated') {
    const pool = index.unrelated || [];
    if (!pool.length) return null;
    return pool[rotation % pool.length];
  }
  const pool = (index.perMajor || {})[c.major] || [];
  if (!pool.length) return null;
  return pool[rotation % pool.length];
}

/* ---------- 单条 ---------- */

async function runOne(c, index, plugin, personaCache) {
  /* 用哪套种子：work 档用有经验的版本；没生成就退回应届版 */
  const useWork = c.exp === 'work' && fs.existsSync(SEEDS_WORK);
  const seedFile = path.join(useWork ? SEEDS_WORK : SEEDS, c.major + '.json');
  if (!fs.existsSync(seedFile)) return { case: c, error: '没有种子：' + c.major + (useWork ? '（work 版）' : '') };
  const seedData = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
  const fb = seedData.tiers && seedData.tiers[c.quality];
  if (!fb) return { case: c, error: '没有 ' + c.quality + ' 档' };

  const rotation = Math.abs(hashStr(c.major)) % 3;
  const jd = pickJd(c, index, rotation);
  if (!jd) return { case: c, error: '召不到 ' + (c.fit === 'matched' ? '对口' : '无关') + ' JD' };
  const jdText = jdTextOf(jd);

  const aliveIds = new Set();
  const expIds = new Set();
  (fb.experiences || []).forEach((e) => {
    expIds.add(e.id);
    (e.bullets || []).forEach(b => aliveIds.add(b.id));
  });

  /* 身份：没有就跳过（极简档可能被裁空） */
  const personas = fb.personas || [];
  if (!personas.length) return { case: c, error: '裁剪后没有身份，无法投影', fb, jd };

  let persona = personas[0];
  try {
    const pk = await chat(plugin.PROMPTS.pickPersona(jdText, personas),
      { model: MODEL, jsonMode: true, maxTokens: 80, temperature: 0 });
    const pid = ((extractJson(pk.content).data) || {}).id;
    persona = personas.find(p => p.id === pid) || personas[0];
  } catch (e) { /* 选身份失败就用第一个 */ }

  const res = await chat(plugin.PROMPTS.project({
    factBase: fb, persona, jdText, packLevel: 'standard'
  }), { model: MODEL, jsonMode: true, maxTokens: 8000, temperature: 0.2, thinking: 'disabled' });

  let parsed = extractJson(res.content);

  /* 截断重试：产品里 chatJson 也有这一步，runner 之前漏了。
     换更大的 token 上限，并要求它收敛篇幅。 */
  if (!parsed.data && parsed.truncated) {
    const msgs = plugin.PROMPTS.project({ factBase: fb, persona, jdText, packLevel: 'standard' });
    msgs.push({
      role: 'user',
      content: '上一次输出被截断了。重新输出完整 JSON，risks 和 interviewPrep 各只保留 3 条，其余字段不要展开。'
    });
    const retry = await chat(msgs, { model: MODEL, jsonMode: true, maxTokens: 12000, temperature: 0.2, thinking: 'disabled' });
    parsed = extractJson(retry.content);
  }

  if (!parsed.data) throw new Error(parsed.truncated ? '输出被截断（重试后仍失败）' : 'JSON 解析失败');

  const proj = parsed.data;
  const judged = checks.runAll({
    case: c, proj, jdText, aliveIds, expIds, factText: JSON.stringify(fb)
  });

  return {
    case: c,
    persona: { id: persona.id, name: persona.name },
    jd: { job: jd.job, company: jd.company, kw: jd.kw || '' },
    jdText: jdText,          /* 存下来，方便日后不调模型重判 */
    jdExp: parseJdYears(jd.exp),
    fact: { bullets: aliveIds.size, personas: personas.length },
    verdict: proj.verdict || {},
    fitScore: (proj.verdict || {}).fitScore,
    densityScore: (proj.verdict || {}).densityScore,
    years: (fb.meta && fb.meta.years) || 0,
    greeting: (proj.greeting || {}).text || '',
    gaps: (proj.gaps || []).length,
    gapsList: proj.gaps || [],       /* 存全量，方便离线重判 */
    judged
  };
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/* ---------- 主流程 ---------- */

async function main() {
  if (!fs.existsSync(INDEX)) {
    console.error('还没有 JD 索引，先跑：node eval/lib/jdindex.js');
    process.exit(1);
  }
  const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const plugin = loadPlugin();
  const { cases } = buildMatrix();

  let todo = cases;
  if (ONLY.length) todo = todo.filter(c => ONLY.indexOf(c.major) >= 0);
  if (QUALITY) todo = todo.filter(c => c.quality === QUALITY);

  /* 切分：默认只用非 holdout 的专业调参，holdout 只在最后验证一次 */
  if (!ONLY.length && SPLIT !== 'all') {
    if (SPLIT === 'holdout') {
      todo = todo.filter(c => HOLDOUT.has(c.major));
    } else {
      todo = todo.filter(c => !HOLDOUT.has(c.major));
    }
  }

  if (LIMIT > 0) todo = todo.slice(0, LIMIT);

  fs.mkdirSync(OUT, { recursive: true });
  console.log('合成求职者测试');
  console.log('  切分       ' + SPLIT + (HOLDOUT.size ? '（留出集 ' + HOLDOUT.size + ' 个专业）' : ''));
  console.log('  用例       ' + todo.length + ' 条（专业 ' + new Set(todo.map(c => c.major)).size + ' 个）');
  console.log('  评测模型   ' + MODEL + '（插件用同一个）');
  console.log('  JD 索引    建于 ' + index.builtAt + '，覆盖 ' + index.majorsWithJd + ' 个专业');
  console.log('');

  const results = new Array(todo.length);
  let done = 0;

  let cursor = 0;
  const workers = Math.min(CONCURRENCY, todo.length);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= todo.length) break;
      const c = todo[idx];
      try {
        results[idx] = await runOne(c, index, plugin, {});
        const r = results[idx];
        done++;
        if (r.error) {
          console.log('  ✗ ' + (done) + ' ' + c.major + '/' + c.quality + ' — ' + r.error);
        } else {
          console.log('  ✓ ' + (done) + ' ' + c.major.padEnd(10, '　') + c.quality.padEnd(7) +
            ' ' + String(r.judged.passed) + '/' + r.judged.total +
            (r.judged.failed.length ? '  失败:' + r.judged.failed.join(',') : ''));
        }
      } catch (e) {
        results[idx] = { case: c, error: e.message };
        done++;
        console.log('  ✗ ' + done + ' ' + c.major + '/' + c.quality + ' — ' + e.message);
      }
    }
  }));

  /* ---------- 汇总 ---------- */
  const ok = results.filter(r => r && !r.error);
  const L = [];
  const w = (s) => L.push(s == null ? '' : s);

  const checkStats = {};
  ok.forEach((r) => r.judged.checks.forEach((c) => {
    if (!checkStats[c.id]) checkStats[c.id] = { total: 0, fail: 0 };
    checkStats[c.id].total++;
    if (!c.pass) checkStats[c.id].fail++;
  }));

  const slice = (key) => {
    const m = {};
    ok.forEach((r) => {
      const k = key(r);
      if (!m[k]) m[k] = { n: 0, fail: 0 };
      m[k].n++;
      if (r.judged.failed.length) m[k].fail++;
    });
    return m;
  };

  w('合成求职者测试报告');
  w('='.repeat(56));
  w('用例 ' + todo.length + ' 条，成功 ' + ok.length + '，失败 ' + (todo.length - ok.length));
  w('模型 ' + MODEL);
  w('');
  w('=== 各检查项失败率 ===');
  Object.keys(checkStats).sort((a, b) => checkStats[b].fail - checkStats[a].fail).forEach((id) => {
    const s = checkStats[id];
    const pct = s.total ? Math.round(s.fail * 100 / s.total) : 0;
    w('  ' + id.padEnd(16) + s.fail + '/' + s.total + '  (' + pct + '%)');
  });
  w('');
  w('=== 按学科门类切 ===');
  Object.entries(slice(r => r.case.discipline)).sort((a, b) => b[1].fail - a[1].fail).forEach(([k, v]) => {
    w('  ' + k.padEnd(12, '　') + v.fail + '/' + v.n + ' 条有问题');
  });
  w('');
  w('=== 按简历质量档切 ===');
  Object.entries(slice(r => r.case.quality)).forEach(([k, v]) => {
    w('  ' + k.padEnd(10) + v.fail + '/' + v.n + ' 条有问题');
  });
  w('');
  w('=== 按对口度切 ===');
  Object.entries(slice(r => r.case.fit)).forEach(([k, v]) => {
    w('  ' + k.padEnd(12) + v.fail + '/' + v.n + ' 条有问题');
  });

  /* ---- 集合级：评分有没有区分度 ----
     逐条判断「对口」不可靠，但聚合起来看方向是可靠的：
     对口岗的平均分应该明显高于无关岗；
     简历越厚（rich）分数应该越高。两个方向反了，就说明判定没在工作。 */
  const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
  const byFit = { matched: [], unrelated: [] };
  const byQuality = { rich: [], normal: [], thin: [], minimal: [] };
  const levelByFit = { matched: {}, unrelated: {} };
  ok.forEach((r) => {
    const s = r.verdict && r.verdict.score;
    if (typeof s === 'number') {
      if (byFit[r.case.fit]) byFit[r.case.fit].push(s);
      if (byQuality[r.case.quality]) byQuality[r.case.quality].push(s);
    }
    const lv = (r.verdict && r.verdict.level) || '?';
    if (levelByFit[r.case.fit]) levelByFit[r.case.fit][lv] = (levelByFit[r.case.fit][lv] || 0) + 1;
  });

  /* ---- 集合级：两个分量各自有没有在起作用 ---- */
  const avgOf = (arr) => {
    const v = arr.filter(x => typeof x === 'number');
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  w('');
  w('=== 评分分量（fitScore=岗位命中 / densityScore=材料颗粒度）===');
  ['rich', 'normal', 'thin', 'minimal'].forEach((q) => {
    const set = ok.filter(r => r.case.quality === q);
    w('  ' + q.padEnd(9) +
      ' fit ' + String(avgOf(set.map(r => r.fitScore))).padStart(4) +
      '   density ' + String(avgOf(set.map(r => r.densityScore))).padStart(4) +
      '   score ' + String(avgOf(set.map(r => r.verdict && r.verdict.score))).padStart(4));
  });
  w('');
  w('  按经验（years）分组：');
  const yearKeys = Array.from(new Set(ok.map(r => String(r.years)))).sort();
  yearKeys.forEach((y) => {
    const set = ok.filter(r => String(r.years) === y);
    w('    ' + (y + ' 年').padEnd(8) + ' n=' + String(set.length).padEnd(4) +
      ' fit ' + String(avgOf(set.map(r => r.fitScore))).padStart(4) +
      ' density ' + String(avgOf(set.map(r => r.densityScore))).padStart(4) +
      ' score ' + String(avgOf(set.map(r => r.verdict && r.verdict.score))).padStart(4));
  });

  w('');
  w('  经验匹配（候选人年限 vs JD 要求年限）：');
  const both = ok.filter(r => r.jdExp != null && typeof r.years === 'number');
  const enough = both.filter(r => r.years >= r.jdExp);
  const short_ = both.filter(r => r.years < r.jdExp);
  const showG = (label, set) => {
    w('    ' + label.padEnd(16) + 'n=' + String(set.length).padEnd(4) +
      ' fit ' + String(avgOf(set.map(r => r.fitScore))).padStart(4) +
      ' score ' + String(avgOf(set.map(r => r.verdict && r.verdict.score))).padStart(4));
  };
  showG('年限达标', enough);
  showG('年限不足', short_);
  const eF = avgOf(enough.map(r => r.fitScore)), sF = avgOf(short_.map(r => r.fitScore));
  if (eF != null && sF != null) {
    w('    差 ' + (eF - sF) + ' 分   ' +
      (eF - sF >= 8 ? '✓ 年限确实影响判定' : eF > sF ? '△ 有影响但偏弱' : '✗ 年限没起作用'));
  }

  w('');
  w('=== 评分区分度（集合级，这才是判得准不准的关键）===');
  const mAvg = avg(byFit.matched), uAvg = avg(byFit.unrelated);
  w('  对口岗均分   ' + mAvg + '  (n=' + byFit.matched.length + ')');
  w('  无关岗均分   ' + uAvg + '  (n=' + byFit.unrelated.length + ')');
  const gap = (mAvg != null && uAvg != null) ? mAvg - uAvg : null;
  w('  分差         ' + (gap == null ? '-' : (gap > 0 ? '+' : '') + gap) + '   ' +
    (gap == null ? '' : gap >= 10 ? '✓ 有明显区分' : gap > 0 ? '△ 区分偏弱（<10）' : '✗ 方向反了：无关岗反而更高'));
  w('');
  w('  按简历质量档（应该递减）：');
  ['rich', 'normal', 'thin', 'minimal'].forEach((q) => {
    w('    ' + q.padEnd(9) + avg(byQuality[q]) + '  (n=' + byQuality[q].length + ')');
  });
  w('');
  w('  判定分布：');
  w('    对口岗  ' + JSON.stringify(levelByFit.matched));
  w('    无关岗  ' + JSON.stringify(levelByFit.unrelated));

  const text = L.join('\n');
  console.log('\n' + text);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  fs.writeFileSync(path.join(OUT, 'synth-' + stamp + '.txt'), text, 'utf8');
  fs.writeFileSync(path.join(OUT, 'synth-' + stamp + '.json'),
    JSON.stringify({ model: MODEL, jdIndex: index.builtAt, checkStats, results }, null, 1), 'utf8');

  const cols = ['major', 'discipline', 'quality', 'exp', 'fit', 'passed', 'total', 'failed', 'score', 'level', 'job', 'greeting'];
  const csv = [cols.join(',')].concat(results.map((r) => {
    if (!r || r.error) return cols.map((c) => '"' + (c === 'major' && r ? r.case.major : '') + '"').join(',');
    return [r.case.major, r.case.discipline, r.case.quality, r.case.exp, r.case.fit,
      r.judged.passed, r.judged.total, r.judged.failed.join('|'),
      r.verdict.score, r.verdict.level, r.jd.job, r.greeting]
      .map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"').join(',');
  })).join('\n');
  fs.writeFileSync(path.join(OUT, 'synth-' + stamp + '.csv'), '\ufeff' + csv, 'utf8');

  console.log('\n写入 eval/out/synth-' + stamp + '.*');
}

main().catch(e => { console.error(e.message || e); process.exit(1); });

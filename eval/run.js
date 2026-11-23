/* ============================================================
   评测主程序

   用法：
     node eval/run.js --fact factbase-2026-11-19.json --limit 20
     node eval/run.js --fact ... --limit 20 --split holdout   # 留出集
     node eval/run.js --fact ... --limit 20 --dry             # 只跑 JD 过滤，不调模型

   产出：
     eval/out/summary-<时间>.txt   人读的结论
     eval/out/report-<时间>.json   全部原始数据
     eval/out/samples-<时间>.csv   Excel 可开
   ============================================================ */

const fs = require('fs');
const path = require('path');

const { loadPlugin } = require('./lib/load');
const { chat, extractJson } = require('./lib/llm');
const checks = require('./lib/checks');
const metrics = require('./lib/metrics');
const T = require('./lib/text');

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const flag = (n) => argv.indexOf('--' + n) >= 0;

const ROOT = path.resolve(__dirname, '..');
const FACT = path.resolve(ROOT, arg('fact', 'factbase.json'));
const JDS = path.resolve(ROOT, arg('jds', 'dev/jd.jsonl'));
const LIMIT = parseInt(arg('limit', '20'), 10);
const MODEL = arg('model', 'deepseek-chat');
const SPLIT = arg('split', 'tune');      /* tune / holdout / all（all = 整个筛选后的池子，不抽样） */
const CONCURRENCY = Math.max(1, parseInt(arg('concurrency', '3'), 10));
const DRY = flag('dry');
const OUTDIR = path.join(__dirname, 'out');

/* ---------- JD 质量门槛（已验证） ---------- */
function jdBody(r) { return (r.responsibilities || []).join('\n') + '\n' + (r.requirements || []).join('\n'); }
function cnRatio(s) { return (s.match(/[\u4e00-\u9fa5]/g) || []).length / Math.max(1, s.length); }
function keepJd(r) {
  return (r.requirements || []).length >= 3 && (r.responsibilities || []).length >= 2
    && jdBody(r).length >= 200 && cnRatio(jdBody(r)) >= 0.3 && r.completeness === 'full';
}
function jdTextOf(r) {
  return [r.company, r.title, r.location].filter(Boolean).join(' · ') + '\n' +
    '【岗位职责】\n' + (r.responsibilities || []).map((x, i) => (i + 1) + '. ' + x).join('\n') +
    '\n【任职要求】\n' + (r.requirements || []).map((x, i) => (i + 1) + '. ' + x).join('\n');
}

/* ---------- 身份相关的 bullet 裁剪 ----------
   这一段镜像插件 app.js 的 compactFactBase()。
   分开的项目只能各写各的，改了插件记得同步这里（README 有提醒）。 */
function compactForEval(fb, persona) {
  const keep = new Set(persona.bulletIds || []);
  const experiences = [];
  const coverage = [];
  for (const e of fb.experiences || []) {
    const bullets = (e.bullets || []).filter(b => !keep.size || keep.has(b.id));
    if (bullets.length) {
      experiences.push({
        id: e.id, org: e.org, role: e.role, period: e.period,
        bullets: bullets.map(b => ({ id: b.id, text: b.text, metrics: b.metrics || [] }))
      });
    }
    for (const b of (e.bullets || [])) {
      coverage.push({ id: b.id, s: (b.skills || []).slice(0, 6), t: String(b.text || '').slice(0, 48) });
    }
  }
  return {
    meta: fb.meta,
    skills: (fb.skills || []).slice(0, 15),
    education: fb.education || [],
    experiences: experiences.length ? experiences : (fb.experiences || []),
    coverage: coverage
  };
}

function majorForms(fb) {
  const out = [];
  ((fb && fb.education) || []).forEach((e) => {
    const m = String((e && e.major) || '').trim();
    if (!m) return;
    out.push(m);
    const short = m.replace(/(工程|技术|科学|管理|学|专业)+$/, '');
    if (short && short !== m && short.length >= 2) out.push(short);
    if (m.length > 2) out.push(m.slice(0, 2));
  });
  return Array.from(new Set(out));
}

/* ---------- 采样：必须打散 ----------
   数据集是按公司排好序的（前 200 条几乎全是字节），
   直接 slice(0,N) 会抽出一个"全是同一家公司"的样本，
   任何指标都会失真。这里按公司轮转交错，保证小样本也覆盖多家。 */
function diversify(pool) {
  const byCompany = new Map();
  for (const r of pool) {
    const k = r.company || '(未知)';
    if (!byCompany.has(k)) byCompany.set(k, []);
    byCompany.get(k).push(r);
  }
  const lists = Array.from(byCompany.values());
  const out = [];
  const maxLen = lists.reduce((m, l) => Math.max(m, l.length), 0);
  for (let round = 0; round < maxLen; round++) {
    for (const l of lists) {
      if (round < l.length) out.push(l[round]);
    }
  }
  return out;
}

/* ---------- 方向筛选 ----------
   197 条池子里大部分是 AI Infra / 推理优化 / GPU 运维，跟这四个身份不沾边。
   拿那批 JD 调 Skill，等于拿用户不会投的岗位调参 —— 会把人调歪。

   两条纪律：
   1. 词只从身份的**岗位名**里取（不取 narrative，否则"交付""部署"这类
      泛词会把所有 JD 都放进来）
   2. 只匹配 **标题 + 技能标签**，不匹配正文（正文里什么词都可能出现）

   不写死任何岗位名，换一个人的事实库照样能用。 */
function personaVocab(fb) {
  const set = new Set();
  const add = (s) => {
    const t = String(s || '')
      .replace(/(工程师|专家|经理|顾问|架构师|实习生|主管|专员)/g, '')
      .trim();
    if (t.length >= 2) set.add(t);
  };
  (fb.personas || []).forEach((p) => {
    add(p.name);
    (p.jobs || []).forEach((j) => {
      add(j);
      String(j).split(/[\/、,，\s（）()]+/).forEach(add);
    });
  });
  return Array.from(set).map(s => T.norm(s)).filter(s => s.length >= 2);
}

function focusFilter(pool, fb) {
  const vocab = personaVocab(fb);
  if (!vocab.length) return { pool: pool, vocab: [] };

  const hays = pool.map(r => T.norm([r.title, (r.skills || []).join(' ')].join(' ')));

  /* IDF：岗位名里会掉出 "AI" "Python" "算法" "研发" 这种词，
     它们几乎每个 JD 都命中，等于没筛。出现率超过 25% 的直接丢掉。 */
  const df = {};
  vocab.forEach((v) => { df[v] = hays.filter(h => h.indexOf(v) >= 0).length; });
  const ceiling = Math.max(3, Math.floor(pool.length * 0.15));
  let keep = vocab.filter(v => df[v] > 0 && df[v] <= ceiling);

  /* 万一筛太狠，退回到"最稀有的 8 个词" */
  if (!keep.length) {
    keep = vocab.slice().sort((a, b) => df[a] - df[b]).slice(0, 8).filter(v => df[v] > 0);
  }

  const out = pool.filter((r, i) => keep.some(v => hays[i].indexOf(v) >= 0));
  return { pool: out, vocab: keep.map(v => v + '(' + df[v] + ')') };
}

/* ---------- 主流程 ---------- */
async function main() {
  const plugin = loadPlugin();
  fs.mkdirSync(OUTDIR, { recursive: true });

  const all = fs.readFileSync(JDS, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
  let pool = diversify(all.filter(keepJd));

  /* 事实库：--focus 和正式评测都要用；只有「纯 dry 且没有 fact 文件」时才不加载 */
  let fb = null;
  if (fs.existsSync(FACT)) {
    const raw = JSON.parse(fs.readFileSync(FACT, 'utf8'));
    fb = raw.factBase || raw;
  }

  const FOCUS = flag('focus');
  if (FOCUS && fb) {
    const before = pool.length;
    const res = focusFilter(pool, fb);
    pool = diversify(res.pool);
    console.log('方向筛选：%d → %d 条', before, pool.length);
    console.log('  判据词：' + res.vocab.join('、') + '\n');
  } else if (FOCUS) {
    console.log('⚠ --focus 需要事实库文件，已跳过筛选\n');
  }

  /* 固定切分：按索引取模，保证可复现（5 条里留 1 条） */
  const tune = pool.filter((_, i) => i % 5 !== 0);
  const holdout = pool.filter((_, i) => i % 5 === 0);
  const src = SPLIT === 'holdout' ? holdout : (SPLIT === 'all' ? pool : tune);
  const picked = LIMIT > 0 ? src.slice(0, LIMIT) : src;

  const companies = new Set(pool.map(r => r.company || '')).size;
  console.log('被测对象：Skill v%s（%d 条示例，上限 %d 字）',
    plugin.meta.skillVersion, plugin.meta.exampleCount, plugin.meta.maxChars);
  console.log('JD 池：全部 %d 条，过质量门槛 %d 条（%d 家公司），本次 %s 集取 %d 条',
    all.length, pool.length, companies, SPLIT, picked.length);

  if (DRY) {
    picked.forEach((r, i) => {
      const idx = String(i + 1).padStart(2, ' ');
      console.log('  ' + idx + '. [' + r.category + '/' + (r.sub_category || '-') + '] ' +
        String(r.title).slice(0, 38) + ' @ ' + r.company +
        '（要求 ' + (r.requirements || []).length + ' 条 / 正文 ' + jdBody(r).length + ' 字）');
    });
    console.log('\n--dry：只验证 JD 筛选，没有调用模型，也不需要 API Key。');
    return;
  }

  if (!fb) throw new Error('找不到事实库文件：' + FACT);
  const personas = fb.personas || [];
  if (!personas.length) throw new Error('事实库里没有 personas');
  const majors = majorForms(fb);

  console.log('事实库：%d 个身份 / %d 段经历 / 专业 %s / 模型 %s\n',
    personas.length, (fb.experiences || []).length, majors.join(' / ') || '(未填)', MODEL);
  const samples = new Array(picked.length);
  let tokens = 0;
  let done = 0;

  /* 并发跑：样本多的时候串行太慢，47 条串行要十几分钟 */
  async function runOne(r, i) {
    const jdText = jdTextOf(r);
    try {
      const pickRes = await chat(plugin.PROMPTS.pickPersona(jdText, personas),
        { model: MODEL, jsonMode: true, maxTokens: 80, temperature: 0 });
      tokens += (pickRes.usage || {}).total_tokens || 0;
      const pid = ((extractJson(pickRes.content).data) || {}).id;
      const persona = personas.find(p => p.id === pid) || personas[0];

      const projRes = await chat(plugin.PROMPTS.project({
        factBase: compactForEval(fb, persona), persona, jdText, packLevel: 'standard'
      }), { model: MODEL, jsonMode: true, maxTokens: 8000, temperature: 0.2, thinking: 'disabled' });
      tokens += (projRes.usage || {}).total_tokens || 0;

      const parsed = extractJson(projRes.content);
      if (!parsed.data) throw new Error(parsed.truncated ? '输出被截断' : 'JSON 解析失败');
      const p = parsed.data;

      const sample = {
        jd: { company: r.company, title: r.title, category: r.category, sub: r.sub_category },
        jdText: jdText,
        persona: { id: persona.id, name: persona.name },
        greeting: p.greeting || {},
        verdict: p.verdict || {},
        gaps: p.gaps || [],
        hits: p.hits || [],
        risks: p.risks || [],
        majors: majors
      };
      sample.l1 = checks.checkSample(sample, {
        examples: (plugin.skill && plugin.skill.examples) || [],
        maxChars: plugin.meta.maxChars
      });
      samples[i] = sample;
      done++;
      console.log('  ✓ [' + done + '/' + picked.length + '] L1=' + sample.l1.score +
        ' 分=' + sample.verdict.score + ' ' + r.title.slice(0, 26));
    } catch (e) {
      samples[i] = { jd: { title: r.title, company: r.company }, error: e.message };
      done++;
      console.log('  ✗ [' + done + '/' + picked.length + '] ' + r.title.slice(0, 26) + ' — ' + e.message);
    }
  }

  /* 简单的并发池 */
  let cursor = 0;
  const workers = Math.min(CONCURRENCY, picked.length);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= picked.length) break;
      await runOne(picked[idx], idx);
    }
  }));
  const samplesClean = samples.filter(Boolean);
  samples.length = 0;
  samplesClean.forEach(s => samples.push(s));

  /* ---------- 汇总 ---------- */
  const ok = samples.filter(s => !s.error);
  const l2 = metrics.scoreSet(ok);
  const alarms = metrics.alarm(l2);

  const l1Avg = ok.length ? Math.round(ok.reduce((s, x) => s + x.l1.score, 0) / ok.length) : 0;
  const failByCheck = {};
  ok.forEach((s) => s.l1.checks.forEach((c) => {
    if (!c.pass) failByCheck[c.id] = (failByCheck[c.id] || 0) + 1;
  }));

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const summary = [];
  const line = (s) => summary.push(s == null ? '' : s);

  line('评测报告 ' + new Date().toLocaleString());
  line('被测对象：Skill v' + plugin.meta.skillVersion + '（示例 ' + plugin.meta.exampleCount + ' 条）');
  line('模型：' + MODEL + '   样本：' + SPLIT + ' 集 ' + ok.length + ' / ' + samples.length + ' 条');
  line('token 消耗：' + tokens);
  line('');
  line('=== L1 硬规则（逐条） ===');
  line('平均得分：' + l1Avg + ' / 100');
  if (Object.keys(failByCheck).length) {
    line('不通过的检查项：');
    Object.keys(failByCheck).sort((a, b) => failByCheck[b] - failByCheck[a])
      .forEach(k => line('  ' + k + '   失败 ' + failByCheck[k] + ' 条'));
  } else {
    line('  全部通过');
  }
  line('');
  line('=== L2 集合级（最能反映模板化） ===');
  line('开头 ' + metrics.OPENING_N + ' 字分布：');
  l2.opening.ranked.forEach(r => line('  ' + (r.word + '            ').slice(0, 12) +
    r.count + ' 条  (' + Math.round(r.count * 100 / l2.n) + '%)'));
  line('  分散度：熵 ' + l2.opening.entropy.toFixed(2) + '，不同开头 ' + l2.opening.distinct + ' 种');
  line('两两相似度：平均 ' + Math.round(l2.similarity.avg * 100) + '%  最高 ' +
    Math.round(l2.similarity.max * 100) + '%');
  if (l2.similarity.maxPair) {
    line('  最像的一对：');
    line('    A ' + l2.similarity.maxPair[0] + '…');
    line('    B ' + l2.similarity.maxPair[1] + '…');
  }
  if (l2.score) {
    line('评分分布：' + l2.score.min + ' / ' + l2.score.p25 + ' / ' + l2.score.median +
      ' / ' + l2.score.p75 + ' / ' + l2.score.max + '（极差 ' + l2.score.spread + '）');
  }
  line('身份分布：' + JSON.stringify(l2.persona));
  line('条件句收尾率：' + Math.round(l2.conditionTailRate * 100) + '%');
  line('');
  line('=== 报警 ===');
  if (!alarms.length) line('  无');
  alarms.forEach(a => line('  [' + a.level + '] ' + a.text));

  const text = summary.join('\n');
  console.log('\n' + text);

  fs.writeFileSync(path.join(OUTDIR, 'summary-' + stamp + '.txt'), text, 'utf8');
  fs.writeFileSync(path.join(OUTDIR, 'report-' + stamp + '.json'),
    JSON.stringify({ meta: plugin.meta, model: MODEL, split: SPLIT, tokens, l1Avg, failByCheck, l2, alarms, samples }, null, 2),
    'utf8');

  const cols = ['idx', 'company', 'title', 'persona', 'L1', 'score', 'level', 'greeting'];
  const csv = [cols.join(',')].concat(samples.map((s, i) => [
    i + 1,
    s.jd.company || '', s.jd.title || '', (s.persona && s.persona.name) || '',
    s.l1 ? s.l1.score : '', (s.verdict && s.verdict.score) || '', (s.verdict && s.verdict.level) || '',
    (s.greeting && s.greeting.text) || s.error || ''
  ].map(v => '"' + String(v).replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"').join(','))).join('\n');
  fs.writeFileSync(path.join(OUTDIR, 'samples-' + stamp + '.csv'), '\ufeff' + csv, 'utf8');

  console.log('\n写入：eval/out/summary-' + stamp + '.txt');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });

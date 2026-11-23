/* ============================================================
   种子生成器：为每个专业生成一份「内容最全」的事实库

   一个专业只调一次模型，产出 3 段经历 × 4 条 bullet + 3–4 个身份。
   4 个质量档由 lib/trim.js 确定性裁剪，不再调模型。

   用法：
     node eval/make-seeds.js --pilot 3        先跑 3 个专业看看质量
     node eval/make-seeds.js                  全量 101 个
     node eval/make-seeds.js --dry 会计学     只打印 prompt，不调用

   产出：eval/fixtures/seeds/<专业>.json

   ⚠️ 生成模型和插件生成话术用的模型如果同源（都是 DeepSeek），
      会形成自洽。能用别的厂商就用 --model 指定。
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { chat, extractJson, resolve } = require('./lib/llm');
const { trimFactBase } = require('./lib/trim');

const ROOT = path.resolve(__dirname, '..');
const SEEDS = path.join(__dirname, 'fixtures', 'seeds');  /* 应届；work 档用 OUTDIR */
const MAJORS = path.join(__dirname, 'fixtures', 'majors.json');

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const MODEL = arg('model', '');
const PROVIDER = arg('provider', '');
const PILOT = parseInt(arg('pilot', '0'), 10);
const DRY = arg('dry', '');
const ONLY = (arg('only', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const CONCURRENCY = Math.max(1, parseInt(arg('concurrency', '4'), 10));
const EXP = arg('exp', 'fresh');          /* fresh = 应届生；work = 有 2-3 年全职经验 */
const OUTDIR = EXP === 'work' ? path.join(__dirname, 'fixtures', 'seeds-work')
                             : path.join(__dirname, 'fixtures', 'seeds');

const QUALITY_HINT = {
  rich: '3 段经历，每段 3–4 条 bullet，至少两条带量化数字',
  normal: '2 段经历，每段 2–3 条，少量数字',
  thin: '1 段经历，2 条，全是职责描述没有数字',
  minimal: '1 段经历，1 条，几乎没有内容'
};

function buildPrompt(m) {
  const tech = m.itAdjacent
    ? '这个专业常进 IT/互联网公司，技能里可以出现技术栈。'
    : '这个专业**不常进 IT 公司**，技能和经历里**不要出现** Docker、Function Calling、RAG、LangChain、FastAPI、pytest 等 IT 技术词。';

  /* 应届 / 有经验两套人设，其他规则一致 */
  const person = EXP === 'work'
    ? `这是一个**毕业 2–3 年、有全职工作经验**的求职者：
- 教育背景：本科，2022 或 2023 届
- meta.years 填 2 或 3，meta.level 填「中级」
- 前两段是**全职工作**（不是实习），时间各 1–2 年，要写清职责范围和产出
- 第三段可以是实习或项目`
    : `这是一个**应届生**：
- 教育背景：本科，2026 届
- meta.years 填 0，meta.level 填「应届」
- 经历都是实习、项目或校内工作`;

  return [
    {
      role: 'system',
      content: `你在造一份**测试用的合成简历**，不是给人用的。目标是有代表性、可核查。

专业：${m.major}（${m.discipline}）
常见对口岗位：${m.jobs.join('、')}
${tech}

${person}

规则：
1. 经历要像真的：公司名可以是泛化的（如"某连锁零售企业"），岗位名要用市场上真有的叫法
2. **恰好 3 段经历，每段 3–4 条 bullet**。不要拆成 5 段、每段 1 条
3. bullet 用中性事实，不要形容词堆砌（不要"认真负责""执行力强"）
4. 量化数字要合理，不要夸张（${EXP === 'work' ? '工作 2 年也不可能"管理 200 人团队"' : '应届生不可能"管理 50 人团队"'}）
5. 每段至少两条 bullet 带数字
6. 身份（personas）按这个专业的真实出路派生 3–4 个，每个带可投岗位名

只输出 JSON，结构如下：
{
  "meta": { "headline": "一句话概括这个人的职业画像", "years": ${EXP === 'work' ? 2 : 0}, "level": "${EXP === 'work' ? '中级' : '应届'}" },
  "skills": ["技能1", "技能2"],
  "education": [{ "school": "某大学", "major": "${m.major}", "degree": "本科", "year": "${EXP === 'work' ? '2022' : '2026'}" }],
  "experiences": [
    { "id": "exp1", "org": "公司", "role": "岗位名", "period": "2023.03-2025.06",
      "bullets": [
        { "id": "b1", "text": "一条中性事实，带数字", "metrics": ["数字"], "skills": ["技能"] }
      ] }
  ],
  "personas": [
    { "id": "p1", "name": "身份名", "jobs": ["可投岗位"], "focus": ["叙事重点"], "thesis": "一句话主张", "strength": 4, "bulletIds": ["b1","b2"] }
  ]
}`
    },
    { role: 'user', content: '生成这份合成简历的 JSON。' }
  ];
}

/* 校验：结构对不对、有没有漏技术词 */
function validate(fb, m) {
  const errs = [];
  if (!fb.meta || !fb.meta.headline) errs.push('缺 meta.headline');
  if (!Array.isArray(fb.experiences) || !fb.experiences.length) errs.push('没有 experiences');
  if (!Array.isArray(fb.personas) || !fb.personas.length) errs.push('没有 personas');

  const bullets = [];
  (fb.experiences || []).forEach(e => (e.bullets || []).forEach(b => bullets.push(b)));
  if (bullets.length < 9) errs.push('bullet 只有 ' + bullets.length + ' 条（要 3 段 × 3–4 条）');

  /* 经历被拆碎会让 rich 档变得很薄 */
  const exps = fb.experiences || [];
  if (exps.length < 3) errs.push('经历少于 3 段');
  if (exps.length > 4) errs.push('经历有 ' + exps.length + ' 段，要求恰好 3 段');
  exps.slice(0, 3).forEach((e, i) => {
    const n = (e.bullets || []).length;
    if (n < 3) errs.push('第 ' + (i + 1) + ' 段只有 ' + n + ' 条 bullet，要求 3–4 条');
  });

  const ids = new Set(bullets.map(b => b.id));
  if (ids.size !== bullets.length) errs.push('bullet id 有重复');

  (fb.personas || []).forEach((p, i) => {
    (p.bulletIds || []).forEach((id) => {
      if (!ids.has(id)) errs.push('persona' + (i + 1) + ' 引用了不存在的 ' + id);
    });
  });

  if (!m.itAdjacent) {
    const text = JSON.stringify(fb);
    const leaked = ['Docker', 'Function Calling', 'LangChain', 'RAG', 'FastAPI', 'pytest']
      .filter(t => text.indexOf(t) >= 0);
    if (leaked.length) errs.push('非 IT 专业却出现了：' + leaked.join('、'));
  }

  return errs;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(MAJORS, 'utf8'));
  let all = [];
  data.majorGroups.forEach(g => g.majors.forEach(m => all.push(Object.assign({ discipline: g.discipline }, m))));

  if (DRY) {
    const m = all.find(x => x.major === DRY) || all[0];
    console.log('---- 专业：' + m.major + ' ----');
    buildPrompt(m).forEach(p => console.log('\n[' + p.role + ']\n' + p.content));
    return;
  }

  fs.mkdirSync(OUTDIR, { recursive: true });
  let todo = ONLY.length ? all.filter(m => ONLY.indexOf(m.major) >= 0) : all;
  if (!ONLY.length && PILOT) todo = all.slice(0, PILOT);

  /* 先把厂商解析出来，配错了立刻报错，别跑一半才失败 */
  const R = resolve(PROVIDER || null, MODEL || null);
  console.log('生成 ' + todo.length + ' 个专业的种子');
  console.log('厂商 ' + R.label + '  模型 ' + R.model);
  console.log('地址 ' + R.baseUrl);

  /* 评测用的模型是插件侧的，生成侧换厂商就是为了避开它 */
  const evalProvider = require('./lib/llm').getEnv('LLM_PROVIDER') || 'deepseek';
  if (R.name === evalProvider) {
    console.log('⚠️ 生成和评测都走 ' + R.name + '，会形成自洽（A 写的东西 A 觉得好）。');
    console.log('   建议换一家：--provider qwen / glm / kimi / mimo');
  }
  console.log('');

  let ok = 0, bad = 0;
  let done = 0;

  async function one(m, i) {
    const out = path.join(OUTDIR, m.major + '.json');
    if (fs.existsSync(out)) { console.log('  跳过（已存在） ' + m.major); return; }
    try {
      let parsed = null;
      let lastErrs = null;

      /* 最多试 3 次：模型偶尔会漏字段，把上次的错误回灌给它 */
      for (let attempt = 1; attempt <= 3; attempt++) {
        const msgs = buildPrompt(m);
        if (lastErrs) {
          msgs.push({
            role: 'user',
            content: '上次的输出不合格：' + lastErrs.join('；') + '\n请严格按上面的 JSON 结构重新输出，不要省略任何字段。'
          });
        } else {
          msgs.push({ role: 'user', content: '生成这份合成简历的 JSON。' });
        }

        const res = await chat(msgs, {
          provider: R.name, model: R.model,
          jsonMode: true, maxTokens: 4000, temperature: attempt === 1 ? 0.6 : 0.4
        });
        const p = extractJson(res.content);
        if (!p.data) {
          lastErrs = [p.truncated ? '输出被截断，JSON 不完整' : 'JSON 解析失败'];
          continue;
        }
        const errs = validate(p.data, m);
        if (!errs.length) { parsed = p.data; break; }
        lastErrs = errs;
      }

      if (!parsed) throw new Error('校验失败（重试 3 次）：' + lastErrs.join('；'));

      /* 存下：种子 + 四个裁剪档，方便人工抽查 */
      const tiers = {};
      ['rich', 'normal', 'thin', 'minimal'].forEach((q) => {
        tiers[q] = trimFactBase(parsed, q);
      });
      fs.writeFileSync(out, JSON.stringify({ major: m.major, discipline: m.discipline, provider: R.name, model: R.model, seed: parsed, tiers }, null, 1), 'utf8');

      const counts = Object.keys(tiers).map(q => q + ':' + tiers[q].meta.__bulletCount).join(' ');
      done++;
      console.log('  ✓ [' + done + '/' + todo.length + '] ' + m.major + '  ' + counts);
      ok++;
    } catch (e) {
      const where = (e.stack || '').split('\n').filter(l => l.indexOf('eval') >= 0 || l.indexOf('lib') >= 0).slice(0, 2).join(' ← ');
      done++;
      console.log('  ✗ [' + done + '/' + todo.length + '] ' + m.major + ' — ' + e.message + (where ? '\n      ' + where : ''));
      bad++;
    }
  }

  /* 并发池：通义这个模型带思考，串行 101 个要一小时，4 并发约 15 分钟 */
  let cursor = 0;
  const workers = Math.min(CONCURRENCY, todo.length);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= todo.length) break;
      await one(todo[idx], idx);
    }
  }));

  console.log('\n成功 ' + ok + ' / 失败 ' + bad);
  console.log('种子目录：' + OUTDIR);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });

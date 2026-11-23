/* ============================================================
   自检：不调模型，不花钱，验证评测器本身是准的

   跑法：node eval/selftest.js
   全绿才能相信后面的评测数字。
   ============================================================ */

const T = require('./lib/text');
const checks = require('./lib/checks');
const metrics = require('./lib/metrics');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '   ' + extra : '')); }
}
function section(t) { console.log('\n【' + t + '】'); }

/* ---------------- 文本工具 ---------------- */
section('文本工具');
ok('norm 去掉标点空格', T.norm('熟悉 Linux， 懂 Docker！') === '熟悉linux懂docker', T.norm('熟悉 Linux， 懂 Docker！'));
ok('overlap 完全包含 = 1', T.overlap('熟悉 Linux 常用命令', '熟悉 Linux 常用命令、能做网络测试') === 1);
ok('overlap 无关 = 低分', T.overlap('熟悉 Kubernetes 与容器编排', '本科及以上学历，会计相关专业') < 0.2,
  T.overlap('熟悉 Kubernetes 与容器编排', '本科及以上学历，会计相关专业').toFixed(2));
ok('lcs 找最长公共子串', T.lcs('熟悉Function Calling与LangGraph', '熟悉Function Calling，能独立实现') === 17,
  String(T.lcs('熟悉Function Calling与LangGraph', '熟悉Function Calling，能独立实现')));
ok('opening 取前 N 字', T.opening('电子信息专业，懂Linux', 6) === '电子信息专业');
ok('entropy 均匀 > 集中', T.entropy([1, 1, 1, 1]) > T.entropy([4]));

/* ---------------- L1 硬规则 ---------------- */
section('L1 硬规则');

const JD_RAG = [
  '某公司 · RAG 检索工程师 · 杭州',
  '【岗位职责】',
  '1. 负责企业知识库 RAG 检索服务的研发与优化',
  '2. 参与召回与重排链路的迭代',
  '【任职要求】',
  '1. 本科及以上学历，计算机相关专业',
  '2. 熟悉 BM25 与向量检索、RRF 融合与重排',
  '3. 熟练掌握 Python'
].join('\n');

const EXAMPLES = [
  '懂Agent/RAG底层技术，有可演示、可交付的落地项目；擅长写技术方案与文档；有工科背景，沟通能力好，接受出差'
];

/* 好的：切题、无寒暄、不抄、不编条件 */
const GOOD = '熟悉BM25与向量检索，做过RRF融合与重排的检索服务；擅长写技术文档，能独立交付知识库问答，有全链路日志排障经验';
let r = checks.checkSample({
  jdText: JD_RAG, greeting: { text: GOOD }, gaps: [], majors: []
}, { examples: EXAMPLES, maxChars: 100 });
const gid = id => r.checks.find(c => c.id === id);
ok('好样本 L1 = 100', r.score === 100, '实际 ' + r.score);
ok('好样本 字数合规', gid('length').pass, gid('length').detail);
ok('好样本 开头命中 JD', gid('opening_jd').pass, gid('opening_jd').detail);
ok('好样本 未抄示例', gid('no_copy').pass, gid('no_copy').detail);

/* 坏的：寒暄 + 编造出差 + 感叹号 */
const BAD = '您好，我是具有三年经验的Agent开发工程师，熟悉Function Calling，可接受出差，期待您的回复！';
r = checks.checkSample({
  jdText: JD_RAG, greeting: { text: BAD }, gaps: [], majors: []
}, { examples: EXAMPLES, maxChars: 100 });
const bid = id => r.checks.find(c => c.id === id);
ok('坏样本 命中禁用词', bid('no_ban').pass === false, bid('no_ban').detail);
ok('坏样本 编造了 JD 没提的出差', bid('no_false_cond').pass === false, bid('no_false_cond').detail);
ok('坏样本 L1 明显低于好样本', r.score < 60, '实际 ' + r.score);

/* 照抄示例 */
r = checks.checkSample({
  jdText: JD_RAG, greeting: { text: EXAMPLES[0] }, gaps: [], majors: []
}, { examples: EXAMPLES, maxChars: 100 });
ok('照抄示例会被抓出来', r.checks.find(c => c.id === 'no_copy').pass === false,
  r.checks.find(c => c.id === 'no_copy').detail);

/* 超字数 */
r = checks.checkSample({
  jdText: JD_RAG, greeting: { text: GOOD + '，另外还有很多很多需要补充说明的内容'.repeat(4) }, gaps: [], majors: []
}, { examples: EXAMPLES, maxChars: 100 });
ok('超 100 字会被抓出来', r.checks.find(c => c.id === 'length').pass === false,
  r.checks.find(c => c.id === 'length').detail);

/* 缺口编造 */
r = checks.checkSample({
  jdText: JD_RAG, greeting: { text: GOOD },
  gaps: [{ req: '仅限杭州大二或研一' }, { req: '熟悉 BM25 与向量检索' }], majors: []
}, { examples: EXAMPLES, maxChars: 100 });
const gt = r.checks.find(c => c.id === 'gaps_traceable');
ok('编造的缺口会被抓出来', gt.pass === false, gt.detail);

/* 专业开场 */
r = checks.checkSample({
  jdText: JD_RAG, greeting: { text: '电子信息专业，' + GOOD }, gaps: [], majors: ['电子信息工程', '电子信息', '电子']
}, { examples: EXAMPLES, maxChars: 100 });
const ml = r.checks.find(c => c.id === 'major_lead');
ok('JD 要计算机时用电子开场 → 报警', ml && ml.pass === false, ml ? ml.detail : '(未检查)');

/* ---------------- L2 集合级 ---------------- */
section('L2 集合级');

/* 6 个完全不同的 JD */
const SIX_JDS = [
  '熟悉 BM25 与向量检索，做过 RRF 融合与重排，Python 熟练',
  '负责 Agent 评测体系建设，用例设计与指标量化，Badcase 归因',
  '大模型 API 对接，多模型适配，流式输出与超时重试',
  'Linux 环境部署，Docker 容器化，日志排障与网络排查',
  '企业知识库问答服务，检索增强生成，召回率优化',
  'React 与 TypeScript 前端开发，组件库维护'
];

/* ① 模板化：6 条全用同一个开头，但 JD 各不相同 → 开头没跟着 JD 走 */
const TEMPLATED = SIX_JDS.map((jd, i) => ({
  greeting: { text: '熟悉Function Calling，能独立实现可运行Agent框架，懂Python与Docker部署，做过检索服务，第' + i + '版' },
  verdict: { score: 62 },
  jdText: jd
}));
let m = metrics.scoreSet(TEMPLATED);
let a = metrics.alarm(m);
ok('模板化集合：开头 top1 = 100%', Math.round(m.opening.top1 * 100) === 100);
ok('模板化集合：开头没跟着 JD 走（<70%）',
  typeof m.tailoring === 'number' && m.tailoring < metrics.LIMITS.tailoring,
  '对应率 ' + Math.round((m.tailoring || 0) * 100) + '%');
ok('模板化集合：报警含 opening_not_tailored', a.some(x => x.id === 'opening_not_tailored'),
  a.map(x => x.id).join(','));
ok('模板化集合：报警含 set_similar', a.some(x => x.id === 'set_similar'));
ok('模板化集合：报警含 score_flat', a.some(x => x.id === 'score_flat'));

/* ② 量身定制：开头各自对上自己的 JD */
const TAILORED = [
  { g: '熟悉BM25与向量检索，做过RRF融合与重排的检索链路，能独立交付知识库问答', s: 72 },
  { g: '做过Agent评测体系建设，用用例设计验证工具调用正确性，熟悉Badcase归因', s: 85 },
  { g: '精通大模型API对接，做过流式输出与超时重试，适配过多家模型供应商', s: 68 },
  { g: '熟练用Docker部署环境，做过Linux日志排障与网络连通性排查，能独立交付', s: 55 },
  { g: '做过企业知识库问答服务，优化检索增强生成的召回率，写过架构说明', s: 78 },
  { g: '精通React与TypeScript前端开发，维护过组件库，做过性能优化', s: 41 }
].map((x, i) => ({ greeting: { text: x.g }, verdict: { score: x.s }, jdText: SIX_JDS[i] }));
m = metrics.scoreSet(TAILORED);
a = metrics.alarm(m);
ok('定制集合：开头跟着 JD 走（≥70%）',
  m.tailoring >= metrics.LIMITS.tailoring, '对应率 ' + Math.round(m.tailoring * 100) + '%');
ok('定制集合：不报 opening_not_tailored', !a.some(x => x.id === 'opening_not_tailored'),
  a.map(x => x.id).join(',') || '无');
ok('定制集合：评分有跨度不报 score_flat', !a.some(x => x.id === 'score_flat'));

/* ③ 多样化（无 JD 文本，只能看弱信号） */
const DIVERSE = [
  '熟悉BM25与向量检索，做过RRF融合与重排的检索服务，能独立交付知识库问答',
  '做过Agent行为级评测，用四类用例和可量化指标验证工具调用正确性，熟悉根因归因',
  '精通Python与大模型API对接，做过流式输出与多模型适配，写过多智能体工作流',
  '电子信息专业，精通C语言与Linux，有STM32硬件调试与示波器排障经验，写过培训文档',
  '熟练用Docker部署环境、看日志定位问题，做过客户现场实施，能直接对接客户',
  '独立实现工具调用Agent框架并开源，做过工具注册与异常兜底，写过架构说明'
].map((t, i) => ({ greeting: { text: t }, verdict: { score: 40 + i * 12 } }));
m = metrics.scoreSet(DIVERSE);
a = metrics.alarm(m);
ok('多样化集合：开头分散', m.opening.distinct === 6, '不同开头 ' + m.opening.distinct + ' 种');
ok('多样化集合：无法算 tailoring 时不误报', m.tailoring === null);
ok('多样化集合：不报警', a.length === 0, a.map(x => x.id).join(',') || '无');

/* ---------------- 边界 ---------------- */
section('边界');
m = metrics.scoreSet([{ greeting: { text: '只有一条' }, verdict: { score: 50 } }]);
ok('样本少于 5 条不下结论', metrics.alarm(m).length === 0);
ok('单条时相似度不炸', m.similarity.avg === 0);

console.log('\n' + '='.repeat(46));
console.log('通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);

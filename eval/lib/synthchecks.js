/* ============================================================
   合成求职者的六条确定性检查

   全部不调模型，同样的输入永远同样的输出。
   测的是「会不会犯硬错误」，不是「写得好不好」。
   ============================================================ */

const T = require('./text');

/* ① 非 IT 专业的话术里出现了技术词 = 幻觉 */
function checkTechLeak(greeting, forbidTerms) {
  if (!forbidTerms || !forbidTerms.length) return null;
  const text = String(greeting || '');
  const hit = forbidTerms.filter(t => text.toLowerCase().indexOf(String(t).toLowerCase()) >= 0);
  return {
    id: 'no_tech_leak',
    pass: hit.length === 0,
    detail: hit.length ? '出现了该专业不可能有的技术词：' + hit.join('、') : '无技术词泄漏'
  };
}

/* ② 引用了事实库里不存在的证据 = 编造

   注意：模型会拿「教育背景」「技能表」当证据，写成 edu / skill / meta 这类
   伪 id。这是合法的 —— 事实库里确实有 education 和 skills。
   只有引用的**bullet 编号**不存在，才算编造。 */
const PSEUDO_REF = /^(skill|skills|edu|education|meta|exp|experience)/i;

function checkGhostBullets(proj, aliveIds, expIds) {
  const cites = [];
  const g = proj.greeting || {};
  (g.bulletIds || []).forEach(id => cites.push(String(id)));
  (proj.highlights || []).forEach(h => {
    if (typeof h === 'string') return;
    (h.bulletIds || []).forEach(id => cites.push(String(id)));
    if (h.bulletId) cites.push(String(h.bulletId));
  });
  (proj.hits || []).forEach(h => { if (h.bulletId) cites.push(String(h.bulletId)); });

  const valid = new Set(aliveIds);
  (expIds || []).forEach(id => valid.add(id));

  const ghosts = cites.filter((id) => {
    if (PSEUDO_REF.test(id)) return false;   /* 引用技能/教育/整段经历，合法 */
    return !valid.has(id);
  });

  return {
    id: 'no_ghost_bullet',
    pass: ghosts.length === 0,
    detail: ghosts.length
      ? '引用了不存在的证据：' + Array.from(new Set(ghosts)).join('、') +
        '（事实库只有 ' + aliveIds.size + ' 条 bullet）'
      : '引用的 ' + new Set(cites).size + ' 条证据全部有效'
  };
}

/* ③（已废弃为逐条检查）投无关岗给高分

   为什么删掉：没法逐条判断「对口」。
   抽检发现哲学投「证据搜集专员」被判 78 分 go —— 看着像误判，
   但那人有档案整理与引文核对经验，其实是对口的。

   改成报告级的集合指标（见 run-synth 的 scoreByFit）：
   比「48 条挂了几条」，看「对口岗平均分 - 无关岗平均分」更能说明问题。
   逐条判断交给 gap_sourced 和 no_ghost_bullet。
*/

/* ④ 专业名不许放在第一个分句

   判定「这句在说专业」而不是「碰巧出现同样的字」：
   专业名后面必须跟着 专业/本科/硕士/学位/毕业/应届 这类词。

   反例（原来会误判）：
     「热爱足球与体育赛事，…；体育教育本科。」
     前两字「体育」出现在首句里，但它说的是「体育赛事」，不是在报专业。

   正例（该判违规）：
     「英语专业，做过英文商务合同翻译……」
     「新闻学专业，做过民生选题采访……」 */
const MAJOR_CTX = /专业|本科|硕士|学士|学位|毕业|应届|科班/;

function majorMentionedIn(clause, major) {
  const c = T.norm(clause);
  const m = T.norm(major);
  if (!c || !m) return false;

  const tryAt = (token) => {
    let from = 0;
    while (true) {
      const at = c.indexOf(token, from);
      if (at < 0) return false;
      const tail = c.slice(at + token.length, at + token.length + 4);
      if (MAJOR_CTX.test(tail)) return true;
      from = at + 1;
    }
  };

  if (tryAt(m)) return true;
  /* 长专业名允许用前两字简称（机械设计制造及其自动化 → 机械） */
  if (m.length > 3 && tryAt(m.slice(0, 2))) return true;
  return false;
}

function checkMajorLead(greeting, jd, major) {
  const text = String(greeting || '');
  if (!major) return null;

  const firstClause = text.split(/[，,。；;、]/)[0] || '';
  if (!majorMentionedIn(firstClause, major)) return null;   /* 首句没在报专业，合规 */

  const clause = (String(jd || '').match(/[^\n。；;]{0,50}专业[^\n。；;]{0,50}/) || [''])[0];
  const listed = clause && T.norm(clause).indexOf(T.norm(major)) >= 0;
  return {
    id: 'major_lead',
    pass: !!listed,
    detail: listed
      ? 'JD 专业要求里列了「' + major + '」，可以用它打头'
      : '第一个分句用了「' + major + '」，但 JD 的专业要求里没有列它'
  };
}

/* ⑤ 缺口必须在 JD 原文可追溯

   两个已知的误判来源：
   1. 数字类要求 —— JD 抬头写「1 年」，模型写成「1 年相关经验」，
      整句重合率很低，但数字对得上就算有依据
   2. 短要求 —— 二字切片本来就少，换个说法比率就崩了，
      所以短句用更低的阈值 */
function gapTraceable(req, jdText) {
  const jdNorm = T.norm(jdText);
  const reqNorm = T.norm(req);
  if (!reqNorm) return true;

  const nums = reqNorm.match(/\d+/g) || [];
  if (nums.length && nums.every(n => jdNorm.indexOf(n) >= 0)) return true;

  const thr = reqNorm.length <= 8 ? 0.25 : 0.35;
  return T.overlap(req, jdText) >= thr;
}

function checkGapSourced(gaps, jd) {
  const list = gaps || [];
  if (!list.length) return null;
  const bad = list.filter(g => !gapTraceable(g.req, jd));
  return {
    id: 'gap_sourced',
    pass: bad.length === 0,
    detail: bad.length
      ? bad.length + '/' + list.length + ' 条缺口在 JD 里找不到依据：' + bad.map(g => g.req).slice(0, 2).join('；')
      : list.length + ' 条缺口全部可追溯'
  };
}

/* ⑥ 极薄的事实库下不许崩，且要给出结构完整的输出
   注意：判 skip 的岗位不写话术是合理的 —— 都不建议投了，还写什么打招呼语。
   所以只要求 verdict 一定在，greeting 允许在 skip 时缺席。 */
function checkNoCrash(proj) {
  const hasVerdict = !!(proj && proj.verdict && typeof proj.verdict.score === 'number');
  const level = (proj && proj.verdict && proj.verdict.level) || '';
  const hasGreeting = !!(proj && proj.greeting && proj.greeting.text);
  const ok = hasVerdict && (hasGreeting || level === 'skip');
  return {
    id: 'no_crash',
    pass: ok,
    detail: ok
      ? (hasGreeting ? '结构完整' : '判了 skip，没写话术（合理）')
      : '返回结果缺少 verdict' + (hasVerdict ? '，且非 skip 却缺 greeting' : '')
  };
}

/* ⑦ 身份状态必须来自事实库，不许从 JD 抄

   JD 里的条件说的是「岗位接受什么」，不是「你是谁」。
   实测翻车：JD 写「1—3 年经验或在校学生均可」，话术就写「在校应届」，
   但事实库里是 2022.09–2026.06 已毕业，查不到「在校」。 */
const IDENTITY_WORDS = ['在校', '在读', '毕业生', '可实习'];

function checkIdentityClaim(greeting, factText) {
  const text = String(greeting || '');
  if (!text) return null;
  const ev = String(factText || '');
  const claimed = IDENTITY_WORDS.filter(w => text.indexOf(w) >= 0);
  if (!claimed.length) return null;
  const fake = claimed.filter(w => ev.indexOf(w) < 0);
  return {
    id: 'no_fake_identity',
    pass: fake.length === 0,
    detail: fake.length
      ? '话术写了「' + fake.join('、') + '」，但事实库里没有这个状态（多半是从 JD 抄的）'
      : '身份说法与事实库一致'
  };
}

/* ---------- 汇总 ---------- */

/**
 * @param {object} ctx {
 *   case: 变体用例, proj: 投影结果, greeting能拿到,
 *   aliveIds: Set, factBullets: number
 * }
 */
function runAll(ctx) {
  const out = [];
  const push = (r) => { if (r) out.push(r); };

  push(checkNoCrash(ctx.proj));
  if (ctx.proj && ctx.proj.greeting) {
    push(checkTechLeak(ctx.proj.greeting.text, ctx.case.expect.forbidTerms));
    push(checkMajorLead(ctx.proj.greeting.text, ctx.jdText, ctx.case.major));
    push(checkIdentityClaim(ctx.proj.greeting.text, ctx.factText));
  }
  if (ctx.proj) {
    push(checkGhostBullets(ctx.proj, ctx.aliveIds, ctx.expIds));
    push(checkGapSourced(ctx.proj.gaps, ctx.jdText));
  }

  const passed = out.filter(c => c.pass).length;
  return {
    checks: out,
    passed: passed,
    total: out.length,
    failed: out.filter(c => !c.pass).map(c => c.id)
  };
}

module.exports = {
  runAll, checkTechLeak, checkGhostBullets, checkIdentityClaim,
  checkMajorLead, checkGapSourced, checkNoCrash, gapTraceable
};

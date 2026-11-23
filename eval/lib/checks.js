/* ============================================================
   L1 硬规则 —— 纯代码，不调模型，不可作弊

   这些检查全部是确定性的：同样的输入永远同样的输出。
   它们回答的是"这条话术有没有犯低级错误"，不是"写得好不好"。
   ============================================================ */

const T = require('./text');

/* 明显不像真人发的开场 */
const BAN_WORDS = ['您好', '贵司', '贵公司', '期待您的回复', '希望能有机会', '感谢您', '打扰了'];
const BAN_CHARS = ['—', '！', '!'];

/* JD 没提就绝对不能出现的条件词 */
const COND_WORDS = ['出差', '驻场', '加班', '倒班', '到岗', '远程', '夜班', '外派'];

/* 抄样本的判定线：和任一示例有连续 N 个字以上重合 */
const COPY_LCS_LIMIT = 8;

/* 缺口必须在 JD 里可追溯 */
const GAP_OVERLAP_MIN = 0.35;

/* 开头这几个字里要能对上 JD 的词 */
const OPENING_CHARS = 12;

/**
 * @param {object} sample  { jdText, greeting:{text,angle}, gaps:[], persona, majors:[] }
 * @param {object} ctx     { examples:[], maxChars }
 */
function checkSample(sample, ctx) {
  ctx = ctx || {};
  const examples = ctx.examples || [];
  const maxChars = ctx.maxChars || 100;

  const text = String((sample.greeting && sample.greeting.text) || '');
  const jd = String(sample.jdText || '');
  const n = T.len(text);

  const out = [];
  const add = (id, label, pass, detail) => out.push({ id, label, pass, detail });

  /* 1. 字数 */
  add('length', '字数 50–' + maxChars,
    n >= 50 && n <= maxChars,
    n + ' 字' + (n > maxChars ? '（超上限 ' + (n - maxChars) + ' 字）' : n < 50 ? '（不足 50 字）' : ''));

  /* 2. 禁用词 */
  const bans = BAN_WORDS.filter(w => text.indexOf(w) >= 0)
    .concat(BAN_CHARS.filter(c => text.indexOf(c) >= 0));
  add('no_ban', '无寒暄/无营销词', bans.length === 0,
    bans.length ? '出现：' + bans.join('、') : '干净');

  /* 3. 不许抄示例 */
  let worst = { len: 0, ex: '' };
  for (const ex of examples) {
    const l = T.lcs(text, ex);
    if (l > worst.len) worst = { len: l, ex: ex };
  }
  add('no_copy', '未照抄示例（<8 字重合）',
    worst.len < COPY_LCS_LIMIT,
    worst.len ? '与示例重合 ' + worst.len + ' 字：' + worst.ex.slice(0, 24) + '…' : '无重合');

  /* 4. 不许编 JD 没有的条件 */
  const falseConds = COND_WORDS.filter(w => text.indexOf(w) >= 0 && jd.indexOf(w) < 0);
  add('no_false_cond', '未编造 JD 没提的条件',
    falseConds.length === 0,
    falseConds.length ? '出现「' + falseConds.join('、') + '」但 JD 里没有' : '干净');

  /* 5. 开头要能对上 JD 的词 */
  const open = T.opening(text, OPENING_CHARS);
  const openHit = T.bigrams(open).some(g => T.norm(jd).indexOf(g) >= 0);
  add('opening_jd', '开头 ' + OPENING_CHARS + ' 字命中 JD 用语',
    openHit,
    openHit ? '「' + open + '」对上了' : '「' + open + '」在 JD 里找不到对应词');

  /* 6. 缺口必须能在 JD 原文找到依据 */
  const gaps = sample.gaps || [];
  if (gaps.length) {
    const bad = gaps.filter(g => T.overlap(g.req, jd) < GAP_OVERLAP_MIN);
    add('gaps_traceable', '缺口可在 JD 原文追溯',
      bad.length === 0,
      bad.length ? bad.length + '/' + gaps.length + ' 条查无实据：' +
        bad.map(g => g.req).slice(0, 2).join('；') : gaps.length + ' 条全部可追溯');
  }

  /* 7. 专业开场合规（仅当用户有专业信息时才检查） */
  const majors = (sample.majors || []).filter(Boolean);
  if (majors.length) {
    const head = T.norm(text).slice(0, 14);
    const lead = majors.find(m => head.indexOf(T.norm(m)) >= 0);
    if (lead) {
      const clause = jdMajorClause(jd);
      const allowed = clause && majors.some(m => T.norm(clause).indexOf(T.norm(m)) >= 0);
      add('major_lead', '专业开场有 JD 依据',
        !!allowed,
        allowed ? 'JD 专业要求里列了「' + lead + '」'
          : '用「' + lead + '」开场，但 JD 没列这个专业');
    }
  }

  const passed = out.filter(c => c.pass).length;
  return {
    checks: out,
    passed: passed,
    total: out.length,
    score: out.length ? Math.round(passed * 100 / out.length) : 0
  };
}

function jdMajorClause(jd) {
  const m = String(jd || '').match(/[^\n。；;]{0,50}专业[^\n。；;]{0,50}/);
  return m ? m[0] : '';
}

module.exports = { checkSample, BAN_WORDS, COND_WORDS, COPY_LCS_LIMIT, GAP_OVERLAP_MIN };

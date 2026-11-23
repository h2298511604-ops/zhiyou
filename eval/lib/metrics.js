/* ============================================================
   L2 集合级指标 —— 纯代码

   为什么需要这一层：
   逐条打分永远发现不了"所有话术都用同一个开头"。
   每一条单独看都切题、通顺、合规，都能拿高分；
   把 20 条摆在一起才看得出模板化。

   这一层的指标不可作弊，也不依赖判官口味。
   ============================================================ */

const T = require('./text');

/* 开头取「第一个分句」的前 12 字：
   12 字是 HR 在列表页能看到的量级，按分句切能区分不同句式 */
const OPENING_N = 12;

function scoreSet(samples) {
  const texts = samples.map(s => (s.greeting && s.greeting.text) || '');
  const n = texts.length;

  /* ---- ① 开头词分布 ---- */
  const openings = texts.map(t => T.opening(t, OPENING_N));
  const counter = {};
  openings.forEach((o) => { counter[o] = (counter[o] || 0) + 1; });
  const ranked = Object.keys(counter)
    .map(k => ({ word: k, count: counter[k] }))
    .sort((a, b) => b.count - a.count);
  const top1 = ranked[0] ? ranked[0].count / n : 0;
  const h = T.entropy(ranked.map(r => r.count));

  /* ---- ② 两两相似度 ---- */
  let sum = 0, pairs = 0, maxPair = { v: 0, a: '', b: '' };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const shorter = Math.min(T.len(texts[i]), T.len(texts[j])) || 1;
      const v = T.lcs(texts[i], texts[j]) / shorter;
      sum += v;
      pairs++;
      if (v > maxPair.v) maxPair = { v, a: texts[i], b: texts[j] };
    }
  }
  const avgSim = pairs ? sum / pairs : 0;

  /* ---- ③ 评分分布 ---- */
  const scores = samples
    .map(s => (s.verdict && s.verdict.score))
    .filter(x => typeof x === 'number');
  scores.sort((a, b) => a - b);
  const scoreStats = scores.length ? {
    n: scores.length,
    min: scores[0],
    p25: scores[Math.floor(scores.length * 0.25)],
    median: scores[Math.floor(scores.length * 0.5)],
    p75: scores[Math.floor(scores.length * 0.75)],
    max: scores[scores.length - 1],
    spread: scores[scores.length - 1] - scores[0]
  } : null;

  /* ---- ④ 身份分布 ---- */
  const persona = {};
  samples.forEach((s) => {
    const k = (s.persona && s.persona.name) || '(未知)';
    persona[k] = (persona[k] || 0) + 1;
  });

  /* ---- ⑥ 开头是否"看 JD 下菜" ----
     这是替代「开头 top1 占比」的真正指标。
     开头重复本身不算错——JD 要什么专业，开头就该用什么专业。
     错的是「不管 JD 是什么，开头都一样」。

     做法：对每一对 (i,j)，看 opening_i 和「自己的 JD」是否比和「别人的 JD」更像。
     随机分配 = 50%；照 JD 定制 ≈ 75% 以上。 */
  let tailoring = null;
  const withJd = samples.filter(s => s.jdText && (s.greeting && s.greeting.text));
  if (withJd.length >= 4) {
    let correct = 0, total = 0;
    for (let i = 0; i < withJd.length; i++) {
      const open = T.opening(withJd[i].greeting.text, OPENING_N);
      const own = T.overlap(open, withJd[i].jdText);
      for (let j = 0; j < withJd.length; j++) {
        if (i === j) continue;
        const other = T.overlap(open, withJd[j].jdText);
        total++;
        if (own > other) correct += 1;
        else if (own === other) correct += 0.5;
      }
    }
    tailoring = total ? correct / total : null;
  }

  /* ---- ⑦ 条件句结尾率（用了几个"接受出差"这类收尾） ---- */
  const condTail = texts.filter(t => /接受(出差|驻场|外派)|随时可面|可随时到岗/.test(t)).length;

  return {
    n: n,
    opening: {
      top1: top1,
      entropy: h,
      distinct: ranked.length,
      ranked: ranked.slice(0, 8)
    },
    tailoring: tailoring,
    similarity: {
      avg: avgSim,
      max: maxPair.v,
      maxPair: maxPair.v ? [maxPair.a.slice(0, 30), maxPair.b.slice(0, 30)] : null
    },
    score: scoreStats,
    persona: persona,
    conditionTailRate: n ? condTail / n : 0
  };
}

/* 判定阈值。
   注意 openingTop1 不再单独报警 —— 开头重复可能完全正确（JD 要的专业就那一个）。
   真正该管的是 tailoring：开头有没有跟着 JD 走。 */
const LIMITS = {
  openingTop1: 0.60,      /* 只做参考，超过 60% 才提一句 */
  tailoring: 0.70,        /* 开头与 JD 的对应率低于 70% = 没看 JD，随机水平是 50% */
  avgSimilarity: 0.35,    /* 两两平均相似度 35% = 换 JD 不换话 */
  scoreSpread: 15         /* 评分极差小于 15 = 评分没区分度 */
};

function alarm(m) {
  const a = [];
  if (m.n < 5) return a;   /* 样本太少不下结论 */

  /* 最关键的指标：开头有没有跟着 JD 变 */
  if (typeof m.tailoring === 'number') {
    if (m.tailoring < LIMITS.tailoring) {
      a.push({
        id: 'opening_not_tailored',
        level: 'high',
        text: '开头没跟着 JD 走：对应率 ' + Math.round(m.tailoring * 100) +
          '%，低于 ' + Math.round(LIMITS.tailoring * 100) + '% 线（随机水平是 50%）'
      });
    }
  } else if (m.opening.top1 > LIMITS.openingTop1) {
    /* 没有 JD 文本时的弱信号 */
    a.push({
      id: 'opening_repeat_unknown',
      level: 'low',
      text: '开头第一名占 ' + Math.round(m.opening.top1 * 100) +
        '%，但没有 JD 文本无法判断是不是跟着 JD 变的'
    });
  }

  if (m.similarity.avg > LIMITS.avgSimilarity) {
    a.push({
      id: 'set_similar',
      level: 'high',
      text: '话术长得太像：两两平均相似度 ' + Math.round(m.similarity.avg * 100) +
        '%，超过 ' + Math.round(LIMITS.avgSimilarity * 100) + '% 线（换 JD 没换话）'
    });
  }
  if (m.score && m.score.spread < LIMITS.scoreSpread) {
    a.push({
      id: 'score_flat',
      level: 'medium',
      text: '评分没区分度：极差只有 ' + m.score.spread + ' 分（' + m.score.min + '–' + m.score.max + '）'
    });
  }
  return a;
}

module.exports = { scoreSet, alarm, LIMITS, OPENING_N };

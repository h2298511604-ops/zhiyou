/* ============================================================
   确定性裁剪：从一个「内容最全」的事实库，裁出 4 个质量档

   为什么裁剪而不是生成 4 次：
   生成 4 次会引入随机性 —— 同一个专业的两份"普通档"简历长得不一样，
   前后两次评测就不可比。裁剪是纯函数，同样的输入永远同样的输出。
   ============================================================ */

/* 每档保留几段经历、每段几条 bullet。
   rich 档 = 种子全保留（种子本身就有几条 survived 就几条），
   其余档按固定形状裁。 */
const SHAPE = {
  rich:    { exps: 99, bulletsPer: [99, 99, 99], keepMetrics: true },
  normal:  { exps: 2, bulletsPer: [3, 2],       keepMetrics: true },
  thin:    { exps: 1, bulletsPer: [2],          keepMetrics: false },
  minimal: { exps: 1, bulletsPer: [1],          keepMetrics: false, stripMetrics: true }
};

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

/* 把 bullet 的 text 去数字：单薄档要模拟"没量化"的真实简历 */
function stripNumbers(text) {
  return String(text || '')
    .replace(/[0-9]+(\.[0-9]+)?%?/g, '')
    .replace(/[，,]{2,}/g, '，')
    .replace(/从\s*到\s*/, '从')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * @param {object} seed   完整事实库（含 personas）
 * @param {string} quality rich / normal / thin / minimal
 */
function trimFactBase(seed, quality) {
  const shape = SHAPE[quality];
  if (!shape) throw new Error('未知质量档：' + quality);

  const fb = clone(seed);
  const kept = [];
  const removedIds = new Set();

  const exps = (fb.experiences || []).slice(0, shape.exps);
  exps.forEach((e, i) => {
    const want = shape.bulletsPer[i] != null ? shape.bulletsPer[i] : shape.bulletsPer[shape.bulletsPer.length - 1];
    const bullets = (e.bullets || []).slice(0, want);
    const keptBullets = [];
    bullets.forEach((b) => {
      const nb = {
        id: b.id,
        text: shape.keepMetrics ? b.text : stripNumbers(b.text),
        metrics: shape.keepMetrics ? (b.metrics || []) : []
      };
      /* minimal：连技能标签都去掉，只留一句职责 */
      if (!shape.stripMetrics) {
        nb.skills = b.skills || [];
      }
      keptBullets.push(nb);
      kept.push(b.id);
    });
    e.bullets = keptBullets;
    e.metrics = shape.keepMetrics ? e.metrics : undefined;
    if (!e.bullets.length) removedIds.add(e.id);
  });

  (fb.experiences || []).slice(shape.exps).forEach((e) => {
    (e.bullets || []).forEach(b => removedIds.add(b.id));
  });

  fb.experiences = exps.filter(e => (e.bullets || []).length);

  /* 技能清单也跟着瘦身：没数字/极简档不该还挂着满屏技能 */
  if (!shape.keepMetrics) {
    fb.skills = (fb.skills || []).slice(0, Math.max(2, Math.ceil((fb.skills || []).length / 2)));
  }
  if (quality === 'minimal') {
    fb.skills = (fb.skills || []).slice(0, 2);
  }

  /* personas 的 bulletIds 要跟着清掉已删除的引用 */
  const alive = new Set();
  fb.experiences.forEach(e => (e.bullets || []).forEach(b => alive.add(b.id)));
  fb.personas = (fb.personas || []).map((p) => {
    const ids = (p.bulletIds || []).filter(id => alive.has(id));
    return Object.assign({}, p, { bulletIds: ids });
  }).filter(p => (p.bulletIds || []).length > 0);

  fb.meta = Object.assign({}, fb.meta, {
    __quality: quality,
    __bulletCount: alive.size,
    __personaCount: fb.personas.length
  });

  return fb;
}

module.exports = { trimFactBase, SHAPE };

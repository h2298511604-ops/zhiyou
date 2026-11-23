/* ============================================================
   变体矩阵：把「专业 × 质量 × 经历 × 对口度」压成可执行的用例

   全交叉 = 101 × 4 × 3 × 2 = 2424 份，跑不起也没必要。
   用拉丁方轮转压到每专业 4 份（共 404），保证：
     · 每个专业都覆盖 4 个质量档
     · 经历档与质量档的每种搭配都出现过
     · 每个专业至少有 1 份投对口岗、1 份投无关岗

   这不是"抽样"，是正交设计：二维组合全覆盖，只是不同时出现。
   ============================================================ */

const fs = require('fs');
const path = require('path');

const MAJORS = path.join(__dirname, 'fixtures', 'majors.json');

/* ---------- 维度定义 ---------- */

const QUALITY = [
  { id: 'rich',    label: '优秀', bullets: 4, hasMetrics: true,  desc: '3 段经历，每段 3–4 条 bullet，带量化数字' },
  { id: 'normal',  label: '普通', bullets: 3, hasMetrics: true,  desc: '2 段经历，每段 2–3 条，少量数字' },
  { id: 'thin',    label: '单薄', bullets: 2, hasMetrics: false, desc: '1 段经历，2 条 bullet，全是职责描述' },
  { id: 'minimal', label: '极简', bullets: 1, hasMetrics: false, desc: '只有岗位名和公司，几乎没有内容' }
];

const EXP = [
  { id: 'fresh', label: '应届无实习', years: 0, internships: 0 },
  { id: 'intern', label: '应届有实习', years: 0, internships: 1 },
  { id: 'work', label: '工作 1–2 年', years: 2, internships: 0 }
];

const FIT = [
  { id: 'matched',   label: '投对口岗', pick: 'own' },
  { id: 'unrelated', label: '投无关岗', pick: 'other' }
];

/* 非 IT 专业的原则上不该出现这些词；出现就是幻觉 */
const TECH_TERMS = ['Docker', 'Function Calling', 'LangChain', 'LangGraph', 'RAG', 'FastAPI', 'pytest', 'Kubernetes'];

/* ---------- 生成 ---------- */

function buildMatrix() {
  const data = JSON.parse(fs.readFileSync(MAJORS, 'utf8'));
  const all = [];
  let idx = 0;
  for (const g of data.majorGroups) {
    for (const m of g.majors) {
      all.push({ major: m.major, discipline: g.discipline, jobs: m.jobs, itAdjacent: !!m.itAdjacent, market: m.market });
    }
  }

  const cases = [];
  all.forEach((m, i) => {
    for (let q = 0; q < QUALITY.length; q++) {
      /* 拉丁方轮转：保证 (质量 × 经历) 与 (质量 × 对口) 的每种搭配都出现 */
      const exp = EXP[(i + q) % EXP.length];
      const fit = FIT[(i + q) % FIT.length];
      const quality = QUALITY[q];

      cases.push({
        id: 'syn-' + String(i).padStart(3, '0') + '-' + quality.id,
        major: m.major,
        discipline: m.discipline,
        market: m.market,
        jobs: m.jobs,
        itAdjacent: m.itAdjacent,
        quality: quality.id,
        qualityLabel: quality.label,
        exp: exp.id,
        expLabel: exp.label,
        fit: fit.id,
        fitLabel: fit.label,
        expect: {
          maxBullets: quality.bullets,
          hasMetrics: quality.hasMetrics,
          /* 非 IT 专业：话术里出现这些词即幻觉 */
          forbidTerms: m.itAdjacent ? [] : TECH_TERMS,
          /* 投无关岗时，匹配判定应该给出低分，而不是硬凑 */
          expectUnrelated: fit.id === 'unrelated'
        }
      });
    }
  });

  return { cases, majors: all, quality: QUALITY, exp: EXP, fit: FIT };
}

/* ---------- 覆盖率自检 ---------- */

function coverageReport(cases) {
  const majors = new Set(cases.map(c => c.major));
  const pairQExp = new Set(), pairQFit = new Set(), pairExpFit = new Set();
  const perMajor = new Map();

  for (const c of cases) {
    pairQExp.add(c.quality + '|' + c.exp);
    pairQFit.add(c.quality + '|' + c.fit);
    pairExpFit.add(c.exp + '|' + c.fit);
    if (!perMajor.has(c.major)) perMajor.set(c.major, new Set());
    perMajor.get(c.major).add(c.quality);
  }

  const missingQ = [];
  for (const q of QUALITY) for (const e of EXP) {
    if (!pairQExp.has(q.id + '|' + e.id)) missingQ.push(q.id + '×' + e.id);
  }
  const missingMic = [];
  for (const [m, qs] of perMajor) {
    if (qs.size !== QUALITY.length) missingMic.push(m + ' 只有 ' + qs.size + ' 个质量档');
  }

  return {
    majors: majors.size,
    cases: cases.length,
    qualityExpPairs: pairQExp.size + '/' + (QUALITY.length * EXP.length),
    qualityFitPairs: pairQFit.size + '/' + (QUALITY.length * FIT.length),
    expFitPairs: pairExpFit.size + '/' + (EXP.length * FIT.length),
    missingQ,
    missingMic
  };
}

module.exports = { buildMatrix, coverageReport, QUALITY, EXP, FIT, TECH_TERMS };

/* 直接运行：打印矩阵统计 */
if (require.main === module) {
  const { cases } = buildMatrix();
  const r = coverageReport(cases);
  console.log('变体矩阵');
  console.log('='.repeat(50));
  console.log('专业数量        ' + r.majors);
  console.log('用例总数        ' + r.cases + '（每专业 ' + QUALITY.length + ' 份）');
  console.log('');
  console.log('二维覆盖');
  console.log('  质量 × 经历   ' + r.qualityExpPairs);
  console.log('  质量 × 对口   ' + r.qualityFitPairs);
  console.log('  经历 × 对口   ' + r.expFitPairs);
  console.log('');
  console.log('分布');
  const by = (k) => {
    const m = {};
    cases.forEach(c => { m[c[k]] = (m[c[k]] || 0) + 1; });
    return Object.entries(m).map(([a, b]) => a + ' ' + b).join(' / ');
  };
  console.log('  质量  ' + by('quality'));
  console.log('  经历  ' + by('exp'));
  console.log('  对口  ' + by('fit'));
  console.log('');
  const bad = r.missingQ.length + r.missingMic.length;
  if (bad) {
    console.log('✗ 覆盖缺口：');
    r.missingQ.forEach(x => console.log('  缺组合 ' + x));
    r.missingMic.forEach(x => console.log('  ' + x));
    process.exit(1);
  } else {
    console.log('✓ 二维组合全覆盖，每个专业 4 个质量档齐全');
  }
}

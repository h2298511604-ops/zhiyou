/* ============================================================
   JD 索引：从原始数据集里，按专业的关键词召回「对口岗位」

   注意：这一步**不做清洗**。去重、城市归一化、截断处理由另一条线负责。
   这里只做一件事：给定专业关键词，捞出几条真实 JD 当测试输入。

   因为清洗是外包的，索引直接从原始 jsonl 扫（156k 条，扫一次约几秒），
   结果缓存到 eval/out/jd-index.json，后面反复用不用重扫。

   用法：
     node eval/lib/jdindex.js              建索引
     node eval/lib/jdindex.js --stats      看一下每个专业召回到几条
   ============================================================ */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..', '..');
/* 优先用清洗后的数据：有 majors 字段、去过重、城市已归一化 */
const CLEAN = path.join(ROOT, 'JD数据集', '清洗后的JD数据集', '中文JD数据_交接契约版.jsonl');
const RAW = path.join(ROOT, 'JD数据集', '中文JD数据_全量.jsonl');
const SRC = fs.existsSync(CLEAN) ? CLEAN : RAW;
const MAJORS = path.join(__dirname, '..', 'fixtures', 'majors.json');
const CACHE = path.join(__dirname, '..', 'out', 'jd-index.json');

const PER_MAJOR = 3;      /* 每个专业留几条 */
const PER_UNRELATED = 60; /* 无关岗位池 */
const PER_UNRELATED_CAT = 3;  /* 同一个 job_category 最多几条，保证跨类 */

function loadMajors() {
  const d = JSON.parse(fs.readFileSync(MAJORS, 'utf8'));
  const out = [];
  d.majorGroups.forEach(g => g.majors.forEach(m => out.push(Object.assign({ discipline: g.discipline }, m))));
  return out;
}

/* 关键词 → 专业 的倒排表，用于一遍扫描 */
function buildKeywordMap(majors) {
  const map = new Map();
  for (const m of majors) {
    for (const kw of m.jobs || []) {
      const k = kw.replace(/\s/g, '');
      if (k.length < 2) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(m.major);
    }
  }
  return map;
}

/* 岗位标题里出现的关键词 —— 只看标题，不看正文，
   否则「会计」会命中所有写了「与会计对账」的技术岗 */
function matchMajors(jobName, kwMap) {
  const t = String(jobName || '').replace(/\s/g, '');
  const hit = [];
  for (const [kw, majors] of kwMap) {
    if (t.indexOf(kw) >= 0) hit.push({ kw, majors });
  }
  return hit;
}

/* 用 JD 自带的 majors 字段匹配我们的 101 个专业。

   只认三种情况，且都要求从开头对齐：
     · 完全相同
     · JD 写的是我们的前缀（"会计" → "会计学"）
     · 我们的是 JD 的前缀（少见，但保留）

   不能用「包含」：JD 写「医学」会命中「中医学」，
   结果中医学被挂在「人事行政专员」下面。 */
function matchByMajorField(jdMajors, ourMajors) {
  const out = [];
  for (const raw of jdMajors || []) {
    const t = String(raw).replace(/\s/g, '').replace(/相关|类|等|专业/g, '');
    if (!t || t.length < 2) continue;
    for (const m of ourMajors) {
      const name = m.major;
      if (name === t) { out.push(name); continue; }
      if (name.indexOf(t) === 0) { out.push(name); continue; }   /* 会计 → 会计学 */
      if (t.indexOf(name) === 0) { out.push(name); continue; }   /* 会计学与技术 → 会计学 */
    }
  }
  return Array.from(new Set(out));
}

async function build() {
  if (!fs.existsSync(SRC)) {
    console.error('找不到数据：' + SRC);
    process.exit(1);
  }

  const majors = loadMajors();
  const kwMap = buildKeywordMap(majors);
  const usingClean = SRC === CLEAN;

  console.log('数据源 ' + path.basename(SRC) + (usingClean ? '（清洗后）' : '（原始）'));
  console.log('专业 ' + majors.length + ' 个，关键词 ' + kwMap.size + ' 个');
  console.log('扫描中…');

  const byMajor = new Map();
  const unrelated = [];
  let total = 0, matched = 0, skippedTrunc = 0, byField = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(SRC, 'utf8'),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    const s = line.trim();
    if (!s) continue;
    total++;

    let r;
    try { r = JSON.parse(s); } catch (e) { continue; }

    const jd = String(r.jd_text || '');
    if (jd.length < 120) continue;

    /* 疑似被截断的 JD 做缺口分析会误判，优先排除 */
    if (r.truncated_suspect === true) { skippedTrunc++; continue; }

    const jobName = r.job || r.job_name || '';
    const company = r.company || r.company_name || '';

    /* 优先用 majors 字段；没有才退回标题关键词 */
    let hits = [];
    if (Array.isArray(r.majors) && r.majors.length) {
      const names = matchByMajorField(r.majors, majors);
      if (names.length) { hits = names.map(n => ({ kw: 'majors', majors: [n] })); byField++; }
    }
    if (!hits.length) hits = matchMajors(jobName, kwMap);

    if (!hits.length) {
      /* 无关岗池：限制同类别数量，否则会全是客服/销售，测不出东西 */
      const cat = String(r.job_category || r.job_type || '').split(/[,，/]/)[0].trim();
      const catCount = unrelated.filter(x => x.cat === cat).length;
      if (unrelated.length < PER_UNRELATED && catCount < PER_UNRELATED_CAT) {
        unrelated.push({ job: jobName, company: company, city: r.city, jd: jd, cat: cat, source: r.source });
      }
      continue;
    }

    matched++;
    for (const h of hits) {
      for (const major of h.majors) {
        const list = byMajor.get(major) || [];
        if (list.length >= PER_MAJOR) continue;
        if (list.some(x => x.job === jobName && x.company === company)) continue;
        list.push({
          job: jobName,
          company: company,
          city: r.city,
          edu: r.edu,
          exp: r.exp_years != null ? r.exp_years + ' 年' : '',
          salary: (r.salary_low != null && r.salary_high != null) ? r.salary_low + '-' + r.salary_high + 'k' : '',
          kw: h.kw,
          majors: r.majors || [],
          jd: jd
        });
        byMajor.set(major, list);
      }
    }
  }

  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  const payload = {
    builtAt: new Date().toISOString(),
    source: path.basename(SRC),
    fromCleaned: usingClean,
    skippedTruncated: skippedTrunc,
    matchedByMajorField: byField,
    totalScanned: total,
    majorsWithJd: byMajor.size,
    perMajor: Object.fromEntries(Array.from(byMajor.entries()).sort()),
    unrelated
  };
  fs.writeFileSync(CACHE, JSON.stringify(payload, null, 1), 'utf8');

  console.log('');
  console.log('扫描 ' + total + ' 条，命中专业关键词 ' + matched + ' 条');
  console.log('覆盖专业 ' + byMajor.size + ' / ' + majors.length);
  console.log('无关岗位样本 ' + unrelated.length + ' 条');
  console.log('索引写入 ' + CACHE);

  /* 没召回的专业列出来 —— 这些专业在测试里会没有对口 JD */
  const missing = majors.filter(m => !byMajor.has(m.major)).map(m => m.major);
  if (missing.length) {
    console.log('');
    console.log('⚠️ 没召回到对口 JD 的专业 ' + missing.length + ' 个（会退化成"只测无关岗"）：');
    console.log('   ' + missing.slice(0, 30).join('、') + (missing.length > 30 ? ' …' : ''));
  }
}

if (require.main === module) {
  if (process.argv.indexOf('--stats') >= 0) {
    if (!fs.existsSync(CACHE)) { console.error('还没有索引，先跑 node eval/lib/jdindex.js'); process.exit(1); }
    const d = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    console.log('索引建于 ' + d.builtAt + '，来源 ' + d.source);
    console.log('覆盖 ' + d.majorsWithJd + ' 个专业，无关样本 ' + d.unrelated.length + ' 条');
    const entries = Object.entries(d.perMajor);
    console.log('');
    console.log('每个专业召回到的条数分布：');
    const dist = {};
    entries.forEach(([, v]) => { dist[v.length] = (dist[v.length] || 0) + 1; });
    Object.keys(dist).sort().forEach(k => console.log('  ' + k + ' 条：' + dist[k] + ' 个专业'));
    console.log('');
    console.log('示例：');
    entries.slice(0, 6).forEach(([m, v]) => {
      console.log('  ' + m + '：' + v.map(x => x.job.slice(0, 18)).join(' / '));
    });
  } else {
    build().catch(e => { console.error(e); process.exit(1); });
  }
}

module.exports = { build, loadMajors };

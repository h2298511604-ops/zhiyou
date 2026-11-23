/* ============================================================
   清洗后的 JD 数据验收

   按交接契约查四项（清洗由外部完成，这里只做验收）：
     1. 重复率      < 5%
     2. 硬截断      结尾无标点的比例，应被标记或清除
     3. 城市格式    统一到市级（不应出现 "北京-朝阳区"）
     4. 专业字段    覆盖率 ≥ 60%

   用法：node eval/verify-jd.js --file "JD数据集/清洗后的JD数据集/中文JD数据_交接契约版.jsonl"
   ============================================================ */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const FILE = path.resolve(ROOT, arg('file', 'JD数据集/清洗后的JD数据集/中文JD数据_交接契约版.jsonl'));
const LIMIT = parseInt(arg('limit', '0'), 10);

const out = [];
const w = (s) => out.push(s == null ? '' : s);

function normCity(c) {
  return String(c || '').split('-')[0].trim();
}

async function main() {
  if (!fs.existsSync(FILE)) {
    console.error('找不到文件：' + FILE);
    process.exit(1);
  }

  const rl = readline.createInterface({ input: fs.createReadStream(FILE, 'utf8'), crlfDelay: Infinity });

  let n = 0, bad = 0;
  const keys = new Map();
  const seen = new Map();
  let dup = 0;
  let tailBad = 0, emptyText = 0, shortText = 0;
  const lens = [];
  const cityBad = [];
  const eduCount = new Map(), expCount = new Map(), cityCount = new Map(), srcCount = new Map();
  let hasMajors = 0, majorsEmpty = 0, majorsTotal = 0;
  const majorCount = new Map();
  const samples = [];

  for await (const line of rl) {
    const s = line.trim();
    if (!s) continue;
    n++;
    if (LIMIT && n > LIMIT) break;

    let r;
    try { r = JSON.parse(s); } catch (e) { bad++; continue; }

    for (const k of Object.keys(r)) keys.set(k, (keys.get(k) || 0) + 1);
    if (samples.length < 2) samples.push(r);

    const jd = String(r.jd_text || r.jd || r.text || '');
    if (!jd) { emptyText++; continue; }
    lens.push(jd.length);
    if (jd.length < 100) shortText++;
    if (jd && '。.!！；;）)】"』」'.indexOf(jd[jd.length - 1]) < 0) tailBad++;

    /* 重复指纹：公司 + 岗位 + 正文前 120 字 */
    const fp = crypto.createHash('sha1')
      .update(String(r.company || r.company_name || '').replace(/\s/g, '') + '|' +
              String(r.job || r.job_name || '').replace(/\s/g, '') + '|' + jd.slice(0, 120))
      .digest('hex');
    if (seen.has(fp)) dup++;
    else seen.set(fp, 1);

    const city = String(r.city || '');
    if (city.indexOf('-') >= 0 && city.indexOf('-') !== city.length - 1) {
      if (cityBad.length < 5) cityBad.push(city);
    }
    cityCount.set(normCity(city), (cityCount.get(normCity(city)) || 0) + 1);
    if (r.edu) eduCount.set(r.edu, (eduCount.get(r.edu) || 0) + 1);
    if (r.exp_years != null) expCount.set(String(r.exp_years), (expCount.get(String(r.exp_years)) || 0) + 1);
    if (r.source) srcCount.set(r.source, (srcCount.get(r.source) || 0) + 1);

    const majors = r.majors;
    if (Array.isArray(majors)) {
      hasMajors++;
      if (!majors.length) majorsEmpty++;
      majors.forEach(m => majorCount.set(m, (majorCount.get(m) || 0) + 1));
      majorsTotal += majors.length;
    } else if (majors != null) {
      hasMajors++;
      if (!String(majors).trim()) majorsEmpty++;
    }
  }

  lens.sort((a, b) => a - b);
  const p = (q) => lens.length ? lens[Math.floor(lens.length * q)] : 0;

  w('清洗后 JD 数据验收');
  w('='.repeat(56));
  w('文件 ' + path.basename(FILE) + '  ' + (fs.statSync(FILE).size / 1024 / 1024).toFixed(1) + ' MB');
  w('记录 ' + n + '，解析失败 ' + bad);
  w('');
  w('字段 ' + Array.from(keys.keys()).join(', '));
  w('');

  const rate = (x) => (x * 100 / Math.max(1, n)).toFixed(2) + '%';
  const verdict = (ok, good, bad_) => ok ? '✓ ' + good : '✗ ' + bad_;

  w('=== 契约四项 ===');
  const dupPct = dup * 100 / Math.max(1, n);
  w('  ① 重复率        ' + rate(dup) + '   ' + verdict(dupPct < 5, '达标（<5%）', '超标（要求 <5%）'));

  const tailPct = tailBad * 100 / Math.max(1, lens.length);
  w('  ② 截断比例      ' + tailPct.toFixed(1) + '%   ' +
    verdict(tailPct < 10, '达标', '偏高，需确认是否已标记'));

  w('  ③ 城市格式      ' + (cityBad.length ? '有 ' + cityBad.length + ' 例带区级：' + cityBad.join('、') : '统一到市级') +
    '   ' + verdict(cityBad.length === 0, '', '未归一化'));

  const majorPct = hasMajors * 100 / Math.max(1, n);
  const majorNonEmpty = hasMajors - majorsEmpty;
  w('  ④ 专业字段      有字段 ' + majorPct.toFixed(1) + '%，非空 ' +
    (majorNonEmpty * 100 / Math.max(1, n)).toFixed(1) + '%，平均 ' +
    (majorsTotal / Math.max(1, hasMajors)).toFixed(1) + ' 个/条   ' +
    verdict(majorNonEmpty * 100 / Math.max(1, n) >= 60, '达标（≥60%）', '覆盖不足'));
  w('');

  w('=== 文本质量 ===');
  w('  空文本     ' + emptyText);
  w('  <100 字    ' + shortText + '  (' + rate(shortText) + ')');
  w('  长度       min ' + (lens[0] || 0) + ' / p10 ' + p(0.1) + ' / 中位 ' + p(0.5) +
    ' / p90 ' + p(0.9) + ' / max ' + (lens[lens.length - 1] || 0));
  w('');

  const top = (m, k) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, k);
  w('=== 分布 ===');
  w('  来源    ' + top(srcCount, 5).map(x => x[0] + ' ' + x[1]).join(' / '));
  w('  城市    ' + top(cityCount, 8).map(x => x[0] + ' ' + x[1]).join(' / '));
  w('  学历    ' + top(eduCount, 6).map(x => x[0] + ' ' + x[1]).join(' / '));
  if (majorCount.size) {
    w('  专业 top15 ' + top(majorCount, 15).map(x => x[0] + '(' + x[1] + ')').join(' / '));
  }
  w('');

  w('=== 前 2 条样例（截断显示）===');
  samples.forEach((r, i) => {
    w('--- ' + (i + 1) + ' ---');
    Object.keys(r).forEach((k) => {
      const v = Array.isArray(r[k]) ? '[' + r[k].slice(0, 5).join('、') + ']' : String(r[k]).replace(/\s+/g, ' ');
      w('  ' + k.padEnd(16) + ' ' + String(v).slice(0, 160));
    });
    w('');
  });

  const text = out.join('\n');
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'out', 'verify-jd.txt'), text, 'utf8');
  console.log(text);
  console.log('\n写入 eval/out/verify-jd.txt');
}

main().catch(e => { console.error(e); process.exit(1); });

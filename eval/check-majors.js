/* 校验专业清单：结构、重复、覆盖率、市场分布 */
const fs = require('fs');
const path = require('path');

const F = path.join(__dirname, 'fixtures', 'majors.json');
const data = JSON.parse(fs.readFileSync(F, 'utf8'));
const groups = data.majorGroups || [];

let total = 0;
const seen = new Map();
const market = { large: 0, medium: 0, small: 0 };
let itAdj = 0;
const problems = [];

for (const g of groups) {
  if (!g.discipline) problems.push('有分组缺少 discipline');
  if (!g.majors || !g.majors.length) problems.push(g.discipline + ' 没有专业');
  for (const m of g.majors || []) {
    total++;
    if (seen.has(m.major)) problems.push('重复专业：' + m.major + '（' + seen.get(m.major) + ' 与 ' + g.discipline + '）');
    seen.set(m.major, g.discipline);
    if (!/^[\u4e00-\u9fa5A-Za-z]+$/.test(m.major)) problems.push('专业名含异常字符：' + m.major);
    if (!Array.isArray(m.jobs) || m.jobs.length < 2) problems.push(m.major + ' 的 jobs 少于 2 个');
    if (!market.hasOwnProperty(m.market)) problems.push(m.major + ' 的 market 取值非法：' + m.market);
    else market[m.market]++;
    if (m.itAdjacent) itAdj++;
  }
}

const line = (s) => console.log(s == null ? '' : s);
line('专业清单校验');
line('='.repeat(50));
line('学科门类   ' + groups.length);
line('专业总数   ' + total);
line('');
line('门类分布');
groups.forEach((g) => {
  line('  ' + g.discipline.padEnd(10, '　') + String(g.majors.length).padStart(3) + ' 个   ' +
    g.majors.slice(0, 3).map(m => m.major).join('、') + (g.majors.length > 3 ? '…' : ''));
});
line('');
line('市场体量  large ' + market.large + ' / medium ' + market.medium + ' / small ' + market.small);
line('常进 IT   ' + itAdj + ' 个（用来构造"专业不对口"场景）');
line('');
if (problems.length) {
  line('问题 ' + problems.length + ' 处：');
  problems.forEach(p => line('  ✗ ' + p));
  process.exit(1);
} else {
  line('✓ 结构完整，无重复，无缺失字段');
}

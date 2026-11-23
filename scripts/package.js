/* ============================================================
   打包：只把「扩展运行需要的文件」拷到 dist/extension/

   跑法：node scripts/package.js
   产物：dist/extension/  —— 可直接「加载已解压的扩展程序」，
         也是压缩上传商店的那份内容（压成 zip 即可）。

   为什么要白名单而不是整目录打包：
   仓库根目录里还有 eval/（评测夹具与历史结果）、dev/（测试页）、
   docs/（README 截图）、tests/、以及本机的 resume-work/ 和个人数据。
   整目录 cp 会把这些一起发出去，简历泄漏就发生在这一步。

   白名单之外一律不拷；拷完再自查两遍：
     ① manifest.json 引用的文件必须齐全
     ② 不该进包的东西一个都不能有
   任何一条不满足直接非零退出。
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'extension');

const FILES = ['manifest.json', 'background.js', 'content.js'];
const DIRS = ['web', 'icons'];

/* 兜底：就算上面白名单写错，这些也不许出现在产物里 */
const FORBIDDEN = [
  /^eval\//, /^tests\//, /^dev\//, /^docs\//, /^scripts\//,
  /^JD数据集\//, /^resume-work\//,
  /(^|\/)\.env(\.local)?$/, /\.pdf$/i, /^factbase.*\.json$/, /^README\.md$/, /^server\.py$/, /^start\.bat$/
];

function copyFile(rel) {
  const from = path.join(ROOT, rel);
  if (!fs.existsSync(from)) throw new Error('缺文件：' + rel);
  const to = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return { rel, size: fs.statSync(to).size };
}

function copyTree(prefix) {
  const src = path.join(ROOT, prefix);
  if (!fs.existsSync(src)) throw new Error('缺目录：' + prefix);
  const out = [];
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const rel = prefix + '/' + ent.name;
    if (ent.isDirectory()) out.push(...copyTree(rel));
    else out.push(copyFile(rel));
  }
  return out;
}

function manifestRefs(mf) {
  const refs = [];
  if (mf.background && mf.background.service_worker) refs.push(mf.background.service_worker);
  if (mf.side_panel && mf.side_panel.default_path) refs.push(mf.side_panel.default_path);
  for (const cs of mf.content_scripts || []) refs.push(...(cs.js || []), ...(cs.css || []));
  refs.push(...Object.values(mf.icons || {}));
  const di = mf.action && mf.action.default_icon;
  if (di) refs.push(...(typeof di === 'string' ? [di] : Object.values(di)));
  return [...new Set(refs)];
}

function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  const copied = [];
  for (const f of FILES) copied.push(copyFile(f));
  for (const d of DIRS) copied.push(...copyTree(d));

  const have = new Set(copied.map(f => f.rel));

  const mf = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf8'));
  const missing = manifestRefs(mf).filter(r => !have.has(r));
  if (missing.length) {
    console.error('✗ manifest 引用了但包里没有：\n  ' + missing.join('\n  '));
    process.exit(1);
  }

  const bad = copied.filter(f => FORBIDDEN.some(re => re.test(f.rel))).map(f => f.rel);
  if (bad.length) {
    console.error('✗ 这些文件不该进包：\n  ' + bad.join('\n  '));
    process.exit(1);
  }

  const total = copied.reduce((s, f) => s + f.size, 0);
  const mb = (total / 1024 / 1024).toFixed(2);
  console.log('✓ dist/extension/  ' + copied.length + ' 个文件，' + mb + ' MB');
  console.log('  装：chrome://extensions → 加载已解压的扩展程序 → 选 dist/extension');
  console.log('  传：把 dist/extension 里的内容压成 zip');
}

try {
  main();
} catch (e) {
  console.error('✗ ' + e.message);
  process.exit(1);
}

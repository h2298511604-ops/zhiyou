/* 文本相似度工具 —— eval 项目自用，不从插件里取 */

function norm(s) {
  return String(s == null ? '' : s)
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')
    .toLowerCase();
}

function bigrams(s) {
  const t = norm(s);
  const out = [];
  for (let i = 0; i + 2 <= t.length; i++) out.push(t.substr(i, 2));
  return out;
}

/* a 的二字片段有多少比例出现在 b 里 */
function overlap(a, b) {
  const t = norm(a);
  const target = norm(b);
  if (t.length < 4) return 1;
  const gs = bigrams(t);
  if (!gs.length) return 1;
  let hit = 0;
  for (const g of gs) if (target.indexOf(g) >= 0) hit++;
  return hit / gs.length;
}

/* 最长公共子串长度（两条都短，DP 足够） */
function lcs(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  const m = x.length;
  const n = y.length;
  let best = 0;
  let prev = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1).fill(0);
    for (let j = 1; j <= n; j++) {
      if (x[i - 1] === y[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}

/* 取开头的「第一个分句」—— 到第一个逗号/句号为止，再截到 n 字。
   只取固定字数会把「熟悉Python，能独立实现Agent框架」和
   「熟悉Python与Docker，能独立部署服务」算成同一个开头，而它们是两种话术。 */
function opening(text, n) {
  const s = String(text || '').replace(/\s/g, '');
  const m = s.match(/^[^，。；、,;:：]{2,}/);
  const phrase = m ? m[0] : s;
  return phrase.slice(0, n || 12);
}

function len(text) {
  return String(text || '').replace(/\s/g, '').length;
}

/* 香农熵（以 2 为底），用来衡量开头词分散程度 */
function entropy(counts) {
  const total = counts.reduce((s, x) => s + x, 0);
  if (!total) return 0;
  let h = 0;
  for (const c of counts) {
    if (!c) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

module.exports = { norm, bigrams, overlap, lcs, opening, len, entropy };

/* ============================================================
   内容脚本：识别当前岗位 JD + 注入页内悬浮入口
   ------------------------------------------------------------
   设计原则：
   1. 不依赖单一站点类名（改版就崩）—— 用「关键词 + 文本密度」通用算法兜底
   2. 站点专用选择器只作为第一优先，失败立刻降级到通用算法
   3. 不认识就不显示，绝不误伤用户在看的页面
   ============================================================ */

(() => {
  'use strict';

  /* ---------------- 挂载控制器（带版本号，可被替换） ----------------
     旧版用永久布尔哨兵 window.__TQ30S_LOADED__：一旦为 true，新版脚本会在
     清理旧 DOM 之前直接退出，招聘页上就永远留着旧悬浮球。
     现在改成带版本号的控制器：同版本重复注入直接返回；版本不同则先 dispose，
     再挂载新实例，旧节点/计时器/监听器一并回收。 */
  const MOUNT_KEY = '__TQ30S_MOUNT__';
  const SCRIPT_VERSION = '1.1.0';
  const previousMount = window[MOUNT_KEY];
  if (previousMount && previousMount.version === SCRIPT_VERSION && typeof previousMount.dispose === 'function') return;
  if (previousMount && typeof previousMount.dispose === 'function') {
    try { previousMount.dispose(); } catch (e) { /* 旧实例清理失败不阻塞升级 */ }
  }
  try { delete window.__TQ30S_LOADED__; } catch (e) { window.__TQ30S_LOADED__ = false; }
  try {
    const legacyHost = document.getElementById('__tq30s_host__');
    if (legacyHost) legacyHost.remove();
  } catch (e) { /* ignore */ }

  /* ---------------- 站点配置（尽力而为，随时会变） ---------------- */

  const SITES = [
    {
      re: /(^|\.)zhipin\.com$/, name: 'BOSS直聘',
      detail: /job_detail|job_detail\.html|\/web\/geek\/job_detail/i,
      sel: [
        '.job-sec-text',
        '[class*="job-sec-text"]',
        '.job-detail-section .job-sec-text',
        '.job-sec .text',
        '.job-detail .text',
        '[class*="job-detail"] [class*="text"]'
      ]
    },
    {
      re: /(^|\.)liepin\.com$/, name: '猎聘',
      detail: /\/job\/|jobdetail/i,
      sel: ['.job-intro-container', '.job-description', '.job-detail-box']
    },
    {
      re: /(^|\.)lagou\.com$/, name: '拉勾',
      detail: /\/jobs\/\d+/i,
      sel: ['.job_bt', '.job-detail', '.position-content']
    },
    {
      re: /(^|\.)zhaopin\.com$/, name: '智联招聘',
      detail: /jobdetail|\/job\/\d+/i,
      sel: ['.describtion__detail-content', '.describtion', '.job-description']
    },
    {
      re: /(^|\.)51job\.com$/, name: '前程无忧',
      detail: /jobdetail|\/job\//i,
      sel: ['.job_msg', '.bmsg', '.job-detail']
    }
  ];

  const KW = [
    '岗位职责', '职位描述', '工作职责', '岗位描述', '职责描述',
    '任职要求', '任职资格', '岗位要求', '职位要求', '工作内容',
    '我们希望你', '你将负责', '你需要具备', '加分项'
  ];

  /* ---------------- 工具 ---------------- */

  function siteOf(host) {
    return SITES.find((s) => s.re.test(host)) || null;
  }

  function countKw(text) {
    let n = 0;
    for (let i = 0; i < KW.length; i++) {
      if (text.indexOf(KW[i]) >= 0) n++;
    }
    return n;
  }

  /* 元素当前是否真的显示给用户：隐藏的旧岗位/推荐位不能混进当前 JD */
  function isVisible(el) {
    if (!el || el.hidden) return false;
    try {
      if (el.getClientRects && el.getClientRects().length === 0) return false;
      const st = window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (st && (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0')) return false;
    } catch (e) { /* 拿不到样式就按可见处理，不要误杀 */ }
    return true;
  }

  /* 正文指纹：字数相同、内容不同也算变化（只比 length 会漏掉等长改动） */
  function textHash(text) {
    const s = String(text || '');
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + ':' + s.length;
  }

  function clean(s) {
    return String(s || '')
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  /* ---------------- 通用算法：找「最紧的那个 JD 容器」 ---------------- */

  function keywordNodes() {
    const expr = KW.map((w) => "contains(text(),'" + w + "')").join(' or ');
    const xp = '//*[' + expr + ']';
    let snap = null;
    try {
      snap = document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    } catch (e) {
      return [];
    }
    const out = [];
    const n = Math.min(snap.snapshotLength, 40);
    for (let i = 0; i < n; i++) out.push(snap.snapshotItem(i));
    return out;
  }

  function tightContainer(start) {
    let el = start;
    let best = null;
    for (let i = 0; i < 8 && el && el !== document.body; i++) {
      const t = el.textContent || '';
      const len = t.length;
      if (len > 12000) break;
      /* 只要命中 1 个关键词就算候选 —— 很多 JD 只有「职位描述」一个标题 */
      if (len >= 200 && countKw(t) >= 1) best = el;
      el = el.parentElement;
    }
    return best;
  }

  function trimIn(el) {
    let cur = el;
    for (let depth = 0; depth < 6; depth++) {
      const total = (cur.textContent || '').length;
      if (!total) break;
      let next = null;
      const kids = cur.children;
      for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        const l = (c.textContent || '').length;
        if (l >= total * 0.85 && l >= 200 && countKw(c.textContent || '') >= 1) {
          next = c;
          break;
        }
      }
      if (!next) break;
      cur = next;
    }
    return cur;
  }

  function genericFind() {
    const nodes = keywordNodes();
    let best = null;
    let bestScore = -1;
    for (const n of nodes) {
      const box = tightContainer(n);
      if (!box || !isVisible(box)) continue;
      const t = box.textContent || '';
      /* 关键词命中越多越可信；同样多的时候取更"完整"的那块 */
      const score = countKw(t) * 10000 + Math.min(t.length, 8000);
      if (score > bestScore) { bestScore = score; best = box; }
    }
    return best ? trimIn(best) : null;
  }

  /* 最后一层兜底：不靠关键词，只靠类名里带 job-detail / job-sec 的容器 */
  function classFallback() {
    const sels = [
      '[class*="job-detail"]', '[class*="job_detail"]', '[class*="job-sec"]',
      '[class*="jobdesc"]', '[class*="job-desc"]', '[class*="job-require"]'
    ];
    let best = null;
    let bestLen = 0;
    for (const s of sels) {
      let els = [];
      try { els = document.querySelectorAll(s); } catch (e) { continue; }
      for (const el of els) {
        if (!isVisible(el)) continue;
        const t = el.textContent || '';
        if (t.length < 150 || t.length > 8000) continue;
        if (t.length > bestLen) { bestLen = t.length; best = el; }
      }
    }
    return best;
  }

  /* 同一份 JD 常被拆成多个块，但页面里也可能同时挂着推荐位/相似岗位里的同名块。
     所以先确定「当前详情容器」，只在这一个容器内合并。 */
  let lastDetailContainer = null;
  const RECOMMEND_RE = /(recommend|similar|related|guess|like-job|hot-job|job-list|card-list)/i;

  function classOf(el) {
    return el && typeof el.className === 'string' ? el.className : '';
  }

  function detailContainerOf(el) {
    let cur = el;
    for (let depth = 0; depth < 6 && cur && cur !== document.body; depth++) {
      if (cur.tagName === 'SECTION' || /job-detail|job_detail|job-sec|detail/i.test(classOf(cur))) return cur;
      cur = cur.parentElement;
    }
    return (el && el.parentElement) || el;
  }

  function inRecommendation(el) {
    let cur = el;
    for (let depth = 0; depth < 5 && cur && cur !== document.body; depth++) {
      if (RECOMMEND_RE.test(classOf(cur))) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  function isDetailLike(el) {
    let cur = el;
    for (let depth = 0; depth < 6 && cur && cur !== document.body; depth++) {
      if (/job-detail|job_detail|job-sec|jobdesc|job-desc/i.test(classOf(cur))) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  function bySelector(site) {
    if (!site) return null;
    for (const s of site.sel) {
      let els = [];
      try { els = document.querySelectorAll(s); } catch (e) { continue; }
      const usable = [];
      for (const el of els) {
        /* 隐藏的旧岗位、推荐位里的同名块都不算当前 JD */
        if (!isVisible(el) || inRecommendation(el)) continue;
        const t = clean(el.innerText || el.textContent || '');
        if (t) usable.push({ el, text: t });
      }
      if (!usable.length) continue;

      /* 按「所属详情容器」分组，只在最像当前详情的那一组里合并 */
      const groups = new Map();
      for (const item of usable) {
        const box = detailContainerOf(item.el);
        if (!groups.has(box)) groups.set(box, []);
        groups.get(box).push(item);
      }
      let best = null;
      for (const [box, items] of groups) {
        const merged = items.map(i => i.text).join('\n\n');
        const score = countKw(merged) * 10000 + Math.min(merged.length, 8000) + (isDetailLike(box) ? 5000 : 0);
        if (!best || score > best.score) best = { box, merged, score };
      }
      if (best && best.merged.length >= 150 && countKw(best.merged) >= 1) {
        lastDetailContainer = best.box;
        return best.merged;
      }
    }
    return null;
  }

  /* ---------------- 标题 / 公司 ---------------- */

  const NOISE_TITLE = /(招聘|人才网|找工作|求职|直聘|猎聘|拉勾|智联|前程无忧|首页)/;

  /* 标题必须和正文来自同一块当前详情，且必须真的可见：
     页面上留着 hidden 的旧岗位标题时，不能把它当成当前岗位。 */
  function pageTitle(container) {
    const usable = (t) => t.length >= 2 && t.length <= 40 && !NOISE_TITLE.test(t);
    let heads = [];
    try {
      heads = Array.prototype.slice.call(
        document.querySelectorAll('h1, h2, [class*="job-title"], [class*="jobTitle"], [class*="job-name"]')
      );
    } catch (e) { heads = []; }

    const visible = heads.filter((h) => isVisible(h) && !inRecommendation(h));
    const inside = container ? visible.filter((h) => container.contains(h)) : [];
    for (const h of inside.concat(visible)) {
      const t = clean(h.innerText || h.textContent || '');
      if (usable(t)) return t;
    }

    const raw = document.title || '';
    const parts = raw.split(/[-_|｜—–]/).map((s) => s.trim()).filter(Boolean);
    const pick = parts.find((p) => usable(p));
    return pick || clean(raw).slice(0, 40);
  }

  function pageCompany(container) {
    const cands = [
      '.company-info .name', '.company-info h3', '.company-name',
      '.company-title', '.com-name', '[class*="companyName"]'
    ];
    const collect = () => {
      const out = [];
      for (const s of cands) {
        let els = [];
        try { els = document.querySelectorAll(s); } catch (e) { continue; }
        for (const el of els) out.push(el);
      }
      return out;
    };
    const all = collect().filter((el) => isVisible(el) && !inRecommendation(el));
    const scoped = container ? all.filter((el) => container.contains(el)) : [];
    for (const el of scoped.concat(all)) {
      const t = clean(el.innerText || el.textContent || '');
      if (t.length >= 2 && t.length <= 40) return t;
    }
    return '';
  }

  /* ---------------- 主提取 ---------------- */

  let lastKey = '';

  function extract() {
    const host = location.hostname;
    const site = siteOf(host);

    /* 不认识的站点也要试通用算法 —— 关键词 + 文本密度本来就是站点无关的。
       以前这里直接 return null，导致鱼泡、实习僧、牛客这类站点永远拿不到 JD。
       安全性由下面的长度门槛和 genericFind 的关键词命中来保证。 */

    let text = site ? bySelector(site) : '';
    let from = site ? 'selector' : 'generic';

    if (!text || text.length < 150) {
      const box = genericFind() || classFallback();
      if (box) {
        text = clean(box.innerText || box.textContent || '');
        lastDetailContainer = box;
        from = 'generic';
      }
    }

    if (!text || text.length < 150) return null;

    const urlDetail = site ? site.detail.test(location.pathname + location.search) : false;
    if (!urlDetail && text.length < 500) return null;

    const title = pageTitle(lastDetailContainer);
    const company = pageCompany(lastDetailContainer);

    const head = [title, company].filter(Boolean).join(' · ');
    const full = (head ? head + '\n\n' : '') + text;

    return {
      site: site ? site.name : host,
      url: location.href,
      title: title,
      company: company,
      text: full.slice(0, 8000),
      length: full.length,
      from: from
    };
  }

  /* ---------------- 悬浮入口 ---------------- */

  const HOST_ID = '__tq30s_host__';

  const SHADOW_CSS = `
    :host { all: initial; }
    .wrap {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
                   "Microsoft YaHei", sans-serif;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px;
      border-radius: 999px;
      background: rgba(20, 26, 27, .93);
      border: 1px solid rgba(175, 200, 204, .35);
      box-shadow: 0 6px 24px rgba(0, 0, 0, .35);
      backdrop-filter: blur(10px);
      transition: transform .16s ease, box-shadow .16s ease;
      cursor: pointer;
      user-select: none;
    }
    .wrap:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 30px rgba(0, 0, 0, .45);
    }
    .logo {
      width: 26px; height: 26px;
      display: grid; place-items: center; flex: none;
    }
    .logo svg { display: block; border-radius: 7px; }
    .txt {
      color: #eef2f2; font-size: 12.5px; font-weight: 600;
      padding-right: 6px; white-space: nowrap; letter-spacing: .2px;
    }
    .dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: #6b7484; flex: none; margin-right: 1px;
    }
    .dot.ok { background: #46d399; box-shadow: 0 0 8px #46d399; }
    .wrap.ready { border-color: rgba(63, 104, 117, .75); }
  `;

  let fabHost = null;
  let lastJD = null;

  function ensureFab() {
    if (fabHost && fabHost.isConnected) return fabHost;
    const old = document.getElementById(HOST_ID);
    if (old) old.remove();

    fabHost = document.createElement('div');
    fabHost.id = HOST_ID;
    fabHost.style.cssText = 'position:fixed;right:20px;bottom:110px;z-index:2147483000;';
    document.documentElement.appendChild(fabHost);

    const root = fabHost.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' + SHADOW_CSS + '</style>' +
      '<div class="wrap" role="button" tabindex="0" title="打开 / 收起职友侧边栏">' +
        '<span class="logo" aria-hidden="true">' +
          '<svg viewBox="0 0 32 32" width="26" height="26">' +
            '<rect width="32" height="32" rx="8" fill="#3F6875"/>' +
            '<path d="M10 6.5h7a5 5 0 0 1 5 5v6H10.5L6 21V10.5a4 4 0 0 1 4-4Z" fill="#AFC8CC"/>' +
            '<path d="M18 12.5h4a4 4 0 0 1 4 4V26l-4.5-3.5H17a5 5 0 0 1-5-5v-5Z" fill="#F5FAF8"/>' +
            '<path d="M15 12.5h7v3h-7a1.5 1.5 0 0 1 0-3Z" fill="#3F6875"/>' +
          '</svg>' +
        '</span>' +
        '<span class="txt">职友</span>' +
        '<span class="dot"></span>' +
      '</div>';

    const wrap = root.querySelector('.wrap');
    const fire = () => {
      try {
        chrome.runtime.sendMessage({ type: 'OPEN_PANEL', jd: lastJD }, () => {
          void chrome.runtime.lastError;
        });
      } catch (e) { /* 扩展被重载时会抛，忽略 */ }
    };
    wrap.addEventListener('click', fire);
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); }
    });

    return fabHost;
  }

  function setFabState(hasJD, hint) {
    const host = ensureFab();
    const root = host.shadowRoot;
    if (!root) return;
    const wrap = root.querySelector('.wrap');
    const dot = root.querySelector('.dot');
    const txt = root.querySelector('.txt');
    if (!wrap || !dot || !txt) return;
    wrap.classList.toggle('ready', !!hasJD);
    dot.classList.toggle('ok', !!hasJD);
    txt.textContent = hasJD ? '职友' : '未识别岗位';
    wrap.title = hint || (hasJD ? '已识别 JD，点击打开 / 收起侧边栏' : '没识别到 JD，点开还能手动粘贴');
  }

  function hideFab() {
    if (fabHost && fabHost.isConnected) fabHost.style.display = 'none';
  }

  /* 是不是"某个岗位的详情"：URL 命 或 DOM 里有详情容器（BOSS 的列表页右侧就是详情） */
  function looksLikeDetail(site) {
    if (!site) return false;
    if (site.detail.test(location.pathname + location.search)) return true;
    try {
      return !!document.querySelector(
        '[class*="job-detail"], [class*="job_detail"], [class*="job-sec"], [class*="jobdesc"]'
      );
    } catch (e) {
      return false;
    }
  }

  /* ---------------- 刷新循环 ---------------- */

  let extractTimer = null;

  function refresh() {
    let jd = null;
    try { jd = extract(); } catch (e) { jd = null; }

    const key = jd ? (textHash(jd.text) + '|' + (jd.title || '') + '|' + (jd.company || '')) : '__none__';
    const changed = key !== lastKey;
    const hadJd = lastKey !== '' && lastKey !== '__none__';
    lastKey = key;

    if (!jd) {
      lastJD = null;
      const site = siteOf(location.hostname);
      if (looksLikeDetail(site)) {
        setFabState(false, '没识别到 JD，点开手动粘贴也行');
      } else {
        hideFab();
      }
      /* 告诉面板：这个页面没识别到（之前有的话要清掉提示） */
      if (changed && hadJd && chrome.runtime && chrome.runtime.id) {
        try {
          chrome.runtime.sendMessage({ type: 'JD_CHANGED', jd: null }, () => {
            void chrome.runtime.lastError;
          });
        } catch (e) { /* ignore */ }
      }
      return;
    }

    lastJD = jd;
    setFabState(true, '已识别：' + (jd.title || jd.site) + '（' + jd.length + ' 字）');
    if (changed && chrome.runtime && chrome.runtime.id) {
      try {
        chrome.runtime.sendMessage({ type: 'JD_CHANGED', jd: jd }, () => {
          void chrome.runtime.lastError;
        });
      } catch (e) { /* ignore */ }
    }
  }

  function schedule(delay) {
    clearTimeout(extractTimer);
    extractTimer = setTimeout(refresh, delay == null ? 600 : delay);
  }

  /* ---------------- SPA 路由监听 ---------------- */

  function watchHistory() {
    const wrap = (name) => {
      const orig = history[name];
      if (!orig || orig.__tq30s) return;
      const patched = function () {
        const r = orig.apply(this, arguments);
        schedule(500);
        return r;
      };
      patched.__tq30s = true;
      history[name] = patched;
    };
    wrap('pushState');
    wrap('replaceState');
    popstateHandler = () => schedule(400);
    window.addEventListener('popstate', popstateHandler);
  }

  let lastHref = location.href;
  let tickTimer = null;
  let mutationObserver = null;
  let popstateHandler = null;
  tickTimer = setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      schedule(400);
    }
    // 页面把我们的按钮删了（React 重渲染）就补回来
    if (fabHost && !fabHost.isConnected) {
      fabHost = null;
      schedule(200);
    }
  }, 1000);

  function start() {
    watchHistory();
    schedule(800);

    let mutTimer = null;
    mutationObserver = new MutationObserver(() => {
      clearTimeout(mutTimer);
      mutTimer = setTimeout(refresh, 1200);
    });
    try {
      mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) { /* ignore */ }
  }

  /* 把这一实例持有的东西全部交回去，供下一个版本接管 */
  function dispose() {
    clearTimeout(extractTimer);
    if (tickTimer) clearInterval(tickTimer);
    if (mutationObserver) {
      try { mutationObserver.disconnect(); } catch (e) { /* ignore */ }
      mutationObserver = null;
    }
    if (popstateHandler) {
      try { window.removeEventListener('popstate', popstateHandler); } catch (e) { /* ignore */ }
      popstateHandler = null;
    }
    if (fabHost && fabHost.isConnected) {
      try { fabHost.remove(); } catch (e) { /* ignore */ }
    }
    fabHost = null;
  }

  window[MOUNT_KEY] = { version: SCRIPT_VERSION, dispose };

  /* ---------------- 诊断：识别失败时告诉调用方为什么 ---------------- */

  function diagnose() {
    const out = { kw: 0, bestLen: 0, bestKw: 0, selHit: 0, url: '', title: '' };
    try { out.url = location.pathname.slice(0, 90); } catch (e) { /* ignore */ }
    try { out.title = String(document.title || '').slice(0, 70); } catch (e) { /* ignore */ }

    try {
      const nodes = keywordNodes();
      out.kw = nodes.length;
      for (const n of nodes) {
        const box = tightContainer(n);
        if (!box) continue;
        const t = box.textContent || '';
        if (t.length > out.bestLen) {
          out.bestLen = t.length;
          out.bestKw = countKw(t);
        }
      }
    } catch (e) { /* ignore */ }

    try {
      const site = siteOf(location.hostname);
      for (const s of ((site && site.sel) || [])) {
        let n = 0;
        const els = document.querySelectorAll(s);
        for (const el of els) n += (el.innerText || '').trim().length;
        if (n > out.selHit) out.selHit = n;
      }
    } catch (e) { /* ignore */ }

    return out;
  }

  /* ---------------- 面板主动来取 JD ---------------- */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'GET_JD') {
      let jd = null;
      let diag = null;
      try { jd = extract(); } catch (e) { jd = null; }
      if (!jd) {
        try { diag = diagnose(); } catch (e) { diag = null; }
      }
      sendResponse({ jd: jd, diag: diag });
      return false;
    }

    /* 兜底：用户自己选中了 JD 文字 */
    if (msg && msg.type === 'GET_SELECTION') {
      let t = '';
      try {
        t = String(window.getSelection() || '').trim();
      } catch (e) { t = ''; }
      sendResponse({ text: t });
      return false;
    }

    if (msg && msg.type === 'PING') {
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();

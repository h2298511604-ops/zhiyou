/* ============================================================
   职友 · 主逻辑
   ============================================================ */

(function () {
  'use strict';

  /* 存储键保持老版本不变：升级后用户的简历、事实库和身份直接可用 */
  const LS_KEY = 'touqian30s.v1';
  const APP_VERSION = '1.0.2';

  const THEMES = ['qingdai', 'graphite', 'sage', 'ocean', 'clay', 'sand', 'wine'];
  const APPEARANCES = ['light', 'dark', 'system'];
  const ANALYSIS_MODES = ['manual', 'auto'];
  const DEFAULT_THEME = 'qingdai';
  const DEFAULT_APPEARANCE = 'light';

  const PRESETS = [
    { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    { id: 'zhipu',    name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-plus' },
    { id: 'qwen',     name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    { id: 'moonshot', name: 'Kimi',    baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
    { id: 'ollama',   name: '本地 Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b' }
  ];

  /* ---------------- 状态 ---------------- */

  const state = {
    resumes: [],              // [{id, name, text, chars, addedAt}]
    myFactBase: null,
    demoMode: false,          // 示例数据必须手动载入，默认不加载
    activePersona: null,
    projection: null,
    projectionPersona: null,
    projectionJd: '',         // 生成这份结果时用的 JD 原文，用来发现「JD 改过了」
    evalCache: null,          // { [snapshotKey]: { projection, at, personaId } }
    settings: {
      baseUrl: '', apiKey: '', model: '', thinking: 'auto',
      analysisMode: 'manual',
      theme: DEFAULT_THEME, appearance: DEFAULT_APPEARANCE
    }
  };

  /* 身份是怎么来的：用户手动点过 = manual，之后模型迟到的推荐不能覆盖 */
  let personaSource = 'auto';
  const EVAL_CACHE_LIMIT = 12;
  const SCORE_RULE = { fit: 0.65, density: 0.35, version: 1 };

  /* 扩展环境检测：侧边栏里 chrome.runtime.id 存在；独立网页里不存在 */
  const IS_EXT = (typeof chrome !== 'undefined') &&
                 !!(chrome.runtime && chrome.runtime.id) &&
                 !!(chrome.storage && chrome.storage.local);

  function sendBg(msg, timeoutMs) {
    return new Promise((resolve) => {
      if (!IS_EXT) { resolve(null); return; }
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(v);
      };
      /* 后台没响应时不能让界面永远卡在「加载中」 */
      const timer = setTimeout(
        () => finish({ ok: false, error: '后台响应超时，刷新一下侧边栏再试' }),
        timeoutMs || 130000
      );
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          void chrome.runtime.lastError;
          finish(resp || null);
        });
      } catch (e) {
        finish(null);
      }
    });
  }

  function snapshot() {
    return {
      resumes: state.resumes,
      demoMode: state.demoMode,
      myFactBase: state.myFactBase,
      activePersona: state.activePersona,
      evalCache: state.evalCache,
      settings: state.settings
    };
  }

  function save() {
    const data = snapshot();
    try {
      if (IS_EXT) {
        const o = {};
        o[LS_KEY] = data;
        chrome.storage.local.set(o);
      } else {
        localStorage.setItem(LS_KEY, JSON.stringify(data));
      }
    } catch (e) { /* ignore */ }
  }

  async function load() {
    try {
      let d = null;
      if (IS_EXT) {
        const o = await chrome.storage.local.get(LS_KEY);
        d = o && o[LS_KEY];
      } else {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) d = JSON.parse(raw);
      }
      if (!d) return;
      if (typeof d.demoMode === 'boolean') state.demoMode = d.demoMode;
      if (Array.isArray(d.resumes)) state.resumes = d.resumes;
      if (d.myFactBase) state.myFactBase = d.myFactBase;
      if (d.activePersona) state.activePersona = d.activePersona;
      if (d.evalCache && typeof d.evalCache === 'object') state.evalCache = d.evalCache;
      if (d.settings) state.settings = Object.assign(state.settings, d.settings);
      /* 旧数据没有 analysisMode：按手动迁移，不替用户偷偷调用模型 */
      if (!ANALYSIS_MODES.includes(state.settings.analysisMode)) state.settings.analysisMode = 'manual';
      state.settings.theme = THEMES.indexOf(state.settings.theme) >= 0 ? state.settings.theme : DEFAULT_THEME;
      state.settings.appearance = APPEARANCES.indexOf(state.settings.appearance) >= 0 ? state.settings.appearance : DEFAULT_APPEARANCE;
      state.settings.thinking = state.settings.thinking || 'auto';
    } catch (e) { /* ignore */ }
  }

  async function wipe() {
    try {
      if (IS_EXT) await chrome.storage.local.remove(LS_KEY);
      else localStorage.removeItem(LS_KEY);
    } catch (e) { /* ignore */ }
  }

  /* ---------------- 工具 ---------------- */

  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  /* ---------------- 主题与折叠 ---------------- */

  /* 主题只改 html 上的两个 data 属性，不重绘任何内容：
     正在编辑的话术、已展开的详情、页内滚动都不会被打断。 */
  function applyTheme(theme, appearance) {
    const root = document.documentElement;
    root.dataset.theme = THEMES.indexOf(theme) >= 0 ? theme : DEFAULT_THEME;
    root.dataset.appearance = APPEARANCES.indexOf(appearance) >= 0 ? appearance : DEFAULT_APPEARANCE;
    const ts = $('themeSelect');
    if (ts) ts.value = root.dataset.theme;
    const as = $('appearanceSelect');
    if (as) as.value = root.dataset.appearance;
  }

  function currentTheme() {
    return state.settings.theme || DEFAULT_THEME;
  }

  function currentAppearance() {
    return state.settings.appearance || DEFAULT_APPEARANCE;
  }

  /* ---------------- 分析快照 / 本地计分 / 结果缓存 ---------------- */

  function hashText(input) {
    const s = String(input == null ? '' : input);
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /* 只抹掉换行风格和行尾空白，不删除任何有意义的字符 */
  function normalizeJd(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /* 同一份「输入快照」= 同样的 JD + 身份 + 事实库 + 模型配置 + 规则版本。
     任何一项变了就是另一份评估，缓存不能复用。 */
  function analysisKey(persona) {
    const fb = getFactBase();
    const facts = fb ? JSON.stringify({
      meta: fb.meta || null,
      skills: fb.skills || [],
      education: fb.education || [],
      experiences: fb.experiences || [],
      personas: fb.personas || []
    }) : 'none';
    const p = persona || {};
    return [
      'k' + SCORE_RULE.version,
      hashText(normalizeJd($('jdInput') ? $('jdInput').value : '')),
      state.activePersona || '',
      hashText(JSON.stringify({ id: p.id || '', name: p.name || '', bulletIds: p.bulletIds || [], focus: p.focus || [] })),
      hashText(facts),
      state.settings.baseUrl || '', state.settings.model || '', state.settings.thinking || '',
      APP_VERSION
    ].join('|');
  }

  function cacheGet(key) {
    const cache = state.evalCache;
    if (!cache || !key) return null;
    const hit = cache[key];
    return hit && hit.projection ? hit : null;
  }

  function cacheSet(key, projection, personaId) {
    if (!key || !projection) return;
    const cache = state.evalCache && typeof state.evalCache === 'object' ? state.evalCache : {};
    cache[key] = { projection: projection, personaId: personaId || '', at: Date.now() };
    const keys = Object.keys(cache);
    if (keys.length > EVAL_CACHE_LIMIT) {
      keys.sort((a, b) => (cache[a].at || 0) - (cache[b].at || 0));
      for (const old of keys.slice(0, keys.length - EVAL_CACHE_LIMIT)) delete cache[old];
    }
    state.evalCache = cache;
  }

  /* 总分永远在本地算：fitScore×0.65 + densityScore×0.35，四舍五入。
     模型自己给的 score 不直接上屏；级别也按重算后的分数重新判定。 */
  function applyLocalScore(verdict) {
    const raw = verdict || {};
    const fit = Number(raw.fitScore);
    const density = Number(raw.densityScore);
    if (!Number.isFinite(fit) || !Number.isFinite(density) ||
        fit < 0 || fit > 100 || density < 0 || density > 100) {
      throw new Error('模型返回的评分字段不合法（fitScore / densityScore 必须是 0–100 的数字）');
    }
    const score = Math.round(SCORE_RULE.fit * fit + SCORE_RULE.density * density);
    const level = score >= 70 ? 'go' : score >= 45 ? 'maybe' : 'skip';
    return Object.assign({}, raw, {
      fitScore: fit,
      densityScore: density,
      score: score,
      level: level,
      scoreRule: { fit: SCORE_RULE.fit, density: SCORE_RULE.density, version: SCORE_RULE.version }
    });
  }

  /* 自动模式的唯一入口：按快照指纹去重，同一份输入只自动分析一次 */
  let lastAutoKey = '';
  let pendingAuto = false;
  function maybeAutoAnalyze() {
    if (state.settings.analysisMode !== 'auto') return;
    if (!canCallLLM() || !hasData()) return;
    /* 正在分析时来了新的岗位：记下来，等这次结束再分析最新输入（D4） */
    if (analyzing) { pendingAuto = true; return; }
    const key = analysisKey(getPersona(state.activePersona));
    if (key === lastAutoKey) return;
    lastAutoKey = key;
    analyze();
  }


  let jdFoldState = null;
  function syncJdFold(toggle) {
    const details = document.querySelector('details[data-ui-fold="jd"]');
    const box = $('jdInput');
    if (!details || !box) return;
    const has = !!box.value.trim();
    if (toggle !== false && has !== jdFoldState) {
      details.open = !has;
      jdFoldState = has;
    }
    const preview = $('jdFoldPreview');
    if (preview) {
      preview.textContent = has
        ? box.value.trim().length + ' 字 · 点开可以改'
        : '还没有 JD，点开粘贴岗位原文';
    }
  }

  /* 简历添加区：有简历就收起，没有就展开。只在份数变化时动，尊重手动操作。 */
  let resumeFoldCount = -1;
  function syncResumeFold() {
    const details = document.querySelector('details[data-ui-fold="resume-upload"]');
    if (!details) return;
    if (resumeFoldCount !== state.resumes.length) {
      details.open = state.resumes.length === 0;
      resumeFoldCount = state.resumes.length;
    }
    const preview = $('resumeFoldPreview');
    if (preview) {
      preview.textContent = state.resumes.length
        ? '已添加 ' + state.resumes.length + ' 份 · 点开继续添加'
        : '拖入文件，或粘贴全文';
    }
  }

  /* 分析详情三组折叠区共用一次开合 */
  let analysisOpen = false;
  function setAnalysisOpen(open) {
    analysisOpen = !!open;
    document.querySelectorAll('details.analysis-fold').forEach((d) => { d.open = analysisOpen; });
    const btn = $('btnExpandAnalysis');
    if (btn) btn.textContent = analysisOpen ? '收起分析详情' : '展开分析详情';
  }

  async function copyText(t) {
    try {
      await navigator.clipboard.writeText(t);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e2) { /* ignore */ }
      ta.remove();
    }
    toast('已复制到剪贴板');
  }

  /**
   * 从模型输出里抠出 JSON。
   * 用括号配对（考虑字符串和转义）找真正的结尾，而不是 lastIndexOf('}')——
   * 后者在输出被截断时会切出一个半截 JSON，报出完全看不懂的解析错误。
   */
  function extractJson(text) {
    let t = String(text || '').trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

    const start = t.indexOf('{');
    if (start < 0) throw new Error('模型没有返回 JSON，只回了普通文本');

    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;

    for (let i = start; i < t.length; i++) {
      const c = t[i];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }

    if (end < 0) {
      const e = new Error('模型输出被截断了：JSON 只写了一半就没了（通常是 max_tokens 不够）');
      e.truncated = true;
      throw e;
    }

    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch (err) {
      const e = new Error('模型返回的 JSON 格式不合法：' + err.message);
      e.truncated = true;
      throw e;
    }
  }

  function canCallLLM() {
    const s = state.settings;
    if (!s.baseUrl || !s.model) return false;
    if (!s.apiKey && !/127\.0\.0\.1|localhost/.test(s.baseUrl)) return false;
    return true;
  }

  function getFactBase() {
    if (state.myFactBase) return state.myFactBase;
    if (state.demoMode) return DEMO.factBase;
    return null;
  }

  function hasData() {
    return !!getFactBase();
  }

  function getPersona(id) {
    const fb = getFactBase();
    if (!fb) return null;
    const list = fb.personas || [];
    return list.find(p => p.id === id) || list[0] || null;
  }

  /* ---------------- 空状态卡 ---------------- */

  function emptyCard(icon, title, desc) {
    return '<div class="empty-card">' +
      '<div class="ec-icon">' + icon + '</div>' +
      '<div class="ec-title">' + esc(title) + '</div>' +
      '<div class="ec-desc">' + esc(desc) + '</div>' +
      '<div class="ec-actions">' +
        '<button class="btn primary ec-intake" type="button">上传我的简历</button>' +
        '<button class="btn ghost ec-demo" type="button">先看一个示例</button>' +
      '</div></div>';
  }

  /* 空状态卡会同时出现在三个页签里，所以按容器绑定，绝不能用 id */
  function wireEmpty(root) {
    if (!root) return;
    root.querySelectorAll('.ec-intake').forEach((b) => {
      b.addEventListener('click', () => {
        switchView('resumes');
        const fi = $('fileInput');
        if (fi) fi.click();
      });
    });
    root.querySelectorAll('.ec-demo').forEach((b) => {
      b.addEventListener('click', enterDemo);
    });
  }

  function refreshAll() {
    updateDatasetBadge();
    updateAnalyzeHint();
    renderPersonaSwitch();
    renderPersonaHint();
    renderPersonaGrid();
    renderFacts();
    renderResumeList();
    renderFactMeta();
    renderResult();
  }

  function enterDemo() {
    state.demoMode = true;
    state.myFactBase = null;
    state.projection = null;
    state.projectionNote = '';
    state.projectionPersona = null;
    state.activePersona = 'embedded';
    save();
    refreshAll();
    switchView('workbench');
    toast('已载入示例数据 · 右上角可随时退出');
  }

  function exitDemo() {
    state.demoMode = false;
    state.projection = null;
    state.projectionNote = '';
    state.projectionPersona = null;

    /* 示例身份不能留成"当前身份"：进入示例时被设成 embedded，示例里还能点成 pm / presales */
    const own = (state.myFactBase && state.myFactBase.personas) || [];
    if (!own.some(p => p.id === state.activePersona)) state.activePersona = null;

    save();
    refreshAll();
    toast('已退出示例数据');
  }

  /* ---------------- 模型调用 ---------------- */

  let lastFinishReason = null;

  async function chat(messages, opt) {
    opt = opt || {};
    const body = {
      baseUrl: state.settings.baseUrl,
      apiKey: state.settings.apiKey,
      model: state.settings.model,
      messages: messages,
      jsonMode: opt.jsonMode !== false,
      temperature: opt.temperature == null ? 0.3 : opt.temperature,
      maxTokens: opt.maxTokens || 8000
    };

    /* 思考模式开关：deepseek 系默认开启，关掉能省 15–25 秒 */
    const thinking = state.settings.thinking;
    if (thinking && thinking !== 'auto') body.thinking = thinking;

    /* 扩展模式：交给后台 SW 发请求（有 host_permissions，不受 CORS 限制） */
    if (IS_EXT) {
      const r = await sendBg({ type: 'LLM', payload: body });
      if (!r) throw new Error('后台没有响应（扩展可能刚被重载，刷新一下侧边栏再试）');
      if (!r.ok) throw new Error(r.error || '模型调用失败');
      lastFinishReason = r.finishReason || null;
      return r.content;
    }

    /* 网页模式：走本机 Python 代理 */
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    let data;
    try { data = await res.json(); } catch (e) { throw new Error('服务返回异常（HTTP ' + res.status + '）'); }
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    lastFinishReason = data.finishReason || null;
    return data.content;
  }

  /* 输出被截断时，第二次追加的「精简」指令 */
  const COMPACT_HINT = '\n\n【重要】上一次的输出被截断了（超过 max_tokens 上限）。这次请务必精简：' +
    '每条 bullet 不超过 45 字、metrics 最多 2 条、skills 最多 3 个、tags 只保留 1 个、' +
    'personas 最多 4 个、focus 和 jobs 各最多 2 项。' +
    '必须输出一个完整、合法、能被 JSON.parse 直接解析的 JSON，不要在 JSON 前后加任何文字。';

  function withCompactHint(messages) {
    return messages.map((m, i) => (i === 0
      ? { role: m.role, content: String(m.content || '') + COMPACT_HINT }
      : m));
  }

  /**
   * 调模型并解析 JSON；输出被截断时自动用更大的 max_tokens + 更精简的要求重试一次。
   */
  async function chatJson(messages, opt) {
    opt = opt || {};
    const base = opt.maxTokens || 8000;
    let lastErr = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      const maxTokens = attempt === 0 ? base : Math.min(base * 2, 16000);
      const msgs = attempt === 0 ? messages : withCompactHint(messages);

      try {
        const raw = await chat(msgs, {
          temperature: opt.temperature == null ? 0.3 : opt.temperature,
          maxTokens: maxTokens,
          jsonMode: opt.jsonMode
        });
        return extractJson(raw);
      } catch (e) {
        lastErr = e;
        const truncated = !!(e && e.truncated) || lastFinishReason === 'length';
        /* 不是截断导致的问题，重试也没意义（比如 key 错了） */
        if (!truncated) break;
      }
    }

    throw lastErr;
  }

  /* ============================================================
     身份推荐（本地匹配，不花 token）
     ============================================================ */

  /* 从身份自己的素材里抽词，再拿去和 JD 比对 ——
     不写死任何岗位，所以用户自定义的身份也能匹配。
     按来源分层：岗位名最可信，其次叙事重点，最后项目素材。 */
  function personaTerms(fb, persona) {
    const out = [];
    const seen = new Set();

    const add = (s, w) => {
      const t = String(s || '').trim();
      if (!t) return;
      if (t.length < 2 || t.length > 18) return;
      /* 纯英文太短没区分度（AI、C、R 这类）*/
      if (/^[A-Za-z0-9+.#_-]+$/.test(t) && t.length < 3) return;
      const k = t.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ t: t, w: w });
    };

    /* ① 岗位名 / 可投岗位 —— 最像"这个身份是什么" */
    [persona.name, ...(persona.jobs || [])].forEach((s) => {
      String(s || '').split(/[\/·、,，\s（）()]+/).forEach(x => add(x, 2.2));
    });

    /* ② 叙事重点 */
    (persona.focus || []).forEach((f) => {
      add(f, 1.4);
      String(f).split(/[与和及、,，\/]+/).forEach(x => add(x, 1.4));
    });

    /* ③ 该身份用到的 bullets：技能名 + 英文技术词 */
    const ids = new Set(persona.bulletIds || []);
    for (const e of (fb.experiences || [])) {
      for (const b of (e.bullets || [])) {
        if (ids.size && !ids.has(b.id)) continue;
        (b.skills || []).forEach(s => add(s, 1));
        const txt = String(b.text || '');
        (txt.match(/[A-Za-z][A-Za-z0-9+.#_-]{2,18}/g) || []).forEach(s => add(s, 1));
      }
    }

    return out;
  }

  /* 找 term 在 JD 里能命中的最长片段。
     「大模型评测工程师」对不上「模型评测」原词，但能对上一个 4 字片段。 */
  function longestCommon(term, hay) {
    const t = String(term).toLowerCase();
    const n = t.length;
    for (let L = n; L >= 2; L--) {
      for (let i = 0; i + L <= n; i++) {
        const sub = t.substr(i, L);
        if (/^[a-z0-9+.#_-]+$/.test(sub) && L < 3) continue;
        if (hay.indexOf(sub) >= 0) return sub;
      }
    }
    return '';
  }

  function recommendPersona(jdText, jdTitle) {
    const fb = getFactBase();
    if (!jdText || !fb) return null;
    const personas = fb.personas || [];
    if (!personas.length) return null;

    const jd = String(jdText).toLowerCase();
    const title = String(jdTitle || '').toLowerCase();

    /* 第一遍：每个身份能命中哪些片段。
       注意按"命中的片段"去重 —— 「开发工程师」「应用工程师」「应用开发工程师」
       对 JD 都只能匹配到「工程师」三字，不能算三次分。 */
    const groups = personas.map((p) => {
      const bySub = new Map();
      for (const { t, w: tier } of personaTerms(fb, p)) {
        const sub = longestCommon(t, jd);
        if (!sub) continue;
        const prev = bySub.get(sub);
        if (!prev || tier > prev.tier) {
          bySub.set(sub, { term: t, sub: sub, len: sub.length, tier: tier });
        }
      }
      return { p: p, hits: Array.from(bySub.values()) };
    });

    /* 第二遍：片段的稀有度（几个身份都能命中 → 不值钱） */
    const df = {};
    for (const g of groups) {
      for (const h of new Set(g.hits.map(x => x.sub))) {
        df[h] = (df[h] || 0) + 1;
      }
    }

    /* 第三遍：打分 */
    let best = null;
    const all = [];
    for (const g of groups) {
      let score = 0;
      const marks = [];
      for (const h of g.hits) {
        let w = h.len / Math.max(2, Math.sqrt(df[h.sub] || 1)) * h.tier;
        /* 命中 JD 标题的片段，权重再翻倍 —— 标题就是岗位的定义 */
        if (title && title.indexOf(h.sub) >= 0) w *= 2.5;
        score += w;
        marks.push({ t: h.term, w: w });
      }
      marks.sort((a, b) => b.w - a.w);
      all.push({
        id: g.p.id, name: g.p.name,
        score: Math.round(score * 10) / 10,
        marks: marks.map(m => m.t).slice(0, 6)
      });
      if (!best || score > best.score) {
        best = { id: g.p.id, name: g.p.name, score: score, marks: marks.map(m => m.t).slice(0, 5) };
      }
    }
    all.sort((a, b) => b.score - a.score);

    if (!best || best.score < 5) return null;
    best.all = all;
    return best;
  }

  /* ============================================================
     渲染：身份切换
     ============================================================ */

  function renderPersonaSwitch() {
    const fb = getFactBase();
    const personas = (fb && fb.personas) || [];
    const summary = $('personaSummary');

    if (!personas.length) {
      $('personaSwitch').innerHTML =
        '<span class="mini-hint">录入简历后，这里会出现你能投的几个身份</span>';
      if (summary) summary.textContent = '还没有可投身份';
      return;
    }

    if (!personas.find(p => p.id === state.activePersona) && personas.length) {
      state.activePersona = personas[0].id;
    }

    $('personaSwitch').innerHTML = personas.map((p) => {
      const strength = Math.max(0, Math.min(5, Number(p.strength) || 0));
      return '<button type="button" class="persona-pill ' + (p.id === state.activePersona ? 'active' : '') +
        '" data-persona="' + esc(p.id) + '" aria-pressed="' + (p.id === state.activePersona ? 'true' : 'false') + '">' +
        esc(p.name) + '<span class="persona-strength">素材支撑度 ' + strength + ' / 5</span></button>';
    }).join('');

    if (summary) {
      const current = personas.find(p => p.id === state.activePersona) || personas[0];
      const strength = Math.max(0, Math.min(5, Number(current.strength) || 0));
      summary.textContent = '当前身份 · ' + current.name + ' · 素材支撑度 ' + strength + ' / 5 · 点开更换';
    }

    $('personaSwitch').querySelectorAll('[data-persona]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.activePersona = btn.getAttribute('data-persona');
        /* 用户亲手选的：之后模型迟到的推荐不许覆盖（J10） */
        personaSource = 'manual';
        save();
        renderPersonaSwitch();
        renderPersonaHint();
        renderPersonaGrid();
        renderResult();
      });
    });
  }

  function renderPersonaHint() {
    const el = $('personaHint');
    if (!el) return;
    const jd = $('jdInput').value.trim();
    const rec = recommendPersona(jd, currentJdTitle);
    if (!rec) { el.classList.remove('show'); return; }
    const current = getPersona(state.activePersona);
    if (!current) { el.classList.remove('show'); return; }
    if (rec.id === state.activePersona) {
      el.classList.add('show');
      el.innerHTML = '预选身份 <b>' + esc(rec.name) + '</b> · 命中：' +
        esc(rec.marks.join('、')) + '　（点「分析」时会再确认一次）';
      return;
    }
    el.classList.add('show');
    el.innerHTML = '这个岗位更适合用 <b>' + esc(rec.name) + '</b> 这个身份投 · 关键词命中：' +
      esc(rec.marks.join('、')) +
      '<br>用当前「' + esc(current.name) + '」身份投，可能让 HR 觉得不对口。' +
      ' <button class="btn sm ghost" id="btnSwitchRec">切换过去</button>';
    const b = $('btnSwitchRec');
    if (b) b.addEventListener('click', () => {
      state.activePersona = rec.id;
      personaSource = 'manual';
      save();
      renderPersonaSwitch();
      renderPersonaHint();
      renderPersonaGrid();
      renderResult();
    });
  }

  /* ============================================================
     渲染：结果
     ============================================================ */

  const LEVEL_MAP = {
    go:    { cls: 'lv-go',    tag: '可以投' },
    maybe: { cls: 'lv-maybe', tag: '勉强' },
    skip:  { cls: 'lv-skip',  tag: '建议跳过' }
  };

  /* ---------------- JD 依据校验 ---------------- */

  function normText(s) {
    return String(s || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
  }

  /* 这条「要求」真的出自 JD 吗？
     用二字切片的重合率判断 —— 编出来的词（"杭州""大二""研一"）会和 JD 原文几乎不重合。 */
  function jdOverlap(text, jdNorm) {
    const t = normText(text);
    if (t.length < 4) return 1;
    const grams = [];
    for (let i = 0; i + 2 <= t.length; i++) grams.push(t.substr(i, 2));
    if (!grams.length) return 1;
    let hit = 0;
    for (const g of grams) {
      if (jdNorm.indexOf(g) >= 0) hit++;
    }
    return hit / grams.length;
  }

  /* ---------------- 专业开场校验（通用，不写死任何学科） ---------------- */

  /* 事实库里所有文字，用来核对"简历未写"这类说法 */
  function factsText() {
    const fb = getFactBase();
    const parts = [];
    ((fb && fb.experiences) || []).forEach((e) => {
      ((e.bullets) || []).forEach((b) => {
        if (b.text) parts.push(b.text);
        (b.skills || []).forEach(s => parts.push(s));
        (b.metrics || []).forEach(m => parts.push(m));
      });
    });
    ((fb && fb.skills) || []).forEach(s => parts.push(s));
    ((fb && fb.education) || []).forEach((e) => {
      if (e.major) parts.push(e.major);
      if (e.school) parts.push(e.school);
    });
    return normText(parts.join(' '));
  }

  /* 用户自己的专业，从简历解析出的事实库里读，可能不止一个（本科 / 硕士） */
  function userMajorForms() {
    const fb = getFactBase();
    const out = [];
    ((fb && fb.education) || []).forEach((e) => {
      const m = String((e && e.major) || '').trim();
      if (!m) return;
      out.push(m);
      /* 去掉「工程 / 技术 / 学」这类后缀得到短名：电子信息工程 → 电子信息 */
      const short = m.replace(/(工程|技术|科学|管理|学|专业)+$/, '');
      if (short && short !== m && short.length >= 2) out.push(short);
      /* 再取前两个字：机械设计制造及其自动化 → 机械（JD 里常这么简称） */
      if (m.length > 2) out.push(m.slice(0, 2));
    });
    return Array.from(new Set(out));
  }

  /* JD 里讲专业的那一句。通用：不假设学科名，只找「专业」这个关键词 */
  function jdMajorClause(jd) {
    const m = String(jd || '').match(/[^\n。；;]{0,50}专业[^\n。；;]{0,50}/);
    return m ? m[0] : '';
  }

  /* 身份状态必须能在事实库里找到依据。

     JD 里的条件说的是「岗位接受什么」，不是「你是谁」。
     实测翻车：JD 写「1—3 年经验或在校学生均可」，话术结尾就写了「在校应届」，
     但事实库里查不到「在校」，教育时间写的是 2022.09–2026.06（已毕业）。 */
  const IDENTITY_WORDS = ['在校', '在读', '毕业生', '可实习'];

  function checkIdentityClaim(greet, fb) {
    const ev = JSON.stringify(fb || {});
    const text = String(greet || '');
    const claimed = IDENTITY_WORDS.filter(w => text.indexOf(w) >= 0);
    const fake = claimed.filter(w => ev.indexOf(w) < 0);
    return { warn: fake.length > 0, words: fake };
  }

  /* 专业名是否出现在「第一个分句」里，且是在报专业。

     Skill v9 的规则是「专业名可以出现，但不许放在第一个分句」，
     所以判定要对齐这条规则，而不是看固定字数窗口：
       · 「热爱足球与体育赛事，…；体育教育本科」→ 首句说的是赛事，不是专业
       · 「英语专业，做过翻译…」                → 首句在报专业 */
  const MAJOR_CTX = /专业|本科|硕士|学士|学位|毕业|应届|科班/;

  function majorMentionedIn(clause, token) {
    const c = normText(clause);
    const t = normText(token);
    if (!c || !t) return false;
    let from = 0;
    while (true) {
      const at = c.indexOf(t, from);
      if (at < 0) return false;
      const tail = c.slice(at + t.length, at + t.length + 4);
      if (MAJOR_CTX.test(tail)) return true;
      from = at + 1;
    }
  }

  function checkMajorLead(greet, jd) {
    const forms = userMajorForms();
    if (!forms.length) return { warn: false, major: '' };

    const firstClause = String(greet || '').split(/[，,。；;、]/)[0] || '';
    const hit = forms.find(f => majorMentionedIn(firstClause, f) ||
      (f.length > 3 && majorMentionedIn(firstClause, f.slice(0, 2))));
    if (!hit) return { warn: false, major: '' };        // 首句没在报专业，不关我事

    const clause = jdMajorClause(jd);
    if (!clause) return { warn: true, major: hit };     // JD 压根没提专业
    if (forms.some(f => clause.indexOf(f) >= 0)) {      // JD 列了你的专业
      return { warn: false, major: hit };
    }
    return { warn: true, major: hit };
  }

  /* 最长公共子串长度 —— 用来判断话术是不是照抄了 Skill 里的历史示例 */
  function longestCommonStr(a, b) {
    const x = normText(a);
    const y = normText(b);
    if (!x || !y) return 0;
    let best = 0;
    let prev = new Array(y.length + 1).fill(0);
    for (let i = 1; i <= x.length; i++) {
      const cur = new Array(y.length + 1).fill(0);
      for (let j = 1; j <= y.length; j++) {
        if (x[i - 1] === y[j - 1]) {
          cur[j] = prev[j - 1] + 1;
          if (cur[j] > best) best = cur[j];
        }
      }
      prev = cur;
    }
    return best;
  }

  /* 这份结果还能不能直接用：身份换了、JD 改过，都算过期 */
  function projectionFresh() {
    if (!state.projection) return false;
    if (state.projectionPersona !== state.activePersona) return false;
    const cur = $('jdInput');
    return String(state.projectionJd || '').trim() === (cur ? cur.value.trim() : '');
  }

  function renderResult() {
    const area = $('resultArea');

    syncJdFold();

    /* 把「当前有没有投影」暴露成结果区的 DOM 状态：
       投影不落存储（snapshot 里不含它），R05 的「投影全空」只能从页面状态看；
       结果区在没有事实库时会直接渲染空状态卡，光看 HTML 分不出投影是否残留。 */
    if (area && area.dataset) area.dataset.hasProjection = state.projection ? '1' : '0';

    /* 分析进行中，结果区由 analyze() 接管 —— 别让任何重绘把加载卡顶掉 */
    if (analyzing && area.querySelector('.loading-card')) return;

    if (!hasData()) {
      area.innerHTML = emptyCard('', '还没有你的事实库',
        '上传一次简历，它会拆成中性的原子事实；之后每个岗位都自动适配，你不用再改简历。');
      wireEmpty(area);
      return;
    }

    if (!state.projection) {
      area.innerHTML = '<div class="empty">把 JD 贴好，点「分析」<br>' +
        '它不替你做决定，只告诉你：该不该投、该突出什么、第一句话怎么说。</div>';
      return;
    }

    const p = state.projection;
    const v = p.verdict || { score: 0, level: 'maybe', summary: '' };
    let lv = LEVEL_MAP[v.level] || LEVEL_MAP.maybe;
    if (v.level === 'go' && v.score >= 85) lv = { cls: 'lv-go', tag: '强推' };

    const stalePersona = state.projectionPersona ? getPersona(state.projectionPersona) : null;
    const personaChanged = !!(stalePersona && state.projectionPersona !== state.activePersona);
    const jdBox = $('jdInput');
    const jdNow = jdBox ? jdBox.value.trim() : '';
    const jdChanged = !!String(state.projectionJd || '').trim() && String(state.projectionJd || '').trim() !== jdNow;
    const fresh = !personaChanged && !jdChanged;

    let html = '';
    if (personaChanged) {
      html += '<div class="greet-warn" style="margin:0 0 10px">这份结果是用「' +
        esc(stalePersona.name) + '」身份生成的。你切换了身份，重新分析后再用。</div>';
    } else if (jdChanged) {
      html += '<div class="greet-warn" style="margin:0 0 10px">JD 改过了，这份结果对应的是修改前的内容，重新分析后再用。</div>';
    }

    const demoNote = (state.projectionNote)
      ? '<div class="persona-hint show" style="margin-bottom:10px">' + esc(state.projectionNote) + '</div>'
      : '';
    html += demoNote;

    /* 核一遍：每条缺口是不是真出自 JD。编出来的门槛必须当场标出来。 */
    const jdNorm = normText($('jdInput') ? $('jdInput').value : '');
    const factsNorm = factsText();
    const gapList = (p.gaps || []).map((g) => {
      const item = Object.assign({}, g);
      item.__ok = jdOverlap(g.req, jdNorm) >= 0.35;
      /* 另一个方向的错：说"简历未写"，但事实库里明明有 */
      const saysMissing = /未写|没写|没有|不具备|无相关|缺失/.test(String(g.note || ''));
      item.__miss = saysMissing && jdOverlap(g.req, factsNorm) >= 0.45;
      return item;
    });
    const badGaps = gapList.filter(g => !g.__ok);
    const allGapsBad = gapList.length > 0 && badGaps.length === gapList.length;

    if (v.level === 'skip' && allGapsBad) {
      html += '<div class="greet-warn">判「建议跳过」的依据，在 JD 原文里一条都没找到 —— ' +
        '很可能是我看错了。请自己核对一遍 JD，或者点「分析」重试。</div>';
    }

    /* ---- 结论卡：分数、判断、三行计数。细节全部收进下面的折叠区 ---- */
    html += '<div class="verdict ' + lv.cls + '">' +
      '<div class="score-box">' +
        '<div class="score-num">' + (v.score || 0) + '<span>/100</span></div>' +
        '<div class="level-tag">' + lv.tag + '</div>' +
      '</div>' +
      '<div class="verdict-body">' +
        '<p class="verdict-summary">' + esc(v.summary) + '</p>' +
        '<div class="verdict-chips">' +
          '<span>命中 ' + (p.hits || []).length + ' 项</span>' +
          '<span>待核对 ' + gapList.length + ' 项</span>' +
          '<span>风险 ' + (p.risks || []).length + ' 条</span>' +
        '</div>' +
      '</div></div>';

    /* ---- 经历重点：内容先拼好，等会儿放进折叠区 ---- */
    let highlightHtml = '';
    (p.highlights || []).forEach((h) => {
      highlightHtml += '<div class="hl-item">' +
        '<div class="hl-head">' +
          '<div class="hl-rank">' + (h.rank || '') + '</div>' +
          '<div class="hl-title">' + esc(h.title) + '</div>' +
          '<div class="hl-rel">相关度 ' + (h.relevance || 0) + '%</div>' +
        '</div>' +
        '<div class="hl-text">' + esc(h.text) + '</div>' +
        '<div class="hl-refs">来源：' +
          (h.bulletIds || []).map(id => '<span class="ref-chip" title="' + esc(bulletText(id)) + '">' + esc(id) + '</span>').join(' ') +
        '</div></div>';
    });
    (p.avoid || []).forEach((a) => {
      highlightHtml += '<div class="hl-avoid">' + esc(a) + '</div>';
    });

    /* ---- 打招呼语：首屏必须完整看到正文和复制按钮 ---- */
    const g = p.greeting || { text: '', charCount: 0, bulletIds: [] };
    const greetLen = String(g.text || '').replace(/\s/g, '').length;
    const greetOver = greetLen > 100;

    /* 硬校验：话术里出现了 JD 没有的条件词。
       这类"没看 JD 就群发"的痕迹，模型自己经常不承认，所以代码兜底。 */
    const jdRaw = ($('jdInput') && $('jdInput').value) || '';
    const greetRaw = String(g.text || '');
    const COND_WORDS = ['出差', '驻场', '加班', '倒班', '到岗', '远程'];
    const falseConds = COND_WORDS.filter(w => greetRaw.indexOf(w) >= 0 && jdRaw.indexOf(w) < 0);

    /* 专业开场：专业名从用户自己的简历里读，JD 的要求从 JD 里解析 —— 不写死任何学科 */
    const majorCheck = checkMajorLead(greetRaw, jdRaw);
    const majorMisled = majorCheck.warn;

    /* 身份状态是不是从 JD 抄来的 */
    const idCheck = checkIdentityClaim(greetRaw, getFactBase());

    html += '<div class="greet-box" id="greetBox">' +
      '<div class="greet-text" id="greetText">' + esc(g.text) + '</div>' +
      '<div class="greet-meta">' +
        '<span class="' + (greetOver ? 'over' : '') + '">' + greetLen + ' 字' +
          (greetOver ? ' · 超了 100 字上限，建议删短' : '') + '</span>' +
        (g.angle ? '<span>切入：' + esc(g.angle) + '</span>' : '') +
        '<span>引用 ' + (g.bulletIds || []).length + ' 条事实</span>' +
        '<span>' + (g.bulletIds || []).map(id => '<span class="ref-chip" title="' + esc(bulletText(id)) + '">' + esc(id) + '</span>').join(' ') + '</span>' +
      '</div>' +
      (falseConds.length
        ? '<div class="greet-warn">话术里写了「' + esc(falseConds.join('、')) +
          '」，但这份 JD 里没有 —— 建议删掉。写了 JD 没提的条件，HR 会认为你在群发。</div>'
        : '') +
      (majorMisled
        ? '<div class="greet-warn">第一个分句用了「' + esc(majorCheck.major) +
          '」，但 JD 的专业要求里没列它。专业名建议放到能力之后，把最贵的开头留给 JD 关键词。</div>'
        : '') +
      (idCheck.warn
        ? '<div class="greet-warn">话术里写了「' + esc(idCheck.words.join('、')) +
          '」，但你的简历里查不到这个状态 —— 这是从 JD 抄来的，不是你的实际情况。建议删掉。</div>'
        : '') +
      '<div class="greet-actions">' +
        '<button class="btn primary" id="btnCopyGreet" type="button"' + (fresh ? '' : ' disabled') + '>' +
          '<svg class="ico" aria-hidden="true"><use href="#i-copy"/></svg>' + (fresh ? '复制' : '先重新分析') +
        '</button>' +
        '<button class="btn ghost" id="btnEditGreet" type="button"' + (fresh ? '' : ' disabled') + '>' +
          '<svg class="ico" aria-hidden="true"><use href="#i-edit"/></svg>编辑' +
        '</button>' +
      '</div></div>';

    /* ---- 匹配依据 ---- */
    const matchHtml = renderChecks('命中 ' + (p.hits || []).length + ' 项', p.hits || [], true) +
      renderChecks('待核对 ' + gapList.length + ' 项', gapList, false);

    /* ---- 风险与面试准备：合并成一组 ---- */
    let prepHtml = '';
    (p.risks || []).forEach((r) => {
      const cls = r.level === 'high' ? 'lv-h' : (r.level === 'medium' ? 'lv-m' : 'lv-s');
      const label = r.level === 'high' ? '高风险' : (r.level === 'medium' ? '中风险' : '低风险');
      prepHtml += '<div class="risk-item">' +
        '<span class="risk-lv ' + cls + '">' + label + '</span>' +
        '<div class="risk-body">' +
          '<div><b>' + esc(r.text) + '</b></div>' +
          (r.original ? '<div class="orig">原文：' + esc(r.original) + '</div>' : '') +
          (r.question ? '<div class="q">面试可能追问：' + esc(r.question) + '</div>' : '') +
        '</div></div>';
    });
    if ((p.interviewPrep || []).length) {
      prepHtml += '<div class="check-title" style="margin-top:10px">面试可能问到</div>' +
        p.interviewPrep.map((it, i) =>
          '<div class="prep-item">' +
            '<span class="idx">' + String(i + 1).padStart(2, '0') + '</span>' +
            '<div><b>' + esc(it.point) + '</b> · ' + esc(it.hint) + '</div>' +
          '</div>').join('');
    }

    /* ---- 三组分析详情：默认收起，摘要写清楚里面是什么 ---- */
    const first = (p.highlights || [])[0];
    const expPreview = first
      ? (first.title || '') + (first.relevance ? ' · 相关度 ' + first.relevance + '%' : '')
      : '这次没有可突出的条目';
    const matchPreview = '命中 ' + (p.hits || []).length + ' 项 · 待核对 ' + gapList.length + ' 项';
    const prepPreview = '风险 ' + (p.risks || []).length + ' 条 · 面试 ' + (p.interviewPrep || []).length + ' 问';

    html += '<div class="analysis-tools">' +
        '<span>分析详情</span>' +
        '<button class="btn sm ghost" id="btnExpandAnalysis" type="button">' +
          (analysisOpen ? '收起分析详情' : '展开分析详情') +
        '</button>' +
      '</div>' +
      '<details class="fold analysis-fold" data-ui-fold="experience">' +
        '<summary><span class="fold-label">经历重点</span><span class="fold-preview">' + esc(expPreview) + '</span></summary>' +
        '<div class="fold-body">' + (highlightHtml || '<div class="mini-hint">这次没有可突出的条目。</div>') + '</div>' +
      '</details>' +
      '<details class="fold analysis-fold" data-ui-fold="matches">' +
        '<summary><span class="fold-label">匹配依据</span><span class="fold-preview">' + esc(matchPreview) + '</span></summary>' +
        '<div class="fold-body">' + (matchHtml || '<div class="mini-hint">没有可核对的条目。</div>') + '</div>' +
      '</details>' +
      '<details class="fold analysis-fold" data-ui-fold="preparation">' +
        '<summary><span class="fold-label">风险与面试准备</span><span class="fold-preview">' + esc(prepPreview) + '</span></summary>' +
        '<div class="fold-body">' + (prepHtml || '<div class="mini-hint">这次没有需要提前核对的风险。</div>') + '</div>' +
      '</details>';

    area.innerHTML = html;

    /* 沿用上一次的开合选择：切页签、改话术、换主题都不会重置 */
    document.querySelectorAll('details.analysis-fold').forEach((d) => { d.open = analysisOpen; });
    const expandBtn = $('btnExpandAnalysis');
    if (expandBtn) expandBtn.addEventListener('click', () => setAnalysisOpen(!analysisOpen));

    const btnCopy = $('btnCopyGreet');
    if (btnCopy) btnCopy.addEventListener('click', () => {
      const box = $('greetText');
      copyText(box ? box.textContent : (g.text || ''));
    });

    const btnEdit = $('btnEditGreet');
    if (btnEdit) btnEdit.addEventListener('click', () => {
      const box = $('greetText');
      if (!box) return;
      box.contentEditable = 'true';
      box.focus();
      try {
        const range = document.createRange();
        range.selectNodeContents(box);
        range.collapse(false);
        const sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      } catch (e) { /* 选区只是顺手，不影响可编辑 */ }
      btnEdit.disabled = true;
      toast('现在是可编辑状态，改完直接点复制');
    });
  }

  /* JD 被手动改过 → 旧话术当场作废，不用等重新分析 */
  function markJdChanged() {
    if (!state.projection) return;
    const box = $('jdInput');
    const now = box ? box.value.trim() : '';
    if (String(state.projectionJd || '').trim() === now) return;
    const copy = $('btnCopyGreet');
    if (copy) { copy.disabled = true; copy.textContent = '先重新分析'; }
    const edit = $('btnEditGreet');
    if (edit) edit.disabled = true;
    const wrap = $('greetBox');
    if (wrap) {
      wrap.classList.add('stale');
      if (!$('greetStaleNote')) {
        const note = document.createElement('div');
        note.id = 'greetStaleNote';
        note.className = 'greet-warn';
        note.textContent = 'JD 已经改过，这份话术对应的是修改前的内容。重新分析后再用。';
        wrap.appendChild(note);
      }
    }
  }

  function renderChecks(title, items, isHit) {
    if (!items.length) return '';
    let html = '<div class="check-group"><div class="check-title">' + title + '</div>';
    items.forEach((it) => {
      const req = it.req || '';
      const tail = isHit
        ? '<div class="evt">' + esc(it.evidence || '') + '</div>'
        : '<div class="evt">' + esc(it.note || '') + '</div>';
      const bad = (!isHit && it.__ok === false)
        ? '<div class="evt warn-line">JD 原文里找不到这条要求，可能是我编的，忽略它</div>'
        : '';
      const falseMiss = (!isHit && it.__miss)
        ? '<div class="evt warn-line">事实库里其实有相关内容，这条「未写」的判断可能错了，去「事实库」核一下</div>'
        : '';
      html += '<div class="check-item ' + (isHit ? 'hit' : 'miss') + '">' +
        '<div style="flex:1"><div class="req">' + esc(req) + '</div>' + tail + bad + falseMiss + '</div>' +
        '</div>';
    });
    html += '</div>';
    return html;
  }

  function bulletText(id) {
    const fb = getFactBase();
    for (const exp of (fb.experiences || [])) {
      for (const b of (exp.bullets || [])) {
        if (b.id === id) return b.text + (b.metrics && b.metrics.length ? '（' + b.metrics.join('；') + '）' : '');
      }
    }
    return '未找到对应事实';
  }

  /* ============================================================
     分析流程
     ============================================================ */

  let analyzing = false;
  let analyzeToken = 0;

  /* 只把当前身份相关的 bullet 发给模型，输入小一半，快很多 */
  function compactFactBase(fb, persona) {
    const keep = new Set(persona.bulletIds || []);
    const experiences = [];
    const coverage = [];

    for (const e of fb.experiences || []) {
      const bullets = (e.bullets || []).filter(b => !keep.size || keep.has(b.id));
      if (bullets.length) {
        experiences.push({
          id: e.id, org: e.org, role: e.role, period: e.period,
          bullets: bullets.map(b => ({ id: b.id, text: b.text, metrics: b.metrics || [] }))
        });
      }
      /* 全局能力索引：全部 bullet 的一行摘要，不管属不属于当前身份。
         只用来判断"用户到底有没有这个能力"，不给它用来写 highlights。 */
      for (const b of (e.bullets || [])) {
        coverage.push({
          id: b.id,
          s: (b.skills || []).slice(0, 6),
          t: String(b.text || '').slice(0, 48)
        });
      }
    }

    return {
      meta: fb.meta,
      skills: (fb.skills || []).slice(0, 15),
      education: fb.education || [],
      experiences: experiences.length ? experiences : (fb.experiences || []),
      coverage: coverage
    };
  }

  let analyzeTimer = null;

  /* 统一的完成路径：先退出「分析中」、停计时，再渲染。
     否则 renderResult 会因为还有加载卡而直接返回，界面永远停在转圈（D5）。 */
  function finishAnalysis(projection, persona, jd, note) {
    analyzing = false;
    clearInterval(analyzeTimer);
    state.projection = projection;
    state.projectionPersona = persona && persona.id ? persona.id : state.activePersona;
    state.projectionJd = jd;
    state.projectionNote = note || '';
    renderResult();
  }

  async function analyze() {
    if (analyzing) return;
    const jd = $('jdInput').value.trim();
    if (!jd) { toast('先把 JD 粘进来'); $('jdInput').focus(); return; }

    const area = $('resultArea');
    let persona = getPersona(state.activePersona);
    const factBase = getFactBase();

    /* 没有任何事实库，先去录简历 */
    if (!factBase || !persona) {
      toast('先录一次简历，建立你自己的事实库');
      switchView('resumes');
      return;
    }

    /* --- 无模型 --- */
    if (!canCallLLM()) {
      if (state.demoMode && jd === DEMO.sampleJd.trim()) {
        state.projection = DEMO.sampleProjection;
        state.projectionPersona = 'embedded';
        state.projectionNote = '这是内置的示例结果（没有调用模型）。原因：还没配置 API Key。';
        state.activePersona = 'embedded';
        renderPersonaSwitch(); renderPersonaHint(); renderPersonaGrid();
        renderResult();
      } else {
        area.innerHTML = '<div class="err-box">' +
          '还没配置模型，所以没法分析。<br><br>' +
          '去右上角 <b>设置</b> 填一个 API Key（DeepSeek 最便宜，充 10 块能用很久），' +
          '或者用本地 Ollama（完全免费），就能分析任意 JD。<br><br>' +
          '<button class="btn ghost sm" id="btnGotoSettings">去设置</button>' +
          '</div>';
        const b = $('btnGotoSettings');
        if (b) b.addEventListener('click', openSettings);
      }
      return;
    }

    /* --- 先查已完成评估：同一份输入快照直接复用，不花 token --- */
    const cachedKey = analysisKey(persona);
    const cachedHit = cacheGet(cachedKey);
    if (cachedHit) {
      finishAnalysis(cachedHit.projection, persona, jd, '同一份 JD 与身份，复用上次的评估（没有重复请求模型）');
      toast('同一份输入，已复用上次评估');
      return;
    }

    /* --- 有模型：真实调用（一次请求出全部结果）--- */
    analyzing = true;
    const token = ++analyzeToken;
    $('btnAnalyze').disabled = true;
    $('btnAnalyze').textContent = '分析中…';
    const t0 = Date.now();
    area.innerHTML = loadingHtml(['判断该用哪个身份', '读 JD → 匹配事实库 → 写打招呼语'], 0, true);
    clearInterval(analyzeTimer);
    analyzeTimer = setInterval(() => {
      const el = $('analyzeElapsed');
      if (el) el.textContent = ((Date.now() - t0) / 1000).toFixed(1) + 's';
    }, 100);

    try {
      /* 第一步：确认身份。
         用户手动选过的身份优先——不再问模型，也就没有「迟到的推荐覆盖手动选择」；
         没手动选过时，让模型确认一次（几十个 token）。 */
      if (personaSource !== 'manual') {
        try {
          await autoPickPersona(jd);
          /* 等模型这几秒里，用户可能已经手动换了身份：以人的选择为准（D1） */
          persona = getPersona(state.activePersona) || persona;
          const pickedKey = analysisKey(persona);
          const pickedHit = cacheGet(pickedKey);
          if (pickedHit) {
            finishAnalysis(pickedHit.projection, persona, jd,
              '同一份 JD 与身份，复用上次的评估（没有重复请求模型）');
            return;
          }
        } catch (e) {
          /* 选身份失败不影响主流程 */
        }
      }

      /* 请求发出前就把快照 key 固定下来：写缓存只能用这一份 key，
         不能拿响应回来时的界面/设置重新算（否则旧结果会污染新输入的缓存）。 */
      const snapshotKey = analysisKey(persona);
      const sentModel = state.settings.model;

      area.innerHTML = loadingHtml(['判断该用哪个身份', '读 JD → 匹配事实库 → 写打招呼语'], 1, true);

      const slim = compactFactBase(factBase, persona);
      const proj = await chatJson(PROMPTS.project({
        factBase: slim,
        persona: persona,
        jdText: jd,
        packLevel: 'standard'
      }), { temperature: 0, maxTokens: 8000 });

      /* 期间用户翻到别的岗位了，这份结果已经过期，别贴上去。
         但加载卡得收掉，否则会一直转圈。 */
      if (token !== analyzeToken) {
        analyzing = false;
        clearInterval(analyzeTimer);
        renderResult();
        return;
      }

      /* 总分在本地按 65% / 35% 重算，级别跟着重判；模型给的 score 不直接上屏 */
      proj.verdict = applyLocalScore(proj.verdict);
      const jdTitle = (proj.jd && proj.jd.title) || '';
      /* 说明里用「实际发出去的那个模型」，不是现在设置里的（D3） */
      const note = '由「' + persona.name + '」身份生成 · ' + sentModel +
        (jdTitle ? ' · ' + jdTitle : '') +
        ' · 耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's';

      finishAnalysis(proj, persona, jd, note);
      cacheSet(snapshotKey, proj, persona.id);
      save();
      area.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      area.innerHTML = '<div class="err-box"><b>分析失败</b><br>' + esc(e.message || e) +
        '<br><br>常见原因：API Key 不对、余额不足、模型不支持 JSON 输出、网络不通。<br>' +
        '可以去 <b>设置</b> 里点「测试连接」确认。<br><br>' +
        '<button class="btn ghost sm" id="btnRetryAnalyze">重试一次</button></div>';
      const rb = $('btnRetryAnalyze');
      if (rb) rb.addEventListener('click', analyze);
    } finally {
      analyzing = false;
      clearInterval(analyzeTimer);
      $('btnAnalyze').disabled = false;
      $('btnAnalyze').textContent = '分析';
      /* 分析期间来过新岗位：现在补上，自动模式下不能把新输入丢掉（D4） */
      if (pendingAuto) {
        pendingAuto = false;
        if (state.settings.analysisMode === 'auto') setTimeout(() => maybeAutoAnalyze(), 0);
      }
    }
  }

  function loadingHtml(stages, current, withTimer) {
    return '<div class="loading-card"><div class="spinner"></div>' +
      '<div class="stage-list" style="flex:1">' +
      stages.map((s, i) => {
        const cls = i < current ? 'done' : (i === current ? 'run' : '');
        return '<div class="stage ' + cls + '"><span class="sdot"></span>' + esc(s) + '</div>';
      }).join('') +
      (withTimer ? '<div class="mini-hint" style="margin-top:6px">已用 <span id="analyzeElapsed">0.0s</span>' +
        ' · 超过 20 秒的话，去设置里把「思考模式」改成<b>关闭</b></div>' : '') +
      '</div></div>';
  }

  /* ============================================================
     扩展联动：从当前页面读取 JD
     ============================================================ */

  let jdAutoFilled = '';   // 上次自动填入的原文，用来判断用户是否手动改过

  function updateSourceBar(jd, diag) {
    const bar = $('jdSource');
    if (!bar) return;
    if (!IS_EXT) { bar.hidden = true; return; }
    bar.hidden = false;

    if (!jd) {
      bar.classList.add('empty');
      const box = $('jdInput');
      const cur = box ? box.value.trim() : '';
      const stale = cur && jdAutoFilled && cur === jdAutoFilled.trim();

      let msg = stale ? '没识别到岗位 · 下面还是上一个岗位的内容' : '没识别到岗位';
      if (diag) {
        msg += '（关键词节点 ' + (diag.kw == null ? '?' : diag.kw) +
               ' · 选择器命中 ' + (diag.selHit == null ? '?' : diag.selHit) + ' 字）';
      }
      $('jdSourceText').textContent = msg + ' · 在页面上选中 JD 文字后点「重新读取」也行';
      return;
    }
    bar.classList.remove('empty');
    const bits = [];
    if (jd.site) bits.push(jd.site);
    if (jd.title) bits.push(jd.title);
    bits.push(jd.length + ' 字');
    if (jd.from === 'selection') bits.push('你选中的文字');
    else if (jd.from === 'generic' || jd.from === 'class') bits.push('自动识别，建议核对');
    $('jdSourceText').textContent = '已识别当前页面 · ' + bits.join(' · ');
  }

  function hideNewChip() {
    const c = $('jdNew');
    if (c) c.hidden = true;
  }

  function showNewChip(jd) {
    const c = $('jdNew');
    if (!c) return;
    $('jdNewTitle').textContent = jd.title || jd.site || '新岗位';
    c.hidden = false;
    c.__jd = jd;
  }

  /* 记住上一次 JD 来自哪个页面 / 标题，用来区分"同一岗位内容抖动"和"真的换了岗位" */
  let currentJdUrl = '';
  let currentJdTitle = '';

  function switchPersonaSilently(id) {
    if (!id || id === state.activePersona) return false;
    state.activePersona = id;
    personaSource = 'auto';
    save();
    renderPersonaSwitch();
    return true;
  }

  /* 极简指纹：用来判断"这份 JD 是否已经用模型定过身份" */
  function jdFingerprint(s) {
    const t = String(s || '').trim();
    let h = 0;
    for (let i = 0; i < t.length; i++) {
      h = (h * 31 + t.charCodeAt(i)) | 0;
    }
    return t.length + ':' + (h >>> 0);
  }

  /* 换岗位后立刻用模型定身份（几十个 token 的短调用），
     本地词频分不清「Agent 测试」和「Agent 开发」，这一步才是准的 */
  let pickCache = { fp: '', promise: null };

  function autoPickPersona(jdText) {
    const fb = getFactBase();
    const personas = (fb && fb.personas) || [];
    /* 用户手动选过身份就不再让模型改：迟到的推荐不能覆盖人的选择（J10） */
    if (personaSource === 'manual') return Promise.resolve(false);
    if (!jdText || personas.length < 2 || !canCallLLM()) return Promise.resolve(false);

    const fp = jdFingerprint(jdText);
    if (pickCache.fp === fp && pickCache.promise) return pickCache.promise;

    const run = (async () => {
      const pick = await chatJson(
        PROMPTS.pickPersona(jdText, personas),
        { temperature: 0, maxTokens: 80 }
      );
      const target = personas.find(p => p.id === (pick && pick.id));
      /* 期间用户可能已经翻到别的岗位了，指纹不一致就丢弃这次结果 */
      if (!target) return false;
      if (jdFingerprint($('jdInput').value.trim()) !== fp) return false;
      /* 也可能这几秒里事实库被清空/重建了：目标身份必须还在**当前**事实库里，否则不写回
         （否则会出现「简历 0 份、无事实库，activePersona 却是 p1」——R05） */
      const now = (getFactBase() && getFactBase().personas) || [];
      if (!now.some(p => p.id === target.id)) return false;
      /* 请求在途期间用户手动选了身份：这次迟到的推荐必须作废（D1） */
      if (personaSource === 'manual') return false;
      const changed = switchPersonaSilently(target.id);
      if (changed) renderPersonaHint();
      return changed;
    })();

    pickCache = { fp: fp, promise: run.catch(() => false) };
    return pickCache.promise;
  }

  function setJdFromPage(jd, opt) {
    opt = opt || {};
    if (!jd || !jd.text) return false;
    const box = $('jdInput');
    const current = box.value.trim();
    const next = String(jd.text).trim();
    const clean = current === '' || current === jdAutoFilled.trim();

    const samePage = !!jd.url && jd.url === currentJdUrl;

    if (jd.title) currentJdTitle = jd.title;

    /* 同一页面上的内容变化（SPA 局部刷新、懒加载补全）：
       只更新文本框；但正文真的变了就必须让在途请求过期，
       否则迟到的旧分析会贴到新内容上（只比 URL 或字数是不够的）。 */
    if (samePage) {
      if (next !== current) {
        /* 用户手动改过 JD：同 URL 的自动更新不能直接盖掉草稿，只提示载入（D8） */
        if (!clean && !opt.force) {
          showNewChip(jd);
          updateSourceBar(jd);
          return false;
        }
        box.value = next;
        jdAutoFilled = next;
        analyzeToken++;
        state.projection = null;
        state.projectionNote = '';
        state.projectionPersona = null;
        state.projectionJd = '';
        renderResult();
        maybeAutoAnalyze();
      }
      updateSourceBar(jd);
      return true;
    }

    if (!clean && !opt.force) {
      showNewChip(jd);
      return false;
    }

    if (next === current && state.projection) {
      updateSourceBar(jd);
      currentJdUrl = jd.url || currentJdUrl;
      return true;
    }

    box.value = next;
    jdAutoFilled = next;
    currentJdUrl = jd.url || '';
    state.projection = null;
    state.projectionNote = '';
    state.projectionPersona = null;
    state.projectionJd = '';
    hideNewChip();
    updateSourceBar(jd);

    /* 真的换了岗位：作废还在跑的分析，免得旧岗位的结果贴到新 JD 上 */
    analyzeToken++;

    /* 身份自动匹配：先用本地规则秒切，再让模型确认一次（几十个 token，1–2 秒） */
    const rec = recommendPersona(next, jd.title || '');
    if (rec) switchPersonaSilently(rec.id);

    renderPersonaHint();
    updateAnalyzeHint();
    renderResult();

    /* 手动模式只读 JD、做本地推荐，不发任何模型请求；自动模式按快照去重再分析 */
    if (state.settings.analysisMode === 'auto') autoPickPersona(next).catch(() => {});
    maybeAutoAnalyze();
    return true;
  }

  /* 这个站点没在 manifest 的 matches 里声明，内容脚本不会被自动注入。
     用 activeTab（用户点过扩展图标就有时效授权）按需注入一次。 */
  async function injectContentScript(tabId) {
    try {
      if (!chrome.scripting) return 'unsupported';
      await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content.js'] });
      return 'ok';
    } catch (e) {
      return 'denied';
    }
  }

  async function pullFromPage(force) {
    if (!IS_EXT) return null;
    let tabId = null;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tabs && tabs[0] ? tabs[0].id : null;
    } catch (e) { /* ignore */ }
    if (!tabId) { updateSourceBar(null); return null; }

    let resp = null;
    let noScript = false;

    try {
      resp = await chrome.tabs.sendMessage(tabId, { type: 'GET_JD' });
    } catch (e) {
      /* 首选方案没接住 → 多半是没在这个站点声明内容脚本，按需注入再试一次 */
      const inj = await injectContentScript(tabId);
      if (inj === 'ok') {
        await new Promise(r => setTimeout(r, 150));
        try { resp = await chrome.tabs.sendMessage(tabId, { type: 'GET_JD' }); }
        catch (e2) { resp = null; }
      }
      if (!resp) noScript = (inj === 'denied');
    }

    if (resp && resp.jd) {
      setJdFromPage(resp.jd, { force: !!force });
      return resp.jd;
    }

    /* 兜底一：用户自己在页面上选中了 JD 文字 */
    let sel = null;
    try { sel = await chrome.tabs.sendMessage(tabId, { type: 'GET_SELECTION' }); }
    catch (e) { sel = null; }
    const selText = sel && sel.text ? String(sel.text).trim() : '';

    if (selText.length >= 60) {
      const selJd = {
        site: '当前页面 · 你选中的文字',
        title: '',
        text: selText.slice(0, 8000),
        length: selText.length,
        from: 'selection'
      };
      setJdFromPage(selJd, { force: true });
      return selJd;
    }

    if (noScript) {
      const bar = $('jdSource');
      if (bar) {
        bar.hidden = false;
        bar.classList.add('empty');
        $('jdSourceText').textContent =
          '没有这个页面的读取权限 · 点一下浏览器工具栏上的扩展图标，再点「重新读取」';
      }
      toast('刷新一下招聘页面，脚本才会生效');
      return null;
    }

    updateSourceBar(null, resp && resp.diag);
    return null;
  }

  /* 这个面板属于哪个窗口：岗位推送只接受本窗口来的（D6） */
  let panelContext = { windowId: null, tabId: null };

  function isFromCurrentWindow(source) {
    if (!source) return true;                       // 内部路径 / 旧消息没带来源
    if (panelContext.windowId == null || source.windowId == null) return true;
    return source.windowId === panelContext.windowId;
  }

  function listenExtension() {
    if (!IS_EXT) return;
    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (!msg) return;
        if (msg.type === 'JD_PUSH') {
          /* 别的窗口的活动岗位不能覆盖这个面板（每个窗口都有一个 active 标签页） */
          if (!isFromCurrentWindow(msg.source)) return;
          if (msg.jd) setJdFromPage(msg.jd, { force: !msg.soft });
          else updateSourceBar(null);
        }
      });
    } catch (e) { /* ignore */ }
  }

  /* 告诉后台「面板现在是真开着」。
     侧边栏是窗口级的，开关状态只有面板页自己最清楚，而「被关掉」这件事
     靠 window 的 pagehide / beforeunload 收不到（本机 Edge 实测完全不触发，
     chrome.sidePanel.onOpened / onClosed 同样不触发），所以改用一条长连接：
     页面活着 → 端口在 → 后台认为面板开着；面板被关（用户点 × 或调 close）→
     文档销毁 → 端口断开 → 后台记成关着。SW 被回收后自动重连，不会漏记。 */
  function reportPanelLifecycle() {
    if (!IS_EXT) return;
    let winId = null;
    let port = null;
    let retryTimer = null;

    const reconnectLater = () => {
      if (retryTimer) return;
      retryTimer = setTimeout(() => { retryTimer = null; connect(); }, 800);
    };

    const connect = () => {
      if (port) return;
      try {
        port = chrome.runtime.connect({ name: 'tq30s-panel' });
        port.onDisconnect.addListener(() => {
          void chrome.runtime.lastError;
          port = null;
          /* 后台 service worker 被回收会断掉这条连接，重连上就行 */
          reconnectLater();
        });
        if (winId != null) port.postMessage({ type: 'PANEL_ALIVE', windowId: winId });
      } catch (e) {
        port = null;
        reconnectLater();
      }
    };

    try {
      if (!chrome.windows || !chrome.windows.getCurrent) { connect(); return; }
      /* 扩展页被当普通标签页打开时**不能报活**：否则这个窗口会被记成「面板开着」，
         点球第一下走 close 分支、什么都不发生（要第二下才开）。
         判据：面板文档里 chrome.tabs.getCurrent 返回 null；扩展页在标签里返回 Tab。 */
      const begin = () => chrome.windows.getCurrent((w) => {
        void chrome.runtime.lastError;
        if (w && typeof w.id === 'number') winId = w.id;
        connect();
      });
      if (chrome.tabs && chrome.tabs.getCurrent) {
        chrome.tabs.getCurrent((t) => {
          void chrome.runtime.lastError;
          if (t) return;      /* 我是标签页：不报活 */
          begin();
        });
      } else {
        begin();
      }
    } catch (e) {
      connect();
    }
  }

  async function ensureHostPermission(baseUrl) {
    if (!IS_EXT || !chrome.permissions) return true;
    let origin = '';
    try { origin = new URL(baseUrl).origin + '/*'; } catch (e) { return true; }
    const known = [
      'https://api.deepseek.com/*',
      'https://dashscope.aliyuncs.com/*',
      'https://api.moonshot.cn/*',
      'https://open.bigmodel.cn/*',
      'https://api.openai.com/*',
      'http://127.0.0.1/*',
      'http://localhost/*'
    ];
    if (known.indexOf(origin) >= 0) return true;
    try {
      return await chrome.permissions.request({ origins: [origin] });
    } catch (e) {
      return false;
    }
  }

  /* ============================================================
     渲染：我的身份
     ============================================================ */

  function renderPersonaGrid() {
    const fb = getFactBase();
    if (!fb) {
      $('personaIntro').textContent = '还没有你的数据。录入一次简历后，这里会长出你能投的几个方向。';
      $('personaGrid').innerHTML = emptyCard('', '还没有身份',
        '一份事实库能派生出多个身份——硬件、嵌入式、售前、产品，都从同一批事实里来。');
      wireEmpty($('personaGrid'));
      return;
    }
    const personas = (fb.personas || []).slice().sort((a, b) => (b.strength || 0) - (a.strength || 0));

    $('personaIntro').innerHTML = fb.meta && fb.meta.headline
      ? '『' + esc(fb.meta.headline) + '』' +
        (personas.length && personas[0].strength >= 4
          ? '　<b>' + esc(personas[0].name) + '</b> 素材最厚，一直没往这个方向投的话，可能投错了。'
          : '')
      : '';

    $('personaGrid').innerHTML = personas.map((p) => {
      const s = p.strength || 0;
      const bars = [1, 2, 3, 4, 5].map(i => '<i class="' + (i <= s ? 'on' : '') + '"></i>').join('');
      const isActive = p.id === state.activePersona;
      return '<div class="persona-card ' + (isActive ? 'active' : '') + '">' +
        '<div class="pc-head">' +
          '<div><div class="pc-name">' + esc(p.name) + '</div>' +
          '<div class="pc-role">' + s + '/5 素材支撑度</div></div>' +
          '<div class="pc-idx">' + esc(p.id) + '</div>' +
        '</div>' +
        '<div class="strength-bar">' + bars + '</div>' +
        '<div class="pc-thesis">' + esc(p.thesis || '') + '</div>' +
        (p.srcHint ? '<div class="pc-src">来源：' + esc(p.srcHint) + '</div>' : '') +
        ((p.focus || []).length
          ? '<div class="pc-jobs" style="margin-bottom:10px">' +
            p.focus.map(f => '<span class="job-chip">' + esc(f) + '</span>').join('') + '</div>'
          : '') +
        '<div class="pc-jobs">' + (p.jobs || []).map(j => '<span class="job-chip">' + esc(j) + '</span>').join('') + '</div>' +
        (s <= 2 ? '<div class="hl-avoid" style="margin-top:10px">这个方向素材偏薄，AI 帮不了你——' +
          '先去补一个最小的作品（比如一份 PRD），比改简历有用。</div>' : '') +
        '</div>';
    }).join('');
  }

  /* ============================================================
     渲染：事实库
     ============================================================ */

  function renderFacts() {
    const fb = getFactBase();
    if (!fb) {
      const h = $('factsSummary');
      if (h) h.remove();
      $('factsList').innerHTML = emptyCard('', '事实库是空的',
        '这里存的中性的原子事实——不是一份简历，而是可以被反复重排、改写的原料。');
      wireEmpty($('factsList'));
      return;
    }
    const total = (fb.experiences || []).reduce((n, e) => n + (e.bullets || []).length, 0);

    let head = $('factsSummary');
    if (!head) {
      head = document.createElement('div');
      head.id = 'factsSummary';
      head.className = 'panel';
      $('factsList').parentNode.insertBefore(head, $('factsList'));
    }
    head.innerHTML = '<div class="panel-head" style="margin-bottom:6px">' +
      '<h2>共 ' + total + ' 条事实 · ' + (fb.experiences || []).length + ' 段经历</h2>' +
      '<span class="hint">' + esc((fb.meta && fb.meta.headline) || '') + '</span></div>' +
      '<div class="pc-jobs">' + (fb.skills || []).map(s => '<span class="job-chip">' + esc(s) + '</span>').join('') + '</div>';

    $('factsList').innerHTML = (fb.experiences || []).map((exp) => {
      return '<div class="fact-group">' +
        '<div class="fg-head">' +
          '<div><div class="fg-org">' + esc(exp.org) + '</div>' +
          '<div class="fg-role">' + esc(exp.role) + '</div></div>' +
          '<div class="fg-period">' + esc(exp.period) + '</div>' +
        '</div>' +
        (exp.bullets || []).map((b) => {
          const evMap = { strong: 'ev-strong', medium: 'ev-medium', weak: 'ev-weak' };
          const evTxt = { strong: '强证据', medium: '中证据', weak: '弱证据' };
          return '<div class="fact-item">' +
            '<span class="fi-id">' + esc(b.id) + '</span>' +
            '<div class="fi-body">' +
              '<div class="fi-text">' + esc(b.text) + '</div>' +
              '<div class="fi-meta">' +
                '<span class="ev ' + (evMap[b.evidence] || 'ev-medium') + '">' +
                  (evTxt[b.evidence] || '中证据') + '</span>' +
                (b.metrics || []).map(m => '<span class="metric">' + esc(m) + '</span>').join('') +
                (b.tags || []).map(t => '<span class="tag t-' + esc(t) + '">' + esc(t) + '</span>').join('') +
                (b.skills || []).map(s => '<span class="tag">' + esc(s) + '</span>').join('') +
                (b.src ? '<span class="tag">来自简历 ' + esc(b.src) + '</span>' : '') +
              '</div>' +
            '</div></div>';
        }).join('') +
        '</div>';
    }).join('');
  }

  /* ============================================================
     挖料录入
     ============================================================ */

  let parsingFile = false;

  function setFileStatus(cls, html) {
    const el = $('fileStatus');
    if (!el) return;
    el.hidden = false;
    el.className = 'file-status ' + cls;
    el.innerHTML = html;
  }

  /* ---------------- 简历库 ---------------- */

  /* 简历集合的指纹：任何增删改都会变，用来判断事实库是否过期 */
  function resumesKey() {
    return state.resumes
      .map(r => r.id + ':' + (r.chars || 0) + ':' + (r.addedAt || 0))
      .join('|');
  }

  function factIsStale() {
    if (!state.myFactBase) return false;
    return state.myFactBase.__builtFrom !== resumesKey();
  }

  function previewOf(text) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    return s.length > 46 ? s.slice(0, 46) + '…' : s;
  }

  function renderResumeList() {
    const block = $('resumeBlock');
    const list = $('resumeList');
    const title = $('resumeListTitle');
    if (!block || !list) return;

    const n = state.resumes.length;
    block.hidden = false;
    syncResumeFold();

    if (title) {
      title.textContent = n ? ('已添加 ' + n + ' 份简历') : '简历库是空的';
    }

    if (!n) {
      list.innerHTML = '<div class="ri-empty">' +
        (state.myFactBase
          ? '你已有一个事实库，但旧版本没有保存简历原文（生成完就丢了）。<br>' +
            '把简历重新拖进来，再点一次「生成事实库与身份」就会覆盖旧的。'
          : '把简历拖到上面的框里，或粘贴后点「+ 添加这份」。') +
        '</div>';
      updateResumeIndicators();
      return;
    }

    const stale = factIsStale();
    list.innerHTML = state.resumes.map((r, i) =>
      '<div class="resume-item">' +
        '<span class="ri-idx">' + (i + 1) + '</span>' +
        '<div class="ri-body">' +
          '<div class="ri-name" title="' + esc(r.name) + '">' + esc(r.name) + '</div>' +
          '<div class="ri-meta">' + (r.chars || 0) + ' 字 · ' + esc(previewOf(r.text)) + '</div>' +
        '</div>' +
        (stale ? '<span class="ri-stale">待重新生成</span>' : '') +
        '<button class="ri-del" data-del="' + esc(r.id) + '" type="button" title="删除这份" aria-label="删除这份简历">' +
          '<svg class="ico" aria-hidden="true"><use href="#i-trash"/></svg></button>' +
      '</div>'
    ).join('');

    list.querySelectorAll('[data-del]').forEach((b) => {
      b.addEventListener('click', () => removeResume(b.getAttribute('data-del')));
    });

    updateResumeIndicators();
  }

  /* 顶部提示条（简历库空了但还有事实库时） */
  function updateResumeIndicators() {
    const notice = $('intakeNotice');
    if (notice) {
      notice.hidden = !(state.myFactBase && state.resumes.length === 0);
    }

    const facts = state.myFactBase
      ? (state.myFactBase.experiences || []).reduce((n, e) => n + (e.bullets || []).length, 0)
      : 0;
    const status = $('materialStatus');
    if (status) {
      status.textContent = state.resumes.length
        ? state.resumes.length + ' 份简历 · ' + facts + ' 条事实'
        : '还没有简历';
    }

    const ver = $('appVersion');
    if (ver) {
      ver.textContent = 'v' + APP_VERSION +
        ' · 简历 ' + state.resumes.length + ' 份' +
        ' · 事实库' + (state.myFactBase ? '已生成' : '未生成');
    }
  }

  /* ---------------- 事实库 / 身份的来源与清空 ---------------- */

  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => (n < 10 ? '0' + n : String(n));
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function clearFactBase() {
    const had = !!(state.myFactBase || state.projection);
    /* 作废在飞的分析与选身份：分析要几十秒，期间清空事实库/简历，旧结果回来不能贴上去
       （否则「简历 0 份、无事实库，却有一份完整结果」—— R05 的投影半条）。
       autoPickPersona 的写回另有一道「目标身份还在不在当前事实库」的复校。 */
    analyzeToken++;
    state.myFactBase = null;
    state.projection = null;
    state.projectionNote = '';
    state.projectionPersona = null;
    state.projectionJd = '';
    state.activePersona = null;
    state.evalCache = null;
    lastAutoKey = '';
    personaSource = 'auto';
    save();
    refreshAll();
    return had;
  }

  function onClearFacts() {
    if (!state.myFactBase && !state.demoMode) { toast('现在就是空的'); return; }
    if (!confirm('清空所有事实和身份？\n\n简历库会保留，随时可以重新生成。')) return;
    state.demoMode = false;
    clearFactBase();
    toast('已清空事实库与身份');
  }

  /* 导出事实库成 JSON —— 既当备份，也是批量测试的输入 */
  function onExportFacts() {
    const fb = getFactBase();
    if (!fb) { toast('还没有事实库'); return; }
    const payload = {
      exportedAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      factBase: fb
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'factbase-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('已导出，可用于备份或批量测试');
  }

  function renderFactMeta() {
    const fb = state.myFactBase;
    const n = state.resumes.length;
    const stale = factIsStale();

    let line;
    if (fb) {
      line = '基于 <b>' + n + '</b> 份简历生成' +
        (fb.__builtAt ? ' · ' + fmtTime(fb.__builtAt) : '') +
        (stale ? ' · <span class="fm-warn">简历有变动，建议重新生成</span>' : '');
    } else if (state.demoMode) {
      line = '当前显示的是示例数据，不是你的事实库';
    } else {
      line = n
        ? '已有 ' + n + ' 份简历，还没生成事实库'
        : '还没有简历，也就没有事实库';
    }

    const showClear = !!(fb || state.demoMode);
    const html = '<span class="fm-text">' + line + '</span>' +
      (showClear ? '<button class="btn sm danger js-clear-facts">清空事实库与身份</button>' : '');

    ['personaMeta', 'factsMeta'].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.innerHTML = html;
      el.hidden = false;
      el.querySelectorAll('.js-clear-facts').forEach((b) => {
        b.addEventListener('click', onClearFacts);
      });
    });
  }

  function addResume(name, text) {
    const t = String(text || '').trim();
    if (!t) return null;

    const label = name || ('简历 ' + (state.resumes.length + 1));
    const rec = {
      id: 'r' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      name: label,
      text: t.slice(0, 20000),
      chars: t.length,
      addedAt: Date.now()
    };

    /* 同名简历：问一下是替换还是并存 */
    const dupIdx = state.resumes.findIndex(r => r.name === label);
    if (dupIdx >= 0) {
      const replace = confirm(
        '已经有一份同名简历「' + label + '」。\n\n' +
        '【确定】用新上传的替换它（推荐，适合简历改过一版）\n' +
        '【取消】两份都保留（适合同名但定位不同的版本）'
      );
      if (replace) {
        rec.id = state.resumes[dupIdx].id;
        state.resumes[dupIdx] = rec;
        save();
        renderResumeList();
        updateAnalyzeHint();
        return rec;
      }
    }

    state.resumes.push(rec);
    save();
    renderResumeList();
    updateAnalyzeHint();
    return rec;
  }

  function removeResume(id) {
    const i = state.resumes.findIndex(r => r.id === id);
    if (i < 0) return;
    if (!confirm('删除「' + state.resumes[i].name + '」？\n\n删完需要重新点「生成事实库与身份」。')) return;
    state.resumes.splice(i, 1);

    /* 简历删光了，事实库就没有依据了 —— 一起清掉 */
    if (!state.resumes.length && state.myFactBase) {
      clearFactBase();
      toast('简历已全部删除，事实库与身份也一并清空了');
      return;
    }

    save();
    renderResumeList();
    renderFactMeta();
    updateAnalyzeHint();
    toast('已删除，记得重新生成事实库');
  }

  /* 发给模型前裁一下，避免超长 */
  function resumesForPrompt() {
    const MAX_TOTAL = 40000;
    let used = 0;
    return state.resumes.map((r) => {
      const room = Math.max(0, MAX_TOTAL - used);
      const t = String(r.text || '').slice(0, Math.min(String(r.text || '').length, room));
      used += t.length;
      return { name: r.name, text: t };
    }).filter(x => x.text.length > 50);
  }

  async function handleResumeFiles(files) {
    const arr = Array.prototype.slice.call(files || []).filter(Boolean);
    if (!arr.length || parsingFile) return;

    const dz = $('dropZone');
    parsingFile = true;
    if (dz) dz.classList.add('busy');

    let ok = 0;
    const errs = [];

    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      setFileStatus('load', '正在解析 <b>' + esc(f.name || '文件') + '</b>' +
        (arr.length > 1 ? '（' + (i + 1) + '/' + arr.length + '）' : '') + '…');
      try {
        const r = await window.FileParser.parse(f);
        addResume(r.name || f.name, r.text);
        ok++;
      } catch (e) {
        errs.push((f.name || '文件') + '：' + ((e && e.message) || e));
      }
    }

    parsingFile = false;
    if (dz) dz.classList.remove('busy');

    if (ok && !errs.length) {
      setFileStatus('ok', '已添加 <b>' + ok + '</b> 份，现在共 ' + state.resumes.length +
        ' 份简历。<br>确认没问题后点「生成事实库与身份」，会合并成一份事实库。');
      toast('已添加 ' + ok + ' 份简历');
    } else if (ok) {
      setFileStatus('ok', '成功 ' + ok + ' 份，失败 ' + errs.length + ' 份：<br>' + esc(errs.join('；')));
      toast('部分添加成功');
    } else {
      setFileStatus('err', esc(errs.join('；')));
    }
    renderResumeList();
  }

  async function buildFacts() {
    if (!state.resumes.length) {
      toast('先添加至少一份简历');
      return;
    }
    if (!canCallLLM()) {
      toast('需要先在设置里配置模型');
      openSettings();
      return;
    }

    const payload = resumesForPrompt();
    if (!payload.length) { toast('简历内容太短'); return; }

    /* 生成要花几十秒，期间用户完全可能删/加简历。先记下「这次是按哪批简历生成的」，
       回来时对一遍 —— 否则会出现「简历 0 份却有事实库/身份」（R05），
       或者把新简历的变动当成已经生成过（R09）。 */
    const keyAtStart = resumesKey();

    const box = $('intakeResult');
    const btn = $('btnBuildFacts');
    btn.disabled = true;
    btn.textContent = '解析中…';
    box.innerHTML = loadingHtml(
      ['合并 ' + payload.length + ' 份简历 · 去重拆解', '从中派生职业身份'], 0, true);

    try {
      const fb = await chatJson(PROMPTS.buildFacts(payload), { temperature: 0.2, maxTokens: 8000 });
      if (!fb.experiences || !fb.experiences.length) throw new Error('模型没有返回有效的经历数据');

      /* 生成期间简历被清空：结果直接丢弃。没有简历就没有事实库的依据（R05）。 */
      if (!state.resumes.length) {
        box.innerHTML = '<div class="err-box">' +
          '<b>简历已经清空，这次生成的结果已丢弃</b><br>' +
          '没有简历就不会有事实库与身份。重新添加简历后再点「生成事实库与身份」。' +
          '</div>';
        renderResumeList();
        updateDatasetBadge();
        renderPersonaSwitch();
        renderPersonaGrid();
        renderFacts();
        renderFactMeta();
        renderResult();
        updateAnalyzeHint();
        toast('简历已清空，本次生成结果已丢弃');
        return;
      }

      /* 生成期间简历有增删改：结果保留（token 已经花掉了），
         但指纹记成「生成时那批简历」→ 正常显示「待重新生成」（R09/R12）。 */
      const staleDuringBuild = resumesKey() !== keyAtStart;
      fb.__builtFrom = staleDuringBuild ? keyAtStart : resumesKey();
      fb.__builtAt = Date.now();

      state.myFactBase = fb;
      state.demoMode = false;
      state.activePersona = (fb.personas && fb.personas[0]) ? fb.personas[0].id : 'default';
      state.projection = null;
      save();

      const bulletCount = fb.experiences.reduce((n, e) => n + ((e.bullets || []).length), 0);
      box.innerHTML = '<div class="persona-hint show" style="margin-top:16px">' +
        '已合并 ' + payload.length + ' 份简历 → 事实库：' +
        fb.experiences.length + ' 段经历 / ' + bulletCount + ' 条事实 / ' +
        (fb.personas || []).length + ' 个身份。' +
        (staleDuringBuild ? '（生成期间简历有变动，建议重新生成）' : '') +
        '</div>';

      renderResumeList();
      updateDatasetBadge();
      renderPersonaSwitch();
      renderPersonaGrid();
      renderFacts();
      renderResult();
      switchView('personas');
      toast(staleDuringBuild
        ? '事实库已生成，但生成期间简历有变动，建议重新生成'
        : '事实库已生成，去「我的身份」看看');
    } catch (e) {
      const msg = String((e && e.message) || e);
      box.innerHTML = '<div class="err-box">' +
        '<b>生成失败</b><br>' + esc(msg) +
        '<br><br>' +
        '<button class="btn ghost sm" id="btnRetryFacts">重试一次</button>' +
        '</div>';
      const rb = $('btnRetryFacts');
      if (rb) rb.addEventListener('click', buildFacts);
    } finally {
      btn.disabled = false;
      btn.textContent = '生成事实库与身份';
    }
  }

  /* ============================================================
     设置
     ============================================================ */

  function openSettings() {
    $('baseUrl').value = state.settings.baseUrl || '';
    $('apiKey').value = state.settings.apiKey || '';
    $('modelName').value = state.settings.model || '';
    const tm = $('thinkingMode');
    if (tm) tm.value = state.settings.thinking || 'auto';
    const ts = $('themeSelect');
    if (ts) ts.value = currentTheme();
    const as = $('appearanceSelect');
    if (as) as.value = currentAppearance();
    const am = $('analysisMode');
    if (am) am.value = ANALYSIS_MODES.indexOf(state.settings.analysisMode) >= 0 ? state.settings.analysisMode : 'manual';
    $('testResult').textContent = '';
    renderPresets();
    updateResumeIndicators();
    $('settingsModal').classList.add('show');
  }

  function renderPresets() {
    $('presetRow').innerHTML = PRESETS.map(p =>
      '<button class="preset-btn" data-preset="' + esc(p.id) + '">' + esc(p.name) + '</button>'
    ).join('');
    $('presetRow').querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = PRESETS.find(x => x.id === btn.getAttribute('data-preset'));
        if (!p) return;
        $('baseUrl').value = p.baseUrl;
        $('modelName').value = p.model;
        toast('已填入 ' + p.name + ' 的默认配置，别忘了填 Key');
      });
    });
  }

  async function saveSettings() {
    const baseUrl = $('baseUrl').value.trim();
    const beforeModel = state.settings.model;
    const beforeBase = state.settings.baseUrl;
    const beforeThinking = state.settings.thinking;

    /* 表单值先同步落到 state：申请域名权限可能要等用户点确认，
       这期间用户点「分析」也应该用新配置，而不是旧模型（否则快照 key 会算错）。 */
    state.settings.baseUrl = baseUrl;
    state.settings.apiKey = $('apiKey').value.trim();
    state.settings.model = $('modelName').value.trim();
    const tm = $('thinkingMode');
    state.settings.thinking = tm ? tm.value : 'auto';
    const am = $('analysisMode');
    state.settings.analysisMode = am && ANALYSIS_MODES.indexOf(am.value) >= 0 ? am.value : 'manual';
    /* 切到手动后，自动模式记住的快照不能再触发一次分析 */
    if (state.settings.analysisMode !== 'auto') lastAutoKey = analysisKey(getPersona(state.activePersona));
    /* 界面外观也一起落盘，下次打开还是同一套 */
    state.settings.theme = currentTheme();
    state.settings.appearance = currentAppearance();
    save();
    /* 模型/接口/思考模式变了 = 在途的那次分析已经不是当前配置的结果，作废（D3） */
    if (analyzing && (beforeModel !== state.settings.model ||
        beforeBase !== state.settings.baseUrl ||
        beforeThinking !== state.settings.thinking)) {
      analyzeToken++;
    }

    /* 自定义接口需要动态申请域名权限，否则后台请求会被拦 */
    if (baseUrl) {
      const granted = await ensureHostPermission(baseUrl);
      if (!granted) {
        toast('这个接口域名没拿到授权，请求会失败。换用内置服务商即可。');
      }
    }

    updateAnalyzeHint();
    $('settingsModal').classList.remove('show');
    toast(canCallLLM() ? '已保存，现在可以分析任意 JD 了' : '已保存（还缺 Key 或模型名）');
  }

  async function testModel() {
    const out = $('testResult');
    out.textContent = '测试中…';
    const backup = Object.assign({}, state.settings);
    state.settings.baseUrl = $('baseUrl').value.trim();
    state.settings.apiKey = $('apiKey').value.trim();
    state.settings.model = $('modelName').value.trim();
    try {
      const r = await chat(PROMPTS.ping(), { temperature: 0, maxTokens: 100 });
      out.textContent = '连接成功：' + String(r).slice(0, 60);
    } catch (e) {
      out.textContent = '连接失败：' + (e.message || e);
    }
    state.settings = backup;
  }

  /* ============================================================
     视图切换 / 初始化
     ============================================================ */

  function switchView(name) {
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.getAttribute('data-view') === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    if (name === 'personas') renderPersonaGrid();
    if (name === 'facts') renderFacts();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateDatasetBadge() {
    const badge = $('datasetBadge');
    if (!badge) return;
    const demo = state.demoMode && !state.myFactBase;
    badge.hidden = !demo;
    badge.classList.toggle('live', false);
    if (demo) {
      const label = $('datasetLabel');
      if (label) label.textContent = '示例数据 · 点此退出';
    }
  }

  function updateAnalyzeHint() {
    const el = $('analyzeHint');
    if (el) {
      if (!canCallLLM()) el.textContent = '未配置模型';
      else if (!hasData()) el.textContent = state.resumes.length ? '先点右边生成事实库' : '先添加简历';
      else el.textContent = '将调用 ' + state.settings.model + ' 分析';
    }
    const ih = $('intakeHint');
    if (ih) {
      if (!canCallLLM()) ih.textContent = '需先在设置里配置模型';
      else if (!state.resumes.length) ih.textContent = '先添加至少一份简历';
      else ih.textContent = '将合并 ' + state.resumes.length + ' 份 · ' + state.settings.model;
    }
  }

  function bind() {
    document.querySelectorAll('.tab').forEach((t) => {
      t.addEventListener('click', () => switchView(t.getAttribute('data-view')));
    });

    $('btnSettings').addEventListener('click', openSettings);

    /* 顶栏上传：四个页签都可用，直接调起真实文件选择器 */
    const btnUploadTop = $('btnUploadTop');
    if (btnUploadTop) {
      btnUploadTop.addEventListener('click', () => {
        const fi = $('fileInput');
        if (fi) fi.click();
      });
    }

    /* 外观切换：立即生效、立即落盘，不重绘内容 */
    const themeSelect = $('themeSelect');
    if (themeSelect) {
      themeSelect.addEventListener('change', () => {
        state.settings.theme = themeSelect.value;
        applyTheme(state.settings.theme, currentAppearance());
        save();
      });
    }
    const appearanceSelect = $('appearanceSelect');
    if (appearanceSelect) {
      appearanceSelect.addEventListener('change', () => {
        state.settings.appearance = appearanceSelect.value;
        applyTheme(currentTheme(), state.settings.appearance);
        save();
      });
    }

    /* 重新加载整个面板：改了扩展、状态不对、切了岗位都能用 */
    const btnReload = $('btnReload');
    if (btnReload) {
      btnReload.addEventListener('click', () => {
        if (btnReload.disabled) return;
        btnReload.disabled = true;
        btnReload.classList.add('spin');
        toast('正在重新加载面板…');
        try { sessionStorage.setItem('tq30s.justReloaded', '1'); } catch (e) { /* ignore */ }
        setTimeout(() => location.reload(), 480);
      });
    }

    const btnGotoIntake = $('btnGotoIntake');
    if (btnGotoIntake) {
      btnGotoIntake.addEventListener('click', () => switchView('resumes'));
    }
    $('btnCloseSettings').addEventListener('click', () => $('settingsModal').classList.remove('show'));
    $('btnSaveSettings').addEventListener('click', saveSettings);
    $('btnTestModel').addEventListener('click', testModel);
    $('settingsModal').addEventListener('click', (e) => {
      if (e.target === $('settingsModal')) $('settingsModal').classList.remove('show');
    });

    $('btnReset').addEventListener('click', () => {
      if (!confirm('会清空本地保存的简历数据和 API Key，确定吗？')) return;
      /* 作废在飞的分析：清空之后旧结果回来不能把投影写回来（R05） */
      analyzeToken++;
      wipe();
      state.resumes = [];
      state.myFactBase = null;
      state.demoMode = false;
      state.settings = {
        baseUrl: '', apiKey: '', model: '', thinking: 'auto',
        analysisMode: 'manual',
        theme: DEFAULT_THEME, appearance: DEFAULT_APPEARANCE
      };
      state.evalCache = null;
      lastAutoKey = '';
      personaSource = 'auto';
      applyTheme(DEFAULT_THEME, DEFAULT_APPEARANCE);
      state.projection = null;
      state.projectionNote = '';
      state.projectionPersona = null;
      state.projectionJd = '';
      state.activePersona = null;
      updateDatasetBadge();
      updateAnalyzeHint();
      renderPersonaSwitch();
      renderPersonaGrid();
      renderFacts();
      renderResult();
      $('settingsModal').classList.remove('show');
      toast('已清空');
    });

    $('btnAnalyze').addEventListener('click', analyze);
    $('btnSampleJd').addEventListener('click', () => {
      $('jdInput').value = DEMO.sampleJd;
      syncJdFold();
      renderPersonaHint();
      updateAnalyzeHint();
      toast('已填入示例 JD，点「分析」');
    });
    $('btnClearJd').addEventListener('click', () => {
      $('jdInput').value = '';
      jdAutoFilled = '';
      state.projection = null;
      state.projectionNote = '';
      state.projectionPersona = null;
      state.projectionJd = '';
      syncJdFold();
      renderPersonaHint();
      renderResult();
    });

    /* --- 扩展：从页面读取 / 新岗位提示 --- */
    const btnPull = $('btnPullJd');
    if (btnPull) btnPull.addEventListener('click', () => pullFromPage(true));

    const btnLoadNew = $('btnLoadNewJd');
    if (btnLoadNew) btnLoadNew.addEventListener('click', () => {
      const c = $('jdNew');
      if (c && c.__jd) setJdFromPage(c.__jd, { force: true });
    });

    const btnDropNew = $('btnDropNewJd');
    if (btnDropNew) btnDropNew.addEventListener('click', hideNewChip);

    $('jdInput').addEventListener('input', () => {
      /* 只更新摘要，不自动开合折叠区：正在编辑时把输入框收起是最烦人的 */
      syncJdFold(false);
      /* 手动改 JD = 输入变了：在途的分析结果已经对不上，直接作废（D2） */
      if (analyzing) analyzeToken++;
      markJdChanged();
      renderPersonaHint();
      updateAnalyzeHint();
    });

    $('resumeInput').addEventListener('input', () => {
      $('resumeCount').textContent = $('resumeInput').value.trim().length + ' 字';
    });

    /* --- 简历文件上传：点选（可多选）+ 拖拽 --- */
    (function bindUpload() {
      const dz = $('dropZone');
      const fi = $('fileInput');
      if (!dz || !fi) return;

      $('btnPickFile').addEventListener('click', (e) => {
        e.stopPropagation();
        fi.click();
      });
      dz.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'btnPickFile') return;
        fi.click();
      });
      fi.addEventListener('change', () => {
        if (fi.files && fi.files.length) handleResumeFiles(fi.files);
        fi.value = '';
      });

      ['dragenter', 'dragover'].forEach((ev) => {
        dz.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.add('drag'); });
      });
      ['dragleave', 'dragend'].forEach((ev) => {
        dz.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.remove('drag'); });
      });
      dz.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.remove('drag');
        const files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length) handleResumeFiles(files);
      });
      ['dragover', 'drop'].forEach((ev) => {
        window.addEventListener(ev, (e) => {
          if (!dz.contains(e.target)) e.preventDefault();
        });
      });
    })();

    /* --- 粘贴一份 → 加入简历库 --- */
    const btnAddPaste = $('btnAddPaste');
    if (btnAddPaste) {
      btnAddPaste.addEventListener('click', () => {
        const t = $('resumeInput').value.trim();
        if (t.length < 80) { toast('太短了，至少 80 字'); return; }
        addResume('粘贴的简历 ' + (state.resumes.length + 1), t);
        $('resumeInput').value = '';
        $('resumeCount').textContent = '0 字';
        toast('已加入简历库，共 ' + state.resumes.length + ' 份');
      });
    }

    const btnClearResumes = $('btnClearResumes');
    if (btnClearResumes) {
      btnClearResumes.addEventListener('click', () => {
        if (!state.resumes.length) return;
        const n = state.resumes.length;
        const willDrop = !!state.myFactBase;
        if (!confirm('清空全部 ' + n + ' 份简历？' +
          (willDrop ? '\n\n简历删光后，事实库与身份也会一起清空。' : ''))) return;

        state.resumes = [];
        if (willDrop) {
          clearFactBase();
          toast('已清空简历，事实库与身份也一起清空了');
        } else {
          save();
          renderResumeList();
          renderFactMeta();
          updateAnalyzeHint();
          toast('已清空简历');
        }
      });
    }

    const btnExportFacts = $('btnExportFacts');
    if (btnExportFacts) btnExportFacts.addEventListener('click', onExportFacts);

    const btnRebuild = $('btnRebuild');
    if (btnRebuild) {
      btnRebuild.addEventListener('click', () => {
        if (!state.resumes.length) {
          toast('先添加至少一份简历');
          switchView('resumes');
          return;
        }
        switchView('resumes');
        buildFacts();
      });
    }
    $('btnBuildFacts').addEventListener('click', buildFacts);

    $('datasetBadge').addEventListener('click', () => {
      if (state.demoMode) exitDemo();
    });
  }

  async function init() {
    await load();

    /* 先把保存过的外观套上，避免首屏闪一下默认色 */
    applyTheme(currentTheme(), currentAppearance());

    /* ---------- 扩展侧边栏模式 ---------- */
    if (IS_EXT) {
      document.body.classList.add('ext');

      const kh = $('keyHint');
      if (kh) {
        kh.innerHTML = 'Key 只存在你本机浏览器的扩展存储里，由扩展后台直接请求模型，' +
          '<b>不经过任何第三方服务器，也没有日志</b>。';
      }
      const jh = $('jdPanelHint');
      if (jh) jh.textContent = '切到招聘网站，这里会自动识别当前岗位';
    }

    bind();
    refreshAll();

    /* 从 ⟳ 重新加载过来的，给一个明确的完成反馈 */
    try {
      if (sessionStorage.getItem('tq30s.justReloaded') === '1') {
        sessionStorage.removeItem('tq30s.justReloaded');
        setTimeout(() => toast('面板已重新加载'), 350);
      }
    } catch (e) { /* ignore */ }

    /* ---------- 扩展：优先吃页内按钮带过来的 JD ---------- */
    if (IS_EXT) {
      /* 记住这个面板属于哪个窗口/标签页：推送只接受本窗口的，切标签页要重新读 */
      try {
        const win = await new Promise((resolve) => {
          try { chrome.windows.getCurrent((w) => resolve(w)); } catch (e) { resolve(null); }
        });
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        panelContext = {
          windowId: win && typeof win.id === 'number' ? win.id : null,
          tabId: tabs && tabs[0] && typeof tabs[0].id === 'number' ? tabs[0].id : null
        };
      } catch (e) { /* ignore */ }

      /* 用户切到另一个已经打开的招聘标签页：主动重读一次岗位（D7） */
      try {
        if (chrome.tabs && chrome.tabs.onActivated && chrome.tabs.onActivated.addListener) {
          chrome.tabs.onActivated.addListener((info) => {
            if (info && panelContext.windowId != null && info.windowId != null &&
                info.windowId !== panelContext.windowId) return;
            if (info && info.tabId != null) panelContext.tabId = info.tabId;
            pullFromPage(false);
          });
        }
      } catch (e) { /* ignore */ }

      listenExtension();
      reportPanelLifecycle();

      const pending = await sendBg({ type: 'PULL_PENDING', windowId: panelContext.windowId });
      if (pending && pending.jd) {
        setJdFromPage(pending.jd, { force: true });
        renderResult();
        /* 手动模式：只填入 JD，不替用户调用模型 */
        maybeAutoAnalyze();
      } else {
        const jd = await pullFromPage(false);
        if (!jd) {
          updateSourceBar(null);
          renderResult();
        }
      }
      return;
    }

    /* ---------- 独立网页模式 ---------- */

    /* 明确告诉用户「这不是扩展」，避免把预览当成产品 */
    try {
      const dismissed = localStorage.getItem('tq30s.bannerDismissed') === '1';
      const banner = $('previewBanner');
      if (!dismissed && banner) {
        banner.hidden = false;
        const close = $('pbClose');
        if (close) {
          close.addEventListener('click', () => {
            banner.hidden = true;
            try { localStorage.setItem('tq30s.bannerDismissed', '1'); } catch (e2) { /* ignore */ }
          });
        }
      }
    } catch (e) { /* ignore */ }

    /* 支持 ?view=personas 这样的直达参数 */
    try {
      const v = new URLSearchParams(location.search).get('view');
      if (v) switchView(v);
    } catch (e) { /* ignore */ }
  }

  document.addEventListener('DOMContentLoaded', init);
})();

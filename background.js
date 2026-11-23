/* ============================================================
   后台 Service Worker
   ------------------------------------------------------------
   1. 统一代理模型调用（带 host_permissions，不受 CORS 限制）
   2. 管理侧边栏的打开与 JD 推送
   3. 不做任何数据上传：key 由页面传入，用完即弃，不落盘、不写日志
   ============================================================ */

const LLM_TIMEOUT_MS = 120000;

/* ---------------- 启动 ---------------- */

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  });
}

/* ---------------- 模型调用 ---------------- */

async function callLLM(p) {
  const base = String(p.baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('缺少接口地址');
  if (!p.model) throw new Error('缺少模型名');

  const url = base + '/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (p.apiKey) headers['Authorization'] = 'Bearer ' + p.apiKey;

  const body = {
    model: p.model,
    messages: p.messages || [],
    temperature: p.temperature == null ? 0.3 : p.temperature,
    stream: false
  };
  if (p.maxTokens) body.max_tokens = p.maxTokens;
  /* 思考模式开关（deepseek 系支持）：deepseek 默认开启，关闭可省 15–25 秒 */
  if (p.thinking === 'disabled' || p.thinking === 'enabled') {
    body.thinking = { type: p.thinking };
  }

  const wantJson = p.jsonMode !== false;
  if (wantJson) body.response_format = { type: 'json_object' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);

  try {
    let res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal
    });

    // 400/422 的两种常见情况，各降级重试一次
    if (!res.ok && (res.status === 400 || res.status === 422)) {
      const detail = await res.clone().text().catch(() => '');

      // ① 部分厂商不支持 response_format
      if (wantJson) {
        delete body.response_format;
        res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: ctrl.signal
        });
      }

      // ② 部分厂商不接受这么大的 max_tokens
      if (!res.ok && /max_tokens|max output|maximum|too large|exceed/i.test(detail)) {
        body.max_tokens = 4096;
        res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: ctrl.signal
        });
      }
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error('模型接口 HTTP ' + res.status + '：' + detail.slice(0, 300));
    }

    const data = await res.json();
    const choice = data && data.choices && data.choices[0];
    const content = choice && choice.message && choice.message.content;
    if (!content) throw new Error('模型返回内容为空');
    return { content: content, finishReason: (choice && choice.finish_reason) || null };
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('模型响应超时（>120s）');
    if (e instanceof TypeError) {
      throw new Error('无法连接模型接口。可能是：接口地址写错、网络不通，或该域名未授权（设置里换用内置服务商可避免）');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- 工具 ---------------- */

function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

/* ---------------- 侧边栏开关状态（窗口级） ----------------
   两条都是实测踩出来的硬约束：

   ① 手势：chrome.sidePanel.open() 必须在收到消息的同一个 task 里同步调用。
      中间只要 await 一次（哪怕只是 storage.session.set 这种内存级操作），
      用户手势就没了，报 `sidePanel.open() may only be called in response
      to a user gesture`。所以「开/关」的 API 调用必须排在所有 await 前面。

   ② 关闭：侧边栏是「窗口级」的，不是标签页级。关要用 close({ windowId })，
      传 tabId 会报 `No active tab-specific side panel for tabId: …`。

   状态怎么来（不能只靠乐观记账）：面板页用一条长连接（port）报活 ——
   端口在就是真开着，端口断了（用户点 × 关面板也一样）就是真关了。
   pagehide / beforeunload / onOpened / onClosed 在本机 Edge 实测都不触发，
   只能当补充信号；最后用 chrome.runtime.getContexts 校准一次兜底，
   保证状态不会被记死后永久卡住。
   ==================================================== */

const PANEL_KEY = 'panelOpenByWindow';

let panelOpen = {};      // { [windowId]: true } —— 手势路径只读这个同步对象
let panelToggleAt = {};  // { [windowId]: 上次点击的时间戳（含被防抖掉的）} —— 400ms 连点防抖（R28b）
let pendingJD = null;    // 面板页 PULL_PENDING 时同步就能拿到的 JD
let pendingJDAt = 0;     // pendingJD 的入队时间：超过 30 秒没人取走就丢弃（R30）
let panelVersion = 0;    // 每来一条开关信号就 +1，用来判断异步快照是否已过期

function setPanelOpen(winId, open) {
  if (winId == null) return;
  /* 先记版本：即使值没变，也说明「刚刚又有新信号了」，正在跑的校准快照作废 */
  panelVersion++;
  const next = !!open;
  if (panelOpen[winId] === next) return;
  panelOpen[winId] = next;
  try {
    chrome.storage.session.set({ [PANEL_KEY]: panelOpen }).catch(() => {});
  } catch (e) { /* 老版本没有 session storage */ }
}

/* 没有任何 SIDE_PANEL 上下文 → 所有窗口实际上都是关着的。
   注意：getContexts 是异步快照，刚调完 open() 时它可能还看不到面板
   （面板上下文要等页面创建完才出现），所以必须挡住过期快照，否则会把
   刚打开的面板误记成「关着」，下一次点击就变成再 open 一次。 */
async function reconcilePanelOpen() {
  try {
    if (typeof chrome.runtime.getContexts !== 'function') return;
    const v = panelVersion;
    const ctx = await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] });
    if (!Array.isArray(ctx) || ctx.length) return;   // 有面板在跑，不做否证
    if (panelVersion !== v) return;                  // 等待期间来了新信号，快照已过期
    Object.keys(panelOpen).forEach((k) => {
      const winId = Number(k);
      const ports = panelPorts.get(winId);
      if (ports && ports.size) return;               // 该窗口的面板页还连着，别误杀
      setPanelOpen(winId, false);
    });
  } catch (e) { /* ignore */ }
}

/* 同步调用，调用方保证此刻还持有用户手势 */
function openPanel(tabId, winId) {
  try {
    /* 老版本 Chrome 没有 sidePanel.close，关是靠 setOptions 禁用实现的，这里先恢复启用 */
    if (typeof chrome.sidePanel.close !== 'function' && tabId != null) {
      try { chrome.sidePanel.setOptions({ tabId: tabId, enabled: true }).catch(() => {}); } catch (e) { /* ignore */ }
    }
    const p = tabId != null
      ? chrome.sidePanel.open({ tabId: tabId })
      : chrome.sidePanel.open({ windowId: winId });
    if (p && typeof p.catch === 'function') {
      p.catch((e) => {
        setPanelOpen(winId, false);   // 没打开成功就别记成开着
        console.warn('[sidePanel] 打开失败：' + ((e && e.message) || e));
      });
    }
  } catch (e) {
    setPanelOpen(winId, false);
  }
}

/* 同步调用 */
function closePanel(tabId, winId) {
  try {
    if (typeof chrome.sidePanel.close === 'function') {
      const p = chrome.sidePanel.close({ windowId: winId });
      if (p && typeof p.catch === 'function') {
        p.catch((e) => console.warn('[sidePanel] 关闭失败：' + ((e && e.message) || e)));
      }
    } else if (tabId != null) {
      chrome.sidePanel.setOptions({ tabId: tabId, enabled: false }).catch(() => {});
    }
  } catch (e) { /* ignore */ }
}

/* 面板页用一条长连接（port）报活：端口断开 = 面板文档没了，
   用户点面板右上角的 × 关掉也一样。
   —— 这是「用户手动关闭」唯一可靠的信号，本机 Edge 155 实测：
      · pagehide / beforeunload 在侧边栏被关时根本不触发（收不到「已关闭」的通知）
      · chrome.sidePanel.onOpened / onClosed 也一次都不触发
   所以状态要靠这条 port 活着来认，端口没了才记「关着」。 */
const panelPortWindow = new WeakMap();   // port -> windowId
const panelPorts = new Map();            // windowId -> Set<port>

function dropPanelPort(port) {
  const winId = panelPortWindow.get(port);
  if (typeof winId !== 'number') {
    /* 还没报到窗口号就断了：不知道是哪扇窗，整体校准一次 */
    reconcilePanelOpen();
    return;
  }
  const set = panelPorts.get(winId);
  if (set) set.delete(port);
  if (!set || set.size === 0) {
    panelPorts.delete(winId);
    setPanelOpen(winId, false);
  }
}

try {
  chrome.runtime.onConnect.addListener((port) => {
    if (!port || port.name !== 'tq30s-panel') return;
    try {
      port.onMessage.addListener((m) => {
        if (!m || m.type !== 'PANEL_ALIVE' || typeof m.windowId !== 'number') return;
        panelPortWindow.set(port, m.windowId);
        let set = panelPorts.get(m.windowId);
        if (!set) { set = new Set(); panelPorts.set(m.windowId, set); }
        set.add(port);
        setPanelOpen(m.windowId, true);
      });
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        dropPanelPort(port);
      });
    } catch (e) { /* ignore */ }
  });
} catch (e) { /* 老版本没有 onConnect？理论上不会 */ }

/* 面板页是「真的开着」的唯一可信来源：文档在就开着，文档销毁就是被关了 */
try {
  if (chrome.sidePanel.onOpened) {
    chrome.sidePanel.onOpened.addListener((info) => {
      if (info && typeof info.windowId === 'number') setPanelOpen(info.windowId, true);
    });
  }
  if (chrome.sidePanel.onClosed) {
    chrome.sidePanel.onClosed.addListener((info) => {
      if (info && typeof info.windowId === 'number') setPanelOpen(info.windowId, false);
    });
  }
} catch (e) { /* 老版本没有这两个事件 */ }

/* Service Worker 被回收重启后，把上一次的开关状态捞回来再校准 */
(function hydratePanelOpen() {
  try {
    chrome.storage.session.get(PANEL_KEY)
      .then((v) => {
        const saved = v && v[PANEL_KEY];
        if (saved && typeof saved === 'object') {
          /* 内存里刚记的比磁盘新：只补缺，不覆盖 */
          Object.keys(saved).forEach((k) => {
            if (panelOpen[k] === undefined) panelOpen[k] = !!saved[k];
          });
        }
        return reconcilePanelOpen();
      })
      .catch(() => {});
  } catch (e) { /* ignore */ }
})();

/* ---------------- 消息路由 ---------------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  /* --- 模型调用 --- */
  if (msg.type === 'LLM') {
    callLLM(msg.payload)
      .then((r) => sendResponse({ ok: true, content: r.content, finishReason: r.finishReason, usage: r.usage }))
      .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }

  /* --- 页内悬浮球：开 / 关侧边栏，并把 JD 推给面板 --- */
  if (msg.type === 'OPEN_PANEL') {
    /* ==== 手势敏感区：从这里到 openPanel()/closePanel() 之间不许出现 await ==== */
    const tab = (sender && sender.tab) || null;
    const tabId = tab && typeof tab.id === 'number' ? tab.id : null;
    const winId = tab && typeof tab.windowId === 'number' ? tab.windowId : null;

    /* 400ms 内连点只响应第一下（J01/J02 → 测试稿 R28b）。
       必须在 open/close 之前同步判完：这段是手势敏感区，不能 await；
       按窗口去重而不是按页面，才能覆盖「多个标签页同时点」的情况。

       注意窗口要从「上一次点击」起算、而不是从「上一次真正切换」起算：
       真人连点时两次点击的间隔只有一两百毫秒，但一次点击本身就占几十毫秒，
       若只按切换时间算，第 3 下常常已经越过 400ms 又切一次（实测 3 连点 = 2 次切换）。
       所以被防抖掉的那一下也要刷新窗口 —— 整串连点只认第一下，停手 400ms 后才恢复。 */
    if (winId != null) {
      const nowMs = Date.now();
      const lastAt = panelToggleAt[winId] || 0;
      panelToggleAt[winId] = nowMs;
      if (nowMs - lastAt < 400) {
        sendResponse({ ok: true, action: 'debounced' });
        return false;
      }
    }

    let action = 'none';
    if (winId == null) {
      action = 'error';                       // 拿不到窗口：记不了状态，不如不动作
    } else if (panelOpen[winId]) {
      action = 'close';
      setPanelOpen(winId, false);
      closePanel(tabId, winId);
    } else {
      action = 'open';
      setPanelOpen(winId, true);
      openPanel(tabId, winId);
    }

    /* JD 只在「真的要开面板」时入队。
       关面板那一下不能把当前 JD 重新塞回 pendingJD —— 没人会取它，留着只会在下次
       点工具栏图标开面板时被当成「待处理 JD」：自动填入上一个岗位并自动分析（R30）。 */
    const openedAt = Date.now();
    if (action === 'open') {
      pendingJD = msg.jd || null;
      pendingJDAt = openedAt;
    } else if (action === 'close') {
      pendingJD = null;
      pendingJDAt = 0;
    }

    /* ==== 手势已经用掉，下面才可以异步 ==== */

    (async () => {
      /* 面板本来就是开着的话（比如 SPA 换了岗位），JD 立刻推过去 */
      broadcast({ type: 'JD_PUSH', jd: msg.jd || null });
      try {
        if (action === 'open') {
          await chrome.storage.session.set({ pendingJD: msg.jd || null, pendingJDAt: openedAt });
        } else if (action === 'close') {
          /* 两个 key 一次删完：分两次删的话，中间被 PULL_PENDING 读到「有 JD 没时间戳」会被当成没过期 */
          await chrome.storage.session.remove(['pendingJD', 'pendingJDAt']);
        }
      } catch (e) { /* ignore */ }
      /* 再拿真实上下文对一遍：真的没面板在跑，就把状态全部清成关着，
         这样即使面板页的端口断开信号没送到，也不会永久卡在「以为是开着」 */
      await reconcilePanelOpen();
      sendResponse({ ok: action !== 'error', action: action, opened: action === 'open' });
    })();
    return true;
  }

  /* --- 面板启动时取回待处理 JD --- */
  if (msg.type === 'PULL_PENDING') {
    /* 超过 30 秒没人取走就丢弃（R30）：否则一个旧岗位的 JD 会在很久以后
       被新打开的面板取走、自动填入并自动分析，花 token 还可能投错岗。 */
    const EXPIRE_MS = 30000;
    if (pendingJD) {
      if (Date.now() - (pendingJDAt || 0) > EXPIRE_MS) {
        pendingJD = null;
        pendingJDAt = 0;
        try { chrome.storage.session.remove(['pendingJD', 'pendingJDAt']).catch(() => {}); } catch (e) { /* ignore */ }
        sendResponse({ jd: null });
        return false;
      }
      const jd = pendingJD;
      pendingJD = null;
      pendingJDAt = 0;
      try {
        chrome.storage.session.remove(['pendingJD', 'pendingJDAt']).catch(() => {});
      } catch (e) { /* ignore */ }
      sendResponse({ jd: jd });
      return false;
    }
    chrome.storage.session.get(['pendingJD', 'pendingJDAt'])
      .then((v) => {
        const jd = (v && v.pendingJD) || null;
        const at = (v && v.pendingJDAt) || 0;
        /* 没有时间戳也算过期：分两次删 / 老数据都可能出现「有 JD 没 at」，
           这种状态无法证明它新鲜，按 R30 一律丢弃 */
        const expired = jd && (!(+at) || Date.now() - (+at) > EXPIRE_MS);
        if (expired) {
          chrome.storage.session.remove(['pendingJD', 'pendingJDAt']).catch(() => {});
          sendResponse({ jd: null });
          return;
        }
        sendResponse({ jd: jd });
        if (jd) {
          chrome.storage.session.remove(['pendingJD', 'pendingJDAt']).catch(() => {});
        }
      })
      .catch(() => sendResponse({ jd: null }));
    return true;
  }

  /* --- 内容脚本：SPA 切换后 JD 变了 --- */
  if (msg.type === 'JD_CHANGED') {
    broadcast({ type: 'JD_PUSH', jd: msg.jd || null, soft: true });
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

# 上架说明 · Edge / Chrome 扩展商店

这份文件是**给仓库维护者看的**，不打包进扩展（`scripts/package.js` 只拷 `web/`、`icons/` 和三个根文件）。

上架前先跑完这里的四道门，全绿再传包：

```powershell
node tests/frontend.test.js --source-only        # 品牌 / 图标 / SVG
node tests/frontend.test.js --group=target       # 新界面 21 条
node tests/frontend.test.js --group=regression   # 原功能 15 条
node --test tests/frontend/source-checks.selftest.cjs
node tests/repo-hygiene.test.js                  # 17 条仓库卫生
```

---

## 1. 出包

```powershell
node scripts/package.js
```

产物在 `dist/extension/`（17 个文件，约 1.6 MB），再把**目录内容**压成 zip：

```powershell
Compress-Archive -Path dist/extension/* -DestinationPath dist/zhiyou-1.0.3.zip -Force
```

> 注意压缩的是 `dist/extension/` 里面的内容，不是这个目录本身——否则商店里会多一层文件夹，`manifest.json` 找不到。

zip 里应该正好是这些：

```
manifest.json  background.js  content.js
web/  icons/            （含 icons/zhiyou-qingdai.svg —— 面板里的品牌图要用）
```

`tests/`、`docs/`、`eval/`、`scripts/`、`server.py`、`README.md`、`factbase*.json` 一个都不会进去；`repo-hygiene` 的 C3 会检查这一点。

---

## 2. 素材清单

| 素材 | 规格 | 位置 | 状态 |
|---|---|---|---|
| 扩展包 | zip，含 `manifest.json` 在根 | `dist/zhiyou-1.0.3.zip` | 出包生成 |
| 商店图标 | 300 × 300 PNG（1:1，最小 128） | `docs/store/logo-300.png` | 已有 |
| 截图 1 | 1280 × 800 | `docs/store/store-1.png` | 已有 |
| 截图 2 | 1280 × 800 | `docs/store/store-2.png` | 已有 |
| 截图 3 | 1280 × 800 | `docs/store/store-3.png` | 已有 |
| 截图 4 | 1280 × 800 | `docs/store/store-4.png` | 已有 |
| 隐私政策 | 可公开访问的 HTTPS 地址 | <https://github.com/h2298511604-ops/zhiyou/blob/main/docs/privacy.md> | 已上线 |

截图要求：Edge 接受 **1280×800** 或 640×480，最多 6 张；Chrome 接受 1280×800 或 640×480，最多 5 张。四张都在规格内。

截图里用到的界面图（440×900）在 `docs/preview-*.png`，源是真实页面，不是设计稿。

---

## 3. 商店文案（可直接粘贴）

### 名称

```
职友 · 求职助手
```

（与 `manifest.json` 的 `name` 一致；67 字符以内）

### 简短描述（≤ 132 字符）

```
看懂岗位，讲清自己：自动读 JD，告诉你该不该投、该突出什么、第一句话怎么说。简历只在本机解析，用自己的模型。
```

### 详细描述

```
「职友」是一个贴在招聘网站侧边栏里的求职助手。你在刷岗位时，它自动读出当前 JD，用你已有的经历给出三件事：该不该投、该突出什么、第一句话怎么说。

▍它解决什么

同一个项目，投硬件、投嵌入式、投售前，写法完全不同。为了四五个方向各准备一份简历，改到第四份时你已经记不清第一份写过什么。
职友把这件事反过来：你只维护一个「事实库」（中性的原子事实），它派生出几个「身份」，每个岗位再从对应的身份里取素材。

▍你会得到

· 投递结论：硬门槛命中几条、缺什么，缺口必须能在 JD 原文里逐字指出来，指不出来的不算
· 经历重点：这个岗位最该讲的三段经历，按相关度排序，每条都标出处编号
· 打招呼语：50–90 字，由你本人的历史话术风格驱动，可编辑后再复制
· 风险标注：哪一句可能被追问、怎么答
· 面试清单：这份 JD 大概率会问什么

▍隐私

· 没有服务器，没有账号，没有埋点
· 简历文件在浏览器里解析，不上传
· 模型请求由你的浏览器直接发往你自己配置的接口，不经过任何中间服务器
· 唯一会联网的地方就是你填的模型地址

▍需要自备模型

职友不代管模型额度。设置里填任意 OpenAI 兼容接口即可：DeepSeek、通义千问、Kimi、智谱、本地 Ollama 都行。用本地 Ollama 可以完全不花钱、数据不出本机。

▍它明确不做

· 不自动投递、不自动发消息——决定权在你手里
· 不编造经历，每条生成都要能对上事实库里的编号
· 不承诺回复率

开源（MIT），代码在 GitHub 上可以自己审。
```

### 分类

- Edge：**Productivity（效率）**
- Chrome：**Productivity → Tools**

### 搜索词（Edge 最多 7 个）

```
求职  简历  JD  JD 分析  招聘  打招呼  岗位匹配  浏览器侧边栏
```

（按优先级排；Chrome 没有这个字段，靠描述里的关键词。）

### 语言

中文（简体），单一语言。

### 网址

| 字段 | 值 |
|---|---|
| 隐私政策 | `https://github.com/h2298511604-ops/zhiyou/blob/main/docs/privacy.md` |
| 支持 / 主页 | `https://github.com/h2298511604-ops/zhiyou` |
| 问题反馈 | `https://github.com/h2298511604-ops/zhiyou/issues` |

---

## 4. 权限说明（审核员会逐条看）

把下面这张表逐条填进「权限用途」输入框。

| 权限 | 填这里 |
|---|---|
| `storage` | 在本机保存简历文本、事实库与模型设置。数据只写 `chrome.storage.local`，不上传。 |
| `sidePanel` | 扩展的主要界面就是一个侧边栏；用户点工具栏图标或页内悬浮按钮时展开。 |
| `scripting` | 在用户当前打开的、不在内置站点列表里的招聘页面上，按需注入一次读取 JD 的脚本（用户点「重新读取」时才注入）。 |
| `activeTab` | 只在用户主动操作的那个标签页生效，避免申请「读取所有网站数据」的常驻权限。 |
| 站点权限：`*.zhipin.com` `*.liepin.com` `*.lagou.com` `*.zhaopin.com` `*.51job.com` | 这五个是主要的中文招聘网站。内容脚本只读取当前岗位详情页的正文文本用于生成分析，不读取登录态、不读取聊天记录、不修改页面内容（悬浮按钮除外）。 |
| `https://api.deepseek.com/*` 等模型域名 | 扩展后台直接向用户自己配置的模型接口发请求（绕过 CORS），请求内容只有简历文本、JD 原文和提示词。 |
| `optional_host_permissions: *://*/*` | 仅用于用户填入**自定义** OpenAI 兼容接口（含公司内网/本地地址）。该权限不在安装时授予，只在用户保存自定义 Base URL 时按域名单独申请。 |

> **审核风险最高的一条是 `*://*/*`。** 如果想降低被驳回的概率，可以把它从 `optional_host_permissions` 删掉，代价是「自定义接口」只能填内置的那几个域名（Ollama 的 127.0.0.1 已单独列出，不受影响）。删之前确认 `web/app.js` 的 `ensureHostPermission` 在拿不到权限时会给出提示，而不是静默失败。

---

## 5. 认证备注（Notes for certification）

这段要直接写给审核员，说明**怎么在 3 分钟内验证它能用**。

```
This extension is a job-hunting assistant that works in a side panel. It has NO backend and NO account system. All data stays in the user's browser.

HOW TO TEST IN 3 MINUTES

1. Click the toolbar icon to open the side panel.
2. Click "先看一个示例" (Try a sample) on the empty state. This loads built-in sample data and does NOT require an API key. You can immediately see the full analysis UI: a job verdict, a suggested opening message, highlights with source references, risks, and interview questions.
3. To test the real model pipeline you need your own OpenAI-compatible API key (this is a BYOK tool; there is no shared quota):
   Settings → paste Base URL https://api.deepseek.com/v1 and a key → Save → 简历库 → upload any .txt/.pdf/.docx resume → 生成事实库与身份 → 工作台 → 分析.
   Any text file works as a resume; no personal data is required for the test.
4. Job description extraction: open any of the five supported job boards (zhipin.com, liepin.com, lagou.com, zhaopin.com, 51job.com) on a job detail page and open the side panel. The panel shows a green "已识别当前页面" line with the extracted character count. On unsupported sites the floating button shows "未识别岗位" and the JD can be pasted manually — that is the intended fallback, not a failure.

PRIVACY
No analytics, no telemetry, no remote logging. The only network requests are: (a) directly to the model API the user configures, and (b) none — reading job pages happens locally in the content script.

The extension never auto-applies to jobs and never sends messages on the user's behalf.
```

---

## 6. 提交流程（Edge）

1. 打开 <https://partner.microsoft.com/dashboard/microsoftedge>，用 Microsoft 账号登录（免费，不需要信用卡）。
2. **New extension** → 上传 `dist/zhiyou-1.0.3.zip`。
3. 填 **Properties**：显示名、简短描述、详细描述、分类、语言、搜索词。
4. 填 **Privacy**：隐私政策 URL；「是否收集个人数据」选 **否**（确实不收集）。
5. 传 **Store listing assets**：`logo-300.png` + `store-1..4.png`。
6. **Notes for certification**：贴第 5 节那段英文。
7. 提交 → 等审核（通常几天，具体以后台显示为准）。
8. 通过后拿到的 `extension ID` 可以写进 README 的徽章。

**Chrome Web Store** 的差别只有一个：要先付一次性 $5 开发者注册费，字段更少（没有搜索词），其余文案可以原样复用。

---

## 7. 常见驳回原因（这个项目实际会遇到的）

| 风险 | 说明 | 处理 |
|---|---|---|
| `*://*/*` 可选权限范围过大 | 最常见的一条 | 见第 4 节末尾，可删掉；或在备注里说明它是按需申请、不在安装时授予 |
| 「需要 API Key 才能用」被判定为功能不完整 | 审核员可能没配 Key 就点分析 | 备注里明确写「示例模式无需 Key，可直接体验完整界面」 |
| 读取招聘网站被判为抓取 | 只读当前页 JD 正文 | 强调本地读取、不读登录态、不读聊天、不修改页面 |
| 隐私政策缺失或打不开 | 必须公网可访问 | 推仓库后确认链接能在无痕窗口打开 |
| 图标与截图尺寸不符 | 会被直接拒绝 | 用 `docs/store/` 里现成的，不要自己裁 |

---

## 8. 发版流程（以后每次更新）

1. 改 `manifest.json` 的 `version`（必须比商店里的大）。
2. 改 `web/app.js` 的 `APP_VERSION`（面板底部显示用，保持一致）。
3. 跑第 0 节的四道门。
4. `node scripts/package.js` → 压 zip → 上传。
5. 商店的「What's new」写一两句人话，不要写「修复若干问题」。

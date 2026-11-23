# 隐私政策 · 职友（求职助手）

最后更新：2026-11-24

职友是一个**本地运行**的浏览器扩展。它没有服务器，没有账号系统，也没有任何形式的统计或埋点。

## 我们收集什么

**不收集任何个人数据。**

扩展不收集、不上传、不存储到任何远程位置的包括：

- 你的简历内容、姓名、电话、邮箱
- 你的岗位浏览记录、JD 原文
- 你的 API Key
- 你与招聘方（HR）的聊天内容
- 任何设备标识、浏览历史或使用统计

扩展**没有**接入任何第三方分析、广告或崩溃上报 SDK。

## 数据存在哪里

只存在你自己的浏览器里：

| 数据 | 位置 | 说明 |
|---|---|---|
| 简历原文、事实库、身份、设置、API Key | `chrome.storage.local`（扩展存储） | 仅本机，卸载扩展即删除 |
| 界面偏好（是否关闭过引导条） | `localStorage` | 仅本机 |
| 当前这次分析的结果 | 页面内存 | 刷新即丢，不落盘 |

清除方式：扩展内 **设置 → 清空我的数据**，或在浏览器里移除扩展。

## 网络请求

扩展只会在两种情况下发起网络请求：

1. **模型接口**：发往你自己在设置里填写的 Base URL（例如 `https://api.deepseek.com`）。
   请求里包含：你上传的简历文本、当前 JD 原文、生成用的提示词。
   这些内容直接由你的浏览器发往你选择的模型服务商，不经过本项目作者或任何中间服务器。

2. **招聘网站页面读取**：内容脚本在你已打开的招聘网站上读取当前岗位详情页的正文（JD）。
   这是浏览器内的本地读取，**不产生任何对外请求**。扩展不读取登录态、不读取聊天记录、不读取页面以外的内容。

扩展不会向任何其它域名发送数据。

## 权限用途

| 权限 | 用途 |
|---|---|
| `storage` | 在本机保存简历、事实库与设置 |
| `sidePanel` | 在浏览器侧边栏显示界面 |
| `scripting` | 在你正在浏览的招聘页面上按需注入读取 JD 的脚本 |
| `activeTab` | 只在当前标签页生效，避免申请「读取所有网站数据」 |
| 站点权限（BOSS / 猎聘 / 拉勾 / 智联 / 前程无忧） | 自动识别这五个站点的岗位 JD |
| 模型接口域名权限 | 由扩展后台发起模型请求，绕过 CORS 限制 |
| `optional_host_permissions` | 仅在你填入自定义接口地址时，按需申请该域名 |

## 儿童隐私

本扩展不面向 14 岁以下儿童，也不收集任何年龄信息。

## 政策变更

本政策如有变更，会更新本文件顶部的日期，并记录在仓库的提交历史里。

## 联系方式

问题或建议请开 issue：<https://github.com/h2298511604-ops/zhiyou/issues>

---

# Privacy Policy · Zhiyou (Job Hunting Assistant)

Last updated: 2026-11-24

Zhiyou is a **local-only** browser extension. It has no server, no account system, and no analytics or tracking of any kind.

**We collect no personal data.** The extension does not collect, transmit, or store remotely: your resume content, name, phone, email, job browsing history, job descriptions, API keys, chat messages with recruiters, device identifiers, or usage statistics.

All data stays on your device in `chrome.storage.local` plus `localStorage` for UI preferences. Removing the extension deletes it. You can also use **Settings → Clear my data** inside the extension.

**Network requests** happen in exactly two cases:

1. **Model API** — requests go directly from your browser to the Base URL you configure (e.g. `https://api.deepseek.com`). They contain your resume text, the current job description, and the prompt. They never pass through any server operated by this project.
2. **Job page reading** — the content script reads the job description text from pages you already have open, locally in your browser. No request is made.

No data is sent to any other domain. No third-party analytics, ads, or crash reporting SDK is included.

**Permissions**: `storage` (save data locally), `sidePanel` (show the panel), `scripting` and `activeTab` (read the job page only when you use it), plus site access for five Chinese job boards and the model API domains you choose.

**Contact**: please open an issue at <https://github.com/h2298511604-ops/zhiyou/issues>

# 隐私政策 · 职友（求职助手）

最后更新：2026-11-24

职友扩展在浏览器本地运行。项目不托管在线账号或数据中转服务，也没有统计或埋点。

## 我们收集什么

项目没有账号系统，也不运营接收用户数据的服务器；扩展不向项目维护者发送简历、JD、API Key 或使用统计，也没有接入第三方分析、广告或崩溃上报 SDK。

**模型生成会向你配置的模型服务商发送必要内容。**生成事实库时会发送简历文本；分析岗位时会发送当前 JD、生成所需的简历事实和提示词。API Key 会随请求放在 Authorization 请求头中。若使用云端服务，这些内容会到达对应服务商，并受其隐私政策和数据保留规则约束。配置本地 Ollama 时，请求发往你自己的本机服务。

扩展不会读取你与招聘方（HR）的聊天内容，也不会把岗位页内容发送给项目维护者。

## 数据存在哪里

扩展持久化数据保存在你的浏览器本机：

| 数据 | 位置 | 说明 |
|---|---|---|
| 简历原文、事实库、身份、设置、API Key | `chrome.storage.local`（扩展存储） | 保存在本机；调用模型时，相关文本和 API Key 会按上文说明发送到配置的接口 |
| 界面偏好（是否关闭过引导条） | `localStorage` | 仅本机 |
| 当前这次分析的结果 | 页面内存 | 刷新即丢，不落盘 |

清除方式：扩展内 **设置 → 清空我的数据**，或在浏览器里移除扩展。

## 数据流向

扩展的数据流向如下：

1. **模型接口**：发往你在设置里填写的 Base URL（例如 `https://api.deepseek.com`）。生成事实库时请求包含简历文本；岗位分析时包含当前 JD、生成所需的简历事实和提示词。API Key 随请求放在 Authorization 请求头中。这些内容由扩展后台直接发往你选择的模型服务商，不经过项目运营的中间服务器。

2. **招聘网站页面读取**：内容脚本在你已打开的招聘网站上读取当前岗位详情页的正文（JD）。这是浏览器内的本地读取，本身不产生对外请求。只有在你触发分析时，当前 JD 才会按上文说明发往配置的模型接口。扩展不读取登录态、不读取聊天记录、不读取页面以外的内容。

扩展不会向你配置的模型接口以外的远程域名发送数据。使用本地网页预览时，浏览器还会把请求发给本机 `127.0.0.1` 服务，由它转发到你配置的模型接口；本地预览服务不是公网服务。

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

The Zhiyou extension runs locally in your browser. The project does not host an online account or data-relay service. The extension does not send resumes, job descriptions, API keys, or usage statistics to the project maintainers, and it includes no third-party analytics, ads, or crash-reporting SDK.

**Model generation sends necessary content to the provider you configure.** Building the fact base sends resume text; analyzing a job sends the current JD, the resume facts needed for generation, and prompts. The API Key is sent in the Authorization request header. Cloud-provider handling and retention are governed by that provider's privacy policy. With local Ollama, requests go to your own machine.

The extension does not read recruiter chats or send job-page content to the project maintainers.

Persistent extension data is stored on your device in `chrome.storage.local`, plus `localStorage` for UI preferences. Removing the extension deletes it. You can also use **Settings → Clear my data**. When you trigger model generation, the data described above is sent to the configured model endpoint.

**Data flows** in these cases:

1. **Model API** — requests go to the Base URL you configure (e.g. `https://api.deepseek.com`). See above for the fields included. Extension requests are sent directly by the background worker and do not pass through a project-operated proxy server.
2. **Job page reading** — the content script reads the JD from an open job page locally. Reading alone makes no request; the JD is sent to the configured model endpoint only when you trigger analysis.

The extension sends no data to other remote domains. Local web preview also contacts `127.0.0.1`; its local Python service forwards configured model requests and is not intended for public exposure.

**Permissions**: `storage` (save data locally), `sidePanel` (show the panel), `scripting` and `activeTab` (read the job page only when you use it), plus site access for five Chinese job boards and the model API domains you choose.

**Contact**: please open an issue at <https://github.com/h2298511604-ops/zhiyou/issues>

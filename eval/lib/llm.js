/* ============================================================
   模型调用 —— 多厂商，eval 自己实现，不碰插件的 background.js

   为什么要多厂商：生成合成简历的模型，和评测时生成话术的模型，
   如果同源会形成自洽（A 写的东西 A 觉得好）。生成侧尽量换厂商。

   用法：
     node eval/make-seeds.js --provider qwen --model qwen-plus
     node eval/run.js ... --model deepseek-chat        （评测仍走默认）

   配置写在 eval/.env.local：
     DEEPSEEK_API_KEY=sk-xxx
     DASHSCOPE_API_KEY=sk-xxx
     MIMO_API_KEY=xxx
     MIMO_BASE_URL=https://...        # 厂商地址不确定时必须显式给
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const ENV_FILE = path.join(ROOT, 'eval', '.env.local');

/* OpenAI 兼容协议的厂商登记表。
   keys / bases / models 都是候选变量名列表，取第一个非空的 ——
   用户填的变量名往往和预期不一样，别逼人改名。 */
const PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    base: 'https://api.deepseek.com',
    keys: ['DEEPSEEK_API_KEY'],
    bases: ['DEEPSEEK_BASE_URL'],
    models: ['DEEPSEEK_MODEL'],
    defaultModel: 'deepseek-chat'
  },
  qwen: {
    label: '通义千问（阿里 DashScope）',
    base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    keys: ['DASHSCOPE_API_KEY', 'QWEN_API_KEY', 'ALIYUN_API_KEY'],
    bases: ['QWEN_BASE_URL', 'DASHSCOPE_BASE_URL'],
    models: ['QWEN_MODEL', 'DASHSCOPE_MODEL'],
    defaultModel: 'qwen-plus'
  },
  glm: {
    label: '智谱 GLM',
    base: 'https://open.bigmodel.cn/api/paas/v4',
    keys: ['ZHIPU_API_KEY', 'GLM_API_KEY'],
    bases: ['GLM_BASE_URL', 'ZHIPU_BASE_URL'],
    models: ['GLM_MODEL', 'ZHIPU_MODEL'],
    defaultModel: 'glm-4-plus'
  },
  kimi: {
    label: '月之暗面 Kimi',
    base: 'https://api.moonshot.cn/v1',
    keys: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
    bases: ['KIMI_BASE_URL', 'MOONSHOT_BASE_URL'],
    models: ['KIMI_MODEL', 'MOONSHOT_MODEL'],
    defaultModel: 'moonshot-v1-8k'
  },
  mimo: {
    label: '小米 MiMo',
    base: '',                                   /* 地址由 XIAOMI_URL / MIMO_BASE_URL 提供 */
    keys: ['XIAOMI_API_KEY', 'MIMO_API_KEY'],
    bases: ['XIAOMI_URL', 'MIMO_BASE_URL', 'XIAOMI_BASE_URL'],
    models: ['XIAOMI_MODEL', 'XIAOMO_MODEL', 'MIMO_MODEL'],
    defaultModel: 'mimo-v2.6-flash',
    needsBase: true
  },
  custom: {
    label: '自定义 OpenAI 兼容端点',
    base: '',
    keys: ['LLM_API_KEY'],
    bases: ['CUSTOM_BASE_URL', 'LLM_BASE_URL'],
    models: ['LLM_MODEL'],
    defaultModel: '',
    needsBase: true
  }
};

/* 读 .env.local，简单的 KEY=VALUE */
function readEnvFile() {
  const out = {};
  if (!fs.existsSync(ENV_FILE)) return out;
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function getEnv(name) {
  if (process.env[name]) return process.env[name].trim();
  const f = readEnvFile();
  return (f[name] || '').trim();
}

/* 从候选变量名里取第一个非空的 */
function pick(list) {
  for (const n of list || []) {
    const v = getEnv(n);
    if (v) return { name: n, value: v };
  }
  return null;
}

/* 解析出这次要用哪家 */
function resolve(provider, model) {
  const name = (provider || getEnv('LLM_PROVIDER') || 'deepseek').toLowerCase();
  const p = PROVIDERS[name];
  if (!p) {
    throw new Error('未知厂商：' + name + '。可选：' + Object.keys(PROVIDERS).join(' / '));
  }

  /* 地址：预置的优先；预置为空则必须显式配 */
  const baseHit = pick(p.bases);
  let base = p.base || (baseHit && baseHit.value) || '';
  if (!base) {
    throw new Error('厂商「' + p.label + '」的接口地址不确定。请在 eval/.env.local 里加任意一项：\n  ' +
      p.bases.join('\n  ') + '\n（OpenAI 兼容地址，例如 https://…/v1）');
  }
  base = base.replace(/\/+$/, '');

  /* 地址容错：用户可能给的是 base（…/v1），也可能直接给完整端点
     （…/v1/chat/completions 或 …/v1/responses）。两种都要能用，
     否则会拼成 …/chat/completions/chat/completions。 */
  let protocol = 'chat';
  if (/\/responses$/.test(base)) {
    protocol = 'responses';
    base = base.replace(/\/responses$/, '');
  } else if (/\/chat\/completions$/.test(base)) {
    protocol = 'chat';
    base = base.replace(/\/chat\/completions$/, '');
  }

  const keyHit = pick(p.keys);
  if (!keyHit) {
    throw new Error('缺少 API Key。请在 eval/.env.local 里加任意一项：\n  ' + p.keys.join('\n  '));
  }

  const modelHit = pick(p.models);
  const m = model || (modelHit && modelHit.value) || p.defaultModel;
  if (!m) throw new Error('厂商「' + p.label + '」没指定模型。用 --model 传，或在 .env.local 里加 ' + p.models[0]);

  return {
    name: name,
    label: p.label,
    baseUrl: base,
    protocol: protocol,
    key: keyHit.value,
    keyEnv: keyHit.name,
    model: m
  };
}

function listProviders() {
  return Object.keys(PROVIDERS).map((k) => {
    const p = PROVIDERS[k];
    const key = pick(p.keys);
    const baseHit = pick(p.bases);
    const base = p.base || (baseHit && baseHit.value) || '';
    const modelHit = pick(p.models);
    return {
      id: k,
      label: p.label,
      base: base || '(需配置 ' + p.bases[0] + ')',
      protocol: /\/responses$/.test(base) ? 'responses' : 'chat',
      /* 展示实际会请求的地址，避免"看着对、拼出来错" */
      requestUrl: base
        ? base.replace(/\/responses$|\/chat\/completions$/, '') +
          (/\/responses$/.test(base) ? '/responses' : '/chat/completions')
        : '',
      keyEnv: key ? key.name : p.keys[0],
      keyed: !!key,
      model: (modelHit && modelHit.value) || p.defaultModel || '(需指定)'
    };
  });
}

/* 花括号配对取 JSON，比 lastIndexOf('}') 可靠 */
function extractJson(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  if (start < 0) return { data: null, truncated: false };
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
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
      if (depth === 0) {
        try { return { data: JSON.parse(s.slice(start, i + 1)), truncated: false }; }
        catch (e) { return { data: null, truncated: false, error: e.message }; }
      }
    }
  }
  return { data: null, truncated: true };
}

/* 从 Responses API 的返回里取文本 */
function readResponsesOutput(j) {
  if (typeof j.output_text === 'string' && j.output_text) return j.output_text;
  if (Array.isArray(j.output)) {
    const parts = [];
    for (const item of j.output) {
      if (!item) continue;
      if (Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c && typeof c.text === 'string') parts.push(c.text);
        }
      } else if (typeof item.text === 'string') {
        parts.push(item.text);
      }
    }
    if (parts.length) return parts.join('');
  }
  if (typeof j.text === 'string') return j.text;
  return '';
}

async function chat(messages, opts) {
  opts = opts || {};
  const r = opts.provider
    ? resolve(opts.provider, opts.model)
    : resolve(null, opts.model);

  let url, body, headers;

  if (r.protocol === 'responses') {
    /* OpenAI Responses API：input 数组、max_output_tokens、不支持 response_format */
    url = r.baseUrl + '/responses';
    body = {
      model: r.model,
      input: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: opts.temperature == null ? 0.2 : opts.temperature
    };
    if (opts.maxTokens) body.max_output_tokens = opts.maxTokens;
  } else {
    url = r.baseUrl + '/chat/completions';
    body = {
      model: r.model,
      messages: messages,
      temperature: opts.temperature == null ? 0.2 : opts.temperature,
      max_tokens: opts.maxTokens || 8000
    };
    if (opts.jsonMode) body.response_format = { type: 'json_object' };
    /* 思考开关只有 DeepSeek 认，别发给别家 */
    if (opts.thinking === 'disabled' && r.name === 'deepseek') {
      body.thinking = { type: 'disabled' };
    }
  }

  headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + r.key };

  /* 超时保护：产品里 background.js 有 120s AbortController，
     eval 之前没有，机器休眠后请求会永久挂起（实际挂过 7 小时）。 */
  const timeoutMs = opts.timeoutMs || 180000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  let res, txt;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal });
    txt = await res.text();
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(r.label + ' 请求超时（>' + Math.round(timeoutMs / 1000) + 's）：' + url);
    }
    throw new Error(r.label + ' 请求失败：' + (e.message || e));
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(r.label + ' 返回 HTTP ' + res.status + '（' + r.protocol + '）\n' +
      url + '\n' + txt.slice(0, 400));
  }

  let j;
  try { j = JSON.parse(txt); }
  catch (e) { throw new Error(r.label + ' 返回的不是 JSON：' + txt.slice(0, 200)); }

  let content = '';
  let finish = '';
  if (r.protocol === 'responses') {
    content = readResponsesOutput(j);
    finish = j.status || '';
  } else {
    const ch = (j.choices && j.choices[0]) || {};
    content = (ch.message && ch.message.content) || '';
    finish = ch.finish_reason || '';
  }

  if (!content) {
    throw new Error(r.label + ' 返回了空内容（' + r.protocol + '）：' + txt.slice(0, 300));
  }

  return {
    content: content,
    finish: finish,
    usage: j.usage || null,
    provider: r.name,
    model: r.model,
    protocol: r.protocol
  };
}

module.exports = {
  chat, extractJson, resolve, listProviders, getEnv,
  PROVIDERS, ENV_FILE, readResponsesOutput
};

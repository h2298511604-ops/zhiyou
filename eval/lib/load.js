/* ============================================================
   加载「被测对象」

   依赖方向是单向的：eval → web。
   插件的任何代码都不会 import 这个目录，删掉 eval/ 插件照常运行。

   这里只读两样东西，因为它们**就是被测对象本身**：
     web/prompts.js          —— 生成用的 prompt（改它 = 改变产品行为）
     web/skills/greeting.js  —— 话术 Skill 语料与规则

   绝不读取 web/app.js —— 那是 UI 层，切片它的内部函数会造成隐性耦合。
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function readPluginFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/* 用一个假 window 执行插件脚本，取出它挂在 window 上的东西 */
function loadPlugin() {
  const win = {};

  const run = (rel, expr) => {
    const src = readPluginFile(rel);
    /* new Function 的作用域是函数级，脚本顶部的 const 能被它返回 */
    return new Function('window', src + '\nreturn (' + expr + ');')(win);
  };

  run('web/skills/greeting.js', '1');
  const PROMPTS = run('web/prompts.js', 'PROMPTS');

  const skill = win.GREETING_SKILL || null;

  return {
    PROMPTS,
    skill,
    /* 便于报告里标注"这次测的是哪一版" */
    meta: {
      skillVersion: skill ? skill.version : 0,
      skillId: skill ? skill.id : '',
      exampleCount: skill ? (skill.examples || []).length : 0,
      maxChars: skill ? skill.maxChars : 100,
      promptKeys: Object.keys(PROMPTS)
    }
  };
}

function repoRoot() {
  return ROOT;
}

module.exports = { loadPlugin, repoRoot };

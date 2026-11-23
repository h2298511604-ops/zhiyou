/* 查看配置状态 + 实测连通性
   用法：
     node eval/providers.js          只看配置
     node eval/providers.js --test   各发一个最小请求验证能不能通
*/

const llm = require('./lib/llm');

const TEST = process.argv.indexOf('--test') >= 0;

function mask(k) {
  if (!k) return '（未配置）';
  if (k.length <= 12) return k.slice(0, 4) + '***';
  return k.slice(0, 8) + '***' + k.slice(-4) + '（' + k.length + ' 位）';
}

(async () => {
  const rows = llm.listProviders();
  console.log('厂商配置');
  console.log('='.repeat(66));

  for (const r of rows) {
    console.log('');
    console.log((r.keyed ? '✓ ' : '✗ ') + r.id.padEnd(9) + r.label);
    console.log('   协议    ' + r.protocol);
    console.log('   地址    ' + r.base);
    console.log('   模型    ' + r.model);
    console.log('   key     ' + (r.keyed ? '已配置（' + r.keyEnv + '）' : '缺失，需要 ' + r.keyEnv));
  }

  if (!TEST) {
    console.log('');
    console.log('加 --test 可以实测连通性');
    return;
  }

  console.log('');
  console.log('实测连通性');
  console.log('='.repeat(66));

  for (const r of rows) {
    if (!r.keyed) { console.log('  - ' + r.id + '：跳过（无 key）'); continue; }
    if (r.base.indexOf('需配置') === 0) { console.log('  - ' + r.id + '：跳过（无地址）'); continue; }
    try {
      const t0 = Date.now();
      const res = await llm.chat(
        [{ role: 'user', content: '只回复两个字：收到' }],
        { provider: r.id, maxTokens: 32, temperature: 0 }
      );
      const ms = Date.now() - t0;
      console.log('  ✓ ' + r.id + '  ' + ms + 'ms  [' + res.protocol + ']  ' +
        JSON.stringify(res.content.slice(0, 40)) +
        (res.usage ? '  tokens=' + (res.usage.total_tokens || '?') : ''));
    } catch (e) {
      console.log('  ✗ ' + r.id + '  ' + String(e.message).split('\n').slice(0, 3).join(' | '));
    }
  }
})();

/* ============================================================
   简历文件解析
   ------------------------------------------------------------
   支持：PDF / .docx / .txt / .md
   全部在本机解析，文件不会离开浏览器。

   PDF 依赖 vendor/pdf.min.js（懒加载：只有选了 PDF 才去取）
   DOCX 用浏览器内置的 DecompressionStream 解 zip，零依赖
   ============================================================ */

window.FileParser = (() => {
  'use strict';

  const MAX_BYTES = 15 * 1024 * 1024;

  /* ---------------- PDF ---------------- */

  let pdfLoadPromise = null;

  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfLoadPromise) return pdfLoadPromise;
    pdfLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/pdf.min.js';
      s.onload = () => {
        if (window.pdfjsLib) {
          try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; } catch (e) { /* ignore */ }
          resolve(window.pdfjsLib);
        } else {
          reject(new Error('PDF 解析库加载异常'));
        }
      };
      s.onerror = () => reject(new Error('PDF 解析库加载失败（vendor/pdf.min.js 缺失？）'));
      document.head.appendChild(s);
    });
    return pdfLoadPromise;
  }

  async function parsePdf(bytes) {
    const lib = await loadPdfJs();
    const task = lib.getDocument({
      data: bytes,
      isEvalSupported: false,
      useSystemFonts: true
    });
    const doc = await task.promise;

    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      let line = '';
      let lastY = null;
      for (const item of content.items) {
        const y = item.transform ? item.transform[5] : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && line.trim()) {
          lines.push(line.trim());
          line = '';
        }
        line += item.str || '';
        if (item.hasEOL && line.trim()) {
          lines.push(line.trim());
          line = '';
        }
        lastY = y;
      }
      if (line.trim()) lines.push(line.trim());
      lines.push('');
    }
    try { doc.destroy(); } catch (e) { /* ignore */ }

    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ---------------- ZIP / DOCX ---------------- */

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('当前浏览器版本过低，无法解压 .docx（需要 Chrome 80+）');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function findEocd(view, len) {
    const floor = Math.max(0, len - 22 - 65535);
    for (let i = len - 22; i >= floor; i--) {
      if (view.getUint32(i, true) === 0x06054b50) return i;
    }
    return -1;
  }

  async function zipEntry(bytes, targetName) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const len = bytes.byteLength;
    const eocd = findEocd(view, len);
    if (eocd < 0) throw new Error('文件不是有效的 zip / docx');

    const count = view.getUint16(eocd + 10, true);
    let off = view.getUint32(eocd + 16, true);
    const dec = new TextDecoder('utf-8');

    for (let i = 0; i < count && off + 46 <= len; i++) {
      if (view.getUint32(off, true) !== 0x02014b50) break;
      const method = view.getUint16(off + 10, true);
      const compSize = view.getUint32(off + 20, true);
      const nameLen = view.getUint16(off + 28, true);
      const extraLen = view.getUint16(off + 30, true);
      const commentLen = view.getUint16(off + 32, true);
      const localOff = view.getUint32(off + 42, true);
      const name = dec.decode(bytes.subarray(off + 46, off + 46 + nameLen));

      if (name === targetName) {
        const lNameLen = view.getUint16(localOff + 26, true);
        const lExtraLen = view.getUint16(localOff + 28, true);
        const start = localOff + 30 + lNameLen + lExtraLen;
        const raw = bytes.subarray(start, start + compSize);
        if (method === 0) return raw;
        if (method === 8) return await inflateRaw(raw);
        throw new Error('不支持的压缩方式（' + method + '）');
      }
      off += 46 + nameLen + extraLen + commentLen;
    }
    return null;
  }

  function docxXmlToText(xml) {
    let s = xml;
    s = s.replace(/<w:tab[^>]*\/>/g, '\t');
    s = s.replace(/<w:br[^>]*\/>/g, '\n');
    s = s.replace(/<\/w:p>/g, '\n');
    s = s.replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g, '$1');
    s = s.replace(/<[^>]+>/g, '');
    s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
         .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
         .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)))
         .replace(/&amp;/g, '&');
    return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  async function parseDocx(bytes) {
    const xml = await zipEntry(bytes, 'word/document.xml');
    if (!xml) throw new Error('这个 .docx 里找不到正文（可能是 .doc 改了后缀）');
    return docxXmlToText(new TextDecoder('utf-8').decode(xml));
  }

  /* ---------------- 分发 ---------------- */

  function head(buf, n) {
    let s = '';
    for (let i = 0; i < Math.min(n, buf.length); i++) s += String.fromCharCode(buf[i]);
    return s;
  }

  function isOldDoc(buf) {
    return buf.length > 4 && buf[0] === 0xD0 && buf[1] === 0xCF &&
           buf[2] === 0x11 && buf[3] === 0xE0;
  }

  /* 文本文件里几乎不会出现 NUL 或控制字符。
     先按常见二进制魔数判（PNG/JPEG/GIF/RAR/7z/gzip），没有魔数再看控制字符占比。
     只看前 4KB：NUL 直接判死，控制字符占比 >2% 也判死（随机二进制大约 10%）。 */
  const BAD_MAGIC = [
    [0x89, 0x50, 0x4E, 0x47],   // PNG
    [0xFF, 0xD8, 0xFF],         // JPEG
    [0x47, 0x49, 0x46, 0x38],   // GIF8
    [0x52, 0x61, 0x72, 0x21],   // Rar!
    [0x37, 0x7A, 0xBC, 0xAF],   // 7z
    [0x1F, 0x8B]                // gzip
  ];

  function looksBinary(bytes) {
    for (const m of BAD_MAGIC) {
      if (bytes.length >= m.length && m.every((b, i) => bytes[i] === b)) return true;
    }
    const n = Math.min(bytes.length, 4096);
    if (!n) return false;
    let ctrl = 0;
    for (let i = 0; i < n; i++) {
      const b = bytes[i];
      if (b === 0) return true;
      if (b < 9 || (b > 13 && b < 32)) ctrl++;
    }
    return ctrl / n > 0.02;
  }

  /* UTF-16 文本（记事本「Unicode 文本」/ Word 导出的 .txt）前几 KB 必然含 NUL，
     不先按 BOM 解码就会被 looksBinary 当成二进制拒掉。BOM 是可靠判据：
     FF FE = UTF-16LE，FE FF = UTF-16BE。

     注意必须**先看满 4 个字节**：UTF-32LE 的 BOM 是 FF FE 00 00，前两字节正好是 FF FE，
     只看 2 字节会把 UTF-32 当成 UTF-16LE 解码 —— 解出来是夹着 NUL 的乱码，正好是 R24 要挡的东西。 */
  function utf32Encoding(bytes) {
    if (bytes.length >= 4 && bytes[0] === 0xFF && bytes[1] === 0xFE && bytes[2] === 0x00 && bytes[3] === 0x00) return 'utf-32le';
    if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0xFE && bytes[3] === 0xFF) return 'utf-32be';
    return '';
  }

  function utf16Encoding(bytes) {
    if (utf32Encoding(bytes)) return '';
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return 'utf-16le';
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return 'utf-16be';
    return '';
  }

  function decodeUtf16(bytes, enc) {
    try {
      return new TextDecoder(enc).decode(bytes.subarray(2));
    } catch (e) {
      return '';
    }
  }

  /* 解码后的自检：任何编码解出「夹着 NUL / 大量控制字符」的垃圾都不许进简历库。
     与 looksBinary 同一口径，只是作用在字符串上（\t \n \r 不算控制字符）。 */
  function looksGarbled(text) {
    const s = String(text || '');
    const n = Math.min(s.length, 4096);
    if (!n) return true;
    let ctrl = 0;
    for (let i = 0; i < n; i++) {
      const c = s.charCodeAt(i);
      if (c === 0) return true;
      if (c < 32 && c !== 9 && c !== 10 && c !== 13) ctrl++;
    }
    return ctrl / n > 0.02;
  }

  async function parse(file) {
    if (!file) throw new Error('没有选择文件');
    if (file.size === 0) throw new Error('文件是空的');
    if (file.size > MAX_BYTES) {
      throw new Error('文件超过 ' + (MAX_BYTES / 1024 / 1024) + 'MB，太大了');
    }

    const name = (file.name || '').toLowerCase();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mark = head(bytes, 4);

    let kind = 'text';
    let text = '';

    if (mark === '%PDF' || /\.pdf$/.test(name)) {
      kind = 'pdf';
      text = await parsePdf(bytes);
    } else if (isOldDoc(bytes)) {
      throw new Error('这是旧版 .doc 格式，浏览器解析不了。请用 Word / WPS 另存为 .docx 或 PDF 再上传');
    } else if (mark.slice(0, 2) === 'PK' || /\.docx$/.test(name)) {
      kind = 'docx';
      text = await parseDocx(bytes);
    } else if (utf32Encoding(bytes)) {
      /* TextDecoder 不支持 utf-32（实测 RangeError），明确拒绝比解成乱码好 */
      throw new Error('这个文件是 UTF-32 编码的文本，浏览器解不了。请用记事本 / Word 另存为 UTF-8 的 .txt 再上传');
    } else if (utf16Encoding(bytes)) {
      const enc = utf16Encoding(bytes);
      text = decodeUtf16(bytes, enc);
      if (!text.trim()) {
        throw new Error('这个文件像是 UTF-16 文本，但解码出来是空的。请另存为 UTF-8 的 .txt 再上传');
      }
      if (looksGarbled(text)) {
        throw new Error('这个文件像是 UTF-16，但解出来是乱码（可能是别的编码）。请另存为 UTF-8 的 .txt 再上传');
      }
    } else if (looksBinary(bytes)) {
      throw new Error('这个文件不是文本简历（支持 .txt / .md / .docx / .pdf）——它看起来是图片、压缩包，' +
        '或者不是 UTF-8 / 带 BOM 的 UTF-16 文本（请另存为 UTF-8 再试）');
    } else {
      text = await file.text();
    }

    text = (text || '').trim();
    if (!text) {
      throw new Error(kind === 'pdf'
        ? '这个 PDF 里提取不到文字——大概率是扫描件/图片版。请截图后转文字，或直接把内容粘到输入框'
        : '解析出来是空的，请检查文件');
    }
    if (kind === 'pdf' && text.length < 60) {
      throw new Error('PDF 只提取到 ' + text.length + ' 个字，可能是扫描件。请手动粘贴，或换一份能选中文字的 PDF');
    }

    return { text, kind, name: file.name || '', size: file.size };
  }

  return { parse, MAX_BYTES };
})();

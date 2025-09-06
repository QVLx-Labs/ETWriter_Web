/*
  ET_Writer - Text editor for all in the galaxy
  
  Copyright QVLX LLC. All Rights Reserved.
*/

(() => {
  // ---------- DOM: editor host + textarea ----------
  const txtEditor = document.getElementById('txtEditor');
  let cmHost = document.getElementById('cmHost');
  const supportFS = !!(window.showOpenFilePicker && window.showSaveFilePicker && window.showDirectoryPicker);
  
  if (!cmHost) {
    cmHost = document.createElement('div');
    cmHost.id = 'cmHost';
    cmHost.className = txtEditor.className; // inherit sizing (e.g., .editor)
    cmHost.style.display = 'none';
    txtEditor.insertAdjacentElement('beforebegin', cmHost);
  }
  // Make sure host is visible even if CSS targets only textarea.editor
  cmHost.style.minHeight = '56vh';
  cmHost.style.width = '100%';
  cmHost.style.border = '1px solid #1b2027';
  cmHost.style.borderRadius = '8px';

  // Optional language selector in your toolbar
  const langSelect = document.getElementById('langSelect');

  // ---------- CodeMirror 5 (UMD) integration ----------
  let cm = null;
  function ensureCodeMirror() {
    if (cm) return true;
    if (!window.CodeMirror) {
      console.warn('CodeMirror not present — using <textarea> fallback');
      return false;
    }
    cm = window.CodeMirror(cmHost, {
      value: '',
      mode: 'text/plain',
      lineNumbers: true,
      lineWrapping: true,
      theme: 'darcula',
      styleActiveLine: { nonEmpty: true },   // <— highlight current line
      viewportMargin: Infinity
    });
    refreshEditor();
    // Let CSS control height to fill the container
    cm.setSize('100%', '100%');
    return true;
  }
  
  // ===== Colorized Hex Editor (CodeMirror) =====
let cmHex = null;
let cmHexHost = null;

function injectHexPaletteCSS() {
  if (document.getElementById('etwriter-hex-palette')) return;
  const style = document.createElement('style');
  style.id = 'etwriter-hex-palette';

  // Perceptual-ish rainbow map with lightness compensation for dark themes.
  // Hue sweeps 0..360 across 0..255; lightness and saturation tuned for readability.
  // We also compute an auto text color (black/white) per color for contrast.
  const rules = [];
  for (let v = 0; v < 256; v++) {
    const hue = (v / 256) * 360;        // 0..360
    const sat = 78;                      // %
    // Ease lightness a bit so very dark/very bright bytes stay legible
    const baseL = 54;                    // %
    const wobble = 10 * Math.sin((v/256) * Math.PI * 2); // -10..+10
    const light = Math.max(36, Math.min(70, baseL + wobble)); // clamp

    // Decide text color by quick luminance estimate
    // Convert HSL to approx RGB luminance (fast heuristic)
    const L = light / 100;
    const textColor = (L > 0.6) ? '#111' : '#fff';

    const cls = v.toString(16).padStart(2, '0'); // "00".."ff"
    // Color the text; keep background transparent to preserve selection/line highlight
    rules.push(
      `.cm-s-darcula .cm-byte.cm-b${cls}{color:hsl(${hue} ${sat}% ${light}%); font-weight:600}`
    );
  }

  // Special cues
  rules.push(`
    .cm-s-darcula .cm-nonhex { color:#888 }
    .cm-s-darcula .cm-gap    { color:#556; opacity:.9 }
    .cm-s-darcula .cm-byte.cm-b00{ text-decoration:underline dotted 1px } /* NUL stands out */
    .cm-s-darcula .cm-byte.cm-bff{ text-decoration:underline dotted 1px } /* 0xFF too */
  `);

  style.textContent = rules.join('\n');
  document.head.appendChild(style);
}

// Define a very small mode that emits:
//  - "byte bXX" for 2-hex-digit tokens
//  - "gap" for single hyphens/spacing groupers (optional)
//  - "nonhex" for anything else (will be ignored by saver anyway)
function defineHexMode() {
  if (!window.CodeMirror || !window.CodeMirror.defineSimpleMode) return;
  if (window.CodeMirror.modes['et-hex']) return;

  window.CodeMirror.defineSimpleMode('et-hex', {
    start: [
      // match 2 hex digits, even if next to punctuation, no word boundary needed
      { regex: /\b[0-9A-Fa-f]{2}\b/, token: (match) => {
          return `byte b${match[0].toLowerCase()}`;
        }
      },
      // also match when punctuation immediately follows (e.g., "5c," or "0a)")
      { regex: /([0-9A-Fa-f]{2})(?=[^0-9A-Fa-f]|$)/, token: (match) => {
          return `byte b${match[1].toLowerCase()}`;
        }
      },
      { regex: /[-·]/, token: 'gap' },
      { regex: /\s+/, token: null },
      { regex: /./, token: 'nonhex' }
    ],
    meta: { lineComment: null }
  });
}

function ensureHexCodeMirror() {
  if (cmHex) return true;
  if (!window.CodeMirror) return false;

  injectHexPaletteCSS();
  defineHexMode();

  const txtHex = document.getElementById('txtHex');
  if (!txtHex) return false;

  // Create a host and hide original textarea
  cmHexHost = document.createElement('div');
  cmHexHost.id = 'cmHexHost';
  cmHexHost.className = txtHex.className || 'hex mono';
  cmHexHost.style.minHeight = '48vh';
  cmHexHost.style.border = '1px solid #1b2027';
  cmHexHost.style.borderRadius = '8px';

  txtHex.classList.add('hidden');
  txtHex.insertAdjacentElement('beforebegin', cmHexHost);

  cmHex = window.CodeMirror(cmHexHost, {
    value: txtHex.value || '',
    mode: 'et-hex',
    lineNumbers: true,
    lineWrapping: true,
    theme: 'darcula',
    styleActiveLine: { nonEmpty: true },
    viewportMargin: Infinity,
    maxHighlightLength: 1000000   // <<< allow long lines
  });
  cmHex.setSize('100%', '100%');

  // Keep your ASCII preview in sync
  const syncHexPreview = () => {
    try {
      const buf = hexDumpToBuffer(cmHex.getValue());
      const { ascii } = bufferToHexDump(buf);
      const txtHexAscii = document.getElementById('txtHexAscii');
      const hexBytes = document.getElementById('hexBytes');
      const statusHex = document.getElementById('statusHex');
      if (txtHexAscii) txtHexAscii.value = ascii;
      if (hexBytes) hexBytes.textContent = new Uint8Array(buf).length.toString();
      if (statusHex) statusHex.textContent = '';
    } catch (e) {
      const statusHex = document.getElementById('statusHex');
      if (statusHex) statusHex.textContent = 'Hex parse error.';
    }
  };
  cmHex.on('changes', syncHexPreview);
  // initial sync
  syncHexPreview();

  return true;
}

// Helper so rest of code can read hex text transparently
function getHexText() {
  const txtHex = document.getElementById('txtHex');
  return cmHex ? cmHex.getValue() : (txtHex ? txtHex.value : '');
}
// ===== end Colorized Hex Editor =====
  
  // GitHub-esque language colors (subset of your supported modes)
  const LANGUAGE_COLORS = {
    plaintext: '#6a737d',
    javascript: '#f1e05a',
    typescript: '#2b7489',
    jsx: '#61dafb',
    tsx: '#2b7489',
    json: '#292929',
    html: '#e34c26',
    css: '#563d7c',
    markdown: '#083fa1',
    xml: '#0060ac',
    yaml: '#cb171e',
    shell: '#89e051',
    python: '#3572A5',
    java: '#b07219',
    cpp: '#f34b7d',
    c: '#555555',
    go: '#00ADD8',
    rust: '#dea584',      // peach-ish
    toml: '#9c4221'
  };
  
  // Adjust foreground for contrast on light vs dark backgrounds
  function pickTextColor(bgHex) {
    // strip # and parse
    const hex = (bgHex || '#444444').replace('#','');
    const r = parseInt(hex.slice(0,2), 16);
    const g = parseInt(hex.slice(2,4), 16);
    const b = parseInt(hex.slice(4,6), 16);
    // perceived luminance
    const L = (0.2126*r + 0.7152*g + 0.0722*b) / 255;
    return L > 0.55 ? '#000000' : '#ffffff';
  }
  
  function updatePrimaryButton(){
    const m = modeSel.value;
    if (m === 'bulk') {
      btnSave.textContent = 'Run';
      btnSave.title = 'Run bulk commands';
      btnOpen.title = 'Open a source directory (Bulk)';
    } else {
      btnSave.textContent = 'Save';
      btnSave.title = 'Save current file';
      btnOpen.title = 'Open a file (Editor/Hex)';
    }
  }
  
  function setLanguageBadge(langKey) {
    const el = document.getElementById('statusLang');
    if (!el) return;
    const key = (langKey || 'plaintext').toLowerCase();
    const bg = LANGUAGE_COLORS[key] || LANGUAGE_COLORS.plaintext;
    el.textContent = key === 'cpp' ? 'C/C++' : key === 'c' ? 'C' : key[0].toUpperCase() + key.slice(1);
    el.style.backgroundColor = bg;
    el.style.color = pickTextColor(bg);
  }

  // Map selector value -> CM5 mode
  const KEY_TO_MODE = {
    plaintext: 'text/plain',
    javascript: 'javascript',
    typescript: 'text/typescript',          // CM5 MIME for TS
    jsx: 'jsx',                              // Requires mode/jsx loaded
    tsx: 'text/typescript-jsx',              // TSX MIME
    json: { name: 'javascript', json: true },
  
    html: 'htmlmixed',
    css: 'css',
    markdown: 'markdown',
    xml: 'xml',
    yaml: 'yaml',
    shell: 'shell',
    python: 'python',
  
    // These are MIME strings that CM resolves to the clike mode
    java: 'text/x-java',
    cpp:  'text/x-c++src',
    c:    'text/x-csrc',
  
    go: 'go',
    rust: 'rust',
    toml: 'toml'
  };

  // Map filename ext -> selector key
  const EXT_TO_KEY = {
    js:'javascript', mjs:'javascript', cjs:'javascript',
    ts:'typescript', jsx:'jsx', tsx:'tsx',
    json:'json', html:'html', htm:'html',
    css:'css', scss:'css',
    md:'markdown', markdown:'markdown',
    xml:'xml', yml:'yaml', yaml:'yaml',
    sh:'shell', bash:'shell',
    py:'python',
    java:'java',
    c:'c', h:'c', cpp:'cpp', cxx:'cpp', hpp:'cpp', hxx:'cpp',
    go:'go', rs:'rust',
    toml:'toml', ini:'toml', conf:'toml'
  };

  function applyLanguageCM5(key, filename = '') {
    if (!cm) return;
  
    // Shared key → CM5 mode mapping
    const KEY_TO_MODE = {
      plaintext: 'text/plain',
      javascript: 'javascript',
      typescript: 'text/typescript',
      jsx: 'jsx',
      tsx: 'text/typescript-jsx', // proper TSX MIME
      json: { name: 'javascript', json: true },
      html: 'htmlmixed',
      css: 'css',
      markdown: 'markdown',
      xml: 'xml',
      yaml: 'yaml',
      shell: 'shell',
      python: 'python',
      java: 'text/x-java',       // clike
      cpp:  'text/x-c++src',     // clike
      c:    'text/x-csrc',       // clike
      go: 'go',
      rust: 'rust',
      toml: 'toml'
    };
  
    // Auto-detect by file extension if needed
    let useKey = key;
    if (key === 'auto') {
      const ext = (filename.split('.').pop() || '').toLowerCase();
      const EXT_MAP = {
        js:'javascript', mjs:'javascript', cjs:'javascript',
        ts:'typescript', jsx:'jsx', tsx:'tsx',
        json:'json', html:'html', htm:'html',
        css:'css', scss:'css',
        md:'markdown', markdown:'markdown',
        xml:'xml', yml:'yaml', yaml:'yaml',
        sh:'shell', bash:'shell',
        py:'python', java:'java',
        c:'c', h:'c', cpp:'cpp', cxx:'cpp', hpp:'cpp', hxx:'cpp',
        go:'go', rs:'rust',
        toml:'toml', ini:'toml', conf:'toml'
      };
      useKey = EXT_MAP[ext] || 'plaintext';
    }
  
    const spec = KEY_TO_MODE[useKey] || 'text/plain';
  
    // Check if mode is loaded or is a MIME string CodeMirror can resolve
    const isAvailable = (m) => {
      if (!window.CodeMirror) return false;
      if (typeof m === 'string') return m.includes('/') || !!window.CodeMirror.modes[m];
      if (m && typeof m === 'object' && m.name) return m.name.includes('/') || !!window.CodeMirror.modes[m.name];
      return false;
    };
  
    // JSX/TSX gentle fallback if mode not yet loaded
    const wantJsx = useKey === 'jsx' || useKey === 'tsx';
    const finalSpec = isAvailable(spec) ? spec : (wantJsx ? 'javascript' : 'text/plain');
    const badgeKey  = isAvailable(spec) ? useKey : (wantJsx ? 'javascript' : 'plaintext');
  
    cm.setOption('mode', finalSpec);
    setLanguageBadge(badgeKey);
  }

  async function setEditorValue(text, filename='') {
    const ok = ensureCodeMirror();
    if (ok && cm) {
      cm.setValue(text || '');
      applyLanguageCM5(langSelect ? (langSelect.value || 'auto') : 'auto', filename);
      cmHost.style.display = '';
      txtEditor.classList.add('hidden');
    } else {
      txtEditor.value = text || '';
      txtEditor.classList.remove('hidden');
      cmHost.style.display = 'none';
    }
  }
  function getEditorValue() {
    if (cm) return cm.getValue();
    return txtEditor.value || '';
  }

  // Show an editor immediately on page load (empty doc)
  (function initEditorShell() {
    const ok = ensureCodeMirror();
    if (ok && cm) {
      cmHost.style.display = '';
      txtEditor.classList.add('hidden');
      if (langSelect) langSelect.value = 'auto';
      applyLanguageCM5(langSelect ? langSelect.value : 'auto', '');
    } else {
      cmHost.style.display = 'none';
      txtEditor.classList.remove('hidden');
    }
  })();

  // If the user changes the language dropdown, re-apply immediately
  if (langSelect) {
    langSelect.addEventListener('change', () => {
      applyLanguageCM5(langSelect.value || 'auto', window.currentFileName || '');
    });
  }

  // Autoload JSZip if missing (for fallback ZIP)
  async function ensureJSZip() {
    if (window.JSZip) return true;
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
      s.onload = () => res();
      s.onerror = () => rej(new Error('JSZip load failed'));
      document.head.appendChild(s);
    });
    return !!window.JSZip;
  }

  // ---------- UI elements ----------
  const modeSel = document.getElementById('mode');
  const btnOpen = document.getElementById('btnOpen');
  const btnSave = document.getElementById('btnSave');
  const btnPurge = document.getElementById('btnPurge');

  const editorPane = document.getElementById('editorPane');
  const hexPane = document.getElementById('hexPane');
  const bulkPane = document.getElementById('bulkPane');

  const outNameInput = document.getElementById('outputName');
  const outFolderNameInput = document.getElementById('outputFolderName');
  const singleNameLabel = document.getElementById('singleNameLabel');
  const bulkNameLabel = document.getElementById('bulkNameLabel');

  const statusEditor = document.getElementById('statusEditor');
  const loadedName = document.getElementById('loadedName');
  const loadedSize = document.getElementById('loadedSize');
  const loadedType = document.getElementById('loadedType');

  const txtHex = document.getElementById('txtHex');
  const txtHexAscii = document.getElementById('txtHexAscii');
  const statusHex = document.getElementById('statusHex');
  const hexBytes = document.getElementById('hexBytes');

  const txtCommands = document.getElementById('txtCommands');
  const statusBulk = document.getElementById('statusBulk');
  const bulkSource = document.getElementById('bulkSource');
  const bulkDest = document.getElementById('bulkDest');
  const bulkStrategy = document.getElementById('bulkStrategy');

  // ---------- State ----------
  let currentFileHandle = null;
  let currentFileBytes = null;   // ArrayBuffer
  let currentFileName = null;

  let bulkSrcDirHandle = null;
  let bulkDestDirHandle = null;

  // ---------- Helpers ----------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const fmtBytes = (n) => n == null ? '—' : (n < 1024 ? n + ' B' : (n < 1024*1024 ? (n/1024).toFixed(1)+' KB' : (n/1024/1024).toFixed(2)+' MB'));

function refreshEditor() {
  setTimeout(() => {
    if (cm && typeof cm.refresh === 'function') cm.refresh();      // text editor
    if (cmHex && typeof cmHex.refresh === 'function') cmHex.refresh(); // hex editor
  }, 0);
}

  
  window.addEventListener('resize', refreshEditor);
  
function setModeUI() {
  const m = modeSel.value;

  editorPane.classList.toggle('hidden', m !== 'editor');
  hexPane.classList.toggle('hidden', m !== 'hex');
  bulkPane.classList.toggle('hidden', m !== 'bulk');

  editorPane.classList.toggle('onecol', m === 'editor');

  singleNameLabel.classList.toggle('hidden', m === 'bulk');
  bulkNameLabel.classList.toggle('hidden', m !== 'bulk');

  if (m !== 'bulk') {
    outNameInput.required = true;
    outFolderNameInput.required = false;
  } else {
    outNameInput.required = false;
    outFolderNameInput.required = true;
  }

  if (m === 'hex') {
    ensureHexCodeMirror();     // <<< spin up colorized hex view
  }

  updatePrimaryButton();
  refreshEditor();
}

  setModeUI();
  modeSel.addEventListener('change', setModeUI);
  updatePrimaryButton();

  function updateLoadedInfo(name, size, type) {
    if (loadedName) loadedName.textContent = name ?? '—';
    if (loadedSize) loadedSize.textContent = fmtBytes(size);
  }

  function bufferToHexDump(buf) {
    const bytes = new Uint8Array(buf);
    const hex = [];
    const ascii = [];
    for (let i = 0; i < bytes.length; i++) {
      hex.push(bytes[i].toString(16).padStart(2,'0'));
      const ch = bytes[i];
      ascii.push((ch >= 32 && ch <= 126) ? String.fromCharCode(ch) : '.');
    }
    return { hex: hex.join(' '), ascii: ascii.join('') };
  }

  function hexDumpToBuffer(hexStr) {
    const tokens = hexStr.match(/[0-9a-fA-F]{2}/g) || [];
    const out = new Uint8Array(tokens.length);
    for (let i = 0; i < tokens.length; i++) {
      out[i] = parseInt(tokens[i], 16);
    }
    return out.buffer;
  }

  async function fileToArrayBuffer(file) {
    return await file.arrayBuffer();
  }
  function abToUtf8Safe(buf) {
    try {
      return new TextDecoder('utf-8', { fatal:false }).decode(buf);
    } catch (e) {
      return null;
    }
  }
  function utf8ToAB(str) {
    return new TextEncoder().encode(str).buffer;
  }

  function isLikelyText(name, buf) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const whitelist = new Set(['txt','md','json','js','ts','jsx','tsx','css','scss','html','xml','yml','yaml','csv','ini','conf','py','rb','go','rs','c','h','cpp','hpp','java','sh']);
    if (!whitelist.has(ext)) return false;

    const view = new Uint8Array(buf);
    const len = Math.min(view.length, 4096);
    for (let i=0;i<len;i++){
      if (view[i] === 0) return false;
    }
    return true;
  }

  const skipByExt = new Set(['doc','docx','pdf','png','jpg','jpeg','gif','webp','bmp','tiff','zip','rar','7z','gz','bz2','xz','tar','iso','mp3','mp4','mov','avi','mkv','wav','flac','ogg','woff','woff2','ttf','eot']);
  function isSupportedTextExt(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (skipByExt.has(ext)) return false;
    // extension gate only (content check is separate)
    return isLikelyText(name, new Uint8Array([65]).buffer);
  }

  function unescapeArg(s) {
    return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
  }

  function parseCommands(src) {
    const lines = src.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    const cmds = [];
    for (const line of lines) {
      const parts = line.split('|');
      const op = (parts[0]||'').trim().toUpperCase();
      const p1 = parts[1] != null ? unescapeArg(parts[1]) : undefined;
      const p2 = parts[2] != null ? unescapeArg(parts[2]) : undefined;

      const need = {
        'FIND_APPEND':2, 'FIND_BREAK':1, 'FIND_INSERT':2, 'FIND_REPLACE':2, 'FIND_DELETE':1,
        'LINE_APPEND':2, 'LINE_BREAK':1, 'LINE_REPLACE':2, 'LINE_DELETE':1
      }[op];

      if (!need) throw new Error(`Unknown command: ${op}`);
      if (parts.length-1 < need) throw new Error(`Command ${op} expects ${need} arg(s)`);
      // FIX: support APPEND_LINE alias for LINE_APPEND
      const normalized = (op === 'APPEND_LINE') ? 'LINE_APPEND' : op;  // FIX
      cmds.push({ op: normalized, a:p1, b:p2 });                       // FIX
    }
    return cmds;
  }

  function applyCommandsToText(content, cmds) {
    let lines = content.split(/\r?\n/);
  
    // Where to insert when the command is "append after line n"
    // Returns a position in [0..len] to splice at.
    function insertionPosAfterLine(n, len) {
      if (!Number.isFinite(n)) return null;
      if (n === 0) return 0;              // before first line
      if (n === -1) return len;           // very end
      if (n <= 0) return 0;               // clamp other non-positive to start
      if (n >= len) return len;           // after last line → end
      return n;                           // after line n (1-indexed)
    }
  
    // Which single line index to target for replace/delete
    // Returns [0..len-1] or null for no-op
    function lineIndex(n, len) {
      if (!Number.isFinite(n) || len === 0) return null;
      if (n === 0) return 0;              // first line
      if (n === -1) return len - 1;       // last line
      if (n < 1 || n > len) return null;  // out of range → no-op
      return n - 1;                       // 1-indexed → 0-indexed
    }
  
    for (const cmd of cmds) {
      switch (cmd.op) {
        // ------- FIND* commands (unchanged behavior) -------
        case 'FIND_APPEND': {
          const out = [];
          for (const line of lines) {
            out.push(line);
            if (line.includes(cmd.a)) out.push(cmd.b ?? '');
          }
          lines = out;
          break;
        }
        case 'FIND_BREAK': {
          const out = [];
          for (const line of lines) {
            out.push(line);
            if (line.includes(cmd.a)) out.push('');
          }
          lines = out;
          break;
        }
        case 'FIND_INSERT': {
          const needle = cmd.a, ins = cmd.b ?? '';
          lines = lines.map(line => line.includes(needle) ? line.split(needle).join(needle + ins) : line);
          break;
        }
        case 'FIND_REPLACE': {
          const needle = cmd.a, repl = cmd.b ?? '';
          lines = lines.map(line => line.split(needle).join(repl));
          break;
        }
        case 'FIND_DELETE': {
          const needle = cmd.a;
          lines = lines.map(line => line.split(needle).join(''));
          break;
        }
  
        // ------- LINE* commands (fixed indexing) -------
        case 'LINE_APPEND': {
          const n = +cmd.a, ins = cmd.b ?? '';
          const pos = insertionPosAfterLine(n, lines.length);
          if (pos == null) break;
          lines.splice(pos, 0, ins);
          break;
        }
        case 'LINE_BREAK': {
          const n = +cmd.a;
          const pos = insertionPosAfterLine(n, lines.length);
          if (pos == null) break;
          lines.splice(pos, 0, '');
          break;
        }
        case 'LINE_REPLACE': {
          const n = +cmd.a, ins = cmd.b ?? '';
          const idx = lineIndex(n, lines.length);
          if (idx == null) break;         // out-of-range → no-op (preserves prior behavior)
          lines[idx] = ins;
          break;
        }
        case 'LINE_DELETE': {
          const n = +cmd.a;
          const idx = lineIndex(n, lines.length);
          if (idx == null) break;         // out-of-range → no-op
          lines.splice(idx, 1);
          break;
        }
      }
    }
  
    return lines.join('\n');
  }

  async function pickFileForOpen() {
    if (supportFS) {
      const [fh] = await window.showOpenFilePicker({ multiple:false });
      return fh;
    } else {
      return new Promise((resolve) => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.onchange = () => { resolve({ _fallbackFile: inp.files[0] }); };
        inp.click();
      });
    }
  }

  async function getFileFromHandle(fh) {
    if (fh._fallbackFile) return fh._fallbackFile;
    return await fh.getFile();
  }

  async function saveSingleFile(bytes, suggestedName) {
    if (supportFS) {
      const fh = await window.showSaveFilePicker({ suggestedName });
      const w = await fh.createWritable();
      await w.write(bytes);
      await w.close();
      return { method:'fs', name:suggestedName };
    } else {
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = suggestedName || 'edited.bin';
      a.click();
      URL.revokeObjectURL(url);
      return { method:'download', name:suggestedName };
    }
  }
  
  async function triggerPurge() {
    if (!confirm("Erase ALL site data (cookies, storage, caches) and reload?")) return;
    await purgeLocalData();           // defined below
    alert("Local data wiped.");
    location.reload();
  }
  
  // Track created object URLs (optional, see download() patch below)
  window.__objectUrls = window.__objectUrls || new Set();
  
  async function purgeLocalData() {
    // Close modal if open
    try { document.getElementById("resultModal").style.display = "none"; } catch {}
  
    // Clear inputs / textareas / selects / code/pre viewers
    document.querySelectorAll("input, textarea").forEach(el => {
      if (el.type === "file") el.value = "";
      else el.value = "";
    });
    document.querySelectorAll("select").forEach(s => { try { s.selectedIndex = 0; } catch {} });
    document.querySelectorAll("code, pre, #modalResultText, .viewer").forEach(el => el.textContent = "");
  
    // Clipboard (best-effort)
    try { await navigator.clipboard.writeText(""); } catch {}
  
    // Web Storage
    try { localStorage.clear(); } catch {}
    try { sessionStorage.clear(); } catch {}
  
    // IndexedDB (Chromium supports indexedDB.databases())
    try {
      if (indexedDB && indexedDB.databases) {
        const dbs = await indexedDB.databases();
        for (const db of dbs) {
          if (!db.name) continue;
          await new Promise(res => {
            const req = indexedDB.deleteDatabase(db.name);
            req.onsuccess = req.onerror = req.onblocked = () => res();
          });
        }
      } else {
        // If you know your DB names, list them here as fallback
        ["openpgp", "cryptology-monster"].forEach(name => { try { indexedDB.deleteDatabase(name); } catch {} });
      }
    } catch {}
  
    // Cache Storage
    try {
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch {}
  
    // Service Workers
    try {
      if (navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
    } catch {}
  
    // Cookies (try multiple domain/path combos; cannot remove HttpOnly)
    try { purgeCookies(); } catch {}
  
    // Revoke any object URLs we tracked
    try {
      for (const u of window.__objectUrls) { URL.revokeObjectURL(u); }
      window.__objectUrls.clear();
    } catch {}
  
    // Reset tool UI
    try {
      const sel = document.getElementById("toolSelect");
      if (sel) { sel.selectedIndex = 0; sel.dispatchEvent(new Event("change")); }
    } catch {}
  }
  
  function purgeCookies() {
    const names = document.cookie.split(";").map(c => c.split("=")[0].trim()).filter(Boolean);
    if (!names.length) return;
    const parts = location.hostname.split(".");
    const paths = [location.pathname, "/"];
    for (const name of names) {
      // current host + path
      for (const path of paths) {
        document.cookie = `${name}=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=${path}`;
      }
      // dot-domain variants
      for (let i = 0; i < parts.length; i++) {
        const domain = "." + parts.slice(i).join(".");
        for (const path of paths) {
          document.cookie = `${name}=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=${path}; Domain=${domain}`;
        }
      }
    }
  }

  async function pickSourceDirectory() {
    if (supportFS) {
      return await window.showDirectoryPicker();
    } else {
      return new Promise((resolve) => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.webkitdirectory = true;
        inp.multiple = true;
        inp.onchange = () => { resolve({ _fallbackFiles: Array.from(inp.files || []) }); };
        inp.click();
      });
    }
  }

  async function pickDestDirectory() {
    if (supportFS) {
      return await window.showDirectoryPicker({ mode:'readwrite' });
    } else {
      return null; // ZIP fallback path will be used
    }
  }
  
  btnPurge?.addEventListener('click', triggerPurge);

  // ---------- OPEN ----------
  btnOpen.addEventListener('click', async () => {
    const m = modeSel.value;
    if (m === 'editor' || m === 'hex') {
      try {
        if (statusEditor) statusEditor.textContent = '';
        if (statusHex) statusHex.textContent = '';

        currentFileHandle = await pickFileForOpen();
        const file = await getFileFromHandle(currentFileHandle);
        currentFileName = file.name;
        currentFileBytes = await fileToArrayBuffer(file);

        updateLoadedInfo(file.name, file.size || '(unknown)');

        const asText = abToUtf8Safe(currentFileBytes);
        await setEditorValue(asText ?? '[Binary/un-decodable as UTF-8 — edit in Hex mode]', currentFileName);
        refreshEditor();

        const { hex, ascii } = bufferToHexDump(currentFileBytes);
        if (txtHex) txtHex.value = hex;
        if (txtHexAscii) txtHexAscii.value = ascii;
        if (modeSel.value === 'hex') ensureHexCodeMirror();
        if (cmHex) cmHex.setValue(hex);
        refreshEditor();
        if (hexBytes) hexBytes.textContent = (new Uint8Array(currentFileBytes)).length.toString();
        if (statusEditor) statusEditor.textContent = 'Loaded.';
        if (statusHex) statusHex.textContent = 'Loaded.';

        if (langSelect) langSelect.value = 'auto';
        applyLanguageCM5(langSelect ? langSelect.value : 'auto', currentFileName);

      } catch (err) {
        const msg = 'Open failed: ' + err.message;
        if (statusEditor) statusEditor.textContent = msg;
        if (statusHex) statusHex.textContent = msg;
      }
    } else {
      try {
        if (statusBulk) statusBulk.textContent = '';
        bulkSrcDirHandle = await pickSourceDirectory();

        if (bulkSrcDirHandle && bulkSrcDirHandle._fallbackFiles) {
          if (bulkSource) bulkSource.textContent = `Folder (fallback) with ${bulkSrcDirHandle._fallbackFiles.length} files`;
          if (bulkStrategy) bulkStrategy.textContent = 'ZIP on save';
        } else {
          if (bulkSource) bulkSource.textContent = 'Directory (FS Access)';
          if (bulkStrategy) bulkStrategy.textContent = 'Direct write to destination';
        }
        if (bulkDest) bulkDest.textContent = '—';
      } catch (err) {
        if (statusBulk) statusBulk.textContent = 'Open source directory failed: ' + err.message;
      }
    }
  });

  // ---------- SAVE / RUN ----------
  btnSave.addEventListener('click', async () => {
    const m = modeSel.value;

    if (m === 'editor') {
      const name = (outNameInput.value || '').trim();
      if (!name) { outNameInput.classList.add('need'); return; } else outNameInput.classList.remove('need');

      try {
        const bytes = utf8ToAB(getEditorValue());
        const res = await saveSingleFile(bytes, name);
        if (statusEditor) statusEditor.textContent = `Saved (${res.method}): ${res.name}`;
      } catch (err) {
        if (statusEditor) statusEditor.textContent = 'Save failed: ' + err.message;
      }
    }

    if (m === 'hex') {
      const name = (outNameInput.value || '').trim();
      if (!name) { outNameInput.classList.add('need'); return; } else outNameInput.classList.remove('need');

      try {
        const buf = hexDumpToBuffer(getHexText());
        const res = await saveSingleFile(buf, name);
        if (statusHex) statusHex.textContent = `Saved (${res.method}): ${res.name}`;
      } catch (err) {
        if (statusHex) statusHex.textContent = 'Save failed: ' + err.message;
      }
    }

    if (m === 'bulk') {
      const outFolderName = (outFolderNameInput.value || '').trim();
      if (!outFolderName) { outFolderNameInput.classList.add('need'); return; } else outFolderNameInput.classList.remove('need');

      if (!bulkSrcDirHandle) { if (statusBulk) statusBulk.textContent = 'Pick a source directory first.'; return; }

      let commands = [];
      try {
        commands = parseCommands(txtCommands.value || '');
      } catch (err) {
        if (statusBulk) statusBulk.textContent = 'Command parse error: ' + err.message;
        return;
      }

      try {
        if (statusBulk) statusBulk.textContent = 'Running…';
        if (bulkSrcDirHandle._fallbackFiles) {
          await ensureJSZip();
          const zip = new JSZip();
          const files = bulkSrcDirHandle._fallbackFiles;

          for (const file of files) {
            const rel = file.webkitRelativePath || file.name;
            if (!isSupportedTextExt(rel)) continue;

            const buf = await file.arrayBuffer();
            if (!isLikelyText(rel, buf)) continue;

            const content = new TextDecoder().decode(buf);
            const edited = applyCommandsToText(content, commands);
            zip.file(`${outFolderName}/${rel}`, edited);
          }

          const blob = await zip.generateAsync({ type:'blob' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = `${outFolderName}.zip`;
          a.click();
          URL.revokeObjectURL(url);
          if (statusBulk) statusBulk.textContent = `Done. Downloaded ${outFolderName}.zip`;
          if (bulkDest) bulkDest.textContent = `${outFolderName}.zip (download)`;
          if (bulkStrategy) bulkStrategy.textContent = 'ZIP (fallback)';
        } else {
          bulkDestDirHandle = await pickDestDirectory();
          if (!bulkDestDirHandle) { if (statusBulk) statusBulk.textContent = 'Destination not selected.'; return; }

          // FIX: block dest == src (prevents immediate recursion)
          if (bulkDestDirHandle.isSameEntry && await bulkDestDirHandle.isSameEntry(bulkSrcDirHandle)) { // FIX
            if (statusBulk) statusBulk.textContent = 'Destination cannot be the same as source.';       // FIX
            return;                                                                                    // FIX
          }                                                                                            // FIX

          const outRoot = await bulkDestDirHandle.getDirectoryHandle(outFolderName, { create:true });

          let count = 0;
          async function walk(srcDir, outDir) {
            for await (const [name, handle] of srcDir.entries()) {
              if (handle.kind === 'directory') {
                // FIX: never descend into the just-created output folder name
                if (name === outFolderName) continue;                                // FIX
                const subOut = await outDir.getDirectoryHandle(name, { create:true });
                await walk(handle, subOut);
              } else {
                const file = await handle.getFile();
                const buf = await file.arrayBuffer();
                if (!isSupportedTextExt(name) || !isLikelyText(name, buf)) continue;

                const content = new TextDecoder().decode(buf);
                const edited = applyCommandsToText(content, commands);

                const fh = await outDir.getFileHandle(name, { create:true });
                const w = await fh.createWritable();
                await w.write(edited);
                await w.close();
                count++;
              }
            }
          }

          await walk(bulkSrcDirHandle, outRoot);
          if (statusBulk) statusBulk.textContent = `Done. Wrote ${outFolderName}/ (files: ${count})`;
          if (bulkDest) bulkDest.textContent = outFolderName + ' (directory)';
          if (bulkStrategy) bulkStrategy.textContent = 'Direct write (FS Access)';
        }
      } catch (err) {
        if (statusBulk) statusBulk.textContent = 'Bulk failed: ' + err.message;
      }
    }
  });

  // Keep the ASCII preview live when editing hex text
  if (txtHex) {
    txtHex.addEventListener('input', () => {
      try {
        const buf = hexDumpToBuffer(txtHex.value);
        const { ascii } = bufferToHexDump(buf);
        if (txtHexAscii) txtHexAscii.value = ascii;
        if (hexBytes) hexBytes.textContent = new Uint8Array(buf).length.toString();
        if (statusHex) statusHex.textContent = '';
      } catch (e) {
        if (statusHex) statusHex.textContent = 'Hex parse error.';
      }
    });
  }
})();

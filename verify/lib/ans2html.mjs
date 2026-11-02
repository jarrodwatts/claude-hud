// `tmux capture-pane -e -p` output -> one self-contained HTML page. Keeps SGR colours and OSC 8 links.
const BASE = ['#1e1e1e', '#e05561', '#8cc265', '#d18f52', '#4aa5f0', '#c162de', '#42b3c2', '#e6e6e6',
  '#5c6370', '#ff616e', '#a5e075', '#f0a45d', '#4dc4ff', '#de73ff', '#4cd1e0', '#ffffff'];
const cube = (v) => (v ? v * 40 + 55 : 0);
const c256 = (n) => n < 16 ? BASE[n]
  : n < 232 ? `rgb(${cube(Math.floor((n - 16) / 36))},${cube(Math.floor((n - 16) / 6) % 6)},${cube((n - 16) % 6)})`
  : `rgb(${(n - 232) * 10 + 8},${(n - 232) * 10 + 8},${(n - 232) * 10 + 8})`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function ans2html(text, title) {
  let st = {};
  let html = '';
  let link = false;
  const css = () => {
    let [fg, bg] = [st.fg, st.bg];
    if (st.inv) [fg, bg] = [bg ?? '#1e1e1e', fg ?? '#d4d4d4'];
    return [fg && `color:${fg}`, bg && `background:${bg}`, st.bold && 'font-weight:bold', st.dim && 'opacity:.6',
      st.it && 'font-style:italic', st.ul && 'text-decoration:underline'].filter(Boolean).join(';');
  };
  const sgr = (params) => {
    const p = params === '' ? [0] : params.split(/[;:]/).map(Number);
    for (let i = 0; i < p.length; i++) {
      const n = p[i];
      if (n === 0) st = {};
      else if (n === 1) st.bold = true;
      else if (n === 2) st.dim = true;
      else if (n === 3) st.it = true;
      else if (n === 4) st.ul = true;
      else if (n === 7) st.inv = true;
      else if (n === 22) st.bold = st.dim = false;
      else if (n === 23) st.it = false;
      else if (n === 24) st.ul = false;
      else if (n === 27) st.inv = false;
      else if (n >= 30 && n <= 37) st.fg = BASE[n - 30];
      else if (n >= 90 && n <= 97) st.fg = BASE[n - 82];
      else if (n === 39) st.fg = undefined;
      else if (n >= 40 && n <= 47) st.bg = BASE[n - 40];
      else if (n >= 100 && n <= 107) st.bg = BASE[n - 92];
      else if (n === 49) st.bg = undefined;
      else if (n === 38 || n === 48) {
        const key = n === 38 ? 'fg' : 'bg';
        if (p[i + 1] === 5) [st[key], i] = [c256(p[i + 2]), i + 2];
        else if (p[i + 1] === 2) [st[key], i] = [`rgb(${p[i + 2]},${p[i + 3]},${p[i + 4]})`, i + 4];
      }
    }
  };
  const re = /\x1b\[([0-9;:]*)m|\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]*)(?:\x07|\x1b\\)|\x1b[^a-zA-Z]*[a-zA-Z]|([^\x1b]+)/g;
  for (const m of text.matchAll(re)) {
    if (m[1] !== undefined) sgr(m[1]);
    else if (m[2] !== undefined) {
      if (link) html += '</a>';
      link = m[2] !== '';
      if (link) html += `<a href="${esc(m[2])}">`;
    } else if (m[3] !== undefined) html += `<span style="${css()}">${esc(m[3])}</span>`;
  }
  if (link) html += '</a>';
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{margin:0;background:#1e1e1e}pre{margin:0;padding:14px 16px;color:#d4d4d4;white-space:pre;
font:13px/1.25 "DejaVu Sans Mono","Noto Sans Mono","Noto Sans Symbols 2","Noto Sans Symbols",monospace}a{color:inherit}</style>
<pre>${html}</pre>\n`;
}

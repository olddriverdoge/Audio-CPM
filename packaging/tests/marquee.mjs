import { JSDOM } from 'jsdom';
const BASE = 'http://127.0.0.1:8000';
await fetch(BASE + '/api/ui_config', {method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({config:{}})}).catch(() => {});
const results = [];
const check = (n, ok, x = '') => results.push([ok ? 'OK  ' : 'FAIL', n, x]);
const dom = await JSDOM.fromURL(BASE + '/', {
  resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(window) {
    window.matchMedia = window.matchMedia || (q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
    window.IntersectionObserver = class { constructor(cb){this.cb=cb;} observe(el){this.cb([{isIntersecting:true,target:el}],this);} unobserve(){} disconnect(){} };
    window.EventSource = class { constructor(){this.readyState=0;} close(){} addEventListener(){} };
    window.fetch = async (u, o) => fetch(String(u).startsWith('http') ? String(u) : BASE + String(u), o);
    window.HTMLCanvasElement.prototype.getContext = function(){ return { createLinearGradient:()=>({addColorStop(){}}), beginPath(){}, moveTo(){}, lineTo(){}, quadraticCurveTo(){}, closePath(){}, fill(){}, fillRect(){}, clearRect(){}, fillText(){}, stroke(){}, set fillStyle(v){}, set strokeStyle(v){}, set font(v){}, set textAlign(v){}, set textBaseline(v){}, set lineWidth(v){} }; };
    window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AAAA';
    window.alert = () => {}; window.confirm = () => true; window.prompt = () => '';
    window.requestAnimationFrame = cb => setTimeout(() => cb(0), 16);
    window.cancelAnimationFrame = id => clearTimeout(id);
  },
});
await new Promise(r => dom.window.document.readyState === 'complete' ? r() : dom.window.addEventListener('load', r));
const w = dom.window, d = w.document, sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = c => w.eval(c);
const click = el => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await sleep(1600);
click(d.querySelector('#page-seg button[data-page="organize"]'));
await sleep(1200);
const nameCells = d.querySelectorAll('#view2 .item.file .name');
const wrapped = d.querySelectorAll('#view2 .item.file .name .cell-in');
check('文件名单元格已包 .cell-in', nameCells.length > 0 && wrapped.length === nameCells.length,
      wrapped.length + '/' + nameCells.length);
check('名称文本仍在', nameCells.length > 0 && (nameCells[0].textContent || '').length > 0,
      nameCells.length ? nameCells[0].textContent.slice(0, 20) : '');
// 标签列 hydrate 后仍保留包装
const colCells = d.querySelectorAll('#view2 .item.file .col[data-col]');
if (colCells.length) {
  check('标签列也有 .cell-in 包装', !!colCells[0].querySelector('.cell-in'),
        colCells[0].innerHTML.slice(0, 40));
}
// 样式检查：单元格裁剪
const css = await (await fetch(BASE + '/css/process.css')).text();
check('单元格 overflow:hidden', /\.item \.name\{[^}]*overflow:hidden/.test(css.replace(/\n/g, ' ')));
check('抖动只在 .cell-in 上', /\.cell-in\{[^}]*animation|mqScroll/.test(css));
for (const [s, n, x] of results) console.log(s + ' ' + n + (x ? '  [' + x + ']' : ''));
console.log('RESULT:', results.every(x => x[0] === 'OK  ') ? 'PASS' : 'FAIL');

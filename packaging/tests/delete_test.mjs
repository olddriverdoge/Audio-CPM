import { JSDOM } from 'jsdom';
import fs from 'node:fs';
const BASE = 'http://127.0.0.1:8000';
const TESTFILE = '/sdcard/ADM/__ac2_del_test__.flac';
const TESTREF = 'local:' + TESTFILE;
fs.writeFileSync(TESTFILE, 'delete me');
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
    window.HTMLCanvasElement.prototype.getContext = function(){ return { createLinearGradient:()=>({addColorStop(){}}), beginPath(){}, moveTo(){}, lineTo(){}, quadraticCurveTo(){}, closePath(){}, fill(){}, fillRect(){}, clearRect(){}, fillStyle:'', globalAlpha:1 }; };
    window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AAAA';
    window.alert = () => {}; window.confirm = () => true; window.prompt = () => '';
    window.URL.createObjectURL = () => 'blob:fake';
    window.requestAnimationFrame = cb => setTimeout(() => cb(0), 16);
    window.cancelAnimationFrame = id => clearTimeout(id);
  },
});
await new Promise(r => dom.window.document.readyState === 'complete' ? r() : dom.window.addEventListener('load', r));
const w = dom.window, d = w.document, sleep = ms => new Promise(r => setTimeout(r, ms));
const click = el => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await sleep(1600);
click(d.querySelector('#page-seg button[data-page="organize"]'));
await sleep(1200);
const row = await (async () => {
  for (let i = 0; i < 10; i++) {
    const r = d.querySelector('#view2 .item.file[data-path="' + TESTREF + '"]');
    if (r) return r;
    await sleep(300);
  }
  return null;
})();
check('测试文件出现在列表', !!row);
if (row) {
  row.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: 30, clientY: 30 }));
  await sleep(800);
  const del = d.querySelector('#ctx-menu [data-cmd="row-delete"]');
  check('长按菜单出现删除项', !!del, del ? del.textContent : '');
  click(del);
  await sleep(1200);
  check('文件已从磁盘删除', !fs.existsSync(TESTFILE));
  check('列表行已消失', !d.querySelector('#view2 .item.file[data-path="' + TESTREF + '"]'));
}
try { fs.unlinkSync(TESTFILE); } catch (_) {}
for (const [s, n, x] of results) console.log(s + ' ' + n + (x ? '  [' + x + ']' : ''));
console.log('RESULT:', results.every(x => x[0] === 'OK  ') ? 'PASS' : 'FAIL');

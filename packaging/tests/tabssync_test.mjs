import { JSDOM } from 'jsdom';
const BASE = 'http://127.0.0.1:8000';
await fetch(BASE + '/api/ui_config', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({config:{}})}).catch(()=>{});
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
    window.URL.createObjectURL = () => 'blob:fake';
    try { window.localStorage.clear(); } catch (_) {}
  },
});
await new Promise(r => dom.window.document.readyState === 'complete' ? r() : dom.window.addEventListener('load', r));
const w = dom.window, d = w.document, sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = c => w.eval(c);
const sel = () => d.getElementById('source-select');
await sleep(2600);
check('初始目标目录为本地', ev('App.path').indexOf('local:') === 0, ev('App.path'));

/* 切到 dav：主列表 + 整理页源列表 + 目标目录一起切 */
sel().value = 'testdav';
sel().dispatchEvent(new w.Event('change', { bubbles: true }));
await sleep(2500);
check('主列表到 dav 根', ev('App.path') === 'dav:testdav/', ev('App.path'));
check('整理页源列表到 dav', String(ev('App.srcPath')) === 'dav:testdav/', ev('App.srcPath'));
const tabs = Array.from(d.querySelectorAll('#tree-tabs .tree-tab[data-i]'));
check('目标目录标签切到 dav', tabs.length > 0 && String(tabs[0].title).indexOf('dav:testdav') === 0,
      tabs.map(t => t.title).join('|'));
check('目标树根节点是 dav', Array.from(d.querySelectorAll('#tree .tree-node')).some(n => String(n.dataset.path).indexOf('dav:testdav') === 0),
      String((d.querySelector('#tree .tree-node') || {}).dataset && d.querySelector('#tree .tree-node').dataset.path));

/* 进 dav 子目录：整理页保持自己的源根（两页浏览位置独立） */
const dir = Array.from(d.querySelectorAll('#view1 .item.dir')).find(x => (x.textContent || '').indexOf('Music') >= 0);
if (dir) {
  dir.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(1800);
  check('子目录浏览后整理页保持源根', String(ev('App.srcPath')) === 'dav:testdav/', ev('App.srcPath'));
}

/* 切回本地：目标目录回到本地记忆 */
sel().value = 'local';
sel().dispatchEvent(new w.Event('change', { bubbles: true }));
await sleep(2200);
check('整理页回到本地', String(ev('App.srcPath')).indexOf('local:') === 0, ev('App.srcPath'));
const tabs2 = Array.from(d.querySelectorAll('#tree-tabs .tree-tab[data-i]'));
check('目标目录回到本地', tabs2.length > 0 && String(tabs2[0].title).indexOf('local:') === 0,
      tabs2.map(t => t.title).join('|'));

for (const [s, n, x] of results) console.log(s + ' ' + n + (x ? '  [' + x + ']' : ''));
console.log('RESULT:', results.every(x => x[0] === 'OK  ') ? 'PASS' : 'FAIL');

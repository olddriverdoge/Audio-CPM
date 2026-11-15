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

check('初始在本地', String(ev('App.path')).indexOf('local:') === 0, ev('App.path'));
check('下拉含 dav 源', Array.from(sel().options).some(o => o.value === 'testdav'));

/* 首次切到 dav：没有访问记录 → 根目录 */
sel().value = 'testdav';
sel().dispatchEvent(new w.Event('change', { bubbles: true }));
await sleep(1800);
check('首次切 dav 到根目录', ev('App.path') === 'dav:testdav/', ev('App.path'));
check('dav 根有内容', d.querySelectorAll('#view1 .item').length > 0, String(d.querySelectorAll('#view1 .item').length));

/* 进入 dav 子目录后切回本地，再切回 dav：应回到上次目录 */
const dir = Array.from(d.querySelectorAll('#view1 .item.dir')).find(x => (x.textContent || '').indexOf('Music') >= 0);
check('dav 目录可见', !!dir);
if (dir) {
  dir.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(1500);
  check('进入 dav 子目录', ev('App.path') === 'dav:testdav/Music', ev('App.path'));
}
sel().value = 'local';
sel().dispatchEvent(new w.Event('change', { bubbles: true }));
await sleep(1500);
check('切回本地', String(ev('App.path')).indexOf('local:') === 0, ev('App.path'));
sel().value = 'testdav';
sel().dispatchEvent(new w.Event('change', { bubbles: true }));
await sleep(1800);
check('再次切 dav 回到上次目录', ev('App.path') === 'dav:testdav/Music', ev('App.path'));

/* 记忆路径失效：手动把记忆改成不存在的目录，应回退根目录 */
ev("Store.set('ac2_src_paths', {'testdav': 'dav:testdav/NoSuchDir'})");
sel().value = 'local';
sel().dispatchEvent(new w.Event('change', { bubbles: true }));
await sleep(1200);
sel().value = 'testdav';
sel().dispatchEvent(new w.Event('change', { bubbles: true }));
await sleep(1800);
check('记忆失效时回退根目录', ev('App.path') === 'dav:testdav/', ev('App.path'));

for (const [s, n, x] of results) console.log(s + ' ' + n + (x ? '  [' + x + ']' : ''));
console.log('RESULT:', results.every(x => x[0] === 'OK  ') ? 'PASS' : 'FAIL');

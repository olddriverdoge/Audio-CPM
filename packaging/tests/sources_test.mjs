import { JSDOM } from 'jsdom';
const BASE = 'http://127.0.0.1:8000';
await fetch(BASE + '/api/storage/sources/delete', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id:'testdav'})}).catch(()=>{});
await fetch(BASE + '/api/ui_config', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({config:{}})}).catch(()=>{});
await fetch(BASE + '/api/storage/sources', {method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({id:'testdav', kind:'dav', name:'测试NAS', url:'http://127.0.0.1:8099/', readonly:false})});
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
  },
});
await new Promise(r => dom.window.document.readyState === 'complete' ? r() : dom.window.addEventListener('load', r));
const w = dom.window, d = w.document, sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = c => w.eval(c);
await sleep(2600);

const sel = d.getElementById('source-select');
check('数据源下拉存在', !!sel);
check('下拉包含本地与 WebDAV', sel && sel.querySelectorAll('option').length === 2,
      sel ? Array.from(sel.options).map(o => o.textContent).join(',') : '');
check('设置面板有存储源表单', !!d.getElementById('src-url') && !!d.getElementById('src-save'));

/* 切到 WebDAV 源 */
sel.value = 'testdav';
sel.dispatchEvent(new w.Event('change', { bubbles: true }));
await sleep(1800);
check('切换后浏览到 dav 根', String(ev('App.path')).indexOf('dav:testdav') === 0, ev('App.path'));
check('dav 源禁用本地任务按钮', d.getElementById('start-btn').disabled === true);
check('dav 源隐藏外部播放器入口', d.getElementById('pb-ext').style.display === 'none');
check('dav 面包屑带前缀', Array.from(d.querySelectorAll('#pb1-crumbs .crumb')).some(a => String(a.dataset.crumb).indexOf('dav:testdav') === 0),
      Array.from(d.querySelectorAll('#pb1-crumbs .crumb')).map(a => a.dataset.crumb).join('|'));

/* 浏览 dav 子目录 */
const dir = Array.from(d.querySelectorAll('#view1 .item.dir')).find(x => (x.textContent || '').indexOf('Music') >= 0);
check('dav 目录可点击', !!dir, dir ? dir.dataset.dirPath : '');
if (dir) {
  dir.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(1500);
  check('进入 dav 子目录', String(ev('App.path')).indexOf('/Music') > 0, ev('App.path'));
}

/* 切回本地 */
sel.value = 'local';
sel.dispatchEvent(new w.Event('change', { bubbles: true }));
await sleep(1800);
check('切回本地后任务按钮可用', d.getElementById('start-btn').disabled === false);
check('切回本地显示外部播放器', d.getElementById('pb-ext').style.display !== 'none');

for (const [s, n, x] of results) console.log(s + ' ' + n + (x ? '  [' + x + ']' : ''));
console.log('RESULT:', results.every(x => x[0] === 'OK  ') ? 'PASS' : 'FAIL');

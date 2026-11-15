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
    window.URL.createObjectURL = () => 'blob:fake';
    window.requestAnimationFrame = cb => setTimeout(() => cb(0), 16);
    window.cancelAnimationFrame = id => clearTimeout(id);
    Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', { configurable: true, get() { return !this._playing; } });
    Object.defineProperty(window.HTMLMediaElement.prototype, 'play', { configurable: true, value() { this._playing = true; this.dispatchEvent(new window.Event('play')); return Promise.resolve(); } });
    Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', { configurable: true, value() { this._playing = false; this.dispatchEvent(new window.Event('pause')); } });
    Object.defineProperty(window.HTMLMediaElement.prototype, 'load', { configurable: true, value() {} });
  },
});
await new Promise(r => dom.window.document.readyState === 'complete' ? r() : dom.window.addEventListener('load', r));
const w = dom.window, d = w.document, sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = c => w.eval(c);
const click = el => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await sleep(1600);

check('处理页有右侧栏', !!d.getElementById('p1-side'));
check('处理页侧栏默认收起', d.getElementById('p1-side').classList.contains('collapsed'));
check('处理页元数据模块存在', !!d.getElementById('meta1'));
check('全局频谱模块存在', !!d.getElementById('sf-fab') && !!d.getElementById('spectrum-float') && !!d.getElementById('sf-canvas'));

/* 展开 / 收起 */
click(d.getElementById('meta1-head'));
await sleep(250);
check('点标签展开侧栏', !d.getElementById('p1-side').classList.contains('collapsed'));
click(d.getElementById('meta1-head'));
await sleep(250);
check('再点收起侧栏', d.getElementById('p1-side').classList.contains('collapsed'));

/* 全局频谱：从处理页也能打开 */
click(d.getElementById('sf-fab'));
await sleep(250);
check('处理页可打开全局频谱', !d.getElementById('spectrum-float').classList.contains('hidden'));
// 拖动右下角调整大小
const rz = d.getElementById('sf-resize');
rz.dispatchEvent(new w.MouseEvent('pointerdown', {bubbles:true, clientX:300, clientY:300}));
rz.dispatchEvent(new w.MouseEvent('pointermove', {bubbles:true, clientX:420, clientY:380}));
rz.dispatchEvent(new w.MouseEvent('pointerup', {bubbles:true}));
await sleep(150);
check('可拖动调整频谱大小', parseFloat(d.getElementById('spectrum-float').style.width) > 0,
      d.getElementById('spectrum-float').style.width);
click(d.getElementById('sf-min'));
await sleep(200);

/* 处理页列表：目录可选 + 点击播放 + 元数据联动（与整理页同一套） */
const dirRow = d.querySelector('#view1 .item.dir');
check('处理页目录行有复选框', !!d.querySelector('#view1 .item.dir .chk'));
if (dirRow) {
  dirRow.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: 20, clientY: 20 }));
  await sleep(750);
  check('处理页长按目录弹菜单', !d.getElementById('menu-overlay').classList.contains('hidden'));
  check('菜单含删除文件夹', !!d.querySelector('#ctx-menu [data-cmd="row-delete"]'));
  ev(`document.getElementById('menu-overlay').click()`);
  await sleep(900);
}
const fileRow = d.querySelector('#view1 .item.file');
if (fileRow) {
  const path = fileRow.dataset.path;
  click(fileRow.querySelector('.name') || fileRow);
  await sleep(1200);
  check('处理页点击文件即播放', ev('Player.current') === path, ev('Player.current'));
  check('处理页元数据联动加载', (d.getElementById('meta1').textContent || '').indexOf('文件') >= 0,
        (d.getElementById('meta1').textContent || '').slice(0, 40));
}

/* 配置共享：同一个 Columns 作用于两页 */
check('两页共用同一列配置', ev('Columns.active().length') === d.querySelectorAll('#view1 .item.head .hcell').length,
      String(ev('Columns.active().length')) + ' vs ' + d.querySelectorAll('#view1 .item.head .hcell').length);

for (const [s, n, x] of results) console.log(s + ' ' + n + (x ? '  [' + x + ']' : ''));
console.log('RESULT:', results.every(x => x[0] === 'OK  ') ? 'PASS' : 'FAIL');

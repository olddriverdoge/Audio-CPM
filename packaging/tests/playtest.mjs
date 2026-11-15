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
    window.HTMLElement.prototype.requestFullscreen = function () { return Promise.resolve(); };
  },
});
await new Promise(r => dom.window.document.readyState === 'complete' ? r() : dom.window.addEventListener('load', r));
const w = dom.window, d = w.document, sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = c => w.eval(c);
const click = el => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await sleep(1600);

/* 旋转按钮已移除（风险高，不再提供） */
check('旋转按钮已移除', !d.getElementById('btn-rotate') && !d.body.classList.contains('rot90'));

/* 顺序播放按钮 */
check('存在顺序播放按钮', !!d.getElementById('btn-autoplay'));
click(d.getElementById('btn-autoplay'));
await sleep(200);
check('开启后按钮高亮', d.getElementById('btn-autoplay').classList.contains('on'));
check('开关已保存', ev('Store.get(K.autoplay)') === true);

/* 顺序播放：ended 后自动下一首 */
click(d.querySelector('#page-seg button[data-page="organize"]'));
await sleep(1000);
await ev('App.srcBrowse("/sdcard/ADM/Music/New/SB015")');
await sleep(1000);
const rows = Array.from(d.querySelectorAll('#view2 .item.file')).slice(0, 3).map(el => el.dataset.path);
check('整理页有可播放音频', rows.length >= 2, rows.length + '');
if (rows.length >= 2) {
  await ev(`PlayMgr.play(${JSON.stringify(rows[0])})`);
  await sleep(600);
  check('已播放第一首', ev('Player.current') === rows[0], ev('Player.current'));
  ev(`Player.audio.dispatchEvent(new Event('ended'))`);
  await sleep(900);
  check('播完自动播放下一首', ev('Player.current') === rows[1], ev('Player.current'));
  // 关闭开关后不再自动
  await ev(`App.autoplayNext()`);  // 先记录
  click(d.getElementById('btn-autoplay'));
  await sleep(150);
  const before = ev('Player.current');
  ev(`Player.audio.dispatchEvent(new Event('ended'))`);
  await sleep(700);
  check('关闭开关后不再自动播放', ev('Player.current') === before, ev('Player.current'));
}
for (const [s, n, x] of results) console.log(s + ' ' + n + (x ? '  [' + x + ']' : ''));
console.log('RESULT:', results.every(x => x[0] === 'OK  ') ? 'PASS' : 'FAIL');

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
    const rect = el => ({left: 0, top: 0, right: 320, bottom: 170, width: 320, height: 170});
    window.Element.prototype.getBoundingClientRect = function() { return rect(this); };
  },
});
await new Promise(r => dom.window.document.readyState === 'complete' ? r() : dom.window.addEventListener('load', r));
const w = dom.window, d = w.document, sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = c => w.eval(c);
const click = el => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await sleep(1600);

/* 打开频谱 + 播放 + 曲目信息 */
click(d.getElementById('sf-fab'));
await sleep(300);
check('频谱打开', !d.getElementById('spectrum-float').classList.contains('hidden'));
await ev(`App.srcBrowse('/sdcard/ADM/Music/New/SB015')`);
await sleep(1000);
const row = d.querySelector('#view2 .item.file');
check('有可播放音频行', !!row, row ? row.dataset.path : '');
if (row) {
  await ev(`PlayMgr.play(${JSON.stringify(row.dataset.path)})`);
  await sleep(1500);
  const track = d.getElementById('sf-track').textContent || '';
  check('频谱标题显示当前曲目', track.indexOf('据') < 0 && track.length > 3 && track !== '未在播放', track);
}

/* 拖动标题栏：吸附左右边 */
const head = d.getElementById('sf-head');
head.dispatchEvent(new w.MouseEvent('pointerdown', {bubbles:true, clientX: 200, clientY: 100}));
head.dispatchEvent(new w.MouseEvent('pointermove', {bubbles:true, clientX: 60, clientY: 300}));
head.dispatchEvent(new w.MouseEvent('pointerup', {bubbles:true}));
await sleep(150);
check('拖动后吸附左侧', d.getElementById('spectrum-float').style.left === '10px',
      'left=' + d.getElementById('spectrum-float').style.left);
check('停靠边已保存', ev('Store.get(K.spectrumPos)') && ev('Store.get(K.spectrumPos).side') === 'left',
      JSON.stringify(ev('Store.get(K.spectrumPos)')));

/* 缩放 */
const rz = d.getElementById('sf-resize');
rz.dispatchEvent(new w.MouseEvent('pointerdown', {bubbles:true, clientX: 300, clientY: 300}));
rz.dispatchEvent(new w.MouseEvent('pointermove', {bubbles:true, clientX: 460, clientY: 420}));
rz.dispatchEvent(new w.MouseEvent('pointerup', {bubbles:true}));
await sleep(150);
const size = ev('Store.get(K.spectrumSize)');
check('缩放后尺寸已保存', !!size && size.w > 0 && size.h > 0, JSON.stringify(size));

/* 最小化回贴边按钮 */
click(d.getElementById('sf-min'));
await sleep(200);
check('最小化后浮窗隐藏', d.getElementById('spectrum-float').classList.contains('hidden'));
check('贴边按钮恢复显示', d.getElementById('sf-fab').style.display !== 'none');

for (const [s, n, x] of results) console.log(s + ' ' + n + (x ? '  [' + x + ']' : ''));
console.log('RESULT:', results.every(x => x[0] === 'OK  ') ? 'PASS' : 'FAIL');

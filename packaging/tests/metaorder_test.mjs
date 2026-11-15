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
    window.HTMLCanvasElement.prototype.getContext = function(){ return { createLinearGradient:()=>({addColorStop(){}}), beginPath(){}, moveTo(){}, lineTo(){}, quadraticCurveTo(){}, closePath(){}, fill(){}, fillRect(){}, clearRect(){}, fillText(){}, stroke(){}, drawImage(){}, set fillStyle(v){}, set strokeStyle(v){}, set font(v){}, set textAlign(v){}, set textBaseline(v){}, set lineWidth(v){} }; };
    window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AAAA';
    window.alert = () => {}; window.confirm = () => true; window.prompt = () => '';
    window.requestAnimationFrame = cb => setTimeout(() => cb(0), 16);
    window.cancelAnimationFrame = id => clearTimeout(id);
    window.URL.createObjectURL = () => 'blob:fake';
    Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', { configurable: true, get() { return !this._playing; } });
    Object.defineProperty(window.HTMLMediaElement.prototype, 'play', { configurable: true, value() { this._playing = true; this.dispatchEvent(new window.Event('play')); return Promise.resolve(); } });
    Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', { configurable: true, value() { this._playing = false; this.dispatchEvent(new window.Event('pause')); } });
    Object.defineProperty(window.HTMLMediaElement.prototype, 'load', { configurable: true, value() {} });
  },
});
await new Promise(r => dom.window.document.readyState === 'complete' ? r() : dom.window.addEventListener('load', r));
const w = dom.window, d = w.document, sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = c => w.eval(c);
await sleep(2400);
const DIR = 'local:/sdcard/ADM/Music/Brand X';
const FILE = DIR + '/BXMT40_10_Endless Adventure.flac';
await ev(`App.browse(${JSON.stringify(DIR)})`);
await sleep(1200);
await ev(`PlayMgr.play(${JSON.stringify(FILE)})`);
await sleep(1800);
const h3s = Array.from(d.querySelectorAll('#meta1 h3')).map(x => (x.textContent || '').trim());
check('封面排第一', h3s[0] === '封面', h3s.join('|'));
check('元数据在文件之前', h3s.indexOf('元数据（可编辑）') >= 0 && h3s.indexOf('元数据（可编辑）') < h3s.indexOf('文件'), h3s.join('|'));
check('音频流在文件之后', h3s.indexOf('音频流') > h3s.indexOf('文件'), h3s.join('|'));
check('封面图已加载', !!d.querySelector('#meta1 .cover-box img'));
for (const [s, n, x] of results) console.log(s + ' ' + n + (x ? '  [' + x + ']' : ''));
console.log('RESULT:', results.every(x => x[0] === 'OK  ') ? 'PASS' : 'FAIL');

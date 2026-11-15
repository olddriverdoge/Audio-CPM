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
  },
});
await new Promise(r => dom.window.document.readyState === 'complete' ? r() : dom.window.addEventListener('load', r));
const w = dom.window, d = w.document, sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = c => w.eval(c);
const click = el => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await sleep(2400);

check('FAB 文案含频谱/声谱', (d.getElementById('sf-fab').textContent || '').indexOf('频谱/声谱') >= 0,
      d.getElementById('sf-fab').textContent);
click(d.getElementById('sf-fab'));
await sleep(300);
check('默认频谱 tab 激活', d.getElementById('sf-tab-spectrum').classList.contains('active'));
check('默认模式 spectrum', ev('Spectrum.mode') === 'spectrum', ev('Spectrum.mode'));

click(d.getElementById('sf-tab-waterfall'));
await sleep(400);
check('切到声谱模式', ev('Spectrum.mode') === 'waterfall', ev('Spectrum.mode'));
check('声谱 tab 激活', d.getElementById('sf-tab-waterfall').classList.contains('active'));
check('声谱模式已保存', ev('Store.get(K.spectrumMode)') === 'waterfall', ev('Store.get(K.spectrumMode)'));

click(d.getElementById('sf-min'));
await sleep(200);
click(d.getElementById('sf-fab'));
await sleep(400);
check('重开后保持声谱', ev('Spectrum.mode') === 'waterfall', ev('Spectrum.mode'));

click(d.getElementById('sf-tab-spectrum'));
await sleep(300);
check('切回频谱', ev('Spectrum.mode') === 'spectrum', ev('Spectrum.mode'));

for (const [s, n, x] of results) console.log(s + ' ' + n + (x ? '  [' + x + ']' : ''));
console.log('RESULT:', results.every(x => x[0] === 'OK  ') ? 'PASS' : 'FAIL');

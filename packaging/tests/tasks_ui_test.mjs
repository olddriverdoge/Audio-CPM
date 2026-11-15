import { JSDOM } from 'jsdom';
import fs from 'node:fs';
const TMPDIR = '/sdcard/ADM/__tasktest__/a';
fs.rmSync('/sdcard/ADM/__tasktest__', {recursive:true, force:true});
fs.mkdirSync(TMPDIR, {recursive:true});
const SRC = '/sdcard/ADM/Music/Brand X/BXMT40_10_Endless Adventure.flac';
if (fs.existsSync(SRC)) { for (const n of ['t1','t2','t3']) fs.copyFileSync(SRC, TMPDIR + '/' + n + '.flac'); }

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
  },
});
await new Promise(r => dom.window.document.readyState === 'complete' ? r() : dom.window.addEventListener('load', r));
const w = dom.window, d = w.document, sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = c => w.eval(c);
const click = el => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await sleep(2600);
await ev(`App.browse('local:/sdcard/ADM/__tasktest__/a')`);
await sleep(1200);
check('取消按钮初始隐藏', d.getElementById('cancel-btn').classList.contains('hidden'));
click(d.getElementById('start-btn'));
await sleep(700);
check('启动后取消按钮出现', !d.getElementById('cancel-btn').classList.contains('hidden'));
check('启动后开始按钮禁用', d.getElementById('start-btn').disabled === true);
click(d.getElementById('cancel-btn'));
await sleep(1500);
const r = await (await fetch(BASE + '/api/tasks')).json();
const last = (r.tasks || []).slice().reverse().find(t => (t.description || '').indexOf('转换 FLAC-16-44') === 0);
check('后端任务已取消', !!last && last.status === 'cancelled', last ? last.status : 'none');
try { fs.rmSync('/sdcard/ADM/__tasktest__', {recursive:true, force:true}); } catch (_) {}
for (const [s, n, x] of results) console.log(s + ' ' + n + (x ? '  [' + x + ']' : ''));
console.log('RESULT:', results.every(x => x[0] === 'OK  ') ? 'PASS' : 'FAIL');

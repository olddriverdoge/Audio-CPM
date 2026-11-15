import { JSDOM } from 'jsdom';
const BASE = 'http://127.0.0.1:8000';
const results = [];
const check = (n, ok, x = '') => results.push([ok ? 'OK  ' : 'FAIL', n, x]);

const dom = await JSDOM.fromURL(BASE + '/', {
  resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(window) {
    window.matchMedia = window.matchMedia || (q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
    window.IntersectionObserver = class { constructor(cb){this.cb=cb;} observe(el){this.cb([{isIntersecting:true,target:el}],this);} unobserve(){} disconnect(){} };
    window.EventSource = class { constructor(){this.readyState=0;} close(){} addEventListener(){} };
    window.fetch = async (u, o) => fetch(String(u).startsWith('http') ? String(u) : BASE + String(u), o);
    window.HTMLCanvasElement.prototype.getContext = function(){ return { createLinearGradient:()=>({addColorStop(){}}), beginPath(){}, moveTo(){}, lineTo(){}, quadraticCurveTo(){}, closePath(){}, fill(){}, fillStyle:'' }; };
    window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AAAA';
    window.alert = () => {}; window.confirm = () => true; window.prompt = () => '';
    window.URL.createObjectURL = () => 'blob:fake';
  },
});
await new Promise(r => dom.window.document.readyState === 'complete' ? r() : dom.window.addEventListener('load', r));
const w = dom.window, d = w.document, sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(1500);

const click = el => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
click(d.getElementById('btn-player-cfg'));
await sleep(600);
const sel = d.getElementById('uicfg-presets');
check('设置面板可打开', !d.getElementById('sheet-overlay').classList.contains('hidden'));
check('预设下拉已渲染', !!sel && sel.querySelectorAll('option').length >= 1, sel ? sel.innerHTML : '');
check('显示配置文件路径', (d.getElementById('uicfg-file').textContent || '').includes('ac2_ui_config.json'),
      d.getElementById('uicfg-file').textContent);

// 保存预设
d.getElementById('uicfg-name').value = 'smoke预设';
click(d.getElementById('uicfg-save'));
await sleep(900);
let r = await (await fetch(BASE + '/api/ui_config')).json();
check('保存预设成功', !!r.presets['smoke预设'], JSON.stringify(Object.keys(r.presets || {})));
check('下拉包含新预设', Array.from(d.getElementById('uicfg-presets').options).some(o => o.value === 'smoke预设'));
check('active 指向新预设', r.active === 'smoke预设', r.active);

// 删除预设
click(d.getElementById('uicfg-del'));
await sleep(900);
r = await (await fetch(BASE + '/api/ui_config')).json();
check('删除预设成功', !r.presets['smoke预设']);

// 配置已持久化
check('配置文件写入落盘', !!r.file && r.file.endsWith('ac2_ui_config.json'), r.file);
check('当前配置非空', Object.keys(r.config || {}).length > 0, String(Object.keys(r.config || {}).length));

for (const [s, n, x] of results) console.log(s + ' ' + n + (x ? '  [' + x + ']' : ''));
console.log('RESULT:', results.every(x => x[0] === 'OK  ') ? 'PASS' : 'FAIL');
console.log('JS errors:', w.__errs || 'none');

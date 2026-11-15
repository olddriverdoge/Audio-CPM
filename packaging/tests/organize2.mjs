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
    window.HTMLCanvasElement.prototype.getContext = function(){ return { createLinearGradient:()=>({addColorStop(){}}), beginPath(){}, moveTo(){}, lineTo(){}, quadraticCurveTo(){}, closePath(){}, fill(){}, fillRect(){}, clearRect(){}, fillStyle:'', globalAlpha:1 }; };
    window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AAAA';
    window.alert = () => {}; window.confirm = () => true; window.prompt = () => '';
    window.URL.createObjectURL = () => 'blob:fake';
    window.requestAnimationFrame = cb => setTimeout(() => cb(0), 16);
    window.cancelAnimationFrame = id => clearTimeout(id);
  },
});
await new Promise(r => dom.window.document.readyState === 'complete' ? r() : dom.window.addEventListener('load', r));
const w = dom.window, d = w.document, sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = c => w.eval(c);
const click = el => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await sleep(1600);

/* 切到整理页 */
click(d.querySelector('#page-seg button[data-page="organize"]'));
await sleep(2000);
for (let i = 0; i < 10 && !d.querySelector('#view2 .item.head .col-edit'); i++) await sleep(300);
const src0 = ev('App.srcPath');
check('整理页已加载', !!src0, src0);
check('整理页路径已记忆', ev('Store.get(K.s2LastPath)') === src0, ev('Store.get(K.s2LastPath)'));

/* 进入子目录 → 回顶 */
const dirEl = d.querySelector('#view2 .item.dir[data-dir-path]');
if (dirEl) {
  const target = dirEl.dataset.dirPath;
  d.getElementById('view2').scrollTop = 320;
  click(dirEl);
  await sleep(1000);
  check('进入子目录后回到顶部', d.getElementById('view2').scrollTop === 0, String(d.getElementById('view2').scrollTop));
  check('路径已记住', ev('Store.get(K.s2LastPath)') === ev('App.srcPath'), ev('Store.get(K.s2LastPath)'));
  d.getElementById('view2').scrollTop = 280;
  const parentCrumb = Array.from(d.querySelectorAll('#pb2-crumbs .crumb')).pop();
  // 点上一级面包屑
  const parent = target.replace(/\/[^\/]+$/, '') || '/';
  const targetCrumb = d.querySelector('#pb2-crumbs .crumb[data-crumb="' + parent.replace(/"/g, '\\"') + '"]');
  if (targetCrumb) {
    click(targetCrumb);
    await sleep(1000);
    check('返回上级后回到顶部', d.getElementById('view2').scrollTop === 0, String(d.getElementById('view2').scrollTop));
  }
}

/* 自定义表头列：勾选项 / 可复用 */
click(d.querySelector('.col-edit'));
await sleep(300);
d.getElementById('col-key').value = 'genre';
d.getElementById('col-label').value = '流派';
click(d.getElementById('col-add'));
await sleep(300);
const customCb = () => d.querySelector('#cols-presets input[data-cid="c:genre"]');
check('自定义列出现在勾选列表', !!customCb());
check('自定义列默认勾选', !!customCb() && customCb().checked);
console.log('DBG v2', (d.getElementById('view2').innerHTML||'').slice(0,160), '| src', ev('App.srcPath'), '| mode', ev("Store.get(K.s2ViewMode,'list')"));
console.log('DBG active', ev('Columns.active().map(c=>c.id)'), '| head', !!d.querySelector('#view2 .item.head'), '| cells', Array.from(d.querySelectorAll('#view2 .item.head .hcell')).map(x=>x.dataset.colkey));
check('表头出现自定义列', !!d.querySelector('#view2 .item.head .hcell[data-colkey="c:genre"]'));
customCb().checked = false;
customCb().dispatchEvent(new w.Event('change', { bubbles: true }));
await sleep(300);
check('取消勾选后表头隐藏', !d.querySelector('#view2 .item.head .hcell[data-colkey="c:genre"]'));
const cb2 = () => d.querySelector('#cols-presets input[data-cid="c:genre"]');
cb2().checked = true;
cb2().dispatchEvent(new w.Event('change', { bubbles: true }));
await sleep(300);
check('重新勾选可复用', !!d.querySelector('#view2 .item.head .hcell[data-colkey="c:genre"]'));
click(d.querySelector('#cols-custom .col-del'));
await sleep(300);
check('删除后勾选项消失', !d.querySelector('#cols-presets input[data-cid="c:genre"]'));
check('删除后表头消失', !d.querySelector('#view2 .item.head .hcell[data-colkey="c:genre"]'));

/* 实时频谱：全局悬浮，默认贴边按钮 / 按需展开 */
check('频谱默认只显示贴边按钮', d.getElementById('spectrum-float').classList.contains('hidden'));
click(d.getElementById('sf-fab'));
await sleep(300);
check('点按钮展开频谱浮窗', !d.getElementById('spectrum-float').classList.contains('hidden'));
check('展开时不占元数据位置', !!d.getElementById('meta2'));
click(d.getElementById('sf-min'));
await sleep(200);
check('最小化回贴边按钮', d.getElementById('spectrum-float').classList.contains('hidden'));

for (const [s, n, x] of results) console.log(s + ' ' + n + (x ? '  [' + x + ']' : ''));
console.log('RESULT:', results.every(x => x[0] === 'OK  ') ? 'PASS' : 'FAIL');
console.log('JS errors:', w.__errs || 'none');

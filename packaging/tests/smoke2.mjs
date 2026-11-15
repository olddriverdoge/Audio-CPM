import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:8000';
// 界面配置会持久化到后端 JSON（ac2_ui_config.json），每次回归先清空，避免继承上一次运行的状态
await fetch(BASE + '/api/ui_config', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({config:{}})}).catch(() => {});

const errors = [];
const dom = await JSDOM.fromURL(BASE + '/', {
  resources: 'usable',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(window) {
    window.matchMedia = window.matchMedia || (q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
    window.IntersectionObserver = class {
      constructor(cb) { this.cb = cb; }
      observe(el) { this.cb([{ isIntersecting: true, target: el }], this); }
      unobserve() {} disconnect() {}
    };
    window.EventSource = class { constructor() { this.readyState = 0; } close() {} addEventListener() {} };
    window.fetch = async (url, opts) => {
      const u = String(url).startsWith('http') ? String(url) : BASE + String(url);
      return await fetch(u, opts);
    };
    window.HTMLCanvasElement.prototype.getContext = function () {
      const grad = { addColorStop() {} };
      return { createLinearGradient: () => grad, fillStyle: '', beginPath() {}, moveTo() {}, lineTo() {},
               quadraticCurveTo() {}, closePath() {}, fill() {} };
    };
    window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AAAA';
    Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
      configurable: true, get() { return !this._playing; },
    });
    Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
      configurable: true, value() { this._playing = true; this.dispatchEvent(new window.Event('play')); return Promise.resolve(); },
    });
    Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
      configurable: true, value() { this._playing = false; this.dispatchEvent(new window.Event('pause')); },
    });
    Object.defineProperty(window.HTMLMediaElement.prototype, 'load', { configurable: true, value() {} });
    Object.defineProperty(window.HTMLMediaElement.prototype, 'duration', { configurable: true, get() { return 200; } });
    Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', {
      configurable: true, get() { return this._t || 0; },
      set(v) { this._t = v; this.dispatchEvent(new window.Event('timeupdate')); },
    });
    window.alert = () => {}; window.confirm = () => true; window.prompt = () => '';
    window.addEventListener('error', e => errors.push('window.error: ' + (e.message || e.error)));
  },
});

await new Promise(r => {
  if (dom.window.document.readyState === 'complete') r();
  else dom.window.addEventListener('load', r);
});
const { window } = dom;
const doc = window.document;
window.console.error = (...a) => errors.push('console.error: ' + a.join(' '));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = code => window.eval(code);
const q = sel => doc.querySelector(sel);
const qa = sel => Array.from(doc.querySelectorAll(sel));
const bar = () => doc.getElementById('player-bar');
const results = [];
const check = (name, ok, extra = '') => { results.push([ok ? 'OK  ' : 'FAIL', name, extra]); };

for (let i = 0; i < 80 && !qa('#view1 .item, #view1 .tile').length; i++) await sleep(150);
check('初始化后 view1 有行', qa('#view1 .item, #view1 .tile').length > 0, qa('#view1 .item, #view1 .tile').length + ' rows');

await ev(`App.browse('/sdcard/ADM/Music/New/SB015')`);
for (let i = 0; i < 40 && !qa('#view1 .item.file').length; i++) await sleep(150);
await sleep(300);
const filePath = ev(`(function(){
  const AUD = /\.(flac|mp3|m4a|wav|ogg|opus|ape|wv|dsf|dff|aac|aif|aiff)$/i;
  const nodes = Array.from(document.querySelectorAll('#view1 [data-path]'));
  const hit = nodes.find(n => AUD.test(n.dataset.path));
  return hit ? hit.dataset.path : '';
})()`);
check('拿到可播放文件', !!filePath, filePath);
const FILE_PATH = filePath;

ev(`document.querySelector('#view-seg button[data-view="grid"]').click()`);
await sleep(200);
ev(`PlayMgr.play(${JSON.stringify(filePath)})`);
await sleep(900);
check('网格视图播放条显示', !bar().classList.contains('hidden'));
check('body.has-player 生效', doc.body.classList.contains('has-player'));
check('波形底图已挂载', !!doc.getElementById('pb-wave-base').getAttribute('src'));
check('波形高亮层已挂载', !!doc.getElementById('pb-wave-hi').getAttribute('src'));
check('网格下无行内波形', qa('.row-wave').length === 0);

ev(`Player.audio.currentTime = 100`);
await sleep(150);
const clip = doc.getElementById('pb-wave-hi').style.clipPath || '';
check('播放条进度裁剪 ~50%', /50(\.\d+)?%/.test(clip), clip);

ev(`document.querySelector('#view-seg button[data-view="list"]').click()`);
await sleep(450);
check('列表视图播放条隐藏', bar().classList.contains('hidden'));
check('去掉 has-player 高度补偿', !doc.body.classList.contains('has-player'));
check('正在播放的行有 playing 标记', qa('#view1 .item.file.playing').length === 1, qa('#view1 .item.file.playing').length + ' rows');
const rw = qa('#view1 .item.file.playing .row-wave img');
check('行内波形双层图', rw.length === 2, rw.length + ' imgs');
const rowClip = q('.item.file.playing .rw-hi') ? q('.item.file.playing .rw-hi').style.clipPath : '';
check('行内进度裁剪与播放同步', /50(\.\d+)?%/.test(rowClip), rowClip);

const wave = q('.item.file.playing .row-wave');
if (wave) {
  wave.getBoundingClientRect = () => ({ left: 0, width: 200 });
  wave.dispatchEvent(new window.MouseEvent('click', { bubbles: true, clientX: 50 }));
  await sleep(120);
  check('点行内波形可跳转到 ~25%', Math.abs((ev('Player.audio.currentTime') || 0) - 50) < 1.5,
    'currentTime=' + ev('Player.audio.currentTime'));
}

for (let i = 0; i < 2; i++) {
  ev(`document.querySelector('#view-seg button[data-view="grid"]').click()`); await sleep(250);
  ev(`document.querySelector('#view-seg button[data-view="list"]').click()`); await sleep(250);
}
check('反复切换后仅一条 playing 行', qa('.item.file.playing').length === 1, qa('.item.file.playing').length);
check('反复切换后无重复 row-wave', qa('#view1 .row-wave').length === 1, qa('#view1 .row-wave').length);

ev(`Player.close()`);
await sleep(150);
check('关闭后播放条隐藏', bar().classList.contains('hidden'));
check('关闭后行内波形清除', qa('.row-wave').length === 0);
check('关闭后标题复位', doc.getElementById('pb-title').textContent === '未在播放');

ev(`PlayMgr.play(${JSON.stringify(filePath)})`); await sleep(600);
await ev("App.srcBrowse('/sdcard/ADM/Music/New/SB015')");
await sleep(600);

ev(`document.querySelector('#page-seg button[data-page="organize"]').click()`); await sleep(350);
const s2label = () => doc.getElementById('s2-view-btn').textContent;
check('整理页视图按钮初始为列表', s2label() === '列表', s2label());
check('列表态隐藏播放条', bar().classList.contains('hidden'));
ev(`document.getElementById('s2-view-btn').click()`); await sleep(450);
check('切到网格', s2label() === '网格', s2label());
check('整理页网格视图显示播放条', !bar().classList.contains('hidden'));
ev(`document.getElementById('s2-view-btn').click()`); await sleep(450);
check('切回列表', s2label() === '列表', s2label());
check('列表态隐藏播放条(2)', bar().classList.contains('hidden'));
check('整理页列表视图有行内波形', qa('#view2 .row-wave').length >= 1, qa('#view2 .row-wave').length);

/* ---- 5) 元数据默认贴边收起 ---- */
for (let i = 0; i < 40 && !doc.getElementById('m2-left').classList.contains('collapsed'); i++) await sleep(100);
check('元数据默认收起', doc.getElementById('m2-left').classList.contains('collapsed'));
check('收起时不显示分隔条', doc.getElementById('m2-row').classList.contains('meta-collapsed'));
ev(`document.getElementById('meta2-head').click()`); await sleep(150);
check('点标签展开元数据', !doc.getElementById('m2-left').classList.contains('collapsed'));
ev(`document.getElementById('meta2-head').click()`); await sleep(150);
check('再点收起', doc.getElementById('m2-left').classList.contains('collapsed'));

/* ---- 6) 移动条收起：贴右边且脱离文档流 ---- */
ev(`document.querySelector('#page-seg button[data-page="process"]').click()`); await sleep(250);
const mv = doc.getElementById('movebar');
check('移动条默认展开', !mv.classList.contains('collapsed'));
ev(`document.getElementById('mv-toggle').click()`); await sleep(150);
check('点收起后进入 collapsed', mv.classList.contains('collapsed'));
check('收起后隐藏目标/按钮行', !!(mv.querySelector('.mv-body')));
ev(`document.getElementById('mv-toggle').click()`); await sleep(150);
check('可再展开', !mv.classList.contains('collapsed'));

/* ---- 7) 复选框默认隐藏 + 长按文件进入选择模式 ---- */
check('默认无 sel-mode', !doc.getElementById('view1').classList.contains('sel-mode'));
const firstRow = doc.querySelector('#view1 .item.file');
if (firstRow) {
  firstRow.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
  await sleep(750);
  check('长按弹出上下文菜单', !doc.getElementById('menu-overlay').classList.contains('hidden'));
  check('菜单含删除项', !!doc.querySelector('#ctx-menu [data-cmd="row-delete"]'));
  ev(`document.querySelector('#ctx-menu [data-cmd="row-select"]').click()`); await sleep(250);
  check('点「多选」进入 sel-mode', doc.getElementById('view1').classList.contains('sel-mode'));
  check('多选即勾选该文件', doc.querySelectorAll('#view1 .item.file.sel').length >= 1,
    doc.querySelectorAll('#view1 .item.file.sel').length);
  ev(`document.getElementById('btn-selclear').click()`); await sleep(200);
  check('清空后退出 sel-mode', !doc.getElementById('view1').classList.contains('sel-mode'));
check('清空后选择工具条隐藏', doc.getElementById('sel-tools').classList.contains('hidden'));
}

/* ---- 8) 波形样式：无 blur、暖色 ---- */
const css = await (await fetch(BASE + '/css/process.css')).text();
const overlaysCss = await (await fetch(BASE + '/css/overlays.css')).text();
const waveJs = await (await fetch(BASE + '/js/wave.js')).text();
check('波形无 blur 滤镜', !/\.pb-wave img\{[^}]*blur/.test(overlaysCss) && !/\.row-wave img\{[^}]*blur/.test(css));
check('波形为暖色渐变', /#fed7aa/.test(waveJs) && /#fb923c/.test(waveJs) && /#ea580c/.test(waveJs));
check('播放行波形半透明(不挡文件名)', /\.row-wave \.rw-hi\{opacity:\.58/.test(css) && !/playing \.name\{visibility:hidden/.test(css));

console.log(results.map(([s, n, x]) => `${s} ${n}${x ? '  [' + x + ']' : ''}`).join('\n'));
console.log('--- JS 报错 ---');
console.log(errors.length ? errors.slice(0, 8).join('\n') : 'none');
console.log(results.some(r => r[0] === 'FAIL') ? 'RESULT: FAIL' : 'RESULT: PASS');
dom.window.close();
process.exit(results.some(r => r[0] === 'FAIL') ? 1 : 0);

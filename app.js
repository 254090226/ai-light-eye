(function(){
'use strict';

/* ================= 元素引用 ================= */
const $ = (s, root) => (root || document).querySelector(s);
const el = {
  statusPill: $('#statusPill'),
  statusText: $('#statusText'),
  video: $('#video'),
  videoWrap: $('#videoWrap'),
  camInfo: $('#camInfo'),
  camTitle: $('#camTitle'),
  camHint: $('#camHint'),
  startBtn: $('#startBtn'),
  stopBtn: $('#stopBtn'),
  demoBtn: $('#demoBtn'),
  luxNum: $('#luxNum'),
  luxBadge: $('#luxBadge'),
  advice: $('#advice'),
  adviceText: $('#adviceText'),
  scaleTrack: $('#scaleTrack'),
  scaleMarker: $('#scaleMarker'),
  scaleLabels: $('#scaleLabels'),
  recBri: $('#recBri'),
  recTemp: $('#recTemp'),
  autoToggle: $('#autoToggle'),
  filterToggle: $('#filterToggle'),
  briSlider: $('#briSlider'),
  tempSlider: $('#tempSlider'),
  briSliderVal: $('#briSliderVal'),
  tempSliderVal: $('#tempSliderVal'),
  chart: $('#chart'),
  chartWrap: $('#chartWrap'),
  chartTip: $('#chartTip'),
  windowSeg: $('#windowSeg'),
  avgLux: $('#avgLux'),
  comfortPct: $('#comfortPct'),
  duration: $('#duration'),
  sampleCount: $('#sampleCount'),
  timerTime: $('#timerTime'),
  timerPhase: $('#timerPhase'),
  ringProg: $('#ringProg'),
  timerToggle: $('#timerToggle'),
  timerReset: $('#timerReset'),
  timerSkip: $('#timerSkip'),
  cycleDots: $('#cycleDots'),
  pomoCount: $('#pomoCount'),
  presetSeg: $('#presetSeg'),
  calibInput: $('#calibInput'),
  calibBtn: $('#calibBtn'),
  calibReset: $('#calibReset'),
  kValue: $('#kValue'),
  meanY: $('#meanY'),
  clipRatio: $('#clipRatio'),
  intervalSel: $('#intervalSel'),
  cropToggle: $('#cropToggle'),
  soundToggle: $('#soundToggle'),
  notifyToggle: $('#notifyToggle'),
  dimLayer: $('#dimLayer'),
  warmLayer: $('#warmLayer'),
  toast: $('#toast')
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ================= 状态 ================= */
const state = {
  running: false,
  demo: false,
  stream: null,
  loop: null,
  K: 2400,
  samples: [],          // { t, v }
  rawHist: [],
  smooth: null,
  lastMean: null,
  lastClip: 0,
  auto: true,
  filter: true,
  sound: true,
  notify: false,
  interval: 800,
  crop: true,
  bri: 65,
  tempK: 4800,
  recBri: null,
  recTemp: null,
  manualBri: 65,
  manualTemp: 4800,
  windowSec: 180
};

/* ================= 照度区间 ================= */
const BANDS = {
  dark:  { cls: 'bad',   label: '过暗' },
  dim:   { cls: 'warn',  label: '偏暗' },
  ok:    { cls: 'ok',    label: '舒适' },
  light: { cls: 'light', label: '明亮' },
  hot:   { cls: 'hot',   label: '过强' }
};

function bandOf(lux){
  if (lux < 80)  return BANDS.dark;
  if (lux < 300) return BANDS.dim;
  if (lux <= 500) return BANDS.ok;
  if (lux <= 1000) return BANDS.light;
  return BANDS.hot;
}

function adviceOf(lux){
  const n = Math.round(lux);
  if (lux < 80){
    return '环境光<b>严重不足</b>（' + n + ' lux），屏幕与环境反差过大会让睫状肌持续紧张。'
      + '建议立即打开主灯或台灯，把工作面照度提升到 <b>300–500 lux</b>；改善前请降低屏幕亮度并使用暖色温。';
  }
  if (lux < 300){
    const need = Math.max(0, Math.round(400 - lux));
    return '当前 <b>' + n + ' lux</b>，低于读写标准。建议开启台灯（放在握笔手的对侧，避免直射屏幕），'
      + '大约还需补充 <b>' + need + ' lux</b>，让桌面达到 300–500 lux。';
  }
  if (lux <= 500){
    return '当前 <b>' + n + ' lux</b>，正处于 <b>300–500 lux</b> 的读写舒适区间，可以放心学习。'
      + '保持光源稳定，避免身体或书本在桌面留下明显阴影。';
  }
  if (lux <= 1000){
    return '当前 <b>' + n + ' lux</b>，光线充足。注意避免窗户或灯管在屏幕上形成反光眩光，'
      + '屏幕亮度可适当调高以匹配环境，减少明暗反差。';
  }
  return '当前 <b>' + n + ' lux</b>，可能有过强直射光。检查阳光是否直射桌面、台灯是否过近，'
    + '必要时拉上窗帘或调低台灯，避免强光直射眼睛与屏幕。';
}

/* ================= 亮度 / 色温映射 ================= */
const CTRL_ANCHORS = [
  [10, 24, 2700],
  [40, 32, 2900],
  [100, 42, 3300],
  [300, 55, 4300],
  [500, 66, 4800],
  [800, 74, 5300],
  [1500, 82, 5800],
  [4000, 90, 6300],
  [12000, 96, 6500]
].map(function(a){ return [Math.log10(a[0]), a[1], a[2]]; });

function controlFromLux(lux){
  const x = Math.log10(Math.max(lux, 1));
  const A = CTRL_ANCHORS;
  if (x <= A[0][0]) return { b: A[0][1], k: A[0][2] };
  for (let i = 1; i < A.length; i++){
    if (x <= A[i][0]){
      const t = (x - A[i-1][0]) / (A[i][0] - A[i-1][0]);
      return {
        b: A[i-1][1] + (A[i][1] - A[i-1][1]) * t,
        k: Math.round((A[i-1][2] + (A[i][2] - A[i-1][2]) * t) / 50) * 50
      };
    }
  }
  const last = A[A.length - 1];
  return { b: last[1], k: last[2] };
}

function overlayAlpha(){
  if (!state.samples.length) return { dim: 0, warm: 0 };
  const bri = state.auto ? state.bri : state.manualBri;
  const temp = state.auto ? state.tempK : state.manualTemp;
  return {
    dim: state.filter ? 0.45 * Math.pow(1 - bri / 100, 0.85) : 0,
    warm: state.filter ? clamp((6500 - temp) / 3800, 0, 1) * 0.22 : 0
  };
}

function applyScreenEffect(){
  const a = overlayAlpha();
  el.dimLayer.style.backgroundColor = 'rgba(0,0,0,' + a.dim.toFixed(3) + ')';
  el.warmLayer.style.backgroundColor = 'rgba(255,168,88,' + a.warm.toFixed(3) + ')';

  const bri = state.auto ? state.bri : state.manualBri;
  const temp = state.auto ? state.tempK : state.manualTemp;

  if (state.samples.length && state.recBri != null){
    el.recBri.textContent = Math.round(state.recBri);
    el.recTemp.textContent = Math.round(state.recTemp);
  } else {
    el.recBri.textContent = '--';
    el.recTemp.textContent = '----';
  }

  el.briSlider.value = Math.round(bri);
  el.tempSlider.value = Math.round(temp / 50) * 50;
  el.briSliderVal.textContent = Math.round(bri) + '%';
  el.tempSliderVal.textContent = Math.round(temp) + 'K';
  el.briSlider.disabled = state.auto;
  el.tempSlider.disabled = state.auto;
}

/* ================= 刻度尺 ================= */
function logPos(lux){
  const A = Math.log10(20), B = Math.log10(2000);
  return clamp((Math.log10(clamp(lux, 20, 2000)) - A) / (B - A), 0, 1);
}

function buildScale(){
  const bounds = [20, 80, 300, 500, 1000, 2000];
  const colors = [
    'rgba(255,98,115,.5)',
    'rgba(255,143,94,.45)',
    'rgba(91,214,138,.55)',
    'rgba(61,219,201,.4)',
    'rgba(255,203,92,.45)'
  ];
  const A = Math.log10(20), B = Math.log10(2000);
  el.scaleTrack.innerHTML = '';
  for (let i = 0; i < 5; i++){
    const seg = document.createElement('div');
    seg.className = 'scale-seg';
    const w = (Math.log10(bounds[i+1] / bounds[i])) / (B - A) * 100;
    seg.style.flex = '0 0 ' + w.toFixed(2) + '%';
    seg.style.background = colors[i];
    el.scaleTrack.appendChild(seg);
  }
  el.scaleLabels.innerHTML = '';
  [['20', 0, 'edge-l'], ['300', logPos(300) * 100, ''], ['500', logPos(500) * 100, ''],
   ['1000', logPos(1000) * 100, ''], ['2000+', 100, 'edge-r']].forEach(function(item){
    const s = document.createElement('span');
    s.textContent = item[0];
    if (item[2]) s.className = item[2];
    s.style.left = item[1] + '%';
    el.scaleLabels.appendChild(s);
  });
}

/* ================= 摄像头采样 ================= */
const sampleCanvas = document.createElement('canvas');
sampleCanvas.width = 96;
sampleCanvas.height = 72;
const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

function setStatus(kind, text){
  el.statusPill.className = 'status-pill' + (kind ? ' ' + kind : '');
  el.statusText.textContent = text;
}

function resetSession(){
  state.samples = [];
  state.rawHist = [];
  state.smooth = null;
  state.lastMean = null;
  state.lastClip = 0;
  state.recBri = null;
  state.recTemp = null;
  el.meanY.textContent = '--';
  el.clipRatio.textContent = '--';
  updateStats();
}

function sampleFrame(){
  const v = el.video;
  const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw || !vh || v.readyState < 2) return null;

  let sx = 0, sy = 0, sw = vw, sh = vh;
  if (state.crop){
    sx = vw * 0.2; sy = vh * 0.2; sw = vw * 0.6; sh = vh * 0.6;
  }
  const W = 96, H = 72;
  sampleCtx.drawImage(v, sx, sy, sw, sh, 0, 0, W, H);

  let data;
  try {
    data = sampleCtx.getImageData(0, 0, W, H).data;
  } catch (e){
    return null;
  }
  let sum = 0, clipped = 0;
  const total = W * H;
  for (let i = 0; i < data.length; i += 4){
    const y = 0.2126 * data[i] + 0.7152 * data[i+1] + 0.0722 * data[i+2];
    sum += y;
    if (y > 250) clipped++;
  }
  const mean = sum / total;
  const lin = Math.pow(mean / 255, 2.2);
  return { mean: mean, clip: clipped / total, lux: state.K * lin };
}

function median(arr){
  const a = arr.slice().sort(function(x, y){ return x - y; });
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m-1] + a[m]) / 2;
}

function simulateLux(t){
  const s = t / 1000;
  let v = 380 + 130 * Math.sin(s / 7.5) + 60 * Math.sin(s / 23 + 1.4);
  if (Math.sin(s / 31) > 0.93) v -= 240;          // 偶尔模拟“关灯/遮挡”
  v += (Math.random() - 0.5) * 30;
  return Math.max(22, v);
}

function tick(){
  if (!state.running) return;
  const now = Date.now();
  let raw = null, meta = null;

  if (state.demo){
    raw = simulateLux(now);
  } else {
    meta = sampleFrame();
    if (!meta) return;
    raw = meta.lux;
    state.lastMean = meta.mean;
    state.lastClip = meta.clip;
    el.meanY.textContent = meta.mean.toFixed(0);
    el.clipRatio.textContent = (meta.clip * 100).toFixed(1) + '%';
  }

  state.rawHist.push(raw);
  if (state.rawHist.length > 5) state.rawHist.shift();

  const med = median(state.rawHist);
  state.smooth = state.smooth == null ? med : state.smooth + (med - state.smooth) * 0.32;
  const lux = Math.max(0, state.smooth);

  state.samples.push({ t: now, v: lux });
  const cutoff = now - 10 * 60 * 1000;
  while (state.samples.length && state.samples[0].t < cutoff) state.samples.shift();

  updateReadout(lux);
}

function updateReadout(lux){
  const display = lux < 1000 ? Math.round(lux) : Math.round(lux / 10) * 10;

  el.luxNum.textContent = display;

  const band = bandOf(lux);
  el.luxBadge.textContent = band.label;
  el.luxBadge.className = 'badge ' + band.cls;
  el.advice.className = 'advice ' + band.cls;
  el.adviceText.innerHTML = adviceOf(lux);

  el.scaleMarker.style.left = (logPos(lux) * 100).toFixed(1) + '%';

  const c = controlFromLux(lux);
  state.recBri = c.b;
  state.recTemp = c.k;
  if (state.auto){
    state.bri = c.b;
    state.tempK = c.k;
  }
  applyScreenEffect();
}

function startLoop(){
  stopLoop();
  state.loop = setInterval(tick, state.interval);
  tick();
}
function stopLoop(){
  if (state.loop){ clearInterval(state.loop); state.loop = null; }
}

function stopAll(){
  stopLoop();
  if (state.stream){
    state.stream.getTracks().forEach(function(t){ t.stop(); });
    state.stream = null;
  }
  el.video.srcObject = null;
  state.running = false;
  state.demo = false;
  el.videoWrap.classList.remove('on', 'demo');
  el.videoWrap.classList.add('off');
  el.startBtn.disabled = false;
  el.stopBtn.disabled = true;
  el.demoBtn.disabled = false;
  el.camInfo.textContent = '未连接';
  el.camTitle.textContent = '摄像头未开启';
  el.camHint.textContent = '开启后仅在本地分析画面亮度，估算环境照度';
  setStatus('', '摄像头未开启');
}

async function startCamera(){
  if (state.running) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    toast('当前环境无法访问摄像头（需要 HTTPS 或 localhost），可先使用模拟数据体验。');
    return;
  }
  el.startBtn.disabled = true;
  setStatus('', '正在请求摄像头…');

  try {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: { ideal: 'environment' } },
        audio: false
      });
    } catch (err1){
      if (err1 && (err1.name === 'NotAllowedError' || err1.name === 'SecurityError' ||
                   err1.name === 'NotFoundError' || err1.name === 'NotReadableError')){
        throw err1;
      }
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    state.stream = stream;
    state.demo = false;
    el.video.srcObject = stream;
    try { await el.video.play(); } catch (e){ /* 自动播放失败时忽略 */ }

    const track = stream.getVideoTracks()[0];
    const s = track && track.getSettings ? track.getSettings() : {};
    el.camInfo.textContent = (s.width && s.height) ? (s.width + '×' + s.height) : '已连接';

    state.running = true;
    resetSession();
    el.videoWrap.classList.remove('off', 'demo');
    el.videoWrap.classList.add('on');
    el.startBtn.disabled = true;
    el.stopBtn.disabled = false;
    el.demoBtn.disabled = true;
    setStatus('live', '实时采样中');
    startLoop();
    toast('摄像头已开启，开始估算环境照度。');
  } catch (err){
    el.startBtn.disabled = false;
    setStatus('', '摄像头未开启');
    let msg = '无法访问摄像头';
    const name = err && err.name;
    if (name === 'NotAllowedError') msg = '摄像头权限被拒绝，请在地址栏允许后重试。';
    else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') msg = '没有找到可用的摄像头。';
    else if (name === 'NotReadableError') msg = '摄像头被其他程序占用，请关闭后重试。';
    else if (name === 'SecurityError') msg = '当前页面不允许使用摄像头，请通过 localhost 或 HTTPS 打开。';
    else if (name) msg = '无法访问摄像头（' + name + '）。';
    toast(msg + ' 可点击“用模拟数据”体验完整功能。');
  }
}

function startDemo(){
  stopAll();
  resetSession();
  state.demo = true;
  state.running = true;
  el.videoWrap.classList.remove('off', 'on');
  el.videoWrap.classList.add('demo');
  el.camTitle.textContent = '模拟数据模式';
  el.camHint.textContent = '正在用合成照度数据演示曲线与自适应调光';
  el.camInfo.textContent = '模拟数据';
  el.startBtn.disabled = true;
  el.stopBtn.disabled = false;
  el.demoBtn.disabled = true;
  setStatus('demo', '模拟数据运行中');
  startLoop();
  toast('已切换到模拟数据，可用于体验完整流程。');
}

/* ================= 提示音 / 通知 ================= */
let audioCtx = null;
function ensureAudio(){
  if (!audioCtx){
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    } catch (e){ audioCtx = null; }
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

function beep(times){
  if (!state.sound || !audioCtx) return;
  const t0 = audioCtx.currentTime;
  for (let i = 0; i < times; i++){
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = i % 2 ? 660 : 880;
    const start = t0 + i * 0.28;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.16, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.24);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + 0.26);
  }
}

function notify(title, body){
  if (!state.notify) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification(title, { body: body, silent: true }); } catch (e){ /* ignore */ }
}

let toastTimer = null;
function toast(msg){
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ el.toast.classList.remove('show'); }, 2800);
}

/* ================= 图表 ================= */
const canvas = el.chart;
const ctx = canvas.getContext('2d');
const chart = { w: 0, h: 0, dpr: 1, hoverX: null, lastDraw: 0 };

function resizeChart(){
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(10, rect.width), h = Math.max(10, rect.height);
  chart.w = w; chart.h = h; chart.dpr = dpr;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function pickMax(v){
  const candidates = [600, 800, 1000, 1200, 1500, 2000, 2500, 3000, 4000, 6000];
  for (let i = 0; i < candidates.length; i++){
    if (v <= candidates[i]) return candidates[i];
  }
  return Math.ceil(v / 1000) * 1000;
}

function fmtRel(ms){
  const total = Math.round(Math.abs(ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return '-' + m + ':' + String(s).padStart(2, '0');
}

function fmtClock(ts){
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' +
         String(d.getMinutes()).padStart(2, '0') + ':' +
         String(d.getSeconds()).padStart(2, '0');
}

function drawChart(ts){
  if (ts - chart.lastDraw < 40) return;
  chart.lastDraw = ts;

  const w = chart.w, h = chart.h;
  if (!w || !h) return;

  ctx.clearRect(0, 0, w, h);
  const padL = 42, padR = 16, padT = 14, padB = 26;
  const plotW = Math.max(10, w - padL - padR);
  const plotH = Math.max(10, h - padT - padB);

  const hasSamples = state.samples.length > 0;
  const endT = hasSamples
    ? (state.running ? Date.now() : state.samples[state.samples.length - 1].t)
    : Date.now();
  const startT = endT - state.windowSec * 1000;

  let visible = [];
  for (let i = 0; i < state.samples.length; i++){
    if (state.samples[i].t >= startT) visible.push(state.samples[i]);
  }

  let peak = 600;
  for (let i = 0; i < visible.length; i++) peak = Math.max(peak, visible[i].v);
  const scaleMax = pickMax(peak * 1.15);

  const yOf = function(v){ return padT + plotH - (clamp(v, 0, scaleMax) / scaleMax) * plotH; };
  const xOf = function(t){ return padL + ((t - startT) / (endT - startT)) * plotW; };

  /* 网格 */
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,.055)';
  ctx.lineWidth = 1;
  ctx.font = '10px ui-monospace, "SFMono-Regular", Menlo, Consolas, sans-serif';
  ctx.fillStyle = '#61757f';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++){
    const v = scaleMax * i / 4;
    const y = yOf(v);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.fillText(String(Math.round(v)), padL - 8, y);
  }

  /* 舒适带 */
  const y500 = yOf(500), y300 = yOf(300);
  ctx.fillStyle = 'rgba(91,214,138,.07)';
  ctx.fillRect(padL, y500, plotW, Math.max(0, y300 - y500));
  ctx.strokeStyle = 'rgba(91,214,138,.26)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(padL, y500); ctx.lineTo(padL + plotW, y500); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(padL, y300); ctx.lineTo(padL + plotW, y300); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(91,214,138,.5)';
  ctx.font = '9.5px "Segoe UI","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('舒适带 300–500', padL + 7, (y500 + y300) / 2);

  /* X 轴标签 */
  ctx.fillStyle = '#5f737d';
  ctx.font = '10px "Segoe UI","Microsoft YaHei",sans-serif';
  const xs = [0, 1/3, 2/3, 1];
  for (let i = 0; i < xs.length; i++){
    const px = padL + xs[i] * plotW;
    const label = xs[i] === 1 ? '现在' : fmtRel(-state.windowSec * 1000 * (1 - xs[i]));
    ctx.textAlign = xs[i] === 0 ? 'left' : xs[i] === 1 ? 'right' : 'center';
    ctx.fillText(label, px, h - 9);
  }
  ctx.restore();

  /* 曲线 */
  if (visible.length){
    const pts = [];
    for (let i = 0; i < visible.length; i++){
      pts.push([xOf(visible[i].t), yOf(visible[i].v)]);
    }

    if (pts.length > 1){
      const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      grad.addColorStop(0, 'rgba(61,219,201,.30)');
      grad.addColorStop(1, 'rgba(61,219,201,0)');
      ctx.beginPath();
      ctx.moveTo(pts[0][0], padT + plotH);
      for (let i = 0; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.lineTo(pts[pts.length - 1][0], padT + plotH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }

    ctx.save();
    ctx.shadowColor = 'rgba(61,219,201,.55)';
    ctx.shadowBlur = 9;
    ctx.strokeStyle = '#3ddbc9';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
    ctx.restore();

    /* 末端脉冲点 */
    const lastPt = pts[pts.length - 1];
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 480);
    ctx.beginPath();
    ctx.arc(lastPt[0], lastPt[1], 7 + pulse * 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(61,219,201,' + (0.10 + pulse * 0.09).toFixed(3) + ')';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lastPt[0], lastPt[1], 3.2, 0, Math.PI * 2);
    ctx.fillStyle = '#9ff8ee';
    ctx.fill();

    /* 悬停提示 */
    if (chart.hoverX != null && chart.hoverX >= padL && chart.hoverX <= padL + plotW){
      let best = null, bestDist = Infinity;
      for (let i = 0; i < visible.length; i++){
        const px = xOf(visible[i].t);
        const d = Math.abs(px - chart.hoverX);
        if (d < bestDist){ bestDist = d; best = { s: visible[i], x: px, y: yOf(visible[i].v) }; }
      }
      if (best && bestDist <= 26){
        ctx.strokeStyle = 'rgba(255,255,255,.18)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(best.x, padT);
        ctx.lineTo(best.x, padT + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(best.x, best.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#eafffb';
        ctx.fill();

        const wrapRect = el.chartWrap.getBoundingClientRect();
        el.chartTip.style.left = clamp(best.x, 56, wrapRect.width - 56) + 'px';
        el.chartTip.style.top = Math.max(24, best.y) + 'px';
        el.chartTip.innerHTML = fmtClock(best.s.t) + ' · <b>' + Math.round(best.s.v) + ' lux</b>';
        el.chartTip.style.opacity = '1';
      } else {
        el.chartTip.style.opacity = '0';
      }
    } else {
      el.chartTip.style.opacity = '0';
    }
  } else {
    ctx.fillStyle = '#5f737d';
    ctx.font = '12px "Segoe UI","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('暂无数据 · 开启摄像头或模拟数据后开始记录', padL + plotW / 2, padT + plotH / 2);
    el.chartTip.style.opacity = '0';
  }
}

function chartLoop(ts){
  drawChart(ts);
  requestAnimationFrame(chartLoop);
}

/* ================= 统计 ================= */
function fmtDuration(sec){
  if (!isFinite(sec) || sec < 1) return '<1 分钟';
  if (sec < 60) return Math.round(sec) + ' 秒';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return m + ' 分 ' + s + ' 秒';
}

function updateStats(){
  const arr = state.samples;
  if (!arr.length){
    el.avgLux.textContent = '--';
    el.comfortPct.textContent = '--';
    el.duration.textContent = '--';
    el.sampleCount.textContent = '--';
    return;
  }
  let sum = 0, comfort = 0;
  for (let i = 0; i < arr.length; i++){
    sum += arr[i].v;
    if (arr[i].v >= 300 && arr[i].v <= 500) comfort++;
  }
  el.avgLux.textContent = Math.round(sum / arr.length);
  el.comfortPct.textContent = Math.round(comfort / arr.length * 100) + '%';
  el.duration.textContent = fmtDuration((arr[arr.length - 1].t - arr[0].t) / 1000);
  el.sampleCount.textContent = arr.length;
}

/* ================= 番茄钟 ================= */
const PRESETS = [
  { f: 25, s: 5, l: 15 },
  { f: 45, s: 10, l: 20 },
  { f: 50, s: 10, l: 20 }
];
const RING_C = 2 * Math.PI * 52;

const timer = {
  phase: 'focus',
  preset: 0,
  duration: PRESETS[0].f * 60,
  remaining: PRESETS[0].f * 60,
  running: false,
  endAt: 0,
  iv: null,
  focusDone: 0,
  token: 0
};

el.ringProg.style.strokeDasharray = RING_C;

function durationFor(phase){
  const p = PRESETS[timer.preset];
  if (phase === 'focus') return p.f * 60;
  if (phase === 'short') return p.s * 60;
  return p.l * 60;
}

function phaseLabel(phase){
  if (phase === 'focus') return '专注';
  if (phase === 'short') return '远眺休息';
  return '长休息';
}

function phaseColor(phase){
  if (phase === 'focus') return '#3ddbc9';
  if (phase === 'short') return '#ffb26b';
  return '#ffd166';
}

function fmtTimer(sec){
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function renderTimer(){
  const remain = timer.running
    ? Math.max(0, (timer.endAt - Date.now()) / 1000)
    : timer.remaining;
  el.timerTime.textContent = fmtTimer(remain);
  el.timerPhase.textContent = phaseLabel(timer.phase);
  el.ringProg.style.stroke = phaseColor(timer.phase);
  const elapsed = clamp(1 - remain / timer.duration, 0, 1);
  el.ringProg.style.strokeDashoffset = (RING_C * elapsed).toFixed(2);

  if (timer.running){
    el.timerToggle.textContent = '暂停';
  } else {
    const started = timer.remaining < timer.duration - 0.5;
    el.timerToggle.textContent = started ? '继续' : (timer.phase === 'focus' ? '开始专注' : '开始休息');
  }

  if (timer.running){
    document.title = fmtTimer(remain) + ' · ' + phaseLabel(timer.phase) + ' | 护眼调光';
  } else {
    document.title = '护眼调光 · 环境光自适应系统';
  }
}

function renderDots(){
  el.cycleDots.innerHTML = '';
  const inRound = timer.focusDone % 4;
  const filled = (inRound === 0 && timer.focusDone > 0) ? 4 : inRound;
  for (let i = 0; i < 4; i++){
    const d = document.createElement('span');
    d.className = 'dot' + (i < filled ? ' filled' : '');
    el.cycleDots.appendChild(d);
  }
  el.pomoCount.textContent = '已完成 ' + timer.focusDone + ' 个番茄';
}

function startTimer(){
  if (timer.running) return;
  ensureAudio();
  timer.token++;
  timer.running = true;
  timer.endAt = Date.now() + timer.remaining * 1000;
  clearInterval(timer.iv);
  timer.iv = setInterval(timerTick, 200);
  renderTimer();
}

function pauseTimer(){
  if (!timer.running) return;
  timer.token++;
  timer.remaining = Math.max(0, (timer.endAt - Date.now()) / 1000);
  timer.running = false;
  clearInterval(timer.iv);
  renderTimer();
}

function timerTick(){
  if (!timer.running) return;
  const rem = (timer.endAt - Date.now()) / 1000;
  if (rem <= 0){
    timer.remaining = 0;
    timer.running = false;
    clearInterval(timer.iv);
    renderTimer();
    finishPhase();
    return;
  }
  renderTimer();
}

function finishPhase(){
  const ended = timer.phase;
  let next, title, msg;

  if (ended === 'focus'){
    timer.focusDone++;
    const isLong = timer.focusDone % 4 === 0;
    next = isLong ? 'long' : 'short';
    title = '专注完成';
    msg = isLong ? '已完成 4 个番茄，起来走动一下，休息 20 分钟。'
                 : '看向 6 米外至少 20 秒，让睫状肌放松。';
  } else {
    next = 'focus';
    title = '休息结束';
    msg = '开始下一个专注番茄，先确认一下环境照度。';
  }

  beep(ended === 'focus' ? 3 : 2);
  notify(title, msg);
  toast(title + ' · ' + msg);

  timer.phase = next;
  timer.duration = durationFor(next);
  timer.remaining = timer.duration;
  renderTimer();
  renderDots();

  const token = ++timer.token;
  setTimeout(function(){
    if (timer.token === token) startTimer();
  }, 700);
}

function resetTimer(){
  timer.token++;
  timer.running = false;
  clearInterval(timer.iv);
  timer.phase = 'focus';
  timer.duration = durationFor('focus');
  timer.remaining = timer.duration;
  renderTimer();
}

function skipPhase(){
  timer.token++;
  timer.running = false;
  clearInterval(timer.iv);
  if (timer.phase === 'focus'){
    timer.phase = 'short';
  } else {
    timer.phase = 'focus';
  }
  timer.duration = durationFor(timer.phase);
  timer.remaining = timer.duration;
  renderTimer();
}

/* ================= 事件绑定 ================= */
el.startBtn.addEventListener('click', startCamera);
el.stopBtn.addEventListener('click', function(){
  stopAll();
  toast('已停止采样。');
});
el.demoBtn.addEventListener('click', startDemo);

el.autoToggle.addEventListener('change', function(e){
  state.auto = e.target.checked;
  applyScreenEffect();
  toast(state.auto ? '已开启自动调光，亮度与色温随环境光变化。' : '已切换为手动调光。');
});

el.filterToggle.addEventListener('change', function(e){
  state.filter = e.target.checked;
  applyScreenEffect();
});

el.briSlider.addEventListener('input', function(e){
  state.manualBri = Number(e.target.value);
  applyScreenEffect();
});
el.tempSlider.addEventListener('input', function(e){
  state.manualTemp = Number(e.target.value);
  applyScreenEffect();
});

el.windowSeg.addEventListener('click', function(e){
  const btn = e.target.closest('button');
  if (!btn) return;
  Array.prototype.forEach.call(el.windowSeg.children, function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  state.windowSec = Number(btn.dataset.sec);
});

el.intervalSel.addEventListener('change', function(e){
  state.interval = Number(e.target.value);
  if (state.running) startLoop();
});

el.cropToggle.addEventListener('change', function(e){
  state.crop = e.target.checked;
});

el.soundToggle.addEventListener('change', function(e){
  state.sound = e.target.checked;
});

el.notifyToggle.addEventListener('change', async function(e){
  if (!e.target.checked){
    state.notify = false;
    return;
  }
  if (!('Notification' in window)){
    toast('当前浏览器不支持桌面通知。');
    e.target.checked = false;
    return;
  }
  try {
    const p = await Notification.requestPermission();
    if (p === 'granted'){
      state.notify = true;
      toast('已开启桌面通知。');
    } else {
      state.notify = false;
      e.target.checked = false;
      toast('通知权限未授予。');
    }
  } catch (err){
    state.notify = false;
    e.target.checked = false;
  }
});

el.calibBtn.addEventListener('click', function(){
  if (state.demo){
    toast('模拟数据模式下无需校准。');
    return;
  }
  if (state.lastMean == null){
    toast('请先开启摄像头并等待画面稳定。');
    return;
  }
  const target = parseFloat(el.calibInput.value);
  if (!isFinite(target) || target <= 0){
    toast('请输入照度计的实测值。');
    return;
  }
  const lin = Math.pow(state.lastMean / 255, 2.2);
  if (lin < 0.0008){
    toast('画面过暗，当前无法可靠校准，请提高环境光。');
    return;
  }
  state.K = clamp(target / lin, 100, 500000);
  el.kValue.textContent = Math.round(state.K);
  state.rawHist = [];
  state.smooth = null;
  toast('已按实测值校准，估算系数 K = ' + Math.round(state.K) + '。');
});

el.calibReset.addEventListener('click', function(){
  state.K = 2400;
  state.rawHist = [];
  state.smooth = null;
  el.kValue.textContent = '2400';
  toast('已恢复默认估算系数。');
});

el.timerToggle.addEventListener('click', function(){
  ensureAudio();
  if (timer.running) pauseTimer();
  else startTimer();
});

el.timerReset.addEventListener('click', resetTimer);
el.timerSkip.addEventListener('click', skipPhase);

el.presetSeg.addEventListener('click', function(e){
  const btn = e.target.closest('button');
  if (!btn) return;
  Array.prototype.forEach.call(el.presetSeg.children, function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  timer.preset = Number(btn.dataset.i);
  resetTimer();
  toast('已切换为 ' + PRESETS[timer.preset].f + ' 分钟专注 / ' + PRESETS[timer.preset].s + ' 分钟休息。');
});

el.chart.addEventListener('mousemove', function(e){
  const rect = canvas.getBoundingClientRect();
  chart.hoverX = e.clientX - rect.left;
});
el.chart.addEventListener('mouseleave', function(){
  chart.hoverX = null;
  el.chartTip.style.opacity = '0';
});

/* ================= 初始化 ================= */
buildScale();
applyScreenEffect();
renderTimer();
renderDots();
updateStats();
resizeChart();
if (window.ResizeObserver){
  new ResizeObserver(resizeChart).observe(el.chartWrap);
} else {
  window.addEventListener('resize', resizeChart);
}
setInterval(updateStats, 1000);
requestAnimationFrame(chartLoop);

// 初次进入给出轻提示（避免打扰，只提示一次）
setTimeout(function(){
  toast('提示：将摄像头朝向桌面或白墙，估算更接近工作面照度。');
}, 900);
})();

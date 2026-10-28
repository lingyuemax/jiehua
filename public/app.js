const FRAME_KEYS = [
  'summary',
  'scene',
  'people',
  'objects',
  'text',
  'action',
  'camera',
  'lighting',
  'details'
];

const KEY_LABELS = {
  scene: '场景',
  people: '人物',
  objects: '物体',
  text: '画面文字',
  action: '动作',
  camera: '镜头',
  lighting: '光线',
  details: '细节'
};

const STATUS_LABELS = {
  pending: '等待抽帧',
  extracting: '抽取中',
  analyzing: '识别中',
  done: '已解读',
  error: '失败',
  cancelled: '已取消'
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const dom = {
  body: document.body,
  stage: $('#stage'),
  video: $('#video'),
  dropzone: $('#dropzone'),
  fileInput: $('#fileInput'),
  pickBtn: $('#pickBtn'),
  sampleBtn: $('#sampleBtn'),
  changeBtn: $('#changeBtn'),
  fileBadge: $('#fileBadge'),
  fileName: $('#fileName'),
  fileSize: $('#fileSize'),
  stageStatus: $('#stageStatus'),
  stageStatusText: $('#stageStatusText'),
  timeline: $('#timeline'),
  timelineProgress: $('#timelineProgress'),
  timelineHead: $('#timelineHead'),
  timelineMarkers: $('#timelineMarkers'),
  currentTime: $('#currentTime'),
  durationTime: $('#durationTime'),
  statElapsed: $('#statElapsed'),
  statElapsedSub: $('#statElapsedSub'),
  statFrames: $('#statFrames'),
  statFramesSub: $('#statFramesSub'),
  statLatency: $('#statLatency'),
  statCost: $('#statCost'),
  statCostSub: $('#statCostSub'),
  modeSeg: $('#modeSeg'),
  qualitySeg: $('#qualitySeg'),
  frameCount: $('#frameCount'),
  frameCountLabel: $('#frameCountLabel'),
  concurrency: $('#concurrency'),
  startBtn: $('#startBtn'),
  currentPane: $('#currentPane'),
  filmstrip: $('#filmstrip'),
  filmCount: $('#filmCount'),
  frameList: $('#frameList'),
  listNote: $('#listNote'),
  syncState: $('#syncState'),
  copyBtn: $('#copyBtn'),
  exportBtn: $('#exportBtn'),
  keyBtn: $('#keyBtn'),
  keyDialog: $('#keyDialog'),
  keyInput: $('#keyInput'),
  rememberKey: $('#rememberKey'),
  toggleKey: $('#toggleKey'),
  saveKeyBtn: $('#saveKeyBtn'),
  keyDialogNote: $('#keyDialogNote'),
  apiState: $('#apiState'),
  apiDot: $('#apiDot'),
  apiText: $('#apiText'),
  modelChip: $('#modelChip'),
  toastWrap: $('#toastWrap')
};

const EMPTY_PANEL = dom.currentPane.innerHTML;

const state = {
  config: null,
  file: null,
  objectUrl: null,
  videoId: null,
  jobId: null,
  job: null,
  frames: [],
  activeIndex: -1,
  stats: null,
  key: readStoredKey(),
  mode: 'keyframe',
  quality: 'balanced',
  maxFrames: 10,
  concurrency: 12,
  analyzing: false,
  uploading: false,
  mock: false,
  pendingStart: false,
  eventSource: null,
  suppressSyncUntil: 0,
  lastFocusedIndex: -1
};

function readStoredKey() {
  try {
    return (
      localStorage.getItem('jiehua.key') ||
      sessionStorage.getItem('jiehua.key') ||
      localStorage.getItem('frameread.key') ||
      sessionStorage.getItem('frameread.key') ||
      ''
    );
  } catch {
    return '';
  }
}

function storeKey(key) {
  try {
    if (dom.rememberKey.checked) {
      localStorage.setItem('jiehua.key', key);
      sessionStorage.removeItem('jiehua.key');
    } else {
      sessionStorage.setItem('jiehua.key', key);
      localStorage.removeItem('jiehua.key');
    }
    localStorage.removeItem('frameread.key');
    sessionStorage.removeItem('frameread.key');
  } catch {
    /* private mode */
  }
}

function clearStoredKey() {
  try {
    localStorage.removeItem('jiehua.key');
    sessionStorage.removeItem('jiehua.key');
    localStorage.removeItem('frameread.key');
    sessionStorage.removeItem('frameread.key');
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* formatting                                                          */
/* ------------------------------------------------------------------ */

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatClock(seconds, withMs = false) {
  const safe = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const base =
    hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  if (!withMs) return base;
  return `${base}.${String(Math.floor((safe % 1) * 100)).padStart(2, '0')}`;
}

function formatMs(ms) {
  if (!ms && ms !== 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatCost(cost) {
  if (!cost) return '¥0.0000';
  if (cost < 0.0001) return '< ¥0.0001';
  return `¥${cost.toFixed(4)}`;
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function toast(message, type = '') {
  const node = document.createElement('div');
  node.className = `toast ${type}`.trim();
  node.textContent = message;
  dom.toastWrap.append(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    node.style.transition = '0.25s ease';
    setTimeout(() => node.remove(), 260);
  }, 3600);
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  bindEvents();
  updateRangeFill();
  updateKeyStatus();
  renderCurrent();
  refreshConfig();

  const params = new URLSearchParams(location.search);
  if (params.get('sample') === '1') {
    await loadSample();
    if (params.get('mock') === '1') {
      startAnalysis({ mock: true });
    }
  }
}

async function refreshConfig() {
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (!response.ok) throw new Error('config');
    state.config = await response.json();
    dom.modelChip.textContent = state.config.model || 'deepseek-flash';
    if (state.config.hasServerKey) {
      dom.keyDialogNote.innerHTML =
        '本机服务已配置 <code>DEEPSEEK_API_KEY</code>。也可以在这里临时覆盖，浏览器中的 Key 优先级更高。';
    }
    updateKeyStatus();
    if (state.key || state.config.hasServerKey) {
      dom.startBtn.disabled = !state.videoId;
    }
  } catch {
    dom.apiState.className = 'api-state warn';
    dom.apiText.textContent = '服务连接失败';
  }
}

function updateKeyStatus() {
  const configured = Boolean(state.key || state.config?.hasServerKey);
  if (configured) {
    dom.apiState.className = 'api-state ready';
    dom.apiText.textContent = state.key ? 'API Key 已配置' : '服务端 Key 已配置';
  } else {
    dom.apiState.className = 'api-state warn';
    dom.apiText.textContent = '待配置 API Key';
  }
}

/* ------------------------------------------------------------------ */
/* events                                                              */
/* ------------------------------------------------------------------ */

function bindEvents() {
  dom.pickBtn.addEventListener('click', () => dom.fileInput.click());
  dom.changeBtn.addEventListener('click', () => dom.fileInput.click());
  dom.fileInput.addEventListener('change', () => {
    const file = dom.fileInput.files?.[0];
    if (file) handleFile(file);
    dom.fileInput.value = '';
  });

  dom.sampleBtn.addEventListener('click', () => loadSample());

  for (const eventName of ['dragenter', 'dragover']) {
    dom.stage.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (!state.analyzing) dom.stage.classList.add('dragging');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    dom.stage.addEventListener(eventName, (event) => {
      event.preventDefault();
      dom.stage.classList.remove('dragging');
    });
  }
  dom.stage.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });

  dom.video.addEventListener('loadedmetadata', () => {
    dom.durationTime.textContent = formatClock(dom.video.duration);
    dom.stage.classList.add('has-video');
    dom.body.classList.add('has-video');
    updateProgress();
  });
  dom.video.addEventListener('timeupdate', onTimeUpdate);
  dom.video.addEventListener('seeking', updateProgress);
  dom.video.addEventListener('play', () => {
    dom.syncState.classList.remove('off');
    dom.syncState.innerHTML = '<span></span>跟随播放';
  });
  dom.video.addEventListener('pause', () => {
    dom.syncState.classList.add('off');
    dom.syncState.innerHTML = '<span></span>已暂停';
  });
  dom.video.addEventListener('ended', () => {
    dom.syncState.classList.add('off');
    dom.syncState.innerHTML = '<span></span>播放结束';
  });

  dom.timeline.addEventListener('click', (event) => {
    if (!dom.video.duration) return;
    const rect = dom.timeline.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    seekTo(ratio * dom.video.duration);
  });
  dom.timeline.addEventListener('keydown', (event) => {
    if (!dom.video.duration) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      seekTo(dom.video.currentTime + (event.key === 'ArrowRight' ? 1 : -1));
    }
  });

  $$('#modeSeg button').forEach((button) => {
    button.addEventListener('click', () => {
      if (state.analyzing) return;
      state.mode = button.dataset.mode;
      $$('#modeSeg button').forEach((item) => item.classList.toggle('active', item === button));
    });
  });

  $$('#qualitySeg button').forEach((button) => {
    button.addEventListener('click', () => {
      if (state.analyzing) return;
      state.quality = button.dataset.quality;
      $$('#qualitySeg button').forEach((item) => item.classList.toggle('active', item === button));
    });
  });

  dom.frameCount.addEventListener('input', () => {
    state.maxFrames = Number(dom.frameCount.value);
    dom.frameCountLabel.textContent = String(state.maxFrames);
    updateRangeFill();
  });

  dom.concurrency.addEventListener('change', () => {
    state.concurrency = Number(dom.concurrency.value);
  });

  dom.startBtn.addEventListener('click', () => {
    if (state.analyzing) return;
    startAnalysis();
  });

  dom.copyBtn.addEventListener('click', copyCurrent);
  dom.exportBtn.addEventListener('click', exportJson);

  dom.keyBtn.addEventListener('click', openKeyDialog);
  dom.keyDialog.addEventListener('click', (event) => {
    if (event.target === dom.keyDialog) dom.keyDialog.close();
  });
  $$('[data-close-dialog]', dom.keyDialog).forEach((button) => {
    button.addEventListener('click', () => {
      state.pendingStart = false;
      dom.keyDialog.close();
    });
  });
  dom.saveKeyBtn.addEventListener('click', saveKey);
  dom.toggleKey.addEventListener('click', () => {
    const show = dom.keyInput.type === 'password';
    dom.keyInput.type = show ? 'text' : 'password';
    dom.toggleKey.textContent = show ? '隐藏' : '显示';
  });
  dom.keyInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveKey();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.target.matches('input, textarea, select')) return;
    if (event.target.closest('button, a, [role="button"]')) return;
    if (event.code === 'Space' && state.videoId) {
      event.preventDefault();
      if (dom.video.paused) dom.video.play().catch(() => {});
      else dom.video.pause();
    }
    if (event.key === 'ArrowRight' && state.videoId && !event.target.closest('button')) {
      seekTo(dom.video.currentTime + 1);
    }
    if (event.key === 'ArrowLeft' && state.videoId && !event.target.closest('button')) {
      seekTo(dom.video.currentTime - 1);
    }
  });

  setInterval(tickElapsed, 250);
}

function updateRangeFill() {
  const min = Number(dom.frameCount.min);
  const max = Number(dom.frameCount.max);
  const value = Number(dom.frameCount.value);
  const percent = ((value - min) / (max - min)) * 100;
  dom.frameCount.style.setProperty('--range-progress', `${percent}%`);
}

function openKeyDialog() {
  dom.keyInput.value = state.key;
  dom.keyInput.type = 'password';
  dom.toggleKey.textContent = '显示';
  dom.rememberKey.checked = Boolean(state.key);
  dom.keyDialog.showModal();
  setTimeout(() => dom.keyInput.focus(), 30);
}

function saveKey() {
  const key = dom.keyInput.value.trim();
  if (!key && !state.config?.hasServerKey) {
    toast('请填入 DeepSeek API Key，或先在 .env 中配置', 'error');
    dom.keyInput.focus();
    return;
  }

  const shouldStart = state.pendingStart;
  state.pendingStart = false;
  state.key = key;
  if (key) storeKey(key);
  else clearStoredKey();

  dom.keyDialog.close();
  updateKeyStatus();
  if (state.videoId) dom.startBtn.disabled = false;
  toast(key ? 'API Key 已保存在本机浏览器' : '已清除浏览器 Key，将使用服务端配置', 'success');

  if (shouldStart) startAnalysis();
}

/* ------------------------------------------------------------------ */
/* upload                                                              */
/* ------------------------------------------------------------------ */

async function loadSample() {
  if (state.uploading) return;
  try {
    dom.sampleBtn.disabled = true;
    dom.sampleBtn.textContent = '载入中…';
    const response = await fetch('/samples/demo.mp4');
    if (!response.ok) throw new Error('示例视频不存在');
    const blob = await response.blob();
    const file = new File([blob], 'jiehua-demo.mp4', { type: 'video/mp4' });
    await handleFile(file);
  } catch (error) {
    toast(error.message || '示例视频加载失败', 'error');
  } finally {
    dom.sampleBtn.disabled = false;
    dom.sampleBtn.textContent = '载入 12 秒示例 →';
  }
}

async function handleFile(file) {
  if (!file) return;
  if (!file.type.startsWith('video/') && !/\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(file.name)) {
    toast('请选择视频文件', 'error');
    return;
  }
  if (file.size > 2 * 1024 * 1024 * 1024) {
    toast('视频超过 2 GB 上限', 'error');
    return;
  }

  resetSession();

  state.file = file;
  state.objectUrl = URL.createObjectURL(file);
  dom.video.src = state.objectUrl;
  dom.video.load();
  dom.stage.classList.add('has-video');
  dom.body.classList.add('has-video');
  dom.fileBadge.classList.remove('hidden');
  dom.fileName.textContent = file.name;
  dom.fileSize.textContent = formatBytes(file.size);
  dom.durationTime.textContent = '00:00';
  dom.currentTime.textContent = '00:00';
  setStageStatus('上传中 0%');

  state.uploading = true;
  try {
    const video = await uploadFile(file, (percent) => {
      setStageStatus(`上传中 ${Math.round(percent)}%`);
      dom.fileSize.textContent = `${formatBytes(file.size)} · ${Math.round(percent)}%`;
    });
    state.videoId = video.id;
    state.uploading = false;
    dom.fileSize.textContent = formatBytes(file.size);
    dom.startBtn.disabled = false;
    dom.startBtn.querySelector('span').textContent = '开始解读';
    setStageStatus('准备就绪');
    setTimeout(() => {
      if (!state.analyzing && state.job?.status !== 'done') hideStageStatus();
    }, 1600);
  } catch (error) {
    state.uploading = false;
    setStageStatus('上传失败');
    dom.fileSize.textContent = formatBytes(file.size);
    toast(error.message || '上传失败', 'error');
  }
}

function uploadFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
    };
    xhr.onload = () => {
      let payload = null;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300 && payload?.video) {
        resolve(payload.video);
      } else {
        reject(new Error(payload?.error || `上传失败（HTTP ${xhr.status}）`));
      }
    };
    xhr.onerror = () => reject(new Error('网络错误，上传失败'));
    xhr.ontimeout = () => reject(new Error('上传超时'));
    xhr.timeout = 0;
    xhr.send(file);
  });
}

function resetSession() {
  if (state.jobId && state.analyzing) {
    fetch(`/api/jobs/${state.jobId}/cancel`, { method: 'POST' }).catch(() => {});
  }
  closeEvents();
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = null;
  state.file = null;
  state.videoId = null;
  state.jobId = null;
  state.job = null;
  state.frames = [];
  state.activeIndex = -1;
  state.stats = null;
  state.analyzing = false;
  state.mock = false;
  state.uploading = false;
  state.suppressSyncUntil = 0;

  dom.video.pause();
  dom.video.removeAttribute('src');
  dom.video.load();
  dom.stage.classList.remove('has-video', 'dragging');
  dom.body.classList.remove('has-video');
  dom.fileBadge.classList.add('hidden');
  dom.modelChip.textContent = state.config?.model || 'deepseek-flash';
  updateKeyStatus();
  dom.startBtn.disabled = true;
  dom.startBtn.querySelector('span').textContent = '开始解读';
  dom.exportBtn.disabled = true;
  dom.copyBtn.disabled = true;
  dom.currentPane.innerHTML = EMPTY_PANEL;
  dom.filmstrip.innerHTML = '<div class="film-empty">解读后在这里排列每一帧</div>';
  dom.frameList.innerHTML = '<div class="list-empty">暂无数据</div>';
  dom.filmCount.textContent = '0';
  dom.listNote.textContent = '按时间排序';
  dom.timelineMarkers.innerHTML = '';
  dom.timelineProgress.style.width = '0%';
  dom.timelineHead.style.left = '0%';
  dom.currentTime.textContent = '00:00';
  dom.durationTime.textContent = '00:00';
  dom.syncState.classList.add('off');
  dom.syncState.innerHTML = '<span></span>已暂停';
  resetStats();
  hideStageStatus();
}

/* ------------------------------------------------------------------ */
/* analysis                                                           */
/* ------------------------------------------------------------------ */

async function startAnalysis({ mock = false } = {}) {
  if (!state.videoId) {
    toast('请先上传一个视频', 'error');
    return;
  }
  if (state.analyzing) return;

  if (!mock && !state.key && !state.config?.hasServerKey) {
    state.pendingStart = true;
    openKeyDialog();
    return;
  }

  closeEvents();
  state.analyzing = true;
  state.mock = mock;
  state.frames = [];
  state.activeIndex = -1;
  state.job = null;
  state.jobId = null;
  state.stats = null;
  dom.startBtn.disabled = true;
  dom.startBtn.querySelector('span').textContent = '准备中…';
  dom.exportBtn.disabled = true;
  dom.copyBtn.disabled = true;
  dom.timelineMarkers.innerHTML = '';
  dom.filmstrip.innerHTML = '<div class="film-empty">正在定位关键帧…</div>';
  dom.frameList.innerHTML = '<div class="list-empty">正在读取视频信息</div>';
  dom.currentPane.innerHTML = buildPreparingCard();
  resetStats();
  dom.stage.classList.add('analyzing');
  setStageStatus(mock ? '演示模式 · 准备中' : '定位关键帧');

  const headers = { 'Content-Type': 'application/json' };
  if (state.key) headers['X-DeepSeek-Key'] = state.key;

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        videoId: state.videoId,
        mock,
        options: {
          mode: state.mode,
          maxFrames: state.maxFrames,
          quality: state.quality,
          concurrency: state.concurrency
        }
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (payload.code === 'NO_API_KEY') {
        state.pendingStart = true;
        openKeyDialog();
      }
      throw new Error(payload.error || `请求失败（HTTP ${response.status}）`);
    }

    state.jobId = payload.job.id;
    state.job = payload.job;
    state.mock = Boolean(payload.job.mock);
    if (state.mock) dom.modelChip.textContent = 'demo · mock';
    else dom.modelChip.textContent = payload.job.model || 'deepseek-flash';
    connectEvents();
  } catch (error) {
    state.analyzing = false;
    dom.startBtn.disabled = false;
    dom.startBtn.querySelector('span').textContent = '开始解读';
    setStageStatus('启动失败');
    toast(error.message || '无法启动解读', 'error');
    dom.currentPane.innerHTML = buildErrorCard(error.message);
  }
}

function connectEvents() {
  const source = new EventSource(`/api/jobs/${state.jobId}/events`);
  state.eventSource = source;

  source.addEventListener('snapshot', (event) => {
    const payload = JSON.parse(event.data);
    applyJob(payload.job);
  });

  source.addEventListener('status', (event) => {
    const payload = JSON.parse(event.data);
    if (state.job) {
      state.job.status = payload.status;
      state.job.stage = payload.stage;
      state.job.stats = payload.stats;
    }
    state.stats = payload.stats;
    if (payload.status === 'preparing') {
      setStageStatus(payload.stage || '定位关键帧');
      dom.startBtn.querySelector('span').textContent = '准备中…';
    }
    if (payload.status === 'analyzing') {
      setStageStatus(`并行解读 · ${payload.stats.framesDone}/${payload.stats.framesTotal}`);
      dom.startBtn.querySelector('span').textContent = '解读中…';
    }
    renderStats();
  });

  source.addEventListener('plan', (event) => {
    const payload = JSON.parse(event.data);
    if (state.job) {
      state.job.meta = payload.meta;
      state.job.frames = payload.frames;
      state.job.stats = payload.stats;
    }
    state.frames = payload.frames;
    state.stats = payload.stats;
    if (payload.meta) {
      dom.durationTime.textContent = formatClock(payload.meta.duration);
    }
    renderMarkers();
    renderFilmstrip();
    renderFrameList();
    renderStats();
    if (state.frames.length) {
      const index = activeIndexAt(dom.video.currentTime);
      selectFrame(index, { seek: false, scroll: false });
    }
    setStageStatus(`已锁定 ${state.frames.length} 个关键帧`);
  });

  source.addEventListener('frame', (event) => {
    const payload = JSON.parse(event.data);
    mergeFrame(payload.frame);
    state.stats = payload.stats;
    if (state.job) state.job.stats = payload.stats;
    renderFilmstrip();
    renderFrameList();
    renderStats();
    updateMarkerStates();
    if (state.activeIndex === payload.frame.index) renderCurrent();
    const done = state.frames.filter((frame) => frame.status === 'done').length;
    setStageStatus(`并行解读 · ${done}/${state.frames.length}`);
  });

  source.addEventListener('done', (event) => {
    const payload = JSON.parse(event.data);
    applyJob(payload.job, { final: true });
    closeEvents();
  });

  source.onerror = () => {
    if (state.analyzing) {
      setStageStatus('连接中断，正在重连…');
    }
  };
}

function closeEvents() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

function applyJob(job, { final = false } = {}) {
  if (!job) return;
  state.job = job;
  state.jobId = job.id;
  state.frames = job.frames || [];
  state.stats = job.stats;
  state.mock = Boolean(job.mock);
  state.analyzing = ['queued', 'preparing', 'analyzing'].includes(job.status);

  if (job.mock) dom.modelChip.textContent = 'demo · mock';
  else dom.modelChip.textContent = job.model || 'deepseek-flash';

  if (job.mock) {
    dom.apiState.className = 'api-state ready';
    dom.apiText.textContent = '演示模式 · 不调用 API';
  } else {
    updateKeyStatus();
  }

  if (job.meta?.duration) {
    dom.durationTime.textContent = formatClock(job.meta.duration);
  }

  renderMarkers();
  renderFilmstrip();
  renderFrameList();
  renderStats();

  if (state.activeIndex < 0 && state.frames.length) {
    state.activeIndex = activeIndexAt(dom.video.currentTime);
  }
  renderCurrent();

  if (job.status === 'done') {
    state.analyzing = false;
    dom.stage.classList.remove('analyzing');
    dom.startBtn.disabled = false;
    dom.startBtn.querySelector('span').textContent = '重新解读';
    dom.exportBtn.disabled = !state.frames.some((frame) => frame.status === 'done');
    setStageStatus(`解读完成 · ${formatMs(job.stats?.elapsedMs)}`);
    if (final) {
      dom.syncState.classList.remove('off');
      dom.syncState.innerHTML = '<span></span>跟随播放';
      setTimeout(() => hideStageStatus(), 2500);
    }
  } else if (job.status === 'error') {
    state.analyzing = false;
    dom.stage.classList.remove('analyzing');
    dom.startBtn.disabled = false;
    dom.startBtn.querySelector('span').textContent = '重试';
    setStageStatus('解读失败');
    if (job.error) toast(job.error, 'error');
  } else if (job.status === 'cancelled') {
    state.analyzing = false;
    dom.stage.classList.remove('analyzing');
    dom.startBtn.disabled = false;
    dom.startBtn.querySelector('span').textContent = '重新解读';
    setStageStatus('已取消');
  } else {
    dom.stage.classList.add('analyzing');
  }

  if (['done', 'error', 'cancelled'].includes(job.status) && state.eventSource) {
    closeEvents();
  }
}

function mergeFrame(frame) {
  const index = state.frames.findIndex((item) => item.index === frame.index);
  if (index >= 0) state.frames[index] = { ...state.frames[index], ...frame };
  else state.frames.push(frame);
  state.frames.sort((a, b) => a.index - b.index);
}

/* ------------------------------------------------------------------ */
/* playback sync                                                       */
/* ------------------------------------------------------------------ */

function onTimeUpdate() {
  updateProgress();
  if (!state.frames.length) return;
  if (performance.now() < state.suppressSyncUntil) return;
  const index = activeIndexAt(dom.video.currentTime);
  if (index !== state.activeIndex) {
    selectFrame(index, { seek: false, scroll: true });
  }
}

function activeIndexAt(time) {
  if (!state.frames.length) return -1;
  let low = 0;
  let high = state.frames.length - 1;
  let answer = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (state.frames[mid].time <= time + 0.001) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return answer;
}

function selectFrame(index, { seek = true, scroll = true } = {}) {
  if (!state.frames.length) return;
  const safeIndex = Math.max(0, Math.min(state.frames.length - 1, index));
  const changed = safeIndex !== state.activeIndex;
  state.activeIndex = safeIndex;

  const frame = state.frames[safeIndex];
  if (seek && dom.video.duration && Math.abs(dom.video.currentTime - frame.time) > 0.04) {
    state.suppressSyncUntil = performance.now() + 650;
    dom.video.currentTime = Math.max(0, frame.time + 0.015);
  }

  if (changed || scroll) {
    renderCurrent();
    updateActiveClasses();
    scrollThumbIntoView(safeIndex);
  }
  dom.copyBtn.disabled = frame.status !== 'done';
}

function seekTo(seconds) {
  if (!dom.video.duration) return;
  state.suppressSyncUntil = performance.now() + 500;
  dom.video.currentTime = Math.max(0, Math.min(dom.video.duration - 0.01, seconds));
  updateProgress();
}

function updateProgress() {
  const duration = dom.video.duration || state.job?.meta?.duration || 0;
  const current = dom.video.currentTime || 0;
  const percent = duration ? Math.min(100, (current / duration) * 100) : 0;
  dom.timelineProgress.style.width = `${percent}%`;
  dom.timelineHead.style.left = `${percent}%`;
  dom.currentTime.textContent = formatClock(current);
  if (duration) dom.durationTime.textContent = formatClock(duration);
}

function tickElapsed() {
  if (!state.analyzing || !state.job?.createdAt) return;
  const elapsed = Math.max(0, Date.now() - Date.parse(state.job.createdAt));
  dom.statElapsed.textContent = formatMs(elapsed);
  dom.statElapsedSub.textContent = '正在并行处理';
}

/* ------------------------------------------------------------------ */
/* rendering                                                           */
/* ------------------------------------------------------------------ */

function buildPreparingCard() {
  return `
    <div class="frame-card">
      <div class="frame-visual"><div class="placeholder"><span>LOCATING KEYFRAMES</span></div></div>
      <div class="card-head"><h3>正在读取视频结构…</h3><span class="state-chip working">准备中</span></div>
      <p class="card-summary">探测时长与关键帧，随后会并行发出识别请求。</p>
      <div class="skeleton-line medium"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line short"></div>
    </div>
  `;
}

function buildErrorCard(message) {
  return `
    <div class="frame-card">
      <div class="card-head"><h3>没有拿到结果</h3><span class="state-chip error">失败</span></div>
      <div class="error-note">${esc(message || '未知错误')}</div>
      <p class="card-summary">检查 API Key、网络或视频格式后，再点右下角的「重试」。</p>
    </div>
  `;
}

function renderCurrent() {
  if (!state.frames.length) {
    if (state.job?.status === 'error') {
      dom.currentPane.innerHTML = buildErrorCard(state.job.error || '读取视频失败');
    } else if (state.job?.status === 'cancelled') {
      dom.currentPane.innerHTML = buildErrorCard('任务已取消');
    } else if (state.analyzing) {
      dom.currentPane.innerHTML = buildPreparingCard();
    } else if (!state.jobId) {
      dom.currentPane.innerHTML = EMPTY_PANEL;
    }
    return;
  }

  const frame = state.frames[state.activeIndex] || state.frames[0];
  if (!frame) return;

  const done = frame.status === 'done' && frame.data;
  const busy = frame.status === 'analyzing' || frame.status === 'extracting' || frame.status === 'pending';
  const chipClass =
    frame.status === 'done'
      ? 'done'
      : frame.status === 'error'
        ? 'error'
        : frame.status === 'cancelled'
          ? ''
          : 'working';

  const visual = frame.url
    ? `<img src="${esc(frame.url)}" alt="第 ${frame.index + 1} 帧画面" loading="eager" />`
    : `<div class="placeholder"><span>${busy ? 'EXTRACTING FRAME' : 'NO FRAME'}</span></div>`;

  const summary = done
    ? frame.data.summary
    : frame.status === 'error'
      ? '这一帧解读失败'
      : frame.status === 'analyzing'
        ? 'DeepSeek 正在读取这一帧…'
        : '等待抽取画面…';

  const rows = done
    ? FRAME_KEYS.filter((key) => key !== 'summary')
        .map(
          (key) => `
            <div class="kv-row">
              <span class="kv-key">${esc(KEY_LABELS[key] || key)}</span>
              <span class="kv-value ${key === 'text' ? 'accent' : ''}">${esc(frame.data[key] || '未识别')}</span>
            </div>`
        )
        .join('')
    : busy
      ? FRAME_KEYS.filter((key) => key !== 'summary')
          .slice(0, 6)
          .map(
            (key) => `
              <div class="kv-row">
                <span class="kv-key">${esc(KEY_LABELS[key] || key)}</span>
                <span class="kv-value kv-placeholder">读取中…</span>
              </div>`
          )
          .join('')
      : '';

  const metaPills = [];
  if (frame.latencyMs) {
    metaPills.push(`<span class="meta-pill">API <b>${formatMs(frame.latencyMs)}</b></span>`);
  }
  if (frame.extractMs) {
    metaPills.push(`<span class="meta-pill">抽帧 <b>${formatMs(frame.extractMs)}</b></span>`);
  }
  if (frame.usage?.total_tokens && !frame.cached) {
    metaPills.push(`<span class="meta-pill">tokens <b>${frame.usage.total_tokens}</b></span>`);
  }
  if (frame.cached) metaPills.push('<span class="meta-pill cache">缓存命中</span>');
  if (frame.mock) metaPills.push('<span class="meta-pill">演示数据</span>');

  dom.currentPane.innerHTML = `
    <div class="frame-card">
      <div class="frame-visual">
        ${visual}
        <span class="frame-timecode">${formatClock(frame.time, true)}</span>
        <span class="frame-index-chip">FRAME ${String(frame.index + 1).padStart(2, '0')}</span>
      </div>
      <div class="card-head">
        <h3>${esc(summary)}</h3>
        <span class="state-chip ${chipClass}">${esc(statusLabel(frame.status))}</span>
      </div>
      ${
        done
          ? `<div class="kv-list">${rows}</div>
             <div class="card-meta">${metaPills.join('')}</div>`
          : busy
            ? `<p class="card-summary">${esc(
                frame.status === 'analyzing'
                  ? '画面已抽取，正在等待官方视觉模型返回固定键值对。'
                  : '正在从视频中定位并抽取这一帧。'
              )}</p>
               <div class="working-note"><span class="spinner"></span>${
                 frame.status === 'analyzing' ? 'DeepSeek 识别中' : '本地抽帧中'
               }</div>
               <div class="kv-list">${rows}</div>`
            : frame.status === 'error'
              ? `<div class="error-note">${esc(frame.error || '请求失败')}</div>
                 <button class="retry-btn" data-retry="${frame.index}">重试这一帧</button>`
              : `<p class="card-summary">这一帧已取消。</p>`
      }
    </div>
  `;

  const retry = dom.currentPane.querySelector('[data-retry]');
  if (retry) retry.addEventListener('click', () => retryFrame(frame.index));
  dom.copyBtn.disabled = !done;
}

function renderFilmstrip() {
  if (!state.frames.length) return;
  const scrollLeft = dom.filmstrip.scrollLeft;
  dom.filmstrip.innerHTML = state.frames
    .map((frame) => {
      const media = frame.url
        ? `<img src="${esc(frame.url)}" alt="" loading="lazy" />`
        : '<span class="thumb-skeleton"></span>';
      return `
        <button class="thumb ${frame.index === state.activeIndex ? 'active' : ''}" data-frame="${frame.index}" type="button" aria-label="跳到 ${formatClock(frame.time, true)}">
          <span class="thumb-media">${media}</span>
          <span class="thumb-time"><span>${formatClock(frame.time, true)}</span><i class="thumb-state ${frame.status}"></i></span>
        </button>`;
    })
    .join('');
  dom.filmstrip.scrollLeft = scrollLeft;
  dom.filmCount.textContent = String(state.frames.length);
  $$('.thumb', dom.filmstrip).forEach((button) => {
    button.addEventListener('click', () => {
      selectFrame(Number(button.dataset.frame));
    });
  });
}

function scrollThumbIntoView(index) {
  const thumb = dom.filmstrip.querySelector(`[data-frame="${index}"]`);
  if (!thumb) return;
  const left = thumb.offsetLeft - (dom.filmstrip.clientWidth - thumb.clientWidth) / 2;
  dom.filmstrip.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
}

function renderFrameList() {
  if (!state.frames.length) return;
  const done = state.frames.filter((frame) => frame.status === 'done').length;
  dom.listNote.textContent = `${done} / ${state.frames.length} 已完成`;
  dom.frameList.innerHTML = state.frames
    .map((frame) => {
      const text = frame.data?.summary || (frame.status === 'error' ? frame.error : statusLabel(frame.status));
      const scene = frame.data?.scene || '';
      return `
        <button class="frame-row ${frame.index === state.activeIndex ? 'active' : ''}" data-row="${frame.index}" type="button">
          <span class="row-time">${formatClock(frame.time, true)}</span>
          <span class="row-copy"><strong>${esc(text || '未识别')}</strong><small>${esc(scene || '—')}</small></span>
          <i class="row-state ${frame.status}"></i>
        </button>`;
    })
    .join('');
  $$('.frame-row', dom.frameList).forEach((row) => {
    row.addEventListener('click', () => selectFrame(Number(row.dataset.row)));
  });
}

function updateActiveClasses() {
  $$('.thumb', dom.filmstrip).forEach((thumb) => {
    thumb.classList.toggle('active', Number(thumb.dataset.frame) === state.activeIndex);
  });
  $$('.frame-row', dom.frameList).forEach((row) => {
    row.classList.toggle('active', Number(row.dataset.row) === state.activeIndex);
  });
  updateMarkerStates();
}

function renderMarkers() {
  const duration = state.job?.meta?.duration || dom.video.duration || 0;
  if (!duration || !state.frames.length) {
    dom.timelineMarkers.innerHTML = '';
    return;
  }
  dom.timelineMarkers.innerHTML = state.frames
    .map(
      (frame) => `
        <button class="marker ${frame.status} ${frame.index === state.activeIndex ? 'active' : ''}"
          style="left:${Math.min(100, (frame.time / duration) * 100)}%"
          data-marker="${frame.index}" type="button"
          title="${formatClock(frame.time, true)} · ${esc(statusLabel(frame.status))}"></button>`
    )
    .join('');
  $$('.marker', dom.timelineMarkers).forEach((marker) => {
    marker.addEventListener('click', (event) => {
      event.stopPropagation();
      selectFrame(Number(marker.dataset.marker));
    });
  });
}

function updateMarkerStates() {
  $$('.marker', dom.timelineMarkers).forEach((marker) => {
    const frame = state.frames[Number(marker.dataset.marker)];
    if (!frame) return;
    marker.className = `marker ${frame.status} ${frame.index === state.activeIndex ? 'active' : ''}`;
  });
}

function renderStats() {
  const stats = state.stats || state.job?.stats;
  if (!stats) {
    resetStats();
    return;
  }

  dom.statElapsed.textContent = formatMs(stats.elapsedMs);
  dom.statElapsedSub.textContent = state.analyzing ? '正在并行处理' : stats.finishedAt ? '端到端耗时' : '等待开始';
  dom.statFrames.textContent = `${stats.framesDone} / ${stats.framesTotal}`;
  dom.statFramesSub.textContent = stats.framesTotal
    ? `${stats.cacheHits} 帧缓存命中`
    : '关键帧';
  dom.statLatency.textContent = stats.avgApiMs ? formatMs(stats.avgApiMs) : '—';
  dom.statCost.textContent = state.mock ? '演示模式' : formatCost(stats.costCny);
  dom.statCostSub.textContent = state.mock
    ? '不产生 API 费用'
    : `${stats.apiCalls || 0} 次 API · ${stats.promptTokens || 0} in / ${stats.completionTokens || 0} out`;
}

function resetStats() {
  dom.statElapsed.textContent = '—';
  dom.statElapsedSub.textContent = '等待开始';
  dom.statFrames.textContent = '0 / 0';
  dom.statFramesSub.textContent = '关键帧';
  dom.statLatency.textContent = '—';
  dom.statCost.textContent = '¥0.0000';
  dom.statCostSub.textContent = '按官方价格估算';
}

/* ------------------------------------------------------------------ */
/* stage status                                                        */
/* ------------------------------------------------------------------ */

function setStageStatus(text) {
  dom.stageStatus.classList.remove('hidden');
  dom.stageStatusText.textContent = text;
}

function hideStageStatus() {
  dom.stageStatus.classList.add('hidden');
}

/* ------------------------------------------------------------------ */
/* retry / export                                                      */
/* ------------------------------------------------------------------ */

async function retryFrame(index) {
  if (!state.jobId) return;
  if (!state.key && !state.config?.hasServerKey && !state.mock) {
    state.pendingStart = false;
    openKeyDialog();
    return;
  }
  try {
    const headers = {};
    if (state.key) headers['X-DeepSeek-Key'] = state.key;
    toast('正在重试这一帧…');
    const response = await fetch(`/api/jobs/${state.jobId}/frames/${index}/retry`, {
      method: 'POST',
      headers
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || '重试失败');
    mergeFrame(payload.frame);
    state.stats = payload.stats;
    renderCurrent();
    renderFilmstrip();
    renderFrameList();
    renderStats();
    toast('这一帧已重新解读', 'success');
  } catch (error) {
    toast(error.message || '重试失败', 'error');
  }
}

function copyCurrent() {
  const frame = state.frames[state.activeIndex];
  if (!frame?.data) return;
  const text = JSON.stringify(
    {
      time: frame.time,
      timecode: formatClock(frame.time, true),
      ...pickFrameData(frame.data)
    },
    null,
    2
  );
  if (!navigator.clipboard?.writeText) {
    toast('当前浏览器不支持剪贴板，请用「导出 JSON」', 'error');
    return;
  }
  navigator.clipboard
    .writeText(text)
    .then(() => {
      const label = dom.copyBtn.textContent;
      dom.copyBtn.textContent = '已复制';
      setTimeout(() => (dom.copyBtn.textContent = label), 1400);
    })
    .catch(() => toast('复制失败，请手动选择文本', 'error'));
}

function pickFrameData(data) {
  const result = {};
  for (const key of FRAME_KEYS) result[key] = data?.[key] || '';
  return result;
}

function exportJson() {
  if (!state.frames.length) return;
  const frames = state.frames.map((frame) => ({
    index: frame.index,
    time: Number(frame.time.toFixed(3)),
    timecode: formatClock(frame.time, true),
    ...pickFrameData(frame.data),
    _meta: {
      status: frame.status,
      latency_ms: frame.latencyMs,
      extract_ms: frame.extractMs,
      cached: frame.cached,
      mock: frame.mock,
      usage: frame.usage
    }
  }));

  const payload = {
    schema: FRAME_KEYS,
    model: state.mock ? 'mock' : state.job?.model || 'deepseek-flash',
    generated_at: new Date().toISOString(),
    video: {
      filename: state.file?.name || state.job?.meta?.filename || 'video',
      duration: state.job?.meta?.duration || dom.video.duration,
      width: state.job?.meta?.width,
      height: state.job?.meta?.height,
      fps: state.job?.meta?.fps
    },
    stats: state.stats,
    frames
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const base = (state.file?.name || 'video').replace(/\.[^.]+$/, '');
  link.download = `${base}-jiehua.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast('已导出固定键值对 JSON', 'success');
}

boot();

import http from 'node:http';

const PORT = Number(process.env.FAKE_PORT || 8795);
const LATENCY_MS = Number(process.env.FAKE_LATENCY_MS || 800);
const FAIL_ONCE = process.env.FAKE_FAIL_ONCE === '1';

const scenes = [
  {
    summary: '清晨地铁站内通勤人流',
    scene: '城市地铁站站厅，早高峰',
    people: '约十余名乘客，多穿深色通勤装，正走向闸机',
    objects: '闸机、悬挂指示牌、双肩包、手机',
    text: 'A 口 / 07:12 / 往人民广场',
    action: '乘客排队通过闸机进站',
    camera: '中景，平视，固定机位，轻微景深',
    lighting: '冷白荧光灯，整体偏青，清晨通勤氛围',
    details: '指示牌显示 07:12，最左侧乘客正在看手机'
  },
  {
    summary: '咖啡店内一杯拿铁放在木桌上',
    scene: '街角咖啡店靠窗座位，上午',
    people: '无人物，画面右侧可见一只手',
    objects: '白色陶瓷杯、拉花拿铁、木桌、菜单牌',
    text: 'LATTE / ¥28 / OPEN 08:00–20:00',
    action: '一只手正把咖啡杯放到桌面上',
    camera: '近景俯拍，浅景深，焦点在杯口拉花',
    lighting: '窗外自然侧光，暖色木纹，安静氛围',
    details: '拉花呈心形，杯沿有一道细小缺口，价签为 28 元'
  },
  {
    summary: '会议室屏幕展示季度目标',
    scene: '现代办公室会议室，白天',
    people: '两名员工坐在长桌旁，一人正指向屏幕',
    objects: '投影屏幕、笔记本电脑、白板、马克杯',
    text: 'Q4 目标 / 120% / 营收增长',
    action: '团队正在讨论季度业绩图表',
    camera: '全景，略低机位，屏幕位于画面中心',
    lighting: '顶部冷光与屏幕蓝光混合，商务氛围',
    details: '柱状图最后一项为 120%，白板右上角写着 10/28'
  },
  {
    summary: '公园草坪旁的禁止践踏提示牌',
    scene: '城市公园草坪边缘，傍晚',
    people: '远处有两名散步的行人',
    objects: '木质提示牌、草坪、银杏树、长椅',
    text: '请勿践踏草坪 / 爱护环境 人人有责',
    action: '行人在步道上缓慢散步',
    camera: '低机位中景，提示牌占据前景，背景虚化',
    lighting: '金色夕阳逆光，暖黄色调，树叶透光',
    details: '提示牌右下角有公园管理处的小字，路面落满黄叶'
  }
];

const stats = {
  requests: 0,
  attempts: 0,
  active: 0,
  maxConcurrent: 0,
  images: 0,
  totalImageBytes: 0,
  validationErrors: [],
  failInjected: 0
};

let failNext = FAIL_ONCE;

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function validate(body) {
  const errors = [];
  if (body.model !== 'deepseek-flash') errors.push(`model=${body.model}`);
  if (body.response_format?.type !== 'json_object') errors.push('response_format');
  if (body.thinking?.type !== 'disabled') errors.push('thinking');
  if (!(body.temperature <= 0.2)) errors.push('temperature');
  if (!(body.max_tokens >= 400)) errors.push('max_tokens');

  const system = body.messages?.[0];
  if (system?.role !== 'system' || !system.content.includes('JSON')) errors.push('system prompt');
  if (!system?.content.includes('summary') || !system?.content.includes('lighting')) errors.push('schema prompt');

  const user = body.messages?.[1];
  if (user?.role !== 'user' || !Array.isArray(user.content)) errors.push('user content');
  const text = user?.content?.find((part) => part.type === 'text')?.text || '';
  const image = user?.content?.find((part) => part.type === 'image_url')?.image_url;
  if (!/\d+\.\d+ 秒/.test(text)) errors.push('time prompt');
  if (!image?.url?.startsWith('data:image/jpeg;base64,')) {
    errors.push('image data url');
    return { errors, seconds: 0, imageBytes: 0 };
  }
  if (image.detail !== 'high' && image.detail !== 'low') errors.push('detail');
  const bytes = Buffer.from(image.url.split(',')[1], 'base64');
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) errors.push('not jpeg');
  if (bytes.length < 5000) errors.push('image too small');
  const seconds = Number((/([\d.]+) 秒/.exec(text) || [])[1] || 0);
  return { errors, seconds, imageBytes: bytes.length };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return json(res, 200, { ok: true, port: PORT, latencyMs: LATENCY_MS });
  }
  if (req.method === 'GET' && req.url === '/stats') {
    return json(res, 200, { ...stats, validationErrors: stats.validationErrors.slice(-5) });
  }
  if (req.method === 'POST' && req.url === '/reset') {
    stats.requests = 0;
    stats.attempts = 0;
    stats.active = 0;
    stats.maxConcurrent = 0;
    stats.images = 0;
    stats.totalImageBytes = 0;
    stats.validationErrors = [];
    stats.failInjected = 0;
    failNext = FAIL_ONCE;
    return json(res, 200, { ok: true });
  }
  if (req.method !== 'POST' || req.url !== '/chat/completions') {
    return json(res, 404, { error: { message: 'not found' } });
  }

  const raw = await readBody(req);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(res, 400, { error: { message: 'bad json' } });
  }

  stats.requests += 1;
  stats.attempts += 1;
  const check = validate(body);
  if (check.errors.length) {
    stats.validationErrors.push(check.errors.join(', '));
    return json(res, 400, { error: { message: `invalid request: ${check.errors.join(', ')}` } });
  }
  stats.images += 1;
  stats.totalImageBytes += check.imageBytes;

  if (failNext) {
    failNext = false;
    stats.failInjected += 1;
    return json(res, 429, { error: { message: 'fake rate limit (once)' } });
  }

  stats.active += 1;
  stats.maxConcurrent = Math.max(stats.maxConcurrent, stats.active);
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
  stats.active -= 1;

  const index = Math.min(scenes.length - 1, Math.floor((check.seconds / 12) * scenes.length));
  const data = {
    ...scenes[index],
    details: `${scenes[index].details}；抽帧时间 ${check.seconds.toFixed(2)}s`
  };

  json(res, 200, {
    id: `fake-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'deepseek-flash',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: JSON.stringify(data) },
        finish_reason: 'stop'
      }
    ],
    usage: {
      prompt_tokens: 1260,
      completion_tokens: 238,
      total_tokens: 1498,
      prompt_cache_hit_tokens: 320,
      prompt_cache_miss_tokens: 940,
      prompt_tokens_details: { cached_tokens: 320 }
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[fake-deepseek] http://127.0.0.1:${PORT} · latency=${LATENCY_MS}ms · failOnce=${FAIL_ONCE}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));

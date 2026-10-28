import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const APP_PORT = Number(process.env.TEST_APP_PORT || 8796);
const FAKE_PORT = Number(process.env.TEST_FAKE_PORT || 8795);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const FAKE = `http://127.0.0.1:${FAKE_PORT}`;
const FRAME_KEYS = ['summary', 'scene', 'people', 'objects', 'text', 'action', 'camera', 'lighting', 'details'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败：${message}`);
}

async function waitUrl(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      /* not up */
    }
    await sleep(150);
  }
  throw new Error(`${url} 未就绪`);
}

async function uploadDemo() {
  const buffer = await readFile(path.join(ROOT, 'public', 'samples', 'demo.mp4'));
  const response = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'video/mp4', 'X-File-Name': encodeURIComponent('demo.mp4') },
    body: buffer
  });
  const payload = await response.json();
  assert(response.status === 201, `上传失败 ${response.status}`);
  return payload.video;
}

async function run(videoId, { maxFrames = 6, quality = 'balanced', concurrency = 6 } = {}) {
  const started = Date.now();
  const response = await fetch(`${BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoId, options: { mode: 'keyframe', maxFrames, quality, concurrency } })
  });
  const payload = await response.json();
  assert(response.status === 202, `分析启动失败 ${response.status}：${JSON.stringify(payload)}`);

  const deadline = Date.now() + 60_000;
  let job = payload.job;
  while (Date.now() < deadline) {
    const stateResponse = await fetch(`${BASE}/api/jobs/${job.id}`);
    job = (await stateResponse.json()).job;
    if (['done', 'error', 'cancelled'].includes(job.status)) break;
    await sleep(120);
  }
  assert(job.status === 'done', `任务状态 ${job.status}：${job.error || ''}`);
  for (const frame of job.frames) {
    for (const key of FRAME_KEYS) {
      assert(typeof frame.data?.[key] === 'string' && frame.data[key].length > 0, `帧 ${frame.index} 缺少 ${key}`);
    }
  }
  return { job, wallMs: Date.now() - started };
}

async function main() {
  const dataDir = await mkdtemp(path.join(ROOT, 'data', 'test-upstream-'));
  const fake = spawn(process.execPath, ['scripts/fake-deepseek.mjs'], {
    cwd: ROOT,
    env: { ...process.env, FAKE_PORT: String(FAKE_PORT), FAKE_FAIL_ONCE: '1', FAKE_LATENCY_MS: '800' },
    stdio: 'inherit',
    windowsHide: true
  });

  const app = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      DATA_DIR: dataDir,
      DEEPSEEK_API_KEY: 'test-key-not-real',
      DEEPSEEK_BASE_URL: FAKE
    },
    stdio: 'inherit',
    windowsHide: true
  });

  try {
    await waitUrl(`${FAKE}/health`);
    const health = await waitUrl(`${BASE}/api/health`);
    assert(health.hasServerKey === true, '服务端应识别到测试 Key');

    const video = await uploadDemo();
    const first = await run(video.id, { maxFrames: 6, concurrency: 6 });
    const fakeStats1 = await (await fetch(`${FAKE}/stats`)).json();

    console.log('\n[upstream] first run', {
      frames: first.job.frames.length,
      wallMs: first.wallMs,
      serverMs: first.job.stats.elapsedMs,
      avgApiMs: first.job.stats.avgApiMs,
      tokens: [first.job.stats.promptTokens, first.job.stats.completionTokens],
      cost: first.job.stats.costCny,
      requests: fakeStats1.requests,
      attempts: fakeStats1.attempts,
      maxConcurrent: fakeStats1.maxConcurrent
    });

    assert(first.job.frames.length === 6, '应抽 6 帧');
    assert(first.job.stats.apiCalls === 6, `应有 6 次 API 调用，实际 ${first.job.stats.apiCalls}`);
    assert(first.job.stats.avgApiMs >= 700, `平均延迟异常：${first.job.stats.avgApiMs}`);
    assert(first.job.stats.costCny > 0, '成本应大于 0');
    assert(fakeStats1.requests === 7, `应发生 7 次请求（1 次 429 + 6 次成功），实际 ${fakeStats1.requests}`);
    assert(fakeStats1.failInjected === 1, '应注入一次 429');
    assert(fakeStats1.maxConcurrent >= 4, `并发未生效：max=${fakeStats1.maxConcurrent}`);
    assert(fakeStats1.validationErrors.length === 0, `请求结构不合法：${fakeStats1.validationErrors.join('; ')}`);

    const second = await run(video.id, { maxFrames: 6, concurrency: 6 });
    const fakeStats2 = await (await fetch(`${FAKE}/stats`)).json();
    console.log('[upstream] cached run', {
      wallMs: second.wallMs,
      cacheHits: second.job.stats.cacheHits,
      apiCalls: second.job.stats.apiCalls,
      fakeRequests: fakeStats2.requests
    });

    assert(second.job.stats.cacheHits === 6, `应有 6 次缓存命中，实际 ${second.job.stats.cacheHits}`);
    assert(second.job.stats.apiCalls === 0, '缓存命中时不应再调用 API');
    assert(second.job.stats.costCny === 0, `缓存命中不应计费，实际 ¥${second.job.stats.costCny}`);
    assert(second.job.stats.promptTokens === 0, '缓存命中不应重复累计 token');
    assert(fakeStats2.requests === fakeStats1.requests, '第二次任务不应产生新的上游请求');
    assert(second.wallMs < first.wallMs, '缓存任务应明显更快');

    const image = await fetch(`${BASE}${first.job.frames[0].url}`);
    const bytes = Buffer.from(await image.arrayBuffer());
    assert(image.status === 200 && bytes.length > 5000, '帧图片不可读');

    console.log('[upstream] PASS');
    console.log(
      JSON.stringify(
        {
          firstWallMs: first.wallMs,
          firstServerMs: first.job.stats.elapsedMs,
          avgApiMs: first.job.stats.avgApiMs,
          parallelMax: fakeStats1.maxConcurrent,
          retryRequests: fakeStats1.requests,
          secondWallMs: second.wallMs,
          cacheHits: second.job.stats.cacheHits,
          tokens: [first.job.stats.promptTokens, first.job.stats.completionTokens],
          costCny: first.job.stats.costCny
        },
        null,
        2
      )
    );
  } finally {
    fake.kill();
    app.kill();
    await sleep(400);
    const resolved = path.resolve(dataDir);
    if (resolved.startsWith(path.join(ROOT, 'data') + path.sep)) {
      await rm(resolved, { recursive: true, force: true }).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error('\n[upstream] FAIL', error);
  process.exitCode = 1;
});

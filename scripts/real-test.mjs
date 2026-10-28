import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.TEST_PORT || 8794);
const BASE = `http://127.0.0.1:${PORT}`;

async function loadDotEnvKey() {
  if ((process.env.DEEPSEEK_API_KEY || '').trim()) return;
  try {
    const text = await readFile(path.join(ROOT, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*DEEPSEEK_API_KEY\s*=\s*(.+?)\s*$/.exec(line);
      if (match) {
        process.env.DEEPSEEK_API_KEY = match[1].replace(/^["']|["']$/g, '');
        return;
      }
    }
  } catch {
    /* .env is optional */
  }
}

await loadDotEnvKey();
const KEY = (process.env.DEEPSEEK_API_KEY || '').trim();
const FRAME_KEYS = ['summary', 'scene', 'people', 'objects', 'text', 'action', 'camera', 'lighting', 'details'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败：${message}`);
}

async function waitForHealth(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return response.json();
    } catch {
      /* not up */
    }
    await sleep(150);
  }
  throw new Error('服务没有启动');
}

async function uploadDemo() {
  const buffer = await readFile(path.join(ROOT, 'public', 'samples', 'demo.mp4'));
  const response = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'video/mp4', 'X-File-Name': encodeURIComponent('jiehua-demo.mp4') },
    body: buffer
  });
  const payload = await response.json();
  assert(response.status === 201, `上传失败 ${response.status}`);
  return payload.video;
}

async function runJob(videoId, { quality, maxFrames, concurrency = 12 }) {
  const started = Date.now();
  const response = await fetch(`${BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoId,
      options: { mode: 'keyframe', maxFrames, quality, concurrency }
    })
  });
  const payload = await response.json();
  assert(response.status === 202, `分析启动失败 ${response.status}：${JSON.stringify(payload)}`);

  const deadline = Date.now() + 120_000;
  let job = payload.job;
  while (Date.now() < deadline) {
    const stateResponse = await fetch(`${BASE}/api/jobs/${job.id}`);
    const statePayload = await stateResponse.json();
    job = statePayload.job;
    if (['done', 'error', 'cancelled'].includes(job.status)) break;
    await sleep(200);
  }
  assert(job.status === 'done', `任务状态 ${job.status}：${job.error || ''}`);
  assert(job.frames.every((frame) => frame.status === 'done'), '存在失败帧');

  for (const frame of job.frames) {
    for (const key of FRAME_KEYS) {
      assert(typeof frame.data?.[key] === 'string' && frame.data[key].length > 0, `帧 ${frame.index} 缺少 ${key}`);
    }
  }

  return {
    quality,
    frames: job.frames.length,
    wallMs: Date.now() - started,
    serverElapsedMs: job.stats.elapsedMs,
    extractionMs: job.stats.extractMsTotal,
    avgApiMs: job.stats.avgApiMs,
    cacheHits: job.stats.cacheHits,
    promptTokens: job.stats.promptTokens,
    completionTokens: job.stats.completionTokens,
    cachedTokens: job.stats.cachedTokens,
    costCny: Number(job.stats.costCny.toFixed(6)),
    perFrame: job.frames.map((frame) => ({
      t: Number(frame.time.toFixed(2)),
      ms: frame.latencyMs,
      cached: frame.cached,
      summary: frame.data.summary
    }))
  };
}

async function main() {
  if (!KEY) {
    console.error('请先设置 DEEPSEEK_API_KEY，例如：');
    console.error('  $env:DEEPSEEK_API_KEY="sk-..." ; node scripts/real-test.mjs');
    process.exitCode = 2;
    return;
  }

  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DEEPSEEK_API_KEY: KEY },
    stdio: 'inherit',
    windowsHide: true
  });

  try {
    const health = await waitForHealth();
    console.log(`\n[real] server ready · model=${health.model}`);
    const video = await uploadDemo();
    console.log(`[real] demo uploaded · ${(video.size / 1024).toFixed(0)} KB`);

    const results = [];
    for (const [quality, maxFrames] of [
      ['fast', 4],
      ['balanced', 4],
      ['detail', 4]
    ]) {
      console.log(`\n[real] ${quality} · ${maxFrames} frames …`);
      const result = await runJob(video.id, { quality, maxFrames, concurrency: 8 });
      results.push(result);
      console.log(
        `[real] ${quality} wall=${(result.wallMs / 1000).toFixed(2)}s ` +
          `avgAPI=${result.avgApiMs}ms tokens=${result.promptTokens}/${result.completionTokens} ` +
          `cost=¥${result.costCny.toFixed(6)}`
      );
      for (const frame of result.perFrame) {
        console.log(`       ${String(frame.t).padStart(6)}s  ${String(frame.ms).padStart(5)}ms  ${frame.summary}`);
      }
    }

    console.log('\n[real] 10-frame balanced parallel run …');
    const parallel = await runJob(video.id, { quality: 'balanced', maxFrames: 10, concurrency: 12 });
    console.log(
      `[real] parallel wall=${(parallel.wallMs / 1000).toFixed(2)}s ` +
        `avgAPI=${parallel.avgApiMs}ms cache=${parallel.cacheHits} ` +
        `cost=¥${parallel.costCny.toFixed(6)}`
    );

    console.log('\n[real] PASS');
    console.log(JSON.stringify({ health, results, parallel }, null, 2));
  } finally {
    server.kill();
    await sleep(300);
  }
}

main().catch((error) => {
  console.error('\n[real] FAIL', error);
  process.exitCode = 1;
});

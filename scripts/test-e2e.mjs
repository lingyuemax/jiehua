import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.TEST_PORT || 8791);
const BASE = `http://127.0.0.1:${PORT}`;
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

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败：${message}`);
}

async function waitForHealth(timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return response.json();
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('服务没有在预期时间内启动');
}

async function uploadDemo() {
  const buffer = await readFile(path.join(ROOT, 'public', 'samples', 'demo.mp4'));
  const started = performance.now();
  const response = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'video/mp4',
      'X-File-Name': encodeURIComponent('jiehua-demo.mp4')
    },
    body: buffer
  });
  const payload = await response.json();
  assert(response.status === 201, `上传应返回 201，实际 ${response.status}`);
  assert(payload.video?.id, '上传结果里没有 video.id');
  return { video: payload.video, uploadMs: Math.round(performance.now() - started), bytes: buffer.length };
}

async function analyze(videoId) {
  const started = performance.now();
  const response = await fetch(`${BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoId,
      mock: true,
      options: { mode: 'keyframe', maxFrames: 10, quality: 'balanced', concurrency: 12 }
    })
  });
  const payload = await response.json();
  assert(response.status === 202, `分析应返回 202，实际 ${response.status}：${JSON.stringify(payload)}`);
  return { job: payload.job, requestMs: Math.round(performance.now() - started) };
}

async function waitForJob(jobId, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const response = await fetch(`${BASE}/api/jobs/${jobId}`);
    const payload = await response.json();
    last = payload.job;
    if (['done', 'error', 'cancelled'].includes(last.status)) return last;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`任务超时，最后状态：${last?.status}`);
}

async function checkFrameImage(frame) {
  assert(frame.url, `第 ${frame.index} 帧没有 url`);
  const response = await fetch(`${BASE}${frame.url}`);
  assert(response.status === 200, `帧图片 ${frame.index} 返回 ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert(bytes.length > 1000, `帧图片 ${frame.index} 太小：${bytes.length}`);
  assert(bytes[0] === 0xff && bytes[1] === 0xd8, `帧图片 ${frame.index} 不是 JPEG`);
  return bytes.length;
}

async function main() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DEEPSEEK_API_KEY: '' },
    stdio: 'inherit',
    windowsHide: true
  });

  try {
    const health = await waitForHealth();
    console.log(`\n[test] server ready · model=${health.model}`);

    const upload = await uploadDemo();
    console.log(
      `[test] upload ok · ${(upload.bytes / 1024).toFixed(0)} KB in ${upload.uploadMs} ms · id=${upload.video.id}`
    );

    const { job, requestMs } = await analyze(upload.video.id);
    console.log(`[test] job accepted in ${requestMs} ms · id=${job.id}`);
    const final = await waitForJob(job.id);

    assert(final.status === 'done', `任务状态应为 done，实际 ${final.status}：${final.error || ''}`);
    assert(final.frames.length === 10, `应抽 10 帧，实际 ${final.frames.length}`);
    assert(final.frames.every((frame) => frame.status === 'done'), '存在未完成的帧');

    const times = final.frames.map((frame) => frame.time);
    assert(
      times.every((time, index) => index === 0 || time > times[index - 1]),
      '关键帧时间没有严格递增'
    );
    assert(final.meta.duration > 11.9 && final.meta.duration < 12.1, `视频时长异常：${final.meta.duration}`);
    assert(final.meta.width === 1280 && final.meta.height === 720, '视频尺寸异常');

    const imageSizes = [];
    for (const frame of final.frames) {
      for (const key of FRAME_KEYS) {
        assert(typeof frame.data?.[key] === 'string' && frame.data[key].length > 0, `第 ${frame.index} 帧缺少 ${key}`);
      }
      imageSizes.push(await checkFrameImage(frame));
    }

    assert(final.stats.framesDone === 10, `stats.framesDone 应为 10，实际 ${final.stats.framesDone}`);
    assert(final.stats.costCny === 0, 'mock 任务不应产生费用');

    const page = await fetch(`${BASE}/`);
    assert(page.status === 200, `首页返回 ${page.status}`);
    const html = await page.text();
    assert(html.includes('解画'), '首页内容不正确');

    const summary = {
      ok: true,
      model: health.model,
      duration: final.meta.duration,
      frames: final.frames.length,
      times: final.frames.map((frame) => Number(frame.time.toFixed(2))),
      totalMs: final.stats.elapsedMs,
      extractionMs: final.stats.extractMsTotal,
      avgFrameBytes: Math.round(imageSizes.reduce((a, b) => a + b, 0) / imageSizes.length),
      imageSizeRange: [Math.min(...imageSizes), Math.max(...imageSizes)],
      firstSummary: final.frames[0].data.summary,
      lastSummary: final.frames.at(-1).data.summary
    };
    console.log(`[test] PASS ${JSON.stringify(summary, null, 2)}`);
  } finally {
    server.kill();
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

main().catch((error) => {
  console.error('\n[test] FAIL', error);
  process.exitCode = 1;
});

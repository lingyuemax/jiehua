import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, '.screenshots');
const PORT = 9333;
const URL = process.env.UI_URL || 'http://127.0.0.1:8787/?sample=1&mock=1';
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);
const CHROME = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败：${message}`);
}

async function waitForJson(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const pages = await response.json();
      const page = pages.find((item) => item.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error('Chrome DevTools 没有启动');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let nextId = 1;

    ws.onopen = () => {
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          ws.send(JSON.stringify({ id, method, params }));
          return new Promise((res, rej) => pending.set(id, { res, rej }));
        },
        close() {
          ws.close();
        }
      });
    };
    ws.onerror = (error) => reject(error);
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.rej(new Error(message.error.message));
      else entry.res(message.result);
    };
  });
}

async function evaluate(client, expression, awaitPromise = false) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || '页面脚本执行失败');
  }
  return result.result.value;
}

async function waitFor(client, expression, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(client, expression)) return true;
    await sleep(250);
  }
  throw new Error(`页面等待超时：${expression}`);
}

async function screenshot(client, name) {
  const result = await client.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(SHOTS, name);
  await writeFile(file, Buffer.from(result.data, 'base64'));
  return file;
}

async function main() {
  if (!CHROME) {
    throw new Error('没有找到 Chrome/Edge，请设置 CHROME_PATH 环境变量后重试');
  }
  await mkdir(SHOTS, { recursive: true });
  const profile = path.join(SHOTS, `chrome-cdp-${Date.now()}`);
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--autoplay-policy=no-user-gesture-required',
      '--window-size=1440,1000',
      `--remote-debugging-port=${PORT}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${profile}`,
      URL
    ],
    { stdio: 'ignore', windowsHide: true }
  );

  let client;
  try {
    const page = await waitForJson();
    client = await connect(page.webSocketDebuggerUrl);
    await client.send('Page.enable');
    await client.send('Runtime.enable');

    await waitFor(
      client,
      `document.querySelectorAll('.frame-row').length >= 10 && document.querySelector('#statFrames')?.textContent?.includes('10 / 10')`,
      35_000
    );
    await sleep(600);

    const doneState = await evaluate(
      client,
      `({
        rows: document.querySelectorAll('.frame-row').length,
        frames: document.querySelector('#statFrames').textContent.trim(),
        elapsed: document.querySelector('#statElapsed').textContent.trim(),
        summary: document.querySelector('.card-head h3')?.textContent.trim(),
        api: document.querySelector('#apiText').textContent.trim()
      })`
    );
    console.log('[ui] completed', doneState);
    assert(doneState.rows === 10, '应显示 10 条帧记录');
    assert(doneState.frames.includes('10 / 10'), '统计栏应显示 10 / 10');
    const shot1 = await screenshot(client, 'ui-complete.png');
    console.log('[ui] screenshot', shot1);

    // Seek into the office scene and start playback. The right panel must follow.
    await evaluate(
      client,
      `(() => {
        const video = document.querySelector('video');
        video.currentTime = 7.2;
        return video.play().then(() => true);
      })()`,
      true
    );
    await sleep(650);

    const playingState = await evaluate(
      client,
      `({
        time: Number(document.querySelector('video').currentTime.toFixed(2)),
        paused: document.querySelector('video').paused,
        summary: document.querySelector('.card-head h3')?.textContent.trim(),
        active: document.querySelector('.thumb.active')?.dataset.frame,
        sync: document.querySelector('#syncState').textContent.trim()
      })`
    );
    console.log('[ui] playing', playingState);
    assert(!playingState.paused, '视频应处于播放状态');
    assert(playingState.time > 7.1 && playingState.time < 9, `播放时间异常：${playingState.time}`);
    assert(playingState.summary?.includes('会议'), `右侧未同步到会议场景：${playingState.summary}`);
    assert(playingState.sync.includes('跟随播放'), '播放状态应显示跟随播放');
    const shot2 = await screenshot(client, 'ui-playing.png');
    console.log('[ui] screenshot', shot2);

    // Click the first frame row: player + panel should jump back.
    await evaluate(client, `document.querySelector('.frame-row[data-row="0"]').click()`);
    await sleep(550);
    const seekState = await evaluate(
      client,
      `({
        time: Number(document.querySelector('video').currentTime.toFixed(2)),
        summary: document.querySelector('.card-head h3')?.textContent.trim(),
        active: document.querySelector('.thumb.active')?.dataset.frame
      })`
    );
    console.log('[ui] seek back', seekState);
    assert(seekState.time < 1.5, `点击首帧后时间应回到 0 附近：${seekState.time}`);
    assert(seekState.summary?.includes('地铁'), `首帧描述应回到地铁场景：${seekState.summary}`);

    console.log('[ui] PASS');
  } finally {
    if (client) client.close();
    chrome.kill();
    await sleep(300);
  }
}

main().catch((error) => {
  console.error('[ui] FAIL', error);
  process.exitCode = 1;
});

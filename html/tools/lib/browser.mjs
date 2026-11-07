// Headless-Chrome harness shared by the browser checks (tools/dapp-check.mjs,
// tools/arena-check.mjs). It serves the repo over HTTP, drives Chrome through the
// DevTools Protocol, and can give a page a stand-in for MetaMask wired to a local chain.
//
// Deliberately dependency-free: Node's global WebSocket and fetch are enough, so the
// checks run from a clean clone with nothing installed at the repo root.
import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The DevTools Protocol runs over a WebSocket, and `WebSocket` only became a global in
 * Node 22. On Node 20 it exists behind a flag, so rather than making the reader discover
 * that from a ReferenceError, the check re-runs itself once with the flag set.
 *
 * Call this as the first statement of a check script, passing `import.meta.url`.
 */
export function ensureWebSocket(metaUrl) {
  if (typeof WebSocket !== 'undefined') return;
  const r = spawnSync(process.execPath, ['--experimental-websocket', fileURLToPath(metaUrl), ...process.argv.slice(2)],
    { stdio: 'inherit' });
  if (r.error) {
    console.error('Cần Node 22+ (hoặc Node 20 với --experimental-websocket) để chạy kiểm thử trình duyệt.');
    process.exit(1);
  }
  process.exit(r.status ?? 1);
}

export const CHROMES = [
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
               '.png': 'image/png', '.webp': 'image/webp', '.css': 'text/css', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8' };

/** Static file server rooted at `root`. Resolves to { srv, port }. */
export function serve(root) {
  const srv = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    // Serve a directory's index.html, the way python -m http.server does, so a page that
    // lives in a sub-directory (admin/) is reachable at the same URL in the check as in
    // real use. Without this the navigation fails and every later step times out on a
    // chrome-error: page instead of saying what went wrong.
    let relPath = path === '/' ? '/index.html' : (path.endsWith('/') ? path + 'index.html' : path);
    let file = resolve(root, '.' + relPath);
    try {
      let body;
      try { body = await readFile(file); }
      catch { file = resolve(root, '.' + path + '/index.html'); body = await readFile(file); }
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, port: srv.address().port })));
}

export async function launchChrome({ window = '1440,1000' } = {}) {
  const exe = CHROMES.find((p) => existsSync(p));
  if (!exe) throw new Error('không tìm thấy Chrome/Chromium trên máy này');
  const profile = await mkdtemp(join(tmpdir(), 'squeek-cdp-'));
  const proc = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', `--window-size=${window}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  // Kill Chrome and drop its throwaway profile when the check exits; without this every run
  // left a ~60 MB squeek-* folder in %TEMP% (114 of them had piled up to 6.6 GB).
  process.once('exit', () => {
    // On Windows proc.kill() only ends the parent; its GPU/renderer children keep the profile
    // locked, so take down the whole tree before deleting.
    try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); else proc.kill(); } catch {}
    // The tree takes a moment to release its file locks (rmSync's own maxRetries does not cover it).
    for (let t = Date.now(); existsSync(profile) && Date.now() - t < 5000;) {
      try { rmSync(profile, { recursive: true, force: true }); } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); }
    }
  });
  const wsUrl = await new Promise((ok, fail) => {
    let b = '';
    const t = setTimeout(() => fail(new Error('Chrome không mở được cổng DevTools')), 30000);
    proc.stderr.on('data', (d) => { b += d; const m = b.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); ok(m[1]); } });
  });
  return { proc, wsUrl, exe };
}

export class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = [];
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id); this.pending.delete(msg.id);
        msg.error ? p.fail(new Error(msg.error.message)) : p.ok(msg.result);
      } else if (msg.method) for (const h of this.handlers) h(msg);
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((ok, fail) => this.pending.set(id, { ok, fail }));
  }
}

/** In-page stand-in for MetaMask (EIP-1193) bound to one unlocked account of a local chain. */
export const walletShim = (account, rpcUrl) => `(() => {
  const listeners = {};
  window.ethereum = {
    isMetaMask: true,
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    removeListener() {},
    async request({ method, params }) {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return ['${account}'];
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
      const r = await fetch('${rpcUrl}', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params: params || [] }) });
      const j = await r.json();
      if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; }
      return j.result;
    },
  };
})();`;

/**
 * In-page MetaMask stand-in for a wallet IMPORTED BY PRIVATE KEY (any chain, e.g. Sepolia).
 * The page only sees window.ethereum; every request goes through a DevTools binding to Node,
 * where `handle` signs and sends it — the key never enters the page. Like MetaMask, the
 * wallet approves whatever the page asks for (the test plays the person clicking "Confirm").
 */
export const keyWalletShim = (address, chainIdHex) => `(() => {
  const listeners = {}, pending = {};
  let n = 0;
  window.__squeekWalletReply = (id, err, result) => {
    const p = pending[id]; if (!p) return; delete pending[id];
    if (err) { const e = new Error(err.message); e.code = err.code; e.data = err.data; p.fail(e); } else p.ok(result);
  };
  window.ethereum = {
    isMetaMask: true, selectedAddress: '${address}', chainId: '${chainIdHex}',
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    removeListener() {},
    request({ method, params }) {
      return new Promise((ok, fail) => {
        const id = ++n; pending[id] = { ok, fail };
        window.__squeekWallet(JSON.stringify({ id, method, params: params || [] }));
      });
    },
  };
})();`;

/** Node side of keyWalletShim: answers one EIP-1193 request with an ethers Wallet. */
export function keyWalletHandler(wallet, provider, chainId, log = () => {}) {
  const hexChain = '0x' + Number(chainId).toString(16);
  return async (method, params) => {
    const me = (await wallet.getAddress()).toLowerCase();
    switch (method) {
      case 'eth_requestAccounts': case 'eth_accounts': return [me];
      case 'eth_chainId': return hexChain;
      case 'net_version': return String(chainId);
      case 'wallet_switchEthereumChain': case 'wallet_addEthereumChain': return null;
      case 'eth_sendTransaction': {
        const t = params[0];
        const req = { to: t.to, data: t.data, value: t.value ? BigInt(t.value) : 0n };
        // MetaMask adds headroom to its own estimate when the dapp does not set a limit
        req.gasLimit = t.gas ? BigInt(t.gas) : ((await provider.estimateGas({ ...req, from: me })) * 12n) / 10n;
        const tx = await wallet.sendTransaction(req);
        log(`wallet: ${t.data ? t.data.slice(0, 10) : 'transfer'} -> ${tx.hash}`);
        return tx.hash;
      }
      case 'personal_sign': return wallet.signMessage(typeof params[0] === 'string' && params[0].startsWith('0x') ? (await import('../../src/vendor/ethers.min.js')).ethers.getBytes(params[0]) : params[0]);
      default: return provider.send(method, params);
    }
  };
}

/**
 * Start the server and the browser together.
 *
 * `openPage(url, account, errors)` returns the page driver: `ev` evaluates an expression,
 * `waitFor` polls one until it is truthy, `click`/`clickAt` act on the real DOM, `shot`
 * saves a screenshot when `shots` is set. Page exceptions and console errors are pushed
 * into the `errors` array the caller passes, so a check never silently ignores them.
 */
export async function startBrowser({ root, shots = null, rpcUrl = 'http://127.0.0.1:8545' }) {
  const { srv, port } = await serve(root);
  const { proc, wsUrl } = await launchChrome();
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  const cdp = new Cdp(ws);

  async function openPage(url, account, errors = []) {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p) => cdp.send(m, p, sessionId);
    cdp.handlers.push((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Runtime.exceptionThrown')
        errors.push('exception: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).split('\n')[0]);
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error')
        errors.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').split('\n')[0]);
    });
    await s('Runtime.enable');
    await s('Page.enable');
    await s('Network.enable').catch(() => {});
    await s('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {});
    if (account && typeof account === 'object') {
      // { address, chainId, handle(method, params) }: a wallet imported by key (see keyWalletShim)
      await s('Runtime.addBinding', { name: '__squeekWallet' });
      cdp.handlers.push(async (msg) => {
        if (msg.sessionId !== sessionId || msg.method !== 'Runtime.bindingCalled' || msg.params.name !== '__squeekWallet') return;
        const { id, method, params } = JSON.parse(msg.params.payload);
        let err = null, result = null;
        try { result = await account.handle(method, params); }
        catch (e) { err = { message: e.shortMessage || e.message, code: e.code === 'CALL_EXCEPTION' ? 3 : (typeof e.code === 'number' ? e.code : -32000), data: e.data || e.info?.error?.data }; }
        await s('Runtime.evaluate', { expression: `window.__squeekWalletReply(${id}, ${JSON.stringify(err)}, ${JSON.stringify(result)})`,
                                      contextId: msg.params.executionContextId }).catch(() => {});
      });
      await s('Page.addScriptToEvaluateOnNewDocument', { source: keyWalletShim(account.address, '0x' + Number(account.chainId).toString(16)) });
      if (account.init) await s('Page.addScriptToEvaluateOnNewDocument', { source: account.init });
    } else if (account) await s('Page.addScriptToEvaluateOnNewDocument', { source: walletShim(account, rpcUrl) });
    await s('Page.navigate', { url });
    const ev = async (expression) => {
      const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const waitFor = async (expr, ms = 30000, what = expr) => {
      const t = Date.now();
      while (Date.now() - t < ms) { try { if (await ev(expr)) return; } catch { /* page still loading */ } await sleep(250); }
      throw new Error('timeout waiting for ' + what);
    };
    const click = async (id) => {
      await waitFor(`!!document.getElementById('${id}') && !document.getElementById('${id}').disabled`, 30000, `#${id} enabled`);
      await ev(`document.getElementById('${id}').click()`);
    };
    const clickAt = async (x, y) => {
      for (const type of ['mousePressed', 'mouseReleased'])
        await s('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    };
    const shot = async (name) => {
      if (!shots) return;
      await mkdir(shots, { recursive: true });
      const { data } = await s('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(shots, name + '.png'), Buffer.from(data, 'base64'));
    };
    return { ev, waitFor, click, clickAt, shot, session: s, close: () => cdp.send('Target.closeTarget', { targetId }) };
  }

  return {
    cdp, openPage, base: `http://127.0.0.1:${port}`,
    close() { try { ws.close(); } catch {} proc.kill(); srv.close(); },
  };
}

/** Minimal JSON-RPC helper for talking to the chain directly from the check. */
export const rpcOn = (url) => async (method, params = []) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
};

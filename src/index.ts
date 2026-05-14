import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { clearCredentialsFile, getZaloApi, resetZaloApi, triggerQRLogin } from './zalo/client.js';
import { restoreCredsFromFirebase } from './zalo/credentials-store.js';
import type { ZaloAPI } from './zalo/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DASHBOARD_HTML = path.join(PROJECT_ROOT, 'quickmsg-teacher.html');

type LoginPhase = 'idle' | 'starting' | 'qr_ready' | 'scanned' | 'success' | 'error';
type ThreadTypeNum = 0 | 1;

interface LoginState {
  inProgress: boolean;
  phase: LoginPhase;
  message: string;
  qrImagePath?: string;
}

const loginState: LoginState = {
  inProgress: false,
  phase: 'idle',
  message: 'Chưa đăng nhập.',
};

let listenerApi: ZaloAPI | null = null;

function startListener(api: ZaloAPI): void {
  if (listenerApi === api) return;
  if (listenerApi) {
    try { listenerApi.listener.stop(); } catch { /* ignore */ }
  }
  listenerApi = api;
  api.listener.on('message', (msg: unknown) => {
    console.log('[ZaloEvent] message', JSON.stringify(msg));
  });
  api.listener.on('undo', (event: unknown) => {
    console.log('[ZaloEvent] undo', JSON.stringify(event));
  });
  api.listener.on('reaction', (event: unknown) => {
    console.log('[ZaloEvent] reaction', JSON.stringify(event));
  });
  api.listener.on('group_event', (event: unknown) => {
    console.log('[ZaloEvent] group_event', JSON.stringify(event));
  });
  api.listener.start();
  console.log('[Boot] Zalo listener started');
}

function stopListener(): void {
  if (!listenerApi) return;
  try { listenerApi.listener.stop(); } catch { /* ignore */ }
  listenerApi = null;
}

function requireApiKey(req: IncomingMessage, res: ServerResponse): boolean {
  const key = req.headers['x-api-key'];
  if (key !== config.apiKey) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
    return false;
  }
  return true;
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function loginPageHtml(state: LoginState): string {
  const qrBlock = state.qrImagePath
    ? '<img src="/login/qr" alt="Zalo QR" style="max-width:340px;border:1px solid #ddd;border-radius:8px;" />'
    : '<p>Đang tạo QR...</p>';

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="3" />
  <title>Zalo Login</title>
  <script>if('${state.phase}'==='success')window.location.replace('/dashboard');</script>
</head>
<body style="font-family:ui-sans-serif,system-ui;padding:24px;">
  <h2>Zalo Login</h2>
  <p><b>Trạng thái:</b> ${state.phase}</p>
  <p>${state.message}</p>
  ${state.phase === 'qr_ready' || state.phase === 'scanned' ? qrBlock : ''}
  <hr />
  <form method="post" action="/login/start">
    <button type="submit" ${state.inProgress ? 'disabled' : ''}>Bắt đầu đăng nhập QR</button>
  </form>
  <p>Trang tự refresh mỗi 3 giây.</p>
</body>
</html>`;
}

async function ensureLoggedInApi(): Promise<ZaloAPI> {
  const api = await getZaloApi();
  startListener(api);
  return api;
}

function parseThreadType(v: unknown): ThreadTypeNum {
  if (v === 1 || v === '1' || v === 'group') return 1;
  return 0;
}

async function handleProtectedApi(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  if (!requireApiKey(req, res)) return;

  let body: Record<string, unknown> = {};
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
    return;
  }

  let api: ZaloAPI;
  try {
    api = await ensureLoggedInApi();
  } catch (err) {
    sendJson(res, 401, { ok: false, error: String(err) });
    return;
  }

  try {
    if (pathname === '/sendMessage') {
      const threadId = String(body.threadId ?? '');
      if (!threadId) return sendJson(res, 400, { ok: false, error: 'threadId is required' });
      const threadType = parseThreadType(body.threadType);
      const payload = (body.payload ?? body.message ?? body.data) as Record<string, unknown> | undefined;
      if (!payload || typeof payload !== 'object') {
        return sendJson(res, 400, { ok: false, error: 'payload object is required' });
      }
      const result = await api.sendMessage(payload, threadId, threadType);
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === '/sendLink') {
      const threadId = String(body.threadId ?? '');
      const threadType = parseThreadType(body.threadType);
      const msg = String(body.msg ?? '');
      const link = String(body.link ?? '');
      const result = await api.sendLink({ msg, link }, threadId, threadType);
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === '/sendVoice') {
      const threadId = String(body.threadId ?? '');
      const threadType = parseThreadType(body.threadType);
      const voiceUrl = String(body.voiceUrl ?? '');
      const result = await api.sendVoice({ voiceUrl }, threadId, threadType);
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === '/sendVideo') {
      const threadId = String(body.threadId ?? '');
      const threadType = parseThreadType(body.threadType);
      const payload = (body.payload ?? {}) as Record<string, unknown>;
      const result = await api.sendVideo(payload, threadId, threadType);
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === '/undo') {
      const threadId = String(body.threadId ?? '');
      const threadType = parseThreadType(body.threadType);
      const msgId = body.msgId as string | number | undefined;
      if (msgId === undefined) return sendJson(res, 400, { ok: false, error: 'msgId is required' });
      const cliMsgId = (body.cliMsgId as string | number | undefined) ?? 0;
      const result = await api.undo({ msgId, cliMsgId }, threadId, threadType);
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === '/addReaction') {
      const icon = String(body.icon ?? '');
      const threadId = String(body.threadId ?? '');
      const threadType = parseThreadType(body.threadType);
      const msgId = String(body.msgId ?? '');
      const cliMsgId = String(body.cliMsgId ?? '');
      const result = await api.addReaction(
        { rType: 0, source: 0, icon },
        { data: { msgId, cliMsgId }, threadId, type: threadType },
      );
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === '/createPoll') {
      const threadId = String(body.threadId ?? '');
      const payload = (body.payload ?? {}) as Record<string, unknown>;
      const result = await api.createPoll(payload, threadId);
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === '/votePoll') {
      const pollId = Number(body.pollId);
      const optionIds = (body.optionIds ?? body.optionId) as number[] | number;
      const result = await api.votePoll(pollId, optionIds);
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === '/lockPoll') {
      const pollId = Number(body.pollId);
      const result = await api.lockPoll(pollId);
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === '/getPollDetail') {
      const pollId = Number(body.pollId);
      const result = await api.getPollDetail(pollId);
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === '/findUser') {
      const query = String(body.query ?? body.phone ?? '');
      const result = await api.findUser(query);
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === '/getUserInfo') {
      const userId = (body.userId ?? body.userIds) as string | string[];
      const result = await api.getUserInfo(userId);
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === '/getAllFriends') {
      const result = await api.getAllFriends();
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === '/getAllGroups') {
      const result = await api.getAllGroups();
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === '/getGroupInfo') {
      const groupId = (body.groupId ?? body.groupIds) as string | string[];
      const result = await api.getGroupInfo(groupId);
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === '/sendFriendRequest') {
      const userId = String(body.userId ?? '');
      const message = String(body.message ?? 'Xin chào!');
      const result = await api.sendFriendRequest(message, userId);
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === '/getFriendRequestStatus') {
      const userId = String(body.userId ?? '');
      const result = await api.getFriendRequestStatus(userId);
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === '/joinGroupLink') {
      const link = String(body.link ?? '');
      const result = await api.joinGroupLink(link);
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === '/leaveGroup') {
      const groupId = String(body.groupId ?? '');
      const result = await api.leaveGroup(groupId);
      return sendJson(res, 200, { ok: true, data: result });
    }

    if (pathname === '/uploadAttachment') {
      const files = body.files as string[] | string | undefined;
      const threadId = String(body.threadId ?? '');
      const threadType = parseThreadType(body.threadType);
      if (!files) return sendJson(res, 400, { ok: false, error: 'files is required' });
      const result = await api.uploadAttachment(files, threadId, threadType);
      return sendJson(res, 200, { ok: true, data: result });
    }

    return sendJson(res, 404, { ok: false, error: 'Unknown endpoint' });
  } catch (err) {
    console.error('[API] Error at', pathname, err);
    sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

async function startQrLogin(): Promise<void> {
  if (loginState.inProgress) return;
  loginState.inProgress = true;
  loginState.phase = 'starting';
  loginState.message = 'Đang tạo QR...';
  loginState.qrImagePath = undefined;

  try {
    const api = await triggerQRLogin({
      onQRReady: async (imagePath) => {
        loginState.phase = 'qr_ready';
        loginState.message = 'Đã tạo QR. Vui lòng quét bằng app Zalo.';
        loginState.qrImagePath = imagePath;
      },
      onExpired: async () => {
        loginState.phase = 'starting';
        loginState.message = 'QR đã hết hạn, đang tạo QR mới...';
      },
      onScanned: async (displayName) => {
        loginState.phase = 'scanned';
        loginState.message = `Đã quét QR bởi ${displayName}, đang chờ xác nhận...`;
      },
      onDeclined: async () => {
        loginState.phase = 'error';
        loginState.message = 'Đăng nhập bị từ chối trên điện thoại.';
      },
      onSuccess: async () => {
        loginState.phase = 'success';
        loginState.message = 'Đăng nhập thành công.';
      },
    });
    startListener(api);
    loginState.phase = 'success';
    loginState.message = 'Đăng nhập thành công.';
  } catch (err) {
    loginState.phase = 'error';
    loginState.message = `Đăng nhập thất bại: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    loginState.inProgress = false;
  }
}

function publicEndpoints(pathname: string): boolean {
  return pathname === '/' || pathname === '/health' || pathname.startsWith('/login');
}

async function requestHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  if (pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: 'zalo-webservice' });
  }

  if (pathname === '/') {
    return sendJson(res, 200, {
      ok: true,
      service: 'zalo-webservice',
      loginUrl: '/login',
      protectedApi: 'Use x-api-key header',
    });
  }

  if (pathname === '/login' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(loginPageHtml(loginState));
    return;
  }

  if (pathname === '/login/state' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, data: loginState });
  }

  if (pathname === '/login/qr' && req.method === 'GET') {
    if (!loginState.qrImagePath) return sendJson(res, 404, { ok: false, error: 'QR not ready' });
    try {
      const data = readFileSync(loginState.qrImagePath);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      res.end(data);
      return;
    } catch {
      return sendJson(res, 404, { ok: false, error: 'QR image not found' });
    }
  }

  if (pathname === '/login/start' && req.method === 'POST') {
    if (!loginState.inProgress) void startQrLogin();
    res.writeHead(302, { Location: '/login' });
    res.end();
    return;
  }

  if (pathname === '/verify' && req.method === 'GET') {
    if (!requireApiKey(req, res)) return;
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/credentials' && req.method === 'GET') {
    if (!requireApiKey(req, res)) return;
    if (!existsSync(config.zalo.credentialsPath)) {
      return sendJson(res, 404, { ok: false, error: 'Chưa có credentials. Đăng nhập tại /login trước.' });
    }
    const content = readFileSync(config.zalo.credentialsPath, 'utf8');
    const base64 = Buffer.from(content).toString('base64');
    return sendJson(res, 200, { ok: true, base64, hint: 'Set ZALO_CREDENTIALS env var to this value to persist across restarts' });
  }

  if (pathname === '/zalo/start' && req.method === 'POST') {
    if (!requireApiKey(req, res)) return;
    if (!loginState.inProgress) void startQrLogin();
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/dashboard' && req.method === 'GET') {
    try {
      let html = readFileSync(DASHBOARD_HTML, 'utf8');
      const fbCfgJson = JSON.stringify(config.firebase);
      const injection = `<script>window.__FB_CONFIG__=${fbCfgJson};</script>`;
      html = html.replace('</head>', injection + '</head>');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      sendJson(res, 404, { ok: false, error: 'Dashboard not found' });
    }
    return;
  }

  if (pathname === '/logout' && req.method === 'POST') {
    if (!requireApiKey(req, res)) return;
    stopListener();
    resetZaloApi();
    clearCredentialsFile();
    loginState.inProgress = false;
    loginState.phase = 'idle';
    loginState.message = 'Đã đăng xuất và xóa credentials.';
    loginState.qrImagePath = undefined;
    return sendJson(res, 200, { ok: true, message: 'Logged out and cleared credentials' });
  }

  if (req.method === 'POST' && !publicEndpoints(pathname)) {
    return handleProtectedApi(req, res, pathname);
  }

  sendJson(res, 404, { ok: false, error: 'Not found' });
}

async function boot(): Promise<void> {
  console.log('╔══════════════════════════════════════╗');
  console.log('║        Zalo REST Webservice         ║');
  console.log('╚══════════════════════════════════════╝');

  // 1. Tự động khôi phục credentials từ Firebase (nếu có FIREBASE_SERVICE_ACCOUNT)
  await restoreCredsFromFirebase();

  // 2. Fallback: khôi phục từ env var ZALO_CREDENTIALS (cách thủ công cũ)
  const credsEnv = process.env.ZALO_CREDENTIALS;
  if (credsEnv && !existsSync(config.zalo.credentialsPath)) {
    try {
      writeFileSync(config.zalo.credentialsPath, Buffer.from(credsEnv, 'base64').toString('utf8'), 'utf8');
      console.log('[Boot] Credentials restored from ZALO_CREDENTIALS env var');
    } catch (err) {
      console.warn('[Boot] Failed to restore credentials from env var:', err);
    }
  }

  try {
    await ensureLoggedInApi();
    loginState.phase = 'success';
    loginState.message = 'Đã tự đăng nhập từ credentials.json.';
  } catch (err) {
    loginState.phase = 'idle';
    loginState.message = `Chưa đăng nhập: ${err instanceof Error ? err.message : String(err)}`;
    console.warn('[Boot] Auto login failed:', err);
  }

  const server = createServer((req, res) => {
    void requestHandler(req, res);
  });
  server.listen(config.server.port, () => {
    console.log(`[Boot] HTTP server listening on http://localhost:${config.server.port}`);
    console.log(`[Boot] Login page: http://localhost:${config.server.port}/login`);
  });

  const shutdown = (signal: string) => {
    console.log(`[Boot] Received ${signal}, shutting down...`);
    stopListener();
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

void boot().catch((err) => {
  console.error('[Boot] Fatal error:', err);
  process.exit(1);
});

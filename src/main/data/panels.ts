import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { HtmlWidget } from '../../shared/dashboard'
import { DASHBOARD_DIR } from '../../shared/dashboard'
import { fileResponse, resolveIn } from '../files'
import { listBoards, loadDashboard } from './dashboard'
import { BASE_CSS } from './styleGuide'

/** 앱이 패널에 직접 내주는 글꼴 (Pretendard 가변 글꼴 하나로 모든 굵기) */
const FONT_PATH = '__aw/font/PretendardVariable.woff2'
let fontCache: Promise<Buffer> | null = null

/** 패널은 샌드박스라 출처가 없다(null) — 글꼴은 CORS 허용 헤더가 있어야 읽힌다 */
function fontResponse(): Promise<Response> {
  fontCache ??= fs.readFile(path.join(app.getAppPath(), 'node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2'))
  return fontCache.then(
    (buf) =>
      new Response(new Uint8Array(buf), {
        headers: { 'Content-Type': 'font/woff2', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=31536000, immutable' }
      }),
    () => {
      fontCache = null
      return new Response('font not found', { status: 404 })
    }
  )
}

/** 패널에서 스크립트·스타일을 불러올 수 있는 CDN (차트 라이브러리 등) */
const CDN = ['https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com', 'https://unpkg.com', 'https://esm.sh']

/**
 * 패널 CSP. 기본은 외부 통신 차단 — 데이터는 aw 브리지로만 받는다.
 * network: true 인 패널만 https fetch·이미지를 허용한다.
 */
function panelCsp(network: boolean): string {
  const self = 'ws-panel:'
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${self} ${CDN.join(' ')}`,
    `style-src 'unsafe-inline' ${self} ${CDN.join(' ')} https://fonts.googleapis.com`,
    `font-src ${self} data: https://fonts.gstatic.com ${CDN.join(' ')}`,
    `img-src ${self} ws-file: data: blob:${network ? ' https:' : ''}`,
    `media-src ${self} ws-file: blob:${network ? ' https:' : ''}`,
    `connect-src ${network ? 'https:' : "'none'"}`,
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'"
  ].join('; ')
}

/** 패널 기본 모양 — 앱과 같은 색·글꼴. 패널 CSS 가 뒤에 오므로 얼마든지 덮어쓸 수 있다 */
const THEME = `<style id="aw-theme">
@font-face{font-family:'Pretendard Variable';src:url('/${FONT_PATH}') format('woff2-variations'),url('/${FONT_PATH}') format('woff2');font-weight:45 920;font-style:normal;font-display:swap}
:root{color-scheme:dark;--aw-bg:#141416;--aw-card:#111113;--aw-line:#27272a;--aw-text:#ededef;--aw-text-2:#c8c8cd;--aw-muted:#8e8e96;
--aw-accent:#8d96e8;--aw-ok:#3fbf8a;--aw-warn:#e5a94f;--aw-bad:#ef6b6b;--aw-claude:#d97757;--aw-codex:#10a37f;--aw-gemini:#4c8df6;
--aw-surface:#18181b;--aw-surface-2:#1f1f23;--aw-field:#0f0f11;--aw-radius:12px;--aw-radius-sm:8px;
--aw-chart-1:#8d96e8;--aw-chart-2:#3fbf8a;--aw-chart-3:#e5a94f;--aw-chart-4:#ef6b6b;--aw-chart-5:#b48ae8;--aw-chart-6:#4fb3e0;
--aw-mono:'Cascadia Code','JetBrains Mono',ui-monospace,Menlo,Consolas,monospace}
html,body{margin:0;background:transparent;color:var(--aw-text);font:13px/1.55 'Pretendard Variable',Pretendard,Inter,system-ui,-apple-system,'Segoe UI','Malgun Gothic','Apple SD Gothic Neo',sans-serif}
a{color:var(--aw-accent)}
*{box-sizing:border-box;scrollbar-width:thin;scrollbar-color:#2e2e33 transparent}
${BASE_CSS}</style>`

/** window.aw — 부모(앱)와 postMessage 로 통신 */
function bridge(projectId: string): string {
  return `<script id="aw-bridge">(() => {
  const PID = ${JSON.stringify(projectId)};
  let seq = 0;
  const pending = new Map();
  const listeners = {};
  addEventListener('message', (e) => {
    if (e.source !== parent) return;
    const m = e.data;
    if (!m || m.__aw !== 1) return;
    if (m.type === 'reply') {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      m.ok ? p.resolve(m.result) : p.reject(new Error(m.error || 'aw 오류'));
    } else if (m.type === 'event') {
      (listeners[m.event] || []).forEach((f) => { try { f(m.data) } catch (err) { console.error(err) } });
    }
  });
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    parent.postMessage({ __aw: 1, type: 'call', id, method, params }, '*');
  });
  const enc = (rel) => String(rel).replace(/^\\.?\\/+/, '').split('/').map(encodeURIComponent).join('/');
  window.aw = Object.freeze({
    projectId: PID,
    /** 데이터 조회 — 대시보드 쿼리 형식 */
    query: (query, project) => call('query', { query, project }),
    /** 데이터 소스·필드 목록 */
    schema: () => call('schema'),
    /** .dashboard/scripts 의 스크립트 실행 → stdout JSON (처음엔 사용자 승인) */
    run: (script, args, options) => call('run', { script, args, options }).then((r) => r.data),
    /** 실행 시간·stderr 까지 받기 */
    runRaw: (script, args, options) => call('run', { script, args, options }),
    scripts: () => call('scripts'),
    /** 현재 프로젝트·패널 정보 */
    context: () => call('context'),
    /** 앱 상태가 바뀔 때 (세션 실행·종료 등) 콜백 */
    on: (event, fn) => { (listeners[event] = listeners[event] || []).push(fn); return () => { listeners[event] = (listeners[event] || []).filter((f) => f !== fn) } },
    /** 쓰기 동작 — 사용자에게 확인 창이 뜨고, 허용되어야 실행된다 */
    sendMessage: (sessionId, prompt) => call('write', { action: { type: 'sendMessage', sessionId, prompt } }),
    createSession: (opts) => call('write', { action: Object.assign({}, opts || {}, { type: 'createSession', child: false }) }),
    stopSession: (sessionId) => call('write', { action: { type: 'stopSession', sessionId } }),
    /** .dashboard/data 안 파일 — 저장은 처음 한 번 사용자 확인 (패널 단위로 "항상 허용" 가능) */
    readFile: (path, opts) => call('fileRead', { path, encoding: (opts && opts.encoding) || 'utf8' }),
    readJSON: (path) => call('fileRead', { path, encoding: 'utf8' }).then((t) => JSON.parse(t)),
    listFiles: (dir) => call('fileList', { dir: dir || '' }),
    saveFile: (path, content, opts) => call('fileSave', { path, content, encoding: (opts && opts.encoding) || 'utf8' }),
    saveJSON: (path, value) => call('fileSave', { path, content: JSON.stringify(value, null, 2), encoding: 'utf8' }),
    /** OS 저장 대화상자 → 사용자가 고른 위치. 취소하면 null */
    saveAs: (content, opts) => call('saveAs', { content, name: (opts && opts.name) || 'export.json', encoding: (opts && opts.encoding) || 'utf8' }),
    openSession: (id) => call('openSession', { id }),
    openFile: (rel) => call('openFile', { rel }),
    openView: (view) => call('openView', { view }),
    /** 프로젝트 파일(이미지·동영상) 주소 */
    fileUrl: (rel) => 'ws-file://' + PID + '/' + enc(rel),
    /** .dashboard 안 파일 주소 (패널 기준 상대 경로도 그냥 쓸 수 있음) */
    assetUrl: (rel) => 'ws-panel://' + PID + '/' + enc(rel)
  });
  // 내용 높이를 앱에 알려 카드 높이를 맞춘다
  let last = 0;
  const report = () => {
    const h = Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
    if (Math.abs(h - last) > 1) { last = h; call('resize', { height: h }).catch(() => {}) }
  };
  addEventListener('load', report);
  new ResizeObserver(report).observe(document.documentElement);
  addEventListener('error', (e) => parent.postMessage({ __aw: 1, type: 'call', id: 0, method: 'resize', params: { error: String(e.message || e) } }, '*'));
})();</script>`
}

function inject(html: string, projectId: string): string {
  const head = `${THEME}${bridge(projectId)}`
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${head}`)
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`)
  return `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${html}</body></html>`
}

/**
 * ws-panel://<projectId>/<.dashboard 기준 경로>
 * HTML 은 브리지·테마를 넣고 CSP 헤더를 붙인다. 그 밖의 파일은 그대로 (Range 지원).
 * .dashboard 밖은 열 수 없다.
 */
export async function panelResponse(projectPath: string, projectId: string, url: URL): Promise<Response> {
  const root = path.join(projectPath, DASHBOARD_DIR)
  let rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
  if (rel === FONT_PATH) return fontResponse()
  let abs: string
  try {
    abs = resolveIn(root, rel)
  } catch {
    return new Response('forbidden', { status: 403 })
  }
  if (!/\.html?$/i.test(abs)) {
    return fileResponse(abs, null).catch(() => new Response('not found', { status: 404 }))
  }
  rel = path.relative(root, abs).split(path.sep).join('/')
  let html: string
  try {
    html = await fs.readFile(abs, 'utf8')
  } catch {
    return new Response(`패널 파일이 없습니다: ${DASHBOARD_DIR}/${rel}`, { status: 404 })
  }
  // network 허용 여부는 URL 이 아니라 보드 파일에서 정한다 (패널이 스스로 바꾸지 못하게).
  // 같은 패널을 여러 보드가 쓰면 하나라도 network: true 면 허용
  const network = listBoards(projectPath).some((b) =>
    (loadDashboard(projectPath, b.id).spec?.widgets ?? []).some(
      (x): boolean => x.type === 'html' && (x as HtmlWidget).src.replace(/^\.?\/+/, '') === rel && !!(x as HtmlWidget).network
    )
  )
  return new Response(inject(html, projectId), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': panelCsp(network),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  })
}

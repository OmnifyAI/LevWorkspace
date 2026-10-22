import { app, BrowserWindow, Menu, net, protocol, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { PANEL_SCHEME } from '../shared/dashboard'
import { panelResponse } from './data/panels'
import { fileResponse, resolveIn } from './files'
import { registerIpc } from './ipc'
import { Workspace } from './workspace'

// 이름을 Lev 로 바꾸기 전에 쓰던 데이터 폴더(Agent Workspace)가 있으면 그대로 쓴다 (프로젝트·세션·비밀값 유지).
// --user-data-dir 로 따로 정한 경우는 건드리지 않는다
// (폴더 존재로 판단하면 안 된다 — Electron 이 앱 코드보다 먼저 userData 폴더를 만든다. 데이터 파일로 판단)
if (!app.commandLine.hasSwitch('user-data-dir')) {
  const legacy = path.join(app.getPath('appData'), 'Agent Workspace')
  const dbOf = (dir: string): string => path.join(dir, 'data', 'workspace.json')
  if (!fs.existsSync(dbOf(app.getPath('userData'))) && fs.existsSync(dbOf(legacy))) app.setPath('userData', legacy)
}

// 렌더러에서 에셋 미리보기용: ws-asset://<assetId>
protocol.registerSchemesAsPrivileged([
  { scheme: 'ws-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  // 프로젝트 파일 미리보기용: ws-file://<projectId>/<상대 경로>
  { scheme: 'ws-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  // 대시보드 HTML 패널: ws-panel://<projectId>/<.dashboard 기준 경로> (샌드박스 iframe 으로만 띄움)
  // corsEnabled: 샌드박스 패널(출처 null)이 앱이 내주는 글꼴을 CORS 로 받을 수 있게
  { scheme: PANEL_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
])

let ws: Workspace

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    title: 'Lev',
    backgroundColor: '#0e1014',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  // Alt 로 뜨는 기본 메뉴 막대를 없앤다. macOS 는 메뉴가 없으면 복사·붙여넣기 단축키도 사라지므로 최소 메뉴만 남긴다
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null)
  ws = new Workspace(broadcast)
  try {
    await ws.api.start()
  } catch (e) {
    console.error('Data API 를 시작하지 못했습니다', e)
  }
  ws.installAgentTools(app.getPath('userData'))

  protocol.handle('ws-asset', (req) => {
    const assetId = new URL(req.url).hostname
    const a = ws.store.db.assets.find((x) => x.id === assetId)
    const abs = a && ws.assetPath(a)
    if (!abs) return new Response('not found', { status: 404 })
    return net.fetch(pathToFileURL(abs).toString())
  })

  protocol.handle('ws-file', (req) => {
    const url = new URL(req.url)
    const p = ws.store.project(url.hostname)
    if (!p) return new Response('not found', { status: 404 })
    let abs: string
    try {
      abs = resolveIn(p.path, decodeURIComponent(url.pathname.replace(/^\//, '')))
    } catch {
      return new Response('forbidden', { status: 403 })
    }
    return fileResponse(abs, req.headers.get('range')).catch(() => new Response('not found', { status: 404 }))
  })

  protocol.handle(PANEL_SCHEME, (req) => {
    const url = new URL(req.url)
    const p = ws.store.project(url.hostname)
    if (!p) return new Response('not found', { status: 404 })
    return panelResponse(p.path, p.id, url)
  })

  registerIpc(ws)
  createWindow()
  void ws.detect()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  ws?.permissions.denyAll()
  ws?.manager.stopAll()
  ws?.closeWatchers()
  ws?.api.stop()
  ws?.shutdownAgentTools()
  ws?.store.flush()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

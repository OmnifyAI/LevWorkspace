import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { schema } from './data/sources'
import type { Workspace } from './workspace'
import * as G from './git'

type Handler = (...args: any[]) => unknown

/** 렌더러가 window.api.invoke(channel, ...args) 로 부르는 채널 목록 */
export function registerIpc(ws: Workspace): void {
  const win = (e: IpcMainInvokeEvent): BrowserWindow | undefined => BrowserWindow.fromWebContents(e.sender) ?? undefined

  const handlers: Record<string, Handler> = {
    'state:get': () => ws.snapshot(),
    'settings:set': (patch) => ws.setSettings(patch),

    'project:create': (input) => ws.createProject(input),
    'project:update': (id, patch) => ws.updateProject(id, patch),
    'project:remove': (id) => ws.removeProject(id),
    'project:open': (id) => {
      const p = ws.store.project(id)
      if (p) void shell.openPath(p.path)
    },

    'cliRule:remove': (projectId, rule) => ws.removeCliRule(projectId, rule),
    'mcp:list': (projectId) => ws.mcp.list(projectId),
    'mcp:connect': (projectId) => ws.mcp.tools(projectId).then(() => ws.mcp.list(projectId)),
    'mcp:approve': (key, projectId) => ws.mcp.approve(key, projectId),
    'mcp:setEnabled': (key, on) => ws.mcp.setEnabled(key, on),
    'mcp:reconnect': (key, projectId) => ws.mcp.reconnect(key, projectId),
    'mcp:setPolicy': (key, tool, value) => ws.mcp.setPolicy(key, tool, value),
    'mcp:secrets': () => ws.mcp.secretList(),
    'mcp:setSecret': (name, value) => ws.mcp.setSecret(name, value),
    'mcp:removeSecret': (name) => ws.mcp.removeSecret(name),
    'mcp:login': (key, projectId) => ws.mcp.login(key, projectId),
    'mcp:cancelLogin': (key) => ws.mcp.cancelLogin(key),
    'mcp:logout': (key) => ws.mcp.logout(key),
    'mcp:openUrl': (url) => {
      // 로그인 중인 인증 주소만 연다 (렌더러가 임의 주소를 열지 못하게)
      if (typeof url === 'string' && ws.mcp.isPendingAuthUrl(url)) void shell.openExternal(url)
    },
    'mcp:saveGlobal': (name, config) => ws.mcp.saveGlobal(name, config),
    'mcp:removeGlobal': (name) => ws.mcp.removeGlobal(name),
    'mcp:initProjectFile': (projectId) => ws.mcp.initProjectFile(projectId),
    'mcp:openGlobalFile': () => {
      ws.mcp.saveGlobalIfMissing()
      void shell.openPath(ws.mcp.globalFile)
    },

    'provider:update': (id, patch) => ws.updateProvider(id, patch),
    'provider:detect': (id) => ws.detect(id),

    'session:create': (input) => ws.createSession(input),
    'session:update': (id, patch) => ws.updateSession(id, patch),
    'session:remove': (id) => ws.removeSession(id),
    'session:reset': (id) => ws.resetSession(id),
    'session:send': (id, prompt) => ws.send(id, prompt),
    'session:stop': (id) => ws.stop(id),
    'session:messages': (id) => ws.messages(id),
    'session:spawnChild': (parentId, input) => ws.spawnChild(parentId, input),
    'session:report': (childId) => ws.reportToParent(childId),

    'multi:start': (input) => ws.startMulti(input),
    'multi:stop': (id) => ws.stopMulti(id),
    'multi:remove': (id, withSessions) => ws.removeMulti(id, withSessions),

    'skill:create': (projectId, input) => ws.createSkill(projectId, input),
    'skill:update': (projectId, id, patch) => ws.updateSkill(projectId, id, patch),
    'skill:remove': (projectId, id) => ws.removeSkill(projectId, id),
    'skill:openFolder': (projectId, id) => ws.openSkillsFolder(projectId, id),
    'skill:import': (projectId) => ws.importSkills(projectId),
    'skill:exportClaude': (projectId) => ws.exportSkillsToClaude(projectId),

    'asset:import': (projectId, files) => ws.importAssets(projectId, files),
    'asset:rescan': (projectId) => ws.rescanAssets(projectId),
    'asset:update': (id, patch) => ws.updateAsset(id, patch),
    'asset:remove': (id, trash) => ws.removeAsset(id, trash),
    'asset:readText': (id) => ws.readAssetText(id),
    'dashboard:get': (projectId, board) => ws.loadDashboard(projectId, board),
    'board:list': (projectId) => ws.listBoards(projectId),
    'board:create': (projectId, input) => ws.createBoard(projectId, input),
    'board:remove': (projectId, board) => ws.removeBoard(projectId, board),
    'data:query': (projectId, q) => ws.query(projectId, q),
    'data:schema': () => schema(),
    'api:info': () => ws.apiInfo(),
    'panel:fileRead': (projectId, rel, encoding) => ws.panelReadFile(projectId, String(rel), encoding),
    'panel:fileList': (projectId, dir) => ws.panelListFiles(projectId, dir ? String(dir) : undefined),
    'panel:fileSave': (projectId, src, rel, content, encoding) => ws.panelSaveFile(ws.panelOrigin(projectId, String(src)), String(rel), content, encoding),
    'panel:saveAs': (projectId, content, name, encoding) => ws.panelSaveAs(projectId, content, String(name ?? ''), encoding),
    'panel:error': (projectId, src, message) => ws.reportPanelError(projectId, String(src), String(message ?? '')),
    'write:panel': (projectId, src, action) => ws.writeAction(ws.panelOrigin(projectId, String(src)), action),
    'permission:list': () => ws.permissions.list(),
    'permission:respond': (id, decision) => ws.permissions.respond(id, decision),
    'permission:revoke': (key) => ws.permissions.revoke(key),
    'script:list': (projectId) => ws.listScripts(projectId),
    'script:run': (projectId, name, args, options, origin) => ws.runScript(projectId, name, args, options, origin ?? '대시보드 패널'),

    'fs:list': (projectId, rel) => ws.listDir(projectId, rel),
    'fs:read': (projectId, rel) => ws.readFile(projectId, rel),
    'fs:reveal': (projectId, rel) => ws.revealFile(projectId, rel),
    'git:status': (projectId) => ws.gitStatus(projectId),
    'git:repo': (projectId) => ws.gitRead(projectId, (r) => G.repoStatus(r)),
    'git:log': (projectId, opts) => ws.gitRead(projectId, (r) => G.log(r, opts)),
    'git:commitDetail': (projectId, hash) => ws.gitRead(projectId, (r) => G.commitDetail(r, hash)),
    'git:commitFileDiff': (projectId, hash, rel) => ws.gitRead(projectId, (r) => G.commitFileDiff(r, hash, rel)),
    'git:workDiff': (projectId, rel, staged) => ws.gitRead(projectId, (r) => G.workDiff(r, rel, !!staged)),
    'git:branches': (projectId) => ws.gitRead(projectId, (r) => G.branches(r)),
    'git:stage': (projectId, rels) => ws.gitChange(projectId, (r) => G.stage(r, rels)),
    'git:unstage': (projectId, rels, hasCommits) => ws.gitChange(projectId, (r) => G.unstage(r, rels, hasCommits !== false)),
    'git:discard': (projectId, files) => ws.gitChange(projectId, (r) => G.discard(r, files)),
    'git:commit': (projectId, message, opts) =>
      ws.gitChange(projectId, (r) => G.commit(r, message, opts), (h) => `git 커밋 ${h}: ${String(message).split(/\r?\n/)[0].slice(0, 60)}`),
    'git:switch': (projectId, name) => ws.gitChange(projectId, (r) => G.switchBranch(r, name), () => `git 브랜치 전환 → ${name}`),
    'git:createBranch': (projectId, name, from) => ws.gitChange(projectId, (r) => G.createBranch(r, name, from), () => `git 브랜치 만듦: ${name}`),
    'git:deleteBranch': (projectId, name) => ws.gitChange(projectId, (r) => G.deleteBranch(r, name), () => `git 브랜치 삭제: ${name}`),
    'git:fetch': (projectId) => ws.gitChange(projectId, (r) => G.fetchAll(r)),
    'git:pull': (projectId) => ws.gitChange(projectId, (r) => G.pull(r), () => 'git pull'),
    'git:push': (projectId) => ws.gitChange(projectId, async (r) => G.push(r, await G.repoStatus(r)), () => 'git push'),
    'git:init': (projectId) => ws.gitChange(projectId, (r) => G.init(r), () => 'git 저장소 만듦'),
    'git:diff': (projectId, rel) => ws.gitDiff(projectId, rel),
    'session:attachFile': (sessionId, rel) => ws.attachFile(sessionId, rel),

    'asset:reveal': (id) => {
      const a = ws.store.db.assets.find((x) => x.id === id)
      const abs = a && ws.assetPath(a)
      if (abs) shell.showItemInFolder(abs)
    }
  }

  for (const [channel, fn] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_e, ...args) => fn(...args))
  }

  // 다이얼로그는 호출한 창을 부모로 띄운다
  ipcMain.handle('dialog:pickFolder', async (e) => {
    const w = win(e)
    const opts = { properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> }
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    return { path: r.filePaths[0], name: path.basename(r.filePaths[0]) }
  })
  ipcMain.handle('dialog:pickFiles', async (e) => {
    const w = win(e)
    const opts = { properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'> }
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? [] : r.filePaths
  })
}

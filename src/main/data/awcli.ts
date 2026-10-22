import fs from 'node:fs'
import path from 'node:path'

/**
 * 에이전트용 작은 CLI `aw`. CLI 의 셸 보안 검사는 $변수 확장이나 JSON 따옴표가 섞인 긴
 * curl 명령을 막기 때문에, 토큰·주소는 이 스크립트가 환경 변수에서 직접 읽고
 * 에이전트는 `aw query q.json` 처럼 단순한 명령만 쓰게 한다.
 * Electron 실행 파일을 ELECTRON_RUN_AS_NODE 로 돌리므로 사용자 PC 에 node 가 없어도 된다.
 */
const SCRIPT = String.raw`'use strict'
const fs = require('fs')
const api = process.env.AGENT_WORKSPACE_API
const token = process.env.AGENT_WORKSPACE_TOKEN
const project = process.env.AGENT_WORKSPACE_PROJECT
const session = process.env.AGENT_WORKSPACE_SESSION
const USAGE = [
  'aw — Lev Data API',
  '  aw schema                  데이터 소스·필드 목록',
  '  aw projects                프로젝트 목록',
  '  aw query <파일.json>        쿼리 실행 (파일 내용 = 쿼리 JSON)',
  '  aw boards                  보드(대시보드·도구) 목록',
  '  aw dashboard [보드]         보드 정의와 형식 오류 (기본 main)',
  '  aw validate [보드] [파일]    보드 검증 (파일 생략 시 저장된 .dashboard/boards/<보드>.json)'
].join('\n')

async function call(method, route, body) {
  const sep = route.includes('?') ? '&' : '?'
  const url = api + route + (project ? sep + 'project=' + encodeURIComponent(project) : '')
  const res = await fetch(url, {
    method,
    headers: Object.assign({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, session ? { 'X-AW-Session': session } : {}),
    body: body === undefined ? undefined : body
  })
  const text = await res.text()
  process.stdout.write(text + '\n')
  if (!res.ok) process.exitCode = 1
}

function readJson(file) {
  const text = fs.readFileSync(file, 'utf8')
  JSON.parse(text) // 형식 오류를 먼저 알려준다
  return text
}

async function main() {
  if (!api || !token) {
    console.error('AGENT_WORKSPACE_API / AGENT_WORKSPACE_TOKEN 환경 변수가 없습니다. Lev 가 실행한 세션에서만 쓸 수 있습니다.')
    process.exit(2)
  }
  const [cmd, arg] = process.argv.slice(2)
  if (cmd === 'schema') return call('GET', '/api/schema')
  if (cmd === 'projects') return call('GET', '/api/projects')
  if (cmd === 'boards') return call('GET', '/api/boards')
  if (cmd === 'dashboard') return call('GET', '/api/dashboard' + (arg ? '?board=' + encodeURIComponent(arg) : ''))
  if (cmd === 'query') {
    if (!arg) throw new Error('쿼리 JSON 파일 경로가 필요합니다: aw query q.json')
    return call('POST', '/api/query', readJson(arg))
  }
  if (cmd === 'validate') {
    // aw validate x.json (main) | aw validate tool-a | aw validate tool-a x.json
    const rest = process.argv.slice(3)
    const board = rest[0] && !/.json$/i.test(rest[0]) ? rest[0] : undefined
    const file = rest.find((x) => /.json$/i.test(x))
    return call('POST', '/api/dashboard/validate' + (board ? '?board=' + encodeURIComponent(board) : ''), file ? readJson(file) : undefined)
  }
  console.log(USAGE)
  if (cmd && cmd !== 'help') process.exitCode = 1
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
`

/** userData/bin 에 aw(.cmd) 를 만들고 그 폴더 경로를 돌려준다 */
export function installAwCli(userData: string): string {
  const bin = path.join(userData, 'bin')
  fs.mkdirSync(bin, { recursive: true })
  const script = path.join(bin, 'aw.cjs')
  fs.writeFileSync(script, SCRIPT)
  const exe = process.execPath
  // Windows cmd / PowerShell
  fs.writeFileSync(path.join(bin, 'aw.cmd'), `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${exe}" "${script}" %*\r\n`)
  // macOS·Linux·Git Bash
  const sh = path.join(bin, 'aw')
  const toPosix = (p: string): string => (process.platform === 'win32' ? p.replace(/^([A-Za-z]):/, (_, d: string) => `/${d.toLowerCase()}`).replace(/\\/g, '/') : p)
  fs.writeFileSync(sh, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${toPosix(exe)}" "${toPosix(script)}" "$@"\n`)
  try {
    fs.chmodSync(sh, 0o755)
  } catch {
    // Windows
  }
  return bin
}

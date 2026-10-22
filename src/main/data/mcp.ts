import fs from 'node:fs'
import path from 'node:path'

export const MCP_SERVER_NAME = 'agent_workspace'

/**
 * Lev MCP 서버 (stdio). CLI 가 자식 프로세스로 띄우고, 줄 단위 JSON-RPC 로 대화한다.
 * 도구 호출은 앱의 Data API(HTTP)로 넘긴다. 주소·토큰은 --api-file 의 JSON 에서 읽는다
 * (명령줄·프로젝트 폴더에 토큰을 남기지 않기 위해). 의존성 없이 Node 내장 기능만 쓴다.
 */
const SERVER = String.raw`'use strict'
const fs = require('fs')
const readline = require('readline')

const argv = process.argv.slice(2)
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
const apiFile = opt('--api-file')
const defaultProject = opt('--project')
const sessionId = opt('--session')
const MAX_TEXT = 100000

function apiInfo() {
  // 앱을 다시 켜면 포트·토큰이 바뀌므로 호출할 때마다 읽는다
  const info = JSON.parse(fs.readFileSync(apiFile, 'utf8'))
  if (!info.url || !info.token) throw new Error('Lev 가 실행 중이 아닙니다')
  return info
}

// fetch 는 5분이면 끊긴다 — 사용자가 확인 창에서 고르는 동안 기다릴 수 있게 http 모듈로 (제한 없음)
function api(method, route, body, project) {
  const { url, token } = apiInfo()
  const p = project || defaultProject
  const sep = route.includes('?') ? '&' : '?'
  const target = new URL(url + route + (p ? sep + 'project=' + encodeURIComponent(p) : ''))
  const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
  return new Promise((resolve, reject) => {
    const req = require('http').request(
      target,
      {
        method,
        headers: Object.assign(
          { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          data ? { 'Content-Length': data.length } : {},
          sessionId ? { 'X-AW-Session': sessionId } : {}
        )
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode >= 400) {
            let msg = text
            try { msg = JSON.parse(text).error || text } catch {}
            reject(new Error(msg))
          } else resolve(text)
        })
      }
    )
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false })

const TOOLS = [
  {
    // claude --permission-prompt-tool 이 부른다 (모델이 직접 쓰는 도구가 아님)
    name: 'aw_permission_prompt',
    description: '[Lev 앱 내부용] CLI 가 권한이 필요한 도구를 쓸 때 앱 사용자에게 묻는다. 직접 호출하지 마라.',
    inputSchema: obj({ tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, ['tool_name']),
    run: (a) => api('POST', '/api/cli-permission', { tool_name: a.tool_name, input: a.input || {} })
  },
  {
    name: 'aw_schema',
    description: '[Lev 앱] Lev 데이터 소스와 필드 목록. aw_query 를 쓰기 전에 어떤 소스·필드가 있는지 확인할 때 쓴다.',
    inputSchema: obj(),
    run: () => api('GET', '/api/schema')
  },
  {
    name: 'aw_projects',
    description: '[Lev 앱] Lev 에 등록된 프로젝트 목록 (id, 이름, 경로).',
    inputSchema: obj(),
    run: () => api('GET', '/api/projects')
  },
  {
    name: 'aw_query',
    description: '[Lev 앱] Lev 데이터 조회 (세션·턴 비용·활동·멀티 실행·CLI 상태·git·스킬·파일). 대시보드 위젯의 query 와 같은 형식이다. 예: {"source":"turns","since":"7d","groupBy":"day(at)","agg":{"cost":{"op":"sum","field":"costUsd"}}}',
    inputSchema: obj(
      {
        query: {
          type: 'object',
          description: '[Lev 앱] source(필수), where, since, groupBy, agg, select, sort, limit, params',
          properties: { source: { type: 'string' } },
          required: ['source']
        },
        project: { type: 'string', description: '[Lev 앱] 프로젝트 id (생략하면 이 세션의 프로젝트, "all" 이면 전체)' }
      },
      ['query']
    ),
    run: (a) => api('POST', '/api/query', a.query, a.project)
  },
  {
    name: 'aw_list_scripts',
    description: '[Lev 앱] .dashboard/scripts 의 스크립트 목록 (실행 방법, 승인 여부)과 이 PC 에서 쓸 수 있는 런타임(runtimes). 새 스크립트를 쓰기 전에 확인한다 — node 는 늘 가능.',
    inputSchema: obj({ project: { type: 'string' } }),
    run: (a) => api('GET', '/api/scripts', undefined, a.project)
  },
  {
    name: 'aw_run_script',
    description: '[Lev 앱] .dashboard/scripts 의 스크립트를 앱에서 실행하고 stdout JSON 을 돌려준다 (패널의 aw.run 과 같은 방식). 처음 실행하거나 내용이 바뀌면 사용자에게 승인 창이 뜬다.',
    inputSchema: obj(
      {
        script: { type: 'string', description: 'scripts 폴더 기준 파일 이름 (예: github_prs.mjs)' },
        args: { type: 'object', description: '스크립트에 넘길 인자 (stdin JSON)' },
        timeout: { type: 'number', description: '초 (기본 30, 최대 300)' },
        project: { type: 'string' }
      },
      ['script']
    ),
    run: (a) => api('POST', '/api/scripts/run', { script: a.script, args: a.args, timeout: a.timeout }, a.project)
  },
  {
    name: 'aw_send_message',
    description: '[Lev 앱] 이 프로젝트의 다른 세션(에이전트)에게 메시지를 보낸다. 상대 채팅에는 "이 세션이 보낸 메시지"로 표시되고, 상대의 그 턴 답변이 자동으로 이 세션에 돌아온다 (상대는 aw_send_message 로 답장하지 않는다). wait: true 면 답을 이 도구 결과로 받는다 (최대 4분, 넘으면 나중에 "답장"으로 도착). 사용자 확인 창을 거친다. 대상이 실행 중이면 대기열에 들어간다. 자기 자신에게는 보낼 수 없다. 세션 id 는 aw_query {"source":"sessions"} 로 찾는다. 다른 에이전트가 보낸 메시지에 답할 때는 이 도구를 쓰지 말고 그냥 답변하라.',
    inputSchema: obj(
      {
        session_id: { type: 'string' },
        prompt: { type: 'string' },
        wait: { type: 'boolean', description: '답을 이 도구 결과로 기다린다 (최대 4분)' },
        project: { type: 'string' }
      },
      ['session_id', 'prompt']
    ),
    run: (a) => api('POST', '/api/sessions/' + encodeURIComponent(a.session_id) + '/messages', { prompt: a.prompt, wait: !!a.wait }, a.project)
  },
  {
    name: 'aw_create_session',
    description: '[Lev 앱] 새 세션을 만들고 prompt 가 있으면 바로 실행한다. child: true 면 이 세션의 자식 에이전트로 만들고, 끝나면 결과가 이 세션으로 자동 보고된다. 사용자에게 확인 창이 뜬다.',
    inputSchema: obj(
      {
        title: { type: 'string' },
        prompt: { type: 'string' },
        provider: { type: 'string', enum: ['claude', 'codex', 'gemini'], description: '생략하면 프로젝트 기본 CLI' },
        model: { type: 'string' },
        child: { type: 'boolean', description: '이 세션의 자식 에이전트로 (결과 자동 보고)' },
        project: { type: 'string' }
      },
      []
    ),
    run: (a) => api('POST', '/api/sessions', { title: a.title, prompt: a.prompt, provider: a.provider, model: a.model, child: a.child }, a.project)
  },
  {
    name: 'aw_stop_session',
    description: '[Lev 앱] 실행 중인 세션을 중지한다. 사용자에게 확인 창이 뜬다.',
    inputSchema: obj({ session_id: { type: 'string' }, project: { type: 'string' } }, ['session_id']),
    run: (a) => api('POST', '/api/sessions/' + encodeURIComponent(a.session_id) + '/stop', {}, a.project)
  },
  {
    name: 'aw_list_boards',
    description: '[Lev 앱] 이 프로젝트의 보드(대시보드·도구) 목록: id, 제목, 종류, 파일 경로, 위젯 수, 오류 수.',
    inputSchema: obj({ project: { type: 'string' } }),
    run: (a) => api('GET', '/api/boards', undefined, a.project)
  },
  {
    name: 'aw_dashboard',
    description: '[Lev 앱] 보드 하나의 정의(.dashboard/boards/<board>.json)와 형식 오류. board 를 생략하면 main.',
    inputSchema: obj({ board: { type: 'string' }, project: { type: 'string' } }),
    run: (a) => api('GET', '/api/dashboard' + (a.board ? '?board=' + encodeURIComponent(a.board) : ''), undefined, a.project)
  },
  {
    name: 'aw_dashboard_validate',
    description: '[Lev 앱] 보드 JSON 검증: 형식 오류, 위젯별 쿼리 결과(행 수 또는 오류), 패널 파일 존재. spec 을 생략하면 저장된 파일을 검사한다. 보드 파일을 고친 뒤 꼭 호출한다.',
    inputSchema: obj({
      board: { type: 'string', description: '보드 id (생략하면 main)' },
      spec: { type: 'object', description: '검사할 보드 JSON (생략 가능)' },
      project: { type: 'string' }
    }),
    run: (a) => api('POST', '/api/dashboard/validate' + (a.board ? '?board=' + encodeURIComponent(a.board) : ''), a.spec, a.project)
  }
]

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

async function handle(msg) {
  const { id, method, params } = msg
  const reply = (result) => id !== undefined && send({ jsonrpc: '2.0', id, result })
  const fail = (code, message) => id !== undefined && send({ jsonrpc: '2.0', id, error: { code, message } })
  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: (params && params.protocolVersion) || '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'agent-workspace', version: '0.1.0' },
        instructions: 'Lev 앱의 데이터(세션, 비용, 활동, 멀티 실행, CLI 상태, git, 스킬, 대시보드)를 읽고, 사용자 확인을 거쳐 다른 세션에 메시지 보내기·세션 만들기·중지를 하는 도구. 사용자가 앱에 등록한 외부 MCP 서버의 도구도 <서버>__<도구> 이름으로 이 서버를 통해 제공된다.'
      })
    case 'ping':
      return reply({})
    case 'tools/list': {
      // 앱이 중계하는 외부 MCP 서버의 도구를 덧붙인다 (앱이 꺼져 있으면 기본 도구만)
      let external = []
      try { external = JSON.parse(await api('GET', '/api/mcp/tools')).tools || [] } catch {}
      return reply({ tools: TOOLS.map(({ run, ...t }) => t).concat(external) })
    }
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === (params && params.name))
      if (!tool) {
        try {
          return reply(JSON.parse(await api('POST', '/api/mcp/call', { name: params && params.name, arguments: (params && params.arguments) || {} })))
        } catch (e) {
          return reply({ content: [{ type: 'text', text: '오류: ' + e.message }], isError: true })
        }
      }
      try {
        let text = await tool.run((params && params.arguments) || {})
        if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + '\n…(잘림: limit 이나 select 로 줄이세요)'
        return reply({ content: [{ type: 'text', text }] })
      } catch (e) {
        return reply({ content: [{ type: 'text', text: '오류: ' + e.message }], isError: true })
      }
    }
    default:
      if (method && method.startsWith('notifications/')) return
      return fail(-32601, '지원하지 않는 메서드: ' + method)
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })
  }
  for (const m of Array.isArray(msg) ? msg : [msg]) handle(m).catch((e) => process.stderr.write(String(e) + '\n'))
})
`

export interface McpLaunch {
  /** MCP 서버를 띄우는 실행 파일 (Electron 을 Node 로) */
  command: string
  args: string[]
  env: Record<string, string>
}

export interface McpPaths {
  dir: string
  script: string
  apiFile: string
}

/** userData/mcp 에 서버 스크립트를 쓴다 */
export function installMcpServer(userData: string): McpPaths {
  const dir = path.join(userData, 'mcp')
  fs.mkdirSync(dir, { recursive: true })
  const script = path.join(dir, 'workspace-mcp.cjs')
  fs.writeFileSync(script, SERVER)
  return { dir, script, apiFile: path.join(dir, 'api.json') }
}

/** 앱이 켜질 때마다 바뀌는 API 주소·토큰을 기록한다 (사용자만 읽을 수 있게) */
export function writeApiFile(paths: McpPaths, info: { url: string; token: string }): void {
  fs.writeFileSync(paths.apiFile, JSON.stringify(info), { mode: 0o600 })
}

/** 앱이 꺼지면 토큰 파일을 비운다 */
export function clearApiFile(paths: McpPaths): void {
  try {
    fs.writeFileSync(paths.apiFile, JSON.stringify({ url: '', token: '' }), { mode: 0o600 })
  } catch {
    // 이미 지워졌거나 접근 불가
  }
}

export function mcpLaunch(paths: McpPaths, projectId: string, sessionId: string): McpLaunch {
  return {
    command: process.execPath,
    args: [paths.script, '--api-file', paths.apiFile, '--project', projectId, '--session', sessionId],
    env: { ELECTRON_RUN_AS_NODE: '1' }
  }
}

/** claude --mcp-config 용 파일, gemini 시스템 설정 파일 (세션별 — 쓰기 요청의 출처를 알기 위해) */
export function writeCliConfigs(paths: McpPaths, projectId: string, sessionId: string): { claude: string; gemini: string } {
  const launch = mcpLaunch(paths, projectId, sessionId)
  const server = { command: launch.command, args: launch.args, env: launch.env }
  const dir = path.join(paths.dir, 'sessions')
  fs.mkdirSync(dir, { recursive: true })
  const claude = path.join(dir, `claude-${sessionId}.json`)
  fs.writeFileSync(claude, JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: server } }, null, 2))
  const gemini = path.join(dir, `gemini-${sessionId}.json`)
  fs.writeFileSync(gemini, JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { ...server, trust: true } } }, null, 2))
  return { claude, gemini }
}

/** TOML 리터럴 문자열 (작은따옴표) */
const tomlLit = (s: string): string => `'${s.replace(/'/g, '')}'`

/** codex exec 의 -c 설정 덮어쓰기 인자 */
export function codexMcpArgs(launch: McpLaunch): string[] {
  const env = Object.entries(launch.env).map(([k, v]) => `${k}=${tomlLit(v)}`).join(',')
  return [
    '-c',
    `mcp_servers.${MCP_SERVER_NAME}.command=${tomlLit(launch.command)}`,
    '-c',
    `mcp_servers.${MCP_SERVER_NAME}.args=[${launch.args.map(tomlLit).join(',')}]`,
    '-c',
    `mcp_servers.${MCP_SERVER_NAME}.env={${env}}`,
    // codex 0.16x: MCP 도구 호출마다 승인이 필요한데 exec 는 물어볼 수 없다 — 앱 서버의 도구는 승인된 것으로.
    // (외부 MCP 도구·쓰기 동작은 앱이 자기 정책과 확인 창으로 따로 거른다)
    '-c',
    `mcp_servers.${MCP_SERVER_NAME}.default_tools_approval_mode=approve`
  ]
}

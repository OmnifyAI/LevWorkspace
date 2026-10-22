import fs from 'node:fs'
import path from 'node:path'
import type { BoardInfo, DashboardLoad, DashboardSpec, NewBoardInput, ValidationIssue, Widget } from '../../shared/dashboard'
import { BOARD_ID_RE, boardRel, BOARDS_DIR, DASHBOARD_DIR, DASHBOARD_FILE, MAIN_BOARD, WIDGET_TYPES } from '../../shared/dashboard'
import { SKILLS_DIR } from '../../shared/types'
import { getSource, schema } from './sources'
import { STYLE_GUIDE_FILE, styleGuide } from './styleGuide'

/** 기본 보드 파일 (스킬 문서용) */
export const DASHBOARD_REL = boardRel(MAIN_BOARD)
export const BUILDER_SKILL = 'dashboard-builder'
/** 스킬 문서를 바꾸면 올린다 — 앱이 만든 옛 버전 파일을 새로 쓴다 */
export const BUILDER_SKILL_VERSION = 16

/** 처음 만들어지는 대시보드 — 앱의 기존 고정 대시보드를 JSON 위젯으로 옮긴 것 */
/**
 * 새 프로젝트의 첫 대시보드. 일부러 단순하게 두고, 위 요청 입력창으로 빌더 에이전트에게
 * 자기 대시보드를 만들어 달라고 하도록 이끈다 (예시 요청 칩).
 */
export const DEFAULT_DASHBOARD: DashboardSpec = {
  version: 1,
  title: '프로젝트 대시보드',
  description: '에이전트에게 말해서 나만의 대시보드로 바꿔 보세요',
  suggestions: [
    '최근 7일 비용을 막대 차트로 보여줘',
    'CLI별 비용을 원 차트로 비교해줘',
    '실행 중인 에이전트와 지금 하는 작업을 표로 보여줘',
    'git 으로 바뀐 파일 목록을 보여주고, 누르면 열리게 해줘',
    '이 시작 안내 카드는 이제 지워줘'
  ],
  widgets: [
    {
      id: 'welcome',
      type: 'markdown',
      title: '이 대시보드는 당신이 만듭니다',
      w: 12,
      text: [
        '지금 화면은 출발점일 뿐이에요. **위 입력창에 보고 싶은 것을 말로 적으면**, 대시보드 빌더 에이전트가 이 화면을 직접 고쳐 줍니다.',
        '',
        '- 입력창 아래 **예시**를 누르면 바로 채워져요. 그대로 보내도 되고 고쳐서 보내도 돼요.',
        '- 숫자·표·차트뿐 아니라 버튼이 있는 작은 도구도 만들 수 있어요. 왼쪽 **보드 → + 새 도구**.',
        '- 마음에 안 들면 "다시 해줘", "이 카드 지워줘"처럼 계속 말하면 됩니다.'
      ].join('\n')
    },
    {
      id: 'sessions',
      type: 'kpi',
      title: '에이전트 세션',
      w: 4,
      query: { source: 'sessions', agg: { value: { op: 'count' }, running: { op: 'count', where: { status: 'running' } } } },
      sub: '실행 중 {{running}}'
    },
    {
      id: 'cost',
      type: 'kpi',
      title: '누적 비용',
      w: 4,
      format: 'currency',
      query: { source: 'turns', agg: { value: { op: 'sum', field: 'costUsd' }, turns: { op: 'count' } } },
      sub: '턴 {{turns}}번'
    },
    {
      id: 'skills',
      type: 'kpi',
      title: '프로젝트 스킬',
      w: 4,
      query: { source: 'skills', agg: { value: { op: 'count' } } },
      sub: '.skills 폴더 · 채팅에서 /이름'
    },
    {
      id: 'activity',
      type: 'list',
      title: '최근 활동',
      w: 12,
      query: { source: 'activity', sort: '-at', limit: 8 },
      primary: 'text',
      time: 'at',
      timeFormat: 'time',
      dot: { field: 'kind', colors: { start: 'accent', done: 'ok', error: 'bad', stopped: 'muted', delegate: 'accent', report: 'ok', multi: 'warn', write: 'accent', mcp: 'accent' } },
      rowAction: { do: 'openSession', field: 'sessionId' },
      empty: '아직 활동이 없어요. 왼쪽에서 에이전트에게 첫 일을 맡겨 보세요.'
    }
  ]
}

export function boardsDir(projectPath: string): string {
  return path.join(projectPath, DASHBOARD_DIR, BOARDS_DIR)
}

export function boardPath(projectPath: string, id: string): string {
  if (!BOARD_ID_RE.test(id)) throw new Error(`보드 id 는 영문 소문자·숫자·-·_ (64자까지): "${id}"`)
  return path.join(boardsDir(projectPath), `${id}.json`)
}

/**
 * boards/main.json 이 없으면 만든다. 예전 .dashboard/dashboard.json 이 있으면 그걸 옮긴다.
 */
export function ensureDashboard(projectPath: string): void {
  const main = boardPath(projectPath, MAIN_BOARD)
  if (fs.existsSync(main)) return
  fs.mkdirSync(path.dirname(main), { recursive: true })
  const legacy = path.join(projectPath, DASHBOARD_DIR, DASHBOARD_FILE)
  if (fs.existsSync(legacy)) fs.renameSync(legacy, main)
  else fs.writeFileSync(main, JSON.stringify(DEFAULT_DASHBOARD, null, 2) + '\n')
}

export function listBoards(projectPath: string): BoardInfo[] {
  const dir = boardsDir(projectPath)
  if (!fs.existsSync(dir)) return []
  const out: BoardInfo[] = []
  for (const f of fs.readdirSync(dir)) {
    const m = /^(.+)\.json$/.exec(f)
    if (!m || !BOARD_ID_RE.test(m[1])) continue
    const load = loadDashboard(projectPath, m[1])
    const spec = load.spec
    out.push({
      id: m[1],
      title: spec?.title || m[1],
      kind: spec?.kind === 'tool' ? 'tool' : 'dashboard',
      description: spec?.description ?? '',
      path: load.path,
      widgets: spec?.widgets.length ?? 0,
      issues: load.issues.length,
      updatedAt: fs.statSync(path.join(dir, f)).mtimeMs
    })
  }
  // main 먼저, 그다음 대시보드 → 도구, 각각 제목순
  return out.sort((a, b) =>
    a.id === MAIN_BOARD ? -1 : b.id === MAIN_BOARD ? 1 : a.kind !== b.kind ? (a.kind === 'dashboard' ? -1 : 1) : a.title.localeCompare(b.title)
  )
}

/** 도구 보드의 시작 패널 — 입력·스크립트 실행·세션 만들기의 뼈대 */
function toolPanelTemplate(title: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
</head><body>
<div class="aw-page">
  <div class="aw-card aw-stack">
    <h2 class="aw-title">${title.replace(/[<>&]/g, '')}</h2>
    <span class="aw-label">이 도구는 아직 비어 있습니다. 위 입력창에 원하는 동작을 설명하면 빌더 에이전트가 채웁니다.</span>
  </div>
  <div class="aw-card aw-stack">
    <label class="aw-field"><span class="aw-label">입력</span><textarea class="aw-input" id="q" rows="3" placeholder="예: 처리할 내용"></textarea></label>
    <div class="aw-row"><span class="aw-spacer"></span><button class="aw-btn primary" id="go">실행</button></div>
  </div>
  <div class="aw-card"><pre class="aw-mono" id="out" style="margin:0;white-space:pre-wrap"><span class="aw-muted">실행하면 결과가 여기에 나옵니다.</span></pre></div>
</div>
<script>
go.onclick = async () => {
  go.disabled = true
  out.className = 'aw-mono'
  try {
    // 예: 스크립트 실행 → const data = await aw.run('my_tool.py', { text: q.value })
    // 예: 세션에 작업 맡기기 → await aw.createSession({ title: '작업', prompt: q.value })
    const { rows } = await aw.query({ source: 'sessions', agg: { n: { op: 'count' } } })
    out.textContent = '세션 수: ' + rows[0].n + '\\n입력: ' + q.value
  } catch (e) {
    out.className = 'aw-error'
    out.textContent = e.message
  } finally {
    go.disabled = false
  }
}
</script>
</body></html>
`
}

function uniqueBoardId(projectPath: string, base: string): string {
  let id = base
  for (let n = 2; fs.existsSync(boardPath(projectPath, id)); n++) id = `${base}-${n}`.slice(0, 64)
  return id
}

/** 새 보드. 도구는 화면을 채우는 HTML 패널 하나로 시작한다 */
export function createBoard(projectPath: string, input: NewBoardInput): BoardInfo {
  const title = input.title.trim() || (input.kind === 'tool' ? '새 도구' : '새 대시보드')
  const base =
    (input.id?.trim() || title)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || (input.kind === 'tool' ? 'tool' : 'board')
  const id = uniqueBoardId(projectPath, BOARD_ID_RE.test(base) ? base : `b-${base}`.slice(0, 48))
  const spec: DashboardSpec = { version: 1, title, kind: input.kind, description: input.description?.trim() || undefined, widgets: [] }
  if (input.kind === 'tool') {
    let panel = `panels/${id}.html`
    for (let n = 2; fs.existsSync(path.join(projectPath, DASHBOARD_DIR, panel)); n++) panel = `panels/${id}-${n}.html`
    const abs = path.join(projectPath, DASHBOARD_DIR, panel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, toolPanelTemplate(title))
    spec.widgets.push({ id: 'main', type: 'html', src: panel, height: 'fill' })
  } else {
    spec.widgets.push({
      id: 'intro',
      type: 'markdown',
      text: `### ${title}\n위 입력창에 이 대시보드에 보여 줄 내용을 설명하면 빌더 에이전트가 채웁니다.`
    })
  }
  fs.mkdirSync(boardsDir(projectPath), { recursive: true })
  fs.writeFileSync(boardPath(projectPath, id), JSON.stringify(spec, null, 2) + '\n')
  return listBoards(projectPath).find((b) => b.id === id)!
}

/** 형식 검사. 쿼리 실행 오류는 위젯별로 화면에 표시하므로 여기서는 구조만 본다 */
export function validateSpec(spec: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!spec || typeof spec !== 'object') return [{ message: '최상위는 객체여야 합니다' }]
  const s = spec as Partial<DashboardSpec>
  if (s.version !== 1) issues.push({ message: 'version 은 1 이어야 합니다' })
  if (s.kind !== undefined && s.kind !== 'dashboard' && s.kind !== 'tool') issues.push({ message: 'kind 는 dashboard | tool' })
  if (s.suggestions !== undefined && (!Array.isArray(s.suggestions) || s.suggestions.some((x) => typeof x !== 'string')))
    issues.push({ message: 'suggestions 는 문자열 배열 (예시 요청)' })
  if (!Array.isArray(s.widgets)) return [...issues, { message: 'widgets 배열이 필요합니다' }]
  const ids = new Set<string>()
  s.widgets.forEach((w: Partial<Widget>, i) => {
    const label = w?.id ?? `#${i}`
    const add = (message: string): void => void issues.push({ widget: label, message })
    if (!w || typeof w !== 'object') return add('위젯은 객체여야 합니다')
    if (!w.id || typeof w.id !== 'string') add('id(문자열)가 필요합니다')
    else if (ids.has(w.id)) add('id 가 중복됩니다')
    else ids.add(w.id)
    if (!WIDGET_TYPES.includes(w.type as (typeof WIDGET_TYPES)[number])) add(`type 은 ${WIDGET_TYPES.join(' | ')} 중 하나`)
    if (w.w !== undefined && (typeof w.w !== 'number' || w.w < 1 || w.w > 12)) add('w 는 1~12')
    if (w.query) {
      if (!getSource(w.query.source)) add(`알 수 없는 소스 "${w.query.source}"`)
    } else if (w.type !== 'markdown' && w.type !== 'media' && w.type !== 'html') add('query 가 필요합니다')
    if (w.type === 'html') {
      const h = w as { src?: unknown; height?: unknown }
      if (typeof h.src !== 'string' || !/\.html?$/i.test(h.src)) add('html 패널에는 src(.dashboard 기준 .html 경로)가 필요합니다')
      else if (/^[a-z]+:|(^|[\\/])\.\.([\\/]|$)/i.test(h.src)) add('src 는 .dashboard 안의 상대 경로여야 합니다')
      if (h.height !== undefined && h.height !== 'fill' && (typeof h.height !== 'number' || h.height < 40))
        add('height 는 40 이상의 숫자 또는 "fill" (생략하면 내용에 맞춤)')
    }
    if (w.type === 'media') {
      const m = w as { src?: unknown; srcField?: unknown }
      if (!m.src && !(w.query && m.srcField)) add('media 에는 src 또는 query + srcField 가 필요합니다')
      if (typeof m.src === 'string' && /^[a-z]+:/i.test(m.src) && !/^https:\/\//i.test(m.src)) add('src 는 프로젝트 경로 또는 https:// 주소만 됩니다')
    }
    if (w.type === 'table' && !Array.isArray((w as { columns?: unknown }).columns)) add('table 에는 columns 가 필요합니다')
    if (w.type === 'chart') {
      const c = w as { chart?: string; x?: string; y?: string }
      if (!['bar', 'line', 'pie'].includes(c.chart ?? '')) add('chart 는 bar | line | pie')
      if (!c.x || !c.y) add('chart 에는 x, y 가 필요합니다')
    }
    if (w.type === 'list' && !(w as { primary?: string }).primary) add('list 에는 primary 가 필요합니다')
    if (w.type === 'markdown' && typeof (w as { text?: unknown }).text !== 'string') add('markdown 에는 text 가 필요합니다')
  })
  return issues
}

export function loadDashboard(projectPath: string, board: string = MAIN_BOARD): DashboardLoad {
  const file = boardPath(projectPath, board)
  const rel = boardRel(board)
  if (!fs.existsSync(file)) {
    if (board === MAIN_BOARD) return { board, path: rel, spec: DEFAULT_DASHBOARD, issues: [] }
    return { board, path: rel, spec: null, issues: [{ message: `보드가 없습니다: ${rel}` }] }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    return { board, path: rel, spec: null, issues: [{ message: `JSON 파싱 오류: ${(e as Error).message}` }] }
  }
  const issues = validateSpec(parsed)
  const spec = parsed as DashboardSpec
  // 구조가 깨진 위젯만 빼고 나머지는 보여준다
  const broken = new Set(issues.filter((i) => i.widget).map((i) => i.widget))
  const ok = Array.isArray(spec?.widgets)
    ? { ...spec, widgets: spec.widgets.filter((w, i) => !broken.has(w?.id ?? `#${i}`)) }
    : null
  return { board, path: rel, spec: ok, issues }
}

// ───────────────────────── dashboard-builder 스킬

function sourcesDoc(): string {
  return schema()
    .map((s) => {
      const params = s.params?.length ? `\n  - params: ${s.params.map((p) => `\`${p.name}\` ${p.description}`).join(', ')}` : ''
      const time = s.timeField ? ` (since 기준: \`${s.timeField}\`)` : ''
      return `- **${s.name}** — ${s.description}${time}${params}\n  - 필드: ${s.fields.map((f) => `\`${f.name}\``).join(', ')}`
    })
    .join('\n')
}

export function builderSkill(): string {
  return `---
name: ${BUILDER_SKILL}
x-aw-version: ${BUILDER_SKILL_VERSION}
description: Lev 의 보드(${DASHBOARD_DIR} 폴더 — 대시보드와 도구. JSON 위젯, HTML 패널, 데이터 스크립트)를 사용자가 원하는 대로 만들거나 고칠 때 쓴다. 대시보드·도구 새로 만들기, 위젯·패널 추가·삭제·배치 변경, 지표·차트·표·시각화, 입력 폼·버튼이 있는 업무 도구, 외부 데이터 연동 요청이면 이 스킬을 따른다.
---

# 보드 빌더 (대시보드 · 도구)

보드는 \`${DASHBOARD_DIR}/\` 폴더로 정의된다. 파일을 저장하면 앱이 즉시 다시 그린다. **앱 소스 코드는 고치지 않는다.**

\`\`\`
${DASHBOARD_DIR}/
  ${BOARDS_DIR}/<id>.json   보드 하나 = 파일 하나 (main.json 이 기본 대시보드)
  panels/*.html      자유 HTML 패널 (HTML/CSS/JS) — 모든 보드가 함께 씀
  scripts/*          데이터 스크립트 (Python, JS, PowerShell, bash, ruby, php) — 함께 씀
  media/             이미지·GIF·동영상
\`\`\`

## 보드 종류
- **대시보드** (\`"kind": "dashboard"\`, 기본): 지표·차트·목록 모음. 위젯을 12칸 그리드에 배치.
- **도구** (\`"kind": "tool"\`): 입력을 받아 무언가를 하는 작은 앱. 보통 **탭을 채우는 HTML 패널 하나**(\`"height": "fill"\`)로 만든다.
  입력 폼 → \`aw.run\` 으로 스크립트 실행 → 결과 표시 → 필요하면 \`aw.createSession\` / \`aw.sendMessage\` 로 에이전트에게 일을 맡긴다 (사용자 확인 창).

## 보드 파일 형식 (\`${DASHBOARD_DIR}/${BOARDS_DIR}/<id>.json\`)
\`\`\`json
- \`suggestions\`(선택): 요청 입력창 아래에 보일 예시 요청 문자열 배열. 사용자가 눌러 입력창에 채운다. 대시보드를 바꿀 때 지금 화면에 어울리는 다음 요청 3~5개로 갱신해 두면 좋다.
{ "version": 1, "title": "PR 리뷰 도구", "kind": "tool", "description": "PR 번호로 diff 를 보고 리뷰 세션을 만든다",
  "widgets": [ { "id": "main", "type": "html", "src": "panels/pr-review.html", "height": "fill" } ] }
\`\`\`
- 파일 이름(\`<id>\`)은 영문 소문자·숫자·\`-\`·\`_\`. 새 보드는 새 파일을 만들면 바로 앱의 "보드" 메뉴에 나타난다.
- 요청에 어떤 보드인지 적혀 있으면(\`[보드 요청 · ${DASHBOARD_DIR}/${BOARDS_DIR}/x.json]\`) 그 파일을 고친다. 없으면 main.json.
- 패널·스크립트 이름은 다른 보드와 겹치지 않게, 보드 id 를 앞에 붙이는 것을 권장한다 (예: \`panels/pr-review.html\`, \`scripts/pr_review_diff.mjs\`).

## 어떤 방식으로 만들까
- **간단한 숫자·표·목록·막대/선/원 차트** → JSON 기본 위젯 (아래 "위젯 종류"). 빠르고 틀리기 어렵다.
- **그 밖의 모든 것** (복잡한 시각화, 인터랙션, 탭·필터, 애니메이션, 커스텀 레이아웃, 여러 데이터 조합, 도구) → **HTML 패널**.
- **앱에 없는 데이터·동작** (외부 API, DB, git·파일 처리, 로그 분석, 복잡한 계산) → **스크립트**를 만들고 HTML 패널(\`aw.run\`)이나 JSON 위젯(\`script\` 소스)에서 쓴다.

## 작업 순서
1. \`aw_list_boards\` 로 보드 목록을 보고, 고칠 보드 파일을 읽는다 (새로 만들면 새 파일).
2. 필요한 데이터가 어떤 소스·필드에 있는지 아래 표 또는 \`aw_schema\` 도구로 확인한다. 쿼리는 \`aw_query\` 로 먼저 실행해 본다.
3. 스크립트를 만들었다면 \`aw_run_script\` 로 실행해 출력 JSON 을 확인한다 (처음엔 사용자에게 승인 창이 뜬다).
4. 패널 파일·위젯을 추가·수정하고 보드 파일에 등록한다. 같은 보드 안에서 위젯 id 가 겹치지 않게 한다.
5. \`aw_dashboard_validate\` (\`board\` 인자)로 검증하고(형식 오류·위젯별 결과·패널 파일 존재), 무엇을 바꿨는지 사용자에게 짧게 알린다.

## HTML 패널
보드 파일에 등록: \`{"id":"cost","type":"html","title":"비용","src":"panels/cost.html","w":6}\`
- \`src\`: ${DASHBOARD_DIR} 기준 경로. \`height\`(px)를 생략하면 내용 높이에 자동으로 맞추고, \`"fill"\` 이면 탭 높이를 채운다(도구). \`network: true\` 면 https fetch·외부 이미지 허용 (기본 차단).
- 패널은 샌드박스 iframe 에서 돈다. 앱 DOM·localStorage·Node 에 접근할 수 없고, 데이터는 **window.aw** 로만 받는다.
- 앱 테마 CSS 변수가 미리 들어 있다: \`--aw-bg --aw-card --aw-line --aw-text --aw-text-2 --aw-muted --aw-accent --aw-ok --aw-warn --aw-bad --aw-claude --aw-codex --aw-gemini --aw-mono\`. 배경은 투명(카드 색이 비침)이다.
- 외부 라이브러리는 CDN 에서만 불러올 수 있다: cdn.jsdelivr.net, cdnjs.cloudflare.com, unpkg.com, esm.sh. 또는 파일을 ${DASHBOARD_DIR}/ 안에 두고 상대 경로로 불러온다.
- **모양은 반드시 같은 폴더의 \`${STYLE_GUIDE_FILE}\` 를 따른다** (패널을 만들거나 고치기 전에 읽는다). 요약:
  - \`.aw-page .aw-card .aw-grid .aw-title .aw-label .aw-value .aw-btn .aw-input .aw-table .aw-list .aw-badge .aw-empty .aw-error .aw-skeleton .aw-chart\` 같은 기본 클래스가 자동 주입된다. 직접 CSS 를 쓰기보다 이 클래스를 조합한다.
  - 색은 \`--aw-*\` 변수만, 카드 12px·버튼/입력 8px, 카드 안 여백 16px 이상, 큰 숫자는 tabular-nums, 고정폭 글꼴은 코드·경로에만, 가로 스크롤 금지.
  - 차트는 가이드의 막대(둥근 모서리+그라데이션)·선(영역 채우기)·도넛(얇은 링+틈+가운데 합계) 예시를 쓴다.

### window.aw
| API | 설명 |
|---|---|
| \`await aw.query(query)\` | 데이터 조회 (쿼리 형식은 아래) → \`{rows, columns, total}\` |
| \`await aw.schema()\` | 소스·필드 목록 |
| \`await aw.run('x.mjs', args, {timeout})\` | 스크립트 실행 → stdout JSON (\`aw.runRaw\` 는 실행 시간·stderr 포함) |
| \`await aw.scripts()\` | 스크립트 목록·승인 여부 |
| \`aw.on('state', fn)\` | 앱 상태가 바뀔 때마다 (세션 실행·종료 등) — 여기서 다시 조회 |
| \`aw.openSession(id)\` \`aw.openFile(rel)\` \`aw.openView('multi')\` | 앱 안 이동 |
| \`await aw.sendMessage(sessionId, prompt)\` | 세션에 메시지 보내기 — **사용자 확인 창**을 거친다 |
| \`await aw.createSession({title, prompt, provider, model})\` | 세션 만들고 실행 — 사용자 확인 |
| \`await aw.stopSession(sessionId)\` | 세션 중지 — 사용자 확인 |
| \`await aw.saveJSON(path, value)\` · \`await aw.saveFile(path, text, {encoding})\` | \`${DASHBOARD_DIR}/data/\` 안에 저장 (최대 20MB). 처음엔 사용자 확인, 이후 "항상 허용" 가능. \`encoding: 'base64'\` 면 바이너리(PNG 등, data URL 도 됨) |
| \`await aw.readJSON(path)\` · \`await aw.readFile(path, {encoding})\` | \`${DASHBOARD_DIR}/data/\` 에서 읽기 (확인 없음) |
| \`await aw.listFiles(dir)\` | \`${DASHBOARD_DIR}/data/\` 아래 파일 목록 \`[{path, dir, size, mtime}]\` |
| \`await aw.saveAs(content, {name, encoding})\` | OS 저장 대화상자로 사용자가 고른 위치에 저장 (내보내기용). 취소하면 null |
| \`aw.fileUrl(rel)\` | 프로젝트 파일(이미지·동영상) 주소 — \`<img src>\`·\`<video src>\` 에 쓴다 |
| \`await aw.context()\` | 프로젝트 id·이름, 위젯 id |

예시 (\`panels/sessions.html\`):
\`\`\`html
<!doctype html>
<html><head><meta charset="utf-8">
<style> .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--aw-line)} .ok{color:var(--aw-ok)} </style>
</head><body>
<div id="list">불러오는 중…</div>
<script>
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
async function render() {
  try {
    const { rows } = await aw.query({ source: 'sessions', sort: '-updatedAt', limit: 8 })
    list.innerHTML = rows.map(r => '<div class="row"><a href="#" data-id="' + esc(r.id) + '">' + esc(r.title) + '</a><span class="' + (r.status === 'idle' ? 'ok' : '') + '">' + esc(r.status) + '</span></div>').join('')
  } catch (e) {
    list.textContent = '오류: ' + e.message
  }
}
list.addEventListener('click', (e) => { const a = e.target.closest('a'); if (a) { e.preventDefault(); aw.openSession(a.dataset.id) } })
aw.on('state', render)
render()
</script>
</body></html>
\`\`\`
- **도구의 작업 결과는 저장한다.** 편집기형 도구는 \`aw.saveJSON('<보드 id>/<이름>.json', data)\` 로 \`${DASHBOARD_DIR}/data/<보드 id>/\` 에 저장하고, 열 때 \`aw.listFiles('<보드 id>')\` + \`aw.readJSON\` 으로 불러온다. 저장 경로는 보드 id 폴더 아래로 정해 다른 도구와 섞이지 않게 한다.
- 다른 곳(게임 프로젝트 폴더 등)으로 내보낼 때는 \`aw.saveAs\` 를 쓴다. **\`<a download>\`·Blob 다운로드는 샌드박스에서 막혀 동작하지 않는다.** 클립보드 쓰기도 막혀 있을 수 있으니 복사 버튼만 두지 말고 저장 버튼을 함께 둔다.
- 쓰기 동작(aw.sendMessage, aw.saveFile 등)은 **버튼 클릭처럼 사용자 행동에 대해서만** 부른다. 로딩·타이머·state 이벤트에서 자동으로 부르지 않는다 (확인 창이 계속 뜨고, 1분 20회 제한에 걸린다). 거부되면 예외가 나므로 catch 해서 패널에 표시한다.
- 사용자에게서 온 값(세션 제목 등)을 innerHTML 로 넣을 때는 이스케이프하거나 textContent 를 쓴다.
- **요소는 document.getElementById 로 잡는다.** id 를 전역 변수처럼 쓰면 \`open\`, \`close\`, \`name\`, \`status\`, \`top\`, \`parent\`, \`length\`, \`history\`, \`location\` 같은 window 기본 속성과 겹쳐 엉뚱한 값이 된다 (예: id="open" → \`open.addEventListener\` 오류로 스크립트 전체가 멈춤).
- 패널을 고친 뒤 \`aw_dashboard_validate\` 의 결과에 \`패널 실행 오류\` 가 있으면, 앱에서 그 패널을 열었을 때 실제로 난 오류다 — 고친다. (파일을 저장하면 그 오류는 사라지고, 패널이 다시 열릴 때 새로 확인된다)
- 오류는 화면에 보여준다 (try/catch 로 잡아 패널 안에 표시).

## 스크립트 (${DASHBOARD_DIR}/scripts)
- **기본 언어는 Node.js** (\`.mjs\` 권장 — ESM, \`import\` 사용). 앱에 들어 있는 Node 로 돌아가서 사용자 PC 에 아무것도 설치할 필요가 없다. 내장 \`fetch\`, \`node:fs\`, \`node:child_process\`(git 등) 를 쓸 수 있다.
- 다른 언어는 사용자가 원할 때만, 그리고 \`aw_list_scripts\` 의 \`runtimes\` 에서 true 인 것만 쓴다 (Python 이 없는 PC 가 많다).
- 실행: .mjs/.js/.cjs → 앱 내장 Node, .py → Python 3, .ps1 → PowerShell, .sh → bash, .rb → ruby, .php → php. 작업 디렉터리는 프로젝트 루트. (.js 는 CommonJS — \`require\` 를 쓴다)
- npm 패키지가 꼭 필요하면 프로젝트의 node_modules 에 이미 있는 것만 쓴다. 없으면 내장 모듈로 해결한다 (설치하지 않는다).
- 입력: 인자 JSON 이 **stdin** 과 환경 변수 \`AW_SCRIPT_ARGS\` 로 들어온다. \`AGENT_WORKSPACE_API/_TOKEN/_PROJECT\` 도 있어 스크립트 안에서 Data API 를 부를 수 있다.
- 출력: **stdout 에 JSON 하나만** 쓴다 (로그는 stderr). JSON 이 아니면 \`{"text": ...}\` 로 감싸진다. 종료 코드가 0 이 아니면 오류로 처리된다.
- 제한: 기본 30초(최대 300초, timeout 옵션), 출력 5MB. 같은 스크립트·인자로 실행 중이면 결과를 같이 받는다.
- **처음 실행하거나 내용이 바뀌면 사용자에게 승인 창이 뜬다.** 사용자가 읽고 판단할 수 있게 짧고 분명하게 쓰고, 맨 위에 무엇을 하는지 주석으로 적는다. 비밀 값(토큰 등)을 코드에 넣지 않는다 — 환경 변수에서 읽는다.
- JSON 위젯에서 쓰기: \`{"source":"script","params":{"name":"github_prs.mjs","args":"{\\"repo\\":\\"org/app\\"}"}}\` (결과가 배열이면 행, \`{"rows":[...]}\` 도 됨)

예시 (\`scripts/todo_count.mjs\`):
\`\`\`js
// 프로젝트의 TODO 주석 개수를 파일별로 센다 (args.root 폴더, 기본 src)
import fs from 'node:fs'
import path from 'node:path'

const args = JSON.parse(process.env.AW_SCRIPT_ARGS || '{}')
const root = args.root || 'src'
const rows = []
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) walk(p); continue }
    const n = (fs.readFileSync(p, 'utf8').match(/TODO/g) || []).length
    if (n) rows.push({ file: p.split(path.sep).join('/'), todos: n })
  }
}
if (fs.existsSync(root)) walk(root)
console.log(JSON.stringify(rows.sort((a, b) => b.todos - a.todos)))
\`\`\`
- git 같은 명령: \`import { execFileSync } from 'node:child_process'\` → \`execFileSync('git', ['log', '--oneline', '-20'], { encoding: 'utf8' })\`
- 외부 API: 내장 \`await fetch(url)\` (토큰은 환경 변수에서)

## 도구
앱이 실행한 세션에는 \`agent_workspace\` MCP 서버가 연결되어 있다. 도구 이름은 CLI 에 따라 \`mcp__agent_workspace__aw_query\` 처럼 보인다.
**다른 MCP 서버의 비슷한 도구(세션 목록 등)와 헷갈리지 말고 이 서버의 aw_ 도구를 쓴다.**

| 도구 | 설명 |
|---|---|
| \`aw_schema\` | 소스·필드 목록 |
| \`aw_query\` | \`{"query": {...}}\` 쿼리 실행 |
| \`aw_list_boards\` | 보드(대시보드·도구) 목록 |
| \`aw_dashboard\` | 보드 정의와 형식 오류 (\`board\`, 생략 시 main) |
| \`aw_dashboard_validate\` | 보드 검증 (\`board\`, \`spec\` 생략 시 저장된 파일) |
| \`aw_projects\` | 프로젝트 목록 |
| \`aw_list_scripts\` | 스크립트 목록·승인 여부 |
| \`aw_run_script\` | \`{"script":"x.mjs","args":{...}}\` 스크립트 실행 (처음엔 사용자 승인) |
| \`aw_send_message\` · \`aw_create_session\` · \`aw_stop_session\` | 다른 세션에 메시지·세션 생성(child 가능)·중지 — 사용자 확인. 대시보드 작업에는 보통 필요 없다 |

MCP 도구가 보이지 않으면 아래 \`aw\` 명령을 쓴다.

## 파일 형식
\`\`\`json
{
  "version": 1,
  "title": "프로젝트 대시보드",
  "widgets": [ { "id": "고유-id", "type": "kpi", "title": "제목", "w": 3, "query": { ... } } ]
}
\`\`\`
- 위젯은 순서대로 12칸 그리드에 배치된다. \`w\` = 폭(1~12, 기본 12). 한 줄 합이 12 를 넘으면 다음 줄로 간다.
- 공통 키: \`id\`(필수), \`type\`, \`title\`, \`w\`, \`minHeight\`, \`query\`, \`refresh\`("live" | "manual" | ms 숫자), \`empty\`(결과 없을 때 문구), \`actions\`(카드 오른쪽 위 버튼)

### 위젯 종류
| type | 추가 키 | 설명 |
|---|---|---|
| kpi | \`value\`(열, 기본 첫 열), \`format\`, \`sub\`("{{열}}" 템플릿), \`warnAbove\` | 큰 숫자 하나 |
| table | \`columns\`: [{field, label, format, colors, align}], \`rowAction\` | 표 |
| list | \`primary\`, \`secondary\`, \`time\`, \`timeFormat\`, \`dot\`: {field, colors}, \`rowAction\` | 타임라인·목록 |
| chart | \`chart\`: bar \\| line \\| pie, \`x\`, \`y\`, \`format\`, \`color\` | 차트 (x 는 그룹 열, y 는 숫자 열) |
| markdown | \`text\` ("{{열}}" 은 쿼리 첫 행 값, query 생략 가능) | 설명·메모 |
| pipeline | (query 는 multiRunSteps) | 멀티 실행 단계 진행 |
| html | \`src\`, \`height\`, \`network\` (query 없음) | 자유 HTML 패널 — 위 "HTML 패널" 참고 |
| media | \`src\` 또는 query + \`srcField\`, \`caption\`/\`captionField\`, \`kind\`(image\\|video, 기본 확장자로), \`fit\`(cover\\|contain), \`height\`, \`columns\`(갤러리 칸 수), \`autoplay\`, \`loop\`, \`controls\` | 이미지·GIF·동영상 (하나 또는 갤러리) |

### 이미지·GIF·동영상
- \`src\` 는 프로젝트 기준 경로(예: \`${DASHBOARD_DIR}/media/demo.gif\`) 또는 \`https://\` 주소. 미디어 파일은 \`${DASHBOARD_DIR}/media/\` 에 두는 것을 권장한다.
- 폴더 전체를 갤러리로: \`{"type":"media","query":{"source":"files","params":{"path":"${DASHBOARD_DIR}/media"},"where":{"kind":{"in":["image","video"]}},"sort":"-mtime"},"srcField":"rel","captionField":"name","columns":3}\`
- 동영상 자동재생은 음소거·반복으로 재생된다: \`{"type":"media","src":"${DASHBOARD_DIR}/media/intro.mp4","autoplay":true}\`

- \`format\`: text, number, currency, percent, time, datetime, ago, elapsed(시각부터 지금까지), bytes, badge(CLI 색 배지), code
- \`colors\`: 값 → 색. 색은 ok, bad, warn, accent, muted 또는 "#rrggbb"
- 동작(\`rowAction\`, \`actions\`): \`{"do":"openSession","field":"id"}\`, \`{"do":"openFile","path":"README.md"}\` 또는 \`{"do":"openFile","field":"rel"}\`, \`{"do":"openView","view":"multi|skills|assets|cli|projects"}\`. actions 항목에는 \`label\` 도 넣는다.

## 쿼리 형식
\`\`\`json
{
  "source": "turns",
  "since": "7d",
  "where": { "provider": "claude", "costUsd": { "gt": 0 } },
  "groupBy": "day(at)",
  "agg": { "cost": { "op": "sum", "field": "costUsd" }, "fails": { "op": "count", "where": { "ok": false } } },
  "sort": "-cost",
  "limit": 10
}
\`\`\`
- \`where\` 조건: 값(같음) 또는 {eq, ne, in, gt, gte, lt, lte, contains, exists}
- \`since\`: 1h, 24h, today, 7d, 30d (소스의 시간 필드 기준)
- \`groupBy\`: 필드 또는 hour(필드), day(필드), week(필드), month(필드). day 묶음은 빈 날을 0 으로 채운다.
- \`agg\`: 결과 열 이름 → {op: count|sum|avg|min|max, field, where}. groupBy 만 있고 agg 가 없으면 count.
- 참/거짓 필드는 1/0 으로 계산된다. 예: \`{"op":"avg","field":"ok"}\` = 성공률(0~1) → 위젯 \`format: "percent"\`
- \`project\`: 생략하면 현재 프로젝트, "all" 이면 전체 프로젝트
- 결과: \`{ rows: [...], columns: [...], total }\` — kpi 는 첫 행, chart 는 행마다 x/y.

## 데이터 소스 (작성 시점 기준 — 최신은 GET /api/schema)
${sourcesDoc()}

다른 정보가 필요하면 그 값을 JSON/CSV 파일로 \`${DASHBOARD_DIR}/data/\` 에 만들어 두고 \`file\` 소스로 읽는다.

## aw 명령 (MCP 를 못 쓸 때)
앱이 실행한 에이전트의 PATH 에는 \`aw\` 명령이 있다. 토큰·주소·프로젝트는 aw 가 알아서 붙이므로 **셸에 $변수나 JSON 을 직접 쓰지 말고 aw 를 쓴다.**

| 명령 | 설명 |
|---|---|
| \`aw schema\` | 소스·필드 목록 |
| \`aw query <파일.json>\` | 쿼리 실행 — 쿼리 JSON 은 파일로 저장해서 넘긴다 |
| \`aw dashboard [보드]\` | 보드 정의와 형식 오류 |
| \`aw boards\` | 보드 목록 |
| \`aw validate [보드] [파일.json]\` | 보드 검증 (보드 생략 시 main, 파일 생략 시 저장된 보드 파일) |

임시 쿼리 파일은 \`${DASHBOARD_DIR}/.tmp/\` 에 두고 끝나면 지워도 된다.

## Workspace Data API (HTTP — aw 를 못 쓸 때)
앱이 실행한 에이전트에는 환경 변수가 주어진다.
- \`AGENT_WORKSPACE_API\` — 예: http://127.0.0.1:52341
- \`AGENT_WORKSPACE_TOKEN\` — 모든 요청에 \`Authorization: Bearer <토큰>\` 헤더
- \`AGENT_WORKSPACE_PROJECT\` — 현재 프로젝트 id. **모든 요청 URL 에 \`?project=<이 값>\` 을 붙인다**

| 요청 | 설명 |
|---|---|
| GET /api/schema | 소스·필드 목록 |
| POST /api/query | 본문 = 쿼리 JSON |
| GET /api/dashboard | 현재 대시보드와 형식 오류 |
| POST /api/dashboard/validate | 본문 = 대시보드 JSON (생략하면 파일) → 형식 오류와 위젯별 쿼리 결과 행 수 |

bash:
\`\`\`bash
curl -s -H "Authorization: Bearer $AGENT_WORKSPACE_TOKEN" -H "Content-Type: application/json" \\
  -d '{"source":"sessions","groupBy":"provider","agg":{"cost":{"op":"sum","field":"costUsd"}}}' \\
  "$AGENT_WORKSPACE_API/api/query?project=$AGENT_WORKSPACE_PROJECT"
\`\`\`
PowerShell:
\`\`\`powershell
Invoke-RestMethod -Method Post -Uri "$env:AGENT_WORKSPACE_API/api/query?project=$env:AGENT_WORKSPACE_PROJECT" -Headers @{ Authorization = "Bearer $env:AGENT_WORKSPACE_TOKEN" } -ContentType 'application/json' -Body '{"source":"activity","limit":5}'
\`\`\`

## 주의
- 대시보드 파일 말고 다른 파일(앱 소스 코드, ${SKILLS_DIR} 등)은 고치지 않는다.
- JSON 이 깨지면 대시보드 전체가 오류로 표시되니 저장 전에 형식을 확인한다.
- 사용자가 원하는 정보가 소스에 없으면 지어내지 말고, 없다고 말한 뒤 file 소스 같은 대안을 제안한다.
`
}

/**
 * dashboard-builder 스킬이 없거나 앱이 만든 옛 버전이면 새로 쓴다.
 * 사용자가 x-aw-version 줄을 지우면 직접 관리하는 것으로 보고 덮어쓰지 않는다.
 */
export function ensureBuilderSkill(projectPath: string): void {
  const dir = path.join(projectPath, SKILLS_DIR, BUILDER_SKILL)
  const file = path.join(dir, 'SKILL.md')
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, 'utf8')
    const v = /^x-aw-version:\s*(\d+)/m.exec(text)
    // 버전 줄이 생기기 전에 앱이 만든 첫 버전
    const legacy = !v && text.includes('# 대시보드 빌더') && text.includes('AGENT_WORKSPACE_TOKEN')
    if (!legacy && (!v || Number(v[1]) >= BUILDER_SKILL_VERSION)) return
  }
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, builderSkill())
  fs.writeFileSync(path.join(dir, STYLE_GUIDE_FILE), styleGuide())
}

/**
 * 대시보드 위젯과 Workspace Data API 가 함께 쓰는 쿼리·위젯 형식.
 * 위젯 JSON 의 "query" 와 HTTP API 의 POST /api/query 본문은 같은 Query 다.
 */

export const DASHBOARD_DIR = '.dashboard'
/** 예전 버전의 단일 대시보드 파일 — boards/main.json 으로 옮긴다 */
export const DASHBOARD_FILE = 'dashboard.json'
/** 보드(대시보드·도구) 파일 폴더: .dashboard/boards/<id>.json */
export const BOARDS_DIR = 'boards'
export const MAIN_BOARD = 'main'
export const BOARD_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

export const boardRel = (id: string): string => `${DASHBOARD_DIR}/${BOARDS_DIR}/${id}.json`

export type BoardKind = 'dashboard' | 'tool'

export interface BoardInfo {
  id: string
  title: string
  kind: BoardKind
  description: string
  /** 프로젝트 기준 파일 경로 */
  path: string
  widgets: number
  /** JSON·형식 오류 수 */
  issues: number
  updatedAt: number
}

export interface NewBoardInput {
  title: string
  kind: BoardKind
  description?: string
  /** 비우면 제목에서 만든다 */
  id?: string
}

// ───────────────────────── 쿼리

/** 필드 조건. 값만 쓰면 같음(eq) 비교 */
export type Cond =
  | string
  | number
  | boolean
  | null
  | {
      eq?: unknown
      ne?: unknown
      in?: unknown[]
      gt?: number | string
      gte?: number | string
      lt?: number | string
      lte?: number | string
      contains?: string
      exists?: boolean
    }

export type AggOp = 'count' | 'sum' | 'avg' | 'min' | 'max'

export interface AggSpec {
  op: AggOp
  field?: string
  /** 이 조건을 만족하는 행만 집계 (countIf 등) */
  where?: Record<string, Cond>
}

export interface Query {
  /** 데이터 소스 이름 (GET /api/schema 참고) */
  source: string
  /** 기본은 현재 프로젝트. "all" 이면 모든 프로젝트 */
  project?: string
  /** 소스별 인자 (예: file 소스의 path) */
  params?: Record<string, string>
  where?: Record<string, Cond>
  /** 소스의 시간 필드 기준 기간: "1h" "24h" "today" "7d" "30d" */
  since?: string
  /** 필드 이름, 또는 "day(at)" "hour(at)" "month(at)" 로 시간 묶기 */
  groupBy?: string | string[]
  /** 결과 열 이름 → 집계. groupBy 만 있고 agg 가 없으면 count */
  agg?: Record<string, AggSpec>
  select?: string[]
  /** "field" 오름차순, "-field" 내림차순 */
  sort?: string | string[]
  limit?: number
}

export type Row = Record<string, unknown>

export interface QueryResult {
  rows: Row[]
  columns: string[]
  /** 집계 전 행 수 */
  total: number
}

export interface FieldSchema {
  name: string
  type: 'string' | 'number' | 'boolean' | 'time' | 'id'
  description: string
}

export interface SourceSchema {
  name: string
  description: string
  /** since 가 기준으로 삼는 필드 */
  timeField?: string
  params?: { name: string; description: string; required?: boolean }[]
  fields: FieldSchema[]
  /** 위젯 기본 갱신 방식 */
  refresh: 'live' | 'interval'
}

// ───────────────────────── 위젯

/** ok/bad/warn/accent/muted 또는 #hex */
export type ColorName = string

export type Format = 'text' | 'number' | 'currency' | 'percent' | 'time' | 'datetime' | 'ago' | 'elapsed' | 'bytes' | 'badge' | 'code'

export interface Column {
  field: string
  label?: string
  format?: Format
  /** 값 → 색 (예: { "error": "bad", "running": "accent" }) */
  colors?: Record<string, ColorName>
  align?: 'left' | 'right'
}

/** 행이나 버튼을 눌렀을 때. 지금은 앱 안 이동만 (쓰기 동작은 다음 단계) */
export type WidgetAction =
  | { do: 'openSession'; field?: string }
  | { do: 'openFile'; path?: string; field?: string }
  | { do: 'openView'; view: 'projects' | 'multi' | 'skills' | 'assets' | 'cli' }

export interface WidgetBase {
  id: string
  title?: string
  /** 12칸 그리드에서 차지하는 폭 (1~12, 기본 12) */
  w?: number
  /** 카드 최소 높이(px) */
  minHeight?: number
  query?: Query
  /** "live" = 앱 상태가 바뀔 때마다, 숫자 = 그 ms 간격, "manual" = 새로고침 때만 */
  refresh?: 'live' | 'manual' | number
  empty?: string
  actions?: (WidgetAction & { label: string })[]
}

export interface KpiWidget extends WidgetBase {
  type: 'kpi'
  /** 표시할 값의 열 이름 (기본: 첫 열) */
  value?: string
  format?: Format
  /** 아래 작은 글씨. {{열이름}} 로 값 끼워 넣기 */
  sub?: string
  /** 값이 이 이상이면 경고색 */
  warnAbove?: number
}

export interface TableWidget extends WidgetBase {
  type: 'table'
  columns: Column[]
  rowAction?: WidgetAction
}

export interface ListWidget extends WidgetBase {
  type: 'list'
  primary: string
  secondary?: string
  time?: string
  timeFormat?: Format
  /** 점 색을 정할 필드와 값→색 */
  dot?: { field: string; colors: Record<string, ColorName> }
  rowAction?: WidgetAction
}

export interface ChartWidget extends WidgetBase {
  type: 'chart'
  chart: 'bar' | 'line' | 'pie'
  x: string
  y: string
  format?: Format
  color?: ColorName
}

export interface MarkdownWidget extends WidgetBase {
  type: 'markdown'
  /** {{열이름}} 은 쿼리 첫 행의 값으로 바뀜 */
  text: string
}

export interface PipelineWidget extends WidgetBase {
  type: 'pipeline'
}

/**
 * 이미지·GIF·동영상. src 하나를 보여주거나, query 결과의 srcField 로 갤러리를 만든다.
 * src: 프로젝트 기준 경로(.dashboard/media/a.png) 또는 https:// 주소
 */
export interface MediaWidget extends WidgetBase {
  type: 'media'
  src?: string
  srcField?: string
  captionField?: string
  caption?: string
  /** 기본: 확장자로 판단 (mp4/webm/mov/ogg → video) */
  kind?: 'image' | 'video'
  fit?: 'cover' | 'contain'
  /** 미디어 높이(px). 갤러리면 칸 하나의 높이 */
  height?: number
  /** 갤러리 한 줄 칸 수 (기본 3) */
  columns?: number
  /** 동영상: 기본 controls=true, 자동재생이면 음소거·반복 */
  autoplay?: boolean
  loop?: boolean
  controls?: boolean
}

/**
 * 자유 HTML 패널. .dashboard 안의 HTML 파일을 샌드박스 iframe 으로 띄우고,
 * 패널 안에서는 window.aw 브리지로 데이터 조회·스크립트 실행·앱 이동을 한다.
 */
export interface HtmlWidget extends WidgetBase {
  type: 'html'
  /** .dashboard 기준 경로 (예: panels/cost.html) */
  src: string
  /** 높이(px). 생략하면 패널 내용 높이에 맞추고, "fill" 이면 탭 높이를 채운다 (도구용) */
  height?: number | 'fill'
  /** true 면 패널에서 https 로 fetch·이미지 로드 허용 (기본: 차단) */
  network?: boolean
}

export type Widget = KpiWidget | TableWidget | ListWidget | ChartWidget | MarkdownWidget | PipelineWidget | MediaWidget | HtmlWidget

export const WIDGET_TYPES = ['kpi', 'table', 'list', 'chart', 'markdown', 'pipeline', 'media', 'html'] as const

// ───────────────────────── 패널 ↔ 앱 브리지 (postMessage)

export const PANEL_SCHEME = 'ws-panel'

export type BridgeMethod =
  | 'query' | 'schema' | 'run' | 'scripts' | 'context' | 'openSession' | 'openFile' | 'openView' | 'resize' | 'write'
  | 'fileRead' | 'fileList' | 'fileSave' | 'saveAs'

/** 패널이 읽고 쓸 수 있는 폴더 (.dashboard 기준) */
export const PANEL_DATA_DIR = 'data'
/** 패널 파일 하나의 최대 크기 */
export const PANEL_FILE_MAX = 20 * 1024 * 1024

export type FileEncoding = 'utf8' | 'base64'

export interface DataFileEntry {
  /** .dashboard/data 기준 경로 (posix) */
  path: string
  dir: boolean
  size: number
  mtime: number
}

export interface BridgeCall {
  __aw: 1
  type: 'call'
  id: number
  method: BridgeMethod
  params?: Record<string, unknown>
}

export interface BridgeReply {
  __aw: 1
  type: 'reply'
  id: number
  ok: boolean
  result?: unknown
  error?: string
}

export interface BridgeEvent {
  __aw: 1
  type: 'event'
  event: 'state'
  data: unknown
}

// ───────────────────────── 스크립트

export const SCRIPTS_DIR = 'scripts'

export interface ScriptInfo {
  /** .dashboard/scripts 기준 경로 (예: github_prs.py) */
  name: string
  /** 실행 방법 설명 (예: python, node) */
  runtime: string
  /** 현재 내용이 승인되었는지 */
  trusted: boolean
  size: number
}

export interface ScriptRunOptions {
  /** 초 (기본 30, 최대 300) */
  timeout?: number
}

export interface ScriptResult {
  /** stdout 이 JSON 이면 그 값, 아니면 { text } */
  data: unknown
  durationMs: number
  stderr: string
}

export const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogg|ogv)$/i
export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i

export interface DashboardSpec {
  version: 1
  title?: string
  /** dashboard(기본) = 지표 모음, tool = 입력·동작이 있는 작은 앱 */
  kind?: BoardKind
  description?: string
  /** 요청 입력창 아래에 보여 줄 예시 요청 (누르면 입력창에 채워진다) */
  suggestions?: string[]
  widgets: Widget[]
}

export interface ValidationIssue {
  widget?: string
  message: string
}

export interface DashboardLoad {
  board: string
  /** 프로젝트 기준 경로 */
  path: string
  spec: DashboardSpec | null
  /** JSON 파싱·형식 오류 */
  issues: ValidationIssue[]
}

export interface ApiInfo {
  url: string
  /** 렌더러에는 토큰을 보여주되 저장하지 않는다 */
  token: string
}

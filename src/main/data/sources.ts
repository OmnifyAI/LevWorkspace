import fs from 'node:fs/promises'
import type { Row, SourceSchema } from '../../shared/dashboard'
import { DASHBOARD_DIR, IMAGE_EXT, VIDEO_EXT } from '../../shared/dashboard'
import { gitStatus, resolveIn } from '../files'
import type { Workspace } from '../workspace'

interface SourceDef extends SourceSchema {
  /** 프로젝트 하나(또는 전체) 의 행을 만든다 */
  rows(ws: Workspace, projectIds: string[], params: Record<string, string>): Promise<Row[]> | Row[]
}

const f = (name: string, type: SourceSchema['fields'][number]['type'], description: string) => ({ name, type, description })

const PROVIDER_STATE = { off: '꺼짐', checking: '확인 중', ok: '연결됨', missing: '미설치' } as const

/** 파일 내용을 행으로: JSON(배열/객체), CSV, 그 외 텍스트 */
function parseFileRows(text: string, file: string): Row[] {
  if (/\.json$/i.test(file)) {
    const v = JSON.parse(text)
    if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? x : { value: x }))
    return [v && typeof v === 'object' ? v : { value: v }]
  }
  if (/\.csv$/i.test(file)) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim())
    const head = (lines.shift() ?? '').split(',').map((h) => h.trim())
    return lines.map((l) => {
      const cells = l.split(',')
      const row: Row = {}
      head.forEach((h, i) => {
        const raw = (cells[i] ?? '').trim()
        row[h] = raw !== '' && !isNaN(Number(raw)) ? Number(raw) : raw
      })
      return row
    })
  }
  return [{ content: text, lines: text.split(/\r?\n/).length }]
}

export const SOURCES: SourceDef[] = [
  {
    name: 'sessions',
    description: '에이전트 세션 (자식 에이전트·멀티 실행 세션 포함)',
    timeField: 'updatedAt',
    refresh: 'live',
    fields: [
      f('id', 'id', '세션 id'),
      f('title', 'string', '제목'),
      f('provider', 'string', 'CLI: claude | codex | gemini'),
      f('model', 'string', '모델 (빈 문자열이면 CLI 기본값)'),
      f('status', 'string', 'idle | running | error'),
      f('costUsd', 'number', '누적 비용 (USD)'),
      f('queue', 'number', '대기 중인 프롬프트 수'),
      f('currentStep', 'string', '실행 중일 때 지금 하는 일'),
      f('runStartedAt', 'time', '현재 턴 시작 시각 (실행 중일 때만)'),
      f('parentId', 'id', '부모 세션 id (자식 에이전트일 때)'),
      f('isChild', 'boolean', '자식 에이전트 여부'),
      f('depth', 'number', '부모-자식 깊이 (0 = 루트)'),
      f('multiRunId', 'id', '멀티 실행에 속하면 그 id'),
      f('allowDelegation', 'boolean', '하위 에이전트 위임 허용'),
      f('skillCount', 'number', '연결된 스킬 수'),
      f('lastError', 'string', '마지막 오류'),
      f('createdAt', 'time', '생성 시각'),
      f('updatedAt', 'time', '마지막 변경 시각'),
      f('projectId', 'id', '프로젝트 id')
    ],
    rows: (ws, pids) =>
      ws.store.db.sessions
        .filter((s) => pids.includes(s.projectId))
        .map((s) => ({
          id: s.id,
          title: s.title,
          provider: s.provider,
          model: s.model,
          status: s.status,
          costUsd: s.costUsd ?? 0,
          queue: s.queue.length,
          currentStep: s.currentStep ?? null,
          runStartedAt: s.runStartedAt ?? null,
          parentId: s.parentId ?? null,
          isChild: !!s.parentId,
          depth: s.depth,
          multiRunId: s.multiRunId ?? null,
          allowDelegation: s.allowDelegation,
          skillCount: s.skillIds.length,
          lastError: s.lastError ?? null,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          projectId: s.projectId
        }))
  },
  {
    name: 'turns',
    description: '끝난 턴 하나하나의 기록 — 비용 추이, 성공률, 소요 시간 집계에 쓴다',
    timeField: 'at',
    refresh: 'live',
    fields: [
      f('id', 'id', '기록 id'),
      f('at', 'time', '턴이 끝난 시각'),
      f('sessionId', 'id', '세션 id'),
      f('provider', 'string', 'CLI'),
      f('model', 'string', '모델'),
      f('ok', 'boolean', '성공 여부'),
      f('costUsd', 'number', '이 턴의 비용 (USD, claude 만 보고)'),
      f('durationMs', 'number', '소요 시간 (ms)')
    ],
    rows: (ws, pids) => ws.store.db.turns.filter((t) => pids.includes(t.projectId)).map((t) => ({ ...t }))
  },
  {
    name: 'mcpCalls',
    description: '앱이 중계한 외부 MCP 도구 호출 기록 (최근 5000개) — 서버·도구별 호출 수, 실패율, 소요 시간, 확인·거부 집계에 쓴다',
    timeField: 'at',
    refresh: 'live',
    fields: [
      f('id', 'id', '기록 id'),
      f('at', 'time', '호출이 끝난 시각'),
      f('sessionId', 'id', '부른 세션 id (HTTP API 로 부르면 없음)'),
      f('server', 'string', 'MCP 서버 이름'),
      f('tool', 'string', '도구 이름 (서버가 쓰는 원래 이름)'),
      f('decision', 'string', 'allow(정책상 자동) | once | always(확인 창에서 허용) | deny(거부·차단)'),
      f('ok', 'boolean', '성공 여부'),
      f('durationMs', 'number', '소요 시간 (ms, 확인 창 대기 포함)'),
      f('error', 'string', '실패·거부 이유 (없을 수 있음)')
    ],
    rows: (ws, pids) => ws.store.db.mcpCalls.filter((c) => pids.includes(c.projectId)).map((c) => ({ ...c }))
  },
  {
    name: 'activity',
    description: '최근 활동 기록 (최대 200개): 실행 시작·완료·실패·중지·위임·보고·멀티 실행',
    timeField: 'at',
    refresh: 'live',
    fields: [
      f('id', 'id', '기록 id'),
      f('at', 'time', '시각'),
      f('kind', 'string', 'start | done | error | stopped | delegate | report | multi | write | mcp'),
      f('text', 'string', '설명'),
      f('sessionId', 'id', '관련 세션 id (없을 수 있음)')
    ],
    rows: (ws, pids) =>
      ws.store.db.activity.filter((a) => pids.includes(a.projectId)).map((a) => ({ id: a.id, at: a.at, kind: a.kind, text: a.text, sessionId: a.sessionId ?? null }))
  },
  {
    name: 'multiRuns',
    description: '멀티 에이전트 실행',
    timeField: 'createdAt',
    refresh: 'live',
    fields: [
      f('id', 'id', '실행 id'),
      f('title', 'string', '제목'),
      f('mode', 'string', 'parallel | pipeline'),
      f('status', 'string', 'running | done | error'),
      f('agents', 'number', '에이전트 수'),
      f('hasSynthesizer', 'boolean', '종합 에이전트 사용'),
      f('createdAt', 'time', '시작 시각')
    ],
    rows: (ws, pids) =>
      ws.store.db.multiRuns
        .filter((r) => pids.includes(r.projectId))
        .map((r) => ({ id: r.id, title: r.title, mode: r.mode, status: r.status, agents: r.agents.length, hasSynthesizer: !!r.synthesizer, createdAt: r.createdAt }))
  },
  {
    name: 'multiRunSteps',
    description: '멀티 실행의 단계별 상태 (종합 단계 포함). latest=true 로 가장 최근 실행만 고를 수 있다',
    timeField: 'runCreatedAt',
    refresh: 'live',
    fields: [
      f('runId', 'id', '실행 id'),
      f('runTitle', 'string', '실행 제목'),
      f('mode', 'string', 'parallel | pipeline'),
      f('latest', 'boolean', '프로젝트의 가장 최근 실행이면 true'),
      f('index', 'number', '단계 순서 (0부터)'),
      f('key', 'string', '표시용 번호 (1, 2, … 종합은 Σ)'),
      f('role', 'string', '역할'),
      f('provider', 'string', 'CLI'),
      f('state', 'string', 'done | running | error | waiting'),
      f('sessionId', 'id', '단계 세션 id'),
      f('runCreatedAt', 'time', '실행 시작 시각')
    ],
    rows: (ws, pids) => {
      const out: Row[] = []
      for (const pid of pids) {
        const runs = ws.store.db.multiRuns.filter((r) => r.projectId === pid)
        runs.forEach((r, ri) => {
          const steps = r.agents.map((a, i) => ({ key: String(i + 1), role: a.role || a.provider, provider: a.provider, sid: r.sessionIds[i] }))
          if (r.synthesizer) steps.push({ key: 'Σ', role: r.synthesizer.role || '종합', provider: r.synthesizer.provider, sid: r.synthesizerSessionId ?? '' })
          steps.forEach((st, i) => {
            const s = st.sid ? ws.store.session(st.sid) : undefined
            const state = !s ? 'waiting' : s.status === 'running' ? 'running' : s.status === 'error' ? 'error' : s.lastOutput ? 'done' : 'waiting'
            out.push({
              runId: r.id, runTitle: r.title, mode: r.mode, latest: ri === 0, index: i, key: st.key, role: st.role,
              provider: st.provider, state, sessionId: s?.id ?? null, runCreatedAt: r.createdAt
            })
          })
        })
      }
      return out
    }
  },
  {
    name: 'providers',
    description: 'CLI 연결 상태 (프로젝트와 무관)',
    refresh: 'live',
    fields: [
      f('id', 'id', 'claude | codex | gemini'),
      f('label', 'string', '표시 이름'),
      f('enabled', 'boolean', '사용 설정'),
      f('available', 'boolean', '설치·실행 가능'),
      f('state', 'string', `${Object.values(PROVIDER_STATE).join(' | ')}`),
      f('version', 'string', '버전 또는 오류 설명'),
      f('model', 'string', '기본 모델'),
      f('extraArgs', 'string', '추가 인자')
    ],
    rows: (ws) => {
      const status = ws.snapshot().providerStatus
      return ws.store.db.providers.map((p) => {
        const st = status[p.id]
        const state = !p.enabled ? PROVIDER_STATE.off : !st ? PROVIDER_STATE.checking : st.available ? PROVIDER_STATE.ok : PROVIDER_STATE.missing
        return { id: p.id, label: p.label, enabled: p.enabled, available: !!st?.available, state, version: st?.version ?? st?.error ?? '', model: p.model, extraArgs: p.extraArgs }
      })
    }
  },
  {
    name: 'git',
    description: 'git 변경 파일 (git 저장소가 아니면 빈 결과). code: M 수정, A 추가, D 삭제, R 이름변경, U 추적 안 됨',
    refresh: 'interval',
    fields: [f('rel', 'string', '프로젝트 기준 경로'), f('name', 'string', '파일 이름'), f('dir', 'string', '폴더'), f('code', 'string', 'M | A | D | R | U')],
    rows: async (ws, pids) => {
      const out: Row[] = []
      for (const pid of pids) {
        const p = ws.store.project(pid)
        if (!p) continue
        for (const g of (await gitStatus(p.path)) ?? []) {
          const parts = g.rel.split('/')
          const name = parts.pop()
          out.push({ rel: g.rel, name, dir: parts.join('/'), code: g.code })
        }
      }
      return out
    }
  },
  {
    name: 'skills',
    description: '프로젝트 .skills 폴더의 스킬',
    timeField: 'updatedAt',
    refresh: 'live',
    fields: [
      f('id', 'id', '폴더 이름'),
      f('name', 'string', '이름'),
      f('description', 'string', '설명'),
      f('isDefault', 'boolean', '새 세션에 기본 포함'),
      f('extraFiles', 'number', '참고 파일 수'),
      f('relPath', 'string', 'SKILL.md 경로'),
      f('updatedAt', 'time', '수정 시각')
    ],
    rows: (ws, pids) =>
      pids.flatMap((pid) => {
        const p = ws.store.project(pid)
        return ws.skillsOf(pid).map((k) => ({
          id: k.id, name: k.name, description: k.description, isDefault: !!p?.skillIds.includes(k.id),
          extraFiles: k.extraFiles.length, relPath: k.relPath, updatedAt: k.updatedAt
        }))
      })
  },
  {
    name: 'files',
    description: '프로젝트 안 폴더의 파일 목록 (하위 폴더 포함, 최대 500개). 이미지 갤러리 등에 쓴다',
    timeField: 'mtime',
    refresh: 'interval',
    params: [{ name: 'path', description: '프로젝트 기준 폴더 경로 (기본: 프로젝트 루트, 하위 폴더 미포함)' }],
    fields: [
      f('rel', 'string', '프로젝트 기준 경로'),
      f('name', 'string', '파일 이름'),
      f('ext', 'string', '확장자 (소문자, 점 없이)'),
      f('kind', 'string', 'image | video | text | other'),
      f('size', 'number', '크기 (byte)'),
      f('mtime', 'time', '수정 시각')
    ],
    rows: async (ws, pids, params) => {
      const p = ws.store.project(pids[0])
      if (!p) return []
      const base = params.path?.replace(/^\.?\/+|\/+$/g, '') ?? ''
      const recursive = !!base
      const out: Row[] = []
      const walk = async (rel: string): Promise<void> => {
        const dir = resolveIn(p.path, rel || '.')
        let entries: import('node:fs').Dirent[]
        try {
          entries = await fs.readdir(dir, { withFileTypes: true })
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ENOENT') return // 폴더가 아직 없으면 빈 결과
          throw e
        }
        for (const e of entries) {
          if (out.length >= 500 || e.name === '.git' || e.name === 'node_modules') continue
          const r = rel ? `${rel}/${e.name}` : e.name
          if (e.isDirectory()) {
            if (recursive) await walk(r)
            continue
          }
          if (!e.isFile()) continue
          const st = await fs.stat(resolveIn(p.path, r))
          const ext = (/\.([^.]+)$/.exec(e.name)?.[1] ?? '').toLowerCase()
          const kind = IMAGE_EXT.test(e.name) ? 'image' : VIDEO_EXT.test(e.name) ? 'video' : /^(md|txt|json|csv|ts|tsx|js|py|ya?ml|html|css|log)$/.test(ext) ? 'text' : 'other'
          out.push({ rel: r, name: e.name, ext, kind, size: st.size, mtime: st.mtimeMs })
        }
      }
      await walk(base)
      return out
    }
  },
  {
    name: 'script',
    description:
      `${DASHBOARD_DIR}/scripts 의 스크립트(Python·JS·PowerShell 등)를 실행해 결과 JSON 을 행으로 쓴다. ` +
      '결과가 배열이면 그대로, {"rows": [...]} 이면 rows, 객체면 한 행. 처음 실행할 때 사용자 승인이 필요하다',
    refresh: 'interval',
    params: [
      { name: 'name', description: 'scripts 폴더 기준 파일 이름 (예: github_prs.mjs)', required: true },
      { name: 'args', description: '스크립트에 넘길 인자 (JSON 문자열, stdin 과 AW_SCRIPT_ARGS 로 전달)' },
      { name: 'timeout', description: '초 (기본 30, 최대 300)' }
    ],
    fields: [f('*', 'string', '스크립트 결과에 따라 다름')],
    rows: async (ws, pids, params) => {
      let args: unknown = {}
      if (params.args) {
        try {
          args = JSON.parse(params.args)
        } catch {
          throw new Error('params.args 는 JSON 문자열이어야 합니다')
        }
      }
      const r = await ws.runScript(pids[0], params.name, args, { timeout: Number(params.timeout) || undefined }, 'JSON 위젯 (script 소스)')
      const d = r.data as unknown
      const rows = Array.isArray(d) ? d : d && typeof d === 'object' && Array.isArray((d as { rows?: unknown }).rows) ? (d as { rows: unknown[] }).rows : [d]
      return rows.map((x) => (x && typeof x === 'object' ? (x as Row) : { value: x }))
    }
  },
  {
    name: 'file',
    description: `프로젝트 안의 파일을 행으로 읽는다. JSON 배열/객체, CSV(첫 줄 = 열 이름), 그 외는 {content, lines} 한 행. 예: ${DASHBOARD_DIR}/data/metrics.json`,
    refresh: 'interval',
    params: [{ name: 'path', description: '프로젝트 기준 파일 경로', required: true }],
    fields: [f('*', 'string', '파일 내용에 따라 다름')],
    rows: async (ws, pids, params) => {
      const p = ws.store.project(pids[0])
      if (!p) return []
      if (!params.path) throw new Error('file 소스에는 params.path 가 필요합니다')
      const text = await fs.readFile(resolveIn(p.path, params.path), 'utf8')
      return parseFileRows(text, params.path)
    }
  }
]

export function getSource(name: string): SourceDef | undefined {
  return SOURCES.find((s) => s.name === name)
}

/** 스키마 (rows 함수 제외) — GET /api/schema 와 스킬 문서에 쓴다 */
export function schema(): SourceSchema[] {
  return SOURCES.map(({ rows: _rows, ...s }) => s)
}

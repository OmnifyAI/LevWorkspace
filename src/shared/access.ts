import type { ProviderId } from './types'

/** codex·gemini 권한 프리셋 (claude 는 권한이 필요한 도구를 앱 확인 창으로 묻는다) */
export type AccessPreset = 'read' | 'edit' | 'full'

export interface AccessSettings {
  /** 없으면 CLI 연결 설정·추가 인자를 그대로 쓴다 */
  preset?: AccessPreset
  /** codex: 파일 편집 프리셋에서 셸 명령의 네트워크 허용 */
  network?: boolean
  /** codex: 웹 검색 (기본 켜짐 — false 면 끔) / gemini: 웹 가져오기·검색 도구 허용 (기본 꺼짐) */
  web?: boolean
}

export const ACCESS_LABEL: Record<AccessPreset, string> = { read: '읽기 전용', edit: '파일 편집', full: '전체 허용' }

export const ACCESS_HINT: Record<'codex' | 'gemini', Record<AccessPreset, string>> = {
  codex: {
    read: '파일을 읽고 명령을 실행할 수 있지만 아무것도 쓰지 못합니다 (샌드박스 read-only, 네트워크 차단)',
    edit: '작업 폴더 안에서만 파일을 쓰고 명령을 실행합니다 (샌드박스 workspace-write)',
    full: '샌드박스 없이 PC 전체에 쓰고 네트워크도 씁니다 — 믿을 수 있는 작업에만'
  },
  gemini: {
    read: '확인이 필요한 도구(파일 쓰기·셸)는 비대화 모드라 모두 거부됩니다 — 읽기 도구만 동작',
    edit: '파일 편집은 자동 승인, 셸 명령 등 나머지는 거부 (approval-mode auto_edit)',
    full: '모든 도구를 자동 승인합니다 (approval-mode yolo) — 믿을 수 있는 작업에만'
  }
}

/** 프리셋이 쓰는 실행 옵션 (설정 화면에도 그대로 보여 준다) */
export function accessArgs(provider: ProviderId, a: AccessSettings | undefined): string[] {
  if (!a?.preset || provider === 'claude') return []
  if (provider === 'codex') {
    const sandbox = { read: 'read-only', edit: 'workspace-write', full: 'danger-full-access' }[a.preset]
    // exec 는 사람에게 되물을 수 없다 — 샌드박스 범위 안에서는 묻지 않고 진행
    const args = ['--sandbox', sandbox, '-c', 'approval_policy=never']
    if (a.preset === 'edit' && a.network) args.push('-c', 'sandbox_workspace_write.network_access=true')
    // codex 는 웹 검색이 기본으로 켜져 있다 — 끈 경우만 넘긴다
    if (a.web === false) args.push('-c', 'web_search=disabled')
    return args
  }
  const mode = { read: 'default', edit: 'auto_edit', full: 'yolo' }[a.preset]
  const args = ['--approval-mode', mode]
  if (a.web && a.preset !== 'full') args.push('--allowed-tools', 'web_fetch', '--allowed-tools', 'google_web_search')
  return args
}

/** 프리셋과 겹치는 인자(CLI 연결 설정·세션 추가 인자의 --full-auto 등)를 뺀다 */
export function stripAccessArgs(provider: ProviderId, args: string[]): string[] {
  const flags =
    provider === 'codex'
      ? { solo: ['--full-auto', '--dangerously-bypass-approvals-and-sandbox', '--yolo'], valued: ['--sandbox', '-s', '--ask-for-approval', '-a'] }
      : provider === 'gemini'
        ? { solo: ['--yolo', '-y'], valued: ['--approval-mode'] }
        : { solo: [], valued: [] }
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (flags.solo.includes(a)) continue
    if (flags.valued.includes(a)) {
      i++ // 값까지 건너뛴다
      continue
    }
    if (flags.valued.some((f) => a.startsWith(f + '='))) continue
    out.push(a)
  }
  return out
}

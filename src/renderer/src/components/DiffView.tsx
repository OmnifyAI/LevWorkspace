import type { ReactNode } from 'react'

export interface Line {
  num: string
  sign: string
  text: string
  cls: string
}

export function contentLines(text: string): Line[] {
  return text.split(/\r?\n/).map((t, i) => ({ num: String(i + 1), sign: '', text: t, cls: '' }))
}

/** unified diff → 줄 목록 (헤더 줄은 버리고 hunk 머리는 구분선으로) */
export function diffLines(diff: string): Line[] {
  const out: Line[] = []
  let n = 0
  for (const raw of diff.split(/\r?\n/)) {
    if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode)/.test(raw)) continue
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw)
    if (hunk) {
      n = Number(hunk[1]) - 1
      out.push({ num: '', sign: '', text: raw, cls: 'hunk' })
      continue
    }
    if (raw.startsWith('+')) out.push({ num: String(++n), sign: '+', text: raw.slice(1), cls: 'add' })
    else if (raw.startsWith('-')) out.push({ num: '', sign: '-', text: raw.slice(1), cls: 'del' })
    else if (raw.startsWith('\\') || raw === '') continue // "\ No newline" 표시와 끝의 빈 줄
    else out.push({ num: String(++n), sign: '', text: raw.slice(1), cls: '' })
  }
  return out
}

/** 줄 번호·+/- 표시가 있는 코드 보기 */
export function CodeLines({ lines }: { lines: Line[] }): ReactNode {
  return (
    <div className="code-view">
      {lines.map((l, i) => (
        <div key={i} className={`code-line ${l.cls}`}>
          <span className="ln">{l.num}</span>
          <span className="sign">{l.sign}</span>
          <span className="code-text">{l.text || ' '}</span>
        </div>
      ))}
    </div>
  )
}

/** unified diff 보기. 바이너리이거나 비어 있으면 안내 */
export function DiffView({ diff }: { diff: string | null }): ReactNode {
  if (diff === null) return <div className="muted small pad">불러오는 중…</div>
  if (/^Binary files /m.test(diff)) return <div className="muted small pad">바이너리 파일이라 차이를 보여 줄 수 없습니다</div>
  const lines = diffLines(diff)
  if (!lines.length) return <div className="muted small pad">차이가 없습니다</div>
  return <CodeLines lines={lines} />
}

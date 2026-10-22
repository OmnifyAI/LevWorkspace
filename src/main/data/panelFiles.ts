import fs from 'node:fs'
import path from 'node:path'
import type { DataFileEntry, FileEncoding } from '../../shared/dashboard'
import { DASHBOARD_DIR, PANEL_DATA_DIR, PANEL_FILE_MAX } from '../../shared/dashboard'
import { resolveIn } from '../files'

/** 패널이 쓸 수 있는 유일한 폴더: <프로젝트>/.dashboard/data */
export function dataRoot(projectPath: string): string {
  return path.join(projectPath, DASHBOARD_DIR, PANEL_DATA_DIR)
}

/** 패널이 준 경로를 data 폴더 안 절대 경로로. 밖으로 나가거나 비어 있으면 예외 */
export function dataPath(projectPath: string, rel: string): { abs: string; rel: string } {
  const clean = String(rel ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.?\/+/, '')
    .replace(new RegExp(`^(${DASHBOARD_DIR}/)?${PANEL_DATA_DIR}/`), '')
  if (!clean || clean.endsWith('/')) throw new Error('파일 경로가 필요합니다 (.dashboard/data 기준, 예: sprite-fx/attack.json)')
  const root = dataRoot(projectPath)
  const abs = resolveIn(root, clean)
  return { abs, rel: path.relative(root, abs).split(path.sep).join('/') }
}

export function toBuffer(content: unknown, encoding: FileEncoding = 'utf8'): Buffer {
  if (typeof content !== 'string') throw new Error('content 는 문자열이어야 합니다 (객체는 JSON.stringify 로)')
  const buf = encoding === 'base64' ? Buffer.from(content.replace(/^data:[^;]+;base64,/, ''), 'base64') : Buffer.from(content, 'utf8')
  if (buf.length > PANEL_FILE_MAX) throw new Error(`파일이 너무 큽니다 (${PANEL_FILE_MAX / 1024 / 1024}MB 까지)`)
  return buf
}

export function readDataFile(projectPath: string, rel: string, encoding: FileEncoding = 'utf8'): string {
  const { abs } = dataPath(projectPath, rel)
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error(`파일이 없습니다: ${DASHBOARD_DIR}/${PANEL_DATA_DIR}/${rel}`)
  if (fs.statSync(abs).size > PANEL_FILE_MAX) throw new Error('파일이 너무 큽니다')
  return fs.readFileSync(abs).toString(encoding)
}

/** data 폴더(또는 그 아래 dir) 의 파일 목록. 하위 폴더 포함, 최대 1000개 */
export function listDataFiles(projectPath: string, dir = ''): DataFileEntry[] {
  const root = dataRoot(projectPath)
  const start = dir ? resolveIn(root, dir.replace(/^\.?\/+/, '')) : root
  if (!fs.existsSync(start)) return []
  const out: DataFileEntry[] = []
  const walk = (abs: string): void => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (out.length >= 1000) return
      const p = path.join(abs, e.name)
      const st = fs.statSync(p)
      const rel = path.relative(root, p).split(path.sep).join('/')
      out.push({ path: rel, dir: e.isDirectory(), size: e.isDirectory() ? 0 : st.size, mtime: st.mtimeMs })
      if (e.isDirectory()) walk(p)
    }
  }
  walk(start)
  return out
}

/** 원자적으로 쓴다 (임시 파일 → 이름 바꾸기) */
export function writeDataFile(abs: string, buf: Buffer): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  const tmp = `${abs}.${process.pid}.tmp`
  fs.writeFileSync(tmp, buf)
  fs.renameSync(tmp, abs)
}

/** 확인 창 미리보기: 텍스트면 앞부분, 바이너리면 설명만 */
export function previewOf(buf: Buffer, encoding: FileEncoding): string {
  if (encoding === 'base64' || buf.subarray(0, 4096).includes(0)) return `(바이너리 ${buf.length.toLocaleString()} bytes)`
  const text = buf.subarray(0, 1200).toString('utf8')
  return buf.length > 1200 ? `${text}\n… (${(buf.length - 1200).toLocaleString()} bytes 더)` : text
}

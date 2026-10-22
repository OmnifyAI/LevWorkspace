import { execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import { Readable } from 'node:stream'
import path from 'node:path'
import type { FilePreview, FsEntry, GitChange } from '../shared/types'

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.bmp': 'image/bmp', '.pdf': 'application/pdf',
  '.json': 'application/json', '.md': 'text/markdown', '.txt': 'text/plain', '.csv': 'text/csv', '.html': 'text/html',
  '.css': 'text/css', '.js': 'text/javascript', '.ts': 'text/typescript', '.tsx': 'text/typescript',
  '.py': 'text/x-python', '.yaml': 'text/yaml', '.yml': 'text/yaml', '.xml': 'application/xml', '.log': 'text/plain',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogv': 'video/ogg',
  '.ogg': 'video/ogg', '.avif': 'image/avif', '.mp3': 'audio/mpeg', '.wav': 'audio/wav'
}

/**
 * 프로토콜 핸들러용 파일 응답. 동영상 탐색(seek)을 위해 Range 요청을 처리한다.
 */
export async function fileResponse(abs: string, range: string | null): Promise<Response> {
  const st = await fs.stat(abs)
  if (!st.isFile()) return new Response('not found', { status: 404 })
  const headers: Record<string, string> = { 'Content-Type': mimeOf(abs), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' }
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]))
    let end = m[1] && m[2] ? Number(m[2]) : st.size - 1
    end = Math.min(end, st.size - 1)
    if (start > end || start >= st.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } })
    start = Math.max(0, start)
    const body = Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream
    return new Response(body, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': String(end - start + 1) } })
  }
  const body = Readable.toWeb(createReadStream(abs)) as ReadableStream
  return new Response(body, { status: 200, headers: { ...headers, 'Content-Length': String(st.size) } })
}

export function mimeOf(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

/** 프로젝트 밖으로 나가는 경로(../ 등)는 거부한다 */
export function resolveIn(root: string, rel: string): string {
  const abs = path.resolve(root, rel)
  const r = path.relative(root, abs)
  if (r.startsWith('..') || path.isAbsolute(r)) throw new Error('프로젝트 밖의 경로입니다')
  return abs
}

const HIDDEN = new Set(['.git'])
const PREVIEW_LIMIT = 512 * 1024

export async function listDir(root: string, rel: string): Promise<FsEntry[]> {
  const dir = resolveIn(root, rel)
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return entries
    .filter((e) => !HIDDEN.has(e.name) && (e.isDirectory() || e.isFile()))
    .map((e) => ({ name: e.name, rel: rel ? `${rel}/${e.name}` : e.name, dir: e.isDirectory() }))
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
}

export async function readPreview(root: string, rel: string): Promise<FilePreview> {
  const abs = resolveIn(root, rel)
  const stat = await fs.stat(abs)
  const mime = mimeOf(abs)
  if (mime.startsWith('image/')) return { kind: 'image', size: stat.size, mime }
  const fh = await fs.open(abs, 'r')
  try {
    const buf = Buffer.alloc(Math.min(stat.size, PREVIEW_LIMIT))
    await fh.read(buf, 0, buf.length, 0)
    if (buf.includes(0)) return { kind: 'binary', size: stat.size, mime }
    return { kind: 'text', size: stat.size, content: buf.toString('utf8'), truncated: stat.size > PREVIEW_LIMIT }
  } finally {
    await fh.close()
  }
}

function git(root: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout) =>
      err ? reject(err) : resolve(stdout)
    )
  })
}

/** git 저장소가 아니거나 git 이 없으면 null */
export async function gitStatus(root: string): Promise<GitChange[] | null> {
  let out: string
  try {
    out = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  } catch {
    return null
  }
  const changes: GitChange[] = []
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p.length < 4) continue
    const xy = p.slice(0, 2)
    const rel = p.slice(3)
    // 이름 변경은 다음 항목이 원래 경로
    if (xy[0] === 'R' || xy[0] === 'C') i++
    const code: GitChange['code'] =
      xy === '??' ? 'U' : xy.includes('D') ? 'D' : xy.includes('A') ? 'A' : xy.includes('R') ? 'R' : 'M'
    changes.push({ rel, code })
  }
  return changes
}

export async function gitDiff(root: string, rel: string): Promise<string> {
  resolveIn(root, rel)
  try {
    return await git(root, ['diff', 'HEAD', '--no-color', '--', rel])
  } catch {
    // 커밋이 하나도 없는 저장소: 스테이징 기준
    try {
      return await git(root, ['diff', '--no-color', '--', rel])
    } catch {
      return ''
    }
  }
}

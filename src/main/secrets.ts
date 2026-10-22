import fs from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'

/** 사용자 비밀값 이름 (${이름} 으로 참조) */
export const SECRET_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
/** 앱 내부용 항목(OAuth 토큰 등)은 이 접두사 — 비밀값 목록에 보이지 않는다 */
const INTERNAL = 'oauth:'

/**
 * OS 키 저장소(Windows DPAPI · macOS 키체인 · Linux 키링)로 암호화해 파일에 둔다.
 * 값은 메인 프로세스 밖(렌더러·CLI)으로 나가지 않는다. 렌더러에는 이름만 보여 준다.
 */
export class SecretStore {
  private data: Record<string, string> = {}
  private cache = new Map<string, string>()

  constructor(private file: string) {
    try {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      this.data = {}
    }
  }

  available(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 })
  }

  get(name: string): string | undefined {
    if (this.cache.has(name)) return this.cache.get(name)
    const enc = this.data[name]
    if (!enc || !this.available()) return undefined
    try {
      const v = safeStorage.decryptString(Buffer.from(enc, 'base64'))
      this.cache.set(name, v)
      return v
    } catch {
      return undefined
    }
  }

  set(name: string, value: string): void {
    if (!this.available()) throw new Error('이 PC 에서는 OS 키 저장소를 쓸 수 없어 비밀값을 저장할 수 없습니다')
    this.data[name] = safeStorage.encryptString(value).toString('base64')
    this.cache.set(name, value)
    this.persist()
  }

  delete(name: string): void {
    if (!(name in this.data)) return
    delete this.data[name]
    this.cache.delete(name)
    this.persist()
  }

  /** 사용자 비밀값 이름들 */
  names(): string[] {
    return Object.keys(this.data)
      .filter((k) => !k.startsWith(INTERNAL))
      .sort()
  }

  // ── 앱 내부 JSON 항목 (OAuth)

  getJSON<T>(key: string): T | undefined {
    const v = this.get(INTERNAL + key)
    if (!v) return undefined
    try {
      return JSON.parse(v) as T
    } catch {
      return undefined
    }
  }

  setJSON(key: string, value: unknown): void {
    this.set(INTERNAL + key, JSON.stringify(value))
  }

  deleteJSON(key: string): void {
    this.delete(INTERNAL + key)
  }
}

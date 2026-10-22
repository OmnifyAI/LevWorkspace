import { randomBytes } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { shell } from 'electron'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { SecretStore } from './secrets'

/** 서버 하나의 OAuth 상태 (암호화 저장소에 JSON 으로) */
interface Saved {
  client?: OAuthClientInformationMixed
  tokens?: OAuthTokens
  verifier?: string
}

/** 진행 중인 로그인: 루프백 콜백 주소와 state */
interface Interactive {
  redirectUrl: string
  state: string
  /** 브라우저로 연 인증 주소 (안 열리면 화면에서 직접 열 수 있게) */
  authUrl?: string
}

const CALLBACK_PATH = '/oauth/callback'
const LOGIN_TIMEOUT = 5 * 60_000

/**
 * MCP SDK 의 OAuth 훅. 토큰·클라이언트 등록 정보는 SecretStore 에 암호화해 둔다.
 * 백그라운드 연결 중에 인증이 필요해지면 브라우저를 열지 않고 needsAuth 만 표시한다 — 로그인은 사용자가 버튼으로 시작한다.
 */
export class McpOAuthProvider implements OAuthClientProvider {
  interactive: Interactive | null = null
  /** 인증이 필요하다는 신호를 받았다 (사용자 로그인이 필요) */
  needsAuth = false

  constructor(
    private store: SecretStore,
    private key: string
  ) {}

  private load(): Saved {
    return this.store.getJSON<Saved>(this.key) ?? {}
  }

  private save(patch: Partial<Saved>): void {
    this.store.setJSON(this.key, { ...this.load(), ...patch })
  }

  hasTokens(): boolean {
    return !!this.load().tokens?.access_token
  }

  get redirectUrl(): string {
    // 실제 인증(브라우저)은 로그인 중에만 일어나므로, 그 밖에는 형식상의 주소
    return this.interactive?.redirectUrl ?? `http://127.0.0.1${CALLBACK_PATH}`
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Lev',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    }
  }

  state(): string {
    return this.interactive?.state ?? randomBytes(16).toString('hex')
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const c = this.load().client
    // 백그라운드 연결에서는 클라이언트 등록(DCR)을 하지 않는다 — 사용자가 로그인을 누를 때만 등록
    if (!c && !this.interactive) {
      this.needsAuth = true
      throw new Error('로그인이 필요합니다')
    }
    // 로그인할 때마다 콜백 포트가 바뀐다 — 등록된 redirect_uri 와 다르면 다시 등록하게 한다 (갱신만 할 때는 그대로)
    if (c && this.interactive) {
      const uris = (c as { redirect_uris?: string[] }).redirect_uris
      if (uris && !uris.includes(this.interactive.redirectUrl)) return undefined
    }
    return c
  }

  saveClientInformation(client: OAuthClientInformationMixed): void {
    this.save({ client })
  }

  tokens(): OAuthTokens | undefined {
    return this.load().tokens
  }

  saveTokens(tokens: OAuthTokens): void {
    this.save({ tokens })
    this.needsAuth = false
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    if (!this.interactive) {
      this.needsAuth = true
      return
    }
    this.interactive.authUrl = url.toString()
    // 개발·테스트용: 브라우저를 열지 않고 화면의 링크로만 진행
    if (process.env.AW_OAUTH_NO_BROWSER === '1') return
    if (url.protocol === 'https:' || url.hostname === '127.0.0.1' || url.hostname === 'localhost') await shell.openExternal(url.toString())
  }

  saveCodeVerifier(verifier: string): void {
    this.save({ verifier })
  }

  codeVerifier(): string {
    const v = this.load().verifier
    if (!v) throw new Error('PKCE code verifier 가 없습니다 — 로그인을 다시 시작하세요')
    return v
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'all') return this.store.deleteJSON(this.key)
    if (scope === 'client') this.save({ client: undefined })
    else if (scope === 'tokens') this.save({ tokens: undefined })
    else if (scope === 'verifier') this.save({ verifier: undefined })
  }

  logout(): void {
    this.store.deleteJSON(this.key)
    this.needsAuth = false
  }
}

/**
 * 로그인 한 번을 위한 루프백 콜백 서버 (127.0.0.1, 임의 포트). code 를 받으면 닫힌다.
 * state 가 맞지 않거나 시간이 지나면 실패한다.
 */
export async function startCallback(): Promise<{ redirectUrl: string; state: string; code: Promise<string>; close: () => void; cancel: () => void }> {
  const state = randomBytes(16).toString('hex')
  let settle!: { ok: (c: string) => void; fail: (e: Error) => void }
  const code = new Promise<string>((ok, fail) => (settle = { ok, fail }))
  const page = (title: string, body: string): string =>
    `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:15px system-ui;background:#09090b;color:#ededef;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="font-weight:600">${title}</h2><p style="color:#8e8e96">${body}</p></div>`
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404).end()
      return
    }
    const err = url.searchParams.get('error')
    const got = url.searchParams.get('code')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    if (err || !got || url.searchParams.get('state') !== state) {
      res.end(page('로그인 실패', err ? `서버가 거부했습니다: ${err}` : '응답이 올바르지 않습니다. 앱에서 다시 시도하세요.'))
      settle.fail(new Error(err ? `인증 서버가 거부했습니다: ${err}` : 'OAuth 응답이 올바르지 않습니다 (state 불일치)'))
    } else {
      res.end(page('로그인 완료', '이 창을 닫고 Lev 로 돌아가세요.'))
      settle.ok(got)
    }
  })
  await new Promise<void>((ok, fail) => {
    server.once('error', fail)
    server.listen(0, '127.0.0.1', ok)
  })
  const port = (server.address() as AddressInfo).port
  const timer = setTimeout(() => settle.fail(new Error('로그인 시간(5분)이 지났습니다')), LOGIN_TIMEOUT)
  const close = (): void => {
    clearTimeout(timer)
    server.close()
  }
  void code.then(close, close)
  return { redirectUrl: `http://127.0.0.1:${port}${CALLBACK_PATH}`, state, code, close, cancel: () => settle.fail(new Error('로그인을 취소했습니다')) }
}

/**
 * HTML 패널 공통 모양. 모든 패널에 THEME 과 함께 주입되고(panels.ts),
 * 빌더 스킬 옆 style-guide.md 가 사용법을 설명한다. 클래스는 모두 aw- 로 시작해 패널 자체 CSS 와 겹치지 않는다.
 */
export const BASE_CSS = `
.aw-page{display:flex;flex-direction:column;gap:16px;padding:2px}
.aw-card{background:var(--aw-surface);border:1px solid var(--aw-line);border-radius:var(--aw-radius);padding:16px 18px;min-width:0}
.aw-grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(var(--aw-col,160px),1fr))}
.aw-row{display:flex;align-items:center;gap:8px;min-width:0}
.aw-stack{display:flex;flex-direction:column;gap:8px;min-width:0}
.aw-spacer{flex:1}
.aw-title{margin:0;font-size:14px;font-weight:600;color:var(--aw-text)}
.aw-label{font-size:12px;color:var(--aw-muted)}
.aw-muted{color:var(--aw-muted)}
.aw-value{font-size:26px;font-weight:600;line-height:1.2;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.aw-num{font-variant-numeric:tabular-nums}
.aw-up{color:var(--aw-ok)}.aw-down{color:var(--aw-bad)}
.aw-mono{font-family:var(--aw-mono);font-size:12px}
.aw-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:var(--aw-radius-sm);border:1px solid var(--aw-line);background:var(--aw-surface-2);color:var(--aw-text);font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap}
.aw-btn:hover:not(:disabled){border-color:#3a3a40}
.aw-btn:disabled{opacity:.45;cursor:default}
.aw-btn.primary{background:var(--aw-text);border-color:var(--aw-text);color:#09090b;font-weight:600}
.aw-btn.primary:hover:not(:disabled){background:#fff;border-color:#fff}
.aw-btn.ghost{background:transparent;border-color:transparent;color:var(--aw-text-2)}
.aw-btn.danger{color:var(--aw-bad)}
.aw-input{width:100%;min-width:0;background:var(--aw-field);border:1px solid var(--aw-line);border-radius:var(--aw-radius-sm);padding:7px 10px;color:var(--aw-text);font:inherit;outline:none}
.aw-input:focus{border-color:var(--aw-accent)}
textarea.aw-input{resize:vertical}
.aw-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.aw-table{width:100%;border-collapse:collapse;font-size:12.5px}
.aw-table th{text-align:left;font-weight:500;font-size:12px;color:var(--aw-muted);padding:0 10px 8px}
.aw-table td{padding:9px 10px;border-top:1px solid var(--aw-line);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.aw-table .num{text-align:right;font-variant-numeric:tabular-nums}
.aw-table tr:hover td{background:rgba(255,255,255,.02)}
.aw-list{display:flex;flex-direction:column}
.aw-list>*{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--aw-line);min-width:0}
.aw-list>*:first-child{border-top:0}
.aw-badge{display:inline-flex;align-items:center;gap:5px;padding:1px 8px;border-radius:999px;font-size:11.5px;background:var(--aw-surface-2);color:var(--aw-text-2);border:1px solid var(--aw-line)}
.aw-badge.ok{color:var(--aw-ok)}.aw-badge.warn{color:var(--aw-warn)}.aw-badge.bad{color:var(--aw-bad)}.aw-badge.accent{color:var(--aw-accent)}
.aw-dot{width:7px;height:7px;border-radius:50%;background:var(--aw-muted);flex:none}
.aw-dot.ok{background:var(--aw-ok)}.aw-dot.warn{background:var(--aw-warn)}.aw-dot.bad{background:var(--aw-bad)}
.aw-empty{padding:28px 12px;text-align:center;color:var(--aw-muted);font-size:12.5px}
.aw-error{padding:10px 12px;border-radius:var(--aw-radius-sm);background:rgba(239,107,107,.08);border:1px solid rgba(239,107,107,.3);color:var(--aw-bad);font-size:12.5px;white-space:pre-wrap}
.aw-skeleton{border-radius:var(--aw-radius-sm);background:linear-gradient(90deg,var(--aw-surface) 0%,var(--aw-surface-2) 50%,var(--aw-surface) 100%);background-size:200% 100%;animation:aw-shimmer 1.2s infinite linear;min-height:14px}
@keyframes aw-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}
.aw-chart{display:block;width:100%;height:auto;overflow:visible}
.aw-legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--aw-text-2)}
.aw-legend>span{display:inline-flex;align-items:center;gap:6px}
`

/** 빌더 스킬 폴더의 style-guide.md */
export const STYLE_GUIDE_FILE = 'style-guide.md'

export function styleGuide(): string {
  return `# HTML 패널 스타일 가이드

앱 화면과 같은 톤(차분한 다크, Vercel·Linear 풍)으로 패널을 만든다. 새 패널을 만들거나 모양을 고칠 때 이 문서를 따른다.

## 원칙
1. **색은 변수만.** \`--aw-*\` 밖의 색을 직접 쓰지 않는다. 강조색 \`--aw-accent\` 는 화면당 핵심 하나, 상태색(\`--aw-ok / --aw-warn / --aw-bad\`)은 상태 표시에만.
2. **면과 얇은 선으로 구분.** 카드 = \`--aw-surface\` 면 + \`1px solid var(--aw-line)\`. 진한 그림자·두꺼운 테두리·그라데이션 배경 금지.
3. **둥글기 두 가지.** 카드 \`var(--aw-radius)\`(12px), 버튼·입력·작은 상자 \`var(--aw-radius-sm)\`(8px), 배지는 999px.
4. **여백은 넉넉하게.** 카드 안 16px 이상, 카드 사이 12~16px. 빽빽하면 줄이지 말고 정보를 덜어낸다.
5. **위계는 크기와 색으로.** 제목 14px 600, 본문 13px, 라벨·메타 12px muted, 큰 숫자 26px 600 + tabular-nums. 굵기는 400/500/600 만.
6. **고정폭 글꼴은 코드·경로·ID 에만** (\`.aw-mono\`). 숫자는 고정폭 대신 \`.aw-num\`(tabular-nums).
7. **가로 스크롤 금지.** 패널 폭은 수시로 바뀐다. 고정 px 폭 대신 \`%\`, \`minmax\`, \`auto-fit\`, SVG 는 \`viewBox\` + \`width:100%\`.
8. **세 가지 상태를 항상 만든다.** 로딩(\`.aw-skeleton\`), 빈 데이터(\`.aw-empty\`), 오류(\`.aw-error\`).

## 변수 (자동 주입)
| 변수 | 값 | 용도 |
|---|---|---|
| \`--aw-text\` / \`--aw-text-2\` / \`--aw-muted\` | #ededef / #c8c8cd / #8e8e96 | 본문 / 보조 / 라벨·메타 |
| \`--aw-surface\` / \`--aw-surface-2\` | #18181b / #1f1f23 | 카드 면 / 버튼·배지 면 |
| \`--aw-field\` | #0f0f11 | 입력창 배경 |
| \`--aw-line\` | #27272a | 모든 테두리·구분선 |
| \`--aw-accent\` | #8d96e8 | 핵심 강조, 차트 기본색 |
| \`--aw-ok\` \`--aw-warn\` \`--aw-bad\` | #3fbf8a #e5a94f #ef6b6b | 성공·경고·오류 |
| \`--aw-claude\` \`--aw-codex\` \`--aw-gemini\` | | CLI 별 색 |
| \`--aw-chart-1\` … \`--aw-chart-6\` | | 여러 계열 차트 색 (순서대로) |
| \`--aw-radius\` / \`--aw-radius-sm\` | 12px / 8px | 둥글기 |
| \`--aw-mono\` | | 고정폭 글꼴 |

패널 배경은 투명이다(앱 카드 색이 비친다). body 에 배경을 칠하지 않는다.

## 기본 클래스 (자동 주입 — 그냥 쓰면 된다)
| 클래스 | 쓰임 |
|---|---|
| \`.aw-page\` | 패널 최상위. 세로로 쌓고 16px 간격 |
| \`.aw-card\` | 카드 (면 + 얇은 선 + 12px + 넉넉한 여백) |
| \`.aw-grid\` | 자동 칸 나눔. 칸 최소 폭은 \`style="--aw-col:200px"\` 로 |
| \`.aw-row\` / \`.aw-stack\` / \`.aw-spacer\` | 가로 정렬 / 세로 쌓기 / 남는 공간 채우기 |
| \`.aw-title\` \`.aw-label\` \`.aw-muted\` | 카드 제목 / 라벨 / 흐린 글자 |
| \`.aw-value\` \`.aw-num\` \`.aw-up\` \`.aw-down\` | 큰 숫자 / 숫자 정렬 / 증감 색 |
| \`.aw-btn\` (+ \`.primary\` \`.ghost\` \`.danger\`) | 버튼. 주 버튼은 화면당 하나 |
| \`.aw-input\` \`.aw-field\` | 입력·선택·여러 줄 입력 / 라벨+입력 묶음 |
| \`.aw-table\` (\`td.num\`) | 표. 숫자 칸은 오른쪽 정렬 |
| \`.aw-list\` | 구분선 있는 목록 (자식 하나 = 한 줄) |
| \`.aw-badge\` (+ \`.ok\` \`.warn\` \`.bad\` \`.accent\`) \`.aw-dot\` | 상태 배지 / 상태 점 |
| \`.aw-empty\` \`.aw-error\` \`.aw-skeleton\` | 빈 상태 / 오류 / 로딩 자리 |
| \`.aw-chart\` \`.aw-legend\` | SVG 차트 / 범례 |
| \`.aw-mono\` | 코드·경로 |

## 페이지 뼈대

### 대시보드 패널 (지표·차트)
\`\`\`html
<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="aw-page">
  <div class="aw-grid" id="kpis">
    <div class="aw-card aw-stack"><span class="aw-label">세션</span><div class="aw-skeleton" style="height:30px;width:60%"></div></div>
  </div>
  <div class="aw-card aw-stack">
    <div class="aw-row"><h2 class="aw-title">일별 비용</h2><span class="aw-spacer"></span><span class="aw-label">최근 14일</span></div>
    <div id="chart"></div>
  </div>
</div>
<script>
const kpi = (label, value, sub) => \`<div class="aw-card aw-stack"><span class="aw-label">\${label}</span><span class="aw-value">\${value}</span>\${sub ? \`<span class="aw-label">\${sub}</span>\` : ''}</div>\`
async function load() {
  try {
    const { rows } = await aw.query({ source: 'sessions', agg: { n: { op: 'count' } } })
    document.getElementById('kpis').innerHTML = kpi('세션', rows[0].n)
  } catch (e) {
    document.getElementById('kpis').innerHTML = \`<div class="aw-error">\${e.message}</div>\`
  }
}
load(); aw.on('state', load)
</script>
</body></html>
\`\`\`

### 도구 (입력 → 실행 → 결과, \`height: "fill"\`)
\`\`\`html
<div class="aw-page">
  <div class="aw-card aw-stack">
    <h2 class="aw-title">도구 이름</h2>
    <span class="aw-label">무엇을 하는 도구인지 한 줄로.</span>
  </div>
  <div class="aw-card aw-stack">
    <label class="aw-field"><span class="aw-label">입력</span><textarea class="aw-input" id="q" rows="4"></textarea></label>
    <div class="aw-row"><span class="aw-spacer"></span><button class="aw-btn ghost" id="reset">지우기</button><button class="aw-btn primary" id="go">실행</button></div>
  </div>
  <div class="aw-card" id="out"><div class="aw-empty">실행하면 결과가 여기에 나옵니다.</div></div>
</div>
\`\`\`
- 위쪽은 설명, 가운데는 입력과 실행, 아래는 결과 순서.
- 실행 중에는 주 버튼을 \`disabled\` 로 바꾸고 글자를 "실행 중…" 으로.

## 요소별 규칙
- **KPI**: \`.aw-label\`(무엇) → \`.aw-value\`(숫자) → \`.aw-label\`(비교·기간). 한 줄에 4개 이하. 단위는 숫자 뒤에 작게.
- **표**: 열 5~6개 이하, 긴 글자는 잘림(…)으로. 숫자 열은 \`td.num\`. 행 클릭 동작이 있으면 커서와 hover 를 준다.
- **목록**: \`.aw-list\` 한 줄 = 상태 점 + 제목(넘치면 …) + 오른쪽에 \`.aw-label\` 시간.
- **버튼**: 주 버튼(\`.primary\`)은 한 화면에 하나. 나머지는 기본 또는 \`.ghost\`. 아이콘만 있는 버튼은 \`aria-label\` 필수.
- **입력**: 항상 라벨(\`.aw-field\`)과 함께. placeholder 는 예시이지 라벨이 아니다.
- **빈 상태**: 무엇이 없는지 + 어떻게 채우는지 한 문장. 오류는 사용자가 할 일을 포함.

## 차트 (SVG 직접, 라이브러리 없이도 충분)
- 색: 한 계열이면 \`var(--aw-accent)\`, 여러 계열이면 \`--aw-chart-1\` 부터 순서대로. CLI 별이면 \`--aw-claude/codex/gemini\`.
- 보조 격자선은 \`var(--aw-line)\` 점선(\`stroke-dasharray="3 4"\`), 축 글자는 11px muted. 값 라벨은 꼭 필요할 때만.
- 각 막대·조각에 \`<title>\` 로 정확한 값을 넣는다(마우스 올리면 보임).

### 막대 — 둥근 모서리 + 아래로 옅어지는 그라데이션
\`\`\`js
function bars(el, data, { color = 'var(--aw-accent)', h = 160 } = {}) {
  const W = 600, H = h, pad = 22, max = Math.max(...data.map(d => d.v), 1), step = W / data.length, bw = step * 0.56
  const id = 'g' + Math.random().toString(36).slice(2)
  el.innerHTML = \`<svg class="aw-chart" viewBox="0 0 \${W} \${H}" role="img">
    <defs><linearGradient id="\${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="\${color}" stop-opacity=".95"/><stop offset="1" stop-color="\${color}" stop-opacity=".4"/></linearGradient></defs>
    \${[.25, .5, .75].map(f => \`<line x1="0" x2="\${W}" y1="\${(H - pad) * f}" y2="\${(H - pad) * f}" stroke="var(--aw-line)" stroke-dasharray="3 4"/>\`).join('')}
    \${data.map((d, i) => { const bh = (H - pad) * d.v / max; return \`<rect x="\${i * step + (step - bw) / 2}" y="\${H - pad - bh}" width="\${bw}" height="\${Math.max(bh, d.v ? 2 : 0)}" rx="\${Math.min(6, bw / 2)}" fill="url(#\${id})"><title>\${d.label}: \${d.v}</title></rect>
      <text x="\${i * step + step / 2}" y="\${H - 6}" text-anchor="middle" font-size="11" fill="var(--aw-muted)">\${d.label}</text>\` }).join('')}
  </svg>\`
}
\`\`\`

### 선 — 얇은 선 + 아래 옅은 영역
\`\`\`js
// points = data.map((d, i) => [x, y]) 를 만든 뒤
// <path d="M x0,바닥 L ...points L xn,바닥 Z" fill="url(#g)" />  (stop-opacity .28 → 0)
// <polyline points="..." fill="none" stroke="var(--aw-accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
\`\`\`

### 도넛 — 얇은 링 + 조각 사이 틈 + 가운데 합계
\`\`\`js
function donut(el, data, { format = v => v } = {}) {
  const R = 40, C = 2 * Math.PI * R, total = data.reduce((a, d) => a + d.v, 0) || 1
  const gap = data.filter(d => d.v > 0).length > 1 ? 1.6 : 0
  let acc = 0
  const arcs = data.map((d, i) => {
    const len = d.v / total * C, a = Math.max(len - gap, 0.01)
    const s = \`<circle cx="50" cy="50" r="\${R}" fill="none" stroke="var(--aw-chart-\${i % 6 + 1})" stroke-width="10" stroke-dasharray="\${a} \${C - a}" stroke-dashoffset="\${-acc}" transform="rotate(-90 50 50)"><title>\${d.label}: \${format(d.v)}</title></circle>\`
    acc += len
    return d.v > 0 ? s : ''
  }).join('')
  el.innerHTML = \`<div class="aw-row" style="gap:20px;flex-wrap:wrap">
    <svg class="aw-chart" viewBox="0 0 100 100" style="width:140px;flex:none">
      <circle cx="50" cy="50" r="\${R}" fill="none" stroke="var(--aw-surface-2)" stroke-width="10"/>\${arcs}
      <text x="50" y="49" text-anchor="middle" font-size="12" font-weight="600" fill="var(--aw-text)">\${format(total)}</text>
      <text x="50" y="61" text-anchor="middle" font-size="7" fill="var(--aw-muted)">합계</text>
    </svg>
    <div class="aw-stack" style="flex:1;min-width:140px">\${data.map((d, i) => \`<div class="aw-row"><span class="aw-dot" style="background:var(--aw-chart-\${i % 6 + 1})"></span><span>\${d.label}</span><span class="aw-spacer"></span><span class="aw-num aw-muted">\${format(d.v)}</span></div>\`).join('')}</div>
  </div>\`
}
\`\`\`

## 하지 말 것
- 원색(#ff0000, #00f 등)·형광색·무지개 팔레트, \`box-shadow\` 로 띄우기, 굵기 700 이상.
- 카드 안에 또 카드 겹치기(한 단계만), 글자 크기 10px 미만.
- 이모지로 아이콘 대신하기 — 필요하면 작은 인라인 SVG(16px, \`stroke="currentColor"\`, 흐린 색).
- 고정 폭(\`width: 900px\`)이나 \`white-space: nowrap\` 긴 줄로 가로 스크롤 만들기.
`
}

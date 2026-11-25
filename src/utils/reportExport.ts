/**
 * 报告导出共享基建
 * - html2canvas 不解析 oklch：截图时在克隆文档里把设计 token 降级为等效 hex，不污染真实 DOM
 * - 统一 Markdown / PNG / PDF 三种导出入口，周报与客户报告共用
 */
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

export type ExportKind = 'markdown' | 'png' | 'pdf'

export const CAPTURE_BG = '#262a31'

/** 旧内核无法解析 oklch 时，token → 色的兜底值（与 index.css 的 oklch 色板等效） */
export const TOKEN_FALLBACK: Record<string, string> = {
  '--accent': '#a8d8dc',
  '--accent-dim': '#8bb9bd',
  '--accent-deep': '#5d8189',
  '--amber': '#d9c08a',
  '--cat-focus': '#a8d8dc',
  '--cat-meeting': '#a0aedb',
  '--cat-admin': '#989ca4',
  '--cat-learning': '#a8d4bd',
  '--cat-other': '#c2a4d0',
}

/** 把设计 token（var(--x) → oklch(...)）解析为 hex，供 SVG 图表截图使用 */
export function tokenToHex(value: string, fallback: string): string {
  const input = value.trim()
  if (!input) return fallback
  if (/^#[0-9a-f]{3,8}$/i.test(input)) return input
  let raw = input
  const varMatch = /^var\(\s*(--[\w-]+)\s*\)$/.exec(input)
  if (varMatch) {
    raw = getComputedStyle(document.documentElement).getPropertyValue(varMatch[1]).trim()
    if (!raw) return fallback
  }
  try {
    const probe = document.createElement('canvas')
    probe.width = 1
    probe.height = 1
    const ctx = probe.getContext('2d')
    if (!ctx) return fallback
    ctx.fillStyle = raw
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
    // 内核不支持 oklch 时 fillStyle 保持默认黑色，此时回退，避免整张图表变黑
    if (/^(oklch|lch|lab|color\()/i.test(raw) && r === 0 && g === 0 && b === 0) return fallback
    return hex
  } catch {
    return fallback
  }
}

export function colorOf(token: string): string {
  return tokenToHex(`var(${token})`, TOKEN_FALLBACK[token] ?? TOKEN_FALLBACK['--accent'])
}

/** html2canvas 截图时把全部设计 token 降为等效 hex / rgba */
export const CAPTURE_TOKENS: Record<string, string> = {
  '--bg': '#262a31',
  '--surface-1': '#30343c',
  '--surface-2': '#393d45',
  '--surface-3': '#43474f',
  '--bg-deep': '#1e2228',
  '--text': '#eef0f2',
  '--text-sub': '#c8ccd0',
  '--text-faint': '#9aa0a6',
  '--text-mute': '#80868c',
  '--border': '#484d56',
  '--border-soft': '#3b3f47',
  '--border-faint': '#34383f',
  '--accent': '#a8d8dc',
  '--accent-dim': '#8bb9bd',
  '--accent-deep': '#5d8189',
  '--accent-soft': 'rgba(168, 216, 220, 0.10)',
  '--accent-line': 'rgba(168, 216, 220, 0.26)',
  '--accent-glow': 'rgba(168, 216, 220, 0.22)',
  '--accent-wash': 'rgba(168, 216, 220, 0.05)',
  '--accent-halo': 'rgba(168, 216, 220, 0.07)',
  '--grid': 'rgba(168, 216, 220, 0.015)',
  '--cat-focus': '#a8d8dc',
  '--cat-meeting': '#a0aedb',
  '--cat-admin': '#989ca4',
  '--cat-learning': '#a8d4bd',
  '--cat-other': '#c2a4d0',
  '--violet': '#c2a4d0',
  '--green': '#a8d4bd',
  '--amber': '#d9c08a',
  '--orange': '#d9b08a',
  '--red': '#d99a95',
  '--blue': '#a0aedb',
  '--shadow': '0 1px 2px rgba(0, 0, 0, 0.28), 0 10px 30px rgba(0, 0, 0, 0.26)',
  '--shadow-soft': 'inset 0 1px 0 rgba(238, 240, 242, 0.022)',
}

/**
 * html2canvas 的 onclone 回调：在克隆文档里消除 oklch。
 * html 根背景继承 :root 的 oklch 会让 parseBackgroundColor 崩溃，故必须处理根元素。
 */
export function sanitizeCloneForCapture(clonedDoc: Document, clonedRoot: HTMLElement): void {
  clonedDoc.documentElement.style.setProperty('background-color', CAPTURE_BG, 'important')
  clonedDoc.body.style.setProperty('background-color', CAPTURE_BG, 'important')

  const tokenRules = Object.entries(CAPTURE_TOKENS)
    .map(([key, value]) => `${key}: ${value} !important;`)
    .join('\n')
  const style = clonedDoc.createElement('style')
  style.textContent = `
    html, html * { ${tokenRules} }
    html .card, html .stat-card { background: ${CAPTURE_TOKENS['--surface-1']} !important; }
    html .recharts-tooltip-wrapper { display: none !important; }
  `
  clonedDoc.head.appendChild(style)

  clonedRoot.querySelectorAll<Element>('*').forEach((element) => {
    const inline = element.getAttribute('style')
    if (inline && /oklch\(/i.test(inline)) {
      const sanitized = inline.replace(/oklch\([^)]*\)/gi, (match) => tokenToHex(match, CAPTURE_TOKENS['--accent']))
      element.setAttribute('style', sanitized)
    }
    Array.from(element.attributes).forEach((attribute) => {
      const tokenMatch = /^var\(\s*(--[\w-]+)\s*\)$/.exec(attribute.value.trim())
      const hex = tokenMatch ? CAPTURE_TOKENS[tokenMatch[1]] : undefined
      if (hex) element.setAttribute(attribute.name, hex)
    })
  })
}

/** 通用 Blob 下载 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // 立即 revoke 在部分内核会中断下载，延迟释放
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export interface ExportOptions {
  kind: ExportKind
  node: HTMLElement | null
  markdown: string
  fileBase: string
}

/**
 * 统一导出入口。
 * Markdown 直接下载文本；PNG/PDF 通过 html2canvas 截图报告节点（自动做 oklch 降级）。
 */
export async function exportReport({ kind, node, markdown, fileBase }: ExportOptions): Promise<void> {
  if (kind === 'markdown') {
    downloadBlob(new Blob([`\uFEFF${markdown}`], { type: 'text/markdown;charset=utf-8' }), `${fileBase}.md`)
    return
  }
  if (!node) throw new Error('报告内容节点不存在')
  const canvas = await html2canvas(node, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: CAPTURE_BG,
    onclone: sanitizeCloneForCapture,
  })
  if (kind === 'png') {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('PNG 编码失败')
    downloadBlob(blob, `${fileBase}.png`)
  } else {
    const pdf = new jsPDF({
      orientation: canvas.width >= canvas.height ? 'landscape' : 'portrait',
      unit: 'px',
      format: [canvas.width, canvas.height],
      compress: true,
    })
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height)
    pdf.save(`${fileBase}.pdf`)
  }
}

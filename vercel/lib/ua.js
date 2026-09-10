/**
 * vercel/lib/ua.js
 * --------------------------------------------------------------
 * 解析 HTTP User-Agent 串，提取出管理员后台展示所需的设备信息。
 *
 * 目标：够用就行，不追求 100% 准确。Vercel Function 启动开销敏感，
 *       不用 ua-parser-js 这种大库（多 1MB+ 依赖），自己写一个能覆盖
 *       项目已知的客户端类型即可：
 *         - 一寸光阴桌面端（Electron + 自家 readAppVersion）
 *         - 浏览器 / 其他
 *
 * 解析规则（顺序很重要）：
 *   1. Electron + X-Client-Version 头 → 桌面端，os / arch / electron / appVersion
 *   2. UA 关键字：Tauri / Electron → 桌面端
 *   3. 桌面 OS 关键字：Windows / Mac OS X / Linux
 *   4. 浏览器兜底：Chrome / Safari / Firefox / Edge
 *
 * 入参：req（Vercel Node 17+ req 对象，headers + optional x-client-version）
 * 返回：{ os, arch, client, electronVersion, appVersion, ua } —— 任一字段
 *       解析失败就 null，前端展示 "—"
 */
import os from 'node:os'

// 从 process.arch 拿本机 arch（Vercel Function 实际跑的 CPU 架构）。
// 注意：UA 里如果用户改了它，这里就拿到不一致的。Admin 看个大概够用。
const HOST_ARCH = (() => {
  const a = String(process.arch || '').toLowerCase()
  if (a === 'x64' || a === 'amd64') return 'x64'
  if (a === 'arm64' || a === 'aarch64') return 'arm64'
  if (a === 'ia32' || a === 'x86') return 'x86'
  return a || null
})()

// 从 os.userInfo() / os.platform() 不靠 UA 也能拿到"函数实际跑在哪个 OS"，
// 但 Vercel Function 是 Linux container，参考价值低，主要还是看 UA。

/**
 * @param {import('http').IncomingMessage & { headers: Record<string, string|undefined> }} req
 * @returns {{
 *   os: string|null,
 *   arch: string|null,
 *   client: 'electron-tauri-desktop'|'electron-desktop'|'browser'|'unknown',
 *   electronVersion: string|null,
 *   appVersion: string|null,
 *   ua: string|null,
 * }}
 */
export function parseUserAgent(req) {
  const ua = String(req.headers['user-agent'] || req.headers['User-Agent'] || '').trim() || null
  const clientVersion = String(
    req.headers['x-client-version'] || req.headers['X-Client-Version'] || '',
  ).trim() || null

  // 默认形态（兜底）
  const out = {
    os: null,
    arch: HOST_ARCH,
    client: 'unknown',
    electronVersion: null,
    appVersion: clientVersion,
    ua,
  }

  if (!ua) return out

  // 1) 一寸光阴桌面端（Electron 33 包装，UA 形如 "Mozilla/5.0 ... Electron/33.x ..."）
  //    同时认自家 X-Client-Version 头（来自 readAppVersion(package.json)）
  const electronMatch = ua.match(/Electron\/(\d+(?:\.\d+){0,2})/i)
  if (electronMatch) {
    out.electronVersion = electronMatch[1]
    // UA 里没明确 OS 关键字时按 Windows 兜底（一寸光阴目前只打 Windows 包）
    if (/Windows NT/i.test(ua)) {
      out.os = windowsNtToName(ua.match(/Windows NT ([\d.]+)/i)?.[1])
    } else if (/Mac OS X|Macintosh/i.test(ua)) {
      out.os = 'macOS'
    } else if (/Linux/i.test(ua) && !/Android/i.test(ua)) {
      out.os = 'Linux'
    } else {
      out.os = 'Windows' // 一寸光阴当前只打 Windows NSIS + portable
    }
    out.client = 'electron-desktop'
    return out
  }

  // 2) Tauri 桌面端（暂时没用到，留口子）
  if (/Tauri/i.test(ua)) {
    out.client = 'electron-tauri-desktop'
    if (/Windows NT/i.test(ua)) out.os = windowsNtToName(ua.match(/Windows NT ([\d.]+)/i)?.[1])
    else if (/Mac OS X/i.test(ua)) out.os = 'macOS'
    else if (/Linux/i.test(ua)) out.os = 'Linux'
    return out
  }

  // 3) 浏览器 / 其他
  if (/Edg\//i.test(ua)) {
    out.client = 'browser'
  } else if (/Chrome|CriOS/i.test(ua)) {
    out.client = 'browser'
  } else if (/Firefox/i.test(ua)) {
    out.client = 'browser'
  } else if (/Safari/i.test(ua)) {
    out.client = 'browser'
  }

  if (/Android/i.test(ua)) out.os = 'Android'
  else if (/iPhone|iPad|iPod/i.test(ua)) out.os = 'iOS'
  else if (/Windows NT/i.test(ua)) out.os = windowsNtToName(ua.match(/Windows NT ([\d.]+)/i)?.[1])
  else if (/Mac OS X/i.test(ua)) out.os = 'macOS'
  else if (/Linux/i.test(ua)) out.os = 'Linux'

  return out
}

/** Windows NT 版本号 → 人类可读 Windows 版本 */
function windowsNtToName(nt) {
  const map = {
    '10.0': 'Windows 10/11',
    '6.3': 'Windows 8.1',
    '6.2': 'Windows 8',
    '6.1': 'Windows 7',
  }
  return map[String(nt)] || `Windows NT ${nt || ''}`.trim()
}

/**
 * 提取客户端真实 IP（Vercel 自动注入 x-forwarded-for，取最左非 unknown）
 * - 链式代理：取最左
 * - 单 IP：直接用
 * - 兜底：x-real-ip
 */
export function getClientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For'] || '')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first && first.toLowerCase() !== 'unknown') return first
  }
  const xri = String(req.headers['x-real-ip'] || req.headers['X-Real-IP'] || '').trim()
  if (xri) return xri
  return null
}

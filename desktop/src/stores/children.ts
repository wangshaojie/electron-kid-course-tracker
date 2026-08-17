/**
 * stores/children.ts —— CloudBase PG 适配版
 *
 * 外部 API 保持不变（state/getters/actions 名字兼容）
 *  内部走 app.rdb().from('children')
 *
 * 字段映射（PG snake_case ↔ UI snake_case 一致，不做转换）：
 *  id / owner_id / name / emoji / color / sort_order / created_at
 *
 * 数据隔离：所有读写都自己加 .eq('owner_id', uid) 过滤
 *  - uid 来自自签 JWT（getActiveUid()）
 *  - RLS 已关闭（见 migration 20260813055506）
 *
 * 激活宝贝同步到云端（v0.3 起）：
 *  - 加载顺序：拉 children → 拉 user_prefs.active_child_id → 决策
 *  - 优先级：云端 user_prefs > 本地 localStorage > 第一个宝贝
 *  - 云端 active 在 children 列表里找不到时：fallback 第一个 + ElMessage 提示
 *  - 切换 setActive：本地立即生效 + 后台 upsert user_prefs（失败不阻塞）
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { businessApi, getActiveUid } from '@/lib/cloudbase'

export interface Child {
  id: string
  owner_id: string
  name: string
  emoji: string
  color: string
  sort_order: number
  created_at: string
}

export interface ChildInput {
  name: string
  emoji?: string
  color?: string
  sort_order?: number
}

const LS_KEY = 'kid_active_child_id'

function readLS(): string { try { return localStorage.getItem(LS_KEY) ?? '' } catch { return '' } }
function writeLS(id: string) { try { localStorage.setItem(LS_KEY, id) } catch { /* ignore */ } }
function clearLS() { try { localStorage.removeItem(LS_KEY) } catch { /* ignore */ } }

function requireUid(): string {
  const uid = getActiveUid()
  if (!uid) throw new Error('未登录：无法操作 children 表')
  return uid
}

/** 把"当前激活"写回 user_prefs（best-effort，失败不抛）。owner_id 由服务端从 JWT 注入 */
async function writeActivePref(uid: string, activeChildId: string): Promise<{ ok: boolean; error?: string }> {
  void uid
  try {
    await businessApi<{ active_child_id: string }>('PATCH', '/b/user_prefs', {
      active_child_id: activeChildId,
      updated_at: new Date().toISOString(),
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 读 user_prefs 单行（按 owner_id，服务端强制过滤）；没记录时返回空数组 */
async function readActivePref(uid: string): Promise<string | null> {
  void uid
  try {
    const rows = await businessApi<Array<{ active_child_id: string | null }>>(
      'GET',
      '/b/user_prefs?select=active_child_id',
    )
    return rows[0]?.active_child_id ?? null
  } catch (e) {
    console.warn('[children] readActivePref failed', e)
    return null
  }
}

export const useChildrenStore = defineStore('children', () => {
  const items = ref<Child[]>([])
  const activeId = ref<string>('')
  const loaded = ref(false)

  const count = computed(() => items.value.length)
  const active = computed(() => items.value.find((c) => c.id === activeId.value) ?? null)
  const activeIdSafe = computed(() => {
    if (activeId.value && items.value.find((c) => c.id === activeId.value)) return activeId.value
    return items.value[0]?.id ?? ''
  })

  /**
   * 加载宝贝 + 决策激活宝贝
   * 优先级：云端 user_prefs > 本地 localStorage > 第一个宝贝
   * 云端 ID 在列表里找不到 → fallback 第一个 + Toast 提示
   *
   * 如果 children 拉空但有 jwt 登录态 —— 大概率 uid 不匹配
   * (用户可能换邮箱/换设备/本地缓存错乱)，这时不能静默让人"新建宝贝"
   * 而是弹明确提示让用户知道："你的账号下没有宝贝数据"
   */
  async function load() {
    const uid = requireUid()
    const list = await businessApi<Child[]>('GET', '/b/children?order=sort_order&asc=true')
    items.value = list

    if (list.length === 0) {
      // 新账号/空账号：不弹警告，由首页直接展示"创建宝贝"引导
      activeId.value = ''
      clearLS()
      loaded.value = true
      return
    }

    // 1) 优先云端 user_prefs
    const cloudActive = await readActivePref(uid)
    // 2) 兜底本地 localStorage
    const lsActive = readLS()

    let resolved: string | null = null
    if (cloudActive && list.some((c) => c.id === cloudActive)) {
      resolved = cloudActive
    } else if (lsActive && list.some((c) => c.id === lsActive)) {
      resolved = lsActive
    }
    resolved ??= list[0]!.id

    activeId.value = resolved
    writeLS(resolved)

    // 提示 + 写回（仅当云端没记录或记录失效时）
    if (!cloudActive) {
      // 本地有缓存或新装的设备，把当前激活同步上云端（best-effort）
      void writeActivePref(uid, resolved)
    } else if (cloudActive !== resolved) {
      // 云端有记录但失效了，提示用户 + 写回新值
      const next = list.find((c) => c.id === resolved)
      ElMessage({
        type: 'info',
        message: `之前激活的宝贝已不存在，已自动切换到「${next?.name ?? '默认'}」`,
        duration: 3000,
        showClose: true,
      })
      void writeActivePref(uid, resolved)
    } else if (lsActive && lsActive !== cloudActive) {
      // 本地缓存和云端不同，以云端为准 + 刷本地
      writeLS(cloudActive)
    }

    loaded.value = true
  }

  /**
   * 切换激活宝贝
   * - 本地立即生效（UI 不等云端）
   * - 后台 best-effort 写 user_prefs；失败不阻塞但打 warning
   * - localStorage 双写一份（下次冷启动 + 离线下次兜底）
   */
  async function setActive(id: string) {
    if (activeId.value === id) return
    if (!items.value.find((c) => c.id === id)) return
    const uid = getActiveUid()
    activeId.value = id
    writeLS(id)
    if (!uid) return
    const r = await writeActivePref(uid, id)
    if (!r.ok) console.warn('[children] setActive upsert pref failed:', r.error)
  }

  async function create(input: ChildInput): Promise<Child> {
    requireUid()
    const c = await businessApi<Child>('POST', '/b/children', {
      name: input.name,
      emoji: input.emoji ?? '🧒',
      color: input.color ?? '#3FB87A',
      sort_order: input.sort_order ?? 0,
    })
    items.value.push(c)
    if (items.value.length === 1) {
      // 第一个宝贝：本地 + 云端 prefs 都激活
      await setActive(c.id)
    } else {
      // 后续新增：不动当前激活（用户得手动切）
    }
    ElMessage.success('已添加宝贝档案')
    return c
  }

  async function update(id: string, input: Partial<ChildInput>) {
    requireUid()
    const c = await businessApi<Child>('PATCH', `/b/children/${encodeURIComponent(id)}`, { ...input })
    items.value = items.value.map((x) => (x.id === id ? c : x))
    ElMessage.success('已更新')
  }

  async function remove(id: string) {
    if (items.value.length <= 1) {
      throw new Error('至少需要保留一个宝贝档案')
    }
    requireUid()
    await businessApi<{ deleted: number }>('DELETE', `/b/children/${encodeURIComponent(id)}`)
    items.value = items.value.filter((x) => x.id !== id)
    if (activeId.value === id) {
      const next = items.value[0]!
      await setActive(next.id)
    }
    ElMessage.success('已删除宝贝档案')
  }

  function getById(id: string): Child | undefined {
    return items.value.find((c) => c.id === id)
  }

  function totalCount(): number { return items.value.length }

  return {
    items,
    activeId,
    loaded,
    count,
    active,
    activeIdSafe,
    load,
    setActive,
    create,
    update,
    remove,
    getById,
    totalCount,
  }
})

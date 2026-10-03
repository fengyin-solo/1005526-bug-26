import type { DestroyDetail, DestroyDraft, EntryRow } from './types'

// 存放条件全平台只有这一套：销毁登记的下拉、详情抽屉的展示、越界校验都从这儿拿，
// 两处拿到的保证是同一套。
export const STORAGE_CONDITIONS = [
  '常温（10-30℃）',
  '阴凉（不超过20℃）',
  '冷藏（2-8℃）',
  '冷冻（-25～-10℃）',
] as const

export function isStorageCondition(value: string): boolean {
  return (STORAGE_CONDITIONS as readonly string[]).includes(value.trim())
}

// 留样数量沿用手册既有口径：按支/瓶的正整数计，脏数据按 0 计。
// 工作台统计和详情抽屉共用这一个算法，两边读到的数量才会一致。
export function sampleCountOf(row: EntryRow | null | undefined): number {
  if (!row) {
    return 0
  }
  const raw = Number(row['留样数量'])
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0
  }
  return Math.trunc(raw)
}

// 登记入口的解析：不符合口径返回 null，由校验打回重填。
export function parseSampleCount(value: string): number | null {
  const raw = Number(value.trim())
  if (!Number.isFinite(raw) || raw <= 0 || !Number.isInteger(raw)) {
    return null
  }
  return raw
}

// 销毁明细与断点草稿各自独立持久化：记录本体在 entries 里，过程数据放这里。
const DETAIL_KEY = 'pharma-cleanroom:retainsample:destroy-details'
const DRAFT_KEY = 'pharma-cleanroom:retainsample:destroy-drafts'

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    return fallback
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  window.localStorage.setItem(key, JSON.stringify(value))
}

export function listDestroyDetails(id: number): DestroyDetail[] {
  const all = readJson<Record<string, DestroyDetail[]>>(DETAIL_KEY, {})
  return all[String(id)] ?? []
}

// 同一份留样重复提交只算一次：当前周期已有明细就直接吞掉，不再多写。
export function appendDestroyDetail(id: number, detail: DestroyDetail): boolean {
  const all = readJson<Record<string, DestroyDetail[]>>(DETAIL_KEY, {})
  const key = String(id)
  if ((all[key] ?? []).length > 0) {
    return false
  }
  all[key] = [detail]
  writeJson(DETAIL_KEY, all)
  return true
}

// 退回后清掉中间内容：本周期明细整条清掉，重办销毁时从头记。
export function clearDestroyDetails(id: number): void {
  const all = readJson<Record<string, DestroyDetail[]>>(DETAIL_KEY, {})
  const key = String(id)
  if (key in all) {
    delete all[key]
    writeJson(DETAIL_KEY, all)
  }
}

export function loadDestroyDraft(id: number): DestroyDraft | null {
  const all = readJson<Record<string, DestroyDraft>>(DRAFT_KEY, {})
  return all[String(id)] ?? null
}

export function saveDestroyDraft(id: number, draft: DestroyDraft): void {
  const all = readJson<Record<string, DestroyDraft>>(DRAFT_KEY, {})
  all[String(id)] = draft
  writeJson(DRAFT_KEY, all)
}

export function clearDestroyDraft(id: number): void {
  const all = readJson<Record<string, DestroyDraft>>(DRAFT_KEY, {})
  const key = String(id)
  if (key in all) {
    delete all[key]
    writeJson(DRAFT_KEY, all)
  }
}

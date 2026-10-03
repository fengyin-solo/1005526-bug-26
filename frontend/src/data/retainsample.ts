/**
 * 留样管理领域规则：状态机、存放条件口径、留样数量口径、销毁登记与草稿都集中在这里。
 * 页面（工作台、抽屉、稳定性待办）只读这里导出的口径，避免各算各的对不上。
 */

export const RETAIN_KEY = 'retainsample'
export const STABILITY_KEY = 'stability'

export const RETAIN_STATUSES = ['待留样', '已留样', '已到期', '已销毁'] as const

// 手册登记的标准存放条件：登记留样与办理销毁两处共用这一套，不允许另填。
export const STORAGE_CONDITIONS = ['常温', '阴凉', '冷藏', '冷冻'] as const
export const DESTROY_METHODS = ['焚烧', '化学处理', '高压灭菌后废弃'] as const

// 每个动作只允许从指定状态发起，顺序流转，越级一律挡回。
export const RETAIN_TRANSITIONS: Record<string, string> = {
  登记留样: '待留样',
  标记到期: '已留样',
  销毁退回: '已销毁',
}

// 办理销毁时写入、销毁退回时清掉的「中间内容」字段。主档的留样数量、存放条件不在其中。
export const DESTROY_CLEAR_FIELDS = [
  '销毁编号',
  '销毁日期',
  '销毁存放条件',
  '销毁经手人',
  '销毁方式',
  '销毁明细',
  '稳定性回写',
]

export type Validation = { ok: boolean; message: string }
export type DestroyForm = {
  留样数量: string
  销毁存放条件: string
  销毁日期: string
  销毁经手人: string
  销毁方式: string
  销毁明细: string
}
export type DestroyDraft = { step: number; form: DestroyForm }
export type CreateRetainForm = {
  留样编号: string
  对应批号: string
  留样数量: string
  存放条件: string
  留样期限: string
}

/**
 * 留样数量口径（沿用手册既有口径）：以「瓶」为单位的正整数，只认整瓶。
 * 支持传入 10、"10"、"10瓶"、"10 瓶"，无法解析为正整数时返回 null（打回重填）。
 */
export function parseRetainQuantity(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null
  }
  const text = String(value ?? '').replace(/瓶/g, '').trim()
  if (!/^\d+$/.test(text)) {
    return null
  }
  const amount = Number(text)
  return amount > 0 ? amount : null
}

/** 存放条件必须落在手册登记的同一套枚举里，越界打回重填。 */
export function validateStorageCondition(value: string): Validation {
  const text = value.trim()
  if (!text) {
    return { ok: false, message: '存放条件必须登记，不允许为空' }
  }
  if (!STORAGE_CONDITIONS.some((item) => item === text)) {
    return { ok: false, message: `存放条件「${text}」不在手册登记范围内，请从${STORAGE_CONDITIONS.join('、')}中选择` }
  }
  return { ok: true, message: '' }
}

/** 校验状态流转：只能顺着状态机走，越级或重复都挡回。 */
export function allowTransition(action: string, currentStatus: string): Validation {
  // RETAIN_TRANSITIONS 登记的是每个动作唯一合法的发起状态。
  const source = RETAIN_TRANSITIONS[action]
  if (!source) {
    return { ok: false, message: `留样记录没有登记「${action}」这个动作` }
  }
  if (currentStatus !== source) {
    return {
      ok: false,
      message: `留样当前为「${currentStatus}」，「${action}」只能在「${source}」状态办理，不能越级或重复操作`,
    }
  }
  return { ok: true, message: '' }
}

/** 可办理销毁的记录：已到期且没有残留销毁内容；已销毁的走「销毁退回」。 */
export function isDestroyable(status: string): boolean {
  return status === '已到期'
}

/**
 * 在库留样数量口径：已留样、已到期的留样仍在库（已到期是等待销毁，不是消失），
 * 待留样未入库、已销毁已出库。工作台与销毁抽屉共用本函数。
 */
export function inStockQuantity(quantity: unknown, status: string): number {
  return status === '已留样' || status === '已到期' ? (parseRetainQuantity(quantity) ?? 0) : 0
}

export type RetainStats = {
  pendingCount: number
  inStockQuantity: number
  destroyableCount: number
  monthDestroyedCount: number
}

export function currentMonthPrefix(now: Date = new Date()): string {
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}`
}

export function computeRetainStats(
  rows: { status: string; 留样数量?: unknown; 销毁日期?: unknown }[],
  now: Date = new Date(),
): RetainStats {
  const monthPrefix = currentMonthPrefix(now)
  return rows.reduce<RetainStats>(
    (acc, row) => {
      const status = String(row.status)
      if (status === '待留样') {
        acc.pendingCount += 1
      }
      acc.inStockQuantity += inStockQuantity(row.留样数量, status)
      if (isDestroyable(status)) {
        acc.destroyableCount += 1
      }
      if (status === '已销毁' && String(row.销毁日期 ?? '').startsWith(monthPrefix)) {
        acc.monthDestroyedCount += 1
      }
      return acc
    },
    { pendingCount: 0, inStockQuantity: 0, destroyableCount: 0, monthDestroyedCount: 0 },
  )
}

/** 销毁明细按行登记，空行丢弃、重复行只算一条，退回时随中间内容一起清空。 */
export function normalizeDetailLines(text: string): string[] {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line && !seen.has(line)) {
      seen.add(line)
      lines.push(line)
    }
  }
  return lines
}

export function validateDestroyForm(form: DestroyForm): Validation {
  if (parseRetainQuantity(form.留样数量) === null) {
    return { ok: false, message: '留样数量须为以「瓶」为单位的正整数，请按手册口径重填' }
  }
  const storage = validateStorageCondition(form.销毁存放条件)
  if (!storage.ok) {
    return storage
  }
  if (!form.销毁日期.trim()) {
    return { ok: false, message: '销毁日期必须登记' }
  }
  if (!form.销毁经手人.trim()) {
    return { ok: false, message: '销毁经手人必须登记' }
  }
  if (!DESTROY_METHODS.includes(form.销毁方式 as (typeof DESTROY_METHODS)[number])) {
    return { ok: false, message: '请选择销毁方式' }
  }
  if (normalizeDetailLines(form.销毁明细).length === 0) {
    return { ok: false, message: '销毁明细至少登记一条，每行一条' }
  }
  return { ok: true, message: '' }
}

export function emptyDestroyForm(): DestroyForm {
  return {
    留样数量: '',
    销毁存放条件: '',
    销毁日期: '',
    销毁经手人: '',
    销毁方式: '',
    销毁明细: '',
  }
}

// 办理销毁的草稿（含断点步骤）单独存放，按留样记录 id 隔离。
const DRAFT_PREFIX = 'pharma-cleanroom:destroy-draft:'

export function loadDestroyDraft(id: number): DestroyDraft | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  const raw = window.localStorage.getItem(`${DRAFT_PREFIX}${id}`)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as DestroyDraft
    if (typeof parsed.step !== 'number' || !parsed.form) {
      return null
    }
    return { step: parsed.step, form: { ...emptyDestroyForm(), ...parsed.form } }
  } catch {
    return null
  }
}

export function saveDestroyDraft(id: number, draft: DestroyDraft): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(`${DRAFT_PREFIX}${id}`, JSON.stringify(draft))
  }
}

export function clearDestroyDraft(id: number): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(`${DRAFT_PREFIX}${id}`)
  }
}

import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveAll, saveRows } from '@/data/local-store'
import {
  RETAIN_KEY,
  STABILITY_KEY,
  allowTransition,
  clearDestroyDraft,
  computeRetainStats,
  isDestroyable,
  parseRetainQuantity,
  validateDestroyForm,
  validateStorageCondition,
  DESTROY_CLEAR_FIELDS,
  normalizeDetailLines,
  type DestroyForm,
  type RetainStats,
} from '@/data/retainsample'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function withoutFields(row: EntryRow, fields: string[]): EntryRow {
  const draft = { ...row } as EntryRow
  for (const field of fields) {
    delete draft[field]
  }
  return draft
}

/**
 * 留样状态流转（登记留样 / 标记到期 / 销毁退回）。
 * 只能顺着状态机走：越级、重复都由 allowTransition 挡回。
 */
function runRetainAction(id: number, action: string): ActionResult {
  const rows = listRows(RETAIN_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的留样记录` }
  }
  if (action === '办理销毁') {
    return { ok: false, message: '请使用「办理销毁」抽屉逐项登记，列表不直接销毁' }
  }
  const row = rows[index]
  const guard = allowTransition(action, String(row.status))
  if (!guard.ok) {
    return guard
  }
  const targetByAction: Record<string, string> = {
    登记留样: '已留样',
    标记到期: '已到期',
    销毁退回: '已到期',
  }
  const target = targetByAction[action]
  let updated: EntryRow = { ...row, status: target, pending: target !== '已销毁', abnormal: false }

  if (action === '销毁退回') {
    // 退回只清销毁环节的中间内容，留样数量、存放条件等登记内容原样保留。
    updated = withoutFields(updated, DESTROY_CLEAR_FIELDS)
    const stabilityRows = listRows(STABILITY_KEY).map((item) =>
      String(item['考察批号']) === String(row['对应批号'])
        ? withoutField(item, '留样销毁回写')
        : item,
    )
    clearDestroyDraft(id)
    saveAll({ [RETAIN_KEY]: replaceAt(rows, index, updated), [STABILITY_KEY]: stabilityRows })
    return { ok: true, message: '销毁已退回，中间内容已清空，留样回到「已到期」可重新办理' }
  }

  saveRows(RETAIN_KEY, replaceAt(rows, index, updated))
  return { ok: true, message: `留样记录已${action}，当前状态「${target}」` }
}

function withoutField(row: EntryRow, field: string): EntryRow {
  const draft = { ...row } as EntryRow
  delete draft[field]
  return draft
}

function replaceAt(rows: EntryRow[], index: number, row: EntryRow): EntryRow[] {
  const next = [...rows]
  next[index] = row
  return next
}

export function runAction(key: string, id: number, action: string): ActionResult {
  if (key === RETAIN_KEY) {
    return runRetainAction(id, action)
  }
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

/** 留样统计：工作台、留样页、销毁抽屉共用同一口径。 */
export function retainStats(): RetainStats {
  return computeRetainStats(listRows(RETAIN_KEY) as Parameters<typeof computeRetainStats>[0])
}

/** 当前可办理销毁的留样（已到期、未销毁）。 */
export function destroyableRetainRows(): EntryRow[] {
  return listRows(RETAIN_KEY).filter((row) => isDestroyable(String(row.status)))
}

export type CreateRetainInput = {
  留样编号: string
  对应批号: string
  留样数量: string
  存放条件: string
  留样期限: string
}

/** 登记留样：字段齐全校验 + 同一份留样重复提交只算一次。 */
export function createRetain(input: CreateRetainInput): ActionResult {
  const code = input.留样编号.trim()
  const batch = input.对应批号.trim()
  if (!code || !batch) {
    return { ok: false, message: '留样编号与对应批号必须登记齐全' }
  }
  if (parseRetainQuantity(input.留样数量) === null) {
    return { ok: false, message: '留样数量须为以「瓶」为单位的正整数，请按手册口径重填' }
  }
  const storage = validateStorageCondition(input.存放条件)
  if (!storage.ok) {
    return storage
  }
  const rows = listRows(RETAIN_KEY)
  if (rows.some((row) => String(row['留样编号']) === code)) {
    return { ok: false, message: `留样编号「${code}」已登记，同一份留样重复提交只算一次` }
  }
  // 同一批号已有未销毁的留样，视为同一份留样重复提交。
  if (
    rows.some(
      (row) => String(row['对应批号']) === batch && String(row.status) !== '已销毁',
    )
  ) {
    return { ok: false, message: `批号「${batch}」已有在库留样，同一份留样不能重复登记` }
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const created: EntryRow = {
    id,
    status: '待留样',
    pending: true,
    abnormal: false,
    留样编号: code,
    对应批号: batch,
    留样数量: parseRetainQuantity(input.留样数量) as number,
    留样期限: input.留样期限.trim(),
    存放条件: input.存放条件.trim(),
    取样日期: '',
    销毁日期: '',
  }
  saveRows(RETAIN_KEY, [...rows, created])
  return { ok: true, message: `留样「${code}」已登记，当前状态「待留样」` }
}

export type DestroySubmitInput = {
  id: number
  form: DestroyForm
}

/**
 * 办理销毁：校验全部在内存完成，通过后留样表与稳定性表一次性原子落库。
 * 同一份留样重复提交（已带销毁编号 / 状态已销毁）只算一次，直接挡回。
 */
export function submitDestroy(input: DestroySubmitInput): ActionResult {
  const { id, form } = input
  const rows = listRows(RETAIN_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的留样记录` }
  }
  const row = rows[index]
  if (String(row.status) === '已销毁' || row['销毁编号']) {
    return { ok: false, message: '这份留样已办理销毁，同一份留样重复提交只算一次' }
  }
  if (!isDestroyable(String(row.status))) {
    return { ok: false, message: '只有「已到期」的留样才能办理销毁，不能越级' }
  }
  const validation = validateDestroyForm(form)
  if (!validation.ok) {
    return validation
  }
  const registeredQty = parseRetainQuantity(row['留样数量'])
  const submittedQty = parseRetainQuantity(form.留样数量)
  if (registeredQty === null || submittedQty !== registeredQty) {
    return {
      ok: false,
      message: `销毁留样数量须与登记数量（${registeredQty ?? '—'}瓶）一致，请核对后重填`,
    }
  }

  const destroyNo =
    typeof row['销毁编号'] === 'string' && row['销毁编号']
      ? String(row['销毁编号'])
      : `DES-${String(row['留样编号'] ?? id).replace(/^RETA-?/, '')}`
  const details = normalizeDetailLines(form.销毁明细)
  const updated: EntryRow = {
    ...row,
    status: '已销毁',
    pending: false,
    abnormal: false,
    销毁编号: destroyNo,
    留样数量: registeredQty,
    销毁存放条件: form.销毁存放条件.trim(),
    销毁日期: form.销毁日期.trim(),
    销毁经手人: form.销毁经手人.trim(),
    销毁方式: form.销毁方式,
    销毁明细: details.join('\n'),
  }

  const batch = String(row['对应批号'] ?? '')
  const stabilityRows = listRows(STABILITY_KEY)
  const linked = stabilityRows.find((item) => String(item['考察批号']) === batch)
  let message = `留样「${updated['留样编号']}」已销毁`
  if (linked) {
    updated['稳定性回写'] = `${updated['留样编号']} 已于 ${updated['销毁日期']} 销毁`
    const nextStability = stabilityRows.map((item) =>
      item === linked ? { ...item, 留样销毁回写: updated['稳定性回写'] } : item,
    )
    saveAll({ [RETAIN_KEY]: replaceAt(rows, index, updated), [STABILITY_KEY]: nextStability })
    message += '，状态已回写稳定性考察待办'
  } else {
    saveRows(RETAIN_KEY, replaceAt(rows, index, updated))
  }
  clearDestroyDraft(id)
  return { ok: true, message }
}

export type StabilityTodo = {
  key: string
  batch: string
  retainCode: string
  status: string
  writeback: string
}

/**
 * 稳定性考察的留样销毁待办：只列与考察批号真正关联上的留样。
 * 已到期=待销毁，已销毁=已回写（读回写内容）。两处展示同源，不存在对不上。
 */
export function stabilityRetainTodos(): StabilityTodo[] {
  const stabilityBatches = new Set(
    listRows(STABILITY_KEY).map((item) => String(item['考察批号'] ?? '')),
  )
  const todos: StabilityTodo[] = []
  for (const row of listRows(RETAIN_KEY)) {
    const status = String(row.status)
    if (status !== '已到期' && status !== '已销毁') {
      continue
    }
    const batch = String(row['对应批号'] ?? '')
    if (!stabilityBatches.has(batch)) {
      continue
    }
    todos.push({
      key: String(row.id),
      batch,
      retainCode: String(row['留样编号'] ?? ''),
      status,
      writeback: status === '已销毁' ? String(row['稳定性回写'] ?? '已销毁') : '',
    })
  }
  return todos
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const stats = retainStats()
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
    { label: '留样在库数量(瓶)', value: stats.inStockQuantity },
    { label: '留样待销毁批数', value: stats.destroyableCount },
  ]
  return { cards, modules }
}

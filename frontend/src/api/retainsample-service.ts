import { moduleMeta } from '@/api/local-service'
import { listRows, saveRows } from '@/data/local-store'
import {
  appendDestroyDetail,
  clearDestroyDetails,
  clearDestroyDraft,
  isStorageCondition,
  parseSampleCount,
  sampleCountOf,
  STORAGE_CONDITIONS,
} from '@/data/retainsample'
import type { ActionResult, DestroyPayload, EntryRow } from '@/data/types'

// 留样销毁/退回的专用服务：通用 runAction 只管状态跳转，
// 销毁登记、退回清理、销毁明细与断点草稿、稳定性考察待办回写都收在这里。
const MODULE_KEY = 'retainsample'
const STABILITY_KEY = 'stability'

export type DestroyFormValues = {
  留样数量: string
  存放条件: string
  销毁经手人: string
  销毁日期: string
}

function findRow(id: number): { rows: EntryRow[]; index: number } {
  const rows = listRows(MODULE_KEY)
  return { rows, index: rows.findIndex((row) => Number(row.id) === id) }
}

/** 可办理销毁的记录：只有「已到期」的留样才进销毁流程，空了就给空态说明。 */
export function destroyableRows(): EntryRow[] {
  return listRows(MODULE_KEY).filter((row) => String(row.status) === '已到期')
}

/** 销毁登记校验：数量按手册口径、存放条件越界打回、经手人与日期登记齐全。 */
export function validateDestroyValues(values: DestroyFormValues): string | null {
  if (parseSampleCount(values.留样数量) === null) {
    return '留样数量需按手册口径登记为正整数（支/瓶），请打回重填'
  }
  if (!values.存放条件.trim()) {
    return '存放条件未选择，请打回重填'
  }
  if (!isStorageCondition(values.存放条件)) {
    return `存放条件越界，只接受：${STORAGE_CONDITIONS.join('、')}，请打回重填`
  }
  if (!values.销毁经手人.trim()) {
    return '销毁经手人未登记：留样数量、存放条件与销毁经手人需登记齐全'
  }
  if (!values.销毁日期.trim()) {
    return '销毁日期未登记，请打回重填'
  }
  return null
}

/** 办理销毁：顺着流转（已到期→已销毁）、重复提交只算一次、回写稳定性考察待办。 */
export function submitDestroy(id: number, values: DestroyFormValues): ActionResult {
  const { rows, index } = findRow(id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的留样记录` }
  }
  const current = String(rows[index].status)
  if (current === '已销毁') {
    // 幂等：同一份留样重复提交只算一次，状态、明细都不再变。
    return { ok: true, message: '该留样已办理过销毁，同一份留样重复提交只算一次' }
  }
  if (current !== '已到期') {
    return { ok: false, message: `办理销毁只能由「已到期」流转，当前状态「${current}」越级挡回` }
  }
  const error = validateDestroyValues(values)
  if (error) {
    // 打回重填：草稿不清，已填内容保留，修好再从断点提交。
    return { ok: false, message: error }
  }
  const payload: DestroyPayload = {
    留样数量: parseSampleCount(values.留样数量) ?? 0,
    存放条件: values.存放条件.trim(),
    销毁经手人: values.销毁经手人.trim(),
    销毁日期: values.销毁日期.trim(),
  }
  const updated: EntryRow = {
    ...rows[index],
    ...payload,
    留样状态: '已销毁',
    status: '已销毁',
    pending: false,
    abnormal: false,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(MODULE_KEY, next)
  // 明细一个周期只记一条；草稿随提交清掉，断点不留尾巴。
  appendDestroyDetail(id, { ...payload, 提交时间: new Date().toISOString() })
  clearDestroyDraft(id)
  writeBackStability(String(updated['对应批号'] ?? ''), false)
  return { ok: true, message: '留样记录已办理销毁，当前状态「已销毁」' }
}

/** 退回销毁：状态退回「已到期」，销毁阶段填的中间内容（含明细、草稿）一并清掉。 */
export function returnDestroy(id: number): ActionResult {
  const { rows, index } = findRow(id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的留样记录` }
  }
  const current = String(rows[index].status)
  if (current !== '已销毁') {
    return { ok: false, message: `退回销毁只能由「已销毁」流转，当前状态「${current}」越级挡回` }
  }
  const updated: EntryRow = {
    ...rows[index],
    status: '已到期',
    pending: true,
    abnormal: true,
    // 退回后清掉中间内容：销毁日期、存放条件、留样数量、销毁经手人全部清空。
    留样数量: '',
    存放条件: '',
    销毁日期: '',
    销毁经手人: '',
    留样状态: '已到期',
  }
  const next = [...rows]
  next[index] = updated
  saveRows(MODULE_KEY, next)
  clearDestroyDetails(id)
  clearDestroyDraft(id)
  writeBackStability(String(updated['对应批号'] ?? ''), true)
  return { ok: true, message: '留样记录已退回，销毁登记内容已清空，当前状态「已到期」' }
}

/** 销毁/退回的状态回写到稳定性考察的待办：同批号考察记录同步摘掉/挂回待办。 */
function writeBackStability(batchNo: string, pending: boolean): void {
  if (!batchNo) {
    return
  }
  const meta = moduleMeta(STABILITY_KEY)
  const terminal = meta.statuses.slice(-2)
  const rows = listRows(STABILITY_KEY)
  let changed = false
  const next = rows.map((row) => {
    if (String(row['考察批号']) !== batchNo) {
      return row
    }
    // 终态（已完成/已终止）的考察记录不再挂回待办。
    if (pending && terminal.includes(String(row.status))) {
      return row
    }
    if (Boolean(row.pending) === pending) {
      return row
    }
    changed = true
    return { ...row, pending }
  })
  if (changed) {
    saveRows(STABILITY_KEY, next)
  }
}

/** 同批号稳定性考察还剩几条待办：详情抽屉与工作台核对用。 */
export function stabilityTodoOf(batchNo: string): number {
  if (!batchNo) {
    return 0
  }
  return listRows(STABILITY_KEY).filter(
    (row) => String(row['考察批号']) === batchNo && Boolean(row.pending),
  ).length
}

/** 工作台统计卡：按全部留样记录汇总，不随筛选条件变。 */
export function retainsampleStats(): { label: string; value: number }[] {
  const rows = listRows(MODULE_KEY)
  const month = new Date().toISOString().slice(0, 7)
  return [
    { label: '待留样批次', value: rows.filter((row) => String(row.status) === '待留样').length },
    { label: '已留样批次', value: rows.filter((row) => String(row.status) === '已留样').length },
    {
      label: '本月销毁数',
      value: rows.filter(
        (row) =>
          String(row.status) === '已销毁' && String(row['销毁日期'] ?? '').startsWith(month),
      ).length,
    },
  ]
}

/** 留样数量合计：与详情抽屉共用 sampleCountOf 这一套口径，两边不会对不上。 */
export function totalSampleCount(): number {
  return listRows(MODULE_KEY).reduce((sum, row) => sum + sampleCountOf(row), 0)
}

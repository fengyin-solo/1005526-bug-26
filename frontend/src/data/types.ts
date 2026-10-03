/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  // 动作允许的来源状态：登记了就按顺序流转、越级挡回，没登记的动作不限制。
  actionSources?: Record<string, string[]>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 留样销毁登记：留样数量、存放条件、销毁经手人、销毁日期要登记齐全。 */
export type DestroyPayload = {
  留样数量: number
  存放条件: string
  销毁经手人: string
  销毁日期: string
}

/** 销毁明细：同一份留样一个销毁周期只留一条，退回时整批清掉。 */
export type DestroyDetail = DestroyPayload & {
  提交时间: string
}

/** 销毁登记表单的断点草稿：中途关掉、提交失败重试，都从这里接着填。 */
export type DestroyDraft = {
  step: number
  values: {
    留样数量: string
    存放条件: string
    销毁经手人: string
    销毁日期: string
  }
  updatedAt: string
}

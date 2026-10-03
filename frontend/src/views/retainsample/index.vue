<template>
  <section class="page" data-module="retainsample">
    <header class="page-head">
      <div>
        <h2>留样管理管理</h2>
        <p class="page-desc">维护留样记录，围绕留样编号、对应批号、留样数量、留样期限做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记留样记录</button>
        <button class="btn" type="button" @click="openDestroy()">办理销毁登记</button>
        <button class="btn" type="button" @click="exportRows">导出留样管理清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ displayCell(row, column) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">查看</button>
            <button
              v-for="action in rowActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无留样管理数据，可先登记留样记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条留样管理记录 · 留样数量合计 {{ sampleTotal }}（手册口径）</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="drawer.open" class="drawer-mask" @click.self="closeDrawer">
      <aside class="drawer">
        <header class="drawer-head">
          <h3>{{ drawer.mode === 'destroy' ? '办理销毁登记' : '留样详情' }}</h3>
          <button class="btn ghost" type="button" @click="closeDrawer">关闭</button>
        </header>

        <div v-if="drawer.mode === 'destroy'" class="drawer-body">
          <p v-if="!destroyTargets.length" class="empty-state drawer-empty">
            当前没有可办理销毁的留样记录：只有「已到期」的留样才能办理销毁，请先在列表里把「已留样」记录标记到期。
          </p>
          <template v-else>
            <p class="step-pills">
              <span :class="['step-pill', { active: destroyStep === 1 }]">1 填写销毁信息</span>
              <span :class="['step-pill', { active: destroyStep === 2 }]">2 确认提交</span>
            </p>
            <label class="form-item">
              <span>留样记录（仅列已到期的可销毁记录）</span>
              <select v-model.number="destroyForm.id" @change="onPickTarget">
                <option v-for="row in destroyTargets" :key="String(row.id)" :value="Number(row.id)">
                  {{ row['留样编号'] }} · {{ row['对应批号'] }}
                </option>
              </select>
            </label>
            <p v-if="draftRestored" class="draft-hint">已恢复上次未提交的内容，从断点继续填写。</p>

            <template v-if="destroyStep === 1">
              <label class="form-item">
                <span>留样数量（支/瓶，正整数）</span>
                <input v-model="destroyForm.留样数量" inputmode="numeric" placeholder="按手册口径填正整数" />
              </label>
              <label class="form-item">
                <span>存放条件</span>
                <select v-model="destroyForm.存放条件">
                  <option value="" disabled>请选择存放条件</option>
                  <option v-for="item in storageConditions" :key="item" :value="item">{{ item }}</option>
                </select>
              </label>
              <label class="form-item">
                <span>销毁经手人</span>
                <input v-model="destroyForm.销毁经手人" placeholder="填写销毁经手人" />
              </label>
              <label class="form-item">
                <span>销毁日期</span>
                <input v-model="destroyForm.销毁日期" type="date" />
              </label>
              <p class="draft-hint">已填内容会实时暂存，中途关闭或提交失败都不会丢，重开从断点继续。</p>
            </template>

            <template v-else>
              <dl class="detail-list">
                <div><dt>留样编号</dt><dd>{{ currentTarget?.['留样编号'] ?? '—' }}</dd></div>
                <div><dt>留样数量</dt><dd>{{ destroyForm.留样数量 }}</dd></div>
                <div><dt>存放条件</dt><dd>{{ destroyForm.存放条件 }}</dd></div>
                <div><dt>销毁经手人</dt><dd>{{ destroyForm.销毁经手人 }}</dd></div>
                <div><dt>销毁日期</dt><dd>{{ destroyForm.销毁日期 }}</dd></div>
              </dl>
            </template>

            <p v-if="drawerError" class="error-text">{{ drawerError }}</p>
          </template>
        </div>

        <div v-else class="drawer-body">
          <dl class="detail-list">
            <div v-for="field in detailFields" :key="field">
              <dt>{{ field }}</dt>
              <dd>{{ detailValue(field) }}</dd>
            </div>
            <div><dt>当前状态</dt><dd>{{ drawer.row?.status ?? '—' }}</dd></div>
            <div><dt>同批号稳定性考察待办</dt><dd>{{ stabilityTodo }} 条</dd></div>
          </dl>
          <h4 class="drawer-subhead">销毁明细</h4>
          <table v-if="details.length" class="data-table">
            <thead>
              <tr><th>提交时间</th><th>留样数量</th><th>存放条件</th><th>销毁经手人</th><th>销毁日期</th></tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in details" :key="index">
                <td>{{ item.提交时间 }}</td>
                <td>{{ item.留样数量 }}</td>
                <td>{{ item.存放条件 }}</td>
                <td>{{ item.销毁经手人 }}</td>
                <td>{{ item.销毁日期 }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="empty-state drawer-empty">本周期暂无销毁明细。</p>
        </div>

        <footer v-if="drawer.mode === 'destroy' && destroyTargets.length" class="drawer-foot">
          <button v-if="destroyStep === 2" class="btn ghost" type="button" @click="backToEdit">上一步</button>
          <button v-if="destroyStep === 1" class="btn primary" type="button" @click="goConfirm">下一步</button>
          <button v-else class="btn primary" type="button" @click="submitDestroyForm">确认提交</button>
        </footer>
        <footer v-else-if="drawer.mode === 'detail' && drawer.row" class="drawer-foot">
          <button
            v-if="drawer.row.status === '已到期'"
            class="btn primary"
            type="button"
            @click="openDestroy(drawer.row)"
          >
            办理销毁
          </button>
          <button
            v-if="drawer.row.status === '已销毁'"
            class="btn"
            type="button"
            @click="confirmReturn(drawer.row)"
          >
            退回销毁
          </button>
        </footer>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  destroyableRows,
  retainsampleStats,
  returnDestroy,
  stabilityTodoOf,
  submitDestroy,
  totalSampleCount,
  validateDestroyValues,
} from '@/api/retainsample-service'
import {
  listDestroyDetails,
  loadDestroyDraft,
  sampleCountOf,
  saveDestroyDraft,
  STORAGE_CONDITIONS,
} from '@/data/retainsample'
import type { DestroyDetail, EntryRow } from '@/data/types'

const meta = moduleMeta('retainsample')
const columns = meta.fields
const statuses = meta.statuses
const storageConditions = STORAGE_CONDITIONS

// 状态只能顺着流转：每个状态只放出下一步动作，越级操作由服务层挡回。
const STATUS_ACTIONS: Record<string, string[]> = {
  待留样: ['登记留样'],
  已留样: ['标记到期'],
  已到期: ['办理销毁'],
  已销毁: ['退回销毁'],
}

const rows = ref<EntryRow[]>([])
const total = ref(0)
const stats = ref<{ label: string; value: number }[]>([])
const sampleTotal = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const drawer = reactive<{ open: boolean; mode: 'detail' | 'destroy'; row: EntryRow | null }>({
  open: false,
  mode: 'detail',
  row: null,
})
const detailFields = meta.fields
const details = ref<DestroyDetail[]>([])
const stabilityTodo = ref(0)

const destroyTargets = ref<EntryRow[]>([])
const destroyStep = ref(1)
const destroyForm = reactive({ id: 0, 留样数量: '', 存放条件: '', 销毁经手人: '', 销毁日期: '' })
const drawerError = ref('')
const draftRestored = ref(false)
const currentTarget = computed(
  () => destroyTargets.value.find((row) => Number(row.id) === Number(destroyForm.id)) ?? null,
)

// 断点草稿：表单每动一下就暂存，中途停掉不丢，失败重试、重新打开都从这里续上。
watch(
  () => [
    destroyForm.id,
    destroyForm.留样数量,
    destroyForm.存放条件,
    destroyForm.销毁经手人,
    destroyForm.销毁日期,
    destroyStep.value,
  ],
  () => {
    if (!drawer.open || drawer.mode !== 'destroy' || !destroyForm.id) {
      return
    }
    saveDestroyDraft(destroyForm.id, {
      step: destroyStep.value,
      values: {
        留样数量: destroyForm.留样数量,
        存放条件: destroyForm.存放条件,
        销毁经手人: destroyForm.销毁经手人,
        销毁日期: destroyForm.销毁日期,
      },
      updatedAt: new Date().toISOString(),
    })
  },
)

function rowActions(row: EntryRow): string[] {
  return STATUS_ACTIONS[String(row.status)] ?? []
}

function displayCell(row: EntryRow, column: string): string | number {
  const value = row[column]
  if (value === '' || value === undefined || value === null) {
    return '—'
  }
  return typeof value === 'boolean' ? String(value) : value
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '留样记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  if (action === '办理销毁') {
    openDestroy(row)
    return
  }
  if (action === '退回销毁') {
    confirmReturn(row)
    return
  }
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function confirmReturn(row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const ok = window.confirm(
    `确认退回留样「${row['留样编号']}」的销毁登记？销毁日期、存放条件、留样数量与销毁经手人将一并清空。`,
  )
  if (!ok) {
    return
  }
  const result = returnDestroy(Number(row.id))
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function openDetail(row: EntryRow) {
  drawer.mode = 'detail'
  drawer.row = row
  details.value = listDestroyDetails(Number(row.id))
  stabilityTodo.value = stabilityTodoOf(String(row['对应批号'] ?? ''))
  drawer.open = true
}

function detailValue(field: string): string | number {
  const row = drawer.row
  if (!row) {
    return '—'
  }
  if (field === '留样数量') {
    const raw = row['留样数量']
    if (raw === '' || raw === undefined || raw === null) {
      return '—'
    }
    // 抽屉与工作台同一套留样数量口径。
    return sampleCountOf(row)
  }
  const value = row[field]
  return value === '' || value === undefined || value === null ? '—' : String(value)
}

function openDestroy(row?: EntryRow) {
  destroyTargets.value = destroyableRows()
  drawerError.value = ''
  draftRestored.value = false
  destroyStep.value = 1
  const first = row && String(row.status) === '已到期' ? row : destroyTargets.value[0]
  destroyForm.id = first ? Number(first.id) : 0
  destroyForm.留样数量 = ''
  destroyForm.存放条件 = ''
  destroyForm.销毁经手人 = ''
  destroyForm.销毁日期 = ''
  if (first) {
    restoreDraft(Number(first.id))
  }
  drawer.mode = 'destroy'
  drawer.open = true
}

function restoreDraft(id: number) {
  const draft = loadDestroyDraft(id)
  if (!draft) {
    return
  }
  destroyForm.留样数量 = draft.values.留样数量
  destroyForm.存放条件 = draft.values.存放条件
  destroyForm.销毁经手人 = draft.values.销毁经手人
  destroyForm.销毁日期 = draft.values.销毁日期
  destroyStep.value = draft.step === 2 ? 2 : 1
  draftRestored.value = true
}

function onPickTarget() {
  // 换记录就换到那条记录自己的断点，互不串味。
  destroyStep.value = 1
  destroyForm.留样数量 = ''
  destroyForm.存放条件 = ''
  destroyForm.销毁经手人 = ''
  destroyForm.销毁日期 = ''
  draftRestored.value = false
  if (destroyForm.id) {
    restoreDraft(destroyForm.id)
  }
}

function goConfirm() {
  drawerError.value = ''
  const error = validateDestroyValues(destroyForm)
  if (error) {
    drawerError.value = error
    return
  }
  destroyStep.value = 2
}

function backToEdit() {
  drawerError.value = ''
  destroyStep.value = 1
}

function submitDestroyForm() {
  drawerError.value = ''
  const result = submitDestroy(destroyForm.id, { ...destroyForm })
  if (!result.ok) {
    // 打回重填：草稿留着，已填内容不丢，修好再提交。
    drawerError.value = result.message
    return
  }
  noticeMessage.value = result.message
  closeDrawer()
  reload()
}

function closeDrawer() {
  drawer.open = false
  drawerError.value = ''
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    stats.value = retainsampleStats()
    sampleTotal.value = totalSampleCount()
    const current = drawer.row
    if (drawer.open && drawer.mode === 'detail' && current) {
      const fresh = listEntries(meta.key).items.find((item) => Number(item.id) === Number(current.id))
      if (fresh) {
        drawer.row = fresh
      }
      details.value = listDestroyDetails(Number(current.id))
      stabilityTodo.value = stabilityTodoOf(String(current['对应批号'] ?? ''))
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '留样管理列表读取失败'
  }
}

onMounted(reload)
</script>

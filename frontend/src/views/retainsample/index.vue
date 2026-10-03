<template>
  <section class="page" data-module="retainsample">
    <header class="page-head">
      <div>
        <h2>留样管理管理</h2>
        <p class="page-desc">维护留样记录，围绕留样编号、对应批号、留样数量、留样期限做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="createOpen = true">登记留样记录</button>
        <button class="btn" type="button" @click="destroyOpen = true">办理销毁</button>
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
          <td
            v-for="column in columns"
            :key="column"
            :title="column === '销毁经手人' ? detailHint(row) : ''"
          >{{ row[column] || '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
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
      <span>共 {{ total }} 条留样管理记录</span>
      <span v-if="successMessage" class="drawer-ok">{{ successMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <RetainCreateDrawer
      v-if="createOpen"
      @done="onDrawerDone"
      @close="createOpen = false"
    />
    <DestroyDrawer
      v-if="destroyOpen"
      @done="onDrawerDone"
      @close="destroyOpen = false"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  retainStats as loadRetainStats,
  runAction as applyAction,
} from '@/api/local-service'
import DestroyDrawer from '@/components/DestroyDrawer.vue'
import RetainCreateDrawer from '@/components/RetainCreateDrawer.vue'
import { computeRetainStats } from '@/data/retainsample'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('retainsample')
// 销毁经手人随销毁登记上单据；销毁退回后与其他销毁中间内容一起清空。
const columns = ['留样编号', '对应批号', '留样数量', '存放条件', '留样期限', '取样日期', '销毁日期', '销毁经手人']
const statuses = ['待留样', '已留样', '已到期', '已销毁']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const successMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const createOpen = ref(false)
const destroyOpen = ref(false)

// 工作台、销毁抽屉、本页统计共用 computeRetainStats 同一口径，数量不会对不上。
const stats = computed(() => {
  const summary = computeRetainStats(
    rows.value as Parameters<typeof computeRetainStats>[0],
  )
  return [
    { label: '待留样批次', value: summary.pendingCount },
    { label: '在库留样数量(瓶)', value: summary.inStockQuantity },
    { label: '待销毁批数', value: summary.destroyableCount },
    { label: '本月销毁数', value: summary.monthDestroyedCount },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

/** 状态只能顺着流转，每个状态只给下一步动作，越级无从点起，服务端还会再挡一道。 */
function rowActions(row: EntryRow): string[] {
  switch (String(row.status)) {
    case '待留样':
      return ['登记留样']
    case '已留样':
      return ['标记到期']
    case '已到期':
      return ['办理销毁']
    case '已销毁':
      return ['销毁退回']
    default:
      return []
  }
}

function detailHint(row: EntryRow): string {
  const parts = [
    row['销毁存放条件'] ? `销毁存放条件：${row['销毁存放条件']}` : '',
    row['销毁方式'] ? `销毁方式：${row['销毁方式']}` : '',
    row['销毁明细'] ? `销毁明细：\n${String(row['销毁明细'])}` : '',
  ].filter(Boolean)
  return parts.join('\n')
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function onDrawerDone(message: string) {
  createOpen.value = false
  destroyOpen.value = false
  successMessage.value = message
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  successMessage.value = ''
  if (action === '办理销毁') {
    destroyOpen.value = true
    return
  }
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  successMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    // 预热一次共享口径，保证与工作台读到的数量同源。
    loadRetainStats()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '留样管理列表读取失败'
  }
}

onMounted(reload)
</script>

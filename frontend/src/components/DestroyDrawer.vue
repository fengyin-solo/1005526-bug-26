<template>
  <teleport to="body">
    <div class="drawer-mask" @click="close" />
    <aside class="drawer" role="dialog" aria-label="办理销毁">
      <header class="drawer-head">
        <h3>办理销毁</h3>
        <button class="btn ghost" type="button" @click="close">关闭</button>
      </header>
      <div class="drawer-body">
        <p v-if="resumeHint" class="hint">{{ resumeHint }}</p>
        <div v-if="candidates.length" class="step-bar">
          <span
            v-for="(label, index) in stepLabels"
            :key="label"
            class="step-dot"
            :class="{ active: step === index }"
          >{{ index + 1 }}. {{ label }}</span>
        </div>
        <p v-if="errorMessage" class="drawer-error">{{ errorMessage }}</p>

        <!-- 第一步：选择待销毁留样；没有可销毁记录时给空态说明 -->
        <div v-if="step === 0">
          <div v-if="!candidates.length" class="drawer-empty">
            当前没有可销毁的留样记录。<br />
            只有「已到期」且未销毁的留样才能办理销毁，可先在列表里把在库留样标记到期。
          </div>
          <div v-else class="pick-list">
            <button
              v-for="row in candidates"
              :key="String(row.id)"
              type="button"
              class="pick-item"
              :class="{ selected: selectedId === Number(row.id) }"
              @click="selectRetain(Number(row.id))"
            >
              <strong>{{ row['留样编号'] }}</strong>
              <span class="hint">（批号：{{ row['对应批号'] }}）</span>
              <dl>
                <dt>登记留样数量：{{ row['留样数量'] }}瓶</dt>
                <dt>存放条件：{{ row['存放条件'] }}</dt>
                <dt>留样期限：{{ row['留样期限'] || '—' }}</dt>
              </dl>
            </button>
          </div>
        </div>

        <!-- 第二步：逐项登记销毁内容 -->
        <div v-else-if="step === 1 && selected" class="form-grid">
          <div class="form-field">
            <label>留样数量（瓶，正整数，沿用登记口径）</label>
            <input v-model="form.留样数量" placeholder="例如 30 或 30瓶" />
            <span class="hint">登记数量为 {{ selected['留样数量'] }}瓶，须一致</span>
          </div>
          <div class="form-field">
            <label>存放条件（与登记处同一套口径）</label>
            <select v-model="form.销毁存放条件">
              <option value="" disabled>请选择存放条件</option>
              <option v-for="item in storageConditions" :key="item" :value="item">{{ item }}</option>
            </select>
          </div>
          <div class="form-field">
            <label>销毁日期</label>
            <input v-model="form.销毁日期" type="date" />
          </div>
          <div class="form-field">
            <label>销毁经手人</label>
            <input v-model="form.销毁经手人" placeholder="登记经手人姓名" />
          </div>
          <div class="form-field">
            <label>销毁方式</label>
            <select v-model="form.销毁方式">
              <option value="" disabled>请选择销毁方式</option>
              <option v-for="item in destroyMethods" :key="item" :value="item">{{ item }}</option>
            </select>
          </div>
          <div class="form-field">
            <label>销毁明细（每行一条，重复行自动合并）</label>
            <textarea v-model="form.销毁明细" placeholder="每行登记一条销毁明细"></textarea>
          </div>
        </div>

        <!-- 第三步：核对后提交 -->
        <div v-else-if="step === 2 && selected" class="form-grid">
          <div class="form-field"><label>留样编号</label><input :value="String(selected['留样编号'])" disabled /></div>
          <div class="form-field"><label>对应批号</label><input :value="String(selected['对应批号'])" disabled /></div>
          <div class="form-field"><label>留样数量</label><input :value="`${form.留样数量}瓶`" disabled /></div>
          <div class="form-field"><label>存放条件</label><input :value="form.销毁存放条件" disabled /></div>
          <div class="form-field"><label>销毁日期</label><input :value="form.销毁日期" disabled /></div>
          <div class="form-field"><label>销毁经手人</label><input :value="form.销毁经手人" disabled /></div>
          <div class="form-field"><label>销毁方式</label><input :value="form.销毁方式" disabled /></div>
          <div class="form-field">
            <label>销毁明细（{{ detailLines.length }} 条）</label>
            <textarea :value="detailLines.join('\n')" disabled></textarea>
          </div>
        </div>
      </div>
      <footer class="drawer-foot">
        <button class="btn" type="button" @click="close">{{ step === 2 ? '取消（保留草稿）' : '关闭' }}</button>
        <button v-if="step > 0" class="btn" type="button" @click="goPrev">上一步</button>
        <button v-if="step === 0 && selectedId !== null" class="btn primary" type="button" @click="goNext">
          去登记销毁内容
        </button>
        <button v-else-if="step === 1" class="btn primary" type="button" @click="goNext">核对内容</button>
        <button v-else-if="step === 2" class="btn primary" type="button" :disabled="submitting" @click="submit">
          {{ submitting ? '提交中…' : '确认销毁' }}
        </button>
      </footer>
    </aside>
  </teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { destroyableRetainRows, submitDestroy } from '@/api/local-service'
import {
  DESTROY_METHODS,
  STORAGE_CONDITIONS,
  emptyDestroyForm,
  loadDestroyDraft,
  normalizeDetailLines,
  saveDestroyDraft,
  validateDestroyForm,
  type DestroyForm,
} from '@/data/retainsample'
import type { EntryRow } from '@/data/types'

const emit = defineEmits<{
  (event: 'done', message: string): void
  (event: 'close'): void
}>()

const storageConditions = STORAGE_CONDITIONS
const destroyMethods = DESTROY_METHODS
const stepLabels = ['选择留样', '登记内容', '核对提交']

const candidates = ref<EntryRow[]>([])
const step = ref(0)
const selectedId = ref<number | null>(null)
const form = ref<DestroyForm>(emptyDestroyForm())
const errorMessage = ref('')
const resumeHint = ref('')
const submitting = ref(false)

const selected = computed(
  () => candidates.value.find((row) => Number(row.id) === selectedId.value) ?? null,
)
const detailLines = computed(() => normalizeDetailLines(form.value.销毁明细))

/** 打开抽屉：恢复最近一次未完成的草稿（断点续上）。 */
function open() {
  candidates.value = destroyableRetainRows()
  errorMessage.value = ''
  resumeHint.value = ''
  for (const row of candidates.value) {
    const draft = loadDestroyDraft(Number(row.id))
    if (draft) {
      selectedId.value = Number(row.id)
      step.value = Math.min(draft.step, 1)
      form.value = draft.form
      resumeHint.value = '已从上次中断处恢复草稿，已填内容不会丢失'
      return
    }
  }
  selectedId.value = null
  step.value = 0
  form.value = emptyDestroyForm()
}

function persistDraft(currentStep: number) {
  if (selectedId.value !== null) {
    saveDestroyDraft(selectedId.value, { step: currentStep, form: form.value })
  }
}

function selectRetain(id: number) {
  errorMessage.value = ''
  if (selectedId.value === id) {
    return
  }
  selectedId.value = id
  const draft = loadDestroyDraft(id)
  if (draft) {
    step.value = Math.min(draft.step, 1)
    form.value = draft.form
    resumeHint.value = '已从上次中断处恢复草稿，已填内容不会丢失'
  } else {
    step.value = 1
    const seed = selected.value
    const seedCondition = String(seed?.['存放条件'] ?? '')
    form.value = {
      ...emptyDestroyForm(),
      留样数量: String(seed?.['留样数量'] ?? ''),
      // 存放条件两处同源：默认带出登记时的同一套取值，仍可在枚举内改选。
      销毁存放条件: (storageConditions as readonly string[]).includes(seedCondition)
        ? seedCondition
        : '',
      销毁日期: today(),
    }
    persistDraft(step.value)
  }
}

function today(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function goNext() {
  errorMessage.value = ''
  if (step.value === 1) {
    const validation = validateDestroyForm(form.value)
    if (!validation.ok) {
      errorMessage.value = validation.message
      return
    }
  }
  step.value += 1
  persistDraft(step.value)
}

function goPrev() {
  errorMessage.value = ''
  step.value -= 1
  persistDraft(step.value)
}

async function submit() {
  if (selectedId.value === null) {
    return
  }
  errorMessage.value = ''
  // 提交前再验一次：失败停在当前步，草稿已在，重试从断点续上。
  const validation = validateDestroyForm(form.value)
  if (!validation.ok) {
    errorMessage.value = validation.message
    step.value = 1
    return
  }
  submitting.value = true
  try {
    // 纯前端本地写库，包一层微任务模拟提交，中断时草稿仍在、不会写入半成品。
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    const result = submitDestroy({ id: selectedId.value, form: form.value })
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    emit('done', result.message)
  } finally {
    submitting.value = false
  }
}

function close() {
  // 中途关掉：已填内容随草稿保留，下次打开继续；不改变任何记录状态。
  emit('close')
}

onMounted(open)
</script>

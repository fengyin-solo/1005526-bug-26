<template>
  <teleport to="body">
    <div class="drawer-mask" @click="close" />
    <aside class="drawer" role="dialog" aria-label="登记留样记录">
      <header class="drawer-head">
        <h3>登记留样记录</h3>
        <button class="btn ghost" type="button" @click="close">关闭</button>
      </header>
      <div class="drawer-body">
        <p v-if="errorMessage" class="drawer-error">{{ errorMessage }}</p>
        <div class="form-grid">
          <div class="form-field">
            <label>留样编号</label>
            <input v-model="form.留样编号" placeholder="例如 RETA-0010" />
          </div>
          <div class="form-field">
            <label>对应批号</label>
            <input v-model="form.对应批号" placeholder="登记对应产品批号" />
          </div>
          <div class="form-field">
            <label>留样数量（瓶，正整数）</label>
            <input v-model="form.留样数量" placeholder="沿用手册口径，以整瓶计" />
          </div>
          <div class="form-field">
            <label>存放条件</label>
            <select v-model="form.存放条件">
              <option value="" disabled>请选择存放条件</option>
              <option v-for="item in storageConditions" :key="item" :value="item">{{ item }}</option>
            </select>
            <span class="hint">与办理销毁处共用同一套口径，越界值会被打回重填</span>
          </div>
          <div class="form-field">
            <label>留样期限至</label>
            <input v-model="form.留样期限" type="date" />
          </div>
        </div>
      </div>
      <footer class="drawer-foot">
        <button class="btn" type="button" @click="close">取消</button>
        <button class="btn primary" type="button" @click="submit">提交登记</button>
      </footer>
    </aside>
  </teleport>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { createRetain } from '@/api/local-service'
import { STORAGE_CONDITIONS, type CreateRetainForm } from '@/data/retainsample'

const emit = defineEmits<{
  (event: 'done', message: string): void
  (event: 'close'): void
}>()

const storageConditions = STORAGE_CONDITIONS

function emptyForm(): CreateRetainForm {
  return { 留样编号: '', 对应批号: '', 留样数量: '', 存放条件: '', 留样期限: '' }
}

const form = ref<CreateRetainForm>(emptyForm())
const errorMessage = ref('')

onMounted(() => {
  form.value = emptyForm()
  errorMessage.value = ''
})

function submit() {
  errorMessage.value = ''
  const result = createRetain(form.value)
  if (!result.ok) {
    // 校验失败：抽屉不关、已填内容保留，改完直接重试。
    errorMessage.value = result.message
    return
  }
  emit('done', result.message)
}

function close() {
  emit('close')
}
</script>

<script setup lang="ts">
import type { PlanBackground } from '~/types/hydraulic'
import { GRID } from '~/stores/simulator'

const props = defineProps<{ projectId: string; canEdit: boolean }>()
const emit = defineEmits<{ close: [] }>()
const sim = useSimulator()
const client = useSupabaseClient()

const fileInput = ref<HTMLInputElement>()
const busy = ref('')
const error = ref('')
/** Çok sayfalı PDF: sayfa seçimi bekleniyor */
const pending = ref<{ file: File; pages: number; page: number } | null>(null)

const bg = computed(() => sim.background)
const sizeM = computed(() => bg.value && `${((bg.value.w * bg.value.scale) / GRID).toFixed(1)} × ${((bg.value.h * bg.value.scale) / GRID).toFixed(1)} m`)

async function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  error.value = ''
  try {
    busy.value = 'Dosya okunuyor…'
    const pages = await planPageCount(file)
    if (pages > 1) { pending.value = { file, pages, page: 1 }; return }
    await upload(file, 1)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Dosya okunamadı'
  } finally {
    if (!pending.value) busy.value = ''
  }
}

async function confirmPage() {
  const p = pending.value
  if (!p) return
  pending.value = null
  try { await upload(p.file, Math.min(p.pages, Math.max(1, Math.round(p.page)))) }
  catch (err) { error.value = err instanceof Error ? err.message : 'Dosya okunamadı' }
  finally { busy.value = '' }
}

async function upload(file: File, page: number) {
  busy.value = 'Plan hazırlanıyor…'
  const r = await rasterizePlan(file, page)
  busy.value = 'Yükleniyor…'
  const path = `${props.projectId}/${crypto.randomUUID()}.${r.ext}`
  const { error: err } = await client.storage.from(PLAN_BUCKET).upload(path, r.blob, { contentType: r.blob.type, upsert: false })
  if (err) throw new Error(err.message.includes('row-level security') ? 'Plan yüklenemedi: düzenleme kilidi sizde değil' : err.message)
  const name = page > 1 || /\.pdf$/i.test(file.name) ? `${file.name} · s. ${page}` : file.name
  const old = sim.background
  let next: PlanBackground
  if (old) {
    // Planın yeni revizyonu: aynı yerde, aynı gerçek genişlikte
    next = { ...old, path, name, w: r.w, h: r.h, scale: (old.w * old.scale) / r.w, hidden: false }
  } else {
    // İlk yerleşim: modeli kapsayacak (yoksa 60 m) genişlikte; ardından iki noktayla ölçeklenir
    const xs = sim.nodes.map((n) => n.x), ys = sim.nodes.map((n) => n.y)
    const width = xs.length ? Math.max(Math.max(...xs) - Math.min(...xs), 20 * GRID) * 1.2 : 60 * GRID
    const scale = width / r.w
    const x = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 - width / 2 : 0
    const y = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 - (r.h * scale) / 2 : 0
    next = { path, name, w: r.w, h: r.h, x, y, scale, opacity: 0.5, locked: false, calibrated: false }
  }
  sim.background = next
  sim.fitView()
  if (!next.calibrated) sim.planMode = 'calibrate'
}

function toggleMode(m: 'move' | 'calibrate') { sim.planMode = sim.planMode === m ? null : m }
function remove() {
  if (!confirm('Arka plan planı kaldırılsın mı? (Ctrl+Z ile geri alınabilir; eski sürümlerde plan görünmeye devam eder)')) return
  sim.planMode = null
  sim.background = null
}
</script>

<template>
  <section class="flex max-h-full flex-col rounded-lg border border-slate-200 bg-white shadow-lg" aria-label="Arka plan planı">
    <header class="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
      <Icon name="lucide:map" />
      <h2 class="font-semibold">Arka plan planı</h2>
      <button class="btn ml-auto px-2" aria-label="Kapat" @click="emit('close')"><Icon name="lucide:x" /></button>
    </header>
    <div class="min-h-0 space-y-3 overflow-auto p-3 text-sm">
      <input ref="fileInput" type="file" class="hidden" :accept="PLAN_ACCEPT" @change="onPick" />
      <p v-if="error" class="text-red-600" role="alert">{{ error }}</p>
      <p v-if="busy" class="flex items-center gap-2 text-slate-500" role="status"><Icon name="lucide:loader-circle" class="animate-spin" />{{ busy }}</p>

      <div v-if="pending" class="space-y-2 rounded border border-slate-200 p-2">
        <label class="flex items-center gap-2">PDF sayfası
          <input v-model.number="pending.page" type="number" min="1" :max="pending.pages" class="input w-20" />
          <span class="text-slate-500">/ {{ pending.pages }}</span>
        </label>
        <div class="flex gap-1">
          <button class="btn btn-primary" @click="confirmPage">Yükle</button>
          <button class="btn" @click="pending = null; busy = ''">Vazgeç</button>
        </div>
      </div>

      <template v-if="!bg">
        <p class="text-slate-500">Kat planını (PDF, PNG, JPG) tuvalin altına yerleştirin; ölçüsünü bildiğiniz iki noktayla ölçekleyip üzerine çizin.</p>
        <button v-if="canEdit" class="btn btn-primary w-full justify-center" :disabled="!!busy" @click="fileInput?.click()"><Icon name="lucide:upload" />Plan yükle</button>
        <p v-else class="text-slate-500">Plan eklemek için düzenleme yetkisi gerekir.</p>
      </template>

      <template v-else>
        <div>
          <div class="truncate font-medium" :title="bg.name">{{ bg.name }}</div>
          <div class="text-xs text-slate-500">{{ sizeM }}</div>
        </div>
        <p v-if="!bg.calibrated" class="rounded border border-amber-400 bg-amber-50 px-2 py-1 text-xs text-amber-900">Ölçek henüz ayarlanmadı: “Ölçekle” ile ölçüsünü bildiğiniz iki noktayı seçin.</p>
        <template v-if="canEdit">
          <label class="block">
            <span class="text-xs text-slate-500">Saydamlık: %{{ Math.round(bg.opacity * 100) }}</span>
            <input v-model.number="bg.opacity" type="range" min="0.1" max="1" step="0.05" class="w-full" />
          </label>
          <div class="grid grid-cols-2 gap-1">
            <button class="btn justify-center" :class="sim.planMode === 'calibrate' && 'btn-active'" :aria-pressed="sim.planMode === 'calibrate'" :disabled="bg.hidden" @click="toggleMode('calibrate')"><Icon name="lucide:ruler" />Ölçekle</button>
            <button class="btn justify-center" :class="sim.planMode === 'move' && 'btn-active'" :aria-pressed="sim.planMode === 'move'" :disabled="bg.locked || bg.hidden" @click="toggleMode('move')"><Icon name="lucide:move" />Taşı</button>
            <button class="btn justify-center" :aria-pressed="bg.locked" @click="bg.locked = !bg.locked; sim.planMode = null"><Icon :name="bg.locked ? 'lucide:lock' : 'lucide:lock-open'" />{{ bg.locked ? 'Kilidi aç' : 'Kilitle' }}</button>
            <button class="btn justify-center" :aria-pressed="!!bg.hidden" @click="bg.hidden = !bg.hidden; sim.planMode = null"><Icon :name="bg.hidden ? 'lucide:eye' : 'lucide:eye-off'" />{{ bg.hidden ? 'Göster' : 'Gizle' }}</button>
            <button class="btn justify-center" :disabled="!!busy" title="Yeni revizyon aynı yere, aynı ölçekle yerleşir" @click="fileInput?.click()"><Icon name="lucide:replace" />Değiştir</button>
            <button class="btn justify-center" @click="remove"><Icon name="lucide:trash-2" />Kaldır</button>
          </div>
        </template>
      </template>
    </div>
  </section>
</template>

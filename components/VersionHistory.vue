<script setup lang="ts">
/** Proje sürüm geçmişi: listeler; geri yükleme ve adlandırılmış kayıt işlemlerini sayfaya bırakır (önce kaydetme gerekir). */
const props = defineProps<{
  projectId: string
  canEdit: boolean
  restore: (id: string) => Promise<boolean>
  saveNamed: (label: string) => Promise<boolean>
}>()
const emit = defineEmits<{ close: [] }>()
const client = useSupabaseClient<any>()

interface Version {
  id: string; label: string | null; reason: 'baseline' | 'edit' | 'restore' | 'manual'
  started_at: string; created_at: string; author: { full_name: string | null; email: string } | null
}
const versions = ref<Version[]>([])
const loading = ref(true)
const error = ref('')
const busy = ref<string | null>(null)

async function load() {
  loading.value = true
  const { data, error: e } = await client.from('project_versions')
    .select('id,label,reason,started_at,created_at,author:profiles!created_by(full_name,email)')
    .eq('project_id', props.projectId).order('created_at', { ascending: false }).limit(150)
  error.value = e?.message ?? ''
  versions.value = (data ?? []) as unknown as Version[]
  loading.value = false
}
onMounted(load)
defineExpose({ load })

async function doRestore(v: Version) {
  busy.value = v.id
  if (await props.restore(v.id)) await load()
  busy.value = null
}
async function doSave() {
  const label = prompt('Sürüm adı (ör. “Rapor öncesi”, “Revizyon 2”)')?.trim()
  if (!label) return
  busy.value = 'save'
  if (await props.saveNamed(label.slice(0, 80))) await load()
  busy.value = null
}

const REASON: Record<Version['reason'], string> = { baseline: 'Başlangıç', edit: 'Düzenleme', restore: 'Geri yükleme', manual: '' }
const who = (v: Version) => v.author?.full_name || v.author?.email || 'Eski üye'
const day = (d: string) => new Date(d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })
const time = (d: string) => new Date(d).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
/** Düzenleme oturumu birden fazla dakikaya yayıldıysa aralığı göster */
const when = (v: Version) => {
  const a = time(v.started_at), b = time(v.created_at)
  return v.reason === 'edit' && a !== b ? `${a}–${b}` : b
}
const groups = computed(() => {
  const out: { day: string; items: Version[] }[] = []
  for (const v of versions.value) {
    const d = day(v.created_at)
    if (out.at(-1)?.day !== d) out.push({ day: d, items: [] })
    out.at(-1)!.items.push(v)
  }
  return out
})
</script>

<template>
  <section class="flex h-full flex-col rounded-lg border border-slate-200 bg-white shadow-lg" aria-label="Sürüm geçmişi">
    <header class="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
      <Icon name="lucide:history" />
      <h2 class="font-semibold">Sürüm geçmişi</h2>
      <button class="btn ml-auto px-2" aria-label="Kapat" @click="emit('close')"><Icon name="lucide:x" /></button>
    </header>
    <div class="border-b border-slate-200 p-3 text-xs text-slate-500">
      Değişiklikler otomatik saklanır: kişi başına 10 dakikada bir sürüm, son 100 sürüm. Adlandırdığınız sürümler silinmez.
      <button v-if="canEdit" class="btn mt-2 w-full justify-center" :disabled="!!busy" @click="doSave">
        <Icon name="lucide:bookmark-plus" />Şimdiki hâli adlandırarak kaydet
      </button>
    </div>
    <p v-if="error" class="p-3 text-sm text-red-600" role="alert">{{ error }}</p>
    <p v-else-if="loading" class="p-3 text-sm text-slate-500">Yükleniyor…</p>
    <p v-else-if="!versions.length" class="p-3 text-sm text-slate-500">Henüz sürüm yok. İlk değişiklikten sonra burada görünür.</p>
    <ol v-else class="min-h-0 flex-1 overflow-auto">
      <li v-for="g in groups" :key="g.day">
        <div class="sticky top-0 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{{ g.day }}</div>
        <ul class="divide-y divide-slate-200">
          <li v-for="(v, i) in g.items" :key="v.id" class="flex items-center gap-2 px-3 py-2 text-sm">
            <div class="min-w-0 flex-1">
              <div class="truncate font-medium">
                <template v-if="v.reason === 'manual'"><Icon name="lucide:bookmark" class="align-[-2px] text-amber-600" /> {{ v.label }}</template>
                <template v-else>{{ REASON[v.reason] }}</template>
                <span v-if="g === groups[0] && i === 0" class="ml-1 rounded-full border border-green-600 px-1.5 text-xs font-normal text-green-700">güncel</span>
              </div>
              <div class="truncate text-xs text-slate-500">{{ when(v) }} · {{ v.reason === 'baseline' ? 'geçmiş tutulmadan önceki hâl' : who(v) }}</div>
            </div>
            <button v-if="canEdit && !(g === groups[0] && i === 0)" class="btn shrink-0 px-2 text-xs" :disabled="!!busy" :aria-label="`${when(v)} sürümüne geri dön`" @click="doRestore(v)">
              <Icon :name="busy === v.id ? 'lucide:loader-circle' : 'lucide:undo-2'" :class="busy === v.id && 'animate-spin'" />Geri dön
            </button>
          </li>
        </ul>
      </li>
    </ol>
  </section>
</template>

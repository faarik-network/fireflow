<script setup lang="ts">
import type { RealtimeChannel } from '@supabase/supabase-js'

definePageMeta({ middleware: 'auth' })
const client = useSupabaseClient()
const user = useSupabaseUser()
const co = useCompany()

interface Row { id: string; title: string; description: string | null; updated_at: string; user_id: string; company_id: string | null; owner: { full_name: string | null; email: string } | null }
const projects = ref<Row[]>([])
const loading = ref(true), error = ref(''), joined = ref(false)
const title = ref(''), description = ref('')
const filter = ref<'all' | 'mine' | 'company'>('all')
/** project_id → şu an düzenleyen kişi (yalnızca aktif kilitler görünür) */
const editing = ref<Record<string, string>>({})

async function refresh() {
  loading.value = true
  const { data, error: err } = await client.from('projects')
    .select('id,title,description,updated_at,user_id,company_id,owner:profiles!user_id(full_name,email)')
    .order('updated_at', { ascending: false })
  if (err) error.value = err.message
  projects.value = (data ?? []) as unknown as Row[]
  await loadLocks()
  loading.value = false
}

const holderName = (h: { full_name: string | null; email: string } | null) => h?.full_name || h?.email
let expiryTimer: ReturnType<typeof setTimeout> | undefined
let locksTimer: ReturnType<typeof setTimeout> | undefined
let channel: RealtimeChannel | undefined
async function loadLocks() {
  const { data: locks } = await client.from('project_locks').select('project_id, user_id, expires_at, holder:profiles!user_id(full_name,email)')
  const others = (locks ?? []).filter((l) => l.user_id !== user.value?.id)
  editing.value = Object.fromEntries(others.map((l) => [l.project_id, holderName(l.holder) || 'Başka bir kullanıcı']))
  // Süresi dolan kilit olay üretmez: en erken dolacak olanın ardından yeniden bak (saat farkına 1 sn pay)
  clearTimeout(expiryTimer)
  const next = Math.min(...others.map((l) => new Date(l.expires_at).getTime()))
  if (Number.isFinite(next)) expiryTimer = setTimeout(loadLocks, Math.max(0, next - Date.now()) + 1000)
}
/** Kilit olayları art arda gelebilir (yenileme, devralma): tek sorguda topla */
function scheduleLocks() { clearTimeout(locksTimer); locksTimer = setTimeout(loadLocks, 300) }

onMounted(async () => {
  joined.value = await co.acceptInvites() // bekleyen davet varsa firmaya katıl
  if (!co.loaded.value) await co.refresh()
  await refresh()
  // Canlı "X düzenliyor" rozetleri; INSERT/UPDATE RLS ile süzülür, DELETE yalnızca PK taşır
  channel = client.channel('dashboard:locks')
    .on('postgres_changes', { schema: 'public', table: 'project_locks', event: '*' }, scheduleLocks)
    .subscribe((s) => { if (s === 'SUBSCRIBED') scheduleLocks() })
})
onBeforeUnmount(() => {
  clearTimeout(expiryTimer); clearTimeout(locksTimer)
  if (channel) client.removeChannel(channel)
})

const mine = (p: Row) => p.user_id === user.value?.id
const sameCompany = (p: Row) => !!p.company_id && p.company_id === co.company.value?.id
/** Düzenleme/yeniden adlandırma: sahibi veya aynı firmanın her üyesi (firma projelerinde kilitle) */
const canEdit = (p: Row) => mine(p) || sameCompany(p)
/** Silme: sahibi veya OWNER/ADMIN */
const canDelete = (p: Row) => mine(p) || (sameCompany(p) && co.isAdmin.value)
const shown = computed(() => projects.value.filter((p) => filter.value === 'all' || (filter.value === 'mine' ? mine(p) : !mine(p))))
const ownerName = (p: Row) => (mine(p) ? 'Siz' : p.owner?.full_name || p.owner?.email || 'Eski üye')

async function create() {
  if (!title.value.trim() || !user.value) return
  const { data, error: err } = await client.from('projects')
    .insert({ title: title.value.trim(), description: description.value.trim() || null, user_id: user.value.id })
    .select('id').single()
  if (err) { error.value = err.message; return }
  navigateTo(`/project/${data.id}`)
}
async function rename(p: Row) {
  const t = prompt('Yeni proje adı', p.title)
  if (!t?.trim()) return
  const { error: err } = await client.rpc('rename_project', { p_project: p.id, p_title: t.trim() })
  if (err) { alert(err.message); return }
  refresh()
}
async function remove(p: Row) {
  if (!confirm(`“${p.title}” silinsin mi? Bu işlem geri alınamaz.`)) return
  const { error: err } = await client.from('projects').delete().eq('id', p.id)
  if (err) { alert(err.message); return }
  refresh()
}
async function logout() { await client.auth.signOut(); navigateTo('/login') }
const fmt = (d: string) => new Date(d).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })
</script>

<template>
  <main class="mx-auto max-w-4xl px-4 py-8">
    <header class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 class="brand text-3xl">Proje<b>lerim</b></h1>
      <div class="flex items-center gap-3 text-sm text-slate-600">
        <NuxtLink to="/company" class="btn"><Icon name="lucide:building-2" />{{ co.company.value?.name ?? 'Firma' }}</NuxtLink>
        <span class="hidden sm:inline">{{ user?.email }}</span><ThemeToggle /><button class="btn" @click="logout">Çıkış yap</button>
      </div>
    </header>

    <p v-if="joined" class="mb-4 rounded border border-green-600 px-3 py-2 text-sm text-green-700" role="status">
      <b>{{ co.company.value?.name }}</b> firmasına katıldınız. Firma projeleri aşağıda listelenir.
    </p>
    <p v-if="co.loaded.value && !co.company.value" class="mb-4 rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600">
      Bir firmaya bağlı değilsiniz; projeleriniz yalnızca size görünür. <NuxtLink to="/company" class="underline">Firma oluşturun veya daveti kontrol edin</NuxtLink>.
    </p>

    <form class="mb-6 grid gap-2 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-[1fr_1fr_auto]" @submit.prevent="create">
      <input class="input" v-model="title" placeholder="Proje adı" required aria-label="Proje adı" />
      <input class="input" v-model="description" placeholder="Açıklama (isteğe bağlı)" aria-label="Açıklama" />
      <button class="btn btn-primary justify-center">Proje oluştur</button>
    </form>

    <div v-if="co.company.value" class="mb-3 flex gap-1" role="group" aria-label="Proje filtresi">
      <button class="btn" :class="filter === 'all' && 'btn-active'" @click="filter = 'all'">Tümü</button>
      <button class="btn" :class="filter === 'mine' && 'btn-active'" @click="filter = 'mine'">Benim</button>
      <button class="btn" :class="filter === 'company' && 'btn-active'" @click="filter = 'company'">Firma arkadaşlarım</button>
    </div>

    <p v-if="error" class="mb-4 text-sm text-red-600" role="alert">{{ error }}</p>
    <p v-if="loading" class="text-slate-500">Yükleniyor…</p>
    <p v-else-if="!shown.length" class="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500">
      Burada gösterilecek proje yok.
    </p>
    <ul v-else class="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
      <li v-for="p in shown" :key="p.id" class="flex flex-wrap items-center justify-between gap-3 p-4">
        <NuxtLink :to="`/project/${p.id}`" class="min-w-0 flex-1">
          <div class="truncate font-medium">{{ p.title }}
            <span v-if="p.company_id" class="ml-2 rounded-full border border-slate-300 px-2 py-0.5 text-xs font-normal text-slate-500">Firma</span>
            <span v-if="editing[p.id]" class="ml-1 rounded-full border border-amber-500 px-2 py-0.5 text-xs font-normal text-amber-700"><Icon name="lucide:lock" class="align-[-2px]" /> {{ editing[p.id] }} düzenliyor</span>
            <span v-else-if="!canEdit(p)" class="ml-1 rounded-full border border-slate-300 px-2 py-0.5 text-xs font-normal text-slate-500">Salt okunur</span>
          </div>
          <div class="truncate text-sm text-slate-500">{{ p.description || 'Açıklama yok' }} · {{ ownerName(p) }} · {{ fmt(p.updated_at) }}</div>
        </NuxtLink>
        <button v-if="canEdit(p)" class="btn" :disabled="!!editing[p.id]" @click="rename(p)">Yeniden adlandır</button>
        <NuxtLink :to="`/project/${p.id}`" class="btn">Aç</NuxtLink>
        <button v-if="canDelete(p)" class="btn" @click="remove(p)">Sil</button>
      </li>
    </ul>
  </main>
</template>

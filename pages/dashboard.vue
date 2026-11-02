<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
const client = useSupabaseClient<any>()
const user = useSupabaseUser()
const co = useCompany()

interface Row { id: string; title: string; description: string | null; updated_at: string; user_id: string; company_id: string | null; owner: { full_name: string | null; email: string } | null }
const projects = ref<Row[]>([])
const loading = ref(true), error = ref(''), joined = ref(false)
const title = ref(''), description = ref('')
const filter = ref<'all' | 'mine' | 'company'>('all')

async function refresh() {
  loading.value = true
  const { data, error: err } = await client.from('projects')
    .select('id,title,description,updated_at,user_id,company_id,owner:profiles!user_id(full_name,email)')
    .order('updated_at', { ascending: false })
  if (err) error.value = err.message
  projects.value = (data ?? []) as unknown as Row[]
  loading.value = false
}
onMounted(async () => {
  joined.value = await co.acceptInvites() // bekleyen davet varsa firmaya katıl
  if (!co.loaded.value) await co.refresh()
  await refresh()
})

const mine = (p: Row) => p.user_id === user.value?.id
const canEdit = (p: Row) => mine(p) || (!!p.company_id && p.company_id === co.company.value?.id && co.isAdmin.value)
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
  await client.from('projects').update({ title: t.trim(), updated_at: new Date().toISOString() }).eq('id', p.id)
  refresh()
}
async function remove(p: Row) {
  if (!confirm(`“${p.title}” silinsin mi? Bu işlem geri alınamaz.`)) return
  await client.from('projects').delete().eq('id', p.id)
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
            <span v-if="!canEdit(p)" class="ml-1 rounded-full border border-slate-300 px-2 py-0.5 text-xs font-normal text-slate-500">Salt okunur</span>
          </div>
          <div class="truncate text-sm text-slate-500">{{ p.description || 'Açıklama yok' }} · {{ ownerName(p) }} · {{ fmt(p.updated_at) }}</div>
        </NuxtLink>
        <button v-if="canEdit(p)" class="btn" @click="rename(p)">Yeniden adlandır</button>
        <NuxtLink :to="`/project/${p.id}`" class="btn">Aç</NuxtLink>
        <button v-if="canEdit(p)" class="btn" @click="remove(p)">Sil</button>
      </li>
    </ul>
  </main>
</template>

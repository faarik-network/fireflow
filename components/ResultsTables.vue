<script setup lang="ts">
const sim = useSimulator()
const tab = ref<'pipes' | 'nodes'>('pipes')
const typeName: Record<string, string> = { source: 'Su kaynağı', joint: 'Bağlantı', sprinkler: 'Sprinkler', hydrant: 'Hidrant' }
const pill: Record<string, string> = { ok: 'bg-green-100 text-green-800', warn: 'bg-amber-100 text-amber-800', danger: 'bg-red-100 text-red-800' }
const sh = (id: string) => id.slice(0, 4)
const pipeRows = computed(() => sim.pipes.map((p) => ({ p, r: sim.result.pipes[p.id] })).filter((x) => x.r))
const nodeRows = computed(() => sim.nodes.map((n) => ({ n, r: sim.result.nodes[n.id] })).filter((x) => x.r))
const pick = (kind: 'node' | 'pipe', id: string) => (sim.selected = { kind, id })
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex gap-1 border-b border-slate-200 px-2 pt-2">
      <button class="btn" :class="tab === 'pipes' && 'btn-active'" @click="tab = 'pipes'">Borular ({{ pipeRows.length }})</button>
      <button class="btn" :class="tab === 'nodes' && 'btn-active'" @click="tab = 'nodes'">Düğümler ({{ nodeRows.length }})</button>
    </div>
    <div class="min-h-0 flex-1 overflow-auto">
      <table v-if="tab === 'pipes'" class="w-full text-left text-sm">
        <thead class="sticky top-0 bg-slate-100 text-xs text-slate-600">
          <tr><th class="px-2 py-1">Boru</th><th>DN</th><th>C</th><th>L (m)</th><th>Q (L/dk)</th><th>v (m/s)</th><th>Δp (bar)</th></tr>
        </thead>
        <tbody>
          <tr v-for="{ p, r } in pipeRows" :key="p.id" class="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
              :class="sim.selected?.id === p.id && 'bg-blue-50'" @click="pick('pipe', p.id)">
            <td class="px-2 py-1 font-mono text-xs font-semibold">{{ p.name ?? sh(p.id) }}</td>
            <template v-if="r.kind === 'pump'">
              <td colspan="3" class="font-medium text-blue-700">Pompa</td><td>{{ r.flow.toFixed(0) }}</td><td>—</td>
              <td class="font-medium text-blue-700">+{{ (-r.lossBar).toFixed(2) }}</td>
            </template>
            <template v-else>
              <td>{{ p.dn }}</td><td>{{ p.c }}</td><td>{{ r.length.toFixed(1) }}</td><td>{{ Math.abs(r.flow).toFixed(0) }}</td>
              <td><span class="rounded px-1.5 py-0.5 text-xs font-medium" :class="pill[r.status]">{{ r.velocity.toFixed(2) }}</span></td>
              <td>−{{ r.lossBar.toFixed(3) }}</td>
            </template>
          </tr>
          <tr v-if="!pipeRows.length"><td colspan="7" class="px-2 py-6 text-center text-slate-500">Henüz boru yok. Araç çubuğundan “Boru çiz” seçin.</td></tr>
        </tbody>
      </table>
      <table v-else class="w-full text-left text-sm">
        <thead class="sticky top-0 bg-slate-100 text-xs text-slate-600">
          <tr><th class="px-2 py-1">Düğüm</th><th>Tür</th><th>Kot (m)</th><th>Basınç (bar)</th><th>Debi (L/dk)</th></tr>
        </thead>
        <tbody>
          <tr v-for="{ n, r } in nodeRows" :key="n.id" class="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
              :class="sim.selected?.id === n.id && 'bg-blue-50'" @click="pick('node', n.id)">
            <td class="px-2 py-1 font-mono text-xs font-semibold">{{ n.name ?? sh(n.id) }}</td><td>{{ typeName[n.type] }}</td><td>{{ (n.z ?? 0).toFixed(1) }}</td>
            <td :class="n.type === 'sprinkler' && r.reachable && r.pressure < 0.5 && 'font-semibold text-red-600'">{{ r.reachable ? r.pressure.toFixed(2) : '—' }}</td>
            <td>{{ r.flow ? r.flow.toFixed(0) : '—' }}</td>
          </tr>
          <tr v-if="!nodeRows.length"><td colspan="5" class="px-2 py-6 text-center text-slate-500">Henüz düğüm yok. Önce bir su kaynağı ekleyin.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

import type { HNode, HPipe, SolveResult, DesignSettings } from '~/types/hydraulic'
import type { DesignEval } from '~/utils/nfpa'

const nm = (x: { id: string; name?: string }) => x.name ?? x.id.slice(0, 4)
const TYPE: Record<string, string> = { source: 'Su kaynağı', joint: 'Bağlantı', sprinkler: 'Sprinkler', hydrant: 'Hidrant' }
const tr = (v: number, d = 2) => v.toFixed(d).replace('.', ',')
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

function rows(nodes: HNode[], pipes: HPipe[], res: SolveResult) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const pipeRows = pipes.filter((p) => res.pipes[p.id]).map((p) => {
    const r = res.pipes[p.id]
    return {
      name: nm(p), kind: r.kind === 'pump' ? 'Pompa' : 'Boru',
      from: nm(byId.get(p.from) ?? { id: p.from }), to: nm(byId.get(p.to) ?? { id: p.to }),
      dn: r.kind === 'pump' ? '' : `DN${p.dn}`, c: r.kind === 'pump' ? '' : String(p.c),
      len: r.kind === 'pump' ? '' : tr(r.length, 1), q: tr(Math.abs(r.flow), 0),
      v: r.kind === 'pump' ? '' : tr(r.velocity), dp: r.kind === 'pump' ? (r.lossBar <= 0 ? '+' : '-') + tr(Math.abs(r.lossBar), 3) : '-' + tr(r.lossBar, 3),
      status: r.kind === 'pump' ? '' : r.status === 'danger' ? '> 6 m/s' : r.status === 'warn' ? '4–6 m/s' : 'Uygun'
    }
  })
  const nodeRows = nodes.filter((n) => res.nodes[n.id]).map((n) => {
    const r = res.nodes[n.id]
    return {
      name: nm(n), type: TYPE[n.type], z: tr(n.z ?? 0, 1),
      p: r.reachable ? tr(r.pressure) : '—', q: r.flow ? tr(r.flow, 0) : '0',
      state: n.type === 'sprinkler' || n.type === 'hydrant' ? (n.open === false ? 'Kapalı' : 'Açık') : ''
    }
  })
  return { pipeRows, nodeRows }
}

export function buildCsv(nodes: HNode[], pipes: HPipe[], res: SolveResult): string {
  const { pipeRows, nodeRows } = rows(nodes, pipes, res)
  const line = (a: string[]) => a.map((x) => (/[;"\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(';')
  return '\ufeff' + [
    line(['BORULAR']),
    line(['Ad', 'Tür', 'Başlangıç', 'Bitiş', 'DN', 'C', 'Boy (m)', 'Debi (L/dk)', 'Hız (m/s)', 'Δp (bar)', 'Durum']),
    ...pipeRows.map((r) => line([r.name, r.kind, r.from, r.to, r.dn, r.c, r.len, r.q, r.v, r.dp, r.status])),
    '',
    line(['DÜĞÜMLER']),
    line(['Ad', 'Tür', 'Kot (m)', 'Basınç (bar)', 'Debi (L/dk)', 'Durum']),
    ...nodeRows.map((r) => line([r.name, r.type, r.z, r.p, r.q, r.state]))
  ].join('\r\n')
}

export function buildReportHtml(title: string, nodes: HNode[], pipes: HPipe[], res: SolveResult, img: string, design: { s: DesignSettings; ev: DesignEval | null } | null = null): string {
  const { pipeRows, nodeRows } = rows(nodes, pipes, res)
  const sp = nodes.filter((n) => n.type === 'sprinkler' && n.open !== false && res.nodes[n.id]?.reachable).map((n) => res.nodes[n.id].pressure)
  const vmax = Math.max(0, ...Object.values(res.pipes).filter((p) => p.kind === 'pipe').map((p) => p.velocity))
  const openCount = nodes.filter((n) => (n.type === 'sprinkler' || n.type === 'hydrant') && n.open !== false).length
  const t = (head: string[], body: string[][]) =>
    `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(title)} – Hidrolik Rapor</title><style>
  @page{size:A4;margin:14mm} body{font:12px/1.45 system-ui,Segoe UI,Roboto,sans-serif;color:#14202B}
  h1{font-size:22px;margin:0 0 2px} h2{font-size:14px;margin:18px 0 6px;border-bottom:1px solid #cbd5e1;padding-bottom:3px}
  .meta{color:#475569;margin-bottom:10px} .kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
  .kpi div{border:1px solid #cbd5e1;border-radius:4px;padding:6px 8px}.kpi b{display:block;font-size:17px}
  table{width:100%;border-collapse:collapse;font-size:11px}th,td{border-bottom:1px solid #e2e8f0;padding:3px 5px;text-align:right}
  th:first-child,td:first-child,th:nth-child(2),td:nth-child(2){text-align:left} th{background:#f1f5f9}
  img{width:100%;border:1px solid #cbd5e1;border-radius:4px} .warn{background:#fff7e6;border:1px solid #f2a33a;padding:6px 10px;border-radius:4px}
  tr{break-inside:avoid} .note{color:#64748b;font-size:10.5px;margin-top:14px}
  </style></head><body>
  <h1>${esc(title)}</h1><div class="meta">Yangın hattı hidrolik hesap raporu · ${new Date().toLocaleString('tr-TR')}</div>
  <div class="kpi">
    <div>Toplam debi<b>${tr(res.totalFlow, 0)} L/dk</b></div><div>Açık çıkış<b>${openCount}</b></div>
    <div>En düşük sprinkler basıncı<b>${sp.length ? tr(Math.min(...sp)) + ' bar' : '—'}</b></div><div>En yüksek hız<b>${tr(vmax)} m/s</b></div>
  </div>
  ${res.warnings.length ? `<h2>Uyarılar</h2><div class="warn">${res.warnings.map((w) => `⚠ ${esc(w)}`).join('<br>')}</div>` : ''}
  ${img ? `<h2>Şema</h2><img src="${img}" alt="Ağ şeması">` : ''}
  ${design?.ev ? `<h2>NFPA 13 tasarım kontrolü</h2>${t(['Kriter', 'Gerekli', 'Sağlanan', 'Sonuç'], [
    ['Tasarım alanı', `≥ ${tr(design.s.area, 0)} m²`, `${tr(design.ev.openArea, 0)} m² (${design.ev.openCount} sprinkler)`, design.ev.areaOk ? 'Uygun' : 'Yetersiz'],
    ['Yoğunluk', `≥ ${tr(design.s.density, 1)} mm/dk`, design.ev.minDensity === null ? '—' : `${tr(design.ev.minDensity)} mm/dk (en düşük)`, design.ev.densityOk ? 'Uygun' : `Yetersiz: ${design.ev.failing.join(', ')}`],
    ['Toplam talep', `hortum payı ${tr(design.s.hose, 0)} L/dk`, `${tr(design.ev.totalDemand, 0)} L/dk`, '']
  ])}` : ''}
  <h2>Borular ve pompalar</h2>
  ${t(['Ad', 'Tür', 'Baş.', 'Bit.', 'DN', 'C', 'Boy (m)', 'Debi (L/dk)', 'Hız (m/s)', 'Δp (bar)', 'Durum'], pipeRows.map((r) => [r.name, r.kind, r.from, r.to, r.dn, r.c, r.len, r.q, r.v, r.dp, r.status]))}
  <h2>Düğümler</h2>
  ${t(['Ad', 'Tür', 'Kot (m)', 'Basınç (bar)', 'Debi (L/dk)', 'Durum'], nodeRows.map((r) => [r.name, r.type, r.z, r.p, r.q, r.state]))}
  <p class="note">Hazen-Williams, Sch40 iç çaplar, 2D plan + kot. Sonuçlar ön tasarım içindir; nihai doğrulama yetkili mühendis tarafından yapılmalıdır.</p>
  </body></html>`
}

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function printHtml(html: string): boolean {
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.open(); w.document.write(html); w.document.close()
  w.addEventListener('load', () => setTimeout(() => w.print(), 250))
  setTimeout(() => { try { w.print() } catch { /* yüklendi sayılır */ } }, 900)
  return true
}

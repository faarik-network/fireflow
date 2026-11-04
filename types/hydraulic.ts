export type NodeType = 'source' | 'joint' | 'sprinkler' | 'hydrant'
export type Tool = 'select' | 'pipe' | 'pump' | 'source' | 'joint' | 'sprinkler' | 'hydrant' | 'delete'
export type DN = 15 | 20 | 25 | 32 | 40 | 50 | 65 | 80 | 100 | 150
export type CFactor = 100 | 120 | 140

export interface HNode {
  id: string
  name?: string
  type: NodeType
  x: number // px (canvas world)
  y: number
  area?: number // m² – bu sprinklerin koruma alanı (boşsa projedeki varsayılan)
  open?: boolean // sprinkler/hidrant açık mı (varsayılan true)
  z?: number // m – kot (yükseklik), varsayılan 0
  pressure?: number // bar – kaynak statik basıncı (supply yoksa sabit basınç)
  /** Şebeke testi: Q=flow'da artık basınç=residual → P(Q) = Ps − (Ps−Pr)·(Q/flow)^1.85 */
  supply?: { flow: number; residual: number }
  k?: number // L/min/√bar – sprinkler K-factor
  demand?: number // L/min – hydrant fixed flow
}

export interface HPipe {
  id: string
  name?: string
  from: string
  to: string
  dn: DN
  c: CFactor
  kind?: 'pipe' | 'pump' // varsayılan 'pipe'
  fixedR?: number // yalnızca çözücü içi: sabit direnç (şebeke eğrisi bağlantısı)
  /** Pompa eğrisi: H(Q) = h0 − r·Q² ; r, (qd,hd) tasarım noktasından türetilir */
  pump?: PumpCurve
}

export interface PumpCurve {
  q2?: number // L/dk – isteğe bağlı 3. nokta (aşırı yük, tipik %150 debi)
  h2?: number // bar – 3. noktadaki basınç
  h0: number // bar – kapalı vana (churn) basıncı
  qd: number // L/dk – tasarım debisi
  hd: number // bar – tasarım basıncı
}

export interface NodeResult {
  pressure: number // bar
  flow: number // L/min leaving the system at this node (demand), source: supplied
  reachable: boolean
}

export type VelocityStatus = 'ok' | 'warn' | 'danger'

export interface PipeResult {
  kind: 'pipe' | 'pump'
  flow: number // L/min (signed, from → to)
  velocity: number // m/s
  lossBar: number
  length: number // m
  innerD: number // mm
  status: VelocityStatus
}

export interface SolveResult {
  converged: boolean
  iterations: number
  totalFlow: number // L/min
  nodes: Record<string, NodeResult>
  pipes: Record<string, PipeResult>
  warnings: string[]
}

export interface GridData {
  version: 1
  nodes: HNode[]
  pipes: HPipe[]
  view: { zoom: number; panX: number; panY: number }
  design?: DesignSettings
  background?: PlanBackground
}

/** Arka plan planı: dosya Storage'da ('project-plans'), burada yalnızca yolu ve yerleşimi */
export interface PlanBackground {
  path: string // bucket içindeki yol: <project_id>/<uuid>.<uzantı>
  name: string // özgün dosya adı (PDF ise sayfa no ile)
  w: number // görsel genişliği (px)
  h: number // görsel yüksekliği (px)
  x: number // sol üst köşe, dünya birimi
  y: number
  scale: number // dünya birimi / piksel (GRID = 1 m)
  opacity: number // 0–1
  locked: boolean
  hidden?: boolean
  calibrated?: boolean // ölçek iki noktayla ayarlandı mı
}

export type HazardClass = 'off' | 'light' | 'oh1' | 'oh2' | 'eh1' | 'eh2' | 'custom'

/** NFPA 13 yoğunluk/alan tasarım kriteri */
export interface DesignSettings {
  hazard: HazardClass
  density: number // mm/dk (= L/dk/m²)
  area: number // m² – tasarım (uzak) alanı
  coverage: number // m² – sprinkler başına varsayılan koruma alanı
  hose: number // L/dk – hortum payı (iç + dış toplam)
}

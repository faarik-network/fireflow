/** Arka plan planı: PDF sayfasını veya görseli yüklemeye hazır tek bir görsele çevirir (tarayıcıda). */

export const PLAN_BUCKET = 'project-plans'
export const PLAN_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp'
const MAX_SIDE = 4096 // canvas ve bellek sınırları için güvenli üst sınır
const MAX_BYTES = 10 * 1024 * 1024 // bucket sınırıyla aynı

export interface RasterPlan { blob: Blob; w: number; h: number; ext: 'webp' | 'png' }

const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)

/** PDF ise sayfa sayısı, değilse 1 */
export async function planPageCount(file: File): Promise<number> {
  if (!isPdf(file)) return 1
  const doc = await openPdf(file)
  const n = doc.numPages
  await doc.destroy()
  return n
}

export async function rasterizePlan(file: File, page = 1): Promise<RasterPlan> {
  const canvas = isPdf(file) ? await renderPdf(file, page) : await renderImage(file)
  return encode(canvas)
}

async function openPdf(file: File) {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
}

async function renderPdf(file: File, pageNo: number) {
  const doc = await openPdf(file)
  try {
    const page = await doc.getPage(pageNo)
    const base = page.getViewport({ scale: 1 })
    // Çizim çizgileri ince: mümkün olan en yüksek çözünürlük (en uzun kenar MAX_SIDE)
    const vp = page.getViewport({ scale: MAX_SIDE / Math.max(base.width, base.height) })
    const c = makeCanvas(vp.width, vp.height)
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, c.width, c.height)
    await page.render({ canvasContext: ctx, viewport: vp }).promise
    return c
  } finally {
    await doc.destroy()
  }
}

async function renderImage(file: File) {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const c = makeCanvas(bmp.width * k, bmp.height * k)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff' // saydam PNG'ler koyu temada da okunur kalsın
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  return c
}

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob | null>((r) => c.toBlob(r, type, q))

/** WebP (tarayıcı desteklemezse PNG); sınırı aşarsa küçülterek yeniden dene */
async function encode(c: HTMLCanvasElement): Promise<RasterPlan> {
  for (let i = 0; i < 4; i++) {
    const webp = await toBlob(c, 'image/webp', 0.9)
    const blob = webp?.type === 'image/webp' ? webp : await toBlob(c, 'image/png')
    if (!blob) throw new Error('Görsel oluşturulamadı')
    if (blob.size <= MAX_BYTES) return { blob, w: c.width, h: c.height, ext: blob.type === 'image/webp' ? 'webp' : 'png' }
    const s = makeCanvas(c.width * 0.7, c.height * 0.7)
    s.getContext('2d')!.drawImage(c, 0, 0, s.width, s.height)
    c = s
  }
  throw new Error('Plan dosyası çok büyük (10 MB sınırı)')
}

// Genera un script para la app Scriptable (iOS) que muestra el total en un widget.
// El widget no puede leer los datos de Safari, así que el script lleva las tenencias embebidas.

const KEEP = ['symbol', 'platform', 'source', 'market', 'ref', 'units', 'per', 'quote', 'currency', 'price', 'fallbackPrice', 'fallbackCur']

// seed: { 'YYYY-MM-DD': totalUSD } de los últimos días, para que 7d/30d funcionen desde el primer día.
export function buildWidgetScript(holdings, settings, appUrl, seed = {}) {
  const slim = holdings.map((h) => Object.fromEntries(KEEP.filter((k) => h[k] != null).map((k) => [k, h[k]])))
  const config = {
    currency: settings.displayCurrency,
    arsRate: settings.arsRate,
    appUrl,
    generated: new Date().toISOString().slice(0, 10),
  }
  return `// Patrimonio · widget para Scriptable
// Generado el ${config.generated}. Si cambiás tus tenencias, volvé a copiarlo desde la app (Ajustes → Widget).
const CONFIG = ${JSON.stringify(config)}
const HOLDINGS = ${JSON.stringify(slim)}
const SEED = ${JSON.stringify(seed)}
${RUNTIME}`
}

// Código que corre dentro de Scriptable (no es parte de la app web).
const RUNTIME = String.raw`
async function getJSON(url) {
  const r = new Request(url)
  r.timeoutInterval = 20
  return await r.loadJSON()
}
function num(v) { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : null }
const today = () => new Date().toISOString().slice(0, 10)

async function compute() {
  const cryptoIds = [...new Set(HOLDINGS.filter((h) => h.source === 'crypto').map((h) => h.ref))]
  const markets = [...new Set(HOLDINGS.filter((h) => h.source === 'ar' || h.source === 'us').map((h) => h.market))]
  const fciCats = [...new Set(HOLDINGS.filter((h) => h.source === 'fci').map((h) => h.market))]
  const fiats = new Set([CONFIG.currency])
  HOLDINGS.forEach((h) => { if (h.currency) fiats.add(h.currency) })
  const needFiat = [...fiats].some((c) => c !== 'USD' && c !== 'ARS')

  const settle = (p) => p.then((v) => v, () => null)
  const [dolar, crypto, fiat, ...rest] = await Promise.all([
    settle(getJSON('https://dolarapi.com/v1/dolares')),
    cryptoIds.length ? settle(getJSON('https://api.coingecko.com/api/v3/simple/price?ids=' + cryptoIds.join(',') + '&vs_currencies=usd&include_24hr_change=true')) : null,
    needFiat ? settle(getJSON('https://api.coingecko.com/api/v3/exchange_rates')) : null,
    ...markets.map((m) => settle(getJSON('https://data912.com/live/' + m))),
    ...fciCats.map((c) => settle(getJSON('https://api.argentinadatos.com/v1/finanzas/fci/' + c + '/ultimo'))),
  ])

  const ars = {}
  ;(dolar || []).forEach((d) => { ars[d.casa] = num(d.venta) })
  const arsPerUsd = ars[CONFIG.arsRate] || ars.bolsa
  if (!arsPerUsd) throw new Error('sin dólar')
  const rates = { USD: 1, ARS: 1 / arsPerUsd }
  if (fiat && fiat.rates) {
    const usdPerBtc = fiat.rates.usd.value
    Object.entries(fiat.rates).forEach(([k, v]) => { if (v.type === 'fiat' && k !== 'usd' && k !== 'ars') rates[k.toUpperCase()] = usdPerBtc / v.value })
  }
  const mk = {}
  markets.forEach((m, i) => { mk[m] = new Map((rest[i] || []).map((r) => [r.symbol, { p: num(r.c) ?? num(r.px_ask) ?? num(r.px_bid), ch: num(r.pct_change) }])) })
  const fc = {}
  fciCats.forEach((c, i) => { fc[c] = new Map((rest[markets.length + i] || []).map((r) => [r.fondo, num(r.vcp)])) })

  let total = 0
  let prev = 0
  let missing = 0
  const byPlatform = {}
  const movers = []
  for (const h of HOLDINGS) {
    let price = null
    let cur = 'USD'
    let ch = null
    if (h.source === 'crypto') {
      const c = crypto && crypto[h.ref]
      if (c) { price = c.usd; ch = num(c.usd_24h_change) }
    } else if (h.source === 'ar' || h.source === 'us') {
      const q = mk[h.market] && mk[h.market].get(h.ref)
      if (q && q.p != null) { price = q.p / (h.per || 1); cur = h.source === 'us' ? 'USD' : h.quote || 'ARS'; ch = q.ch }
      else if (h.fallbackPrice != null) { price = h.fallbackPrice / (h.per || 1); cur = h.fallbackCur || 'ARS' }
    } else if (h.source === 'fci') {
      const p = fc[h.market] && fc[h.market].get(h.ref)
      if (p != null) { price = p / (h.per || 1); cur = h.quote || 'ARS' }
    } else if (h.source === 'cash') { price = 1; cur = h.currency }
    else if (h.source === 'manual') { price = h.price || 0; cur = h.currency }
    if (price == null || rates[cur] == null) { missing++; continue }
    const usd = price * (h.units || 0) * rates[cur]
    const before = ch != null ? usd / (1 + ch / 100) : usd
    total += usd
    prev += before
    const k = h.platform || 'Otros'
    byPlatform[k] = (byPlatform[k] || 0) + usd
    if (ch != null) movers.push({ s: h.symbol || h.ref, ch, d: usd - before })
  }
  movers.sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
  return { usd: total, prevUsd: prev, rates, arsPerUsd, missing, byPlatform, top: movers[0] || null }
}

// ---------- formato ----------
const disp = CONFIG.currency
const second = disp === 'USD' ? 'ARS' : 'USD'
function sym(cur) { return cur === 'USD' ? 'US$' : cur === 'ARS' ? '$' : cur }
function fmt(v, cur, compact) {
  const a = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (a >= 1e9) return sign + sym(cur) + ' ' + (a / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 0 }) + ' M'
  if (a >= 1e6 && (compact || a >= 1e8)) return sign + sym(cur) + ' ' + (a / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + ' M'
  if (a >= 1e4 && compact) return sign + sym(cur) + ' ' + (a / 1e3).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + ' k'
  return sign + sym(cur) + ' ' + a.toLocaleString('es-AR', { maximumFractionDigits: a < 100 ? 2 : 0 })
}
function pctTxt(p) { return (p >= 0 ? '+' : '−') + Math.abs(p).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%' }
const conv = (usd, rates, cur) => (rates[cur] ? usd / rates[cur] : usd)

// ---------- datos + historial local ----------
const fm = FileManager.local()
const cachePath = fm.joinPath(fm.documentsDirectory(), 'patrimonio-widget.json')
let saved = {}
try { if (fm.fileExists(cachePath)) saved = JSON.parse(fm.readString(cachePath)) } catch (e) {}
const snaps = Object.assign({}, SEED, saved.snaps || {})

let data = null
let stale = false
try {
  data = await compute()
  data.at = Date.now()
  snaps[today()] = data.usd
} catch (e) {
  if (saved.data) { data = saved.data; stale = true }
}
// guardar ~400 días
const keys = Object.keys(snaps).sort().slice(-400)
const trimmed = {}
keys.forEach((k) => { trimmed[k] = snaps[k] })
try { fm.writeString(cachePath, JSON.stringify({ data, snaps: trimmed })) } catch (e) {}

function changeSince(days) {
  if (!data) return null
  const target = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  const past = keys.filter((k) => k <= target)
  if (!past.length) return null
  const base = trimmed[past[past.length - 1]]
  if (!base) return null
  return { d: data.usd - base, p: ((data.usd - base) / base) * 100 }
}

// ---------- widget ----------
const C = {
  muted: new Color('#8b96a8'), text: Color.white(), up: new Color('#34d399'), down: new Color('#f87171'), warn: new Color('#fbbf24'),
}
const w = new ListWidget()
const bg = new LinearGradient()
bg.colors = [new Color('#16243a'), new Color('#0b0f17')]
bg.locations = [0, 1]
w.backgroundGradient = bg
w.url = CONFIG.appUrl
w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000)

function txt(stack, s, font, color) {
  const t = stack.addText(s)
  t.font = font
  t.textColor = color || C.text
  t.lineLimit = 1
  t.minimumScaleFactor = 0.6
  return t
}
const time = data ? new Date(data.at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''
const footText = data ? (stale ? 'Sin conexión · ' : 'Act. ') + time : 'Sin datos'
const day = data ? { d: data.usd - data.prevUsd, p: data.prevUsd ? ((data.usd - data.prevUsd) / data.prevUsd) * 100 : 0 } : null
const family = config.widgetFamily || (args.widgetParameter === 'small' ? 'small' : 'medium')

if (family === 'small' || !data) {
  w.setPadding(14, 14, 14, 14)
  txt(w, 'Patrimonio', Font.semiboldSystemFont(12), C.muted)
  w.addSpacer()
  txt(w, data ? fmt(conv(data.usd, data.rates, disp), disp) : '—', Font.boldRoundedSystemFont(26))
  if (day) txt(w, pctTxt(day.p) + ' hoy', Font.semiboldSystemFont(12), day.d >= 0 ? C.up : C.down)
  w.addSpacer(4)
  txt(w, footText, Font.systemFont(11), stale ? C.warn : C.muted)
} else {
  w.setPadding(14, 16, 14, 16)
  const row = w.addStack()
  row.layoutHorizontally()

  // izquierda: total
  const left = row.addStack()
  left.layoutVertically()
  txt(left, 'Patrimonio', Font.semiboldSystemFont(12), C.muted)
  left.addSpacer()
  txt(left, fmt(conv(data.usd, data.rates, disp), disp), Font.boldRoundedSystemFont(26))
  txt(left, '≈ ' + fmt(conv(data.usd, data.rates, second), second, true), Font.mediumSystemFont(12), C.muted)
  left.addSpacer()
  txt(left, footText, Font.systemFont(10), stale ? C.warn : C.muted)

  row.addSpacer()

  // derecha: KPIs
  const right = row.addStack()
  right.layoutVertically()
  right.size = new Size(128, 0)
  function kpi(label, ch) {
    const r = right.addStack()
    r.layoutHorizontally()
    r.centerAlignContent()
    txt(r, label, Font.mediumSystemFont(11), C.muted)
    r.addSpacer()
    if (!ch) { txt(r, '—', Font.semiboldSystemFont(12), C.muted); right.addSpacer(5); return }
    const col = ch.d >= 0 ? C.up : C.down
    const v = r.addStack()
    v.layoutVertically()
    const a = txt(v, pctTxt(ch.p), Font.semiboldSystemFont(12), col)
    const b = txt(v, (ch.d >= 0 ? '+' : '') + fmt(conv(ch.d, data.rates, disp), disp, true), Font.systemFont(10), col)
    a.rightAlignText(); b.rightAlignText()
    right.addSpacer(5)
  }
  kpi('Hoy', day)
  kpi('7 días', changeSince(7))
  kpi('30 días', changeSince(30))
  const m = right.addStack()
  m.layoutHorizontally()
  txt(m, 'Dólar', Font.mediumSystemFont(11), C.muted)
  m.addSpacer()
  txt(m, '$ ' + Math.round(data.arsPerUsd).toLocaleString('es-AR'), Font.semiboldSystemFont(12))
}

if (config.runsInWidget) Script.setWidget(w)
else if (config.widgetFamily === 'small') await w.presentSmall()
else await w.presentMedium()
Script.complete()
`

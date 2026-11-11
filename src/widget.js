// Genera un script para la app Scriptable (iOS) que muestra el total en un widget.
// El widget no puede leer los datos de Safari, así que el script lleva las tenencias embebidas.

const KEEP = ['source', 'market', 'ref', 'units', 'per', 'quote', 'currency', 'price', 'fallbackPrice', 'fallbackCur']

export function buildWidgetScript(holdings, settings, appUrl) {
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

async function computeTotal() {
  const need = (s) => HOLDINGS.some((h) => h.source === s)
  const cryptoIds = [...new Set(HOLDINGS.filter((h) => h.source === 'crypto').map((h) => h.ref))]
  const markets = [...new Set(HOLDINGS.filter((h) => h.source === 'ar' || h.source === 'us').map((h) => h.market))]
  const fciCats = [...new Set(HOLDINGS.filter((h) => h.source === 'fci').map((h) => h.market))]
  const fiats = new Set([CONFIG.currency])
  HOLDINGS.forEach((h) => { if (h.currency) fiats.add(h.currency) })
  const needFiat = [...fiats].some((c) => c !== 'USD' && c !== 'ARS')

  const settle = (p) => p.then((v) => v, () => null)
  const [dolar, crypto, fiat, ...rest] = await Promise.all([
    settle(getJSON('https://dolarapi.com/v1/dolares')),
    cryptoIds.length ? settle(getJSON('https://api.coingecko.com/api/v3/simple/price?ids=' + cryptoIds.join(',') + '&vs_currencies=usd')) : null,
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
  markets.forEach((m, i) => { mk[m] = new Map((rest[i] || []).map((r) => [r.symbol, num(r.c) ?? num(r.px_ask) ?? num(r.px_bid)])) })
  const fc = {}
  fciCats.forEach((c, i) => { fc[c] = new Map((rest[markets.length + i] || []).map((r) => [r.fondo, num(r.vcp)])) })

  let total = 0
  let missing = 0
  for (const h of HOLDINGS) {
    let price = null
    let cur = 'USD'
    if (h.source === 'crypto') price = crypto && crypto[h.ref] ? crypto[h.ref].usd : null
    else if (h.source === 'ar' || h.source === 'us') {
      const p = mk[h.market] && mk[h.market].get(h.ref)
      if (p != null) { price = p / (h.per || 1); cur = h.source === 'us' ? 'USD' : h.quote || 'ARS' }
      else if (h.fallbackPrice != null) { price = h.fallbackPrice / (h.per || 1); cur = h.fallbackCur || 'ARS' }
    } else if (h.source === 'fci') {
      const p = fc[h.market] && fc[h.market].get(h.ref)
      if (p != null) { price = p / (h.per || 1); cur = h.quote || 'ARS' }
    } else if (h.source === 'cash') { price = 1; cur = h.currency }
    else if (h.source === 'manual') { price = h.price || 0; cur = h.currency }
    if (price == null || rates[cur] == null) { missing++; continue }
    total += price * (h.units || 0) * rates[cur]
  }
  const out = rates[CONFIG.currency] ? total / rates[CONFIG.currency] : total
  return { value: out, currency: rates[CONFIG.currency] ? CONFIG.currency : 'USD', missing }
}

function fmt(v, cur) {
  const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
  const sym = cur === 'USD' ? 'US$' : cur === 'ARS' ? '$' : cur
  const a = Math.abs(v)
  if (a >= 1e9) return sym + ' ' + (v / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 0 }) + ' M'
  if (a >= 1e7) return sym + ' ' + (v / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + ' M'
  return sym + ' ' + nf.format(v)
}

const fm = FileManager.local()
const cachePath = fm.joinPath(fm.documentsDirectory(), 'patrimonio-widget.json')
let data = null
let stale = false
try {
  data = await computeTotal()
  data.at = Date.now()
  fm.writeString(cachePath, JSON.stringify(data))
} catch (e) {
  if (fm.fileExists(cachePath)) { data = JSON.parse(fm.readString(cachePath)); stale = true }
}

const w = new ListWidget()
const bg = new LinearGradient()
bg.colors = [new Color('#16243a'), new Color('#0b0f17')]
bg.locations = [0, 1]
w.backgroundGradient = bg
w.setPadding(14, 14, 14, 14)
w.url = CONFIG.appUrl
w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000)

const title = w.addText('Patrimonio')
title.font = Font.semiboldSystemFont(12)
title.textColor = new Color('#8b96a8')
w.addSpacer()

const big = w.addText(data ? fmt(data.value, data.currency) : '—')
big.font = Font.boldRoundedSystemFont(26)
big.textColor = Color.white()
big.minimumScaleFactor = 0.5
big.lineLimit = 1
w.addSpacer(4)

const time = data ? new Date(data.at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''
const foot = w.addText(data ? (stale ? 'Sin conexión · ' : '') + time : 'Sin datos')
foot.font = Font.systemFont(11)
foot.textColor = new Color(stale ? '#fbbf24' : '#34d399')

if (config.runsInWidget) Script.setWidget(w)
else await w.presentSmall()
Script.complete()
`

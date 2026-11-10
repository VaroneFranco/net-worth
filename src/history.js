// Series históricas de precios para valorizar las tenencias actuales en el pasado.
// Fuentes gratuitas:
//   - data912.com/historical/{cedears|stocks|bonds}/{TICKER}  -> velas diarias de BYMA
//   - CoinGecko /coins/{id}/market_chart                     -> cripto (máx. 365 días en el plan gratis)
//   - argentinadatos.com /v1/cotizaciones/dolares/{casa}       -> dólar MEP, CCL, oficial... histórico

const D912H = 'https://data912.com/historical'
const CG = 'https://api.coingecko.com/api/v3'
const ARGDATOS = 'https://api.argentinadatos.com/v1/cotizaciones/dolares'

const DAY = 86400000
export const isoDay = (d) => new Date(d).toISOString().slice(0, 10)
const todayIso = () => isoDay(Date.now())

const mem = new Map()

function cacheGet(key) {
  if (mem.has(key)) return mem.get(key)
  try {
    const raw = JSON.parse(localStorage.getItem('hist:' + key) || 'null')
    // se invalida una vez por día
    if (raw && raw.day === todayIso()) { mem.set(key, raw.data); return raw.data }
  } catch { /* ignore */ }
  return null
}
function cacheSet(key, data) {
  mem.set(key, data)
  try { localStorage.setItem('hist:' + key, JSON.stringify({ day: todayIso(), data })) } catch { /* lleno */ }
}

async function getJSON(url) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 20000)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally { clearTimeout(t) }
}

// Normaliza respuestas con formas distintas a [[YYYY-MM-DD, precio], ...] ordenado.
function normalize(rows) {
  const out = []
  for (const r of rows || []) {
    if (Array.isArray(r)) { // [timestamp, precio]
      if (r[1] != null) out.push([isoDay(r[0]), +r[1]])
      continue
    }
    const date = r.date || r.fecha || r.d || r.t
    const price = r.c ?? r.close ?? r.venta ?? r.price ?? r.cierre
    if (date && price != null && Number.isFinite(+price)) out.push([String(date).slice(0, 10), +price])
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : 1))
  // un valor por día (el último)
  const dedup = []
  for (const p of out) {
    if (dedup.length && dedup[dedup.length - 1][0] === p[0]) dedup[dedup.length - 1] = p
    else dedup.push(p)
  }
  return dedup
}

const D912_HIST = { arg_cedears: 'cedears', arg_stocks: 'stocks', arg_bonds: 'bonds', arg_corp: 'bonds' }

// Devuelve { points: [[día, precio nativo por unidad de mercado]], cur } o null si no hay historia.
export async function holdingHistory(h, days) {
  if (h.source === 'ar') {
    const kind = D912_HIST[h.market]
    if (!kind) return null
    const key = `ar:${kind}:${h.ref}`
    let pts = cacheGet(key)
    if (!pts) { pts = normalize(await getJSON(`${D912H}/${kind}/${encodeURIComponent(h.ref)}`)); cacheSet(key, pts) }
    return { points: pts, cur: h.quote || 'ARS', per: h.per || 1 }
  }
  if (h.source === 'crypto') {
    const d = days > 365 ? 365 : days <= 30 ? 30 : days <= 90 ? 90 : 365
    const key = `cg:${h.ref}:${d}`
    let pts = cacheGet(key)
    if (!pts) {
      const data = await getJSON(`${CG}/coins/${encodeURIComponent(h.ref)}/market_chart?vs_currency=usd&days=${d}&interval=daily`)
      pts = normalize(data.prices)
      cacheSet(key, pts)
    }
    return { points: pts, cur: 'USD', per: 1 }
  }
  return null // efectivo, manual, FCI y EE.UU.: valor constante
}

export async function dollarHistory(casa) {
  const key = `dolar:${casa}`
  let pts = cacheGet(key)
  if (!pts) { pts = normalize(await getJSON(`${ARGDATOS}/${casa}`)); cacheSet(key, pts) }
  return pts
}

// Lista de días entre from y to (inclusive). Si el rango es largo, salta para no tener miles de puntos.
export function dayRange(from, to) {
  const out = []
  const start = Date.parse(from + 'T00:00:00Z')
  const end = Date.parse(to + 'T00:00:00Z')
  const total = Math.round((end - start) / DAY) + 1
  const step = total > 800 ? Math.ceil(total / 400) : 1
  for (let t = start; t <= end; t += step * DAY) out.push(isoDay(t))
  if (out[out.length - 1] !== to) out.push(to)
  return out
}

// Toma una serie ordenada y devuelve una función día -> último valor conocido a ese día.
// Antes del primer dato devuelve el primer valor (y marca `backfilled`).
export function stepper(points) {
  let i = 0
  return (day) => {
    if (!points.length) return null
    while (i + 1 < points.length && points[i + 1][0] <= day) i++
    if (points[i][0] > day) return points[0][1]
    return points[i][1]
  }
}

async function pool(items, n, fn) {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      try { results[i] = { ok: true, value: await fn(items[i]) } } catch (e) { results[i] = { ok: false, error: e } }
    }
  }))
  return results
}

/**
 * Valoriza las tenencias actuales día por día.
 * quotes/rates: los del último refresco, para valorizar lo que no tiene historia.
 * Devuelve { days, usd: [], ars: [], perHolding: {id: {first, last}} (en USD), missing: [ids], partial: [ids] }
 */
export async function buildHistory(holdings, { from, to, casa, quotes, rates }) {
  const days = dayRange(from, to)
  const spanDays = Math.round((Date.now() - Date.parse(from)) / DAY) + 1
  const [dolarRes, ...hist] = await Promise.all([
    dollarHistory(casa).then((v) => ({ ok: true, value: v }), (e) => ({ ok: false, error: e })),
    pool(holdings, 6, (h) => holdingHistory(h, spanDays)),
  ]).then(([d, rest]) => [d, ...rest])

  const currentArs = rates?.ARS ? 1 / rates.ARS : null
  const dollarPts = dolarRes.ok ? dolarRes.value : []
  const arsAt = stepper(dollarPts)

  const missing = []
  const partial = []
  const series = holdings.map((h, i) => {
    const r = hist[i]
    if (r?.ok && r.value?.points?.length) {
      if (r.value.points[0][0] > from) partial.push(h.id)
      return { h, at: stepper(r.value.points), cur: r.value.cur, per: r.value.per }
    }
    if (r && !r.ok) missing.push(h.id)
    else if (h.source === 'us' || h.source === 'fci') missing.push(h.id)
    return { h, at: null }
  })

  const today = todayIso()
  const usd = []
  const ars = []
  const perHolding = {}
  days.forEach((day, di) => {
    const arsPerUsd = arsAt(day) ?? currentArs
    let total = 0
    for (const s of series) {
      const q = quotes?.[s.h.id]
      let v = null
      if (day === today && q?.usdPrice != null) {
        // hoy: mismo valor que la pantalla principal (precio en vivo)
        v = q.usdPrice * (s.h.units || 0)
      } else if (s.at) {
        const p = s.at(day)
        if (p != null) {
          const native = (p / (s.per || 1)) * (s.h.units || 0)
          v = s.cur === 'USD' ? native : arsPerUsd ? native / arsPerUsd : null
        }
      } else if (q?.nativePrice != null) {
        // sin historia: mismo precio que hoy, pero los pesos se convierten con el dólar de ese día
        const native = q.nativePrice * (s.h.units || 0)
        if (q.nativeCur === 'ARS') v = arsPerUsd ? native / arsPerUsd : null
        else if (q.nativeCur === 'USD') v = native
        else v = q.usdPrice != null ? q.usdPrice * (s.h.units || 0) : null
      }
      if (v != null) {
        total += v
        const ph = (perHolding[s.h.id] ||= { first: null, last: null })
        if (ph.first == null) ph.first = v
        if (di === days.length - 1) ph.last = v
      }
    }
    usd.push(total)
    ars.push(arsPerUsd ? total * arsPerUsd : null)
  })

  return { days, usd, ars, perHolding, missing, partial, dollarError: dolarRes.ok ? null : dolarRes.error?.message }
}

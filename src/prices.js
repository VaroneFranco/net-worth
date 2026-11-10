// Fuentes de cotización. Todo se normaliza a USD para poder sumar.
// Todas son gratuitas y sin clave; se llaman directo desde el teléfono.

const CG = 'https://api.coingecko.com/api/v3'
const D912 = 'https://data912.com/live'
const DOLAR = 'https://dolarapi.com/v1/dolares'
const ARGDATOS = 'https://api.argentinadatos.com/v1/finanzas/fci'

export const SOURCES = {
  crypto: { label: 'Cripto', hint: 'BTC, ETH, USDT… (CoinGecko)' },
  ar: { label: 'Mercado argentino', hint: 'CEDEARs, acciones, bonos y ONs (BYMA)' },
  us: { label: 'EE.UU.', hint: 'Acciones y ETFs (NYSE / NASDAQ)' },
  fci: { label: 'Fondo común (FCI)', hint: 'Money market, renta fija… (CNV)' },
  cash: { label: 'Moneda / efectivo', hint: 'Dólares, pesos, euros, saldo en cuenta' },
  manual: { label: 'Valor manual', hint: 'Inmueble, plazo fijo, lo que no cotiza' },
}

export const AR_MARKETS = {
  arg_cedears: 'CEDEAR',
  arg_stocks: 'Acción AR',
  arg_bonds: 'Bono',
  arg_corp: 'ON',
}
export const US_MARKETS = { usa_stocks: 'Acción EE.UU.', usa_adrs: 'ADR' }

export const FCI_CATEGORIES = {
  mercadoDinero: 'Money market',
  rentaFija: 'Renta fija',
  rentaVariable: 'Renta variable',
  rentaMixta: 'Renta mixta',
  otros: 'Otros',
}

export const ARS_RATES = {
  bolsa: 'Dólar MEP',
  contadoconliqui: 'Dólar CCL',
  oficial: 'Dólar oficial',
  blue: 'Dólar blue',
  cripto: 'Dólar cripto',
  mayorista: 'Mayorista',
}

async function getJSON(url, timeout = 12000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

// ---------- catálogos (para el buscador) ----------

const catalogCache = {}

function num(v) {
  const n = typeof v === 'string' ? parseFloat(v) : v
  return Number.isFinite(n) ? n : null
}

async function d912List(market) {
  if (catalogCache[market]) return catalogCache[market]
  const rows = await getJSON(`${D912}/${market}`)
  const list = rows
    .map((r) => ({
      symbol: r.symbol,
      price: num(r.c) ?? num(r.px_ask) ?? num(r.px_bid),
      change: num(r.pct_change),
    }))
    .filter((r) => r.symbol)
  catalogCache[market] = list
  return list
}

async function fciList(category) {
  const key = `fci_${category}`
  if (catalogCache[key]) return catalogCache[key]
  const rows = await getJSON(`${ARGDATOS}/${category}/ultimo`)
  const list = rows
    .filter((r) => r.fondo && num(r.vcp) != null)
    .map((r) => ({ fondo: r.fondo, vcp: num(r.vcp), fecha: r.fecha }))
  catalogCache[key] = list
  return list
}

export async function searchCrypto(q) {
  if (!q.trim()) return []
  const data = await getJSON(`${CG}/search?query=${encodeURIComponent(q.trim())}`)
  return (data.coins || []).slice(0, 25).map((c) => ({
    id: c.id,
    symbol: (c.symbol || '').toUpperCase(),
    name: c.name,
    thumb: c.thumb,
  }))
}

export async function searchMarket(markets, q) {
  const query = q.trim().toUpperCase()
  const lists = await Promise.allSettled(Object.keys(markets).map(async (m) => {
    const l = await d912List(m)
    return l.map((r) => ({ ...r, market: m }))
  }))
  const all = lists.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
  if (!all.length && lists.some((r) => r.status === 'rejected')) throw lists.find((r) => r.status === 'rejected').reason
  const starts = all.filter((r) => r.symbol.toUpperCase().startsWith(query))
  const contains = all.filter((r) => !r.symbol.toUpperCase().startsWith(query) && r.symbol.toUpperCase().includes(query))
  return [...starts, ...contains].slice(0, 40)
}

export async function searchFci(category, q) {
  const list = await fciList(category)
  const query = q.trim().toLowerCase()
  return list.filter((f) => f.fondo.toLowerCase().includes(query)).slice(0, 40)
}

// ---------- refresco de precios ----------

// Devuelve { rates: { ARS: usdPerUnit, EUR: ..., USD: 1 }, ars: {casa: venta}, quotes: { [holdingId]: {usd, change, error} } }
export async function fetchAll(holdings, settings) {
  const need = (s) => holdings.some((h) => h.source === s)
  const currencies = new Set(['ARS', ...settings.currencies])
  holdings.forEach((h) => {
    if (h.source === 'cash' || h.source === 'manual') currencies.add(h.currency)
  })
  const needFiat = [...currencies].some((c) => c !== 'USD' && c !== 'ARS')

  const cryptoIds = [...new Set(holdings.filter((h) => h.source === 'crypto').map((h) => h.ref))]
  const d912Markets = [...new Set(holdings.filter((h) => h.source === 'ar' || h.source === 'us').map((h) => h.market))]
  const fciCats = [...new Set(holdings.filter((h) => h.source === 'fci').map((h) => h.market))]

  // invalida catálogos para traer precios frescos
  d912Markets.forEach((m) => delete catalogCache[m])
  fciCats.forEach((c) => delete catalogCache[`fci_${c}`])

  const [dolar, crypto, fiat, ...rest] = await Promise.allSettled([
    getJSON(DOLAR),
    cryptoIds.length
      ? getJSON(`${CG}/simple/price?ids=${cryptoIds.join(',')}&vs_currencies=usd&include_24hr_change=true`)
      : Promise.resolve({}),
    needFiat ? getJSON(`${CG}/exchange_rates`) : Promise.resolve(null),
    ...d912Markets.map((m) => d912List(m)),
    ...fciCats.map((c) => fciList(c)),
  ])

  const errors = []
  const ars = {}
  if (dolar.status === 'fulfilled') {
    dolar.value.forEach((d) => { ars[d.casa] = num(d.venta) })
  } else errors.push('Dólar: ' + dolar.reason?.message)

  const arsPerUsd = ars[settings.arsRate] ?? ars.bolsa ?? null
  const rates = { USD: 1 }
  if (arsPerUsd) rates.ARS = 1 / arsPerUsd
  if (fiat.status === 'fulfilled' && fiat.value) {
    const r = fiat.value.rates
    const usdPerBtc = r.usd?.value
    Object.entries(r).forEach(([code, v]) => {
      if (v.type === 'fiat' && code !== 'usd' && code !== 'ars') rates[code.toUpperCase()] = usdPerBtc / v.value
    })
  } else if (fiat.status === 'rejected') errors.push('Monedas: ' + fiat.reason?.message)

  const markets = {}
  d912Markets.forEach((m, i) => {
    const r = rest[i]
    if (r.status === 'fulfilled') markets[m] = new Map(r.value.map((x) => [x.symbol, x]))
    else errors.push(`BYMA (${m}): ` + r.reason?.message)
  })
  const fcis = {}
  fciCats.forEach((c, i) => {
    const r = rest[d912Markets.length + i]
    if (r.status === 'fulfilled') fcis[c] = new Map(r.value.map((x) => [x.fondo, x]))
    else errors.push(`FCI (${c}): ` + r.reason?.message)
  })
  if (crypto.status === 'rejected') errors.push('Cripto: ' + crypto.reason?.message)

  const toUsd = (amount, cur) => (rates[cur] != null ? amount * rates[cur] : null)

  const quotes = {}
  for (const h of holdings) {
    let price = null // precio por unidad en moneda `cur`
    let cur = 'USD'
    let change = null
    let err = null
    switch (h.source) {
      case 'crypto': {
        const p = crypto.status === 'fulfilled' ? crypto.value[h.ref] : null
        if (p?.usd != null) { price = p.usd; change = p.usd_24h_change ?? null }
        else err = 'Sin cotización'
        break
      }
      case 'ar':
      case 'us': {
        const row = markets[h.market]?.get(h.ref)
        if (row?.price != null) {
          price = row.price / (h.per || 1)
          cur = h.source === 'us' ? 'USD' : h.quote || 'ARS'
          change = row.change
        } else err = 'Sin cotización'
        break
      }
      case 'fci': {
        const row = fcis[h.market]?.get(h.ref)
        if (row?.vcp != null) { price = row.vcp / (h.per || 1); cur = h.quote || 'ARS' }
        else err = 'Sin cotización'
        break
      }
      case 'cash':
        price = 1; cur = h.currency
        break
      case 'manual':
        price = h.price ?? 0; cur = h.currency
        break
    }
    const usdPrice = price != null ? toUsd(price, cur) : null
    if (price != null && usdPrice == null) err = `Sin tipo de cambio ${cur}`
    quotes[h.id] = { usdPrice, nativePrice: price, nativeCur: cur, change, error: err }
  }
  return { rates, ars, quotes, errors, at: Date.now() }
}

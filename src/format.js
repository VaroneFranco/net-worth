const cache = {}

export function money(value, currency, { compact = false } = {}) {
  if (value == null || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  const digits = compact ? (abs >= 100 ? 0 : 2) : abs >= 10000 ? 0 : 2
  const key = `${currency}|${digits}`
  if (!cache[key]) {
    try {
      cache[key] = new Intl.NumberFormat('es-AR', {
        style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits,
        currencyDisplay: 'narrowSymbol',
      })
    } catch {
      cache[key] = { format: (v) => `${currency} ${v.toFixed(digits)}` }
    }
  }
  const s = cache[key].format(value)
  // distinguir dólares de pesos (ambos usan "$")
  if (currency === 'USD') return s.replace('$', 'US$')
  return s
}

export function units(n) {
  if (n == null) return '—'
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: n < 1 ? 8 : 4 }).format(n)
}

export function pct(n) {
  if (n == null || !Number.isFinite(n)) return null
  const s = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(Math.abs(n))
  return `${n >= 0 ? '+' : '−'}${s}%`
}

export function ago(ts) {
  if (!ts) return 'nunca'
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 45) return 'recién'
  const m = Math.round(s / 60)
  if (m < 60) return `hace ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `hace ${h} h`
  return new Date(ts).toLocaleDateString('es-AR')
}

export function parseNum(s) {
  if (typeof s === 'number') return s
  if (!s) return null
  // acepta "1.234,56" y "1234.56"
  let t = String(s).trim().replace(/\s/g, '')
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  const n = parseFloat(t)
  return Number.isFinite(n) ? n : null
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './ui.jsx'
import { buildHistory, isoDay } from './history.js'
import { money, pct } from './format.js'

const DAY = 86400000
const PRESETS = [
  { id: '1S', label: '1S', days: 7 },
  { id: '1M', label: '1M', days: 30 },
  { id: '3M', label: '3M', days: 91 },
  { id: '6M', label: '6M', days: 182 },
  { id: 'YTD', label: 'Este año' },
  { id: '1A', label: '1A', days: 365 },
  { id: '2A', label: '2A', days: 730 },
  { id: 'custom', label: 'Personalizado' },
]

function presetRange(id) {
  const to = isoDay(Date.now())
  if (id === 'YTD') return { from: `${to.slice(0, 4)}-01-01`, to }
  const p = PRESETS.find((x) => x.id === id)
  return { from: isoDay(Date.now() - (p.days - 1) * DAY), to }
}

const fmtDate = (d, long) => {
  const dt = new Date(d + 'T12:00:00Z')
  const opts = long === 'month' ? { month: 'short', year: '2-digit' }
    : long ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' }
  return dt.toLocaleDateString('es-AR', opts)
}

export default function HistoryView({ holdings, settings, market, setSettings, onBack }) {
  const [preset, setPreset] = useState(settings.historyPreset || '3M')
  const [custom, setCustom] = useState(() => presetRange('3M'))
  const [filter, setFilter] = useState('all') // 'all' | platform name
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hover, setHover] = useState(null)

  const range = preset === 'custom' ? custom : presetRange(preset)
  const platforms = [...new Set(holdings.map((h) => h.platform))].sort()
  const selected = useMemo(
    () => holdings.filter((h) => filter === 'all' || h.platform === filter),
    [holdings, filter],
  )

  useEffect(() => {
    if (!selected.length || range.from > range.to) { setData(null); return }
    let alive = true
    setLoading(true)
    setError('')
    buildHistory(selected, { ...range, casa: settings.arsRate, quotes: market?.quotes, rates: market?.rates })
      .then((d) => alive && setData(d), (e) => alive && setError(e.message || String(e)))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, range.from, range.to, settings.arsRate])

  const disp = settings.displayCurrency
  const rates = market?.rates || { USD: 1 }
  const values = useMemo(() => {
    if (!data) return []
    if (disp === 'USD') return data.usd
    if (disp === 'ARS') return data.ars
    return data.usd.map((v) => (rates[disp] ? v / rates[disp] : null))
  }, [data, disp, rates])

  const first = values.find((v) => v != null)
  const last = values[values.length - 1]
  const idx = hover ?? values.length - 1
  const shown = values[idx]
  const diff = shown != null && first != null ? shown - first : null
  const diffPct = diff != null && first ? (diff / first) * 100 : null
  const hide = settings.hidden
  const m = (v, opts) => (hide ? '•••••' : money(v, disp, opts))

  const choose = (id) => {
    setPreset(id)
    if (id !== 'custom') setSettings({ historyPreset: id })
  }

  // variación por tenencia en el período
  const rows = useMemo(() => {
    if (!data) return []
    return selected
      .map((h) => {
        const ph = data.perHolding[h.id]
        if (!ph || ph.first == null || ph.last == null) return null
        return { h, first: ph.first, last: ph.last, chg: ph.first ? ((ph.last - ph.first) / ph.first) * 100 : null }
      })
      .filter(Boolean)
      .sort((a, b) => (b.chg ?? 0) - (a.chg ?? 0))
  }, [data, selected])

  const missingNames = data ? selected.filter((h) => data.missing.includes(h.id)).map((h) => h.symbol || h.name) : []
  const partialNames = data ? selected.filter((h) => data.partial.includes(h.id)).map((h) => h.symbol || h.name) : []

  return (
    <div className="app history">
      <header className="top">
        <button className="icon-btn" onClick={onBack} aria-label="Volver"><Icon name="back" /></button>
        <h1 className="top-title">Historial</h1>
        <span className="icon-btn-spacer" />
      </header>

      <div className="chips presets">
        {PRESETS.map((p) => (
          <button key={p.id} className={`chip ${preset === p.id ? 'on' : ''}`} onClick={() => choose(p.id)}>{p.label}</button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="row-2 custom-range">
          <label className="field">
            <span className="field-label">Desde</span>
            <input type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} />
          </label>
          <label className="field">
            <span className="field-label">Hasta</span>
            <input type="date" value={custom.to} min={custom.from} max={isoDay(Date.now())} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} />
          </label>
        </div>
      )}
      {platforms.length > 1 && (
        <div className="chips">
          <button className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>Todas</button>
          {platforms.map((p) => (
            <button key={p} className={`chip ${filter === p ? 'on' : ''}`} onClick={() => setFilter(p)}>{p}</button>
          ))}
        </div>
      )}

      <section className="card chart-card">
        <p className="muted small">{values.length ? fmtDate(data.days[idx], true) : ' '}</p>
        <p className="total">{m(shown)}</p>
        <div className="hero-sub">
          {diffPct != null && !hide && (
            <span className={`pill ${diff >= 0 ? 'up' : 'down'}`}>
              {pct(diffPct)} · {money(diff, disp, { compact: true })}
            </span>
          )}
          {data && <span className="muted small">desde el {fmtDate(range.from, true)}</span>}
        </div>
        <div className="chips ccy">
          {settings.currencies.map((c) => (
            <button key={c} className={`chip ${c === disp ? 'on' : ''}`} onClick={() => setSettings({ displayCurrency: c })}>{c}</button>
          ))}
        </div>

        <div className={`chart-wrap ${loading ? 'loading' : ''}`}>
          {values.length > 1 ? (
            <LineChart values={values} days={data.days} hover={hover} setHover={setHover} hide={hide} disp={disp} up={last >= first} />
          ) : (
            <div className="chart-empty muted small">
              {loading ? 'Cargando precios históricos…' : error ? `No se pudo armar el gráfico (${error}).` : selected.length ? 'Sin datos para este rango.' : 'No hay tenencias.'}
            </div>
          )}
        </div>
        {loading && values.length > 1 && <p className="muted small center">Actualizando…</p>}
      </section>

      {data && (missingNames.length > 0 || partialNames.length > 0 || data.dollarError) && (
        <details className="errors">
          <summary><Icon name="alert" size={14} /> Algunas tenencias no tienen historia completa</summary>
          <ul>
            {missingNames.length > 0 && <li>Sin historia, valuadas con el precio de hoy: {missingNames.join(', ')}.</li>}
            {partialNames.length > 0 && <li>Historia más corta que el rango, se usa el primer precio disponible: {partialNames.join(', ')}.</li>}
            {data.dollarError && <li>No se pudo traer el dólar histórico, se usa el de hoy ({data.dollarError}).</li>}
          </ul>
        </details>
      )}

      <p className="muted small note">
        Muestra cuánto valían tus tenencias actuales en cada fecha. No tiene en cuenta compras ni ventas pasadas.
      </p>

      {rows.length > 0 && (
        <section className="group">
          <div className="group-head"><span>Variación en el período</span></div>
          <ul className="list">
            {rows.map(({ h, last, chg }) => (
              <li key={h.id} className="row static">
                <div className="row-main">
                  <span className="sym">{h.source === 'cash' ? h.name || h.symbol : h.symbol || h.name}</span>
                  <span className="muted small ellipsis">{h.platform}</span>
                </div>
                <div className="row-val">
                  <span className="num">{hide ? '•••••' : money(rates[disp] ? last / rates[disp] : null, disp, { compact: true })}</span>
                  {chg != null && <span className={`small ${chg >= 0 ? 'up-t' : 'down-t'}`}>{pct(chg)}</span>}
                </div>
              </li>
            ))}
          </ul>
          <p className="muted small note">La variación por tenencia está medida en dólares.</p>
        </section>
      )}
    </div>
  )
}

function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1 }
  const span = max - min
  const step0 = span / count
  const mag = Math.pow(10, Math.floor(Math.log10(step0)))
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= step0)
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const ticks = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v)
  return ticks
}

function compactNum(v) {
  const a = Math.abs(v)
  if (a >= 1e9) return (v / 1e9).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + ' MM'
  if (a >= 1e6) return (v / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + ' M'
  if (a >= 1e3) return (v / 1e3).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + ' k'
  return v.toLocaleString('es-AR', { maximumFractionDigits: 0 })
}

function LineChart({ values, days, hover, setHover, hide, disp, up }) {
  const ref = useRef(null)
  const [w, setW] = useState(340)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const H = 220
  const padL = 0
  const padR = 44
  const padT = 10
  const padB = 24
  const vals = values.map((v) => (v == null ? null : v))
  const finite = vals.filter((v) => v != null)
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const ticks = niceTicks(min, max, 3)
  const lo = ticks[0]
  const hi = ticks[ticks.length - 1]
  const x = (i) => padL + (i / (vals.length - 1)) * (w - padL - padR)
  const y = (v) => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB)

  let d = ''
  vals.forEach((v, i) => {
    if (v == null) return
    d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
  })
  const area = d ? `${d}L${x(vals.length - 1).toFixed(1)},${H - padB}L${x(0).toFixed(1)},${H - padB}Z` : ''
  const color = up ? 'var(--up)' : 'var(--down)'

  const pick = (clientX) => {
    const r = ref.current.getBoundingClientRect()
    const px = clientX - r.left
    const i = Math.round(((px - padL) / (w - padL - padR)) * (vals.length - 1))
    setHover(Math.max(0, Math.min(vals.length - 1, i)))
  }

  const xLabels = [0, Math.floor((vals.length - 1) / 2), vals.length - 1]

  return (
    <div ref={ref} className="chart"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); pick(e.clientX) }}
      onPointerMove={(e) => (e.pointerType === 'mouse' || e.buttons) && pick(e.clientX)}
      onPointerUp={(e) => e.pointerType !== 'mouse' && setHover(null)}
      onPointerLeave={() => setHover(null)}
      onPointerCancel={() => setHover(null)}
      role="img" aria-label={`Evolución del patrimonio en ${disp}`}>
      <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`}>
        <defs>
          <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity=".18" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} className="grid" />
            {!hide && <text x={w - padR + 6} y={y(t) + 4} className="axis">{compactNum(t)}</text>}
          </g>
        ))}
        <path d={area} fill="url(#fill)" />
        <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {xLabels.map((i, k) => (
          <text key={k} x={x(i)} y={H - 6} className="axis" textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}>
            {fmtDate(days[i], Date.parse(days[days.length - 1]) - Date.parse(days[0]) > 300 * DAY ? 'month' : false)}
          </text>
        ))}
        {hover != null && vals[hover] != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} className="crosshair" />
            <circle cx={x(hover)} cy={y(vals[hover])} r="5" fill={color} stroke="var(--surface)" strokeWidth="2" />
          </g>
        )}
      </svg>
    </div>
  )
}

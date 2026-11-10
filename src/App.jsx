import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchAll } from './prices.js'
import { load, save, loadQuotes, saveQuotes } from './store.js'
import { money, units as fmtUnits, pct, ago } from './format.js'
import { Icon, PALETTE } from './ui.jsx'
import HoldingSheet from './HoldingSheet.jsx'
import SettingsSheet from './SettingsSheet.jsx'
import ImportSheet from './ImportSheet.jsx'
import HistoryView from './HistoryView.jsx'

export default function App() {
  const [state, setState] = useState(load)
  const [market, setMarket] = useState(loadQuotes) // { rates, ars, quotes, errors, at }
  const [loading, setLoading] = useState(false)
  const [sheet, setSheet] = useState(null)
  const [view, setView] = useState('home')
  const [, tick] = useState(0)
  const { holdings, settings } = state

  useEffect(() => save(state), [state])

  const update = useCallback((fn) => setState((s) => fn(s)), [])
  const setSettings = useCallback((patch) => update((s) => ({ ...s, settings: { ...s.settings, ...patch } })), [update])

  // ---- refresco ----
  const stateRef = useRef(state)
  stateRef.current = state
  const busy = useRef(false)
  const refresh = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    setLoading(true)
    try {
      const { holdings, settings } = stateRef.current
      const res = await fetchAll(holdings, settings)
      setMarket(res)
      saveQuotes(res)
    } catch (e) {
      setMarket((m) => ({ ...(m || {}), errors: [String(e.message || e)] }))
    } finally {
      busy.current = false
      setLoading(false)
    }
  }, [])

  // al abrir y al volver a la app
  useEffect(() => {
    refresh()
    const onVis = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVis)
    const t = setInterval(() => tick((n) => n + 1), 30000)
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(t) }
  }, [refresh])

  // si cambia la cotización del peso elegida o se agregan tenencias nuevas, recalcular
  const holdingsKey = holdings.map((h) => `${h.id}:${h.source}:${h.ref}:${h.market}:${h.currency}:${h.per}:${h.quote}:${h.price}`).join('|')
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    refresh()
  }, [holdingsKey, settings.arsRate, settings.currencies.join(','), refresh])

  // ---- pull to refresh ----
  const [pull, setPullState] = useState(0)
  const pullRef = useRef(0)
  const setPull = (v) => { pullRef.current = v; setPullState(v) }
  const startY = useRef(null)
  useEffect(() => {
    const onStart = (e) => {
      if (sheet || view !== 'home' || window.scrollY > 0) return
      startY.current = e.touches[0].clientY
    }
    const onMove = (e) => {
      if (startY.current == null) return
      const dy = e.touches[0].clientY - startY.current
      if (dy > 0 && window.scrollY <= 0) setPull(Math.min(110, dy * 0.5))
      else setPull(0)
    }
    const onEnd = () => {
      if (startY.current == null) return
      startY.current = null
      if (pullRef.current >= 60) refresh()
      setPull(0)
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd)
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
    }
  }, [refresh, sheet, view])

  // ---- cálculos ----
  const rates = market?.rates || { USD: 1 }
  const disp = settings.displayCurrency
  const toDisp = (usd) => (usd == null || rates[disp] == null ? null : usd / rates[disp])
  const secondary = disp === 'USD' ? 'ARS' : 'USD'
  const toSecondary = (usd) => (usd == null || rates[secondary] == null ? null : usd / rates[secondary])

  const rows = useMemo(() => holdings.map((h) => {
    const q = market?.quotes?.[h.id]
    const usd = q?.usdPrice != null ? q.usdPrice * (h.units || 0) : null
    return { h, q, usd }
  }), [holdings, market])

  const total = rows.reduce((a, r) => a + (r.usd || 0), 0)
  const prevTotal = rows.reduce((a, r) => {
    if (r.usd == null) return a
    const c = r.q?.change
    return a + (c != null ? r.usd / (1 + c / 100) : r.usd)
  }, 0)
  const dayDiff = total - prevTotal
  const dayPct = prevTotal ? (dayDiff / prevTotal) * 100 : null
  const missing = rows.filter((r) => r.usd == null).length

  const groupKey = settings.groupBy === 'type' ? 'type' : 'platform'
  const groups = useMemo(() => {
    const map = new Map()
    rows.forEach((r) => {
      const k = r.h[groupKey] || 'Sin asignar'
      if (!map.has(k)) map.set(k, { name: k, usd: 0, rows: [] })
      const g = map.get(k)
      g.usd += r.usd || 0
      g.rows.push(r)
    })
    const list = [...map.values()].sort((a, b) => b.usd - a.usd)
    list.forEach((g, i) => { g.color = PALETTE[i % PALETTE.length]; g.rows.sort((a, b) => (b.usd || 0) - (a.usd || 0)) })
    return list
  }, [rows, groupKey])

  const hide = settings.hidden
  const m = (v, cur = disp, opts) => (hide ? '•••••' : money(v, cur, opts))

  const saveHolding = (h) => {
    update((s) => {
      const exists = s.holdings.some((x) => x.id === h.id)
      return { ...s, holdings: exists ? s.holdings.map((x) => (x.id === h.id ? h : x)) : [...s.holdings, h] }
    })
    setSheet(null)
  }
  const importPlatform = (platform, imported) => {
    update((s) => ({
      holdings: [...s.holdings.filter((x) => x.platform !== platform), ...imported],
      settings: s.settings.platforms.includes(platform) ? s.settings : { ...s.settings, platforms: [...s.settings.platforms, platform] },
    }))
    setSheet(null)
  }
  const deleteHolding = (id) => {
    update((s) => ({ ...s, holdings: s.holdings.filter((x) => x.id !== id) }))
    setSheet(null)
  }

  const errors = market?.errors || []

  if (view === 'history') {
    return (
      <HistoryView holdings={holdings} settings={settings} market={market} setSettings={setSettings}
        onBack={() => { setView('home'); window.scrollTo(0, 0) }} />
    )
  }

  return (
    <div className="app">
      <div className="ptr" style={{ height: loading && !pull ? 0 : pull, opacity: pull / 60 }}>
        <span className={pull >= 60 ? 'ptr-ready' : ''}><Icon name="refresh" size={18} /></span>
      </div>

      <header className="top">
        <div>
          <h1>Patrimonio</h1>
          <p className="muted small">
            {loading ? 'Actualizando…' : `Actualizado ${ago(market?.at)}`}
          </p>
        </div>
        <div className="top-actions">
          {holdings.length > 0 && (
            <button className="icon-btn" onClick={() => { setView('history'); window.scrollTo(0, 0) }} aria-label="Historial">
              <Icon name="chart" />
            </button>
          )}
          <button className="icon-btn" onClick={() => setSettings({ hidden: !hide })} aria-label={hide ? 'Mostrar montos' : 'Ocultar montos'}>
            <Icon name={hide ? 'eyeOff' : 'eye'} />
          </button>
          <button className={`icon-btn ${loading ? 'spin' : ''}`} onClick={refresh} aria-label="Actualizar">
            <Icon name="refresh" />
          </button>
          <button className="icon-btn" onClick={() => setSheet({ kind: 'settings' })} aria-label="Ajustes">
            <Icon name="settings" />
          </button>
        </div>
      </header>

      <section className="hero">
        <p className="label">Total</p>
        <p className="total">{m(toDisp(total))}</p>
        <div className="hero-sub">
          {rates[secondary] != null && <span className="muted">≈ {m(toSecondary(total), secondary)}</span>}
          {dayPct != null && Math.abs(dayDiff) > 0.005 && !hide && (
            <span className={`pill ${dayDiff >= 0 ? 'up' : 'down'}`}>
              {pct(dayPct)} hoy · {money(toDisp(dayDiff), disp, { compact: true })}
            </span>
          )}
        </div>
        <div className="chips">
          {settings.currencies.map((c) => (
            <button key={c} className={`chip ${c === disp ? 'on' : ''}`} onClick={() => setSettings({ displayCurrency: c })}>{c}</button>
          ))}
        </div>
        {missing > 0 && !loading && (
          <p className="warn small"><Icon name="alert" size={14} /> {missing} {missing === 1 ? 'tenencia' : 'tenencias'} sin cotización, no suman al total</p>
        )}
      </section>

      {errors.length > 0 && !loading && (
        <details className="errors">
          <summary><Icon name="alert" size={14} /> Algunas fuentes no respondieron</summary>
          <ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </details>
      )}

      {holdings.length === 0 ? (
        <section className="empty">
          <h2>Empezá cargando lo que tenés</h2>
          <p className="muted">Elegí el instrumento, poné cuántas unidades tenés y dónde están. La app busca el precio y suma todo.</p>
          <button className="btn primary" onClick={() => setSheet({ kind: 'holding' })}>Agregar tenencia</button>
          <button className="btn" onClick={() => setSheet({ kind: 'import' })}>Importar de Cocos Capital</button>
        </section>
      ) : (
        <>
          <section className="card">
            <div className="seg">
              <button className={groupKey === 'platform' ? 'on' : ''} onClick={() => setSettings({ groupBy: 'platform' })}>Por plataforma</button>
              <button className={groupKey === 'type' ? 'on' : ''} onClick={() => setSettings({ groupBy: 'type' })}>Por tipo</button>
            </div>
            <div className="bar">
              {groups.filter((g) => g.usd > 0).map((g) => (
                <span key={g.name} style={{ width: `${(g.usd / total) * 100}%`, background: g.color }} />
              ))}
            </div>
            <ul className="legend">
              {groups.map((g) => (
                <li key={g.name}>
                  <span className="dot" style={{ background: g.color }} />
                  <span className="grow">{g.name}</span>
                  <span className="muted small">{total ? Math.round((g.usd / total) * 100) : 0}%</span>
                  <span className="num">{m(toDisp(g.usd), disp, { compact: true })}</span>
                </li>
              ))}
            </ul>
          </section>

          {groups.map((g) => (
            <section key={g.name} className="group">
              <div className="group-head">
                <span><span className="dot" style={{ background: g.color }} />{g.name}</span>
                <span className="num">{m(toDisp(g.usd), disp, { compact: true })}</span>
              </div>
              <ul className="list">
                {g.rows.map(({ h, q, usd }) => (
                  <li key={h.id}>
                    <button className="row" onClick={() => setSheet({ kind: 'holding', holding: h })}>
                      <div className="row-main">
                        <span className="sym">{h.source === 'cash' ? h.name || h.symbol : h.symbol || h.name}</span>
                        <span className="muted small ellipsis">
                          {hide ? '•••' : fmtUnits(h.units)}
                          {h.source !== 'cash' && q?.nativePrice != null && !hide && ` × ${money(q.nativePrice * (h.per || 1), q.nativeCur)}${h.per > 1 ? ` c/${h.per}` : ''}`}
                          {groupKey === 'platform' ? ` · ${h.type || ''}` : ` · ${h.platform || ''}`}
                        </span>
                      </div>
                      <div className="row-val">
                        {q?.error ? (
                          <span className="warn small">{q.error}</span>
                        ) : (
                          <>
                            <span className="num">{m(toDisp(usd), disp, { compact: true })}</span>
                            {q?.stale && <span className="small muted">precio del archivo</span>}
                            {!q?.stale && q?.change != null && (
                              <span className={`small ${q.change >= 0 ? 'up-t' : 'down-t'}`}>{pct(q.change)}</span>
                            )}
                          </>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="foot muted small">
            {market?.ars?.[settings.arsRate] && `Pesos convertidos a ${money(market.ars[settings.arsRate], 'ARS')} por dólar. `}
            Deslizá hacia abajo para actualizar.
          </p>
        </>
      )}

      {holdings.length > 0 && (
        <button className="fab" onClick={() => setSheet({ kind: 'holding' })} aria-label="Agregar tenencia">
          <Icon name="plus" size={26} />
        </button>
      )}

      {sheet?.kind === 'holding' && (
        <HoldingSheet
          holding={sheet.holding}
          settings={settings}
          quote={sheet.holding ? market?.quotes?.[sheet.holding.id] : null}
          rates={rates}
          onSave={saveHolding}
          onDelete={deleteHolding}
          onAddOption={(key, value) => setSettings({ [key]: [...settings[key], value] })}
          onOpenImport={() => setSheet({ kind: 'import' })}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'import' && (
        <ImportSheet existing={holdings} onImport={importPlatform} onClose={() => setSheet(null)} />
      )}
      {sheet?.kind === 'settings' && (
        <SettingsSheet
          state={state}
          market={market}
          setSettings={setSettings}
          onOpenImport={() => setSheet({ kind: 'import' })}
          replaceState={(s) => setState(s)}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  )
}


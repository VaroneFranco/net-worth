import { useEffect, useMemo, useState } from 'react'
import { Sheet, Icon } from './ui.jsx'
import {
  SOURCES, AR_MARKETS, US_MARKETS, FCI_CATEGORIES,
  searchCrypto, searchMarket, searchFci,
} from './prices.js'
import { uid, suggestType } from './store.js'
import { money, parseNum, pct } from './format.js'

const COMMON_FIAT = ['USD', 'ARS', 'EUR', 'BRL', 'GBP', 'CHF', 'JPY', 'CLP', 'UYU', 'MXN']

export default function HoldingSheet({ holding, settings, quote, rates, onSave, onDelete, onAddOption, onOpenImport, onClose }) {
  const editing = !!holding
  const [step, setStep] = useState(editing ? 'details' : 'source')
  const [draft, setDraft] = useState(holding || {})
  const [preview, setPreview] = useState(null) // { price, cur } del resultado elegido

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))

  const chooseSource = (source) => {
    const base = { id: uid(), source, units: '', platform: '', per: 1 }
    setDraft(base)
    if (source === 'manual') { setDraft({ ...base, currency: 'USD', type: 'Otros' }); setStep('details') }
    else setStep('pick')
  }

  const pick = (patch, prev) => {
    const d = { ...draft, ...patch }
    if (!d.type) d.type = suggestType(d)
    setDraft(d)
    setPreview(prev || null)
    setStep('details')
  }

  const title = step === 'source' ? 'Nueva tenencia' : step === 'pick' ? SOURCES[draft.source].label : editing ? 'Editar tenencia' : 'Detalles'
  const onBack = step === 'pick' ? () => setStep('source') : step === 'details' && !editing ? () => setStep(draft.source === 'manual' ? 'source' : 'pick') : null

  return (
    <Sheet title={title} onClose={onClose} onBack={onBack}
      footer={step === 'details' && <DetailsFooter draft={draft} editing={editing} onSave={onSave} onDelete={onDelete} />}>
      {step === 'source' && (
        <>
        <ul className="options">
          <li>
            <button className="option" onClick={onOpenImport}>
              <span><strong>Importar de Cocos Capital</strong><span className="muted small">Cargá el reporte de cartera en CSV</span></span>
              <Icon name="chevron" />
            </button>
          </li>
        </ul>
        <p className="field-label" style={{ margin: '18px 4px 8px' }}>O agregá una tenencia a mano</p>
        <ul className="options">
          {Object.entries(SOURCES).map(([k, s]) => (
            <li key={k}>
              <button className="option" onClick={() => chooseSource(k)}>
                <span><strong>{s.label}</strong><span className="muted small">{s.hint}</span></span>
                <Icon name="chevron" />
              </button>
            </li>
          ))}
        </ul>
        </>
      )}
      {step === 'pick' && draft.source === 'crypto' && <CryptoPicker onPick={pick} />}
      {step === 'pick' && (draft.source === 'ar' || draft.source === 'us') && (
        <MarketPicker markets={draft.source === 'ar' ? AR_MARKETS : US_MARKETS} us={draft.source === 'us'} onPick={pick} />
      )}
      {step === 'pick' && draft.source === 'fci' && <FciPicker onPick={pick} />}
      {step === 'pick' && draft.source === 'cash' && (
        <CashPicker currencies={settings.currencies} onPick={(c) => pick({ currency: c, symbol: c, name: `Efectivo ${c}`, type: 'Efectivo' })} />
      )}
      {step === 'details' && (
        <Details draft={draft} set={set} settings={settings} preview={preview} quote={quote} rates={rates} onAddOption={onAddOption} />
      )}
    </Sheet>
  )
}

function useSearch(fn, q, deps = []) {
  const [state, setState] = useState({ loading: false, results: [], error: null })
  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true, error: null }))
    const t = setTimeout(() => {
      fn(q).then(
        (results) => alive && setState({ loading: false, results, error: null }),
        (e) => alive && setState({ loading: false, results: [], error: e.message || String(e) }),
      )
    }, 300)
    return () => { alive = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, ...deps])
  return state
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <label className="search">
      <Icon name="search" size={18} />
      <input autoFocus value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        autoCapitalize="characters" autoCorrect="off" spellCheck="false" />
    </label>
  )
}

function Status({ loading, error, empty }) {
  if (loading) return <p className="muted small center">Buscando…</p>
  if (error) return <p className="warn small center">No se pudo consultar la fuente ({error}).</p>
  if (empty) return <p className="muted small center">Sin resultados.</p>
  return null
}

function CryptoPicker({ onPick }) {
  const [q, setQ] = useState('')
  const { loading, results, error } = useSearch(searchCrypto, q)
  return (
    <>
      <SearchBox value={q} onChange={setQ} placeholder="Bitcoin, ETH, USDT…" />
      <Status loading={loading && q} error={error} empty={q && !loading && !results.length} />
      <ul className="results">
        {results.map((c) => (
          <li key={c.id}>
            <button className="option" onClick={() => onPick({ ref: c.id, symbol: c.symbol, name: c.name, thumb: c.thumb })}>
              <span className="with-thumb">
                {c.thumb && <img src={c.thumb} alt="" width="24" height="24" />}
                <span><strong>{c.symbol}</strong><span className="muted small">{c.name}</span></span>
              </span>
              <Icon name="chevron" />
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

function MarketPicker({ markets, us, onPick }) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const active = filter === 'all' ? markets : { [filter]: markets[filter] }
  const { loading, results, error } = useSearch((x) => (x.trim() ? searchMarket(active, x) : Promise.resolve([])), q, [filter])
  return (
    <>
      <SearchBox value={q} onChange={setQ} placeholder={us ? 'AAPL, SPY, MSFT…' : 'AAPL, GGAL, AL30, GD30D…'} />
      <div className="chips">
        <button className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>Todos</button>
        {Object.entries(markets).map(([k, l]) => (
          <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      <Status loading={loading && q} error={error} empty={q && !loading && !results.length} />
      <ul className="results">
        {results.map((r) => {
          const bond = r.market === 'arg_bonds' || r.market === 'arg_corp'
          const quoteCur = us ? 'USD' : bond && /D$/.test(r.symbol) ? 'USD' : 'ARS'
          return (
            <li key={r.market + r.symbol}>
              <button className="option" onClick={() => onPick(
                { ref: r.symbol, symbol: r.symbol, name: r.symbol, market: r.market, per: bond ? 100 : 1, quote: quoteCur },
                { price: r.price, cur: quoteCur },
              )}>
                <span><strong>{r.symbol}</strong><span className="muted small">{markets[r.market]}</span></span>
                <span className="right">
                  <span className="num">{money(r.price, quoteCur)}</span>
                  {r.change != null && <span className={`small ${r.change >= 0 ? 'up-t' : 'down-t'}`}>{pct(r.change)}</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}

function FciPicker({ onPick }) {
  const [cat, setCat] = useState('mercadoDinero')
  const [q, setQ] = useState('')
  const { loading, results, error } = useSearch((x) => searchFci(cat, x), q, [cat])
  return (
    <>
      <div className="chips">
        {Object.entries(FCI_CATEGORIES).map(([k, l]) => (
          <button key={k} className={`chip ${cat === k ? 'on' : ''}`} onClick={() => setCat(k)}>{l}</button>
        ))}
      </div>
      <SearchBox value={q} onChange={setQ} placeholder="Nombre del fondo…" />
      <Status loading={loading} error={error} empty={!loading && !results.length} />
      <ul className="results">
        {results.map((f) => (
          <li key={f.fondo}>
            <button className="option" onClick={() => onPick(
              { ref: f.fondo, symbol: f.fondo, name: f.fondo, market: cat, per: 1, quote: /d[oó]lar|usd/i.test(f.fondo) ? 'USD' : 'ARS' },
              { price: f.vcp, cur: 'ARS' },
            )}>
              <span><strong className="wrap">{f.fondo}</strong><span className="muted small">Cuotaparte al {f.fecha}</span></span>
              <span className="num">{money(f.vcp, 'ARS')}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

function CashPicker({ currencies, onPick }) {
  const [code, setCode] = useState('')
  const all = [...new Set([...currencies, ...COMMON_FIAT])]
  return (
    <>
      <ul className="options">
        {all.map((c) => (
          <li key={c}><button className="option" onClick={() => onPick(c)}><strong>{c}</strong><Icon name="chevron" /></button></li>
        ))}
      </ul>
      <div className="inline-form">
        <input value={code} maxLength={3} placeholder="Otro código (ej. PEN)" onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <button className="btn" disabled={code.length !== 3} onClick={() => onPick(code)}>Usar</button>
      </div>
    </>
  )
}

function OptionPicker({ label, value, options, onChange, onAdd }) {
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="chips wrap-chips">
        {options.map((o) => (
          <button type="button" key={o} className={`chip ${value === o ? 'on' : ''}`} onClick={() => onChange(o)}>{o}</button>
        ))}
        {value && !options.includes(value) && <button type="button" className="chip on">{value}</button>}
        {!adding && <button type="button" className="chip ghost" onClick={() => setAdding(true)}>+ Nueva</button>}
      </div>
      {adding && (
        <div className="inline-form">
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Nombre" />
          <button type="button" className="btn" disabled={!text.trim()} onClick={() => {
            const v = text.trim(); onAdd(v); onChange(v); setText(''); setAdding(false)
          }}>Agregar</button>
        </div>
      )}
    </div>
  )
}

function Details({ draft, set, settings, preview, quote, rates, onAddOption }) {
  const isCash = draft.source === 'cash'
  const isManual = draft.source === 'manual'
  const hasPer = draft.source === 'ar' || draft.source === 'fci'
  const hasQuote = draft.source === 'ar' || draft.source === 'fci'
  const nUnits = parseNum(draft.units)

  // precio estimado para la vista previa
  const est = useMemo(() => {
    if (isCash) return { price: 1, cur: draft.currency }
    if (isManual) return { price: parseNum(draft.price), cur: draft.currency }
    const raw = preview?.price ?? (quote?.nativePrice != null ? quote.nativePrice * (draft.per || 1) : null)
    if (raw == null) return null
    return { price: raw / (parseNum(draft.per) || 1), cur: hasQuote ? draft.quote || 'ARS' : 'USD' }
  }, [draft, preview, quote, isCash, isManual, hasQuote])

  const value = est?.price != null && nUnits != null ? est.price * nUnits : null
  const usd = value != null && rates[est.cur] != null ? value * rates[est.cur] : null

  return (
    <div className="form">
      {!isCash && (
        <label className="field">
          <span className="field-label">Nombre</span>
          <input value={draft.name || ''} onChange={(e) => set({ name: e.target.value, ...(isManual ? { symbol: e.target.value } : {}) })} placeholder="Ej. Departamento, Plazo fijo" />
        </label>
      )}

      <label className="field">
        <span className="field-label">{isCash ? `Monto en ${draft.currency}` : isManual ? 'Cantidad' : draft.source === 'fci' ? 'Cuotapartes' : draft.per > 1 ? 'Valor nominal' : 'Unidades'}</span>
        <input inputMode="decimal" value={draft.units ?? ''} onChange={(e) => set({ units: e.target.value })} placeholder="0" />
      </label>

      {isManual && (
        <div className="row-2">
          <label className="field">
            <span className="field-label">Valor por unidad</span>
            <input inputMode="decimal" value={draft.price ?? ''} onChange={(e) => set({ price: e.target.value })} placeholder="0" />
          </label>
          <label className="field">
            <span className="field-label">Moneda</span>
            <select value={draft.currency} onChange={(e) => set({ currency: e.target.value })}>
              {[...new Set([...settings.currencies, ...COMMON_FIAT])].map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
        </div>
      )}

      {hasQuote && (
        <div className="row-2">
          <label className="field">
            <span className="field-label">Precio cotiza en</span>
            <select value={draft.quote || 'ARS'} onChange={(e) => set({ quote: e.target.value })}>
              <option>ARS</option><option>USD</option>
            </select>
          </label>
          {hasPer && (
            <label className="field">
              <span className="field-label">Precio cada</span>
              <input inputMode="numeric" value={draft.per ?? 1} onChange={(e) => set({ per: parseNum(e.target.value) || '' })} />
            </label>
          )}
        </div>
      )}
      {hasPer && draft.per > 1 && <p className="muted small">Los bonos cotizan cada 100 de valor nominal. Si tu broker muestra otra cosa, ajustalo acá.</p>}

      <OptionPicker label="Plataforma" value={draft.platform} options={settings.platforms}
        onChange={(v) => set({ platform: v })} onAdd={(v) => onAddOption('platforms', v)} />
      <OptionPicker label="Tipo" value={draft.type} options={settings.types}
        onChange={(v) => set({ type: v })} onAdd={(v) => onAddOption('types', v)} />

      <div className="preview">
        <span className="muted small">Valor estimado</span>
        <strong>{value != null ? money(value, est.cur) : '—'}</strong>
        {usd != null && est.cur !== 'USD' && <span className="muted small">≈ {money(usd, 'USD')}</span>}
      </div>
    </div>
  )
}

function DetailsFooter({ draft, editing, onSave, onDelete }) {
  const n = parseNum(draft.units)
  const valid = n != null && n >= 0 && (draft.source !== 'manual' || (draft.name && parseNum(draft.price) != null))
  const [confirm, setConfirm] = useState(false)
  const save = () => {
    const h = { ...draft, units: n, per: parseNum(draft.per) || 1 }
    if (draft.source === 'manual') { h.price = parseNum(draft.price); h.symbol = draft.name }
    if (!h.platform) h.platform = 'Sin asignar'
    onSave(h)
  }
  return (
    <div className="foot-actions">
      {editing && (
        confirm
          ? <button className="btn danger" onClick={() => onDelete(draft.id)}>Confirmar</button>
          : <button className="btn ghost-danger" onClick={() => setConfirm(true)} aria-label="Eliminar"><Icon name="trash" /></button>
      )}
      <button className="btn primary grow" disabled={!valid} onClick={save}>{editing ? 'Guardar' : 'Agregar'}</button>
    </div>
  )
}

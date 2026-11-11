import { useRef, useState } from 'react'
import { Sheet, Icon } from './ui.jsx'
import { ARS_RATES } from './prices.js'
import { DEFAULT_SETTINGS } from './store.js'
import { money } from './format.js'
import { buildWidgetScript } from './widget.js'

function ListEditor({ label, items, onChange, upper, placeholder, locked = [] }) {
  const [text, setText] = useState('')
  const add = () => {
    const v = upper ? text.trim().toUpperCase() : text.trim()
    if (v && !items.includes(v)) onChange([...items, v])
    setText('')
  }
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="chips wrap-chips">
        {items.map((it) => (
          <span key={it} className="chip removable">
            {it}
            {!locked.includes(it) && (
              <button aria-label={`Quitar ${it}`} onClick={() => onChange(items.filter((x) => x !== it))}><Icon name="close" size={12} /></button>
            )}
          </span>
        ))}
      </div>
      <div className="inline-form">
        <input value={text} maxLength={upper ? 3 : 40} placeholder={placeholder}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn" disabled={!text.trim()} onClick={add}>Agregar</button>
      </div>
    </div>
  )
}

export default function SettingsSheet({ state, market, setSettings, replaceState, onOpenImport, onClose }) {
  const { settings } = state
  const fileRef = useRef(null)
  const [msg, setMsg] = useState('')

  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `patrimonio-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const importData = async (file) => {
    try {
      const data = JSON.parse(await file.text())
      if (!Array.isArray(data.holdings)) throw new Error('Archivo inválido')
      replaceState({ holdings: data.holdings, settings: { ...DEFAULT_SETTINGS, ...data.settings } })
      setMsg(`Importadas ${data.holdings.length} tenencias.`)
    } catch (e) {
      setMsg('No se pudo importar: ' + e.message)
    }
  }

  return (
    <Sheet title="Ajustes" onClose={onClose}>
      <div className="form">
        <label className="field">
          <span className="field-label">Dólar para convertir pesos</span>
          <select value={settings.arsRate} onChange={(e) => setSettings({ arsRate: e.target.value })}>
            {Object.entries(ARS_RATES).map(([k, l]) => (
              <option key={k} value={k}>{l}{market?.ars?.[k] ? ` · ${money(market.ars[k], 'ARS')}` : ''}</option>
            ))}
          </select>
        </label>

        <ListEditor label="Monedas para ver el total" items={settings.currencies} upper placeholder="Código, ej. EUR"
          locked={['USD', 'ARS']}
          onChange={(currencies) => setSettings({
            currencies,
            ...(currencies.includes(settings.displayCurrency) ? {} : { displayCurrency: 'USD' }),
          })} />
        <ListEditor label="Plataformas" items={settings.platforms} placeholder="Ej. Balanz"
          onChange={(platforms) => setSettings({ platforms })} />
        <ListEditor label="Tipos de bien" items={settings.types} placeholder="Ej. Inmuebles"
          onChange={(types) => setSettings({ types })} />

        <div className="field">
          <span className="field-label">Importar desde brokers</span>
          <button className="btn" onClick={onOpenImport}>Importar reporte de Cocos Capital</button>
        </div>

        <WidgetSection state={state} />

        <div className="field">
          <span className="field-label">Copia de seguridad</span>
          <p className="muted small">Tus datos viven solo en este teléfono. Exportá un archivo de vez en cuando por si borrás Safari.</p>
          <div className="foot-actions">
            <button className="btn grow" onClick={exportData}>Exportar</button>
            <button className="btn grow" onClick={() => fileRef.current?.click()}>Importar</button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden
              onChange={(e) => e.target.files[0] && importData(e.target.files[0])} />
          </div>
          {msg && <p className="small">{msg}</p>}
        </div>

        <p className="muted small">
          Cotizaciones: CoinGecko (cripto y monedas), dolarapi.com (dólar), data912.com (BYMA y EE.UU.), argentinadatos.com (FCI).
        </p>
      </div>
    </Sheet>
  )
}

function WidgetSection({ state }) {
  const [status, setStatus] = useState('')
  const [fallback, setFallback] = useState('')
  const copy = async () => {
    const script = buildWidgetScript(state.holdings, state.settings, location.origin + location.pathname)
    try {
      await navigator.clipboard.writeText(script)
      setStatus('Script copiado.')
      setFallback('')
    } catch {
      setStatus('No se pudo copiar automáticamente. Mantené apretado el texto de abajo, tocá "Seleccionar todo" y copialo.')
      setFallback(script)
    }
  }
  return (
    <div className="field">
      <span className="field-label">Widget de iPhone</span>
      <ol className="steps muted small">
        <li>Instalá <strong>Scriptable</strong> desde el App Store.</li>
        <li>Tocá "Copiar script del widget".</li>
        <li>En Scriptable tocá <strong>+</strong>, pegá el script y renombralo "Patrimonio".</li>
        <li>En la pantalla de inicio mantené apretado, tocá <strong>Editar → Agregar widget</strong>, elegí Scriptable (tamaño chico) y agregalo. Después tocalo y en Script elegí "Patrimonio".</li>
      </ol>
      <button className="btn" onClick={copy}>Copiar script del widget</button>
      {status && <p className="small">{status}</p>}
      {fallback && <textarea className="script-box" readOnly value={fallback} onFocus={(e) => e.target.select()} />}
      <p className="muted small">El widget lleva una copia de tus tenencias. Si las cambiás (por ejemplo, al reimportar Cocos), volvé a copiar el script y reemplazalo en Scriptable.</p>
    </div>
  )
}

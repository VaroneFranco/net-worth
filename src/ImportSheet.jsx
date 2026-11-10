import { useRef, useState } from 'react'
import { Sheet, Icon } from './ui.jsx'
import { parseCocos, COCOS_PLATFORM } from './importers/cocos.js'
import { money, units as fmtUnits } from './format.js'

export default function ImportSheet({ existing, onImport, onClose }) {
  const fileRef = useRef(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const read = async (file) => {
    setError('')
    try {
      setResult(parseCocos(await file.text()))
    } catch (e) {
      setResult(null)
      setError(e.message || String(e))
    }
  }

  const current = existing.filter((h) => h.platform === COCOS_PLATFORM).length

  return (
    <Sheet title="Importar de Cocos" onClose={onClose}
      footer={result && (
        <button className="btn primary" style={{ width: '100%' }} onClick={() => onImport(COCOS_PLATFORM, result.holdings)}>
          {current ? `Reemplazar ${current} tenencias de Cocos` : `Importar ${result.holdings.length} tenencias`}
        </button>
      )}>
      <div className="form">
        {!result && (
          <>
            <p className="muted">
              En Cocos, exportá el reporte de cartera (<strong>portfolio_report_….csv</strong>) y elegilo acá.
              Cada vez que importes, se reemplazan todas las tenencias de Cocos Capital por las del archivo.
            </p>
            <button className="btn primary" onClick={() => fileRef.current?.click()}>Elegir archivo</button>
          </>
        )}
        <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" hidden
          onChange={(e) => { e.target.files[0] && read(e.target.files[0]); e.target.value = '' }} />
        {error && <p className="warn small"><Icon name="alert" size={14} /> {error}</p>}

        {result && (
          <>
            <div className="preview">
              <span className="muted small">Según el archivo{result.date ? ` (precios al ${result.date})` : ''}</span>
              <strong>{money(result.totalArs, 'ARS')}</strong>
              {result.totalUsd > 0 && <span className="muted small">+ {money(result.totalUsd, 'USD')} en dólares</span>}
            </div>
            <p className="muted small">
              Los precios se actualizan en vivo con BYMA. Los FCI quedan con el valor del archivo hasta la próxima importación.
            </p>
            <ul className="list">
              {result.holdings.map((h) => (
                <li key={h.id} className="row static">
                  <div className="row-main">
                    <span className="sym">{h.symbol}{h.source === 'cash' ? '' : ` · ${h.type}`}</span>
                    <span className="muted small ellipsis">{h.name}</span>
                  </div>
                  <div className="row-val"><span className="num">{fmtUnits(h.units)}</span></div>
                </li>
              ))}
            </ul>
            {result.warnings.length > 0 && (
              <ul className="warn small">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            )}
            <button className="btn" onClick={() => fileRef.current?.click()}>Elegir otro archivo</button>
          </>
        )}
      </div>
    </Sheet>
  )
}

// Persistencia local: todo queda en el teléfono (localStorage).
const KEY = 'patrimonio:v1'
const QUOTES_KEY = 'patrimonio:quotes'

export const DEFAULT_SETTINGS = {
  displayCurrency: 'USD',
  arsRate: 'bolsa',
  currencies: ['USD', 'ARS'],
  platforms: ['Cocos Capital', 'Interactive Brokers', 'eToro', 'ARQ', 'Binance', 'Banco', 'Efectivo'],
  types: ['CEDEARs', 'Acciones', 'Bonos', 'Cripto', 'FCI', 'Efectivo', 'Otros'],
  groupBy: 'platform',
  hidden: false,
}

export function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (raw) return { holdings: raw.holdings || [], settings: { ...DEFAULT_SETTINGS, ...raw.settings } }
  } catch { /* datos corruptos o storage bloqueado */ }
  return { holdings: [], settings: DEFAULT_SETTINGS }
}

export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* sin espacio / bloqueado */ }
}

export function loadQuotes() {
  try { return JSON.parse(localStorage.getItem(QUOTES_KEY) || 'null') } catch { return null }
}
export function saveQuotes(q) {
  try { localStorage.setItem(QUOTES_KEY, JSON.stringify(q)) } catch { /* ignore */ }
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

export function suggestType(h) {
  switch (h.source) {
    case 'crypto': return 'Cripto'
    case 'fci': return 'FCI'
    case 'cash': return 'Efectivo'
    case 'us': return 'Acciones'
    case 'ar':
      return { arg_cedears: 'CEDEARs', arg_stocks: 'Acciones', arg_bonds: 'Bonos', arg_corp: 'Bonos' }[h.market] || 'Otros'
    default: return 'Otros'
  }
}

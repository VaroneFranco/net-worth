// Importador del reporte de cartera que exporta Cocos Capital (portfolio_report_YYYYMMDD.csv).
// Formato: separador ";", decimales con coma.
//   instrumento;cantidad;precio;precioAsOf;moneda;total;usedFallbackPrice;missingPrice
//   CEDEAR APPLE INC. (AAPL);85;28900;2026-11-05;ARS;2456500;0;0
//   ARS;2660,37;1;ARS;2660,37          <- saldos en efectivo (sin ticker)

import { uid } from '../store.js'

export const COCOS_PLATFORM = 'Cocos Capital'

const n = (s) => {
  if (s == null) return null
  const t = String(s).trim().replace(/\./g, '').replace(',', '.')
  const v = parseFloat(t)
  return Number.isFinite(v) ? v : null
}

// Saldos de efectivo: EXT son dólares en el exterior (cable).
const CASH = {
  ARS: { currency: 'ARS', name: 'Pesos' },
  USD: { currency: 'USD', name: 'Dólares MEP' },
  EXT: { currency: 'USD', name: 'Dólares cable (EXT)' },
}

function classify(desc) {
  const d = desc.toUpperCase()
  if (d.startsWith('FCI')) return 'fci'
  if (d.startsWith('CEDEAR')) return 'arg_cedears'
  if (/\b(ON|OBLIGACI[OÓ]N|OBLIGACIONES)\b/.test(d)) return 'arg_corp'
  if (/\b(BONO|BONOS|LETRA|LECAP|BONCAP|BOPREAL|TESORO|GLOBAL)\b/.test(d)) return 'arg_bonds'
  return 'arg_stocks'
}

function cleanName(desc) {
  return desc
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/^CEDEAR\s+(DE\s+)?/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseCocos(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!lines.length || !/^instrumento;cantidad;precio/i.test(lines[0])) {
    throw new Error('No parece un reporte de cartera de Cocos (falta el encabezado "instrumento;cantidad;precio…").')
  }
  const holdings = []
  const warnings = []
  let totalArs = 0
  let totalUsd = 0

  for (const line of lines.slice(1)) {
    const c = line.split(';')
    const desc = (c[0] || '').trim()

    // fila de efectivo: ARS;2660,37;1;ARS;2660,37
    if (CASH[desc.toUpperCase()] && c.length <= 6) {
      const info = CASH[desc.toUpperCase()]
      const amount = n(c[1])
      if (amount == null) { warnings.push(`No entendí el saldo "${line}"`); continue }
      if (amount === 0) continue
      holdings.push({
        id: uid(), source: 'cash', currency: info.currency, symbol: info.currency, name: info.name,
        units: amount, platform: COCOS_PLATFORM, type: 'Efectivo', per: 1, imported: 'cocos',
      })
      if (info.currency === 'ARS') totalArs += amount
      else totalUsd += amount
      continue
    }

    const m = desc.match(/\(([A-Z0-9.]+)\)\s*$/i)
    const qty = n(c[1])
    const price = n(c[2])
    const cur = (c[4] || 'ARS').trim().toUpperCase()
    const total = n(c[5])
    if (!m || qty == null) { warnings.push(`Fila salteada: "${desc || line}"`); continue }
    const ticker = m[1].toUpperCase()
    const kind = classify(desc)
    if (cur === 'ARS') totalArs += total ?? 0
    else totalUsd += total ?? 0

    if (kind === 'fci') {
      // Cocos informa el precio de los FCI cada 1000 cuotapartes; el "total" ya está bien calculado.
      const unit = total != null && qty ? total / qty : price != null ? price / 1000 : 0
      holdings.push({
        id: uid(), source: 'manual', symbol: ticker, name: cleanName(desc.replace(/^FCI\s+/i, '')),
        units: qty, price: unit, currency: cur === 'USD' ? 'USD' : 'ARS',
        platform: COCOS_PLATFORM, type: 'FCI', per: 1, imported: 'cocos', asOf: c[3],
      })
      continue
    }

    const bond = kind === 'arg_bonds' || kind === 'arg_corp'
    holdings.push({
      id: uid(), source: 'ar', market: kind, ref: ticker, symbol: ticker, name: cleanName(desc),
      units: qty, platform: COCOS_PLATFORM,
      type: { arg_cedears: 'CEDEARs', arg_stocks: 'Acciones', arg_bonds: 'Bonos', arg_corp: 'Bonos' }[kind],
      per: bond ? 100 : 1, quote: cur === 'USD' ? 'USD' : 'ARS', imported: 'cocos',
      fallbackPrice: price, fallbackCur: cur,
    })
  }

  const date = lines[1]?.split(';')[3]
  return { holdings, warnings, totalArs, totalUsd, date }
}

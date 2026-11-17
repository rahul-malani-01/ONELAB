import Papa from 'papaparse'

export const PLATFORM_FIELDS = [
  'transaction_id',
  'order_id',
  'customer_id',
  'transaction_date',
  'amount',
  'currency',
  'transaction_type',
  'transaction_status',
  'payment_method',
  'reference_id',
]

export const BANK_FIELDS = [
  'settlement_id',
  'transaction_id',
  'settlement_date',
  'settlement_amount',
  'currency',
  'settlement_type',
  'reference_id',
  'bank_reference',
]

const normalizeKey = (key) => String(key ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')
const cents = (value) => Math.round(amountValue(value) * 100)
const fromCents = (value) => value / 100

const parseDate = (value) => {
  if (!value) return null
  const text = String(value).trim()
  const localIso = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (localIso) {
    const [, year, month, day] = localIso
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
    return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day)
      ? date
      : null
  }
  const indianDate = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (indianDate) {
    const [, day, month, year] = indianDate
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
    return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day)
      ? date
      : null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const money = (value, currency = 'INR') =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0))

const groupByTransaction = (rows) => {
  const grouped = new Map()
  rows.forEach((row) => {
    const id = String(row.transaction_id || '').trim()
    if (!id) return
    const matches = grouped.get(id) || []
    matches.push(row)
    grouped.set(id, matches)
  })
  return grouped
}

const dayDifference = (first, second) =>
  Math.round((Date.UTC(second.getUTCFullYear(), second.getUTCMonth(), second.getUTCDate()) -
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate())) / 86400000)

const reportingMonthDate = (period) => {
  const match = String(period || '').match(/([A-Za-z]+)\s+(\d{4})/)
  if (!match) return null
  const monthIndex = new Date(`${match[1]} 1, ${match[2]}`).getMonth()
  return Number.isNaN(monthIndex) ? null : { month: monthIndex, year: Number(match[2]) }
}

const isRefund = (row) =>
  String(row.settlement_type || '').toLowerCase().includes('refund') ||
  cents(row.settlement_amount) < 0

export function generateSampleDataset() {
  const platformAmounts = [
    ['TXN001', 900],
    ['TXN002', 1000],
    ['TXN003', 333.33],
    ['TXN004', 666.67],
    ['TXN005', 500],
    ['TXN006', 1200],
    ['TXN007', 1000],
    ['TXN008', 900],
    ['TXN009', 1000],
    ['TXN010', 1000],
  ]

  const platformTransactions = platformAmounts.map(([id, amount], index) => ({
    transaction_id: id,
    order_id: `ORD-${id.slice(-3)}`,
    customer_id: `CUST-${String(index + 1).padStart(3, '0')}`,
    transaction_date: id === 'TXN005' ? '2026-10-30' : '2026-10-10',
    amount,
    currency: 'INR',
    transaction_type: 'payment',
    transaction_status: 'settled',
    payment_method: 'card',
    reference_id: `REF-${id}`,
  }))

  const bankSettlements = [
    ['SET001', 'TXN001', '2026-10-11', 900, 'credit'],
    ['SET002', 'TXN002', '2026-10-11', 1000, 'credit'],
    ['SET003', 'TXN003', '2026-10-11', 333.32, 'credit'],
    ['SET004', 'TXN004', '2026-10-11', 666.66, 'credit'],
    ['SET005', 'TXN005', '2026-11-01', 500, 'credit'],
    ['SET006A', 'TXN006', '2026-10-11', 1200, 'credit'],
    ['SET006B', 'TXN006', '2026-10-11', 1200, 'credit'],
    ['SET007', 'TXN007', '2026-10-11', 1000, 'credit'],
    ['SET009', 'TXN009', '2026-10-11', 1000, 'credit'],
    ['SET010', 'TXN010', '2026-10-11', 1000, 'credit'],
    ['SET011', 'TXN011', '2026-10-12', 300, 'credit'],
    ['REF001', 'TXN9999', '2026-10-12', -150, 'refund'],
  ].map(([settlementId, transactionId, date, amount, type]) => ({
    settlement_id: settlementId,
    transaction_id: transactionId,
    settlement_date: date,
    settlement_amount: amount,
    currency: 'INR',
    settlement_type: type,
    reference_id: `REF-${transactionId}`,
    bank_reference: `BANK-${settlementId}`,
  }))

  return { platformTransactions, bankSettlements }
}

export function validateCsvRows(rows, datasetType) {
  const requiredFields = datasetType === 'platform' ? PLATFORM_FIELDS : BANK_FIELDS
  const normalizedRows = rows.map((row) => {
    const normalized = {}
    Object.entries(row).forEach(([key, value]) => {
      normalized[normalizeKey(key)] = value
    })
    return normalized
  })
  const headers = normalizedRows.length ? Object.keys(normalizedRows[0]) : []
  const missingFields = requiredFields.filter((field) => !headers.includes(field))
  const validRows = []
  const invalidRows = []
  const seen = new Map()

  normalizedRows.forEach((row, index) => {
    const errors = []
    const rowNumber = index + 2
    const amountField = datasetType === 'platform' ? 'amount' : 'settlement_amount'
    const dateField = datasetType === 'platform' ? 'transaction_date' : 'settlement_date'
    const identityField = datasetType === 'platform' ? 'transaction_id' : 'settlement_id'
    const amountValueParsed = Number(String(row[amountField] ?? '').replace(/[₹$,]/g, '').trim())

    requiredFields.forEach((field) => {
      if (row[field] === undefined || row[field] === null || String(row[field]).trim() === '') {
        errors.push(`Missing ${field}`)
      }
    })

    if (row[amountField] !== undefined && !Number.isFinite(amountValueParsed)) {
      errors.push('Invalid amount')
    }
    if (row[dateField] !== undefined && !parseDate(row[dateField])) {
      errors.push('Invalid date')
    }

    const identity = String(row[identityField] || '').trim()
    if (identity) {
      if (seen.has(identity)) errors.push(`Duplicate ${identityField} (${seen.get(identity)})`)
      else seen.set(identity, `first seen on row ${rowNumber}`)
    }

    if (errors.length) invalidRows.push({ rowNumber, errors, row })
    else validRows.push(row)
  })

  return { validRows, invalidRows, requiredFields, missingFields }
}

export function reconcileTransactions(platformRows = [], bankRows = [], options = {}) {
  const currency = options.currency || 'INR'
  const individualToleranceCents = Math.max(0, Math.round(Number(options.individualTolerance ?? 0.01) * 100))
  const aggregateToleranceCents = Math.max(0, Math.round(Number(options.aggregateTolerance ?? 0.01) * 100))
  const expectedDelayDays = Math.max(0, Number(options.expectedDelayDays ?? 2))
  const reportMonth = reportingMonthDate(options.reportingPeriod || 'October 2026')

  const cleanedPlatform = platformRows.map((row) => ({ ...row, amount: fromCents(cents(row.amount)) }))
  const cleanedBank = bankRows.map((row) => {
    const rawAmountCents = cents(row.settlement_amount)
    const signedAmountCents = isRefund(row) ? -Math.abs(rawAmountCents) : rawAmountCents
    return { ...row, settlement_amount: fromCents(signedAmountCents) }
  })
  const platformById = groupByTransaction(cleanedPlatform)
  const bankById = groupByTransaction(cleanedBank)
  const platformTotalCents = cleanedPlatform.reduce((sum, row) => sum + cents(row.amount), 0)
  const grossCreditsCents = cleanedBank.reduce((sum, row) => sum + Math.max(0, cents(row.settlement_amount)), 0)
  const refundDebitCents = cleanedBank.reduce((sum, row) => sum + (isRefund(row) ? cents(row.settlement_amount) : 0), 0)
  const bankTotalCents = cleanedBank.reduce((sum, row) => sum + cents(row.settlement_amount), 0)
  const duplicates = []
  const timingDifferences = []
  const roundingTransactions = []
  const unmatchedPlatform = []
  const unmatchedBank = []
  const orphanRefunds = []
  const matched = []
  const allIds = new Set([...platformById.keys(), ...bankById.keys()])
  let roundingTotalCents = 0

  for (const id of allIds) {
    const platformMatches = platformById.get(id) || []
    const bankMatches = bankById.get(id) || []
    if (platformMatches.length > 1 || bankMatches.length > 1) {
      const platformImpactCents = platformMatches.slice(1).reduce((sum, row) => sum + Math.abs(cents(row.amount)), 0)
      const bankImpactCents = bankMatches.slice(1).reduce((sum, row) => sum + Math.abs(cents(row.settlement_amount)), 0)
      const largestPlatformEntryCents = platformMatches.reduce((largest, row) => Math.max(largest, Math.abs(cents(row.amount))), 0)
      const largestBankEntryCents = bankMatches.reduce((largest, row) => Math.max(largest, Math.abs(cents(row.settlement_amount))), 0)
      const largestEntryCents = Math.max(largestPlatformEntryCents, largestBankEntryCents)
      duplicates.push({
        transactionId: id,
        platformEntries: platformMatches.length,
        bankEntries: bankMatches.length,
        settlementIds: bankMatches.map((row) => row.settlement_id).filter(Boolean),
        source: platformMatches.length > 1 && bankMatches.length > 1 ? 'both' : platformMatches.length > 1 ? 'platform' : 'bank',
        amount: largestEntryCents / 100,
        duplicateImpact: (platformImpactCents + bankImpactCents) / 100,
        explanation: `Duplicate transaction reference found: ${platformMatches.length} platform entry/entries and ${bankMatches.length} bank entry/entries.`,
      })
    }
  }

  for (const id of allIds) {
    const platformMatches = platformById.get(id) || []
    const bankMatches = bankById.get(id) || []
    const onlyRefundRows = bankMatches.length > 0 && bankMatches.every(isRefund)
    const hasPlatform = platformMatches.length > 0
    const hasDuplicate = platformMatches.length > 1 || bankMatches.length > 1

    if (onlyRefundRows && !hasPlatform) {
      bankMatches.forEach((row) => {
        orphanRefunds.push({
          settlementId: row.settlement_id,
          transactionId: id,
          amount: row.settlement_amount,
          originalFound: false,
          explanation: 'A refund exists in the bank dataset, but its original transaction is missing from the platform dataset.',
        })
      })
      continue
    }

    if (!hasPlatform && bankMatches.length) {
      unmatchedBank.push({
        transactionId: id,
        settlementIds: bankMatches.map((row) => row.settlement_id).filter(Boolean),
        amount: bankMatches.reduce((sum, row) => sum + cents(row.settlement_amount), 0) / 100,
        explanation: 'A bank payment was received without a corresponding platform transaction.',
      })
      continue
    }

    if (hasPlatform && !bankMatches.length) {
      unmatchedPlatform.push({
        transactionId: id,
        amount: platformMatches.reduce((sum, row) => sum + cents(row.amount), 0) / 100,
        explanation: 'A platform transaction has no corresponding bank settlement.',
      })
      continue
    }

    if (!hasPlatform || !bankMatches.length || hasDuplicate || onlyRefundRows) continue

    const platformAmountCents = platformMatches.reduce((sum, row) => sum + cents(row.amount), 0)
    const bankAmountCents = bankMatches.reduce((sum, row) => sum + cents(row.settlement_amount), 0)
    const deltaCents = Math.abs(platformAmountCents - bankAmountCents)

    if (deltaCents > 0 && deltaCents <= individualToleranceCents) {
      roundingTotalCents += deltaCents
      roundingTransactions.push({
        transactionId: id,
        platformAmount: platformAmountCents / 100,
        bankAmount: bankAmountCents / 100,
        difference: deltaCents / 100,
        explanation: `Platform ${money(platformAmountCents / 100, currency)} vs bank ${money(bankAmountCents / 100, currency)}; individual difference ${money(deltaCents / 100, currency)}.`,
      })
      continue
    }

    const platformDate = parseDate(platformMatches[0].transaction_date)
    const bankDates = bankMatches.map((row) => parseDate(row.settlement_date)).filter(Boolean)
    const firstBankDate = bankDates.sort((a, b) => a - b)[0]
    const dateIsFollowingReportMonth = Boolean(
      reportMonth &&
      firstBankDate &&
      firstBankDate.getUTCFullYear() === (reportMonth.month === 11 ? reportMonth.year + 1 : reportMonth.year) &&
      firstBankDate.getUTCMonth() === (reportMonth.month + 1) % 12
    )
    const delay = platformDate && firstBankDate ? dayDifference(platformDate, firstBankDate) : -1
    const isLateSettlement = platformAmountCents === bankAmountCents &&
      delay >= 0 &&
      delay <= expectedDelayDays &&
      (dateIsFollowingReportMonth || (platformDate && firstBankDate && platformDate.getUTCMonth() !== firstBankDate.getUTCMonth()))

    if (isLateSettlement) {
      timingDifferences.push({
        transactionId: id,
        platformDate: formatDate(platformMatches[0].transaction_date),
        settlementDate: formatDate(firstBankDate),
        amount: platformAmountCents / 100,
        difference: 0,
        explanation: 'Payment was settled in the following month. It is not a missing payment.',
      })
      continue
    }

    if (deltaCents === 0) {
      matched.push({
        transactionId: id,
        platformAmount: platformAmountCents / 100,
        bankAmount: bankAmountCents / 100,
      })
    } else {
      unmatchedPlatform.push({
        transactionId: id,
        amount: platformAmountCents / 100,
        bankAmount: bankAmountCents / 100,
        difference: deltaCents / 100,
        explanation: `Platform ${money(platformAmountCents / 100, currency)} does not match bank ${money(bankAmountCents / 100, currency)}.`,
      })
    }
  }

  const aggregateRoundingTriggered = roundingTotalCents > aggregateToleranceCents
  const discrepancyRows = [
    {
      category: 'Clean matched transactions',
      code: 'CLEAN_MATCH',
      count: matched.length,
      amount: matched.reduce((sum, item) => sum + item.platformAmount, 0),
      severity: 'success',
      description: 'Platform and bank amounts match.',
      items: matched,
    },
    {
      category: 'Timing differences',
      code: 'TIMING_DIFFERENCE',
      count: timingDifferences.length,
      amount: timingDifferences.reduce((sum, item) => sum + item.amount, 0),
      severity: 'medium',
      description: 'Payment was settled in the following month. It is not a missing payment.',
      items: timingDifferences,
    },
    {
      category: 'Rounding-affected transactions',
      code: 'ROUNDING_DIFFERENCE',
      count: roundingTransactions.length,
      amount: roundingTransactions.reduce((sum, item) => sum + item.platformAmount, 0),
      difference: roundingTotalCents / 100,
      severity: 'low',
      description: `Individual rounding differences total ${money(roundingTotalCents / 100, currency)}.` +
        (aggregateRoundingTriggered ? ` This exceeds the aggregate tolerance of ${money(aggregateToleranceCents / 100, currency)}.` : ''),
      items: roundingTransactions,
    },
    {
      category: 'Duplicate groups',
      code: 'DUPLICATE_ENTRY',
      count: duplicates.length,
      amount: duplicates.reduce((sum, item) => sum + item.duplicateImpact, 0),
      severity: 'high',
      description: 'Duplicate transaction references were detected in the bank dataset.',
      items: duplicates,
    },
    {
      category: 'Unmatched platform',
      code: 'UNMATCHED_PLATFORM',
      count: unmatchedPlatform.length,
      amount: unmatchedPlatform.reduce((sum, item) => sum + item.amount, 0),
      severity: 'medium',
      description: 'Platform transactions have no matching bank payment.',
      items: unmatchedPlatform,
    },
    {
      category: 'Unmatched bank payment',
      code: 'UNMATCHED_BANK',
      count: unmatchedBank.length,
      amount: unmatchedBank.reduce((sum, item) => sum + item.amount, 0),
      severity: 'medium',
      description: 'Bank payments have no matching platform transaction.',
      items: unmatchedBank,
    },
    {
      category: 'Orphan refunds',
      code: 'ORPHAN_REFUND',
      count: orphanRefunds.length,
      amount: orphanRefunds.reduce((sum, item) => sum + item.amount, 0),
      severity: 'high',
      description: 'Refunds were found without a matching original platform transaction.',
      items: orphanRefunds,
    },
  ]

  const discrepancies = discrepancyRows.filter((item) => item.count > 0 && item.code !== 'CLEAN_MATCH')
  if (roundingTotalCents > 0 && aggregateRoundingTriggered) {
    discrepancies.push({
      category: 'Aggregate rounding difference',
      code: 'AGGREGATE_ROUNDING_DIFFERENCE',
      count: 1,
      amount: roundingTotalCents / 100,
      severity: 'low',
      description: `The cumulative rounding difference is ${money(roundingTotalCents / 100, currency)}, above the ${money(aggregateToleranceCents / 100, currency)} aggregate tolerance.`,
      items: roundingTransactions,
    })
  }

  const uniquePlatformTransactionCount = platformById.size
  const matchedCount = matched.length
  const discrepancyAmountCents =
    timingDifferences.reduce((sum, item) => sum + cents(item.amount), 0) +
    roundingTotalCents +
    duplicates.reduce((sum, item) => sum + Math.round(item.duplicateImpact * 100), 0) +
    unmatchedPlatform.reduce((sum, item) => sum + cents(item.amount), 0) +
    unmatchedBank.reduce((sum, item) => sum + Math.abs(cents(item.amount)), 0) +
    orphanRefunds.reduce((sum, item) => sum + Math.abs(cents(item.amount)), 0)
  const summary = {
    platformTotal: platformTotalCents / 100,
    grossBankCredits: grossCreditsCents / 100,
    refundDebit: refundDebitCents / 100,
    bankTotal: bankTotalCents / 100,
    matchedTransactions: matchedCount,
    unmatchedTransactions: unmatchedPlatform.length + unmatchedBank.length,
    discrepancyAmount: discrepancyAmountCents / 100,
    successRate: uniquePlatformTransactionCount ? Number(((matchedCount / uniquePlatformTransactionCount) * 100).toFixed(1)) : 0,
    totalUniqueIds: uniquePlatformTransactionCount,
    uniquePlatformTransactionCount,
    platformRecordCount: cleanedPlatform.length,
    bankRecordCount: cleanedBank.length,
    cleanMatchedCount: matched.length,
    timingDifferenceCount: timingDifferences.length,
    roundingAffectedCount: roundingTransactions.length,
    duplicateGroupCount: duplicates.length,
    unmatchedPlatformCount: unmatchedPlatform.length,
    unmatchedBankCount: unmatchedBank.length,
    orphanRefundCount: orphanRefunds.length,
    aggregateRoundingDifference: roundingTotalCents / 100,
    aggregateRoundingTriggered,
  }

  return {
    summary,
    discrepancies,
    categories: discrepancyRows,
    matched,
    timingDifferences,
    roundingTransactions,
    duplicateEntries: duplicates,
    unmatchedPlatform,
    unmatchedBank,
    orphanRefunds,
    platformRows: cleanedPlatform,
    bankRows: cleanedBank,
    activity: [{
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      details: `${discrepancies.length} discrepancy categories flagged`,
      severity: discrepancies.some((item) => item.severity === 'high') ? 'critical' : 'normal',
    }],
  }
}

export function generateCsvPreview(rows) {
  return rows.slice(0, 5).map((row, index) => ({
    id: index,
    fields: Object.entries(row).map(([key, value]) => ({ key, value })),
  }))
}

export function formatMoneyDisplay(value, currency = 'INR') {
  return money(value, currency)
}

export function parseCsv(text) {
  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => normalizeKey(header),
    transform: (value) => value?.trim?.() ?? value,
  })
  return result.data || []
}

export const toLocalDate = (value) => {
  const date = parseDate(value)
  if (!date) return '—'
  return date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export const formatDate = (value) => {
  const date = parseDate(value)
  if (!date) return '—'
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export const toDateKey = (value) => {
  const date = parseDate(value)
  return date ? date.toISOString().slice(0, 10) : ''
}

export const amountValue = (value) => {
  const parsed = Number(String(value ?? '').replace(/[₹$,]/g, '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

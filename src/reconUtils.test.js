import { describe, expect, it } from 'vitest'
import { formatDate, generateSampleDataset, reconcileTransactions } from './reconUtils'

describe('October 2026 reconciliation example', () => {
  const { platformTransactions, bankSettlements } = generateSampleDataset()
  const result = reconcileTransactions(platformTransactions, bankSettlements, {
    reportingPeriod: 'October 2026',
    currency: 'INR',
    individualTolerance: 0.01,
    aggregateTolerance: 0.01,
    expectedDelayDays: 2,
  })

  it('calculates the expected input totals and transaction classification counts', () => {
    expect(platformTransactions).toHaveLength(10)
    expect(bankSettlements).toHaveLength(12)
    expect(result.summary.platformTotal).toBe(8500)
    expect(result.summary.grossBankCredits).toBe(9099.98)
    expect(result.summary.refundDebit).toBe(-150)
    expect(result.summary.bankTotal).toBe(8949.98)
    expect(result.summary.cleanMatchedCount).toBe(5)
    expect(result.summary.timingDifferenceCount).toBe(1)
    expect(result.summary.roundingAffectedCount).toBe(2)
    expect(result.summary.duplicateGroupCount).toBe(1)
    expect(result.summary.unmatchedPlatformCount).toBe(1)
    expect(result.summary.unmatchedBankCount).toBe(1)
    expect(result.summary.orphanRefundCount).toBe(1)
    expect(result.summary.aggregateRoundingDifference).toBe(0.02)
    expect(result.summary.aggregateRoundingTriggered).toBe(true)
    expect(result.summary.uniquePlatformTransactionCount).toBe(10)
    expect(result.summary.successRate).toBe(50)
    expect(result.summary.discrepancyAmount).toBe(3050.02)
  })

  it('keeps the November settlement as timing, not unmatched', () => {
    expect(result.timingDifferences).toEqual([
      expect.objectContaining({
        transactionId: 'TXN005',
        platformDate: '30 October 2026',
        settlementDate: '1 November 2026',
        amount: 500,
        difference: 0,
      }),
    ])
    expect(result.unmatchedPlatform.some((item) => item.transactionId === 'TXN005')).toBe(false)
    expect(result.summary.timingDifferenceCount).toBe(1)
  })

  it('reports the rounding transactions, duplicate IDs, unmatched records, and orphan refund', () => {
    expect(result.roundingTransactions.map((item) => [item.transactionId, item.difference])).toEqual([
      ['TXN003', 0.01],
      ['TXN004', 0.01],
    ])
    expect(result.duplicateEntries).toEqual([
      expect.objectContaining({
        transactionId: 'TXN006',
        platformEntries: 1,
        bankEntries: 2,
        settlementIds: ['SET006A', 'SET006B'],
        amount: 1200,
        duplicateImpact: 1200,
      }),
    ])
    expect(result.unmatchedPlatform).toEqual([expect.objectContaining({ transactionId: 'TXN008', amount: 900 })])
    expect(result.unmatchedBank).toEqual([expect.objectContaining({ transactionId: 'TXN011', amount: 300 })])
    expect(result.orphanRefunds).toEqual([
      expect.objectContaining({ settlementId: 'REF001', transactionId: 'TXN9999', amount: -150, originalFound: false }),
    ])
  })

  it('treats a positive refund amount as a bank debit', () => {
    const bankWithPositiveRefund = bankSettlements.map((row) =>
      row.settlement_id === 'REF001' ? { ...row, settlement_amount: 150 } : row,
    )
    const positiveRefundResult = reconcileTransactions(platformTransactions, bankWithPositiveRefund, {
      reportingPeriod: 'October 2026',
      currency: 'INR',
      individualTolerance: 0.01,
      aggregateTolerance: 0.01,
      expectedDelayDays: 2,
    })

    expect(positiveRefundResult.summary.refundDebit).toBe(-150)
    expect(positiveRefundResult.summary.bankTotal).toBe(8949.98)
  })

  it('preserves the calendar date from ISO timestamps with timezone offsets', () => {
    expect(formatDate('2026-10-30T00:00:00+05:30')).toBe('30 October 2026')
    expect(formatDate('2026-11-01T00:00:00+05:30')).toBe('1 November 2026')
  })

  it('detects duplicate platform transaction references as well as bank duplicates', () => {
    const duplicatedPlatform = [
      ...platformTransactions,
      { ...platformTransactions[0], amount: 900, order_id: 'ORD-DUPLICATE' },
    ]
    const duplicateResult = reconcileTransactions(duplicatedPlatform, bankSettlements, {
      reportingPeriod: 'October 2026',
      currency: 'INR',
      individualTolerance: 0.01,
      aggregateTolerance: 0.01,
      expectedDelayDays: 2,
    })

    expect(duplicateResult.duplicateEntries).toContainEqual(
      expect.objectContaining({ transactionId: 'TXN001', source: 'platform', platformEntries: 2, bankEntries: 1 }),
    )
  })

  it('returns a zero success rate for an empty platform dataset', () => {
    const emptyResult = reconcileTransactions([], bankSettlements)

    expect(emptyResult.summary.uniquePlatformTransactionCount).toBe(0)
    expect(emptyResult.summary.successRate).toBe(0)
  })

  it('returns 100% when every unique platform transaction is cleanly matched', () => {
    const platform = [{ transaction_id: 'TXN-A', transaction_date: '2026-10-10', amount: 100 }]
    const bank = [{ transaction_id: 'TXN-A', settlement_date: '2026-10-11', settlement_amount: 100 }]
    const allMatched = reconcileTransactions(platform, bank)

    expect(allMatched.summary.cleanMatchedCount).toBe(1)
    expect(allMatched.summary.successRate).toBe(100)
  })

  it('returns zero clean matches when platform and bank transaction IDs do not match', () => {
    const platform = [{ transaction_id: 'TXN-A', transaction_date: '2026-10-10', amount: 100 }]
    const bank = [{ transaction_id: 'TXN-B', settlement_date: '2026-10-11', settlement_amount: 50 }]
    const noneMatched = reconcileTransactions(platform, bank)

    expect(noneMatched.summary.cleanMatchedCount).toBe(0)
    expect(noneMatched.summary.successRate).toBe(0)
  })

  it('excludes duplicate settlements from clean matches and counts only the excess once', () => {
    const platform = [{ transaction_id: 'TXN-A', transaction_date: '2026-10-10', amount: 1200 }]
    const bank = [
      { transaction_id: 'TXN-A', settlement_id: 'SET-A', settlement_date: '2026-10-11', settlement_amount: 1200 },
      { transaction_id: 'TXN-A', settlement_id: 'SET-B', settlement_date: '2026-10-11', settlement_amount: 1200 },
    ]
    const duplicateResult = reconcileTransactions(platform, bank)

    expect(duplicateResult.summary.cleanMatchedCount).toBe(0)
    expect(duplicateResult.summary.successRate).toBe(0)
    expect(duplicateResult.summary.discrepancyAmount).toBe(1200)
  })

  it('aggregates rounding differences once in the discrepancy amount', () => {
    const platform = [
      { transaction_id: 'TXN-A', transaction_date: '2026-10-10', amount: 333.33 },
      { transaction_id: 'TXN-B', transaction_date: '2026-10-10', amount: 666.67 },
    ]
    const bank = [
      { transaction_id: 'TXN-A', settlement_date: '2026-10-11', settlement_amount: 333.32 },
      { transaction_id: 'TXN-B', settlement_date: '2026-10-11', settlement_amount: 666.66 },
    ]
    const roundingResult = reconcileTransactions(platform, bank, { aggregateTolerance: 0.01 })

    expect(roundingResult.summary.roundingAffectedCount).toBe(2)
    expect(roundingResult.summary.aggregateRoundingDifference).toBe(0.02)
    expect(roundingResult.summary.successRate).toBe(0)
    expect(roundingResult.summary.discrepancyAmount).toBe(0.02)
  })
})

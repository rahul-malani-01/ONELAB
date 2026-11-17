import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  Landmark,
  LayoutDashboard,
  ListFilter,
  PlusCircle,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserCircle2,
  Wallet,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom'
import { jsPDF } from 'jspdf'
import {
  BANK_FIELDS,
  PLATFORM_FIELDS,
  formatMoneyDisplay,
  generateCsvPreview,
  generateSampleDataset,
  parseCsv,
  reconcileTransactions,
  toDateKey,
  toLocalDate,
  validateCsvRows,
} from './reconUtils'
import './App.css'

const navItems = [
  { label: 'Overview', path: '/', icon: LayoutDashboard },
  { label: 'Data Management', path: '/data', icon: Database },
  { label: 'Sample Data Generator', path: '/samples', icon: Sparkles },
  { label: 'Reconciliation', path: '/reconciliation', icon: RefreshCw },
  { label: 'Discrepancy Center', path: '/discrepancies', icon: AlertTriangle },
  { label: 'Transaction Explorer', path: '/explorer', icon: ListFilter },
  { label: 'Reports', path: '/reports', icon: FileSpreadsheet },
  { label: 'Audit Trail', path: '/audit', icon: ShieldCheck },
  { label: 'Settings', path: '/settings', icon: Settings },
]

const dbName = 'ReconAI_DB'
const storeNames = ['platform', 'bank', 'results', 'audit']

const defaultStats = {
  platformTotal: 0,
  bankTotal: 0,
  matchedTransactions: 0,
  unmatchedTransactions: 0,
  discrepancyAmount: 0,
  successRate: 0,
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1)

    request.onupgradeneeded = () => {
      const db = request.result
      storeNames.forEach((storeName) => {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'id' })
        }
      })
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function saveTypedData(type, rows) {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(type, 'readwrite')
    const store = tx.objectStore(type)
    const payload = {
      id: `${type}-${Date.now()}`,
      type,
      rows,
      createdAt: new Date().toISOString(),
    }

    const putRequest = store.put(payload)
    putRequest.onsuccess = () => resolve(payload)
    putRequest.onerror = () => reject(putRequest.error)
  })
}

async function replaceDataset(type, rows) {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([type, 'results'], 'readwrite')
    const datasetStore = tx.objectStore(type)
    const payload = {
      id: `${type}-${Date.now()}`,
      type,
      rows,
      createdAt: new Date().toISOString(),
    }

    datasetStore.clear()
    datasetStore.put(payload)
    tx.objectStore('results').clear()
    tx.oncomplete = () => resolve(payload)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error || new Error('Dataset replacement was aborted.'))
  })
}

async function clearStores(types) {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(types, 'readwrite')
    types.forEach((type) => tx.objectStore(type).clear())
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error || new Error('Stored data cleanup was aborted.'))
  })
}

async function saveResult(result) {
  return saveTypedData('results', { result })
}

async function getLatestData(type) {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(type, 'readonly')
    const store = tx.objectStore(type)
    const request = store.getAll()

    request.onsuccess = () => {
      const entries = request.result || []
      resolve(entries.length ? entries[entries.length - 1] : null)
    }
    request.onerror = () => reject(request.error)
  })
}

async function getAllAuditEntries() {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('audit', 'readonly')
    const store = tx.objectStore('audit')
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result || [])
    request.onerror = () => reject(request.error)
  })
}

async function saveAuditEntry(entry) {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('audit', 'readwrite')
    const store = tx.objectStore('audit')
    const payload = {
      id: `audit-${Date.now()}`,
      ...entry,
      timestamp: new Date().toISOString(),
    }

    const request = store.put(payload)
    request.onsuccess = () => resolve(payload)
    request.onerror = () => reject(request.error)
  })
}

function AppShell() {
  const [theme, setTheme] = useState(() => localStorage.getItem('recon-theme') || 'light')
  const [reportingPeriod, setReportingPeriod] = useState(() => localStorage.getItem('recon-period-v2') || 'October 2026')
  const [currency, setCurrency] = useState(() => localStorage.getItem('recon-currency') || 'INR')
  const [individualTolerance, setIndividualTolerance] = useState(() => Number(localStorage.getItem('recon-individual-tolerance') || 0.01))
  const [aggregateTolerance, setAggregateTolerance] = useState(() => Number(localStorage.getItem('recon-aggregate-tolerance') || 0.01))
  const [expectedDelayDays, setExpectedDelayDays] = useState(() => Number(localStorage.getItem('recon-delay-days') || 2))
  const settingsRef = useRef({ reportingPeriod, currency, individualTolerance, aggregateTolerance, expectedDelayDays })
  const [hasReconciled, setHasReconciled] = useState(false)
  const [platformData, setPlatformData] = useState([])
  const [bankData, setBankData] = useState([])
  const [reconciliation, setReconciliation] = useState({
    summary: defaultStats,
    discrepancies: [],
    matched: [],
    unmatched: [],
    activity: [],
  })
  const [auditTrail, setAuditTrail] = useState([])
  const [toast, setToast] = useState('')
  const [lastReconciledAt, setLastReconciledAt] = useState('')

  useEffect(() => {
    document.body.dataset.theme = theme
    localStorage.setItem('recon-theme', theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('recon-period-v2', reportingPeriod)
  }, [reportingPeriod])

  useEffect(() => {
    localStorage.setItem('recon-currency', currency)
    localStorage.setItem('recon-individual-tolerance', String(individualTolerance))
    localStorage.setItem('recon-aggregate-tolerance', String(aggregateTolerance))
    localStorage.setItem('recon-delay-days', String(expectedDelayDays))
  }, [currency, individualTolerance, aggregateTolerance, expectedDelayDays])

  useEffect(() => {
    settingsRef.current = { reportingPeriod, currency, individualTolerance, aggregateTolerance, expectedDelayDays }
  }, [reportingPeriod, currency, individualTolerance, aggregateTolerance, expectedDelayDays])

  useEffect(() => {
    const initialize = async () => {
      try {
        const latestPlatform = await getLatestData('platform')
        const latestBank = await getLatestData('bank')
        const latestResult = await getLatestData('results')
        const history = await getAllAuditEntries()

        const isOldGeneratedSample =
          latestPlatform?.rows?.length === 7 &&
          latestPlatform.rows.some((row) => row.transaction_id === 'TXN-1001') &&
          latestBank?.rows?.length === 9 &&
          latestBank.rows.some((row) => row.settlement_id === 'SET-1001')

        if (isOldGeneratedSample) {
          await clearStores(['platform', 'bank', 'results', 'audit'])
        }

        if (!isOldGeneratedSample && latestPlatform?.rows?.length) setPlatformData(latestPlatform.rows)
        if (!isOldGeneratedSample && latestBank?.rows?.length) setBankData(latestBank.rows)
        if (!isOldGeneratedSample && latestPlatform?.rows?.length && latestBank?.rows?.length) {
          if (latestResult?.rows?.result) {
            setReconciliation(reconcileTransactions(latestPlatform.rows, latestBank.rows, settingsRef.current))
            setLastReconciledAt(latestResult.createdAt)
            setHasReconciled(true)
          }
        }
        setAuditTrail(isOldGeneratedSample ? [] : history || [])
      } catch (error) {
        console.error('Initialization error', error)
      }
    }

    initialize()
  }, [])

  const showToast = (message) => {
    setToast(message)
    setTimeout(() => setToast(''), 2400)
  }

  const markReviewNeeded = () => {
    setHasReconciled(false)
    setLastReconciledAt('')
    setReconciliation({ summary: defaultStats, discrepancies: [], matched: [], unmatched: [], activity: [] })
    clearStores(['results']).catch((error) => {
      console.error('Could not invalidate saved reconciliation results', error)
      showToast('Could not clear the previous reconciliation. Please try again.')
    })
  }

  const runReconciliation = async () => {
    if (!platformData.length || !bankData.length) {
      showToast('Import both datasets before reviewing reconciliation.')
      return
    }

    const result = reconcileTransactions(platformData, bankData, {
      reportingPeriod,
      currency,
      individualTolerance,
      aggregateTolerance,
      expectedDelayDays,
    })
    setReconciliation(result)
    setLastReconciledAt(new Date().toISOString())
    setHasReconciled(true)
    await saveResult(result)
    await saveAuditEntry({
      title: 'Reconciliation completed',
      details: `${result.discrepancies.length} discrepancy categories were identified.`,
      level: result.discrepancies.length ? 'warning' : 'success',
    })
    setAuditTrail(await getAllAuditEntries())
    showToast('Reconciliation run completed successfully')
  }

  const handleUpload = async (datasetType, rows, rejectedCount = 0) => {
    if (!rows.length) {
      showToast('No valid rows were found in the uploaded CSV.')
      return
    }
    await replaceDataset(datasetType, rows)
    if (datasetType === 'platform') setPlatformData(rows)
    if (datasetType === 'bank') setBankData(rows)
    setHasReconciled(false)
    setReconciliation({ summary: defaultStats, discrepancies: [], matched: [], unmatched: [], activity: [] })
    setLastReconciledAt('')

    await saveAuditEntry({
      title: `${datasetType === 'platform' ? 'Platform' : 'Bank'} dataset imported`,
      details: `${rows.length} valid rows imported as the active dataset. ${rejectedCount} rows were rejected.`,
      level: 'info',
    })

    setAuditTrail(await getAllAuditEntries())
    showToast('CSV uploaded and imported successfully')
  }

  const triggerSampleGenerator = async () => {
    const sample = generateSampleDataset()
    await replaceDataset('platform', sample.platformTransactions)
    await replaceDataset('bank', sample.bankSettlements)
    setPlatformData(sample.platformTransactions)
    setBankData(sample.bankSettlements)

    const result = reconcileTransactions(sample.platformTransactions, sample.bankSettlements, {
      reportingPeriod,
      currency,
      individualTolerance,
      aggregateTolerance,
      expectedDelayDays,
    })
    setReconciliation(result)
    setLastReconciledAt(new Date().toISOString())
    setHasReconciled(true)
    await saveResult(result)
    await saveAuditEntry({
      title: 'Sample dataset generated',
      details: 'Artificial reconciliation sample created to demonstrate discrepancy logic.',
      level: 'success',
    })
    setAuditTrail(await getAllAuditEntries())
    showToast('Sample data loaded')
  }

  const chartData = useMemo(() => {
    const platformByDate = new Map()
    const bankByDate = new Map()

    platformData.forEach((row) => {
      const dateKey = toDateKey(row.transaction_date)
      if (!dateKey) return
      platformByDate.set(dateKey, (platformByDate.get(dateKey) || 0) + Number(row.amount || 0))
    })

    bankData.forEach((row) => {
      const dateKey = toDateKey(row.settlement_date)
      if (!dateKey) return
      bankByDate.set(dateKey, (bankByDate.get(dateKey) || 0) + Number(row.settlement_amount || 0))
    })

    const allDates = Array.from(new Set([...platformByDate.keys(), ...bankByDate.keys()])).sort()
    return allDates.map((date) => ({
      date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      platform: Number(platformByDate.get(date) || 0),
      bank: Number(bankByDate.get(date) || 0),
    }))
  }, [platformData, bankData])

  const hasBothDatasets = platformData.length > 0 && bankData.length > 0
  const hasAnyDataset = platformData.length > 0 || bankData.length > 0
  const displayResult = hasReconciled ? reconciliation : {
    summary: defaultStats,
    discrepancies: [],
    matched: [],
    activity: [],
  }

  const discrepancyChart = useMemo(() => {
    if (!hasReconciled) return []
    return (reconciliation.categories || [])
      .filter((item) => item.count > 0 && item.code !== 'CLEAN_MATCH')
      .map((item) => ({ name: item.category, value: item.count }))
  }, [reconciliation, hasReconciled])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-section">
          <div className="brand-mark">R</div>
          <div>
            <div className="brand-name">ReconAI</div>
            <div className="brand-tagline">Reconciliation Intelligence</div>
          </div>
        </div>

        <nav className="nav-menu">
          {navItems.map(({ label, path, icon: Icon }) => (
            <NavLink key={label} to={path} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-card">
          <div className="sidebar-card-title">Settlement health</div>
          <div className="metric-row">
            <span>Success rate</span>
            <strong>{hasReconciled ? `${reconciliation.summary.successRate ?? 0}%` : 'N/A'}</strong>
          </div>
          <div className="mini-progress">
            <span style={{ width: `${reconciliation.summary.successRate ?? 0}%` }} />
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="searchbox">
            <Search size={16} />
            <input type="text" placeholder="Search transactions, IDs or notes" />
          </div>

          <div className="topbar-right">
            <div className="reporting-pill">
              <Landmark size={15} />
              <select value={reportingPeriod} onChange={(event) => {
                setReportingPeriod(event.target.value)
                markReviewNeeded()
              }}>
                <option>October 2026</option>
                <option>November 2026</option>
                <option>Q4 2026</option>
                <option>Annual 2026</option>
              </select>
            </div>

            {hasBothDatasets && !hasReconciled && (
              <button className="primary-button" onClick={runReconciliation}>
                <RefreshCw size={16} /> Review &amp; reconcile
              </button>
            )}
            <button className="icon-button" aria-label="Notifications">
              <Bell size={18} />
            </button>
            <button className="theme-toggle" onClick={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}>
              {theme === 'light' ? 'Dark' : 'Light'} mode
            </button>
            <div className="user-profile">
              <UserCircle2 size={30} />
            </div>
          </div>
        </header>

        <div className="content-wrap">
          <Routes>
            <Route
              path="/"
              element={
                <OverviewPage
                  reportingPeriod={reportingPeriod}
                  lastReconciledAt={lastReconciledAt}
                  reconciliation={displayResult}
                  hasReconciled={hasReconciled}
                  hasAnyDataset={hasAnyDataset}
                  hasBothDatasets={hasBothDatasets}
                  currency={currency}
                  platformData={platformData}
                  bankData={bankData}
                  chartData={chartData}
                  discrepancyChart={discrepancyChart}
                  onRunReconciliation={runReconciliation}
                />
              }
            />
            <Route
              path="/data"
              element={<DataManagementPage onUpload={handleUpload} platformData={platformData} bankData={bankData} auditTrail={auditTrail} />}
            />
            <Route path="/samples" element={<SampleDataPage onGenerate={triggerSampleGenerator} />} />
            <Route
              path="/reconciliation"
              element={<ReconciliationPage result={displayResult} hasBothDatasets={hasBothDatasets} hasReconciled={hasReconciled} onRunReconciliation={runReconciliation} currency={currency} />}
            />
            <Route path="/discrepancies" element={<DiscrepancyCenterPage result={displayResult} currency={currency} />} />
            <Route
              path="/explorer"
              element={<TransactionExplorerPage platformData={platformData} bankData={bankData} result={displayResult} currency={currency} />}
            />
            <Route path="/reports" element={<ReportsPage result={displayResult} currency={currency} hasBothDatasets={hasBothDatasets} hasReconciled={hasReconciled} />} />
            <Route path="/audit" element={<AuditTrailPage auditTrail={auditTrail} />} />
            <Route
              path="/settings"
              element={
                <SettingsPage
                  reportingPeriod={reportingPeriod}
                  onPeriodChange={setReportingPeriod}
                  onSettingsChange={markReviewNeeded}
                  theme={theme}
                  onThemeToggle={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
                  currency={currency}
                  onCurrencyChange={setCurrency}
                  individualTolerance={individualTolerance}
                  onIndividualToleranceChange={setIndividualTolerance}
                  aggregateTolerance={aggregateTolerance}
                  onAggregateToleranceChange={setAggregateTolerance}
                  expectedDelayDays={expectedDelayDays}
                  onExpectedDelayDaysChange={setExpectedDelayDays}
                />
              }
            />
          </Routes>
        </div>
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function OverviewPage({ reportingPeriod, lastReconciledAt, reconciliation, hasReconciled, hasAnyDataset, hasBothDatasets, currency, platformData, bankData, chartData, discrepancyChart, onRunReconciliation }) {
  const criticalFindings = reconciliation.discrepancies.slice(0, 3)

  const kpis = [
    { label: 'Total Platform Transactions', value: platformData.length, icon: Wallet, color: 'blue' },
    { label: 'Total Bank Settlements', value: bankData.length, icon: Landmark, color: 'green' },
    { label: 'Matched Transactions', value: reconciliation.summary.matchedTransactions, icon: CheckCircle2, color: 'green-soft' },
    { label: 'Unmatched Transactions', value: reconciliation.summary.unmatchedTransactions, icon: AlertTriangle, color: 'orange' },
    { label: 'Total Discrepancy Amount', value: hasReconciled ? formatMoneyDisplay(reconciliation.summary.discrepancyAmount, currency) : 'N/A', icon: TrendingUp, color: 'red' },
    { label: 'Reconciliation Success Rate', value: hasReconciled ? `${reconciliation.summary.successRate ?? 0}%` : 'N/A', icon: ShieldCheck, color: 'blue-soft' },
  ]

  return (
    <div className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Operations dashboard</p>
          <h1>ReconAI overview</h1>
        </div>
        <div className="header-actions">
          <div className="status-chip">
            <span className="dot" />
            {!hasAnyDataset ? 'No data uploaded' : !hasBothDatasets ? 'Upload both datasets' : !hasReconciled ? 'Ready to review' : reconciliation.discrepancies.length ? 'Review required' : 'Healthy'}
          </div>
          <button className="primary-button" onClick={onRunReconciliation} disabled={!hasBothDatasets}>
            <RefreshCw size={16} /> {hasReconciled ? 'Run again' : 'Review & reconcile'}
          </button>
        </div>
      </div>

      <div className="top-metrics">
        <div className="summary-card wide">
          <div>
            <span className="muted-label">Reporting period</span>
            <h3>{reportingPeriod}</h3>
          </div>
          <div>
            <span className="muted-label">Last reconciliation time</span>
            <h3>{lastReconciledAt ? new Date(lastReconciledAt).toLocaleString() : 'N/A'}</h3>
          </div>
          <div>
            <span className="muted-label">Status</span>
            <h3 className={hasReconciled ? reconciliation.discrepancies.length ? 'warn-text' : 'ok-text' : ''}>
              {!hasAnyDataset ? 'N/A' : !hasBothDatasets ? 'Waiting for both datasets' : !hasReconciled ? 'Ready to review' : reconciliation.discrepancies.length ? 'Attention needed' : 'Aligned'}
            </h3>
          </div>
        </div>
      </div>

      <div className="kpi-grid">
        {kpis.map(({ label, value, icon: Icon, color }) => (
          <div className="kpi-card" key={label}>
            <div className={`icon-wrap ${color}`}>
              <Icon size={18} />
            </div>
            <div>
              <div className="kpi-label">{label}</div>
              <div className="kpi-value">{value}</div>
            </div>
          </div>
        ))}
      </div>

      {hasReconciled ? (
      <>
      <div className="chart-grid">
        <div className="panel-card">
          <div className="panel-header">
            <h3>Platform vs Bank Settlement Amount</h3>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dfe7f0" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip formatter={(value) => formatMoneyDisplay(value, currency)} />
                <Legend />
                <Bar dataKey="platform" fill="#4557ff" name="Platform" radius={[8, 8, 0, 0]} />
                <Bar dataKey="bank" fill="#24b47e" name="Bank" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel-card">
          <div className="panel-header">
            <h3>Matched vs Unmatched Transactions</h3>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie dataKey="value" data={[{ name: 'Matched', value: reconciliation.summary.matchedTransactions }, { name: 'Unmatched', value: reconciliation.summary.unmatchedTransactions }]} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4}>
                  {['#24b47e', '#ef4444'].map((entry, index) => (
                    <Cell key={index} fill={entry} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => `${value} items`} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel-card full-span">
          <div className="panel-header">
            <h3>Discrepancies by Category</h3>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={discrepancyChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dfe7f0" />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill="#f59e0b" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel-card full-span">
          <div className="panel-header">
            <h3>Settlement Trends</h3>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="platformArea" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#4557ff" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#4557ff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#dfe7f0" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip formatter={(value) => formatMoneyDisplay(value, currency)} />
                <Area type="monotone" dataKey="platform" stroke="#4557ff" fill="url(#platformArea)" />
                <Line type="monotone" dataKey="bank" stroke="#24b47e" strokeWidth={3} dot={{ r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bottom-grid">
        <div className="panel-card">
          <div className="panel-header">
            <h3>Critical Findings</h3>
          </div>
          <div className="finding-list">
            {criticalFindings.length ? (
              criticalFindings.map((item, index) => (
                <div className="finding-item" key={`${item.category}-${index}`}>
                  <div className={`status-indicator ${item.severity}`}></div>
                  <div>
                    <strong>{item.category}</strong>
                    <p>{item.description}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-state small">No critical issues detected for the selected period.</div>
            )}
          </div>
        </div>

        <div className="panel-card">
          <div className="panel-header">
            <h3>Recent Reconciliation Activity</h3>
          </div>
          <table className="data-table compact">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(reconciliation.activity || []).map((row, index) => (
                <tr key={`${row.time}-${index}`}>
                  <td>{row.time}</td>
                  <td>{row.details}</td>
                  <td>
                    <span className={`chip ${row.severity || 'normal'}`}>{row.severity || 'normal'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </>
      ) : (
        <div className="panel-card review-prompt">
          <div className="review-prompt-mark"><Database size={22} /></div>
          <div>
            <h3>{hasBothDatasets ? 'Your datasets are ready to review' : 'Upload datasets to begin'}</h3>
            <p>{hasBothDatasets
              ? 'Run the reconciliation review to calculate matched transactions, timing items, rounding differences, and exceptions.'
              : 'No reconciliation results or sample transactions are shown until you import your platform and bank CSV files.'}</p>
          </div>
          {hasBothDatasets && <button className="primary-button" onClick={onRunReconciliation}><RefreshCw size={16} /> Review &amp; reconcile</button>}
        </div>
      )}
    </div>
  )
}

function DataManagementPage({ onUpload, platformData, bankData, auditTrail }) {
  return (
    <div className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Data intake</p>
          <h1>Data Management</h1>
        </div>
      </div>

      <div className="upload-grid">
        <UploadPanel title="Platform Transactions" requiredFields={PLATFORM_FIELDS} datasetType="platform" recordCount={platformData.length} onUpload={onUpload} />
        <UploadPanel title="Bank Settlements" requiredFields={BANK_FIELDS} datasetType="bank" recordCount={bankData.length} onUpload={onUpload} />
      </div>

      <div className="panel-card full-span">
        <div className="panel-header">
          <h3>Upload History</h3>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Details</th>
              <th>Timestamp</th>
              <th>Severity</th>
            </tr>
          </thead>
          <tbody>
            {(auditTrail || []).slice(0, 6).map((entry) => (
              <tr key={entry.id || entry.timestamp}>
                <td>{entry.title}</td>
                <td>{entry.details}</td>
                <td>{new Date(entry.timestamp).toLocaleString()}</td>
                <td><span className={`chip ${entry.level || 'info'}`}>{entry.level || 'info'}</span></td>
              </tr>
            ))}
            {!auditTrail?.length && <tr><td colSpan="4"><div className="empty-state">No upload activity yet.</div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function UploadPanel({ title, requiredFields, datasetType, recordCount, onUpload }) {
  const [staged, setStaged] = useState(null)
  const [error, setError] = useState('')
  const [isImporting, setIsImporting] = useState(false)

  const handleFile = async (file) => {
    if (!file) return

    try {
      const text = await file.text()
      const rows = parseCsv(text)
      const validation = validateCsvRows(rows, datasetType)
      if (!rows.length) {
        setStaged(null)
        setError('The CSV is empty or could not be read.')
        return
      }

      setStaged({
        fileName: file.name,
        validRows: validation.validRows,
        invalidRows: validation.invalidRows,
        missingFields: validation.missingFields,
        previewRows: generateCsvPreview(rows.slice(0, 5)),
        totalRows: rows.length,
      })
      setError('')
    } catch (uploadError) {
      console.error(uploadError)
      setError('Unable to parse the CSV file. Please verify the file format and try again.')
    }
  }

  const importDataset = async () => {
    if (!staged?.validRows.length) return
    setIsImporting(true)
    try {
      await onUpload(datasetType, staged.validRows, staged.invalidRows.length)
      setStaged(null)
    } catch (importError) {
      console.error(importError)
      setError('Import could not be completed. Your current dataset was not replaced.')
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div className="panel-card upload-panel">
      <div className="panel-header">
        <h3>{title}</h3>
        <span className="chip info">{recordCount ? `${recordCount} active rows` : '0 active rows'}</span>
      </div>
      <label
        className="upload-dropzone"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          handleFile(event.dataTransfer.files?.[0])
        }}
      >
        <input type="file" accept=".csv,text/csv" onChange={(event) => handleFile(event.target.files?.[0])} />
        <div className="dropzone-inner">
          <FileSpreadsheet size={28} />
          <strong>Drag and drop CSV</strong>
          <span>Browse file</span>
        </div>
      </label>

      <div className="field-list">
        {requiredFields.map((field) => (
          <span key={field} className="field-pill">{field}</span>
        ))}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {staged ? (
        <div className="staged-upload">
          <div className="validation-summary">
            <strong>{staged.fileName}</strong>
            <span className="validation-valid">{staged.validRows.length} valid</span>
            <span className={staged.invalidRows.length ? 'validation-invalid' : 'validation-valid'}>{staged.invalidRows.length} invalid</span>
            <span>{staged.totalRows} total rows</span>
          </div>
          {!!staged.missingFields.length && (
            <div className="error-banner">Missing required columns: {staged.missingFields.join(', ')}</div>
          )}
          {staged.validRows.length > 0 && (
            <button className="primary-button import-button" onClick={importDataset} disabled={isImporting}>
              <Database size={16} /> {isImporting ? 'Importing…' : recordCount ? `Replace with ${staged.validRows.length} valid rows` : `Import ${staged.validRows.length} valid rows`}
            </button>
          )}
          <div className="preview-box">
            {staged.previewRows.length ? (
              <table className="preview-table">
                <thead><tr>{staged.previewRows[0].fields.slice(0, 5).map((field) => <th key={field.key}>{field.key}</th>)}</tr></thead>
                <tbody>
                  {staged.previewRows.map((row) => (
                    <tr key={row.id}>
                      {row.fields.slice(0, 5).map((field) => <td key={`${row.id}-${field.key}`}>{String(field.value ?? '').slice(0, 24)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="empty-state small">No valid preview rows.</div>}
          </div>
          {!!staged.invalidRows.length && (
            <div className="row-errors">
              <strong>Rows needing correction</strong>
              {staged.invalidRows.slice(0, 5).map((item) => (
                <div key={item.rowNumber}>Row {item.rowNumber}: {item.errors.join('; ')}</div>
              ))}
              {staged.invalidRows.length > 5 && <div>And {staged.invalidRows.length - 5} more invalid rows</div>}
            </div>
          )}
        </div>
      ) : (
        <div className="empty-state small">No file selected. Your active dataset will remain unchanged until you confirm an import.</div>
      )}
    </div>
  )
}

function SampleDataPage({ onGenerate }) {
  return (
    <div className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Synthetic test data</p>
          <h1>Sample Data Generator</h1>
        </div>
      </div>

      <div className="panel-card feature-panel">
        <div className="feature-copy">
          <h3>Generate a realistic reconciliation scenario</h3>
          <p>
            Fill the local IndexedDB store with sample platform transactions and bank settlements that intentionally include duplicate entries,
            timing delays, rounding drift, and a refund without a matching original.
          </p>
        </div>
        <button className="primary-button" onClick={onGenerate}>
          <PlusCircle size={16} /> Generate Sample Dataset
        </button>
      </div>
    </div>
  )
}

function ReconciliationPage({ result, onRunReconciliation, hasBothDatasets, hasReconciled, currency }) {
  const categories = result.categories || []

  return (
    <div className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Financial controls</p>
          <h1>Reconciliation</h1>
        </div>
        {hasBothDatasets && <button className="primary-button" onClick={onRunReconciliation}><RefreshCw size={16} /> {hasReconciled ? 'Run again' : 'Review & reconcile'}</button>}
      </div>

      <div className="summary-row">
        <div className="summary-card">
          <span>Platform total</span>
          <strong>{hasReconciled ? formatMoneyDisplay(result.summary.platformTotal, currency) : 'N/A'}</strong>
        </div>
        <div className="summary-card">
          <span>Gross bank payment credits</span>
          <strong>{hasReconciled ? formatMoneyDisplay(result.summary.grossBankCredits, currency) : 'N/A'}</strong>
        </div>
        <div className="summary-card">
          <span>Refund debit</span>
          <strong>{hasReconciled ? formatMoneyDisplay(result.summary.refundDebit, currency) : 'N/A'}</strong>
        </div>
        <div className="summary-card">
          <span>Net bank amount</span>
          <strong>{hasReconciled ? formatMoneyDisplay(result.summary.bankTotal, currency) : 'N/A'}</strong>
        </div>
        <div className="summary-card">
          <span>Aggregate rounding difference</span>
          <strong>{hasReconciled ? formatMoneyDisplay(result.summary.aggregateRoundingDifference, currency) : 'N/A'}</strong>
        </div>
      </div>

      <div className="panel-card full-span">
        <div className="panel-header">
          <h3>Expected reconciliation categories</h3>
          {hasReconciled && <span className="muted-label">{result.summary.platformRecordCount} platform records · {result.summary.bankRecordCount} bank records</span>}
        </div>
        {!hasReconciled ? (
          <div className="empty-state">Import both datasets, then select “Review &amp; reconcile” to calculate results.</div>
        ) : (
          <>
            <div className="category-summary-grid">
              {categories.map((item) => (
                <div className="category-summary" key={item.code}>
                  <span>{item.category}</span>
                  <strong>{item.count}</strong>
                </div>
              ))}
              <div className="category-summary">
                <span>Aggregate rounding exception triggered</span>
                <strong>{result.summary.aggregateRoundingTriggered ? 'Yes' : 'No'}</strong>
              </div>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Code</th>
                  <th>Count</th>
                  <th>Amount / impact</th>
                  <th>Explanation</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((item) => (
                  <tr key={item.code}>
                    <td>{item.category}</td>
                    <td><span className="code-label">{item.code}</span></td>
                    <td>{item.count}</td>
                    <td>{formatMoneyDisplay(item.amount, currency)}{item.difference ? ` · difference ${formatMoneyDisplay(item.difference, currency)}` : ''}</td>
                    <td>{item.description}</td>
                  </tr>
                ))}
                {result.summary.aggregateRoundingTriggered && (
                  <tr>
                    <td>Aggregate rounding exception</td>
                    <td><span className="code-label">AGGREGATE_ROUNDING_DIFFERENCE</span></td>
                    <td>1</td>
                    <td>{formatMoneyDisplay(result.summary.aggregateRoundingDifference, currency)}</td>
                    <td>Combined rounding difference exceeds the configured aggregate tolerance.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}

function DiscrepancyCenterPage({ result, currency }) {
  return (
    <div className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Exception handling</p>
          <h1>Discrepancy Center</h1>
        </div>
      </div>

      {result.discrepancies?.length ? (
        <div className="cards-list">
          {result.discrepancies.map((category, index) => (
            <div className="panel-card discrepancy-card" key={`${category.code}-${index}`}>
              <div className="discrepancy-header">
                <div className={`status-indicator ${category.severity}`}></div>
                <h3>{category.category} <span className="count-badge">{category.count}</span></h3>
              </div>
              <p>{category.description}</p>
              <div className="discrepancy-meta">
                <span>Impact: <strong>{formatMoneyDisplay(category.amount, currency)}</strong></span>
                {category.difference !== undefined && <span>Difference: <strong>{formatMoneyDisplay(category.difference, currency)}</strong></span>}
              </div>
              <div className="exception-list">
                {(category.items || []).map((item, itemIndex) => (
                  <div className="exception-row" key={`${category.code}-${itemIndex}`}>
                    <strong>{item.transactionId || item.id || item.settlementId || 'Aggregate'}</strong>
                    <span>{item.platformDate ? `Platform ${item.platformDate}` : item.platformEntries !== undefined ? `${item.platformEntries} platform / ${item.bankEntries} bank entries` : ''}</span>
                    <span>{item.settlementDate ? `Settled ${item.settlementDate}` : item.settlementIds?.length ? item.settlementIds.join(', ') : ''}</span>
                    <span>{item.platformAmount !== undefined ? `Platform ${formatMoneyDisplay(item.platformAmount, currency)}` : ''}</span>
                    <span>{item.bankAmount !== undefined ? `Bank ${formatMoneyDisplay(item.bankAmount, currency)}` : item.amount !== undefined ? formatMoneyDisplay(item.amount, currency) : ''}</span>
                    <span>{item.difference !== undefined ? `Difference ${formatMoneyDisplay(item.difference, currency)}` : item.duplicateImpact !== undefined ? `Potential duplicate impact ${formatMoneyDisplay(item.duplicateImpact, currency)}` : ''}</span>
                    {item.explanation && <p>{item.explanation}</p>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : <div className="panel-card empty-state">No discrepancy review is available yet. Import both datasets and run a reconciliation.</div>}
    </div>
  )
}

function TransactionExplorerPage({ platformData, bankData, result, currency }) {
  const rows = [
    ...platformData.map((item) => ({ ...item, side: 'Platform' })),
    ...bankData.map((item) => ({ ...item, side: 'Bank' })),
  ]

  return (
    <div className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Record investigations</p>
          <h1>Transaction Explorer</h1>
        </div>
      </div>

      {rows.length ? <div className="panel-card full-span">
        <table className="data-table explorer-table">
          <thead>
            <tr>
              <th>Side</th>
              <th>ID</th>
              <th>Date</th>
              <th>Amount</th>
              <th>Type</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item, index) => (
              <tr key={`${item.side}-${item.transaction_id || item.settlement_id || index}`}>
                <td>{item.side}</td>
                <td>{item.transaction_id || item.settlement_id}</td>
                <td>{toLocalDate(item.transaction_date || item.settlement_date)}</td>
                <td>{formatMoneyDisplay(item.amount ?? item.settlement_amount ?? 0, currency)}</td>
                <td>{item.transaction_type || item.settlement_type || '—'}</td>
                <td>
                  <span className={`chip ${result.discrepancies.length ? 'warning' : 'success'}`}>
                    {result.discrepancies.length ? 'Needs review' : 'Matched'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div> : <div className="panel-card empty-state">No transactions are available. Upload both datasets to explore records.</div>}
    </div>
  )
}

function ReportsPage({ result, currency, hasBothDatasets, hasReconciled }) {
  const handleExportPdf = () => {
    if (!hasReconciled) return
    const doc = new jsPDF()
    doc.setFontSize(18)
    doc.text('ReconAI Reconciliation Summary', 14, 18)
    doc.setFontSize(11)
    doc.text(`Matched Transactions: ${result.summary.matchedTransactions || 0}`, 14, 35)
    doc.text(`Unmatched Transactions: ${result.summary.unmatchedTransactions || 0}`, 14, 45)
    doc.text(`Gross bank credits: ${formatMoneyDisplay(result.summary.grossBankCredits, currency)}`, 14, 45)
    doc.text(`Refund debit: ${formatMoneyDisplay(result.summary.refundDebit, currency)}`, 14, 55)
    doc.text(`Net bank amount: ${formatMoneyDisplay(result.summary.bankTotal, currency)}`, 14, 65)
    doc.text(`Aggregate rounding difference: ${formatMoneyDisplay(result.summary.aggregateRoundingDifference, currency)}`, 14, 75)
    doc.text(`Success Rate: ${result.summary.successRate || 0}%`, 14, 85)
    doc.text('Key issues:', 14, 100)
    result.discrepancies.forEach((item, index) => {
      doc.text(`${index + 1}. ${item.category}: ${formatMoneyDisplay(item.amount || 0, currency)}`, 18, 110 + index * 10)
    })
    doc.save('reconai-report.pdf')
  }

  return (
    <div className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Reporting</p>
          <h1>Reports</h1>
        </div>
        <button className="primary-button" onClick={handleExportPdf} disabled={!hasReconciled}><Download size={16} /> Export PDF</button>
      </div>

      <div className="summary-row">
        <div className="summary-card">
          <span>Success rate</span>
          <strong>{hasReconciled ? `${result.summary.successRate ?? 0}%` : 'N/A'}</strong>
        </div>
        <div className="summary-card">
          <span>Platform records</span>
          <strong>{hasBothDatasets ? result.summary.platformRecordCount ?? 'N/A' : '0'}</strong>
        </div>
        <div className="summary-card">
          <span>Bank records</span>
          <strong>{hasBothDatasets ? result.summary.bankRecordCount ?? 'N/A' : '0'}</strong>
        </div>
        <div className="summary-card">
          <span>Platform transaction total</span>
          <strong>{hasReconciled ? formatMoneyDisplay(result.summary.platformTotal, currency) : 'N/A'}</strong>
        </div>
        <div className="summary-card">
          <span>Gross bank payment credits</span>
          <strong>{hasReconciled ? formatMoneyDisplay(result.summary.grossBankCredits, currency) : 'N/A'}</strong>
        </div>
        <div className="summary-card">
          <span>Refund debit</span>
          <strong>{hasReconciled ? formatMoneyDisplay(result.summary.refundDebit, currency) : 'N/A'}</strong>
        </div>
        <div className="summary-card">
          <span>Net bank amount</span>
          <strong>{hasReconciled ? formatMoneyDisplay(result.summary.bankTotal, currency) : 'N/A'}</strong>
        </div>
        <div className="summary-card">
          <span>Aggregate rounding difference</span>
          <strong>{hasReconciled ? formatMoneyDisplay(result.summary.aggregateRoundingDifference, currency) : 'N/A'}</strong>
        </div>
      </div>
      {!hasReconciled && <div className="panel-card empty-state">Reports will be populated after both datasets are imported and reviewed.</div>}
      {hasReconciled && (
        <div className="panel-card">
          <div className="panel-header"><h3>Reconciliation category counts</h3></div>
          <table className="data-table">
            <thead><tr><th>Category</th><th>Code</th><th>Count</th><th>Amount / impact</th></tr></thead>
            <tbody>{(result.categories || []).map((item) => (
              <tr key={item.code}>
                <td>{item.category}</td><td>{item.code}</td><td>{item.count}</td>
                <td>{formatMoneyDisplay(item.amount, currency)}{item.difference ? ` (difference ${formatMoneyDisplay(item.difference, currency)})` : ''}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function AuditTrailPage({ auditTrail }) {
  return (
    <div className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Transparency</p>
          <h1>Audit Trail</h1>
        </div>
      </div>

      <div className="panel-card full-span">
        <table className="data-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Details</th>
              <th>Time</th>
              <th>Level</th>
            </tr>
          </thead>
          <tbody>
            {(auditTrail || []).map((item) => (
              <tr key={item.id || item.timestamp}>
                <td>{item.title}</td>
                <td>{item.details}</td>
                <td>{new Date(item.timestamp).toLocaleString()}</td>
                <td><span className={`chip ${item.level || 'info'}`}>{item.level || 'info'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SettingsPage({
  reportingPeriod,
  onPeriodChange,
  onSettingsChange,
  theme,
  onThemeToggle,
  currency,
  onCurrencyChange,
  individualTolerance,
  onIndividualToleranceChange,
  aggregateTolerance,
  onAggregateToleranceChange,
  expectedDelayDays,
  onExpectedDelayDaysChange,
}) {
  return (
    <div className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Configuration</p>
          <h1>Settings</h1>
        </div>
      </div>

      <div className="settings-grid">
        <div className="panel-card settings-card">
          <h3>Reporting preference</h3>
          <label>
            Reporting period
            <select value={reportingPeriod} onChange={(event) => {
              onPeriodChange(event.target.value)
              onSettingsChange()
            }}>
              <option>October 2026</option>
              <option>November 2026</option>
              <option>Q4 2026</option>
              <option>Annual 2026</option>
            </select>
          </label>
          <label>
            Currency
            <select value={currency} onChange={(event) => {
              onCurrencyChange(event.target.value)
              onSettingsChange()
            }}>
              <option value="INR">INR — Indian Rupee</option>
              <option value="USD">USD — US Dollar</option>
              <option value="EUR">EUR — Euro</option>
              <option value="GBP">GBP — Pound Sterling</option>
            </select>
          </label>
          <label>
            Individual rounding tolerance
            <input type="number" min="0" step="0.01" value={individualTolerance} onChange={(event) => {
              onIndividualToleranceChange(Number(event.target.value))
              onSettingsChange()
            }} />
          </label>
          <label>
            Aggregate rounding tolerance
            <input type="number" min="0" step="0.01" value={aggregateTolerance} onChange={(event) => {
              onAggregateToleranceChange(Number(event.target.value))
              onSettingsChange()
            }} />
          </label>
          <label>
            Expected settlement delay (days)
            <input type="number" min="0" step="1" value={expectedDelayDays} onChange={(event) => {
              onExpectedDelayDaysChange(Number(event.target.value))
              onSettingsChange()
            }} />
          </label>
        </div>

        <div className="panel-card settings-card">
          <h3>Appearance</h3>
          <button className="secondary-button" onClick={onThemeToggle}>{theme === 'light' ? 'Enable dark mode' : 'Enable light mode'}</button>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  )
}

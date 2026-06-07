// src/App.jsx  –  Solar Designer v1.0
// ═══════════════════════════════════════════════════════════
//  DATA FLOW (no Claude API, no AI, no paid services)
//
//  User types location name
//       ↓
//  OpenStreetMap Nominatim  →  Lat / Lon
//       ↓
//  PVGIS (EU Joint Research Centre)  →  Monthly solar data
//       ↓  (if PVGIS fails)
//  NASA POWER API  →  Monthly solar data
//       ↓  (if NASA also fails)
//  Latitude formula  →  Estimated solar data
//       ↓
//  All calculations done locally — traditional EE method
// ═══════════════════════════════════════════════════════════

import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { APPLIANCES, runCalculations } from './data.js'

const MONTHS     = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_KEYS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']

// ───────────────────────────────────────────────────────────
// UTILITY: fetch with manual timeout (works in all browsers)
// ───────────────────────────────────────────────────────────
function fetchWithTimeout(url, options = {}, ms = 12000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer))
}

// ───────────────────────────────────────────────────────────
// STEP 1 — GEOCODING
// OpenStreetMap Nominatim: location name → lat/lon
// Free, no API key, CORS enabled
// ───────────────────────────────────────────────────────────
async function geocodeLocation(query) {
  const url =
    `https://nominatim.openstreetmap.org/search` +
    `?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1`

  const res = await fetchWithTimeout(url, {
    headers: {
      'Accept-Language': 'en-US,en',
      'User-Agent': 'SolarDesignerApp/1.0',
    },
  }, 10000)

  if (!res.ok) throw new Error(`Geocoding failed (${res.status}). Check your internet.`)

  const data = await res.json()
  if (!data || !data.length) throw new Error('Location not found. Try a nearby city or district name.')

  const r = data[0]
  const a = r.address || {}
  const parts = [
    a.city || a.town || a.village || a.hamlet || a.county,
    a.state,
    a.country,
  ].filter(Boolean)

  return {
    lat:  parseFloat(r.lat),
    lon:  parseFloat(r.lon),
    name: parts.length ? parts.join(', ') : r.display_name,
  }
}

// ───────────────────────────────────────────────────────────
// STEP 2A — SOLAR DATA via PVGIS
// EU Joint Research Centre: lat/lon → monthly irradiance
// Free, no API key, CORS enabled
// Returns peak sun hours (PSH) = H(h) in Wh/m²/day ÷ 1000
// ───────────────────────────────────────────────────────────
async function fetchFromPVGIS(lat, lon) {
  const params = new URLSearchParams({
    lat:       lat.toFixed(4),
    lon:       lon.toFixed(4),
    startyear: '2005',
    endyear:   '2020',
    horirrad:  '1',
    mr_dni:    '0',
    d2g:       '0',
    localtime: '0',
    format:    'JSON',
  })

  const url = `https://re.jrc.ec.europa.eu/api/v5_2/MRcalc?${params.toString()}`
  const res = await fetchWithTimeout(url, {}, 12000)

  if (!res.ok) throw new Error(`PVGIS returned HTTP ${res.status}`)

  const data = await res.json()

  // Validate response shape
  if (!data?.outputs?.monthly || !Array.isArray(data.outputs.monthly))
    throw new Error('PVGIS response format unexpected')
  if (data.outputs.monthly.length !== 12)
    throw new Error('PVGIS returned incomplete monthly data')

  const raw = data.outputs.monthly

  // H(h) = global horizontal irradiance in Wh/m²/day
  // Dividing by 1000 converts to kWh/m²/day = Peak Sun Hours
  const monthly_psh = {}
  MONTHS.forEach((m, i) => {
    const val = raw[i]?.['H(h)']
    if (val == null) throw new Error('Missing H(h) field in PVGIS response')
    monthly_psh[m] = parseFloat((val / 1000).toFixed(2))
  })

  const annual_psh = parseFloat(
    (Object.values(monthly_psh).reduce((a, b) => a + b, 0) / 12).toFixed(2)
  )

  return buildSolarResult(lat, monthly_psh, annual_psh, false)
}

// ───────────────────────────────────────────────────────────
// STEP 2B — SOLAR DATA via NASA POWER (fallback)
// NASA Langley Research Center: lat/lon → climatology
// Free, no API key, CORS enabled
// ───────────────────────────────────────────────────────────
async function fetchFromNASA(lat, lon) {
  const url =
    `https://power.larc.nasa.gov/api/temporal/climatology/point` +
    `?parameters=ALLSKY_SFC_SW_DWN&community=RE` +
    `&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}&format=JSON`

  const res = await fetchWithTimeout(url, {}, 15000)

  if (!res.ok) throw new Error(`NASA POWER returned HTTP ${res.status}`)

  const data = await res.json()

  const param = data?.properties?.parameter?.ALLSKY_SFC_SW_DWN
  if (!param) throw new Error('NASA POWER response format unexpected')

  const monthly_psh = {}
  MONTHS.forEach((m, i) => {
    const val = param[MONTH_KEYS[i]]
    monthly_psh[m] = parseFloat((val || 0).toFixed(2))
  })

  const annual_psh = parseFloat(
    (param['ANN'] || Object.values(monthly_psh).reduce((a, b) => a + b, 0) / 12).toFixed(2)
  )

  return buildSolarResult(lat, monthly_psh, annual_psh, false)
}

// ───────────────────────────────────────────────────────────
// STEP 2C — LATITUDE ESTIMATE (last resort, no API)
// ───────────────────────────────────────────────────────────
function estimateFromLatitude(lat) {
  const a = Math.abs(lat)
  const base =
    a < 10 ? 5.0 : a < 15 ? 5.3 : a < 20 ? 5.6 :
    a < 25 ? 5.4 : a < 30 ? 5.0 : a < 35 ? 4.5 :
    a < 40 ? 4.0 : a < 50 ? 3.4 : 2.8

  // Sinusoidal monthly variation based on hemisphere
  const hemisphere = lat >= 0 ? 1 : -1
  const monthly_psh = {}
  MONTHS.forEach((m, i) => {
    // months 0–11, peak in summer (Jun for north, Dec for south)
    const angle = ((i - 5) * hemisphere * Math.PI) / 6
    monthly_psh[m] = parseFloat(Math.max(1.5, base + Math.sin(angle) * base * 0.25).toFixed(2))
  })

  const annual_psh = parseFloat(
    (Object.values(monthly_psh).reduce((a, b) => a + b, 0) / 12).toFixed(2)
  )

  return buildSolarResult(lat, monthly_psh, annual_psh, true)
}

// ───────────────────────────────────────────────────────────
// BUILD SOLAR RESULT: shared shape for all three sources
// ───────────────────────────────────────────────────────────
function buildSolarResult(lat, monthly_psh, annual_psh, isFallback) {
  const absLat = Math.abs(lat)
  return {
    monthly_psh,
    annual_psh,
    isFallback,
    optimal_tilt: Math.round(absLat * 0.87 + 3.1),
    summer_tilt:  Math.max(5, Math.round(absLat - 15)),
    winter_tilt:  Math.round(absLat + 15),
    facing:       lat >= 0 ? 'True South (180°)' : 'True North (0°)',
  }
}

// ───────────────────────────────────────────────────────────
// MAIN SOLAR FETCH ORCHESTRATOR
// Tries PVGIS → NASA POWER → Lat estimate
// ───────────────────────────────────────────────────────────
async function getSolarData(lat, lon) {
  try {
    return await fetchFromPVGIS(lat, lon)
  } catch (pvgisErr) {
    console.warn('PVGIS failed, trying NASA POWER:', pvgisErr.message)
    try {
      return await fetchFromNASA(lat, lon)
    } catch (nasaErr) {
      console.warn('NASA POWER failed, using latitude estimate:', nasaErr.message)
      return estimateFromLatitude(lat)
    }
  }
}

// ───────────────────────────────────────────────────────────
// REVERSE GEOCODE (GPS → location name)
// ───────────────────────────────────────────────────────────
async function reverseGeocode(lat, lon) {
  const url =
    `https://nominatim.openstreetmap.org/reverse` +
    `?lat=${lat}&lon=${lon}&format=json`
  try {
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'SolarDesignerApp/1.0' } }, 8000)
    const d = await res.json()
    const a = d.address || {}
    const parts = [
      a.city || a.town || a.village || a.hamlet || a.county,
      a.state, a.country,
    ].filter(Boolean)
    return parts.length ? parts.join(', ') : `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`
  } catch {
    return `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`
  }
}

// ═══════════════════════════════════════════════════════════
// DESIGN TOKENS
// ═══════════════════════════════════════════════════════════
const C = {
  bg: '#080812', card: '#111827', border: '#1e293b', border2: '#0f172a',
  primary: '#f59e0b', green: '#10b981', blue: '#38bdf8', purple: '#a78bfa',
  text: '#e2e8f0', muted: '#475569', dim: '#334155',
}
const cardSt  = (x = {}) => ({ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, ...x })
const lblSt   = (x = {}) => ({ color: C.muted, fontSize: 10, letterSpacing: '0.13em', display: 'block', marginBottom: 6, ...x })
const btnSt   = (v = 'primary', x = {}) => ({
  border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 600,
  fontSize: 15, padding: '13px 20px', fontFamily: 'inherit', transition: 'opacity 0.15s',
  ...(v === 'primary'
    ? { background: `linear-gradient(135deg,${C.primary},#d97706)`, color: '#000', boxShadow: `0 4px 16px ${C.primary}33` }
    : v === 'ghost'
    ? { background: 'transparent', color: C.muted, border: `1px solid ${C.border}` }
    : { background: '#1e293b', color: C.text }),
  ...x,
})

const fmtINR   = n => '₹' + Math.round(n).toLocaleString('en-IN')
const fmtRange = (lo, hi) => `${fmtINR(lo)} – ${fmtINR(hi)}`

// ═══════════════════════════════════════════════════════════
// STEP BAR
// ═══════════════════════════════════════════════════════════
const STEP_LABELS = ['Location', 'Appliances', 'System', 'Report']

function StepBar({ current }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 28, width: '100%' }}>
      {STEP_LABELS.map((lbl, i) => {
        const n = i + 1
        const done = n < current
        const act  = n === current
        return (
          <div key={lbl} style={{ display: 'flex', alignItems: 'center', flex: i < STEP_LABELS.length - 1 ? 1 : 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: 12, transition: 'all 0.3s',
                background: done ? C.green : act ? C.primary : C.border,
                color:      done || act ? '#000' : C.dim,
                boxShadow:  act ? `0 0 12px ${C.primary}66` : 'none',
              }}>{done ? '✓' : n}</div>
              <span style={{ fontSize: 9, marginTop: 4, letterSpacing: '0.1em', color: act ? C.primary : done ? C.green : C.dim }}>
                {lbl.toUpperCase()}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div style={{ flex: 1, height: 2, margin: '0 4px', marginBottom: 16, background: done ? C.green : C.border, transition: 'background 0.3s' }}/>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// STEP 1 — LOCATION
// ═══════════════════════════════════════════════════════════
function StepLocation({ onNext }) {
  const [query,   setQuery]   = useState('')
  const [loading, setLoading] = useState(false)
  const [status,  setStatus]  = useState('')
  const [error,   setError]   = useState('')

  // Common: once we have lat/lon, fetch solar data and proceed
  const proceed = async (lat, lon, name) => {
    setStatus('Getting solar data…')
    const solar = await getSolarData(lat, lon)   // PVGIS → NASA → estimate
    onNext({ lat, lon, name, solar })
  }

  const handleSearch = async () => {
    if (!query.trim()) return
    setLoading(true); setError(''); setStatus('Finding location…')
    try {
      const geo = await geocodeLocation(query.trim())
      await proceed(geo.lat, geo.lon, geo.name)
    } catch (e) {
      setError(e.message)
    } finally { setLoading(false); setStatus('') }
  }

  const handleGPS = () => {
    if (!navigator.geolocation) { setError('GPS not available on this device.'); return }
    setLoading(true); setError(''); setStatus('Getting GPS location…')
    navigator.geolocation.getCurrentPosition(
      async pos => {
        try {
          const { latitude: lat, longitude: lon } = pos.coords
          setStatus('Looking up location name…')
          const name = await reverseGeocode(lat, lon)
          await proceed(lat, lon, name)
        } catch (e) {
          setError('Could not get location. Try typing your city instead.')
        } finally { setLoading(false); setStatus('') }
      },
      err => {
        setLoading(false); setStatus('')
        setError(
          err.code === 1 ? 'Location access denied. Please type your city name.'
          : 'GPS failed. Try typing your city instead.'
        )
      },
      { timeout: 10000, maximumAge: 60000 }
    )
  }

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ fontSize: 44, marginBottom: 10 }}>☀️</div>
        <h2 style={{ color: C.primary, fontSize: 22, fontWeight: 700, margin: 0 }}>Where is your site?</h2>
        <p style={{ color: C.muted, fontSize: 13, marginTop: 8, lineHeight: 1.6 }}>
          Solar data is fetched from PVGIS (EU) or NASA POWER — free, no account needed
        </p>
      </div>

      <div style={{ marginBottom: 12 }}>
        <span style={lblSt()}>CITY / TOWN / ADDRESS</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && handleSearch()}
            placeholder="e.g. Hyderabad, Mumbai, Chennai, Dubai…"
            disabled={loading}
            style={{
              flex: 1, background: '#1a2236', border: `1px solid ${C.border}`,
              borderRadius: 10, padding: '13px 16px', color: C.text,
              fontSize: 15, outline: 'none', fontFamily: 'inherit',
              opacity: loading ? 0.6 : 1,
            }}
          />
          <button
            onClick={handleSearch}
            disabled={loading}
            style={btnSt('primary', { padding: '13px 18px', opacity: loading ? 0.6 : 1 })}
          >
            {loading ? '…' : 'Search'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0' }}>
        <div style={{ flex: 1, height: 1, background: C.border }}/>
        <span style={{ color: C.dim, fontSize: 11 }}>OR</span>
        <div style={{ flex: 1, height: 1, background: C.border }}/>
      </div>

      <button
        onClick={handleGPS}
        disabled={loading}
        style={btnSt('secondary', {
          width: '100%', display: 'flex', alignItems: 'center',
          justifyContent: 'center', gap: 8, opacity: loading ? 0.6 : 1,
        })}
      >
        📍 Use My Current Location (GPS)
      </button>

      {loading && (
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            border: `3px solid ${C.primary}33`, borderTop: `3px solid ${C.primary}`,
            margin: '0 auto 10px', animation: 'spin 0.8s linear infinite',
          }}/>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>{status}</p>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 14, padding: '12px 16px', background: '#7f1d1d22', border: '1px solid #7f1d1d55', borderRadius: 8, color: '#fca5a5', fontSize: 13 }}>
          ⚠️ {error}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// STEP 2 — APPLIANCES
// ═══════════════════════════════════════════════════════════
function StepAppliances({ onNext, onBack, saved }) {
  const [sel, setSel] = useState(saved || {})
  const inc = id => setSel(p => ({ ...p, [id]: (p[id] || 0) + 1 }))
  const dec = id => setSel(p => ({ ...p, [id]: Math.max(0, (p[id] || 0) - 1) }))

  const totalW   = APPLIANCES.reduce((s, a) => s + (sel[a.id] || 0) * a.watts, 0)
  const totalSel = Object.values(sel).reduce((s, v) => s + v, 0)
  const cats     = [...new Set(APPLIANCES.map(a => a.category))]

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 44, marginBottom: 10 }}>🔌</div>
        <h2 style={{ color: C.primary, fontSize: 22, fontWeight: 700, margin: 0 }}>What will you power?</h2>
        <p style={{ color: C.muted, fontSize: 13, marginTop: 8 }}>Add all appliances you want on solar</p>
      </div>

      {/* Live load indicator */}
      <div style={cardSt({ background: '#0a1a0a', border: '1px solid #14532d44', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', marginBottom: 20 })}>
        <div>
          <span style={lblSt({ color: '#6ee7b7' })}>SELECTED</span>
          <div style={{ color: C.text, fontWeight: 700, fontSize: 18 }}>{totalSel} items</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={lblSt({ color: '#6ee7b7' })}>CONNECTED LOAD</span>
          <div style={{ color: C.primary, fontWeight: 700, fontSize: 24, fontFamily: 'monospace' }}>
            {(totalW / 1000).toFixed(2)} kW
          </div>
        </div>
      </div>

      {cats.map(cat => (
        <div key={cat} style={{ marginBottom: 16 }}>
          <div style={{ color: C.dim, fontSize: 10, letterSpacing: '0.13em', marginBottom: 6, paddingLeft: 2 }}>
            {cat.toUpperCase()}
          </div>
          <div style={cardSt({ padding: 0, overflow: 'hidden' })}>
            {APPLIANCES.filter(a => a.category === cat).map((a, i, arr) => {
              const qty = sel[a.id] || 0
              return (
                <div key={a.id} style={{
                  display: 'flex', alignItems: 'center', padding: '11px 14px',
                  borderBottom: i < arr.length - 1 ? `1px solid ${C.border2}` : 'none',
                  background: qty > 0 ? '#0a140a' : 'transparent', transition: 'background 0.2s',
                }}>
                  <span style={{ fontSize: 19, marginRight: 10, flexShrink: 0 }}>{a.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: qty > 0 ? C.text : '#94a3b8', fontSize: 14, fontWeight: qty > 0 ? 600 : 400 }}>
                      {a.name}
                    </div>
                    <div style={{ color: C.dim, fontSize: 10, marginTop: 1 }}>{a.watts}W · {a.hours}h/day std.</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <button onClick={() => dec(a.id)} style={{
                      width: 28, height: 28, borderRadius: 7, border: 'none', cursor: 'pointer',
                      fontSize: 17, fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: qty > 0 ? '#7c2d12' : C.border,
                      color:      qty > 0 ? '#fca5a5' : C.dim,
                    }}>−</button>
                    <span style={{ minWidth: 18, textAlign: 'center', color: qty > 0 ? C.primary : C.muted, fontWeight: 700, fontSize: 15, fontFamily: 'monospace' }}>
                      {qty}
                    </span>
                    <button onClick={() => inc(a.id)} style={{
                      width: 28, height: 28, borderRadius: 7, border: 'none', cursor: 'pointer',
                      fontSize: 17, fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: '#14532d', color: '#6ee7b7',
                    }}>+</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onBack} style={btnSt('ghost', { flex: 1 })}>← Back</button>
        <button
          onClick={() => onNext(sel)}
          disabled={totalW === 0}
          style={btnSt('primary', { flex: 2, opacity: totalW === 0 ? 0.5 : 1 })}
        >
          {totalW === 0 ? 'Select at least one appliance' : 'Next: System Type →'}
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// STEP 3 — SYSTEM TYPE
// ═══════════════════════════════════════════════════════════
function StepSystemType({ onNext, onBack }) {
  const [chosen, setChosen] = useState(null)

  const opts = [
    {
      id: 'offgrid', icon: '🔋', title: 'Off-Grid', color: C.primary,
      sub: 'Fully independent. No electricity bill. Batteries store power for night use.',
      pros: ['No electricity bill', 'Works during grid failures', 'Ideal for remote areas', 'Full energy independence'],
    },
    {
      id: 'ongrid', icon: '⚡', title: 'On-Grid', color: C.blue,
      sub: 'Connected to DISCOM. Earn net-metering credits. Lower upfront cost.',
      pros: ['Lower upfront cost', 'Net metering credits', 'No battery needed', 'Best for urban homes'],
    },
  ]

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 44, marginBottom: 10 }}>⚙️</div>
        <h2 style={{ color: C.primary, fontSize: 22, fontWeight: 700, margin: 0 }}>What kind of system?</h2>
        <p style={{ color: C.muted, fontSize: 13, marginTop: 8 }}>Choose based on your power situation and goals</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
        {opts.map(o => (
          <div
            key={o.id}
            onClick={() => setChosen(o.id)}
            style={{
              ...cardSt(),
              border: `2px solid ${chosen === o.id ? o.color : C.border}`,
              background: chosen === o.id ? o.color + '11' : C.card,
              cursor: 'pointer', transition: 'all 0.2s',
              boxShadow: chosen === o.id ? `0 0 20px ${o.color}22` : 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
              <span style={{ fontSize: 32, flexShrink: 0 }}>{o.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ color: chosen === o.id ? o.color : C.text, fontWeight: 700, fontSize: 18 }}>{o.title}</div>
                <div style={{ color: C.muted, fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>{o.sub}</div>
              </div>
              {chosen === o.id && (
                <div style={{ width: 22, height: 22, borderRadius: '50%', background: o.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000', fontWeight: 900, fontSize: 13, flexShrink: 0 }}>✓</div>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {o.pros.map(p => (
                <span key={p} style={{ background: '#1a2236', color: '#94a3b8', borderRadius: 5, padding: '2px 8px', fontSize: 11 }}>✓ {p}</span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onBack} style={btnSt('ghost', { flex: 1 })}>← Back</button>
        <button onClick={() => chosen && onNext(chosen)} disabled={!chosen} style={btnSt('primary', { flex: 2, opacity: !chosen ? 0.5 : 1 })}>
          Next →
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// STEP 4 — BACKUP HOURS (off-grid only)
// ═══════════════════════════════════════════════════════════
function StepBackupHours({ onNext, onBack }) {
  const [hours, setHours] = useState(6)
  const note =
    hours <= 4 ? 'Short — essential loads only' :
    hours <= 8 ? 'Standard — recommended for homes' :
                 'Extended — critical or commercial use'

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 44, marginBottom: 10 }}>🔋</div>
        <h2 style={{ color: C.primary, fontSize: 22, fontWeight: 700, margin: 0 }}>How many hours of backup?</h2>
        <p style={{ color: C.muted, fontSize: 13, marginTop: 8 }}>
          How long should batteries last at night or on cloudy days?
        </p>
      </div>

      <div style={cardSt({ background: '#0a1428', border: '1px solid #1e3a5f', textAlign: 'center', padding: '28px 20px', marginBottom: 20 })}>
        <div style={{ fontSize: 60, fontWeight: 900, color: C.primary, fontFamily: 'monospace', lineHeight: 1 }}>{hours}h</div>
        <div style={{ color: C.muted, fontSize: 13, marginTop: 8 }}>{note}</div>
      </div>

      <div style={{ padding: '0 4px', marginBottom: 10 }}>
        <input type="range" min={2} max={12} step={1} value={hours} onChange={e => setHours(+e.target.value)}/>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        {[2, 4, 6, 8, 10, 12].map(m => (
          <span key={m} style={{ fontSize: 11, color: m === hours ? C.primary : C.dim, fontWeight: m === hours ? 700 : 400 }}>{m}h</span>
        ))}
      </div>

      <div style={cardSt({ background: '#0a150a', border: '1px solid #14532d44', display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 16px', marginBottom: 20 })}>
        <span>💡</span>
        <p style={{ margin: 0, color: '#86efac', fontSize: 13, lineHeight: 1.6 }}>
          <strong>Recommended: 6–8 hours</strong> for standard homes. Choose 10–12 hours for medical equipment or critical loads.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onBack} style={btnSt('ghost', { flex: 1 })}>← Back</button>
        <button onClick={() => onNext(hours)} style={btnSt('primary', { flex: 2 })}>Calculate My System →</button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// CALCULATIONS MODAL
// ═══════════════════════════════════════════════════════════
function CalcModal({ r, onClose }) {
  const sec = t => (
    <div style={{ color: C.primary, fontSize: 11, letterSpacing: '0.12em', margin: '22px 0 10px', paddingBottom: 6, borderBottom: `1px solid ${C.border}` }}>{t}</div>
  )
  const box = t => (
    <div style={{ background: '#0a0f1a', border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', margin: '8px 0 14px', fontFamily: 'monospace', color: '#7dd3fc', fontSize: 12, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{t}</div>
  )
  const row = (l, v, n) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0', borderBottom: `1px solid ${C.border2}` }}>
      <span style={{ color: '#94a3b8', fontSize: 13, flex: 1 }}>{l}</span>
      <span style={{ color: C.text, fontFamily: 'monospace', fontWeight: 600, fontSize: 14, marginLeft: 12 }}>{v}</span>
      {n && <span style={{ color: C.dim, fontSize: 11, marginLeft: 8, textAlign: 'right', maxWidth: 130 }}>{n}</span>}
    </div>
  )

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: '#000b', zIndex: 999, display: 'flex', alignItems: 'flex-end', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: '#0d1117', border: `1px solid ${C.border}`, borderRadius: '18px 18px 0 0', width: '100%', maxWidth: 520, margin: '0 auto', maxHeight: '90vh', overflowY: 'auto', padding: '24px 18px 40px' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ color: C.primary, fontWeight: 700, fontSize: 17 }}>📐 Step-by-Step Calculations</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 26, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {sec('STEP 1 — LOAD SCHEDULE')}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                {['Appliance', 'Qty', 'Watts', 'Load W', 'Hrs/day', 'Wh/day'].map(h => (
                  <td key={h} style={{ padding: '4px 6px', color: C.muted, fontSize: 10, letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}` }}>{h}</td>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.loadList.map(a => (
                <tr key={a.id}>
                  <td style={{ padding: '5px 6px', color: C.text }}>{a.icon} {a.name}</td>
                  <td style={{ padding: '5px 6px', color: C.muted, textAlign: 'center' }}>{a.qty}</td>
                  <td style={{ padding: '5px 6px', color: C.muted, textAlign: 'right' }}>{a.watts}</td>
                  <td style={{ padding: '5px 6px', color: C.primary, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{a.load_W}</td>
                  <td style={{ padding: '5px 6px', color: C.muted, textAlign: 'center' }}>{a.hours}</td>
                  <td style={{ padding: '5px 6px', color: '#7dd3fc', textAlign: 'right', fontFamily: 'monospace' }}>{a.daily_Wh.toFixed(0)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: `2px solid ${C.border}` }}>
                <td colSpan={3} style={{ padding: '7px 6px', color: C.primary, fontWeight: 700, fontSize: 13 }}>TOTAL</td>
                <td style={{ padding: '7px 6px', color: C.primary, fontWeight: 700, fontFamily: 'monospace', textAlign: 'right' }}>{r.totalLoad_W} W</td>
                <td/>
                <td style={{ padding: '7px 6px', color: '#7dd3fc', fontWeight: 700, fontFamily: 'monospace', textAlign: 'right' }}>{r.dailyEnergy_Wh.toFixed(0)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {sec('STEP 2 — DESIGN ENERGY')}
        {box(
`Daily Energy Consumption
  = ${r.dailyEnergy_Wh.toFixed(0)} Wh = ${r.dailyEnergy_kWh.toFixed(3)} kWh/day

System Loss Factor = ${r.lossFactorPct}%
  (Cable losses + Dust + Temperature derating)

Design Energy = ${r.dailyEnergy_kWh.toFixed(3)} × ${r.lossFactor}
              = ${r.designEnergy_kWh.toFixed(3)} kWh/day`
        )}

        {sec('STEP 3 — SOLAR PANEL SIZING')}
        {box(
`Peak Sun Hours (PSH)  = ${r.psh} kWh/m²/day
  Source: ${r.solarData.isFallback ? 'Latitude-based estimate' : 'PVGIS / NASA POWER'}

System Efficiency (η) = ${(r.sysEff * 100).toFixed(0)}%
  Inverter(96%) × Wiring(90%) × Mismatch(89%)

Required kWp = Design Energy ÷ (PSH × η)
             = ${r.designEnergy_kWh.toFixed(3)} ÷ (${r.psh} × ${r.sysEff})
             = ${r.solarCap_kWp.toFixed(3)} kWp

Panel rating = ${r.panelWp} Wp (monocrystalline PERC)

No. of Panels = ⌈${r.solarCap_kWp.toFixed(3)} × 1000 ÷ ${r.panelWp}⌉
              = ⌈${(r.solarCap_kWp * 1000 / r.panelWp).toFixed(2)}⌉
              = ${r.numPanels} panels

Actual capacity = ${r.numPanels} × ${r.panelWp} W = ${r.actualCap_kWp.toFixed(2)} kWp`
        )}

        {sec('STEP 4 — INVERTER SIZING')}
        {box(
`Total Connected Load  = ${r.totalLoad_W} W
Surge/Starting Factor = 1.25

Required VA = ${r.totalLoad_W} × 1.25
            = ${r.inverterRequired_VA.toFixed(0)} VA

Selected Rating = ${r.inverterRating_VA} VA
  (next standard size above ${Math.ceil(r.inverterRequired_VA)} VA)`
        )}

        {r.battery && (<>
          {sec('STEP 5 — BATTERY BANK SIZING')}
          {box(
`Backup required   = ${r.backupHours} hours
Total Load        = ${r.totalLoad_W} W

Backup Energy = ${r.totalLoad_W} × ${r.backupHours}
              = ${r.battery.backupEnergy_Wh.toFixed(0)} Wh

Battery Type  = Lithium-Ion (Li-FePO4) with warranty
DoD           = ${(r.battery.dod * 100).toFixed(0)}%
System V      = ${r.battery.vSys}V DC

Required Ah = Backup Energy ÷ (V × DoD)
            = ${r.battery.backupEnergy_Wh.toFixed(0)} ÷ (${r.battery.vSys} × ${r.battery.dod})
            = ${r.battery.reqAh} Ah

Battery unit  = ${r.battery.unitAh}Ah
No. of units  = ⌈${r.battery.reqAh} ÷ ${r.battery.unitAh}⌉ = ${r.battery.numBatts}`
          )}
        </>)}

        {sec(`STEP ${r.battery ? 6 : 5} — BUDGET ESTIMATE`)}
        {row('Solar Panels', fmtRange(r.costs.panelMin, r.costs.panelMax), `${r.numPanels} × 400Wp panels`)}
        {row('Inverter',     fmtRange(r.costs.invMin,   r.costs.invMax),   `${r.inverterRating_VA} VA`)}
        {r.battery && row('Battery Bank', fmtRange(r.costs.battMin, r.costs.battMax), `${r.battery.numBatts} × 200Ah Li-ion`)}
        {row('Installation', fmtRange(r.costs.instMin, r.costs.instMax), 'Civil, wiring, mounting (15%)')}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', color: C.primary, fontWeight: 700, fontSize: 15 }}>
          <span>TOTAL ESTIMATE</span>
          <span style={{ fontFamily: 'monospace' }}>{fmtRange(r.costs.totalMin, r.costs.totalMax)}</span>
        </div>
        <div style={{ background: C.border2, borderRadius: 8, padding: '10px 12px', color: C.dim, fontSize: 11, lineHeight: 1.6, marginTop: 6 }}>
          ⚠️ Market rates India 2024–25. Actual quotes may vary ±15–20%. Excludes GST, net-metering registration and DISCOM connection charges.
        </div>

        <button onClick={onClose} style={btnSt('primary', { width: '100%', marginTop: 20 })}>Close</button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// RESULTS PAGE
// ═══════════════════════════════════════════════════════════
function ResultsPage({ result: r, locData, onReset }) {
  const [showCalc, setShowCalc] = useState(false)
  const months = Object.entries(r.solarData.monthly_psh).map(([m, v]) => ({ month: m, psh: v }))

  const statCard = (icon, title, val, sub, col = C.primary) => (
    <div style={cardSt({ padding: 14, textAlign: 'center' })}>
      <div style={{ fontSize: 22, marginBottom: 5 }}>{icon}</div>
      <span style={lblSt({ textAlign: 'center' })}>{title}</span>
      <div style={{ color: col, fontSize: 20, fontWeight: 700, fontFamily: 'monospace', margin: '3px 0' }}>{val}</div>
      <div style={{ color: C.dim, fontSize: 11, lineHeight: 1.4 }}>{sub}</div>
    </div>
  )

  return (
    <div>
      {showCalc && <CalcModal r={r} onClose={() => setShowCalc(false)}/>}

      {/* Location + PSH banner */}
      <div style={cardSt({ background: '#0a150a', border: '1px solid #14532d44', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', marginBottom: 16 })}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={lblSt({ color: '#6ee7b7' })}>SITE LOCATION</span>
          <div style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>{locData.name}</div>
          <div style={{ color: C.dim, fontSize: 10, fontFamily: 'monospace', marginTop: 3 }}>
            {locData.lat.toFixed(4)}°, {locData.lon.toFixed(4)}°
            {r.solarData.isFallback && '  ·  estimated solar data'}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
          <span style={lblSt({ color: '#6ee7b7', textAlign: 'right' })}>PEAK SUN HOURS</span>
          <div style={{ color: C.primary, fontWeight: 700, fontSize: 28, fontFamily: 'monospace', lineHeight: 1 }}>{r.psh.toFixed(1)}</div>
          <div style={{ color: C.dim, fontSize: 10 }}>kWh/m²/day avg</div>
        </div>
      </div>

      {/* System type badge */}
      <div style={{ textAlign: 'center', padding: '9px 16px', borderRadius: 10, marginBottom: 16, background: r.systemType === 'offgrid' ? C.primary + '11' : C.blue + '11', border: `1px solid ${r.systemType === 'offgrid' ? C.primary + '33' : C.blue + '33'}` }}>
        <span style={{ color: r.systemType === 'offgrid' ? C.primary : C.blue, fontWeight: 600, fontSize: 14 }}>
          {r.systemType === 'offgrid' ? '🔋 Off-Grid System' : '⚡ On-Grid / Grid-Tied System'}
        </span>
        {r.systemType === 'offgrid' && (
          <span style={{ color: C.muted, fontSize: 13 }}> · {r.backupHours}h battery backup</span>
        )}
      </div>

      {/* Key specs grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
        {statCard('☀️', 'SOLAR PANELS',  `${r.numPanels}`,    `${r.panelWp}Wp each · ${r.actualCap_kWp.toFixed(2)} kWp`)}
        {statCard('⚡', 'INVERTER',       `${(r.inverterRating_VA / 1000).toFixed(r.inverterRating_VA < 2000 ? 1 : 0)} kVA`, `${r.inverterRating_VA} VA rating`, C.blue)}
        {r.battery && statCard('🔋', 'BATTERIES', `${r.battery.numBatts}`, `${r.battery.unitAh}Ah Li-ion @ ${r.battery.vSys}V`, C.purple)}
        {statCard('📅', 'ANNUAL OUTPUT', `${Math.round(r.annualGen_kWh)} kWh`, `~${Math.round(r.annualGen_kWh / 12)} kWh/month`, C.green)}
      </div>

      {/* Monthly chart */}
      <div style={cardSt({ marginBottom: 16 })}>
        <span style={lblSt()}>MONTHLY PEAK SUN HOURS (kWh/m²/day)</span>
        <ResponsiveContainer width="100%" height={170}>
          <BarChart data={months} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
            <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false}/>
            <YAxis tick={{ fill: C.dim, fontSize: 9 }} axisLine={false} tickLine={false}/>
            <Tooltip
              contentStyle={{ background: '#0f172a', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13 }}
              labelStyle={{ color: C.primary, fontWeight: 700 }}
              formatter={v => [`${v} PSH`, 'Peak Sun Hours']}
              cursor={{ fill: '#ffffff07' }}
            />
            <Bar dataKey="psh" radius={[3, 3, 0, 0]}>
              {months.map((m, i) => <Cell key={i} fill={m.psh >= r.psh ? C.primary : C.dim}/>)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div style={{ color: C.dim, fontSize: 10, marginTop: 6, textAlign: 'center' }}>
          🟡 Above avg ({r.psh} PSH) &nbsp; ⬛ Below avg
        </div>
      </div>

      {/* Tilt guide */}
      <div style={cardSt({ marginBottom: 16 })}>
        <span style={lblSt()}>PANEL INSTALLATION GUIDE</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
          {[
            { l: 'Optimal Tilt', v: `${r.solarData.optimal_tilt}°`, c: C.primary },
            { l: 'Summer Tilt',  v: `${r.solarData.summer_tilt}°`,  c: C.green   },
            { l: 'Winter Tilt',  v: `${r.solarData.winter_tilt}°`,  c: C.blue    },
          ].map(t => (
            <div key={t.l} style={{ textAlign: 'center', padding: '10px 6px', background: C.border2, borderRadius: 8 }}>
              <div style={{ color: C.muted, fontSize: 10, marginBottom: 4 }}>{t.l}</div>
              <div style={{ color: t.c, fontSize: 26, fontWeight: 900, fontFamily: 'monospace' }}>{t.v}</div>
            </div>
          ))}
        </div>
        <div style={{ background: C.border2, borderRadius: 6, padding: '8px 12px', color: C.dim, fontSize: 12 }}>
          Face panels toward <strong style={{ color: C.text }}>{r.solarData.facing}</strong>
        </div>
      </div>

      {/* Budget table */}
      <div style={cardSt({ background: '#0c0f1a', border: `1px solid ${C.primary}22`, marginBottom: 16 })}>
        <span style={lblSt({ color: C.primary })}>BUDGET ESTIMATE — INDIA 2024–25</span>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <td style={{ padding: '4px 0 8px', color: C.muted,    fontSize: 10, letterSpacing: '0.1em' }}>ITEM</td>
              <td style={{ padding: '4px 0 8px', color: C.green,    fontSize: 10, letterSpacing: '0.1em', textAlign: 'right' }}>MIN</td>
              <td style={{ padding: '4px 0 8px', color: C.primary,  fontSize: 10, letterSpacing: '0.1em', textAlign: 'right' }}>MAX</td>
            </tr>
          </thead>
          <tbody>
            {[
              { item: `Solar Panels  (${r.numPanels} × 400Wp)`,                                                   lo: r.costs.panelMin, hi: r.costs.panelMax },
              { item: `Inverter  (${r.inverterRating_VA} VA)`,                                                     lo: r.costs.invMin,   hi: r.costs.invMax   },
              ...(r.battery ? [{ item: `Batteries  (${r.battery.numBatts} × 200Ah Li-ion w/ warranty)`, lo: r.costs.battMin,  hi: r.costs.battMax  }] : []),
              { item: 'Installation & Wiring  (15%)',                                                              lo: r.costs.instMin,  hi: r.costs.instMax  },
            ].map((rw, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${C.border2}` }}>
                <td style={{ padding: '8px 0', color: '#94a3b8', fontSize: 12 }}>{rw.item}</td>
                <td style={{ padding: '8px 0', color: C.green,   fontFamily: 'monospace', fontWeight: 600, textAlign: 'right' }}>{fmtINR(rw.lo)}</td>
                <td style={{ padding: '8px 0', color: C.primary, fontFamily: 'monospace', fontWeight: 600, textAlign: 'right' }}>{fmtINR(rw.hi)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: `2px solid ${C.border}` }}>
              <td style={{ padding: '10px 0', color: C.text,     fontWeight: 700, fontSize: 14 }}>TOTAL</td>
              <td style={{ padding: '10px 0', color: C.green,    fontFamily: 'monospace', fontWeight: 700, fontSize: 15, textAlign: 'right' }}>{fmtINR(r.costs.totalMin)}</td>
              <td style={{ padding: '10px 0', color: C.primary,  fontFamily: 'monospace', fontWeight: 700, fontSize: 15, textAlign: 'right' }}>{fmtINR(r.costs.totalMax)}</td>
            </tr>
          </tfoot>
        </table>
        <div style={{ color: C.dim, fontSize: 10, marginTop: 10, lineHeight: 1.6 }}>
          ⚠️ Indicative only. Excludes GST &amp; DISCOM charges. Always get 2–3 installer quotes before purchase.
        </div>
      </div>

      {/* CO2 */}
      <div style={cardSt({ background: '#0a150a', border: '1px solid #14532d44', marginBottom: 16 })}>
        <span style={lblSt({ color: '#6ee7b7' })}>ENVIRONMENTAL IMPACT — PER YEAR</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            { l: 'CO₂ Avoided',      v: `${Math.round(r.co2_kg)} kg`,  c: '#6ee7b7' },
            { l: 'Equivalent Trees', v: `~${Math.round(r.co2_kg / 21)}`, c: '#86efac' },
          ].map(e => (
            <div key={e.l} style={{ background: '#0a120a', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ color: C.dim, fontSize: 10 }}>{e.l.toUpperCase()}</div>
              <div style={{ color: e.c, fontFamily: 'monospace', fontWeight: 700, fontSize: 20, marginTop: 4 }}>{e.v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Show calculations button */}
      <button
        onClick={() => setShowCalc(true)}
        style={{ width: '100%', padding: 14, background: 'transparent', border: `2px solid ${C.primary}44`, borderRadius: 10, color: C.primary, fontWeight: 600, fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10, fontFamily: 'inherit' }}
        onMouseEnter={e => e.currentTarget.style.background = C.primary + '11'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        📐 Show Step-by-Step Calculations
      </button>

      <button onClick={onReset} style={btnSt('ghost', { width: '100%', padding: 12 })}>↩ New Analysis</button>

      <p style={{ color: '#1a2436', fontSize: 10, textAlign: 'center', marginTop: 16, lineHeight: 1.6 }}>
        Solar data: PVGIS v5.2 (EU JRC) · NASA POWER · India CEA emission factor 2023
      </p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// MAIN APP — STATE MACHINE
// ═══════════════════════════════════════════════════════════
export default function App() {
  const [step,       setStep]       = useState('location')
  const [locData,    setLocData]    = useState(null)
  const [selections, setSelections] = useState({})
  const [sysType,    setSysType]    = useState(null)
  const [result,     setResult]     = useState(null)

  const stepNum = { location: 1, appliances: 2, system: 3, backup: 3, results: 4 }[step] || 1

  const compute = (type, hours) =>
    runCalculations({ selections, systemType: type, backupHours: hours, solarData: locData.solar })

  const reset = () => {
    setStep('location'); setLocData(null)
    setSelections({}); setSysType(null); setResult(null)
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: "'Inter','Segoe UI',system-ui,sans-serif", display: 'flex', flexDirection: 'column', alignItems: 'center', paddingBottom: 60 }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/>

      <div style={{ width: '100%', maxWidth: 500, padding: '24px 16px 0' }}>

        {/* App header */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.2em', color: C.primary }}>☀ SOLAR DESIGNER</div>
          <div style={{ fontSize: 10, color: C.dim, letterSpacing: '0.12em', marginTop: 2 }}>SYSTEM SIZING TOOL v1.0</div>
        </div>

        {step !== 'results' && <StepBar current={stepNum}/>}

        {step === 'location' && (
          <StepLocation onNext={d => { setLocData(d); setStep('appliances') }}/>
        )}

        {step === 'appliances' && (
          <StepAppliances
            onNext={s => { setSelections(s); setStep('system') }}
            onBack={() => setStep('location')}
            saved={selections}
          />
        )}

        {step === 'system' && (
          <StepSystemType
            onNext={t => {
              setSysType(t)
              if (t === 'offgrid') {
                setStep('backup')
              } else {
                setResult(compute(t, 0))
                setStep('results')
              }
            }}
            onBack={() => setStep('appliances')}
          />
        )}

        {step === 'backup' && (
          <StepBackupHours
            onNext={h => { setResult(compute(sysType, h)); setStep('results') }}
            onBack={() => setStep('system')}
          />
        )}

        {step === 'results' && result && (
          <ResultsPage result={result} locData={locData} onReset={reset}/>
        )}

      </div>
    </div>
  )
}

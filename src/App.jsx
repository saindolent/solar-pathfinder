import { useState, useMemo } from "react";
import {
  APPLIANCES, SYSTEM_TYPES, COST_DATA,
  EFFICIENCY, DEFAULT_PSH, BACKUP_HOURS, CO2_PER_KWH,
} from "./data.js";

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function fmt(n, dec = 2) { return Number(n).toFixed(dec); }
function fmtINR(n) {
  if (n >= 1e7) return `₹${fmt(n / 1e7, 2)} Cr`;
  if (n >= 1e5) return `₹${fmt(n / 1e5, 2)} L`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function calcSystem({ appliances, psh, systemType, backupHours }) {
  // 1. Total load
  const totalWatts = appliances.reduce((s, a) => s + a.watts * a.qty * a.hours, 0);
  const dailyWh    = totalWatts; // already watt-hours (watts × hours summed)
  const peakW      = appliances.reduce((s, a) => s + a.watts * a.qty, 0);

  // 2. Panel capacity (kWp)
  const systemEff  = EFFICIENCY.panel * EFFICIENCY.inverter * EFFICIENCY.wiring;
  const panelKWp   = dailyWh / (psh * 1000 * systemEff);

  // 3. Battery (for off-grid / hybrid)
  const needsBattery = systemType !== "ongrid";
  const batteryWh    = needsBattery
    ? (dailyWh * (backupHours / 24)) / EFFICIENCY.battery / 0.8 // 80% DoD
    : 0;

  // 4. Inverter rating (kVA) — 1.25x safety factor
  const inverterKVA = (peakW * 1.25) / 1000;

  // 5. Cost estimate
  const panelWp   = panelKWp * 1000;
  const panelCost = panelWp * COST_DATA.panel.standard;
  const bosCost   = panelCost * COST_DATA.bos_factor;
  const batCost   = batteryWh * COST_DATA.battery.lifepo4;
  const invCost   = inverterKVA * 1000 * COST_DATA.inverter.standard;
  const totalCost = panelCost + bosCost + batCost + invCost;

  // 6. Savings & payback
  const annualKWh    = panelKWp * psh * 365 * systemEff;
  const annualSaving = annualKWh * 8; // ₹8/unit avg India
  const payback      = totalCost / annualSaving;
  const co2Saved     = annualKWh * CO2_PER_KWH;

  return {
    totalWatts, dailyWh, peakW,
    panelKWp, batteryWh, inverterKVA,
    panelCost, bosCost, batCost, invCost, totalCost,
    annualKWh, annualSaving, payback, co2Saved,
    needsBattery,
  };
}

// ─── STEP INDICATOR ──────────────────────────────────────────────────────────
function Steps({ current }) {
  const steps = ["Location", "Appliances", "System", "Results"];
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 0, marginBottom: 32 }}>
      {steps.map((s, i) => {
        const active  = i === current;
        const done    = i < current;
        return (
          <div key={s} style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%",
                background: done ? "#f59e0b" : active ? "#f59e0b22" : "#ffffff08",
                border: `2px solid ${active || done ? "#f59e0b" : "#ffffff15"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 700,
                color: done ? "#000" : active ? "#f59e0b" : "#334155",
                fontFamily: "'Orbitron', sans-serif",
                transition: "all 0.3s",
              }}>
                {done ? "✓" : i + 1}
              </div>
              <span style={{
                fontSize: 10, letterSpacing: "0.08em",
                color: active ? "#f59e0b" : done ? "#94a3b8" : "#334155",
                fontFamily: "'Rajdhani', sans-serif",
              }}>{s.toUpperCase()}</span>
            </div>
            {i < steps.length - 1 && (
              <div style={{
                width: 48, height: 2, margin: "0 4px", marginBottom: 20,
                background: done ? "#f59e0b55" : "#ffffff08",
              }}/>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── STEP 1: LOCATION ────────────────────────────────────────────────────────
function Step1Location({ psh, setPsh, location, setLocation, onNext }) {
  const [query, setQuery]   = useState(location || "");
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(!!location);
  const [error, setError]   = useState("");

  const SYSTEM_PROMPT = `You are a solar energy expert. Given a location, return ONLY valid JSON with no markdown, no backticks.
Structure:
{"location":"City, Country","lat":0.0,"lon":0.0,"annual_psh":5.4,"climate_zone":"Tropical","climate_note":"one sentence"}
Be accurate based on real climatological data.`;

  async function fetchLocation() {
    if (!query.trim()) return;
    setLoading(true); setError(""); setFetched(false);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 300,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: "Solar data for: " + query }],
        }),
      });
      const d    = await res.json();
      const text = d.content?.find(b => b.type === "text")?.text || "";
      const data = JSON.parse(text.replace(/```json|```/g, "").trim());
      setPsh(data.annual_psh);
      setLocation(data.location);
      setFetched(true);
    } catch {
      setError("Could not find location. Try a city name.");
    } finally { setLoading(false); }
  }

  return (
    <div>
      <h2 style={styles.stepTitle}>📍 Your Location</h2>
      <p style={styles.stepDesc}>Enter your city to get accurate peak sun hours for your area.</p>

      <div style={styles.searchBox}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && fetchLocation()}
          placeholder="e.g. Amaravathi, Vijayawada, Hyderabad..."
          style={styles.searchInput}
        />
        <button onClick={fetchLocation} disabled={loading} style={styles.btn}>
          {loading ? "..." : "FETCH"}
        </button>
      </div>

      {error && <p style={{ color: "#ef4444", fontSize: 13, marginTop: 8 }}>{error}</p>}

      {fetched && (
        <div style={styles.infoBox}>
          <span style={{ fontSize: 20 }}>☀️</span>
          <div>
            <div style={{ color: "#f59e0b", fontWeight: 700 }}>{location}</div>
            <div style={{ color: "#94a3b8", fontSize: 13 }}>
              Peak Sun Hours: <strong style={{ color: "#f1f5f9" }}>{psh} kWh/m²/day</strong>
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <div style={{ color: "#475569", fontSize: 12, marginBottom: 8 }}>
          Or set PSH manually:
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5].map(v => (
            <button key={v} onClick={() => { setPsh(v); setFetched(true); }}
              style={{ ...styles.chipBtn, background: psh === v ? "#f59e0b22" : "#ffffff08",
                border: `1px solid ${psh === v ? "#f59e0b" : "#ffffff15"}`,
                color: psh === v ? "#f59e0b" : "#94a3b8" }}>
              {v}
            </button>
          ))}
        </div>
      </div>

      <button onClick={onNext} disabled={!psh} style={{ ...styles.nextBtn, marginTop: 28 }}>
        NEXT: APPLIANCES →
      </button>
    </div>
  );
}

// ─── STEP 2: APPLIANCES ──────────────────────────────────────────────────────
function Step2Appliances({ items, setItems, onNext, onBack }) {
  function toggle(id) {
    setItems(prev => prev.some(i => i.id === id)
      ? prev.filter(i => i.id !== id)
      : [...prev, { ...APPLIANCES.find(a => a.id === id), qty: 1, hours: 4 }]
    );
  }
  function update(id, field, val) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, [field]: Math.max(1, Number(val)) } : i));
  }
  const totalWh = items.reduce((s, a) => s + a.watts * a.qty * a.hours, 0);

  return (
    <div>
      <h2 style={styles.stepTitle}>⚡ Select Appliances</h2>
      <p style={styles.stepDesc}>Choose what you want to power. Adjust quantity and daily usage hours.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8, marginBottom: 20 }}>
        {APPLIANCES.map(a => {
          const sel = items.some(i => i.id === a.id);
          return (
            <div key={a.id} onClick={() => toggle(a.id)} style={{
              ...styles.applianceCard,
              background: sel ? "#f59e0b15" : "#ffffff05",
              border: `1px solid ${sel ? "#f59e0b66" : "#ffffff0e"}`,
              cursor: "pointer",
            }}>
              <span style={{ fontSize: 22 }}>{a.icon}</span>
              <div style={{ fontSize: 12, color: sel ? "#f59e0b" : "#94a3b8", fontWeight: 600, marginTop: 4, textAlign: "center" }}>{a.name}</div>
              <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>{a.watts}W</div>
            </div>
          );
        })}
      </div>

      {items.length > 0 && (
        <div style={styles.card}>
          <div style={styles.cardLabel}>SELECTED APPLIANCES</div>
          {items.map(item => (
            <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
              <span style={{ width: 24 }}>{item.icon}</span>
              <span style={{ flex: 1, minWidth: 120, fontSize: 13, color: "#cbd5e1" }}>{item.name}</span>
              <label style={styles.inputLabel}>Qty
                <input type="number" min="1" value={item.qty}
                  onChange={e => update(item.id, "qty", e.target.value)}
                  style={styles.numInput}/>
              </label>
              <label style={styles.inputLabel}>Hrs/day
                <input type="number" min="1" max="24" value={item.hours}
                  onChange={e => update(item.id, "hours", e.target.value)}
                  style={styles.numInput}/>
              </label>
              <span style={{ fontSize: 12, color: "#f59e0b", fontFamily: "monospace", minWidth: 70, textAlign: "right" }}>
                {(item.watts * item.qty * item.hours / 1000).toFixed(2)} kWh
              </span>
            </div>
          ))}
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #ffffff0e",
            display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#64748b", fontSize: 12 }}>TOTAL DAILY LOAD</span>
            <span style={{ color: "#f59e0b", fontFamily: "'Orbitron', sans-serif", fontSize: 18 }}>
              {(totalWh / 1000).toFixed(2)} kWh/day
            </span>
          </div>
        </div>
      )}

      <div style={styles.navRow}>
        <button onClick={onBack} style={styles.backBtn}>← BACK</button>
        <button onClick={onNext} disabled={items.length === 0} style={styles.nextBtn}>
          NEXT: SYSTEM TYPE →
        </button>
      </div>
    </div>
  );
}

// ─── STEP 3: SYSTEM TYPE ─────────────────────────────────────────────────────
function Step3System({ systemType, setSystemType, backupHours, setBackupHours, onNext, onBack }) {
  const selected = SYSTEM_TYPES.find(s => s.id === systemType);
  return (
    <div>
      <h2 style={styles.stepTitle}>🔧 System Configuration</h2>
      <p style={styles.stepDesc}>Choose a system type based on your grid situation and backup needs.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 20 }}>
        {SYSTEM_TYPES.map(s => {
          const active = systemType === s.id;
          return (
            <div key={s.id} onClick={() => setSystemType(s.id)} style={{
              ...styles.card, cursor: "pointer", padding: 16,
              background: active ? "#f59e0b12" : "#ffffff05",
              border: `1px solid ${active ? "#f59e0b88" : "#ffffff0e"}`,
              transition: "all 0.2s",
            }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>{s.icon}</div>
              <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 14, color: active ? "#f59e0b" : "#f1f5f9", marginBottom: 6 }}>{s.name}</div>
              <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5, marginBottom: 10 }}>{s.desc}</div>
              <div style={{ fontSize: 11, color: "#22c55e" }}>{s.pros.map(p => `✓ ${p}`).join("\n")}</div>
            </div>
          );
        })}
      </div>

      {selected?.batteryRequired && (
        <div style={styles.card}>
          <div style={styles.cardLabel}>BACKUP HOURS REQUIRED</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {BACKUP_HOURS.map(h => (
              <button key={h} onClick={() => setBackupHours(h)}
                style={{ ...styles.chipBtn, background: backupHours === h ? "#f59e0b22" : "#ffffff08",
                  border: `1px solid ${backupHours === h ? "#f59e0b" : "#ffffff15"}`,
                  color: backupHours === h ? "#f59e0b" : "#94a3b8" }}>
                {h}h
              </button>
            ))}
          </div>
          <p style={{ color: "#475569", fontSize: 12, marginTop: 10 }}>
            How many hours of backup do you need when there's no sun / grid outage?
          </p>
        </div>
      )}

      <div style={styles.navRow}>
        <button onClick={onBack} style={styles.backBtn}>← BACK</button>
        <button onClick={onNext} style={styles.nextBtn}>CALCULATE SYSTEM →</button>
      </div>
    </div>
  );
}

// ─── STEP 4: RESULTS ─────────────────────────────────────────────────────────
function Step4Results({ result, location, psh, systemType, onReset, onShowCalc, showCalc }) {
  const sysLabel = SYSTEM_TYPES.find(s => s.id === systemType)?.name || systemType;

  const cards = [
    { label: "SOLAR PANELS",    value: fmt(result.panelKWp, 2),       unit: "kWp",  color: "#f59e0b", icon: "☀️" },
    { label: "INVERTER RATING", value: fmt(result.inverterKVA, 1),    unit: "kVA",  color: "#38bdf8", icon: "⚡" },
    ...(result.needsBattery
      ? [{ label: "BATTERY BANK", value: fmt(result.batteryWh / 1000, 1), unit: "kWh", color: "#22c55e", icon: "🔋" }]
      : []),
    { label: "DAILY LOAD",      value: fmt(result.dailyWh / 1000, 2), unit: "kWh/day", color: "#a78bfa", icon: "📊" },
  ];

  const costs = [
    { label: "Solar Panels",   val: result.panelCost },
    { label: "Installation & Mounting", val: result.bosCost },
    ...(result.needsBattery ? [{ label: "Battery Bank (LiFePO4)", val: result.batCost }] : []),
    { label: "Inverter",       val: result.invCost },
  ];

  return (
    <div>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
        <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 20, color: "#f59e0b" }}>
          System Design Complete
        </div>
        <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>
          {location} · {psh} PSH · {sysLabel}
        </div>
      </div>

      {/* Key specs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: 10, marginBottom: 18 }}>
        {cards.map(c => (
          <div key={c.label} style={{ background: "#ffffff05", border: "1px solid #ffffff0e", borderRadius: 12, padding: "16px", textAlign: "center" }}>
            <div style={{ fontSize: 22 }}>{c.icon}</div>
            <div style={{ color: "#334155", fontSize: 10, letterSpacing: "0.1em", margin: "8px 0 4px" }}>{c.label}</div>
            <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 24, color: c.color }}>{c.value}</div>
            <div style={{ color: "#94a3b8", fontSize: 12 }}>{c.unit}</div>
          </div>
        ))}
      </div>

      {/* Cost breakdown */}
      <div style={{ ...styles.card, marginBottom: 18 }}>
        <div style={styles.cardLabel}>ESTIMATED COST BREAKDOWN</div>
        {costs.map(c => (
          <div key={c.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "8px 0", borderBottom: "1px solid #ffffff08" }}>
            <span style={{ fontSize: 13, color: "#94a3b8" }}>{c.label}</span>
            <span style={{ fontFamily: "monospace", color: "#e2e8f0" }}>{fmtINR(c.val)}</span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, paddingTop: 12 }}>
          <span style={{ color: "#64748b", fontWeight: 700 }}>TOTAL ESTIMATE</span>
          <span style={{ fontFamily: "'Orbitron', sans-serif", color: "#f59e0b", fontSize: 20 }}>{fmtINR(result.totalCost)}</span>
        </div>
      </div>

      {/* Savings & ROI */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 18 }}>
        {[
          { label: "Annual Generation", value: `${Math.round(result.annualKWh)} kWh` },
          { label: "Annual Savings",    value: fmtINR(result.annualSaving) },
          { label: "Payback Period",    value: `${fmt(result.payback, 1)} yrs` },
        ].map(s => (
          <div key={s.label} style={{ background: "#ffffff04", borderRadius: 10, padding: "12px 14px", textAlign: "center" }}>
            <div style={{ color: "#334155", fontSize: 10, letterSpacing: "0.08em", marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", color: "#e2e8f0", fontSize: 16 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* CO2 */}
      <div style={{ ...styles.card, background: "#0a1f0a", border: "1px solid #22c55e22", marginBottom: 18 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ fontSize: 28 }}>🌱</span>
          <div>
            <div style={{ color: "#22c55e", fontWeight: 700, fontSize: 14 }}>Environmental Impact</div>
            <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>
              This system will save approximately <strong style={{ color: "#22c55e" }}>
              {Math.round(result.co2Saved)} kg CO₂/year</strong> — equivalent to planting{" "}
              <strong style={{ color: "#22c55e" }}>{Math.round(result.co2Saved / 21)} trees</strong> annually.
            </div>
          </div>
        </div>
      </div>

      {/* Show Calculations */}
      <button onClick={onShowCalc} style={{ ...styles.nextBtn, background: "#ffffff08", color: "#94a3b8",
        border: "1px solid #ffffff15", marginBottom: 10, width: "100%" }}>
        {showCalc ? "▲ HIDE CALCULATIONS" : "▼ SHOW STEP-BY-STEP CALCULATIONS"}
      </button>

      {showCalc && (
        <div style={{ ...styles.card, fontFamily: "monospace", fontSize: 12, lineHeight: 2, color: "#94a3b8" }}>
          <div style={styles.cardLabel}>CALCULATION BREAKDOWN</div>
          <div>📦 Total Appliance Load: <span style={{ color: "#f1f5f9" }}>{result.peakW} W peak</span></div>
          <div>📅 Daily Energy Demand: <span style={{ color: "#f1f5f9" }}>{(result.dailyWh/1000).toFixed(2)} kWh</span></div>
          <div>☀️ Peak Sun Hours: <span style={{ color: "#f59e0b" }}>{psh} hrs/day</span></div>
          <div>⚙️ System Efficiency: <span style={{ color: "#f1f5f9" }}>{(EFFICIENCY.panel * EFFICIENCY.inverter * EFFICIENCY.wiring * 100).toFixed(0)}%</span></div>
          <div style={{ borderTop: "1px solid #ffffff08", paddingTop: 8, marginTop: 4 }}>
            <strong style={{ color: "#f59e0b" }}>Panel Capacity</strong> = Daily Load ÷ (PSH × System Eff)
          </div>
          <div>= {(result.dailyWh/1000).toFixed(2)} kWh ÷ ({psh} × {(EFFICIENCY.panel * EFFICIENCY.inverter * EFFICIENCY.wiring).toFixed(2)}) = <span style={{ color: "#f59e0b" }}>{fmt(result.panelKWp, 2)} kWp</span></div>
          {result.needsBattery && <>
            <div style={{ borderTop: "1px solid #ffffff08", paddingTop: 8, marginTop: 4 }}>
              <strong style={{ color: "#22c55e" }}>Battery Capacity</strong> = (Load × Backup hrs ÷ 24) ÷ Battery Eff ÷ 0.8 DoD
            </div>
            <div>= ({(result.dailyWh/1000).toFixed(2)} kWh × backup) ÷ {EFFICIENCY.battery} ÷ 0.8 = <span style={{ color: "#22c55e" }}>{fmt(result.batteryWh/1000, 2)} kWh</span></div>
          </>}
          <div style={{ borderTop: "1px solid #ffffff08", paddingTop: 8, marginTop: 4 }}>
            <strong style={{ color: "#38bdf8" }}>Inverter Rating</strong> = Peak Load × 1.25 safety factor
          </div>
          <div>= {result.peakW}W × 1.25 = <span style={{ color: "#38bdf8" }}>{fmt(result.inverterKVA, 1)} kVA</span></div>
        </div>
      )}

      <button onClick={onReset} style={{ ...styles.backBtn, width: "100%", marginTop: 12, textAlign: "center" }}>
        ↺ DESIGN ANOTHER SYSTEM
      </button>
    </div>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const styles = {
  stepTitle: {
    fontFamily: "'Orbitron', sans-serif",
    fontSize: 18, color: "#f1f5f9",
    marginBottom: 8,
  },
  stepDesc: { color: "#64748b", fontSize: 13, marginBottom: 20, lineHeight: 1.6 },
  searchBox: {
    display: "flex", gap: 10,
    background: "#ffffff07", border: "1px solid #f59e0b44",
    borderRadius: 12, padding: "6px 6px 6px 16px",
    marginBottom: 8,
  },
  searchInput: {
    flex: 1, background: "transparent", border: "none", outline: "none",
    color: "#f1f5f9", fontFamily: "'Rajdhani', sans-serif",
    fontSize: 15, letterSpacing: "0.03em",
  },
  btn: {
    background: "linear-gradient(135deg, #f59e0b, #d97706)",
    color: "#000", border: "none", borderRadius: 8,
    padding: "8px 18px", fontFamily: "'Orbitron', sans-serif",
    fontWeight: 700, fontSize: 11, cursor: "pointer",
  },
  nextBtn: {
    background: "linear-gradient(135deg, #f59e0b, #d97706)",
    color: "#000", border: "none", borderRadius: 10,
    padding: "12px 24px", fontFamily: "'Orbitron', sans-serif",
    fontWeight: 700, fontSize: 12, letterSpacing: "0.08em",
    cursor: "pointer",
  },
  backBtn: {
    background: "#ffffff08", color: "#64748b",
    border: "1px solid #ffffff15", borderRadius: 10,
    padding: "12px 20px", fontFamily: "'Rajdhani', sans-serif",
    fontWeight: 600, fontSize: 13, cursor: "pointer",
  },
  navRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 28, gap: 12 },
  infoBox: {
    display: "flex", gap: 12, alignItems: "center",
    background: "#f59e0b0f", border: "1px solid #f59e0b33",
    borderRadius: 10, padding: "12px 16px",
  },
  card: {
    background: "#ffffff05", border: "1px solid #ffffff0e",
    borderRadius: 12, padding: "18px 20px", marginBottom: 12,
  },
  cardLabel: { color: "#334155", fontSize: 10, letterSpacing: "0.14em", marginBottom: 14 },
  applianceCard: {
    borderRadius: 10, padding: "12px 8px",
    display: "flex", flexDirection: "column", alignItems: "center",
    transition: "all 0.15s",
  },
  chipBtn: {
    padding: "6px 14px", borderRadius: 6,
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13, cursor: "pointer",
    transition: "all 0.15s",
  },
  inputLabel: {
    display: "flex", flexDirection: "column", alignItems: "center",
    fontSize: 10, color: "#475569", letterSpacing: "0.08em", gap: 3,
  },
  numInput: {
    width: 52, background: "#ffffff08", border: "1px solid #ffffff15",
    borderRadius: 6, color: "#f1f5f9", textAlign: "center",
    fontFamily: "monospace", fontSize: 14, padding: "4px 0", outline: "none",
  },
};

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [step, setStep]             = useState(0);
  const [psh, setPsh]               = useState(DEFAULT_PSH);
  const [location, setLocation]     = useState("");
  const [appliances, setAppliances] = useState([]);
  const [systemType, setSystemType] = useState("hybrid");
  const [backupHours, setBackupHours] = useState(4);
  const [showCalc, setShowCalc]     = useState(false);

  const result = useMemo(() => {
    if (step < 3 || appliances.length === 0) return null;
    return calcSystem({ appliances, psh, systemType, backupHours });
  }, [step, appliances, psh, systemType, backupHours]);

  function reset() {
    setStep(0); setAppliances([]); setSystemType("hybrid");
    setBackupHours(4); setShowCalc(false);
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "radial-gradient(ellipse at 60% 0%, #1c0a00 0%, #080810 60%)",
      fontFamily: "'Rajdhani', sans-serif",
      color: "#e2e8f0",
      paddingBottom: 60,
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Orbitron:wght@700;900&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet"/>

      {/* Header */}
      <div style={{ textAlign: "center", padding: "48px 20px 32px", position: "relative" }}>
        <div style={{
          position: "absolute", top: -40, left: "50%", transform: "translateX(-50%)",
          width: 360, height: 360,
          background: "radial-gradient(circle, #f59e0b14 0%, transparent 70%)",
          pointerEvents: "none",
        }}/>
        <div style={{
          fontFamily: "'Orbitron', sans-serif",
          fontSize: "clamp(18px, 4vw, 30px)",
          fontWeight: 900, letterSpacing: "0.1em",
          color: "#f59e0b", textShadow: "0 0 40px #f59e0b77",
          marginBottom: 8,
        }}>
          SOLAR SYSTEM DESIGNER
        </div>
        <p style={{ color: "#64748b", fontSize: 13, letterSpacing: "0.03em" }}>
          Calculate your solar panel, battery & inverter requirements
        </p>
      </div>

      {/* Wizard */}
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 20px" }}>
        <Steps current={step} />
        {step === 0 && <Step1Location psh={psh} setPsh={setPsh} location={location} setLocation={setLocation} onNext={() => setStep(1)} />}
        {step === 1 && <Step2Appliances items={appliances} setItems={setAppliances} onNext={() => setStep(2)} onBack={() => setStep(0)} />}
        {step === 2 && <Step3System systemType={systemType} setSystemType={setSystemType} backupHours={backupHours} setBackupHours={setBackupHours} onNext={() => setStep(3)} onBack={() => setStep(1)} />}
        {step === 3 && result && <Step4Results result={result} location={location || "Custom Location"} psh={psh} systemType={systemType} onReset={reset} onShowCalc={() => setShowCalc(s => !s)} showCalc={showCalc} />}
      </div>

      <div style={{ textAlign: "center", marginTop: 40, color: "#1e293b", fontSize: 10, letterSpacing: "0.1em" }}>
        SOLAR SYSTEM DESIGNER · POWERED BY CLAUDE AI
      </div>
    </div>
  );
}

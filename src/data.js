// src/data.js  –  Solar Designer v1.0
// ─────────────────────────────────────────────────────────────────
// Appliance database · Market prices · Calculation engine
// ─────────────────────────────────────────────────────────────────

export const APPLIANCES = [
  // ── Lighting ──────────────────────────────────────────────────
  { id:'led_bulb',   icon:'💡', name:'LED Bulb (9W)',            watts:9,    hours:6,   category:'Lighting'      },
  { id:'tubelight',  icon:'💡', name:'LED Tube Light (18W)',      watts:20,   hours:6,   category:'Lighting'      },
  // ── Fans ──────────────────────────────────────────────────────
  { id:'ceil_fan',   icon:'🌀', name:'Ceiling Fan',               watts:60,   hours:10,  category:'Fans'          },
  { id:'table_fan',  icon:'🌬️', name:'Table / Pedestal Fan',      watts:55,   hours:8,   category:'Fans'          },
  // ── Entertainment ─────────────────────────────────────────────
  { id:'tv_32',      icon:'📺', name:'LED TV 32"',                watts:45,   hours:6,   category:'Entertainment' },
  { id:'tv_43',      icon:'📺', name:'LED TV 43"',                watts:80,   hours:6,   category:'Entertainment' },
  { id:'dth',        icon:'📡', name:'DTH / Set-Top Box',         watts:15,   hours:6,   category:'Entertainment' },
  // ── Kitchen ───────────────────────────────────────────────────
  { id:'fridge_165', icon:'🧊', name:'Refrigerator 165L',         watts:150,  hours:8,   category:'Kitchen'       },
  { id:'fridge_250', icon:'🧊', name:'Refrigerator 250L+',        watts:200,  hours:8,   category:'Kitchen'       },
  { id:'mixer',      icon:'🥤', name:'Mixer / Grinder',           watts:500,  hours:0.5, category:'Kitchen'       },
  { id:'microwave',  icon:'🍲', name:'Microwave Oven',            watts:1200, hours:0.5, category:'Kitchen'       },
  { id:'geyser',     icon:'🚿', name:'Water Heater / Geyser',     watts:2000, hours:1,   category:'Kitchen'       },
  // ── AC & Cooling ──────────────────────────────────────────────
  { id:'ac_1ton',    icon:'❄️', name:'Air Conditioner 1 Ton',     watts:1000, hours:8,   category:'AC & Cooling'  },
  { id:'ac_1_5ton',  icon:'❄️', name:'Air Conditioner 1.5 Ton',   watts:1500, hours:8,   category:'AC & Cooling'  },
  { id:'ac_2ton',    icon:'❄️', name:'Air Conditioner 2 Ton',     watts:2000, hours:8,   category:'AC & Cooling'  },
  // ── Computing ─────────────────────────────────────────────────
  { id:'laptop',     icon:'💻', name:'Laptop',                    watts:65,   hours:6,   category:'Computing'     },
  { id:'desktop',    icon:'🖥️', name:'Desktop Computer',          watts:200,  hours:6,   category:'Computing'     },
  { id:'mobile',     icon:'📱', name:'Mobile Charger',            watts:45,   hours:3,   category:'Computing'     },
  { id:'router',     icon:'📶', name:'WiFi Router',               watts:10,   hours:24,  category:'Computing'     },
  // ── Appliances ────────────────────────────────────────────────
  { id:'wash_mach',  icon:'🫧', name:'Washing Machine',           watts:500,  hours:1,   category:'Appliances'    },
  { id:'iron',       icon:'👔', name:'Electric Iron',             watts:1000, hours:0.5, category:'Appliances'    },
  // ── Pumps ─────────────────────────────────────────────────────
  { id:'pump_half',  icon:'💧', name:'Water Pump 0.5 HP',         watts:375,  hours:2,   category:'Pumps'         },
  { id:'pump_1hp',   icon:'💧', name:'Submersible Pump 1 HP',     watts:750,  hours:2,   category:'Pumps'         },
]

// ── Market Prices — India 2024-25 ─────────────────────────────────
export const PRICES = {
  panel_min_each:   12000,   // ₹ per 400Wp panel — minimum market rate
  panel_max_each:   15000,   // ₹ per 400Wp panel — maximum market rate
  battery_min_each: 19000,   // ₹ per 200Ah Li-ion with warranty — min
  battery_max_each: 23000,   // ₹ per 200Ah Li-ion with warranty — max
  battery_ah:       200,     // Ah capacity per battery unit
  inverter: {                // ₹ range by VA rating
    1000:  { min:  6000, max:  9000 },
    2000:  { min: 11000, max: 15000 },
    3000:  { min: 18000, max: 24000 },
    5000:  { min: 30000, max: 40000 },
    7500:  { min: 45000, max: 60000 },
    10000: { min: 65000, max: 85000 },
  },
  installation_pct: 0.15,    // 15% of equipment cost for civil, wiring, mounting
}

// ── Solar Calculation Engine ──────────────────────────────────────
// All calculations follow standard solar PV sizing methodology.
// Each step maps directly to the "Show Calculations" modal output.
// ─────────────────────────────────────────────────────────────────
export function runCalculations({ selections, systemType, backupHours, solarData }) {

  // ── STEP 1 · Load Schedule ─────────────────────────────────────
  const loadList = APPLIANCES
    .filter(a => (selections[a.id] || 0) > 0)
    .map(a => {
      const qty = selections[a.id]
      return { ...a, qty, load_W: a.watts * qty, daily_Wh: a.watts * qty * a.hours }
    })

  const totalLoad_W     = loadList.reduce((s, a) => s + a.load_W,   0)
  const dailyEnergy_Wh  = loadList.reduce((s, a) => s + a.daily_Wh, 0)
  const dailyEnergy_kWh = dailyEnergy_Wh / 1000

  // ── STEP 2 · Design Energy with System Loss Factor ─────────────
  // 25% accounts for: cable losses, dust on panels, temperature
  // derating, and other real-world efficiency reductions.
  const lossFactorPct    = 25
  const lossFactor       = 1.25
  const designEnergy_kWh = dailyEnergy_kWh * lossFactor

  // ── STEP 3 · Solar Panel Capacity ─────────────────────────────
  // Formula: Required kWp = Design Energy ÷ (PSH × System Efficiency)
  const psh    = solarData.annual_psh
  const sysEff = 0.77              // Inverter(96%) × Wiring(90%) × Mismatch(89%)
  const solarCap_kWp = designEnergy_kWh / (psh * sysEff)

  // ── STEP 4 · Number of Panels ──────────────────────────────────
  const panelWp       = 400        // Standard monocrystalline PERC panel
  const numPanels     = Math.ceil(solarCap_kWp * 1000 / panelWp)
  const actualCap_kWp = (numPanels * panelWp) / 1000

  // ── STEP 5 · Inverter Rating ───────────────────────────────────
  // Size to 125% of connected load to handle motor starting surges.
  const inverterRequired_VA = totalLoad_W * 1.25
  const INVERTER_SIZES      = [1000, 2000, 3000, 5000, 7500, 10000]
  const inverterRating_VA   = INVERTER_SIZES.find(s => s >= inverterRequired_VA) || 10000

  // ── STEP 6 · Battery Bank (off-grid only) ──────────────────────
  // Formula: Required Ah = Backup Energy ÷ (System Voltage × DoD)
  let battery = null
  if (systemType === 'offgrid') {
    const dod             = 0.80   // Lithium-Ion safe Depth of Discharge
    const vSys            = inverterRating_VA <= 3000 ? 24 : 48
    const backupEnergy_Wh = totalLoad_W * backupHours
    const reqAh           = backupEnergy_Wh / (vSys * dod)
    const unitAh          = PRICES.battery_ah
    const numBatts        = Math.ceil(reqAh / unitAh)
    battery = { dod, vSys, backupEnergy_Wh, reqAh: Math.ceil(reqAh), unitAh, numBatts }
  }

  // ── STEP 7 · Budget Ranges ─────────────────────────────────────
  const panelMin = numPanels * PRICES.panel_min_each
  const panelMax = numPanels * PRICES.panel_max_each
  const invP     = PRICES.inverter[inverterRating_VA] || { min: 11000, max: 15000 }
  const battMin  = battery ? battery.numBatts * PRICES.battery_min_each : 0
  const battMax  = battery ? battery.numBatts * PRICES.battery_max_each : 0
  const equipMin = panelMin + invP.min + battMin
  const equipMax = panelMax + invP.max + battMax
  const instMin  = Math.round(equipMin * PRICES.installation_pct)
  const instMax  = Math.round(equipMax * PRICES.installation_pct)

  const costs = {
    panelMin, panelMax,
    invMin: invP.min, invMax: invP.max,
    battMin, battMax,
    instMin, instMax,
    totalMin: equipMin + instMin,
    totalMax: equipMax + instMax,
  }

  // ── STEP 8 · Annual Generation & Environmental Impact ──────────
  const annualGen_kWh = actualCap_kWp * psh * 365 * sysEff
  const co2_kg        = annualGen_kWh * 0.82  // India CEA 2023 grid emission factor

  return {
    systemType, backupHours, solarData,
    loadList, totalLoad_W, dailyEnergy_Wh, dailyEnergy_kWh,
    lossFactorPct, lossFactor, designEnergy_kWh,
    psh, sysEff, solarCap_kWp, panelWp, numPanels, actualCap_kWp,
    inverterRequired_VA, inverterRating_VA,
    battery, costs,
    annualGen_kWh, co2_kg,
  }
}

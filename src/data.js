// ─── APPLIANCES ───────────────────────────────────────────────────────────────
export const APPLIANCES = [
  { id: "fan",        name: "Ceiling Fan",         watts: 75,   icon: "🌀" },
  { id: "light_led",  name: "LED Light (10W)",      watts: 10,   icon: "💡" },
  { id: "light_cfl",  name: "CFL Light (23W)",      watts: 23,   icon: "💡" },
  { id: "tv_32",      name: "TV 32\" LED",          watts: 50,   icon: "📺" },
  { id: "tv_43",      name: "TV 43\" LED",          watts: 80,   icon: "📺" },
  { id: "fridge",     name: "Refrigerator (165L)",  watts: 150,  icon: "🧊" },
  { id: "fridge_xl",  name: "Refrigerator (300L)",  watts: 250,  icon: "🧊" },
  { id: "ac_1ton",    name: "AC 1 Ton",             watts: 1000, icon: "❄️" },
  { id: "ac_15ton",   name: "AC 1.5 Ton",           watts: 1500, icon: "❄️" },
  { id: "washing",    name: "Washing Machine",      watts: 500,  icon: "🫧" },
  { id: "motor",      name: "Water Pump (0.5HP)",   watts: 375,  icon: "💧" },
  { id: "motor_1hp",  name: "Water Pump (1HP)",     watts: 750,  icon: "💧" },
  { id: "laptop",     name: "Laptop",               watts: 65,   icon: "💻" },
  { id: "desktop",    name: "Desktop PC",           watts: 200,  icon: "🖥️" },
  { id: "phone",      name: "Phone Charger",        watts: 20,   icon: "📱" },
  { id: "iron",       name: "Electric Iron",        watts: 1000, icon: "👕" },
  { id: "microwave",  name: "Microwave",            watts: 1200, icon: "📡" },
  { id: "mixer",      name: "Mixer / Grinder",      watts: 750,  icon: "🍳" },
  { id: "router",     name: "WiFi Router",          watts: 10,   icon: "📶" },
  { id: "tubewell",   name: "Submersible Pump",     watts: 1500, icon: "🚰" },
];

// ─── SYSTEM TYPES ─────────────────────────────────────────────────────────────
export const SYSTEM_TYPES = [
  {
    id: "ongrid",
    name: "On-Grid",
    icon: "⚡",
    desc: "Connected to utility grid. Export excess power. No battery needed.",
    pros: ["Lowest cost", "Earn from export", "No battery maintenance"],
    cons: ["No power during grid outage", "Requires stable grid connection"],
    batteryRequired: false,
  },
  {
    id: "offgrid",
    name: "Off-Grid",
    icon: "🏕️",
    desc: "Fully independent. Best for remote locations with no grid access.",
    pros: ["100% energy independence", "Works in remote areas", "No electricity bills"],
    cons: ["Higher upfront cost", "Battery replacement every 3–5 years"],
    batteryRequired: true,
  },
  {
    id: "hybrid",
    name: "Hybrid",
    icon: "🔄",
    desc: "Best of both. Battery backup + grid connection. Most popular choice.",
    pros: ["Backup during outages", "Can export to grid", "Flexible"],
    cons: ["Higher cost than on-grid", "More components to maintain"],
    batteryRequired: true,
  },
];

// ─── COST RANGES (INR) ────────────────────────────────────────────────────────
export const COST_DATA = {
  // Panel cost per Wp (INR)
  panel: {
    budget:   18,   // Polycrystalline
    standard: 25,   // Monocrystalline PERC
    premium:  35,   // Bifacial / HJT
  },
  // Battery cost per Wh (INR)
  battery: {
    leadAcid: 8,    // Tubular / VRLA
    lifepo4:  22,   // LiFePO4
  },
  // Inverter cost per W (INR)
  inverter: {
    budget:   8,
    standard: 12,
    premium:  18,
  },
  // BOS (Balance of System): mounting, wiring, installation — % of panel cost
  bos_factor: 0.35,
};

// ─── SYSTEM EFFICIENCY ────────────────────────────────────────────────────────
export const EFFICIENCY = {
  panel:    0.80,   // 80% derating for temperature, dust, aging
  inverter: 0.95,   // 95% inverter efficiency
  battery:  0.85,   // 85% round-trip battery efficiency
  wiring:   0.98,   // 98% wiring losses
};

// ─── DEFAULT PSH (if no location data) ───────────────────────────────────────
export const DEFAULT_PSH = 5.0; // India average

// ─── BACKUP HOUR OPTIONS ─────────────────────────────────────────────────────
export const BACKUP_HOURS = [2, 4, 6, 8, 12];

// ─── CO2 FACTOR ──────────────────────────────────────────────────────────────
export const CO2_PER_KWH = 0.82; // kg CO2 per kWh (India grid average)

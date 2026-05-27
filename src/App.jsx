import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const SYSTEM_PROMPT = `You are a solar energy expert with deep knowledge of NASA POWER climatological data, PVGIS, and global solar atlases.

When given a location, return ONLY a valid JSON object — no markdown, no explanation, no backticks. Just raw JSON.

Use this exact structure:
{
  "location": "City, Country (formatted nicely)",
  "lat": latitude as decimal number,
  "lon": longitude as decimal number,
  "annual_psh": annual average peak sun hours as decimal (e.g. 5.4),
  "monthly_psh": {
    "Jan": x.x, "Feb": x.x, "Mar": x.x, "Apr": x.x,
    "May": x.x, "Jun": x.x, "Jul": x.x, "Aug": x.x,
    "Sep": x.x, "Oct": x.x, "Nov": x.x, "Dec": x.x
  },
  "optimal_tilt": integer degrees for best annual output,
  "summer_tilt": integer degrees for summer,
  "winter_tilt": integer degrees for winter,
  "facing": azimuth string e.g. "True South (180 deg)" or "True North (0 deg)",
  "hemisphere": "North" or "South",
  "climate_zone": e.g. "Desert", "Mediterranean", "Tropical", "Temperate", "Subarctic",
  "climate_note": one sentence about solar conditions there
}

Base monthly PSH values on real climatological knowledge. Be accurate.`;

function getSolarRating(psh) {
  if (psh >= 6.5) return { label:"Exceptional", emoji:"🔆", color:"#f97316", desc:"World-class solar resource." };
  if (psh >= 5.5) return { label:"Excellent",   emoji:"☀️",  color:"#eab308", desc:"Very high yield. Solar is very profitable here." };
  if (psh >= 4.5) return { label:"Good",         emoji:"🌤",  color:"#84cc16", desc:"Solid potential. Standard systems perform well." };
  if (psh >= 3.5) return { label:"Moderate",     emoji:"🌥",  color:"#38bdf8", desc:"Viable. Larger array recommended." };
  return           { label:"Low",           emoji:"☁️",  color:"#94a3b8", desc:"Challenging. High-efficiency panels needed." };
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:"#0f172a", border:"1px solid #f59e0b44", borderRadius:8, padding:"10px 14px" }}>
      <p style={{ color:"#f59e0b", fontWeight:700, margin:0 }}>{label}</p>
      <p style={{ color:"#fff", margin:"4px 0 0", fontFamily:"monospace" }}>{payload[0].value.toFixed(2)} kWh/m²/day</p>
      <p style={{ color:"#94a3b8", margin:"2px 0 0", fontSize:11 }}>Peak Sun Hours</p>
    </div>
  );
};

export default function SolarPathfinder() {
  const [query, setQuery]     = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [data, setData]       = useState(null);

  async function fetchSolarData() {
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    setData(null);

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: "Get solar data for: " + query }],
        }),
      });

      if (!res.ok) throw new Error("API error " + res.status);
      const apiData = await res.json();
      const rawText = apiData.content?.find(b => b.type === "text")?.text || "";
      const clean = rawText.replace(/```json|```/g, "").trim();
      const solar = JSON.parse(clean);

      const chartData = MONTHS.map(m => ({
        month: m,
        psh: parseFloat((solar.monthly_psh[m] || 0).toFixed(2)),
      }));
      const maxMonth = chartData.reduce((a,b) => a.psh > b.psh ? a : b);
      const minMonth = chartData.reduce((a,b) => a.psh < b.psh ? a : b);

      setData({ ...solar, chartData, maxMonth, minMonth, rating: getSolarRating(solar.annual_psh) });
    } catch(e) {
      setError("Could not get data. Check the location name and try again.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  const barColors = data?.chartData.map(d => {
    const ratio = Math.min(1, Math.max(0, (d.psh - 2) / 6));
    return `rgb(${Math.round(56 + 199*ratio)},${Math.round(189 - 30*ratio)},${Math.round(248 - 218*ratio)})`;
  });

  return (
    <div style={{
      minHeight:"100vh",
      background:"radial-gradient(ellipse at 60% 0%, #1c0a00 0%, #080810 60%)",
      fontFamily:"'Rajdhani', sans-serif",
      color:"#e2e8f0",
      paddingBottom:60,
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Orbitron:wght@700;900&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet"/>

      {/* HERO */}
      <div style={{ textAlign:"center", padding:"56px 20px 36px", position:"relative" }}>
        <div style={{
          position:"absolute", top:-40, left:"50%", transform:"translateX(-50%)",
          width:360, height:360,
          background:"radial-gradient(circle, #f59e0b14 0%, transparent 70%)",
          pointerEvents:"none",
        }}/>
        <div style={{
          fontFamily:"'Orbitron', sans-serif",
          fontSize:"clamp(20px, 5vw, 36px)",
          fontWeight:900, letterSpacing:"0.1em",
          color:"#f59e0b",
          textShadow:"0 0 40px #f59e0b77",
          marginBottom:10,
        }}>
          SOLAR PATHFINDER
        </div>
        <p style={{ color:"#64748b", maxWidth:440, margin:"0 auto", fontSize:14, letterSpacing:"0.03em" }}>
          Enter any city or region — get peak sun hours, optimal panel tilt and solar potential
        </p>
      </div>

      {/* SEARCH */}
      <div style={{ maxWidth:560, margin:"0 auto 36px", padding:"0 20px" }}>
        <div style={{
          display:"flex", gap:10,
          background:"#ffffff07",
          border:"1px solid #f59e0b44",
          borderRadius:12,
          padding:"6px 6px 6px 18px",
          boxShadow:"0 0 50px #f59e0b0e",
        }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && fetchSolarData()}
            placeholder="e.g. Dubai, Mumbai, Phoenix, London..."
            style={{
              flex:1, background:"transparent", border:"none", outline:"none",
              color:"#f1f5f9", fontFamily:"'Rajdhani', sans-serif",
              fontSize:16, letterSpacing:"0.04em",
            }}
          />
          <button
            onClick={fetchSolarData}
            disabled={loading}
            style={{
              background: loading ? "#44220066" : "linear-gradient(135deg, #f59e0b, #d97706)",
              color:"#000", border:"none", borderRadius:8,
              padding:"10px 22px",
              fontFamily:"'Orbitron', sans-serif",
              fontWeight:700, fontSize:12, letterSpacing:"0.1em",
              cursor: loading ? "not-allowed" : "pointer",
              boxShadow: loading ? "none" : "0 0 20px #f59e0b44",
              transition:"all 0.2s",
            }}
          >
            {loading ? "ANALYZING..." : "ANALYZE"}
          </button>
        </div>
        {error && <p style={{ color:"#f87171", textAlign:"center", marginTop:12, fontSize:14 }}>⚠ {error}</p>}
      </div>

      {/* LOADING */}
      {loading && (
        <div style={{ textAlign:"center", padding:"50px 20px" }}>
          <div style={{
            width:56, height:56, borderRadius:"50%",
            border:"3px solid #f59e0b22", borderTop:"3px solid #f59e0b",
            margin:"0 auto 20px",
            animation:"spin 0.9s linear infinite",
          }}/>
          <style>{`@keyframes spin { to { transform:rotate(360deg); } }`}</style>
          <p style={{ color:"#475569", fontFamily:"'JetBrains Mono', monospace", fontSize:12 }}>
            Analyzing solar data...
          </p>
        </div>
      )}

      {/* RESULTS */}
      {data && (
        <div style={{ maxWidth:760, margin:"0 auto", padding:"0 20px" }}>

          {/* Location Header */}
          <div style={{
            background:"#ffffff05", border:"1px solid #f59e0b2a",
            borderRadius:14, padding:"20px 24px", marginBottom:18,
            display:"flex", alignItems:"center", gap:16, flexWrap:"wrap",
          }}>
            <div style={{ flex:1, minWidth:200 }}>
              <div style={{ color:"#475569", fontSize:10, letterSpacing:"0.15em", marginBottom:5 }}>LOCATION ANALYZED</div>
              <div style={{ fontFamily:"'Orbitron', sans-serif", fontSize:16, color:"#f1f5f9" }}>{data.location}</div>
              <div style={{ color:"#475569", fontFamily:"'JetBrains Mono', monospace", fontSize:11, marginTop:5 }}>
                {Number(data.lat).toFixed(4)}°, {Number(data.lon).toFixed(4)}° · {data.climate_zone}
              </div>
              <div style={{ color:"#64748b", fontSize:12, marginTop:4, fontStyle:"italic" }}>{data.climate_note}</div>
            </div>
            <div style={{
              background: data.rating.color + "18",
              border:`1px solid ${data.rating.color}44`,
              borderRadius:12, padding:"14px 20px", textAlign:"center",
            }}>
              <div style={{ fontSize:26, marginBottom:4 }}>{data.rating.emoji}</div>
              <div style={{ color:data.rating.color, fontFamily:"'Orbitron', sans-serif", fontSize:13, fontWeight:700 }}>
                {data.rating.label}
              </div>
              <div style={{ color:"#64748b", fontSize:11, maxWidth:170, marginTop:4 }}>{data.rating.desc}</div>
            </div>
          </div>

          {/* Key Stats */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(155px,1fr))", gap:12, marginBottom:18 }}>
            {[
              { label:"ANNUAL AVERAGE", value:Number(data.annual_psh).toFixed(2), unit:"kWh/m²/day", sub:"Avg Peak Sun Hours/day" },
              { label:"BEST MONTH",     value:data.maxMonth.month, unit:`${data.maxMonth.psh} PSH`, sub:"Highest output" },
              { label:"WORST MONTH",    value:data.minMonth.month, unit:`${data.minMonth.psh} PSH`, sub:"Lowest output" },
              { label:"PANEL FACING",   value:data.hemisphere, unit:data.facing, sub:"Optimal azimuth" },
            ].map(s => (
              <div key={s.label} style={{
                background:"#ffffff05", border:"1px solid #ffffff0e",
                borderRadius:12, padding:"16px 18px",
              }}>
                <div style={{ color:"#334155", fontSize:10, letterSpacing:"0.14em", marginBottom:6 }}>{s.label}</div>
                <div style={{ fontFamily:"'Orbitron', sans-serif", fontSize:22, color:"#f59e0b" }}>{s.value}</div>
                <div style={{ color:"#cbd5e1", fontSize:12, marginTop:3 }}>{s.unit}</div>
                <div style={{ color:"#334155", fontSize:11, marginTop:2 }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Chart */}
          <div style={{
            background:"#ffffff05", border:"1px solid #ffffff0e",
            borderRadius:14, padding:"22px 14px 14px", marginBottom:18,
          }}>
            <div style={{ color:"#475569", fontSize:10, letterSpacing:"0.14em", marginBottom:16, paddingLeft:8 }}>
              MONTHLY PEAK SUN HOURS (kWh/m²/day)
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.chartData} margin={{ top:0, right:8, bottom:0, left:-22 }}>
                <XAxis dataKey="month" tick={{ fill:"#475569", fontSize:11, fontFamily:"monospace" }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ fill:"#334155", fontSize:10, fontFamily:"monospace" }} axisLine={false} tickLine={false}/>
                <Tooltip content={<CustomTooltip/>} cursor={{ fill:"#ffffff05" }}/>
                <Bar dataKey="psh" radius={[4,4,0,0]}>
                  {data.chartData.map((_,i) => <Cell key={i} fill={barColors[i]}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Tilt Angles */}
          <div style={{
            background:"#ffffff05", border:"1px solid #ffffff0e",
            borderRadius:14, padding:"22px 24px", marginBottom:18,
          }}>
            <div style={{ color:"#475569", fontSize:10, letterSpacing:"0.14em", marginBottom:18 }}>RECOMMENDED PANEL TILT ANGLES</div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px,1fr))", gap:12 }}>
              {[
                { label:"Optimal Annual", angle:data.optimal_tilt, color:"#f59e0b", desc:"Best year-round" },
                { label:"Summer Tilt",   angle:data.summer_tilt,  color:"#22c55e", desc:"Max summer output" },
                { label:"Winter Tilt",   angle:data.winter_tilt,  color:"#38bdf8", desc:"Max winter output" },
              ].map(t => (
                <div key={t.label} style={{
                  background:t.color+"10", border:`1px solid ${t.color}33`,
                  borderRadius:10, padding:16, textAlign:"center",
                }}>
                  <div style={{ color:"#475569", fontSize:10, letterSpacing:"0.12em", marginBottom:8 }}>{t.label.toUpperCase()}</div>
                  <div style={{
                    fontFamily:"'Orbitron', sans-serif", fontSize:36, fontWeight:900,
                    color:t.color, textShadow:`0 0 24px ${t.color}55`,
                  }}>{t.angle}°</div>
                  <div style={{ color:"#475569", fontSize:11, marginTop:6 }}>{t.desc}</div>
                </div>
              ))}
            </div>
            <div style={{
              marginTop:16, background:"#0f172a",
              borderRadius:8, padding:"12px 16px",
              display:"flex", gap:12, alignItems:"flex-start",
            }}>
              <span style={{ fontSize:18, flexShrink:0 }}>💡</span>
              <p style={{ margin:0, color:"#94a3b8", fontSize:13, lineHeight:1.7 }}>
                Face panels toward <strong style={{ color:"#f59e0b" }}>{data.facing}</strong> and
                tilt at <strong style={{ color:"#f59e0b" }}>{data.optimal_tilt}°</strong> for best
                annual performance. Seasonal adjustment from {data.summer_tilt}° (summer)
                to {data.winter_tilt}° (winter) can boost output by ~5–10%.
              </p>
            </div>
          </div>

          {/* Energy Estimator */}
          <div style={{
            background:"linear-gradient(135deg, #0c1322, #0f0a0388)",
            border:"1px solid #f59e0b1a",
            borderRadius:14, padding:"22px 24px",
          }}>
            <div style={{ color:"#475569", fontSize:10, letterSpacing:"0.14em", marginBottom:16 }}>
              ENERGY ESTIMATOR — PER 1 kWp INSTALLED
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              {[
                { label:"Daily Output",   value:`${Number(data.annual_psh).toFixed(1)} kWh` },
                { label:"Monthly Output", value:`~${Math.round(data.annual_psh * 30 * 0.8)} kWh` },
                { label:"Annual Output",  value:`~${Math.round(data.annual_psh * 365 * 0.8)} kWh` },
                { label:"CO₂ Saved/yr",  value:`~${Math.round(data.annual_psh * 365 * 0.8 * 0.45)} kg` },
              ].map(e => (
                <div key={e.label} style={{ background:"#ffffff04", borderRadius:8, padding:"12px 14px" }}>
                  <div style={{ color:"#334155", fontSize:10, letterSpacing:"0.1em" }}>{e.label}</div>
                  <div style={{ fontFamily:"'JetBrains Mono', monospace", color:"#e2e8f0", fontSize:18, marginTop:5 }}>{e.value}</div>
                </div>
              ))}
            </div>
            <p style={{ color:"#1e293b", fontSize:11, margin:"12px 0 0" }}>
              * Assumes 80% system efficiency. Multiply by your total kWp for real output.
            </p>
          </div>
        </div>
      )}

      {!data && !loading && !error && (
        <div style={{ textAlign:"center", padding:"20px 20px 40px", color:"#1e293b" }}>
          <div style={{ fontSize:46, marginBottom:12 }}>🌍</div>
          <p style={{ fontSize:13, letterSpacing:"0.05em" }}>Try: Dubai · Phoenix · Munich · Mumbai · London · Cape Town</p>
        </div>
      )}

      <div style={{ textAlign:"center", marginTop:40, color:"#1e293b", fontSize:10, letterSpacing:"0.1em" }}>
        POWERED BY CLAUDE AI SOLAR ANALYSIS
      </div>
    </div>
  );
}

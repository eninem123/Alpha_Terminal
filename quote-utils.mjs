export function codeToSymbol(code) {
  const c = String(code || "").trim();
  if (!/^\d{6}$/.test(c)) return "";
  const p2 = c.slice(0, 2);
  const p3 = c.slice(0, 3);
  if (p2 === "60" || p2 === "68" || p2 === "69") return "sh" + c;
  if (p2 === "00" || p2 === "30") return "sz" + c;
  if (p3 === "430" || p3 === "830" || p3 === "870" || p3 === "880" || p3 === "920") return "bj" + c;
  return "";
}

export function codeToEastmoneySecid(code) {
  const c = String(code || "").trim();
  if (!/^\d{6}$/.test(c)) return "";
  const p2 = c.slice(0, 2);
  const p3 = c.slice(0, 3);
  if (p2 === "60" || p2 === "68" || p2 === "69") return "1." + c;
  if (p2 === "00" || p2 === "30") return "0." + c;
  if (p3 === "430" || p3 === "830" || p3 === "870" || p3 === "880" || p3 === "920") return "0." + c;
  return "";
}

export function parseTencentQuoteText(text) {
  const raw = String(text || "");
  if (!raw || !raw.trim()) return null;
  if (/v_pv_none_match/i.test(raw)) return null;
  const m = raw.match(/v_[a-z0-9]+="([^"]*)"/i);
  if (!m) return null;
  const parts = String(m[1] || "").split("~");
  if (parts.length < 5) return null;
  const currentPrice = parseFloat(parts[3]);
  let basePrice = parseFloat(parts[4]);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;
  if (!Number.isFinite(basePrice) || basePrice <= 0) basePrice = currentPrice;
  const name = String(parts[1] || "").trim();
  return { name, currentPrice, basePrice };
}

export function parseSinaHqText(text) {
  const raw = String(text || "");
  if (!raw || !raw.trim()) return null;
  const m = raw.match(/="([^"]*)"/);
  if (!m) return null;
  const body = String(m[1] || "");
  if (!body) return null;
  const parts = body.split(",");
  if (parts.length < 4) return null;
  const name = String(parts[0] || "").trim();
  const basePrice = parseFloat(parts[2]);
  const currentPrice = parseFloat(parts[3]);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;
  const base = Number.isFinite(basePrice) && basePrice > 0 ? basePrice : currentPrice;
  return { name, currentPrice, basePrice: base };
}

export function parseEastmoneyStockGetJson(json) {
  const data = json && typeof json === "object" ? json.data : null;
  if (!data || typeof data !== "object") return null;
  const name = String(data.f58 || data.f14 || data.f57 || "").trim();
  const currentPrice = Number(data.f43);
  const basePrice = Number(data.f60);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;
  const base = Number.isFinite(basePrice) && basePrice > 0 ? basePrice : currentPrice;
  return { name, currentPrice, basePrice: base };
}

const DEFILLAMA_BASE_URL = "https://api.llama.fi";

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`DefiLlama 요청 실패: ${response.status}`);
  }
  return response.json();
}

function toDailySeries(chart = []) {
  const rows = Array.isArray(chart) ? chart : [];
  return rows
    .map((point) => {
      const timestamp = Array.isArray(point) ? point[0] : point.date || point.timestamp;
      const value = Array.isArray(point) ? point[1] : point.value || point.total || 0;
      return {
        date: new Date(Number(timestamp) * 1000).toISOString().slice(0, 10),
        value: Number(value) || 0,
      };
    })
    .filter((point) => point.value >= 0);
}

function sumLast(series, days) {
  return series.slice(-days).reduce((sum, point) => sum + point.value, 0);
}

function monthlyFromDaily(series, months = 6) {
  const buckets = new Map();
  series.forEach((point) => {
    const key = point.date.slice(0, 7);
    buckets.set(key, (buckets.get(key) || 0) + point.value);
  });
  return [...buckets.entries()]
    .slice(-months)
    .map(([month, value]) => ({ month, value }));
}

export async function fetchDefiLlamaFeesSummary(slug) {
  const url = `${DEFILLAMA_BASE_URL}/summary/fees/${encodeURIComponent(slug)}?dataType=dailyFees`;
  const payload = await fetchJson(url);
  const series = toDailySeries(payload.totalDataChart || payload.totalDataChartBreakdown || []);
  return {
    sourceUrl: url,
    dailyFees: Number(payload.total24h) || sumLast(series, 1),
    sevenDayFees: Number(payload.total7d) || sumLast(series, 7),
    thirtyDayFees: Number(payload.total30d) || sumLast(series, 30),
    monthlyFees: monthlyFromDaily(series),
  };
}

export async function fetchDefiLlamaRevenueSummary(slug) {
  const url = `${DEFILLAMA_BASE_URL}/summary/fees/${encodeURIComponent(slug)}?dataType=dailyRevenue`;
  const payload = await fetchJson(url);
  const series = toDailySeries(payload.totalDataChart || payload.totalDataChartBreakdown || []);
  return {
    sourceUrl: url,
    dailyRevenue: Number(payload.total24h) || sumLast(series, 1),
    sevenDayRevenue: Number(payload.total7d) || sumLast(series, 7),
    thirtyDayRevenue: Number(payload.total30d) || sumLast(series, 30),
    monthlyRevenue: monthlyFromDaily(series),
  };
}

export async function fetchDefiLlamaBuybackSummary(slug) {
  const url = `${DEFILLAMA_BASE_URL}/summary/fees/${encodeURIComponent(slug)}?dataType=dailyRevenue`;
  const payload = await fetchJson(url);
  const series = toDailySeries(payload.totalDataChart || payload.totalDataChartBreakdown || []);
  const latest = series.at(-1);
  return {
    sourceUrl: url,
    latestDate: latest?.date || null,
    dailyBuyback: Number(payload.total24h) || sumLast(series, 1),
    sevenDayBuyback: Number(payload.total7d) || sumLast(series, 7),
    thirtyDayBuyback: Number(payload.total30d) || sumLast(series, 30),
    cumulativeBuyback: Number(payload.totalAllTime) || sumLast(series, series.length),
    monthlyBuyback: monthlyFromDaily(series),
  };
}

import { fetchDefiLlamaBuybackSummary, fetchDefiLlamaFeesSummary, fetchDefiLlamaRevenueSummary } from "./lib/defillama.js";
import { fetchHyperliquidAssistanceFundData } from "./lib/hyperliquid.js";
import { projects } from "./src/data/projects.js";
import {
  getAnnualizedBuyback,
  getBuybackYield,
  getDashboardHighlights,
  getProjectScore,
  getProjection,
  getRevenueReturnRatio,
  getSignalFromScore,
  getTokenReturnAmount,
  getTrend,
  getTrendLabel,
  getUnlockPressureRatio,
  getUnlockRisk,
  getUsageTrendLabel,
  getValuation,
} from "./src/utils/calculations.js";

/* ============================================================
   STATE
   ============================================================ */
const TABS = ["홈", "프로젝트 분석", "랭킹", "설정"];

const state = {
  selectedProjectId: "hyperliquid",
  search: "",
  activeTab: "홈",
  rankSort: "revenue",
  isRefreshing: false,
  status: "샘플 데이터 표시 중 · 데이터 새로고침을 누르면 공개 API 연동을 시도합니다.",
};

const months = ["1월", "2월", "3월", "4월", "5월", "6월"];
const PALETTE = ["#15294a", "#2f6bd8", "#1f9f86", "#c79a3e", "#6b5bd2", "#aab4c4"];
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

/* ============================================================
   FORMATTERS (KEEP — data layer)
   ============================================================ */
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function formatCurrency(value, compact = true) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: Number(value) >= 1000000 ? 2 : 2,
  }).format(Number(value));
}

function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(Number(value));
}

function formatPercent(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

function formatRatio(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${Number(value).toFixed(digits)}x`;
}

function valueCaptureLabel(type) {
  return {
    buyback: "바이백",
    buyback_and_burn: "바이백+소각",
    burn: "소각",
    staking_distribution: "스테이커 분배",
    treasury_accumulation: "금고 축적",
    none: "없음",
  }[type] || "확인 필요";
}

/* ============================================================
   DATA HELPERS (KEEP — data layer)
   ============================================================ */
function isValidEvmAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "").trim());
}

function getSelectedProject() {
  return projects.find((project) => project.id === state.selectedProjectId) || projects[0];
}

function getFilteredProjects() {
  // Structured so an external coin list could be merged in later: the search
  // currently filters the existing `projects` array by name/token/category.
  return projects.filter((project) => {
    const keyword = state.search.trim().toLowerCase();
    return !keyword || `${project.name} ${project.token} ${project.category}`.toLowerCase().includes(keyword);
  });
}

function applyDerivedSignal(project) {
  const score = getProjectScore(project);
  return { score, ...getSignalFromScore(score) };
}

function metricValue(project, period, key) {
  return project?.[period]?.[key] ?? null;
}

function getVolumeMetric(project, period) {
  const value = metricValue(project, period, "volume");
  if (value === null || value === undefined) {
    return { label: period === "daily" ? "24h TVL" : period === "sevenDay" ? "TVL" : "TVL", value: formatCurrency(project.tvl), sub: "Lending 프로젝트 대체 지표" };
  }
  return { label: period === "daily" ? "24h Volume" : period === "sevenDay" ? "7d Volume" : "30d Volume", value: formatCurrency(value), sub: "거래 규모" };
}

function volumeOrTvl(project, period) {
  const value = metricValue(project, period, "volume");
  return value === null || value === undefined || value === 0 ? Number(project.tvl) || 0 : Number(value);
}

function normalizeMonthly(items, fallback) {
  const values = items.map((item) => Number(item.value || 0) / 1000000).filter((value) => Number.isFinite(value));
  return values.length ? values.slice(-6) : fallback;
}

function estimateBuybacksFromRevenue(project, monthlyRevenue = project.monthlyRevenue) {
  return monthlyRevenue.map((value) => Number((value * project.revenueToBuybackRatio).toFixed(2)));
}

function isActualBuyback(project) {
  return ["actual", "actual_onchain", "actual_disclosed"].includes(project.buybackType);
}

function eventsSince(events, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return events.filter((event) => Date.parse(event.date) >= cutoff);
}

function monthlyBuybacksFromEvents(events, monthsBack = 6) {
  const now = new Date();
  const buckets = Array.from({ length: monthsBack }, (_, index) => {
    const month = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1 - index), 1);
    return { key: `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`, usd: 0 };
  });
  const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  for (const event of events) {
    const date = new Date(event.date);
    if (Number.isNaN(date.getTime())) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const bucket = bucketMap.get(key);
    if (bucket) bucket.usd += Number(event.usd) || 0;
  }
  return buckets.map((bucket) => Number((bucket.usd / 1000000).toFixed(2)));
}

/* ============================================================
   ASYNC DATA LAYER (KEEP)
   ============================================================ */
async function refreshProjectData(project) {
  const [feesResult, revenueResult, buybackResult] = await Promise.allSettled([
    fetchDefiLlamaFeesSummary(project.defillamaSlug),
    fetchDefiLlamaRevenueSummary(project.defillamaSlug),
    project.id === "hyperliquid" ? fetchDefiLlamaBuybackSummary(project.defillamaBuybackSlug || project.defillamaSlug) : Promise.resolve(null),
  ]);

  const next = { ...project, daily: { ...project.daily }, sevenDay: { ...project.sevenDay }, thirtyDay: { ...project.thirtyDay } };
  const sources = [];

  if (feesResult.status === "fulfilled") {
    const fees = feesResult.value;
    next.daily.fees = fees.dailyFees;
    next.sevenDay.fees = fees.sevenDayFees;
    next.thirtyDay.fees = fees.thirtyDayFees;
    sources.push("DefiLlama fees");
  }

  if (revenueResult.status === "fulfilled") {
    const revenue = revenueResult.value;
    next.daily.revenue = revenue.dailyRevenue;
    next.sevenDay.revenue = revenue.sevenDayRevenue;
    next.thirtyDay.revenue = revenue.thirtyDayRevenue;
    next.monthlyRevenue = normalizeMonthly(revenue.monthlyRevenue, project.monthlyRevenue);
    if (!isActualBuyback(next)) {
      next.monthlyBuyback = estimateBuybacksFromRevenue(next);
      next.daily.buyback = next.daily.revenue * next.revenueToBuybackRatio;
      next.sevenDay.buyback = next.sevenDay.revenue * next.revenueToBuybackRatio;
      next.thirtyDay.buyback = next.thirtyDay.revenue * next.revenueToBuybackRatio;
    }
    sources.push("DefiLlama revenue");
  }

  if (buybackResult.status === "fulfilled" && buybackResult.value) {
    const buyback = buybackResult.value;
    next.daily.buyback = buyback.dailyBuyback;
    next.sevenDay.buyback = buyback.sevenDayBuyback;
    next.thirtyDay.buyback = buyback.thirtyDayBuyback;
    next.thirtyDay.holderRevenue = buyback.thirtyDayBuyback;
    next.thirtyDay.burn = buyback.thirtyDayBuyback;
    next.monthlyBuyback = normalizeMonthly(buyback.monthlyBuyback, project.monthlyBuyback);
    next.cumulativeBuybackUsd = buyback.cumulativeBuyback;
    next.latestBuybackDate = buyback.latestDate;
    next.buybackType = "actual_disclosed";
    next.buybackSource = "DefiLlama Token Buy Back / Holder Net Income";
    sources.push("DefiLlama buyback");
  }

  if (next.id === "hyperliquid" && isValidEvmAddress(next.assistanceFundAddress)) {
    const afData = await fetchHyperliquidAssistanceFundData(next.assistanceFundAddress, 30);
    const buyEvents = afData.events.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

    if (buyEvents.length) {
      next.buybackEvents = buyEvents.slice(0, 25);
      if (!next.cumulativeBuybackUsd) {
        next.buybackType = "actual_onchain";
        next.buybackSource = "Hyperliquid Assistance Fund fills";
        next.daily.buyback = eventsSince(buyEvents, 1).reduce((sum, item) => sum + item.usd, 0);
        next.sevenDay.buyback = eventsSince(buyEvents, 7).reduce((sum, item) => sum + item.usd, 0);
        next.thirtyDay.buyback = eventsSince(buyEvents, 30).reduce((sum, item) => sum + item.usd, 0);
        next.monthlyBuyback = monthlyBuybacksFromEvents(buyEvents);
      }
      sources.push("Hyperliquid fills");
    } else if (!next.cumulativeBuybackUsd && afData.hypeBalance.entryNotionalUsd > 0) {
      next.buybackType = "actual_disclosed";
      next.buybackSource = "Hyperliquid Assistance Fund spot state";
      next.thirtyDay.buyback = afData.hypeBalance.entryNotionalUsd;
      next.monthlyBuyback = [
        ...next.monthlyBuyback.slice(0, -1),
        Number((afData.hypeBalance.entryNotionalUsd / 1000000).toFixed(2)),
      ];
      sources.push("Hyperliquid spot state");
    }

    if (afData.accountValueUsd > 0) next.assistanceFundValueUsd = afData.accountValueUsd;
    if (afData.hypeBalance.amount > 0) next.assistanceFundHype = afData.hypeBalance.amount;
  }

  if (!sources.length) throw new Error("공개 API에서 갱신 가능한 데이터를 받지 못했습니다.");
  next.lastUpdated = `${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} KST · ${sources.join(", ")}`;
  return next;
}

async function refreshSelectedProject() {
  const project = getSelectedProject();
  const index = projects.findIndex((item) => item.id === project.id);
  state.isRefreshing = true;
  state.status = `${project.name} 공개 API 데이터를 불러오는 중입니다.`;
  render();

  try {
    const liveProject = await refreshProjectData(project);
    projects[index] = liveProject;
    state.status = `${liveProject.name} 데이터 갱신 완료 · ${liveProject.lastUpdated}`;
  } catch (error) {
    state.status = `${project.name} 실데이터 갱신 실패 · 샘플/이전 데이터 유지 (${error.message})`;
  } finally {
    state.isRefreshing = false;
    render();
  }
}

function saveSettings() {
  const project = getSelectedProject();
  const slug = $("#defillamaSlugInput");
  const fund = $("#assistanceFundInput");
  const price = $("#priceSourceInput");
  if (slug) project.defillamaSlug = slug.value.trim() || project.defillamaSlug;
  if (fund) project.assistanceFundAddress = fund.value.trim();
  if (price) project.priceSource = price.value;
  state.status = `${project.name} 설정 저장 완료 · 새로고침 시 해당 값으로 API를 호출합니다.`;
  render();
}

/* ============================================================
   SHARED VIEW HELPERS
   ============================================================ */
function sumThirty(key) {
  return projects.reduce((sum, p) => sum + (Number(p.thirtyDay?.[key]) || 0), 0);
}

function sumThirtyVolume() {
  return projects.reduce((sum, p) => sum + volumeOrTvl(p, "thirtyDay"), 0);
}

function monthOverMonth(values = []) {
  const current = Number(values.at(-1)) || 0;
  const previous = Number(values.at(-2)) || 0;
  return previous ? (current - previous) / previous : 0;
}

function changeSpan(ratio, digits = 1) {
  if (ratio === null || ratio === undefined || Number.isNaN(Number(ratio))) return "";
  const cls = ratio > 0 ? "pos" : ratio < 0 ? "neg" : "flat";
  const sign = ratio > 0 ? "+" : "";
  return `<span class="change ${cls}">${sign}${formatPercent(ratio, digits)}</span>`;
}

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function rankBadge(index) {
  return `<span class="rank-badge${index === 0 ? " gold" : ""}">${index + 1}</span>`;
}

/* ============================================================
   SVG CHARTS (hand-rolled, width-constrained)
   ============================================================ */
function smoothPath(points) {
  // Catmull-Rom -> cubic bezier for rounded line strokes.
  if (points.length < 2) return points.length ? `M${points[0][0]},${points[0][1]}` : "";
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

function areaChart(values, labels, { color = "#16a34a", title = "", unit = "M", fmt } = {}) {
  const clean = values.map((v) => Number(v) || 0);
  if (!clean.length) return `<div class="card-sub">표시할 데이터가 없습니다.</div>`;
  const width = 560;
  const height = 240;
  const pad = { top: 20, right: 26, bottom: 30, left: 48 };
  const max = Math.max(...clean, 1) * 1.14;
  const min = Math.min(...clean, 0) * 0.9;
  const denom = Math.max(clean.length - 1, 1);
  const xScale = (i) => pad.left + (i / denom) * (width - pad.left - pad.right);
  const yScale = (v) => height - pad.bottom - ((v - min) / Math.max(max - min, 1)) * (height - pad.top - pad.bottom);
  const points = clean.map((v, i) => [xScale(i), yScale(v)]);
  const line = smoothPath(points);
  const area = `${line} L${points.at(-1)[0]},${height - pad.bottom} L${points[0][0]},${height - pad.bottom} Z`;
  const gid = `grad-${Math.random().toString(36).slice(2, 8)}`;
  const yTicks = [0, 0.5, 1].map((r) => min + (max - min) * r);
  const formatY = fmt || ((v) => `$${v.toFixed(1)}${unit}`);

  return `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
      <title>${escapeHtml(title)}</title>
      <defs>
        <linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.12" />
          <stop offset="100%" stop-color="${color}" stop-opacity="0" />
        </linearGradient>
      </defs>
      ${yTicks.map((t) => {
        const y = yScale(t);
        return `<line class="grid-line" x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" />
          <text class="axis-label" x="${pad.left - 8}" y="${y + 3}" text-anchor="end">${formatY(t)}</text>`;
      }).join("")}
      <path d="${area}" fill="url(#${gid})" />
      <path class="area-line" d="${line}" stroke="${color}" />
      <circle class="end-dot" cx="${points.at(-1)[0]}" cy="${points.at(-1)[1]}" r="4.5" fill="${color}" />
      ${points.map((p, i) => `<text class="axis-label" x="${p[0]}" y="${height - 10}" text-anchor="middle">${escapeHtml(labels[i] || "")}</text>`).join("")}
    </svg>
  `;
}

function stackedAreaChart(cohorts, axisLabels, { title = "" } = {}) {
  // cohorts: [{ label, color, values:[...] }] all same length; stacked cumulatively.
  const n = axisLabels.length;
  if (!n || !cohorts.length) return `<div class="card-sub">표시할 데이터가 없습니다.</div>`;
  const width = 620;
  const height = 280;
  const pad = { top: 20, right: 26, bottom: 30, left: 52 };
  const totals = Array.from({ length: n }, (_, i) => cohorts.reduce((s, c) => s + (Number(c.values[i]) || 0), 0));
  const max = Math.max(...totals, 1) * 1.05;
  const denom = Math.max(n - 1, 1);
  const xScale = (i) => pad.left + (i / denom) * (width - pad.left - pad.right);
  const yScale = (v) => height - pad.bottom - (v / max) * (height - pad.top - pad.bottom);

  // build cumulative upper boundaries
  const cumulative = Array.from({ length: n }, () => 0);
  const bands = [];
  for (const cohort of cohorts) {
    const lower = cumulative.slice();
    const upper = cohort.values.map((v, i) => lower[i] + (Number(v) || 0));
    bands.push({ cohort, lower, upper });
    for (let i = 0; i < n; i++) cumulative[i] = upper[i];
  }

  const yTicks = [0, 0.5, 1].map((r) => max * r);

  const bandPaths = bands.map(({ cohort, lower, upper }) => {
    const top = upper.map((v, i) => [xScale(i), yScale(v)]);
    const bottom = lower.map((v, i) => [xScale(i), yScale(v)]).reverse();
    const topPath = smoothPath(top);
    const bottomPath = bottom.map((p, i) => `${i === 0 ? "L" : "L"}${p[0]},${p[1]}`).join(" ");
    return `<path d="${topPath} ${bottomPath} Z" fill="${cohort.color}" fill-opacity="0.82" stroke="#fff" stroke-width="0.6" />`;
  }).join("");

  const labelStep = Math.max(1, Math.ceil(n / 7));

  return `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
      <title>${escapeHtml(title)}</title>
      ${yTicks.map((t) => {
        const y = yScale(t);
        return `<line class="grid-line" x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" />
          <text class="axis-label" x="${pad.left - 8}" y="${y + 3}" text-anchor="end">${(t * 100).toFixed(0)}%</text>`;
      }).join("")}
      ${bandPaths}
      ${axisLabels.map((lbl, i) => (i % labelStep === 0 || i === n - 1)
        ? `<text class="axis-label" x="${xScale(i)}" y="${height - 10}" text-anchor="middle">${escapeHtml(lbl)}</text>`
        : "").join("")}
    </svg>
  `;
}

function svgDonut(segments, { size = 150 } = {}) {
  // segments: [{ value, color }]
  const total = segments.reduce((s, x) => s + (Number(x.value) || 0), 0) || 1;
  const r = size / 2;
  const inner = r * 0.58;
  const cx = r;
  const cy = r;
  let angle = -Math.PI / 2;
  const arcs = segments.map((seg) => {
    const frac = (Number(seg.value) || 0) / total;
    const start = angle;
    const end = angle + frac * Math.PI * 2;
    angle = end;
    const large = frac > 0.5 ? 1 : 0;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const xi2 = cx + inner * Math.cos(end);
    const yi2 = cy + inner * Math.sin(end);
    const xi1 = cx + inner * Math.cos(start);
    const yi1 = cy + inner * Math.sin(start);
    return `<path d="M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${xi2},${yi2} A${inner},${inner} 0 ${large} 0 ${xi1},${yi1} Z" fill="${seg.color}" />`;
  }).join("");
  return `<svg class="donut" viewBox="0 0 ${size} ${size}" role="img" aria-label="구성 도넛 차트">${arcs}</svg>`;
}

/* ============================================================
   SUPPLY / VESTING MODEL (synthesized when vesting data absent)
   ============================================================ */
function buildSupplyModel(project) {
  // Cohorts: 커뮤니티 / 팀 / 재단 / VC. We don't have real vesting schedules,
  // so we synthesize a plausible monotonic vesting curve per cohort from its
  // allocation share. Community unlocks earliest/fastest; team & VC vest later.
  const alloc = project.unlocks?.allocation || {};
  const cohortDefs = [
    { key: "community", label: "커뮤니티", color: PALETTE[1], share: Number(alloc.community || 0), speed: 0.9 },
    { key: "team", label: "팀", color: PALETTE[0], share: Number(alloc.team || 0), speed: 0.4 },
    { key: "foundation", label: "재단", color: PALETTE[2], share: Number(alloc.foundation || 0), speed: 0.6 },
    { key: "vc", label: "VC", color: PALETTE[4], share: Number(alloc.vc || 0), speed: 0.35 },
  ];
  // 12 quarters: 2024-Q1 .. 2026-Q4 (monotonic logistic-ish unlock)
  const steps = 12;
  const axisLabels = [];
  for (let i = 0; i < steps; i++) {
    const year = 2024 + Math.floor(i / 4);
    const q = (i % 4) + 1;
    axisLabels.push(q === 1 ? `${year}` : `Q${q}`);
  }
  const cohorts = cohortDefs.map((c) => {
    const values = [];
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      // monotonic vesting fraction, faster cohorts approach full share sooner
      const vested = 1 - Math.exp(-c.speed * 6 * t);
      values.push(c.share * vested);
    }
    return { label: c.label, color: c.color, values };
  });
  return { cohorts, axisLabels };
}

function buildUnlockSchedule(project) {
  // Uniform rows derived from unlocks. Cohort = the largest-allocation cohort
  // as an illustrative attribution when no per-event cohort is provided.
  const unlocks = project.unlocks || {};
  const alloc = unlocks.allocation || {};
  const supplyTokens = project.circulatingSupplyPercent ? (project.marketCap / project.price) / project.circulatingSupplyPercent : null;
  const fdv = Number(project.fdv) || 0;

  const cohortOrder = [
    ["커뮤니티", Number(alloc.community || 0), PALETTE[1]],
    ["팀", Number(alloc.team || 0), PALETTE[0]],
    ["재단", Number(alloc.foundation || 0), PALETTE[2]],
    ["VC", Number(alloc.vc || 0), PALETTE[4]],
  ];

  const raw = [
    { date: unlocks.nextDate, usd: Number(unlocks.nextAmountUsd) || 0 },
    { date: addDays(unlocks.nextDate, 60), usd: Math.max((Number(unlocks.next90dUsd) || 0) - (Number(unlocks.nextAmountUsd) || 0), 0) },
    { date: addDays(unlocks.nextDate, 150), usd: Math.max((Number(unlocks.next180dUsd) || 0) - (Number(unlocks.next90dUsd) || 0), 0) },
  ].filter((r) => r.usd > 0);

  const rows = (raw.length ? raw : [{ date: unlocks.nextDate, usd: Number(unlocks.nextAmountUsd) || 0 }]).map((r, i) => {
    const cohort = cohortOrder[i % cohortOrder.length];
    const pctOfSupply = fdv > 0 ? r.usd / fdv : 0;
    const tokens = supplyTokens ? r.usd / project.price : null;
    return {
      date: r.date || "-",
      cohortLabel: cohort[0],
      cohortColor: cohort[2],
      pctOfSupply,
      usd: r.usd,
      tokens,
    };
  });
  return rows;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ============================================================
   TAB: 홈 (market overview)
   ============================================================ */
function renderHome() {
  const totalRevenue = sumThirty("revenue");
  const totalBuyback = sumThirty("buyback");
  const totalVolume = sumThirtyVolume();
  const buybackRate = totalRevenue > 0 ? totalBuyback / totalRevenue : 0;

  // sector donut (by marketCap, grouped by category)
  const catMap = new Map();
  for (const p of projects) catMap.set(p.category, (catMap.get(p.category) || 0) + (Number(p.marketCap) || 0));
  const catTotal = Array.from(catMap.values()).reduce((s, v) => s + v, 0) || 1;
  const sectors = Array.from(catMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([cat, cap], i) => ({ cat, cap, pct: cap / catTotal, color: PALETTE[i % PALETTE.length] }));

  // market temperature by signalType
  const buckets = { strong: 0, mid: 0, weak: 0 };
  for (const p of projects) {
    const t = applyDerivedSignal(p).signalType;
    if (t === "positive") buckets.strong++;
    else if (t === "warning") buckets.mid++;
    else buckets.weak++;
  }
  const tempTotal = projects.length || 1;
  const scored = [...projects].sort((a, b) => getProjectScore(b) - getProjectScore(a));
  const best = scored[0];
  const worst = scored.at(-1);

  const rankCards = [
    { title: "매출 상위", sub: "30일 프로토콜 매출", key: "revenue", fmt: (p) => formatCurrency(p.thirtyDay?.revenue), change: (p) => monthOverMonth(p.monthlyRevenue) },
    { title: "토큰 환원 상위", sub: "30일 토큰 환원", key: "buyback", fmt: (p) => formatCurrency(p.thirtyDay?.buyback), change: (p) => monthOverMonth(p.monthlyBuyback) },
    { title: "시가총액 상위", sub: "Market Cap", key: "marketCap", fmt: (p) => formatCurrency(p.marketCap), change: (p) => p.usage?.volumeChange30d ?? null },
  ];

  const rankCardHtml = rankCards.map((cfg) => {
    const sorted = [...projects].sort((a, b) => (Number(b.thirtyDay?.[cfg.key] ?? b[cfg.key]) || 0) - (Number(a.thirtyDay?.[cfg.key] ?? a[cfg.key]) || 0));
    const top5 = sorted.slice(0, 5);
    return `
      <div class="card">
        <div class="card-head">
          <div>
            <p class="card-title">${escapeHtml(cfg.title)}</p>
            <p class="card-sub">${escapeHtml(cfg.sub)}</p>
          </div>
        </div>
        <div class="rank-list">
          ${top5.map((p, i) => `
            <button class="rank-item" type="button" data-open-project="${escapeHtml(p.id)}">
              ${rankBadge(i)}
              <span class="meta">
                <span class="nm">${escapeHtml(p.name)}</span>
                <span class="sub">${escapeHtml(p.category)} · ${escapeHtml(valueCaptureLabel(p.valueCaptureType))}</span>
              </span>
              <span class="val">
                <b>${cfg.fmt(p)}</b>
                ${changeSpan(cfg.change(p))}
              </span>
            </button>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");

  return `
    <section class="tab-panel" id="panel-홈" role="tabpanel" aria-label="홈">
      <div class="hero">
        <div class="hero-top">
          <div>
            <h1 class="hero-title">오늘의 시장 요약</h1>
            <p class="hero-sub">추적 중인 ${projects.length}개 프로토콜의 수익·토큰 환원·거래량을 한눈에.</p>
          </div>
          <span class="date-pill"><i class="dot"></i>${todayStr()} 기준</span>
        </div>
        <div class="kpi-strip cells-4">
          <div class="kpi-cell">
            <p class="kpi-label">총 30일 매출</p>
            <div class="kpi-value">${formatCurrency(totalRevenue)}</div>
            <div class="kpi-sub">${projects.length}개 프로토콜 합산</div>
          </div>
          <div class="kpi-cell">
            <p class="kpi-label">총 토큰 환원</p>
            <div class="kpi-value">${formatCurrency(totalBuyback)}</div>
            <div class="kpi-sub pos">환원율 ${formatPercent(buybackRate)}</div>
          </div>
          <div class="kpi-cell">
            <p class="kpi-label">30일 거래량</p>
            <div class="kpi-value">${formatCurrency(totalVolume)}</div>
            <div class="kpi-sub">Volume · 일부 TVL 대체</div>
          </div>
          <div class="kpi-cell">
            <p class="kpi-label">추적 프로토콜</p>
            <div class="kpi-value">${projects.length}</div>
            <div class="kpi-sub">DeFi · 온체인</div>
          </div>
        </div>
      </div>

      <div class="row row-2">
        <div class="card">
          <div class="card-head">
            <div><p class="card-title">섹터 구성</p><p class="card-sub">시가총액 기준 카테고리 비중</p></div>
          </div>
          <div class="donut-card">
            ${svgDonut(sectors.map((s) => ({ value: s.cap, color: s.color })))}
            <div class="donut-legend">
              ${sectors.map((s) => `
                <div class="leg">
                  <i style="background:${s.color}"></i>
                  <span class="nm">${escapeHtml(s.cat)}</span>
                  <span class="pct">${formatPercent(s.pct, 0)}</span>
                </div>
              `).join("")}
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div><p class="card-title">시장 온도</p><p class="card-sub">토큰 수급 신호 분포</p></div>
          </div>
          <div class="temp-bar">
            <span class="temp-seg strong" style="flex:${buckets.strong || 0.001}"></span>
            <span class="temp-seg mid" style="flex:${buckets.mid || 0.001}"></span>
            <span class="temp-seg weak" style="flex:${buckets.weak || 0.001}"></span>
          </div>
          <div class="temp-counts">
            <span class="tc strong"><i></i>강함 <b>${buckets.strong}</b></span>
            <span class="tc mid"><i></i>보통 <b>${buckets.mid}</b></span>
            <span class="tc weak"><i></i>약함 <b>${buckets.weak}</b></span>
          </div>
          <div class="temp-extremes">
            <button class="temp-extreme" type="button" data-open-project="${escapeHtml(best.id)}" style="text-align:left;cursor:pointer">
              <p>최고 신호</p>
              <strong>${escapeHtml(best.name)}</strong>
              <span>${escapeHtml(applyDerivedSignal(best).signal)} · ${getProjectScore(best)}점</span>
            </button>
            <button class="temp-extreme" type="button" data-open-project="${escapeHtml(worst.id)}" style="text-align:left;cursor:pointer">
              <p>최저 신호</p>
              <strong>${escapeHtml(worst.name)}</strong>
              <span>${escapeHtml(applyDerivedSignal(worst).signal)} · ${getProjectScore(worst)}점</span>
            </button>
          </div>
        </div>
      </div>

      <div class="row row-3">
        ${rankCardHtml}
      </div>
    </section>
  `;
}

/* ============================================================
   TAB: 프로젝트 분석
   ============================================================ */
function renderAnalysis() {
  const project = getSelectedProject();
  const filtered = getFilteredProjects();
  const derived = applyDerivedSignal(project);
  const valuation = getValuation(project);
  const circ = project.circulatingSupplyPercent != null
    ? Number(project.circulatingSupplyPercent)
    : (project.fdv ? Number(project.marketCap) / Number(project.fdv) : null);

  // revenue monthly table
  const monthly = project.monthlyRevenue || [];
  const revRows = monthly.map((v, i) => {
    const prev = i > 0 ? monthly[i - 1] : null;
    const mom = prev ? (v - prev) / prev : null;
    return `
      <tr>
        <td>${escapeHtml(months[i] || `${i + 1}월`)}</td>
        <td>${formatCurrency(v * 1000000)}</td>
        <td class="${mom === null ? "" : mom >= 0 ? "pos" : "neg"}">${mom === null ? "-" : `${mom >= 0 ? "+" : ""}${formatPercent(mom)}`}</td>
      </tr>
    `;
  }).join("");

  const supply = buildSupplyModel(project);
  const unlockRows = buildUnlockSchedule(project);

  const chips = filtered.map((p) => `
    <button class="proj-chip${p.id === project.id ? " active" : ""}" type="button" data-select-project="${escapeHtml(p.id)}">
      ${escapeHtml(p.name)} <span class="tk">${escapeHtml(p.token)}</span>
    </button>
  `).join("") || `<p class="card-sub">검색 결과가 없습니다.</p>`;

  return `
    <section class="tab-panel" id="panel-프로젝트분석" role="tabpanel" aria-label="프로젝트 분석">
      <div class="card search-card">
        <div class="search-input-wrap">
          <span aria-hidden="true">⌕</span>
          <input id="analysisSearch" type="search" placeholder="프로젝트 검색 — 이름/토큰" value="${escapeHtml(state.search)}" aria-label="프로젝트 검색" />
        </div>
        <p class="search-note">목표는 모든 크립토 프로젝트를 다루는 것입니다. 현재는 추적 중인 프로젝트 목록을 검색하며, 추후 외부 코인 목록을 연동할 수 있도록 구성했습니다.</p>
        <div class="chip-row">${chips}</div>
      </div>

      <div class="hero">
        <div class="hero-top">
          <div>
            <h1 class="hero-title"><span class="hero-star">☆</span> ${escapeHtml(project.name)} <span class="hero-badge">${escapeHtml(project.token)}</span></h1>
            <p class="hero-sub">
              <span class="hero-badge">${escapeHtml(project.category)}</span>
              <span class="hero-badge">${escapeHtml(valueCaptureLabel(project.valueCaptureType))}</span>
            </p>
          </div>
          <span class="date-pill"><i class="dot"></i>${escapeHtml(project.lastUpdated || todayStr())}</span>
        </div>
        <div class="hero-mcap">
          <span class="label">시가총액</span>
          <span class="value">${formatCurrency(project.marketCap)}</span>
          <span class="change ${(project.usage?.volumeChange30d ?? 0) >= 0 ? "pos" : "neg"}">${(project.usage?.volumeChange30d ?? 0) >= 0 ? "+" : ""}${formatPercent(project.usage?.volumeChange30d ?? 0)}</span>
        </div>
        <div class="kpi-strip cells-6">
          ${[
            ["FDV", formatCurrency(project.fdv), "Fully diluted"],
            ["FDV/Revenue", formatRatio(valuation.fdvToRevenue), "밸류에이션 배수"],
            ["30d 매출", formatCurrency(project.thirtyDay?.revenue), "프로토콜 매출"],
            ["30d 환원", formatCurrency(project.thirtyDay?.buyback), "토큰 환원"],
            ["환원 수익률", formatPercent(getBuybackYield(project)), "연환산 / 시총"],
            ["유통률", formatPercent(circ, 0), "Circulating"],
          ].map(([label, value, sub]) => `
            <div class="kpi-cell">
              <p class="kpi-label">${escapeHtml(label)}</p>
              <div class="kpi-value">${escapeHtml(value)}</div>
              <div class="kpi-sub">${escapeHtml(sub)}</div>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div><p class="card-title">프로젝트 수익</p><p class="card-sub">월별 매출 추세 · ${escapeHtml(derived.signal)}</p></div>
          <div class="toggle-row">
            <button type="button" class="active">3M</button>
            <button type="button">6M</button>
            <button type="button">전체</button>
          </div>
        </div>
        <div class="revenue-split">
          <table class="rev-table">
            <thead><tr><th>월</th><th>매출</th><th>증감 MoM</th></tr></thead>
            <tbody>${revRows}</tbody>
          </table>
          <div class="chart-pad">
            ${areaChart(monthly, months, { color: "#16a34a", title: `${project.name} 월별 매출` })}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div><p class="card-title">총 토큰 유통량</p><p class="card-sub">코호트별 누적 공급 구성 (2024 → 2026)</p></div>
        </div>
        <div class="chart-pad">
          ${stackedAreaChart(supply.cohorts, supply.axisLabels, { title: `${project.name} 토큰 유통량 구성` })}
        </div>
        <div class="stack-legend">
          ${supply.cohorts.map((c) => `<span class="leg"><i style="background:${c.color}"></i>${escapeHtml(c.label)}</span>`).join("")}
        </div>
        <p class="model-note">정확한 베스팅 데이터가 없어 각 코호트의 배분 비중에서 단조 증가하는 베스팅 곡선을 모델링한 예시입니다.</p>
      </div>

      <div class="card">
        <div class="card-head">
          <div><p class="card-title">언락 일정</p><p class="card-sub">예정된 토큰 언락 · 날짜 · 코호트 · 공급 대비 · 금액</p></div>
        </div>
        <div class="unlock-list">
          ${unlockRows.map((r) => `
            <div class="unlock-row">
              <span class="u-date">${escapeHtml(r.date)}</span>
              <span class="u-cohort"><i style="background:${r.cohortColor}"></i>${escapeHtml(r.cohortLabel)}</span>
              <span class="u-pct">${r.pctOfSupply ? formatPercent(r.pctOfSupply, 2) : "-"}</span>
              <span class="u-amt">${formatCurrency(r.usd)}</span>
            </div>
          `).join("")}
        </div>
        <p class="model-note">집계 언락 데이터에서 도출한 일정이며, 코호트 귀속은 배분 비중 기준의 예시입니다.</p>
      </div>
    </section>
  `;
}

/* ============================================================
   TAB: 랭킹 (sortable table)
   ============================================================ */
const RANK_COLUMNS = [
  { key: "revenue", label: "24h Revenue", get: (p) => Number(p.daily?.revenue) || 0, fmt: (p) => formatCurrency(p.daily?.revenue) },
  { key: "fees", label: "24h Fees", get: (p) => Number(p.daily?.fees) || 0, fmt: (p) => formatCurrency(p.daily?.fees) },
  { key: "volume", label: "24h Volume", get: (p) => volumeOrTvl(p, "daily"), fmt: (p) => formatCurrency(volumeOrTvl(p, "daily")) },
  { key: "marketCap", label: "시가총액", get: (p) => Number(p.marketCap) || 0, fmt: (p) => formatCurrency(p.marketCap) },
  { key: "fdv", label: "FDV", get: (p) => Number(p.fdv) || 0, fmt: (p) => formatCurrency(p.fdv) },
  { key: "yield", label: "환원수익률", get: (p) => getBuybackYield(p), fmt: (p) => formatPercent(getBuybackYield(p)) },
];

const SORT_CHIPS = [
  { key: "revenue", label: "24h 매출" },
  { key: "fees", label: "24h 수수료" },
  { key: "volume", label: "거래량" },
  { key: "marketCap", label: "시가총액" },
];

function renderRanking() {
  const filtered = getFilteredProjects();
  const sortKey = state.rankSort;
  const col = RANK_COLUMNS.find((c) => c.key === sortKey) || RANK_COLUMNS[0];
  const sorted = [...filtered].sort((a, b) => col.get(b) - col.get(a));

  const headCells = RANK_COLUMNS.map((c) => `
    <th data-sort="${c.key}" class="${c.key === sortKey ? "active" : ""}">${escapeHtml(c.label)}${c.key === sortKey ? '<span class="arrow">▼</span>' : ""}</th>
  `).join("");

  const bodyRows = sorted.map((p, i) => `
    <tr data-open-project="${escapeHtml(p.id)}">
      <td class="left">${rankBadge(i)}</td>
      <td class="left">
        <span class="cell-name">
          <span>
            <span class="nm">${escapeHtml(p.name)}</span><br>
            <span class="sub">${escapeHtml(p.category)} · ${escapeHtml(p.token)}</span>
          </span>
        </span>
      </td>
      ${RANK_COLUMNS.map((c) => `<td class="${c.key === sortKey ? "active" : ""}">${c.fmt(p)}</td>`).join("")}
    </tr>
  `).join("");

  return `
    <section class="tab-panel" id="panel-랭킹" role="tabpanel" aria-label="랭킹">
      <div class="card search-card">
        <div class="search-input-wrap">
          <span aria-hidden="true">⌕</span>
          <input id="rankingSearch" type="search" placeholder="프로젝트 검색 — 이름/토큰" value="${escapeHtml(state.search)}" aria-label="프로젝트 검색" />
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div><p class="card-title">프로젝트 랭킹</p><p class="card-sub">DefiLlama 스타일 정렬 테이블 · 헤더 또는 칩으로 정렬</p></div>
        </div>
        <div class="sort-chips">
          ${SORT_CHIPS.map((c) => `<button type="button" class="sort-chip${c.key === sortKey ? " active" : ""}" data-sort="${c.key}">${escapeHtml(c.label)}${c.key === sortKey ? " ▼" : ""}</button>`).join("")}
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th class="left">#</th>
                <th class="left">프로젝트</th>
                ${headCells}
              </tr>
            </thead>
            <tbody>${bodyRows}</tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

/* ============================================================
   TAB: 설정
   ============================================================ */
function renderSettings() {
  const project = getSelectedProject();
  return `
    <section class="tab-panel" id="panel-설정" role="tabpanel" aria-label="설정">
      <div class="card">
        <div class="card-head">
          <div><p class="card-title">데이터 연동 설정</p><p class="card-sub">선택된 프로젝트: ${escapeHtml(project.name)}</p></div>
        </div>
        <div class="settings-grid">
          <div class="field">
            <label for="defillamaSlugInput">DefiLlama Protocol Slug</label>
            <input id="defillamaSlugInput" value="${escapeHtml(project.defillamaSlug || "")}" />
          </div>
          <div class="field">
            <label for="assistanceFundInput">Hyperliquid Assistance Fund</label>
            <input id="assistanceFundInput" value="${escapeHtml(project.assistanceFundAddress || "")}" placeholder="0x..." />
          </div>
          <div class="field">
            <label for="priceSourceInput">기준 가격 출처</label>
            <select id="priceSourceInput">
              ${["CoinGecko", "Hyperliquid API", "수동 입력"].map((o) => `<option${(project.priceSource || "CoinGecko") === o ? " selected" : ""}>${o}</option>`).join("")}
            </select>
          </div>
        </div>
        <button class="btn-primary" id="saveSettingsButton" type="button" style="margin-top:16px">설정 저장</button>
        <p class="disclaimer">DefiLlama 수익 데이터와 Hyperliquid 사용자 체결 데이터 호출을 브라우저에서 시도합니다. 브라우저 CORS 또는 네트워크 제한이 있으면 샘플 데이터로 자동 폴백됩니다.</p>
      </div>
    </section>
  `;
}

/* ============================================================
   NAV TABS + RENDER
   ============================================================ */
function renderTabs() {
  document.body.dataset.activeTab = state.activeTab;
  $("#navTabs").innerHTML = TABS.map((tab) => `
    <button class="nav-tab${tab === state.activeTab ? " active" : ""}" type="button" role="tab" aria-selected="${tab === state.activeTab}" data-tab="${escapeHtml(tab)}">${escapeHtml(tab)}</button>
  `).join("");

  $$("#navTabs .nav-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeTab = btn.dataset.tab;
      render();
    });
  });
}

function renderActiveTab() {
  const main = $("#appMain");
  let html = "";
  if (state.activeTab === "홈") html = renderHome();
  else if (state.activeTab === "프로젝트 분석") html = renderAnalysis();
  else if (state.activeTab === "랭킹") html = renderRanking();
  else if (state.activeTab === "설정") html = renderSettings();
  main.innerHTML = `<p class="data-status" id="dataStatus" role="status">${escapeHtml(state.status)}</p>${html}`;
  bindTabEvents();
}

function bindTabEvents() {
  // open a project in 프로젝트 분석
  $$("[data-open-project]").forEach((el) => {
    el.addEventListener("click", () => {
      state.selectedProjectId = el.dataset.openProject;
      state.activeTab = "프로젝트 분석";
      render();
    });
  });

  // select a project chip (stay on analysis)
  $$("[data-select-project]").forEach((el) => {
    el.addEventListener("click", () => {
      state.selectedProjectId = el.dataset.selectProject;
      render();
    });
  });

  // analysis search (preserve focus + caret)
  const aSearch = $("#analysisSearch");
  if (aSearch) {
    aSearch.addEventListener("input", (e) => {
      state.search = e.target.value;
      const pos = e.target.selectionStart;
      renderActiveTab();
      const re = $("#analysisSearch");
      if (re) {
        re.focus();
        re.setSelectionRange(pos, pos);
      }
    });
  }

  // ranking search
  const rSearch = $("#rankingSearch");
  if (rSearch) {
    rSearch.addEventListener("input", (e) => {
      state.search = e.target.value;
      const pos = e.target.selectionStart;
      renderActiveTab();
      const re = $("#rankingSearch");
      if (re) {
        re.focus();
        re.setSelectionRange(pos, pos);
      }
    });
  }

  // ranking sort (header th + chips)
  $$("[data-sort]").forEach((el) => {
    el.addEventListener("click", () => {
      state.rankSort = el.dataset.sort;
      renderActiveTab();
    });
  });

  // settings save
  const saveBtn = $("#saveSettingsButton");
  if (saveBtn) saveBtn.addEventListener("click", saveSettings);
}

function syncGlobalSearch() {
  const g = $("#globalSearch");
  if (g && g.value !== state.search) g.value = state.search;
}

function render() {
  renderTabs();
  renderActiveTab();
  syncGlobalSearch();
  const refreshBtn = $("#refreshButton");
  if (refreshBtn) {
    refreshBtn.textContent = state.isRefreshing ? "갱신 중..." : "데이터 새로고침";
    refreshBtn.disabled = state.isRefreshing;
  }
}

function initEvents() {
  $("#refreshButton").addEventListener("click", refreshSelectedProject);
  $("#globalSearch").addEventListener("input", (e) => {
    state.search = e.target.value;
    if (state.activeTab !== "프로젝트 분석" && state.activeTab !== "랭킹") {
      state.activeTab = "랭킹";
    }
    render();
    const g = $("#globalSearch");
    if (g) {
      g.focus();
      const pos = String(e.target.value).length;
      g.setSelectionRange(pos, pos);
    }
  });
}

initEvents();
render();

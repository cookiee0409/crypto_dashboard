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

const state = {
  selectedProjectId: "hyperliquid",
  category: "전체",
  search: "",
  activeTab: "home",
  homeRank: "marketCap",
  activeSummaryRank: null,
  chartRange: "1y",
  compareSort: "revenue",
  isRefreshing: false,
  status: "샘플 데이터 표시 중 · 데이터 새로고침을 누르면 공개 API 연동을 시도합니다.",
};

const months = ["1월", "2월", "3월", "4월", "5월", "6월"];
const rangeOptions = [
  { key: "1m", label: "1개월", days: 30 },
  { key: "6m", label: "6개월", days: 182 },
  { key: "1y", label: "1년", days: 365 },
];
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

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

function renderMetricCells(items) {
  return items
    .map((item) => `
      <div class="metric-item">
        <p>${escapeHtml(item.label)}</p>
        <strong>${escapeHtml(item.value)}</strong>
        <span>${escapeHtml(item.sub || "")}</span>
      </div>
    `)
    .join("");
}

function getRangeOption(key) {
  return rangeOptions.find((option) => option.key === key) || rangeOptions[2];
}

function renderSegmentedControl(name, options, activeKey) {
  return `
    <div class="segmented-control" role="group" aria-label="${escapeHtml(name)}">
      ${options.map((option) => `
        <button class="segment ${option.key === activeKey ? "active" : ""}" data-control="${escapeHtml(name)}" data-value="${escapeHtml(option.key)}" type="button">${escapeHtml(option.label)}</button>
      `).join("")}
    </div>
  `;
}

function expandMonthlySeries(monthlyValues = [], rangeKey = "6m") {
  const range = getRangeOption(rangeKey);
  const pointCount = range.key === "1m" ? 30 : range.key === "6m" ? 26 : 52;
  const values = monthlyValues.length ? monthlyValues.map((value) => Number(value) || 0) : [0];
  const monthCount = Math.max(values.length, 1);
  const slope = values.length > 1 ? values.at(-1) - values[0] : 0;
  const seed = values.reduce((sum, value, index) => sum + value * (index + 3), 0) || 1;
  const now = Date.now();
  const stepMs = (range.days * 24 * 60 * 60 * 1000) / Math.max(pointCount - 1, 1);

  return Array.from({ length: pointCount }, (_, index) => {
    const position = pointCount === 1 ? 1 : index / (pointCount - 1);
    const monthPosition = position * (monthCount - 1);
    const left = Math.floor(monthPosition);
    const right = Math.min(left + 1, monthCount - 1);
    const mix = monthPosition - left;
    let value = values[left] * (1 - mix) + values[right] * mix;
    if (range.key === "1y") {
      const backfill = Math.max(0.45, 1 - (1 - position) * 0.32);
      value = (value - slope * 0.32 * (1 - position)) * backfill;
    }
    if (range.key === "7d" || range.key === "1m") {
      const base = values.at(-1);
      const prior = values.at(-2) ?? base;
      value = prior + (base - prior) * position;
    }
    const wave = Math.sin(index * 1.7 + seed) * 0.025 + Math.cos(index * 0.61 + seed) * 0.018;
    const scaled = Math.max(0, value * (1 + wave));
    const timestamp = new Date(now - (pointCount - 1 - index) * stepMs);
    const label = timestamp.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
    return { label, value: scaled };
  });
}

function chartSummary(series = []) {
  const first = series[0]?.value || 0;
  const last = series.at(-1)?.value || 0;
  const high = Math.max(...series.map((point) => point.value), 0);
  const low = Math.min(...series.map((point) => point.value), 0);
  const change = first ? (last - first) / first : 0;
  return { first, last, high, low, change };
}

function sumMillions(values = []) {
  return values.reduce((sum, value) => sum + (Number(value) || 0), 0) * 1000000;
}

function monthOverMonth(values = []) {
  const current = Number(values.at(-1)) || 0;
  const previous = Number(values.at(-2)) || 0;
  return previous ? (current - previous) / previous : 0;
}

function annualizedRevenueYield(project) {
  const revenue = Number(project.thirtyDay?.revenue) || 0;
  return project.marketCap ? (revenue * 12) / project.marketCap : 0;
}

function createDashboardLineChart(series, title, unitLabel = "수익", project = null) {
  const values = series.map((point) => Number(point.value) || 0);
  if (!values.length) return `<div class="empty-chart">표시할 데이터가 없습니다.</div>`;
  const width = 920;
  const height = 300;
  const padding = { top: 24, right: 78, bottom: 44, left: 62 };
  const max = Math.max(...values, 1) * 1.12;
  const min = Math.min(...values, 0) * 0.9;
  const yieldValues = project?.marketCap ? values.map((value) => ((value * 1000000) * 12) / project.marketCap) : [];
  const yieldMax = Math.max(...yieldValues, 0.01) * 1.12;
  const yieldMin = Math.min(...yieldValues, 0) * 0.9;
  const denominator = Math.max(values.length - 1, 1);
  const xScale = (index) => padding.left + (index / denominator) * (width - padding.left - padding.right);
  const yScale = (value) => height - padding.bottom - ((value - min) / Math.max(max - min, 1)) * (height - padding.top - padding.bottom);
  const yieldScale = (value) => height - padding.bottom - ((value - yieldMin) / Math.max(yieldMax - yieldMin, 0.01)) * (height - padding.top - padding.bottom);
  const line = values.map((value, index) => `${index === 0 ? "M" : "L"}${xScale(index)},${yScale(value)}`).join(" ");
  const yieldLine = yieldValues.map((value, index) => `${index === 0 ? "M" : "L"}${xScale(index)},${yieldScale(value)}`).join(" ");
  const area = `${line} L${xScale(values.length - 1)},${height - padding.bottom} L${xScale(0)},${height - padding.bottom} Z`;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => min + (max - min) * ratio);
  const yieldTicks = [0, 0.5, 1].map((ratio) => yieldMin + (yieldMax - yieldMin) * ratio);
  const labelStep = Math.max(1, Math.floor(series.length / 5));

  return `
    <div class="dashboard-line-chart">
      <svg class="chart-svg clean-line-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(title)}">
        <title>${escapeHtml(title)}</title>
        ${yTicks.map((tick) => {
          const y = yScale(tick);
          return `
            <line class="chart-axis" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" />
            <text class="chart-y-label" x="${width - padding.right + 10}" y="${y + 4}">$${tick.toFixed(1)}M</text>
          `;
        }).join("")}
        <path class="area-path revenue-area" d="${area}" />
        <path class="line-path" d="${line}" />
        ${yieldValues.length ? `
          <path class="line-path yield-line" d="${yieldLine}" />
          ${yieldTicks.map((tick) => `<text class="chart-y-label yield-label" x="${padding.left - 10}" y="${yieldScale(tick) + 4}" text-anchor="end">${formatPercent(tick, 1)}</text>`).join("")}
        ` : ""}
        ${values.map((value, index) => index % labelStep === 0 || index === values.length - 1 ? `
          <circle class="chart-dot" cx="${xScale(index)}" cy="${yScale(value)}" r="4" />
          <text class="chart-label" x="${xScale(index)}" y="${height - 13}" text-anchor="middle">${escapeHtml(series[index]?.label || "")}</text>
        ` : "").join("")}
      </svg>
      <div class="chart-axis-caption">
        <span><i class="legend-revenue"></i>수익 금액</span>
        <span><i class="legend-yield"></i>연환산 수익/시총</span>
        <span>Y축: ${escapeHtml(unitLabel)}(USD)</span>
      </div>
    </div>
  `;
}

function createSimpleBarChart(values, labels, title) {
  const cleanValues = values.map((value) => Number(value) || 0);
  const max = Math.max(...cleanValues, 1);
  return `
    <div class="simple-bar-chart" role="img" aria-label="${escapeHtml(title)}">
      ${cleanValues.map((value, index) => `
        <div class="simple-bar">
          <strong>${formatCurrency(value * 1000000)}</strong>
          <i style="--h:${Math.max(4, (value / max) * 100)}%"></i>
          <span>${escapeHtml(labels[index] || "")}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderAllocationDonut(project) {
  const allocation = project.unlocks?.allocation || {};
  const team = Number(allocation.team || 0) * 100;
  const vc = Number(allocation.vc || 0) * 100;
  const foundation = Number(allocation.foundation || 0) * 100;
  const community = Number(allocation.community || 0) * 100;
  return `
    <div class="allocation-donut-card">
      <div class="allocation-donut" style="--team:${team}; --vc:${team + vc}; --foundation:${team + vc + foundation};"></div>
      <div class="allocation-donut-legend">
        <span><i class="team"></i>팀 ${team.toFixed(0)}%</span>
        <span><i class="vc"></i>VC ${vc.toFixed(0)}%</span>
        <span><i class="foundation"></i>재단 ${foundation.toFixed(0)}%</span>
        <span><i class="community"></i>커뮤니티 ${community.toFixed(0)}%</span>
      </div>
    </div>
  `;
}

const summaryRankConfig = {
  revenue: {
    kicker: "Revenue Ranking",
    title: "30일 매출 Top 10",
    columns: ["순위", "프로젝트", "카테고리", "30일 매출", "시가총액", "FDV/Revenue"],
    sort: (a, b) => (b.thirtyDay?.revenue || 0) - (a.thirtyDay?.revenue || 0),
    cells: (project) => [
      formatCurrency(project.thirtyDay?.revenue),
      formatCurrency(project.marketCap),
      formatRatio(getValuation(project).fdvToRevenue),
    ],
  },
  buyback: {
    kicker: "Token Return Ranking",
    title: "30일 토큰 환원 Top 10",
    columns: ["순위", "프로젝트", "카테고리", "30일 토큰 환원", "Holder Revenue", "환원 방식"],
    sort: (a, b) => (b.thirtyDay?.buyback || 0) - (a.thirtyDay?.buyback || 0),
    cells: (project) => [
      formatCurrency(project.thirtyDay?.buyback),
      formatCurrency(project.thirtyDay?.holderRevenue),
      valueCaptureLabel(project.valueCaptureType),
    ],
  },
  buybackYield: {
    kicker: "Buyback Yield Ranking",
    title: "환원 수익률 Top 10",
    columns: ["순위", "프로젝트", "카테고리", "환원 수익률", "연환산 환원", "시가총액"],
    sort: (a, b) => getBuybackYield(b) - getBuybackYield(a),
    cells: (project) => [
      formatPercent(getBuybackYield(project)),
      formatCurrency(getAnnualizedBuyback(project)),
      formatCurrency(project.marketCap),
    ],
  },
  unlockRisk: {
    kicker: "Unlock Risk Ranking",
    title: "언락 위험 Top 10",
    columns: ["순위", "프로젝트", "카테고리", "언락 위험", "압력", "90일 언락"],
    sort: (a, b) => getUnlockRisk(b).score - getUnlockRisk(a).score || getUnlockPressureRatio(b) - getUnlockPressureRatio(a),
    cells: (project) => [
      getUnlockRisk(project).label,
      `${getUnlockPressureRatio(project).toFixed(2)}일치`,
      formatCurrency(project.unlocks?.next90dUsd),
    ],
  },
  fdvRevenue: {
    kicker: "Valuation Ranking",
    title: "FDV/Revenue 낮은 순 Top 10",
    columns: ["순위", "프로젝트", "카테고리", "FDV/Revenue", "FDV", "연환산 매출"],
    sort: (a, b) => (getValuation(a).fdvToRevenue ?? Infinity) - (getValuation(b).fdvToRevenue ?? Infinity),
    cells: (project) => {
      const valuation = getValuation(project);
      return [
        formatRatio(valuation.fdvToRevenue),
        formatCurrency(project.fdv),
        formatCurrency(valuation.annualizedRevenue),
      ];
    },
  },
  usageGrowth: {
    kicker: "Usage Growth Ranking",
    title: "실사용 성장 Top 10",
    columns: ["순위", "프로젝트", "카테고리", "6개월 성장", "MAU", "사용량 추세"],
    sort: (a, b) => getTrend(b.usage?.userGrowth6m || []) - getTrend(a.usage?.userGrowth6m || []),
    cells: (project) => [
      formatPercent(getTrend(project.usage?.userGrowth6m || [])),
      formatNumber(project.usage?.mau),
      getUsageTrendLabel(project.usage?.usageTrend).label,
    ],
  },
};

function shortHash(hash) {
  if (!hash) return "-";
  const value = String(hash);
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

function isValidEvmAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "").trim());
}

function getSelectedProject() {
  return projects.find((project) => project.id === state.selectedProjectId) || projects[0];
}

function getFilteredProjects() {
  return projects.filter((project) => {
    const matchCategory = state.category === "전체" || project.category === state.category;
    const keyword = state.search.trim().toLowerCase();
    return matchCategory && (!keyword || `${project.name} ${project.token} ${project.category}`.toLowerCase().includes(keyword));
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

function buybackTypeLabel(type) {
  if (type === "actual_onchain") return "실제 체결";
  if (type === "actual_disclosed") return "공개 집계";
  return "추정 모델";
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
  project.defillamaSlug = $("#defillamaSlugInput").value.trim() || project.defillamaSlug;
  project.assistanceFundAddress = $("#assistanceFundInput").value.trim();
  project.priceSource = $("#priceSourceInput").value;
  state.status = `${project.name} 설정 저장 완료 · 새로고침 시 해당 값으로 API를 호출합니다.`;
  render();
}

function renderDataStatus() {
  $("#dataStatus").textContent = state.status;
}

function renderSummaryCards() {
  const highlights = getDashboardHighlights(projects);
  const cards = [
    { rank: "revenue", label: "30일 매출 1위", value: highlights.byRevenue?.name, sub: formatCurrency(highlights.byRevenue?.thirtyDay?.revenue) },
    { rank: "buyback", label: "30일 토큰 환원 1위", value: highlights.byBuyback?.name, sub: formatCurrency(highlights.byBuyback?.thirtyDay?.buyback) },
    { rank: "buybackYield", label: "환원 수익률 1위", value: highlights.byYield?.name, sub: formatPercent(getBuybackYield(highlights.byYield)) },
    { rank: "unlockRisk", label: "언락 위험 최고", value: highlights.byUnlock?.name, sub: `${getUnlockRisk(highlights.byUnlock).label} · ${getUnlockPressureRatio(highlights.byUnlock).toFixed(2)}일치` },
    { rank: "fdvRevenue", label: "FDV/Revenue 저평가", value: highlights.byCheap?.name, sub: formatRatio(getValuation(highlights.byCheap).fdvToRevenue) },
    { rank: "usageGrowth", label: "실사용 성장 1위", value: highlights.byUsage?.name, sub: getTrendLabel(highlights.byUsage?.usage?.userGrowth6m || []).label },
  ];

  $("#summaryCards").innerHTML = cards
    .map((card) => `
      <article class="summary-card clickable ${state.activeSummaryRank === card.rank ? "active" : ""}" data-rank="${escapeHtml(card.rank)}" tabindex="0" role="button" aria-label="${escapeHtml(card.label)} 랭킹 열기">
        <p class="label">${escapeHtml(card.label)}</p>
        <div class="value">${escapeHtml(card.value)}</div>
        <div class="sub">${escapeHtml(card.sub)}</div>
      </article>
    `)
    .join("");

  $$("#summaryCards .summary-card").forEach((card) => {
    const open = () => {
      state.activeSummaryRank = card.dataset.rank;
      state.activeTab = "home";
      renderTabs();
      renderSummaryRankPanel();
      renderSummaryCards();
    };
    card.addEventListener("click", open);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  });
}

function renderSummaryRankPanel() {
  const rankKey = state.activeSummaryRank;
  const config = summaryRankConfig[rankKey];
  const panel = $("#summaryRankPanel");
  if (!config) {
    panel.classList.add("hidden");
    $("#summaryRankHead").innerHTML = "";
    $("#summaryRankBody").innerHTML = "";
    return;
  }

  const ranked = [...projects].sort(config.sort).slice(0, 10);
  $("#summaryRankKicker").textContent = config.kicker;
  $("#summaryRankTitle").textContent = config.title;
  $("#summaryRankHead").innerHTML = `
    <tr>
      ${config.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}
    </tr>
  `;
  $("#summaryRankBody").innerHTML = ranked
    .map((project, index) => {
      const cells = config.cells(project);
      return `
        <tr class="summary-rank-row" data-project-id="${escapeHtml(project.id)}" tabindex="0" role="button" aria-label="${escapeHtml(project.name)} 상세 대시보드로 이동">
          <td class="rank-num">${index + 1}</td>
          <td class="rank-name">${escapeHtml(project.name)}<span class="subtext">${escapeHtml(project.token)}</span></td>
          <td>${escapeHtml(project.category)}</td>
          ${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}
        </tr>
      `;
    })
    .join("");
  panel.classList.remove("hidden");

  $$("#summaryRankBody .summary-rank-row").forEach((row) => {
    const open = () => {
      state.selectedProjectId = row.dataset.projectId;
      state.activeTab = "dashboard";
      state.activeSummaryRank = null;
      render();
    };
    row.addEventListener("click", open);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  });
}

function homeRankValue(project, key) {
  if (key === "revenue") return Number(project.thirtyDay?.revenue) || 0;
  return Number(project.marketCap) || 0;
}

function renderHome() {
  const key = state.homeRank;
  $$("#homeRankToggle .chip").forEach((chip) => chip.classList.toggle("active", chip.dataset.rank === key));

  const caption = {
    marketCap: "시가총액(Market Cap) 높은 순으로 정렬했습니다. 토글로 매출 기준 순위로 전환할 수 있습니다.",
    revenue: "최근 30일 프로토콜 매출 높은 순으로 정렬했습니다. 토글로 시가총액 기준 순위로 전환할 수 있습니다.",
  };
  $("#homeRankCaption").textContent = caption[key];

  const sorted = [...projects].sort((a, b) => homeRankValue(b, key) - homeRankValue(a, key));
  const mcapActive = key === "marketCap" ? " rank-active" : "";
  const revenueActive = key === "revenue" ? " rank-active" : "";

  const head = `
    <thead>
      <tr>
        <th>#</th>
        <th>프로젝트</th>
        <th>카테고리</th>
        <th class="num${mcapActive}">시가총액</th>
        <th class="num">FDV</th>
        <th class="num${revenueActive}">30d 매출</th>
        <th class="num">30d 토큰 환원</th>
        <th class="num">환원 수익률</th>
        <th>토큰 수급</th>
      </tr>
    </thead>`;

  const body = sorted
    .map((project, index) => {
      const derived = applyDerivedSignal(project);
      return `
        <tr class="rank-row ${project.id === state.selectedProjectId ? "active" : ""}" data-project-id="${escapeHtml(project.id)}" tabindex="0" role="button" aria-label="${escapeHtml(project.name)} 상세 보기">
          <td class="rank-num">${index + 1}</td>
          <td class="rank-name">${escapeHtml(project.name)}<span class="subtext">${escapeHtml(project.token)}</span></td>
          <td>${escapeHtml(project.category)}</td>
          <td class="num${mcapActive}">${formatCurrency(project.marketCap)}</td>
          <td class="num">${formatCurrency(project.fdv)}</td>
          <td class="num${revenueActive}">${formatCurrency(project.thirtyDay.revenue)}</td>
          <td class="num">${formatCurrency(project.thirtyDay.buyback)}</td>
          <td class="num">${formatPercent(getBuybackYield(project))}</td>
          <td><span class="pill ${derived.signalType}" title="${escapeHtml(derived.signal)}">${derived.score}</span></td>
        </tr>
      `;
    })
    .join("");

  $("#homeTable").innerHTML = `${head}<tbody>${body}</tbody>`;

  $$("#homeTable .rank-row").forEach((row) => {
    const open = () => {
      state.selectedProjectId = row.dataset.projectId;
      state.activeTab = "dashboard";
      state.activeSummaryRank = null;
      render();
    };
    row.addEventListener("click", open);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  });
}

function renderCategoryFilter() {
  const categories = ["전체", ...new Set(projects.map((project) => project.category))];
  $("#categoryFilter").innerHTML = categories
    .map((category) => `<button class="category-button ${state.category === category ? "active" : ""}" data-category="${escapeHtml(category)}" type="button">${escapeHtml(category)}</button>`)
    .join("");

  $$(".category-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.category = button.dataset.category;
      render();
    });
  });
}

function renderProjectList() {
  const filtered = getFilteredProjects();
  $("#projectCount").textContent = `${filtered.length}개`;
  $("#projectList").innerHTML = filtered
    .map((project) => {
      const derived = applyDerivedSignal(project);
      return `
        <button class="project-card ${state.selectedProjectId === project.id ? "active" : ""}" data-project-id="${escapeHtml(project.id)}" type="button">
          <div class="project-card-header">
            <span class="project-list-avatar" aria-hidden="true">${escapeHtml(project.token?.slice(0, 1) || project.name.slice(0, 1))}</span>
            <div class="project-card-copy">
              <strong>${escapeHtml(project.name)}</strong>
              <span>${escapeHtml(project.token)} · ${escapeHtml(project.category)}</span>
            </div>
            <span class="project-score-chip ${derived.signalType}" aria-label="${escapeHtml(derived.signal)} ${derived.score}점">${derived.score}</span>
          </div>
          <div class="project-card-metrics">
            <div><small>7d Rev</small><b>${formatCurrency(project.sevenDay.revenue)}</b></div>
            <div><small>30d Return</small><b>${formatCurrency(project.thirtyDay.buyback)}</b></div>
          </div>
        </button>
      `;
    })
    .join("");

  $$(".project-card").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedProjectId = card.dataset.projectId;
      render();
    });
  });
}

function renderProjectHero(project) {
  const derived = applyDerivedSignal(project);
  const projection = getProjection(project);
  const sixMonthRevenue = project.monthlyRevenue.reduce((sum, value) => sum + (Number(value) || 0), 0) * 1000000;
  const supplyHealth = Math.max(0, 100 - getUnlockRisk(project).score);
  $("#projectTitle").innerHTML = `
    <span class="project-avatar" aria-hidden="true">${escapeHtml(project.token?.slice(0, 1) || project.name.slice(0, 1))}</span>
    <span class="project-title-copy">
      <span>${escapeHtml(project.name)} / ${escapeHtml(project.token)}</span>
      <small>${escapeHtml(project.category)} · ${escapeHtml(valueCaptureLabel(project.valueCaptureType))}</small>
    </span>
  `;
  $("#projectSignal").textContent = `${derived.signal} · ${derived.score}점`;
  $("#projectSignal").className = `pill ${derived.signalType}`;
  $("#projectSignal").setAttribute("aria-label", `토큰 수급 진단 ${derived.signal}, 점수 ${derived.score}점`);
  $("#projectDescription").textContent = project.description;
  $("#lastUpdated").textContent = project.lastUpdated;
  $("#projectSourceLinks").innerHTML = (project.sourceLinks || [])
    .map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>`)
    .join("");

  const metrics = [
    { label: "6개월 수익", value: formatCurrency(sixMonthRevenue), sub: `${getTrendLabel(project.monthlyRevenue).label} · vs 이전 6개월`, spark: renderSparkline(project.monthlyRevenue, `${project.name} 6개월 수익`) },
    { label: "6개월 예상 환원", value: formatCurrency(projection.baseUsd), sub: `${buybackTypeLabel(project.buybackType)} 기준`, spark: renderSparkline(project.monthlyBuyback, `${project.name} 6개월 환원`) },
    { label: "토큰 수급 점수", value: `${derived.score}`, sub: `/100 · ${derived.signal}`, meter: derived.score },
    { label: "보유 구조 건강도", value: `${supplyHealth}`, sub: `/100 · ${getUnlockRisk(project).label}`, meter: supplyHealth, tone: "blue" },
  ];

  $("#projectMetrics").innerHTML = metrics
    .map((metric) => `
      <div class="metric-item">
        <p>${escapeHtml(metric.label)}</p>
        <strong>${escapeHtml(metric.value)}</strong>
        <span>${escapeHtml(metric.sub)}</span>
        ${metric.spark ? `<div class="kpi-spark">${metric.spark}</div>` : ""}
        ${metric.meter !== undefined ? `<div class="kpi-meter ${metric.tone || ""}" style="--score:${Math.max(0, Math.min(100, Number(metric.meter) || 0))}"></div>` : ""}
      </div>
    `)
    .join("");
}

function renderBadge(label, type = "muted") {
  return `<span class="pill ${type}">${escapeHtml(label)}</span>`;
}

function renderValueFlow(project) {
  return `
    <div class="flow-row">
      ${(project.valueFlow || []).map((step) => `<span>${escapeHtml(step)}</span>`).join("<b>→</b>")}
    </div>
  `;
}

function renderAllocation(allocation = {}) {
  const items = [
    ["팀", allocation.team],
    ["VC", allocation.vc],
    ["재단", allocation.foundation],
    ["커뮤니티", allocation.community],
  ];
  return `
    <div class="allocation-bars">
      ${items.map(([label, value]) => `
        <div>
          <span>${escapeHtml(label)}</span>
          <strong>${formatPercent(value || 0, 0)}</strong>
          <i style="--w:${Math.max(2, Number(value || 0) * 100)}%"></i>
        </div>
      `).join("")}
    </div>
  `;
}

function percentWidth(value, max, min = 2) {
  if (!max || Number.isNaN(Number(max))) return min;
  return Math.max(min, Math.min(100, (Number(value || 0) / max) * 100));
}

function renderSparkline(values = [], title = "추세") {
  const cleanValues = values.map((value) => Number(value) || 0);
  if (!cleanValues.length) return `<div class="empty-mini-chart">데이터 없음</div>`;
  const width = 220;
  const height = 54;
  const max = Math.max(...cleanValues, 1);
  const min = Math.min(...cleanValues);
  const span = Math.max(max - min, 1);
  const denominator = Math.max(cleanValues.length - 1, 1);
  const points = cleanValues.map((value, index) => {
    const x = (index / denominator) * (width - 10) + 5;
    const y = height - 8 - ((value - min) / span) * (height - 16);
    return [x, y];
  });
  const line = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x},${y}`).join(" ");
  return `
    <svg class="mini-sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
      <title>${escapeHtml(title)}</title>
      <path d="${line}" />
    </svg>
  `;
}

function createDualLineChart(primaryValues, secondaryValues, labels, title) {
  const primary = primaryValues.map((value) => Number(value) || 0);
  const secondary = secondaryValues.map((value) => Number(value) || 0);
  const allValues = [...primary, ...secondary];
  if (!allValues.length) return `<div class="empty-chart">표시할 데이터가 없습니다.</div>`;
  const width = 860;
  const height = 300;
  const padding = { top: 24, right: 28, bottom: 38, left: 52 };
  const max = Math.max(...allValues, 1) * 1.16;
  const min = Math.min(...allValues, 0);
  const denominator = Math.max(Math.max(primary.length, secondary.length) - 1, 1);
  const xScale = (index) => padding.left + (index / denominator) * (width - padding.left - padding.right);
  const yScale = (value) => height - padding.bottom - ((value - min) / Math.max(max - min, 1)) * (height - padding.top - padding.bottom);
  const toLine = (values) => values.map((value, index) => `${index === 0 ? "M" : "L"}${xScale(index)},${yScale(value)}`).join(" ");

  return `
    <svg class="chart-svg dual-line-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(title)}">
      <title>${escapeHtml(title)}</title>
      ${[0, 1, 2, 3].map((item) => {
        const y = padding.top + item * ((height - padding.top - padding.bottom) / 3);
        return `<line class="chart-axis" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" />`;
      }).join("")}
      <path class="line-path" d="${toLine(primary)}" />
      <path class="line-path secondary" d="${toLine(secondary)}" />
      ${primary.map((value, index) => `
        <circle class="chart-dot" cx="${xScale(index)}" cy="${yScale(value)}" r="4" />
        <text class="chart-label" x="${xScale(index)}" y="${height - 13}" text-anchor="middle">${escapeHtml(labels[index] || "")}</text>
      `).join("")}
      ${secondary.map((value, index) => `<circle class="chart-dot secondary" cx="${xScale(index)}" cy="${yScale(value)}" r="4" />`).join("")}
    </svg>
  `;
}

function createDualSeriesChart(primarySeries, secondarySeries, title) {
  const primary = primarySeries.map((point) => Number(point.value) || 0);
  const secondary = secondarySeries.map((point) => Number(point.value) || 0);
  const labels = primarySeries.map((point) => point.label);
  const allValues = [...primary, ...secondary];
  if (!allValues.length) return `<div class="empty-chart">표시할 데이터가 없습니다.</div>`;
  const width = 920;
  const height = 310;
  const padding = { top: 24, right: 78, bottom: 44, left: 62 };
  const max = Math.max(...allValues, 1) * 1.14;
  const min = Math.min(...allValues, 0) * 0.92;
  const denominator = Math.max(primary.length - 1, 1);
  const xScale = (index) => padding.left + (index / denominator) * (width - padding.left - padding.right);
  const yScale = (value) => height - padding.bottom - ((value - min) / Math.max(max - min, 1)) * (height - padding.top - padding.bottom);
  const toLine = (values) => values.map((value, index) => `${index === 0 ? "M" : "L"}${xScale(index)},${yScale(value)}`).join(" ");
  const toArea = (values) => `${toLine(values)} L${xScale(values.length - 1)},${height - padding.bottom} L${xScale(0)},${height - padding.bottom} Z`;
  const labelStep = Math.max(1, Math.floor(labels.length / 5));
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => min + (max - min) * ratio);
  const barMax = Math.max(...secondary, 1);
  const zoneWidth = (width - padding.left - padding.right) / denominator;
  const summary = chartSummary(primarySeries);

  return `
    <div class="financial-chart" data-chart-kind="dual">
      <div class="chart-hover-tooltip" role="status"></div>
      <div class="chart-top-readout">
        <span>${escapeHtml(title)}</span>
        <strong>${summary.change >= 0 ? "+" : ""}${formatPercent(summary.change)}</strong>
      </div>
      <svg class="chart-svg analysis-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(title)}">
        <title>${escapeHtml(title)}</title>
        ${yTicks.map((tick) => {
          const y = yScale(tick);
          return `
            <line class="chart-axis" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" />
            <text class="chart-y-label" x="${width - padding.right + 10}" y="${y + 4}">$${tick.toFixed(1)}M</text>
          `;
        }).join("")}
        ${secondary.map((value, index) => {
          const x = xScale(index) - Math.max(2, zoneWidth * 0.18);
          const barHeight = Math.max(2, (value / barMax) * 46);
          return `<rect class="chart-volume-bar" x="${x}" y="${height - padding.bottom - barHeight}" width="${Math.max(2, zoneWidth * 0.36)}" height="${barHeight}" rx="2" />`;
        }).join("")}
        <path class="area-path revenue-area" d="${toArea(primary)}" />
        <path class="area-path return-area" d="${toArea(secondary)}" />
        <path class="line-path" d="${toLine(primary)}" />
        <path class="line-path secondary" d="${toLine(secondary)}" />
        <line class="chart-crosshair" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" />
        <circle class="chart-hover-marker primary" r="5" />
        <circle class="chart-hover-marker secondary" r="5" />
        ${primary.map((value, index) => index % labelStep === 0 || index === primary.length - 1 ? `
          <text class="chart-label" x="${xScale(index)}" y="${height - 13}" text-anchor="middle">${escapeHtml(labels[index] || "")}</text>
        ` : "").join("")}
        ${primary.map((value, index) => `
          <rect class="chart-hover-zone"
            x="${Math.max(padding.left, xScale(index) - zoneWidth / 2)}"
            y="${padding.top}"
            width="${index === primary.length - 1 ? zoneWidth / 2 : zoneWidth}"
            height="${height - padding.top - padding.bottom}"
            data-x="${xScale(index)}"
            data-y-primary="${yScale(value)}"
            data-y-secondary="${yScale(secondary[index] || 0)}"
            data-label="${escapeHtml(labels[index] || "")}"
            data-primary-label="프로젝트 매출"
            data-secondary-label="토큰 환원"
            data-primary="${escapeHtml(formatCurrency(value * 1000000))}"
            data-secondary="${escapeHtml(formatCurrency((secondary[index] || 0) * 1000000))}" />
        `).join("")}
      </svg>
    </div>
  `;
}

function createAreaSeriesChart(series, title) {
  const values = series.map((point) => Number(point.value) || 0);
  if (!values.length) return `<div class="empty-chart">표시할 데이터가 없습니다.</div>`;
  const width = 920;
  const height = 360;
  const padding = { top: 24, right: 78, bottom: 46, left: 64 };
  const max = Math.max(...values, 1) * 1.16;
  const min = Math.min(...values, 0) * 0.9;
  const denominator = Math.max(values.length - 1, 1);
  const xScale = (index) => padding.left + (index / denominator) * (width - padding.left - padding.right);
  const yScale = (value) => height - padding.bottom - ((value - min) / Math.max(max - min, 1)) * (height - padding.top - padding.bottom);
  const line = values.map((value, index) => `${index === 0 ? "M" : "L"}${xScale(index)},${yScale(value)}`).join(" ");
  const area = `${line} L${xScale(values.length - 1)},${height - padding.bottom} L${xScale(0)},${height - padding.bottom} Z`;
  const labelStep = Math.max(1, Math.floor(series.length / 6));
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => min + (max - min) * ratio);
  const barMax = Math.max(...values, 1);
  const zoneWidth = (width - padding.left - padding.right) / denominator;
  const summary = chartSummary(series);

  return `
    <div class="financial-chart" data-chart-kind="single">
      <div class="chart-hover-tooltip" role="status"></div>
      <div class="chart-top-readout">
        <span>${escapeHtml(title)}</span>
        <strong>${summary.change >= 0 ? "+" : ""}${formatPercent(summary.change)}</strong>
      </div>
      <svg class="chart-svg analysis-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(title)}">
        <title>${escapeHtml(title)}</title>
        ${yTicks.map((tick) => {
          const y = yScale(tick);
          return `
            <line class="chart-axis" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" />
            <text class="chart-y-label" x="${width - padding.right + 10}" y="${y + 4}">$${tick.toFixed(2)}M</text>
          `;
        }).join("")}
        ${values.map((value, index) => {
          const x = xScale(index) - Math.max(2, zoneWidth * 0.16);
          const barHeight = Math.max(2, (value / barMax) * 56);
          return `<rect class="chart-volume-bar" x="${x}" y="${height - padding.bottom - barHeight}" width="${Math.max(2, zoneWidth * 0.32)}" height="${barHeight}" rx="2" />`;
        }).join("")}
        <path class="area-path return-area" d="${area}" />
        <path class="line-path secondary" d="${line}" />
        <line class="chart-crosshair" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" />
        <circle class="chart-hover-marker secondary" r="5" />
        ${values.map((value, index) => index % labelStep === 0 || index === values.length - 1 ? `
          <text class="chart-label" x="${xScale(index)}" y="${height - 14}" text-anchor="middle">${escapeHtml(series[index]?.label || "")}</text>
        ` : "").join("")}
        ${values.map((value, index) => `
          <rect class="chart-hover-zone"
            x="${Math.max(padding.left, xScale(index) - zoneWidth / 2)}"
            y="${padding.top}"
            width="${index === values.length - 1 ? zoneWidth / 2 : zoneWidth}"
            height="${height - padding.top - padding.bottom}"
            data-x="${xScale(index)}"
            data-y-secondary="${yScale(value)}"
            data-label="${escapeHtml(series[index]?.label || "")}"
            data-secondary-label="토큰 환원"
            data-secondary="${escapeHtml(formatCurrency(value * 1000000))}" />
        `).join("")}
      </svg>
    </div>
  `;
}

function renderValueCaptureMix(project) {
  const revenue = Number(project.thirtyDay?.revenue) || 0;
  const returned = Math.min(Number(project.thirtyDay?.buyback) || 0, revenue);
  const staking = Math.min(Number(project.thirtyDay?.stakingDistribution) || 0, Math.max(revenue - returned, 0));
  const retained = Math.max(revenue - returned - staking, 0);
  const segments = [
    { label: "토큰 환원", value: returned, type: "return" },
    { label: "스테이킹 분배", value: staking, type: "staking" },
    { label: "잔여/금고", value: retained, type: "retained" },
  ].filter((item) => item.value > 0 || item.type === "return");
  const total = Math.max(revenue, 1);

  return `
    <div class="mix-bar" aria-label="30일 매출 가치 연결 구성">
      ${segments.map((item) => `<span class="${item.type}" style="--w:${percentWidth(item.value, total, item.value ? 3 : 0)}%" title="${escapeHtml(item.label)} ${formatCurrency(item.value)}"></span>`).join("")}
    </div>
    <div class="mix-legend">
      ${segments.map((item) => `
        <div>
          <i class="${item.type}"></i>
          <span>${escapeHtml(item.label)}</span>
          <strong>${formatPercent(item.value / total)}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function renderVisualValueFlow(project) {
  return `
    <div class="value-flow">
      ${(project.valueFlow || []).map((step, index, steps) => `
        <div class="flow-node">
          <span>${String(index + 1).padStart(2, "0")}</span>
          <strong>${escapeHtml(step)}</strong>
        </div>
        ${index < steps.length - 1 ? `<b aria-hidden="true">→</b>` : ""}
      `).join("")}
    </div>
  `;
}

function renderUsagePanel(project) {
  const usage = project.usage || {};
  const growth = getTrend(usage.userGrowth6m || []);
  return `
    <div class="usage-panel">
      <div class="usage-spark">
        ${renderSparkline(usage.userGrowth6m || [], `${project.name} 6개월 실사용 성장`)}
        <span class="mini-change ${growth >= 0 ? "positive" : "negative"}">${growth >= 0 ? "+" : ""}${formatPercent(growth)}</span>
      </div>
      <div class="usage-stats">
        ${[
          ["DAU", formatNumber(usage.dau), "일간 활성"],
          ["WAU", formatNumber(usage.wau), "주간 활성"],
          ["MAU", formatNumber(usage.mau), "월간 활성"],
          ["신규 지갑", formatNumber(usage.newWallets), "30일"],
          ["거래량 변화", formatPercent(usage.volumeChange30d), "30일"],
          ["TVL 변화", formatPercent(usage.tvlChange30d), "30일"],
        ].map(([label, value, sub]) => `
          <div>
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
            <small>${escapeHtml(sub)}</small>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderPeerBars(project) {
  const categoryPeers = projects.filter((item) => item.category === project.category);
  const basePeers = categoryPeers.length >= 3 ? categoryPeers : projects;
  const peers = [...new Map([project, ...basePeers.sort((a, b) => (b.thirtyDay?.revenue || 0) - (a.thirtyDay?.revenue || 0))].map((item) => [item.id, item])).values()].slice(0, 6);
  const maxRevenue = Math.max(...peers.map((item) => item.thirtyDay?.revenue || 0), 1);

  return `
    <div class="peer-bars">
      ${peers.map((item) => `
        <div class="peer-row${item.id === project.id ? " active" : ""}">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <span>${formatPercent(getBuybackYield(item))} 환원 수익률</span>
          </div>
          <i style="--w:${percentWidth(item.thirtyDay?.revenue, maxRevenue)}%"></i>
          <b>${formatCurrency(item.thirtyDay?.revenue)}</b>
        </div>
      `).join("")}
    </div>
  `;
}

function renderUnlockTimeline(project) {
  const unlocks = project.unlocks || {};
  const rows = [
    ["30일", unlocks.next30dUsd || 0],
    ["90일", unlocks.next90dUsd || 0],
    ["180일", unlocks.next180dUsd || 0],
  ];
  const max = Math.max(...rows.map(([, value]) => value), 1);
  return `
    <div class="timeline-list">
      <div class="timeline-meta">
        <span>다음 언락</span>
        <strong>${escapeHtml(unlocks.nextDate || "-")}</strong>
        <b>${formatCurrency(unlocks.nextAmountUsd)}</b>
      </div>
      ${rows.map(([label, value]) => `
        <div class="timeline-row">
          <span>${escapeHtml(label)}</span>
          <i style="--w:${percentWidth(value, max)}%"></i>
          <strong>${formatCurrency(value)}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function renderAllocationStack(project) {
  const allocation = project.unlocks?.allocation || {};
  const items = [
    ["팀", allocation.team || 0, "team"],
    ["VC", allocation.vc || 0, "vc"],
    ["재단", allocation.foundation || 0, "foundation"],
    ["커뮤니티", allocation.community || 0, "community"],
  ];
  return `
    <div class="allocation-stack" aria-label="토큰 분배 구조">
      ${items.map(([label, value, type]) => `<span class="${type}" style="--w:${Math.max(0, Number(value) * 100)}%" title="${escapeHtml(label)} ${formatPercent(value, 0)}"></span>`).join("")}
    </div>
    <div class="allocation-legend">
      ${items.map(([label, value, type]) => `
        <div>
          <i class="${type}"></i>
          <span>${escapeHtml(label)}</span>
          <strong>${formatPercent(value, 0)}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function renderRiskChecklist(project) {
  const risk = project.riskProfile || {};
  const rows = [
    ["감사", risk.audited ? "완료" : "미확인", risk.audited ? "positive" : "warning", (risk.auditors || []).join(", ") || "-"],
    ["GitHub", risk.githubActive ? "활동 있음" : "제한적", risk.githubActive ? "positive" : "warning", risk.recentCommitDate || "공개 저장소 확인 필요"],
    ["거버넌스", risk.governance ? "존재" : "제한적", risk.governance ? "positive" : "warning", `재단 지갑 ${risk.foundationWalletPublic ? "공개" : "비공개"}`],
    ["팀/VC 비중", (risk.teamVcShare || 0) >= 0.5 ? "높음" : "보통", (risk.teamVcShare || 0) >= 0.5 ? "negative" : "warning", formatPercent(risk.teamVcShare || 0)],
    ["환원 데이터", project.buybackType === "estimated" ? "추정" : "공개/실측", project.buybackType === "estimated" ? "warning" : "positive", buybackTypeLabel(project.buybackType)],
    ["데이터 신뢰도", project.dataConfidence, project.dataConfidence === "high" ? "positive" : project.dataConfidence === "medium" ? "warning" : "negative", project.buybackSource || "-"],
  ];

  return `
    <div class="risk-check-wrap">
      <table class="risk-check-table">
        <tbody>
          ${rows.map(([label, status, type, note]) => `
            <tr>
              <th>${escapeHtml(label)}</th>
              <td><span class="pill ${type}">${escapeHtml(status)}</span></td>
              <td>${escapeHtml(note)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
    <div class="risk-badges compact">
      ${(risk.badges || []).map((badge) => renderBadge(badge, "warning")).join("")}
    </div>
  `;
}

function renderLegacyFundamentalSections(project) {
  const revenueTrend = getTrendLabel(project.monthlyRevenue);
  const buybackTrend = getTrendLabel(project.monthlyBuyback);
  const usageTrend = getUsageTrendLabel(project.usage?.usageTrend);
  const unlockRisk = getUnlockRisk(project);
  const valuation = getValuation(project);
  const annualizedBuyback = getAnnualizedBuyback(project);
  const tokenReturnAmount = getTokenReturnAmount(project);
  const risk = project.riskProfile || {};

  $("#fundamentalSections").innerHTML = `
    <article class="panel detail-card">
      <div class="panel-header">
        <div>
          <p class="panel-kicker">Profitability</p>
          <h3>프로젝트 수익성</h3>
        </div>
        ${renderBadge(revenueTrend.label, revenueTrend.type)}
      </div>
      <div class="detail-metrics">
        ${renderMetricCells([
          { label: "24h 거래량", value: formatCurrency(project.daily.volume), sub: "최근 하루" },
          { label: "7d 거래량", value: formatCurrency(project.sevenDay.volume), sub: "최근 7일" },
          { label: "30d 거래량", value: formatCurrency(project.thirtyDay.volume), sub: "최근 30일" },
          { label: "24h 수수료", value: formatCurrency(project.daily.fees), sub: "User fees" },
          { label: "7d 수수료", value: formatCurrency(project.sevenDay.fees), sub: "누적 수수료" },
          { label: "30d 수수료", value: formatCurrency(project.thirtyDay.fees), sub: "누적 수수료" },
          { label: "프로토콜 매출", value: formatCurrency(project.thirtyDay.revenue), sub: "30일 기준" },
          { label: "실질 수익", value: formatCurrency(project.thirtyDay.earnings), sub: "mock earnings" },
          { label: "TVL", value: formatCurrency(project.tvl), sub: "예치/운용 규모" },
        ])}
      </div>
    </article>

    <article class="panel detail-card">
      <div class="panel-header">
        <div>
          <p class="panel-kicker">Token Value Capture</p>
          <h3>토큰 가치 연결</h3>
        </div>
        ${renderBadge(valueCaptureLabel(project.valueCaptureType), project.valueCaptureType === "none" ? "negative" : "positive")}
      </div>
      <div class="detail-metrics">
        ${renderMetricCells([
          { label: "Holder Revenue", value: formatCurrency(project.thirtyDay.holderRevenue), sub: "30일" },
          { label: "30일 바이백", value: formatCurrency(project.thirtyDay.buyback), sub: buybackTypeLabel(project.buybackType) },
          { label: "소각 금액", value: formatCurrency(project.thirtyDay.burn), sub: "30일" },
          { label: "스테이커 분배", value: formatCurrency(project.thirtyDay.stakingDistribution), sub: "30일" },
          { label: "토큰 환원 비율", value: formatPercent(getRevenueReturnRatio(project)), sub: `${formatCurrency(tokenReturnAmount)} / 매출` },
          { label: "연환산 바이백", value: formatCurrency(annualizedBuyback), sub: "buyback30d × 12" },
          { label: "환원 수익률", value: formatPercent(getBuybackYield(project)), sub: "연환산 / 시총" },
          { label: "6개월 예상", value: formatCurrency(getProjection(project).baseUsd), sub: `${buybackTrend.label} 추세 반영` },
        ])}
      </div>
      ${renderValueFlow(project)}
    </article>

    <article class="panel detail-card">
      <div class="panel-header">
        <div>
          <p class="panel-kicker">Unlock Pressure</p>
          <h3>언락 및 매도 압력</h3>
        </div>
        ${renderBadge(unlockRisk.label, unlockRisk.type)}
      </div>
      <div class="detail-metrics">
        ${renderMetricCells([
          { label: "현재 유통률", value: formatPercent(project.circulatingSupplyPercent), sub: "Circulating / Max" },
          { label: "시가총액", value: formatCurrency(project.marketCap), sub: "MCAP" },
          { label: "FDV", value: formatCurrency(project.fdv), sub: "Fully diluted" },
          { label: "FDV / MCAP", value: formatRatio((project.fdv || 0) / (project.marketCap || 1)), sub: "희석 부담" },
          { label: "다음 언락", value: formatCurrency(project.unlocks?.nextAmountUsd), sub: project.unlocks?.nextDate || "-" },
          { label: "30일 언락", value: formatCurrency(project.unlocks?.next30dUsd), sub: "다음 30일" },
          { label: "90일 언락", value: formatCurrency(project.unlocks?.next90dUsd), sub: "다음 90일" },
          { label: "180일 언락", value: formatCurrency(project.unlocks?.next180dUsd), sub: "다음 180일" },
          { label: "거래량 대비 압력", value: `${getUnlockPressureRatio(project).toFixed(2)}일치`, sub: "다음 언락 / 30d 평균 거래량" },
        ])}
      </div>
      ${renderAllocation(project.unlocks?.allocation)}
    </article>

    <article class="panel detail-card">
      <div class="panel-header">
        <div>
          <p class="panel-kicker">Usage Growth</p>
          <h3>실사용 및 성장</h3>
        </div>
        ${renderBadge(usageTrend.label, usageTrend.type)}
      </div>
      <div class="detail-metrics">
        ${renderMetricCells([
          { label: "DAU", value: formatNumber(project.usage?.dau), sub: "일간 활성" },
          { label: "WAU", value: formatNumber(project.usage?.wau), sub: "주간 활성" },
          { label: "MAU", value: formatNumber(project.usage?.mau), sub: "월간 활성" },
          { label: "활성 지갑", value: formatNumber(project.usage?.activeWallets), sub: "월간 기준" },
          { label: "신규 지갑", value: formatNumber(project.usage?.newWallets), sub: "30일" },
          { label: "트랜잭션", value: formatNumber(project.usage?.transactions30d), sub: "30일" },
          { label: "TVL 변화율", value: formatPercent(project.usage?.tvlChange30d), sub: "30일" },
          { label: "거래량 변화율", value: formatPercent(project.usage?.volumeChange30d), sub: "30일" },
        ])}
      </div>
    </article>

    <article class="panel detail-card wide">
      <div class="panel-header">
        <div>
          <p class="panel-kicker">Trust & Risk</p>
          <h3>신뢰도 / 리스크</h3>
        </div>
        ${renderBadge(project.dataConfidence, project.dataConfidence === "high" ? "positive" : project.dataConfidence === "medium" ? "warning" : "negative")}
      </div>
      <div class="trust-grid">
        <div>
          <p>공식 홈페이지</p>
          <a href="${escapeHtml(risk.website || "#")}" target="_blank" rel="noreferrer">${escapeHtml(risk.website || "-")}</a>
        </div>
        <div>
          <p>문서 링크</p>
          <a href="${escapeHtml(risk.docs || "#")}" target="_blank" rel="noreferrer">${escapeHtml(risk.docs || "-")}</a>
        </div>
        <div><p>감사 여부</p><strong>${risk.audited ? "감사 완료" : "감사 없음"}</strong><span>${escapeHtml((risk.auditors || []).join(", ") || "-")}</span></div>
        <div><p>GitHub 활동</p><strong>${risk.githubActive ? "활동 있음" : "활동 제한"}</strong><span>${escapeHtml(risk.recentCommitDate || "-")}</span></div>
        <div><p>거버넌스</p><strong>${risk.governance ? "존재" : "제한적"}</strong><span>재단 지갑 ${risk.foundationWalletPublic ? "공개" : "비공개"}</span></div>
        <div><p>팀/VC 물량</p><strong>${formatPercent(risk.teamVcShare || 0)}</strong><span>${escapeHtml((risk.investors || []).join(", ") || "-")}</span></div>
      </div>
      <div class="risk-badges">
        ${(risk.badges || []).map((badge) => renderBadge(badge, "warning")).join("")}
      </div>
      <ul class="detail-list">
        ${(risk.notes || project.risks || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </article>
  `;
}

function renderFundamentalSections(project) {
  const score = getProjectScore(project);
  const signal = getSignalFromScore(score);
  const unlockRisk = getUnlockRisk(project);
  const projection = getProjection(project);
  const revenueSeries = expandMonthlySeries(project.monthlyRevenue, state.chartRange);
  const sixMonthRevenue = sumMillions(project.monthlyRevenue);
  const mom = monthOverMonth(project.monthlyRevenue);
  const revenueYield = annualizedRevenueYield(project);
  const risk = project.riskProfile || {};

  $("#fundamentalSections").innerHTML = `
    <article class="panel detail-card wide dashboard-main-card">
      <div class="panel-header">
        <div>
          <p class="panel-kicker">Revenue Trend</p>
          <h3>수익 추세</h3>
        </div>
        <div class="chart-toolbar">
          ${renderSegmentedControl("chartRange", rangeOptions, state.chartRange)}
        </div>
      </div>
      <div class="dashboard-kpi-row">
        <div><span>최근 1개월 수익</span><strong>${formatCurrency(project.thirtyDay.revenue)}</strong></div>
        <div><span>최근 6개월 수익</span><strong>${formatCurrency(sixMonthRevenue)}</strong></div>
        <div><span>전월 대비</span><strong class="${mom >= 0 ? "positive-text" : "negative-text"}">${mom >= 0 ? "+" : ""}${formatPercent(mom)}</strong></div>
        <div><span>연환산 수익/시총</span><strong>${formatPercent(revenueYield)}</strong></div>
      </div>
      <div class="chart-wrap visual-chart dashboard-revenue-chart">
        ${createDashboardLineChart(revenueSeries, `${project.name} ${getRangeOption(state.chartRange).label} 수익 추세`, "프로젝트 수익", project)}
      </div>
    </article>

    <article class="panel detail-card dashboard-score-card">
      <div class="panel-header">
        <div>
          <p class="panel-kicker">Token Supply</p>
          <h3>토큰 수급</h3>
        </div>
        ${renderBadge(signal.signal, signal.signalType)}
      </div>
      <div class="score-summary">
        <strong>${score}<small>/100</small></strong>
        <span>6개월 예상 환원</span>
        <b>${formatCurrency(projection.baseUsd)}</b>
      </div>
    </article>

    <article class="panel detail-card dashboard-unlock-card">
      <div class="panel-header">
        <div>
          <p class="panel-kicker">Next Unlock</p>
          <h3>다음 언락</h3>
        </div>
        ${renderBadge(unlockRisk.label, unlockRisk.type)}
      </div>
      <div class="unlock-summary">
        <strong>${escapeHtml(project.unlocks?.nextDate || "-")}</strong>
        <span>${formatCurrency(project.unlocks?.nextAmountUsd)}</span>
      </div>
    </article>

    <article class="panel detail-card dashboard-allocation-card">
      <div class="panel-header">
        <div>
          <p class="panel-kicker">Allocation</p>
          <h3>토큰 분배</h3>
        </div>
        ${renderBadge(`${formatPercent(project.circulatingSupplyPercent, 0)} 유통`, "muted")}
      </div>
      ${renderAllocationDonut(project)}
    </article>

    <article class="panel detail-card dashboard-risk-card">
      <div class="panel-header">
        <div>
          <p class="panel-kicker">Risk</p>
          <h3>리스크 요약</h3>
        </div>
        ${renderBadge(project.dataConfidence, project.dataConfidence === "high" ? "positive" : project.dataConfidence === "medium" ? "warning" : "negative")}
      </div>
      <div class="risk-summary-list">
        <div><span>감사</span><strong>${risk.audited ? "완료" : "미확인"}</strong></div>
        <div><span>GitHub</span><strong>${risk.githubActive ? "활동" : "제한"}</strong></div>
        <div><span>거버넌스</span><strong>${risk.governance ? "존재" : "제한"}</strong></div>
      </div>
    </article>
  `;
}

function bindChartControls() {
  $$("[data-control='chartRange']").forEach((button) => {
    button.addEventListener("click", () => {
      state.chartRange = button.dataset.value;
      renderFundamentalSections(getSelectedProject());
      bindChartControls();
    });
  });
}

function bindFinancialChartInteractions() {
  $$(".financial-chart").forEach((chart) => {
    const tooltip = chart.querySelector(".chart-hover-tooltip");
    const svg = chart.querySelector("svg");
    const crosshair = chart.querySelector(".chart-crosshair");
    const primaryMarker = chart.querySelector(".chart-hover-marker.primary");
    const secondaryMarker = chart.querySelector(".chart-hover-marker.secondary");
    const zones = chart.querySelectorAll(".chart-hover-zone");

    const hide = () => {
      chart.classList.remove("hovering");
      if (tooltip) tooltip.classList.remove("visible");
    };

    zones.forEach((zone) => {
      const show = () => {
        const x = Number(zone.dataset.x) || 0;
        const yPrimary = Number(zone.dataset.yPrimary) || 0;
        const ySecondary = Number(zone.dataset.ySecondary) || 0;
        chart.classList.add("hovering");
        if (crosshair) {
          crosshair.setAttribute("x1", String(x));
          crosshair.setAttribute("x2", String(x));
        }
        if (primaryMarker && yPrimary) {
          primaryMarker.setAttribute("cx", String(x));
          primaryMarker.setAttribute("cy", String(yPrimary));
        }
        if (secondaryMarker && ySecondary) {
          secondaryMarker.setAttribute("cx", String(x));
          secondaryMarker.setAttribute("cy", String(ySecondary));
        }
        if (tooltip && svg) {
          const rect = svg.getBoundingClientRect();
          const box = chart.getBoundingClientRect();
          const viewBox = svg.viewBox.baseVal;
          const left = ((x - viewBox.x) / viewBox.width) * rect.width + rect.left - box.left;
          tooltip.style.left = `${Math.min(Math.max(left + 10, 12), Math.max(12, box.width - 190))}px`;
          tooltip.innerHTML = `
            <strong>${escapeHtml(zone.dataset.label || "-")}</strong>
            ${zone.dataset.primary ? `<span><i class="revenue"></i>${escapeHtml(zone.dataset.primaryLabel || "매출")} <b>${escapeHtml(zone.dataset.primary)}</b></span>` : ""}
            <span><i class="return"></i>${escapeHtml(zone.dataset.secondaryLabel || "토큰 환원")} <b>${escapeHtml(zone.dataset.secondary || "-")}</b></span>
          `;
          tooltip.classList.add("visible");
        }
      };
      zone.addEventListener("mouseenter", show);
      zone.addEventListener("mousemove", show);
      zone.addEventListener("mouseleave", hide);
      zone.addEventListener("focus", show);
      zone.addEventListener("blur", hide);
      zone.setAttribute("tabindex", "0");
    });
  });
}

function createLineChart(values, labels, title) {
  const cleanValues = values.map((value) => Number(value) || 0);
  if (!cleanValues.length) return `<div class="empty-chart">표시할 데이터가 없습니다.</div>`;
  const width = 640;
  const height = 250;
  const padding = { top: 20, right: 22, bottom: 35, left: 44 };
  const maxValue = Math.max(...cleanValues);
  const minValue = Math.min(...cleanValues);
  const max = maxValue === minValue ? maxValue + 1 : maxValue * 1.16;
  const min = maxValue === minValue ? Math.max(0, minValue - 1) : minValue * 0.82;
  const denominator = Math.max(cleanValues.length - 1, 1);
  const xStep = (width - padding.left - padding.right) / denominator;
  const yScale = (value) => height - padding.bottom - ((value - min) / Math.max(max - min, 1)) * (height - padding.top - padding.bottom);
  const points = cleanValues.map((value, index) => [padding.left + xStep * index, yScale(value)]);
  const line = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x},${y}`).join(" ");
  const area = `${line} L${points[points.length - 1][0]},${height - padding.bottom} L${points[0][0]},${height - padding.bottom} Z`;
  const gridLines = [0, 1, 2, 3].map((item) => {
    const y = padding.top + item * ((height - padding.top - padding.bottom) / 3);
    return `<line class="chart-axis" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" />`;
  });

  return `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(title)}">
      <title>${escapeHtml(title)}</title>
      ${gridLines.join("")}
      <path class="area-path" d="${area}" />
      <path class="line-path" d="${line}" />
      ${points.map(([x, y], index) => `
        <circle class="chart-dot" cx="${x}" cy="${y}" r="5" />
        <text class="chart-label" x="${x}" y="${height - 12}" text-anchor="middle">${escapeHtml(labels[index] || "")}</text>
        <text class="chart-label" x="${x}" y="${y - 12}" text-anchor="middle">$${cleanValues[index].toFixed(1)}M</text>
      `).join("")}
    </svg>
  `;
}

function createBarChart(values, labels, title) {
  const cleanValues = values.map((value) => Number(value) || 0);
  if (!cleanValues.length) return `<div class="empty-chart">표시할 데이터가 없습니다.</div>`;
  const width = 920;
  const height = 400;
  const padding = { top: 20, right: 24, bottom: 40, left: 52 };
  const max = Math.max(...cleanValues, 1) * 1.18;
  const innerWidth = width - padding.left - padding.right;
  const barGap = 18;
  const barWidth = (innerWidth - barGap * Math.max(cleanValues.length - 1, 0)) / cleanValues.length;
  const innerHeight = height - padding.top - padding.bottom;

  return `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(title)}">
      <title>${escapeHtml(title)}</title>
      ${[0, 1, 2, 3, 4].map((item) => {
        const y = padding.top + item * (innerHeight / 4);
        return `<line class="chart-axis" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" />`;
      }).join("")}
      ${cleanValues.map((value, index) => {
        const barHeight = (value / max) * innerHeight;
        const x = padding.left + index * (barWidth + barGap);
        const y = height - padding.bottom - barHeight;
        return `
          <rect class="bar" x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="8" />
          <text class="chart-label" x="${x + barWidth / 2}" y="${y - 10}" text-anchor="middle">$${value.toFixed(1)}M</text>
          <text class="chart-label" x="${x + barWidth / 2}" y="${height - 14}" text-anchor="middle">${escapeHtml(labels[index] || "")}</text>
        `;
      }).join("")}
    </svg>
  `;
}

function renderCharts(project) {
  const revenueTrend = getTrend(project.monthlyRevenue);
  const buybackTrend = getTrend(project.monthlyBuyback);
  if ($("#revenueTrendLabel")) {
    $("#revenueTrendLabel").textContent = `${revenueTrend >= 0 ? "+" : ""}${formatPercent(revenueTrend)}`;
    $("#revenueTrendLabel").className = `mini-change ${revenueTrend >= 0 ? "positive" : "negative"}`;
  }
  if ($("#buybackTrendLabel")) {
    $("#buybackTrendLabel").textContent = `${buybackTrend >= 0 ? "+" : ""}${formatPercent(buybackTrend)}`;
    $("#buybackTrendLabel").className = `mini-change ${buybackTrend >= 0 ? "positive" : "negative"}`;
  }
  if ($("#revenueChart")) $("#revenueChart").innerHTML = createLineChart(project.monthlyRevenue, months, `${project.name} 6개월 수익 추세`);
  if ($("#buybackChart")) $("#buybackChart").innerHTML = createLineChart(project.monthlyBuyback, months, `${project.name} 6개월 토큰 환원 추세`);
  if ($("#monthlyBuybackChart")) {
    const latest = project.monthlyBuyback.at(-1) || 0;
    $("#monthlyBuybackChart").innerHTML = `
      <div class="chart-legend inline chart-summary-line">
        <span class="return">월별 토큰 환원</span>
        <em>실제 월별 데이터 또는 공개 데이터 기반 추정치</em>
        <strong>${buybackTrend >= 0 ? "+" : ""}${formatPercent(buybackTrend)} · 최근 ${formatCurrency(latest * 1000000)}</strong>
      </div>
      ${createSimpleBarChart(project.monthlyBuyback, months, `${project.name} 월별 토큰 환원`)}
    `;
  }
}

function getBuybackRows(project) {
  if (project.buybackEvents.length) return project.buybackEvents.slice(0, 10);
  return project.monthlyBuyback.slice(-3).map((amount, index) => {
    const usd = amount * 1000000;
    const price = project.expectedAverageTokenPrice || project.price;
    return {
      date: [`2026-04-30`, `2026-05-31`, `2026-06-27`][index],
      txHash: `estimated-${project.id}-${index + 1}`,
      tokenAmount: usd / price,
      usd,
      price,
      source: "추정 모델",
      buybackType: "estimated",
    };
  }).reverse();
}

function renderBuybackTable(project) {
  const rows = getBuybackRows(project);
  $("#buybackTable").innerHTML = rows
    .map((row) => `
      <tr>
        <td>${escapeHtml(row.date)}</td>
        <td>${escapeHtml(project.name)}<span class="subtext">${escapeHtml(project.category)}</span></td>
        <td>${formatNumber(row.tokenAmount, 0)} ${escapeHtml(project.token)}</td>
        <td>${formatCurrency(row.usd)}</td>
        <td>${formatCurrency(row.price, false)}</td>
        <td><span title="${escapeHtml(row.txHash)}">${escapeHtml(shortHash(row.txHash))}</span></td>
        <td><span class="pill ${row.buybackType === "estimated" ? "warning" : "positive"}">${escapeHtml(row.source)}</span></td>
      </tr>
    `)
    .join("");
}

function renderProjectDetailSections(project) {
  const risk = project.riskProfile || {};
  const valuation = getValuation(project);
  const projection = getProjection(project);
  const maxSupply = project.circulatingSupplyPercent ? (project.marketCap / project.price) / project.circulatingSupplyPercent : 0;
  const allocation = project.unlocks?.allocation || {};
  const flowItems = project.valueFlow || [];
  const notes = (risk.notes || []).length ? risk.notes : project.risks || [];

  $("#projectDetailSections").innerHTML = `
    <article class="panel detail-card detail-wide">
      <div class="panel-header">
        <div>
          <p class="panel-kicker">Revenue Detail</p>
          <h3>수익과 토큰 환원 정의</h3>
        </div>
      </div>
      <div class="definition-grid">
        <div><strong>Holder Revenue</strong><span>토큰 보유자 또는 토큰 가치에 귀속되는 30일 수익입니다.</span><b>${formatCurrency(project.thirtyDay.holderRevenue)}</b></div>
        <div><strong>30일 토큰 환원</strong><span>바이백, 소각, 분배 등 토큰 수급에 직접 연결되는 금액입니다.</span><b>${formatCurrency(project.thirtyDay.buyback)}</b></div>
        <div><strong>환원 비율</strong><span>30일 토큰 환원 / 30일 프로젝트 매출입니다. 100% 초과는 과거 적립금·특수 집행이 포함된 것으로 해석합니다.</span><b>${formatPercent(getRevenueReturnRatio(project))}</b></div>
        <div><strong>환원 수익률</strong><span>30일 토큰 환원을 연환산해 현재 시가총액으로 나눈 값입니다.</span><b>${formatPercent(getBuybackYield(project))}</b></div>
        <div><strong>6개월 예상 환원</strong><span>최근 3개월 평균, 추세, 예상 평균 토큰 가격을 반영한 기준 시나리오입니다.</span><b>${formatCurrency(projection.baseUsd)}</b></div>
        <div><strong>FDV/Revenue</strong><span>FDV를 연환산 매출로 나눈 밸류에이션 배수입니다.</span><b>${formatRatio(valuation.fdvToRevenue)}</b></div>
      </div>
    </article>

    <article class="panel detail-card">
      <div class="panel-header">
        <div>
          <p class="panel-kicker">Value Flow</p>
          <h3>토큰 가치 흐름</h3>
        </div>
      </div>
      <ol class="flow-list">
        ${flowItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ol>
    </article>

    <article class="panel detail-card">
      <div class="panel-header">
        <div>
          <p class="panel-kicker">Usage Detail</p>
          <h3>실사용 및 성장</h3>
        </div>
      </div>
      <div class="definition-grid compact">
        <div><strong>DAU</strong><span>일간 활성 사용자/지갑</span><b>${formatNumber(project.usage?.dau)}</b></div>
        <div><strong>WAU</strong><span>주간 활성 사용자/지갑</span><b>${formatNumber(project.usage?.wau)}</b></div>
        <div><strong>MAU</strong><span>월간 활성 사용자/지갑</span><b>${formatNumber(project.usage?.mau)}</b></div>
        <div><strong>6개월 성장</strong><span>첫 월 대비 마지막 월 변화율</span><b>${formatPercent(getTrend(project.usage?.userGrowth6m || []))}</b></div>
      </div>
    </article>

    <article class="panel detail-card">
      <div class="panel-header">
        <div>
          <p class="panel-kicker">Unlock Detail</p>
          <h3>언락 일정</h3>
        </div>
      </div>
      <div class="unlock-table">
        ${[
          ["다음 언락", project.unlocks?.nextDate || "-", project.unlocks?.nextAmountUsd || 0],
          ["30일 내", "향후 30일", project.unlocks?.next30dUsd || 0],
          ["90일 내", "향후 90일", project.unlocks?.next90dUsd || 0],
          ["180일 내", "향후 180일", project.unlocks?.next180dUsd || 0],
        ].map(([label, date, usd]) => `
          <div>
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(date)}</strong>
            <b>${formatCurrency(usd)}</b>
            <small>${formatNumber((Number(usd) || 0) / project.price, 0)} ${escapeHtml(project.token)}</small>
          </div>
        `).join("")}
      </div>
    </article>

    <article class="panel detail-card">
      <div class="panel-header">
        <div>
          <p class="panel-kicker">Allocation Detail</p>
          <h3>토큰 분배 상세</h3>
        </div>
      </div>
      <div class="allocation-detail-table">
        ${[
          ["팀", allocation.team || 0],
          ["VC", allocation.vc || 0],
          ["재단", allocation.foundation || 0],
          ["커뮤니티", allocation.community || 0],
        ].map(([label, share]) => `
          <div>
            <span>${escapeHtml(label)}</span>
            <strong>${formatPercent(share, 0)}</strong>
            <b>${formatNumber(maxSupply * Number(share || 0), 0)} ${escapeHtml(project.token)}</b>
          </div>
        `).join("")}
      </div>
    </article>

    <article class="panel detail-card detail-wide">
      <div class="panel-header">
        <div>
          <p class="panel-kicker">Risk Detail</p>
          <h3>리스크 상세</h3>
        </div>
      </div>
      ${renderRiskChecklist(project)}
      <ul class="detail-list">
        ${notes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </article>
  `;
}

function renderInsight(project) {
  const score = getProjectScore(project);
  const signal = getSignalFromScore(score);
  const projection = getProjection(project);
  $("#scoreRing").style.setProperty("--score", score);
  $("#scoreRing").setAttribute("aria-valuenow", String(score));
  $("#scoreValue").textContent = score;
  $("#verdictBox").innerHTML = `
    <strong>${escapeHtml(signal.signal)}</strong>
    <p>${score >= 80 ? "수익과 토큰 환원 연결성이 강합니다. 거래량이 유지될 경우 토큰 수급에 의미 있는 효과를 만들 수 있습니다." : score >= 55 ? "수익성은 확인되지만 실제 환원 집행과 언락 부담은 함께 확인해야 합니다." : "프로젝트 수익과 토큰 수급의 직접 연결성이 낮거나 추정 비중이 높습니다."}</p>
  `;
  $("#projectedUsd").textContent = formatCurrency(projection.baseUsd);
  $("#projectedToken").textContent = `예상 환원 수량: ${formatNumber(projection.baseToken, 0)} ${project.token} · 예상 평균가 ${formatCurrency(projection.expectedAverageTokenPrice, false)}`;

  $("#scenarioList").innerHTML = "";
  $("#scenarioList").classList.add("hidden");
  $("#riskList").closest(".risk-box").classList.add("hidden");
}

function renderCompareTable() {
  const sorted = [...projects].sort((a, b) => {
    if (state.compareSort === "buyback") return (b.thirtyDay?.buyback || 0) - (a.thirtyDay?.buyback || 0);
    if (state.compareSort === "buybackYield") return getBuybackYield(b) - getBuybackYield(a);
    if (state.compareSort === "fdvRevenue") return (getValuation(a).fdvToRevenue ?? Infinity) - (getValuation(b).fdvToRevenue ?? Infinity);
    if (state.compareSort === "unlockRisk") return getUnlockRisk(b).score - getUnlockRisk(a).score || getUnlockPressureRatio(b) - getUnlockPressureRatio(a);
    if (state.compareSort === "tvl") return (b.tvl || 0) - (a.tvl || 0);
    return (b.thirtyDay?.revenue || 0) - (a.thirtyDay?.revenue || 0);
  });

  $("#compareTable").innerHTML = sorted
    .map((project) => {
      const valuation = getValuation(project);
      const unlockRisk = getUnlockRisk(project);
      return `
        <tr>
          <td>${escapeHtml(project.name)}<span class="subtext">${escapeHtml(project.token)}</span></td>
          <td>${escapeHtml(project.category)}</td>
          <td>${formatCurrency(project.marketCap)}</td>
          <td>${formatCurrency(project.fdv)}</td>
          <td>${formatCurrency(project.thirtyDay.revenue)}</td>
          <td>${formatCurrency(project.thirtyDay.holderRevenue)}</td>
          <td>${formatCurrency(project.thirtyDay.buyback)}</td>
          <td>${formatRatio(valuation.fdvToRevenue)}</td>
          <td>${formatRatio(valuation.mcapToHolderRevenue)}</td>
          <td>${formatCurrency(project.tvl)}</td>
          <td>${formatRatio(valuation.fdvToTvl)}</td>
          <td>${formatCurrency(project.unlocks?.next90dUsd)}</td>
          <td>${renderBadge(unlockRisk.label, unlockRisk.type)}</td>
          <td>${escapeHtml(valueCaptureLabel(project.valueCaptureType))}</td>
        </tr>
      `;
    })
    .join("");
}

function renderTabs() {
  document.body.dataset.activeTab = state.activeTab;
  $$(".tab").forEach((tab) => {
    const active = tab.dataset.tab === state.activeTab;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });

  ["home", "dashboard", "compare", "buybacks", "settings"].forEach((tabId) => {
    const el = $(`#${tabId}Tab`);
    if (el) el.classList.toggle("hidden", tabId !== state.activeTab);
  });
}

function syncSettingsForm(project) {
  $("#defillamaSlugInput").value = project.defillamaSlug || "";
  $("#assistanceFundInput").value = project.assistanceFundAddress || "";
  $("#priceSourceInput").value = project.priceSource || "CoinGecko";
}

function exportCsv(project) {
  const rows = getBuybackRows(project);
  const header = ["date", "project", "token", "amountToken", "amountUsd", "price", "txHash", "source", "buybackType"];
  const body = rows.map((row) => [row.date, project.name, project.token, Number(row.tokenAmount || 0).toFixed(4), Number(row.usd || 0).toFixed(2), row.price, row.txHash, row.source, row.buybackType]);
  const csv = [header, ...body].map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${project.id}-buybacks.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function render() {
  const selectedProject = getSelectedProject();
  renderDataStatus();
  renderSummaryCards();
  renderSummaryRankPanel();
  renderHome();
  renderCategoryFilter();
  renderProjectList();
  renderProjectHero(selectedProject);
  renderCharts(selectedProject);
  renderFundamentalSections(selectedProject);
  bindChartControls();
  renderBuybackTable(selectedProject);
  renderProjectDetailSections(selectedProject);
  renderInsight(selectedProject);
  renderCompareTable();
  renderTabs();
  syncSettingsForm(selectedProject);
  $("#refreshButton").textContent = state.isRefreshing ? "갱신 중..." : "데이터 새로고침";
  $("#refreshButton").disabled = state.isRefreshing;
  if ($("#compareSort")) $("#compareSort").value = state.compareSort;
}

function initEvents() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.activeTab = tab.dataset.tab;
      if (state.activeTab !== "home") state.activeSummaryRank = null;
      renderTabs();
      renderSummaryRankPanel();
      renderSummaryCards();
    });
  });

  $("#projectSearch").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderProjectList();
  });

  $("#refreshButton").addEventListener("click", refreshSelectedProject);
  $("#saveSettingsButton").addEventListener("click", saveSettings);
  $("#exportCsvButton").addEventListener("click", () => exportCsv(getSelectedProject()));
  $("#closeSummaryRankButton").addEventListener("click", () => {
    state.activeSummaryRank = null;
    renderSummaryRankPanel();
    renderSummaryCards();
  });
  $("#compareSort").addEventListener("change", (event) => {
    state.compareSort = event.target.value;
    renderCompareTable();
  });

  $$("#homeRankToggle .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.homeRank = chip.dataset.rank;
      renderHome();
    });
  });
}

initEvents();
render();

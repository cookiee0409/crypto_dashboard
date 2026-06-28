import { fetchDefiLlamaFeesSummary, fetchDefiLlamaRevenueSummary } from "./lib/defillama.js";
import { HYPERLIQUID_ASSISTANCE_FUND, fetchHyperliquidAssistanceFundData } from "./lib/hyperliquid.js";
import { getBuybackIntensity, getProjectScore, getProjection, getSignalFromScore, getTrend } from "./lib/calculations.js";

const projects = [
  {
    id: "hyperliquid",
    name: "Hyperliquid",
    token: "HYPE",
    category: "Perp DEX",
    defillamaSlug: "hyperliquid-perps",
    assistanceFundAddress: HYPERLIQUID_ASSISTANCE_FUND,
    dataConfidence: "high",
    buybackType: "actual_disclosed",
    buybackSource: "Hyperliquid public Assistance Fund",
    description: "Perp 거래량과 수수료가 프로젝트 수익으로 이어지고, Assistance Fund의 자체 토큰 매입으로 토큰 매수압을 추적하기 좋은 대표 사례입니다.",
    lastUpdated: "2026-06-27 15:30 KST · 샘플",
    price: 39.42,
    expectedAverageTokenPrice: 42.0,
    marketCap: 13200000000,
    revenueToBuybackRatio: 0.92,
    daily: { volume: 9130000000, fees: 2950000, revenue: 2140000, buyback: 1968000 },
    sevenDay: { volume: 59200000000, fees: 19700000, revenue: 14200000, buyback: 13064000 },
    thirtyDay: { volume: 244000000000, fees: 82100000, revenue: 61550000, buyback: 56626000 },
    monthlyRevenue: [38.4, 41.7, 47.8, 52.5, 58.2, 61.55],
    monthlyBuyback: [34.6, 37.2, 42.9, 47.6, 53.1, 56.63],
    monthlyVolume: [181, 194, 210, 226, 238, 244],
    buybackEvents: [
      { date: "2026-06-27", txHash: "sample-hype-20260627", tokenAmount: 49924, usd: 1968000, price: 39.42, source: "sample Assistance Fund", buybackType: "actual_disclosed" },
      { date: "2026-05-31", txHash: "sample-hype-20260531", tokenAmount: 1347032, usd: 53100000, price: 39.42, source: "sample Assistance Fund", buybackType: "actual_disclosed" },
      { date: "2026-04-30", txHash: "sample-hype-20260430", tokenAmount: 1207519, usd: 47600000, price: 39.42, source: "sample Assistance Fund", buybackType: "actual_disclosed" },
    ],
    risks: ["거래량 의존도가 높아 시장 침체 시 매수압도 약해질 수 있습니다.", "바이백이 소각인지 보유인지에 따라 공급 감소 효과가 달라집니다.", "토큰 가격 상승 시 동일 금액으로 매입 가능한 수량은 감소합니다."],
  },
  {
    id: "jupiter",
    name: "Jupiter",
    token: "JUP",
    category: "DEX Aggregator",
    defillamaSlug: "jupiter",
    dataConfidence: "medium",
    buybackType: "estimated",
    buybackSource: "추정 모델",
    description: "Solana 기반 거래 라우팅·perp·launch 기능을 갖춘 프로젝트입니다. 수익과 토큰 가치 연결 구조 확인이 중요합니다.",
    lastUpdated: "2026-06-27 15:30 KST · 샘플",
    price: 0.58,
    expectedAverageTokenPrice: 0.62,
    marketCap: 1850000000,
    revenueToBuybackRatio: 0.38,
    daily: { volume: 1280000000, fees: 840000, revenue: 410000, buyback: 155800 },
    sevenDay: { volume: 8100000000, fees: 5470000, revenue: 2700000, buyback: 1026000 },
    thirtyDay: { volume: 35200000000, fees: 23100000, revenue: 11200000, buyback: 4256000 },
    monthlyRevenue: [7.8, 8.3, 9.2, 10.5, 10.1, 11.2],
    monthlyBuyback: [2.1, 2.6, 3.2, 3.9, 3.7, 4.26],
    monthlyVolume: [29.7, 31.8, 33.1, 34.7, 35.9, 35.2],
    buybackEvents: [],
    risks: ["수익이 항상 토큰 매입으로 직접 연결되는 것은 아닙니다.", "프로덕트별 수익 배분 정책 확인이 필요합니다."],
  },
  {
    id: "uniswap",
    name: "Uniswap",
    token: "UNI",
    category: "DEX",
    defillamaSlug: "uniswap",
    dataConfidence: "medium",
    buybackType: "estimated",
    buybackSource: "추정 모델",
    description: "DEX 거래량과 수수료는 크지만, 수익이 UNI 토큰 매수압으로 직접 연결되는지 별도 확인해야 합니다.",
    lastUpdated: "2026-06-27 15:30 KST · 샘플",
    price: 8.12,
    expectedAverageTokenPrice: 8.5,
    marketCap: 6100000000,
    revenueToBuybackRatio: 0.05,
    daily: { volume: 1760000000, fees: 1730000, revenue: 180000, buyback: 9000 },
    sevenDay: { volume: 11400000000, fees: 12100000, revenue: 1160000, buyback: 58000 },
    thirtyDay: { volume: 46900000000, fees: 50200000, revenue: 4810000, buyback: 240500 },
    monthlyRevenue: [4.1, 4.6, 4.9, 4.2, 5.0, 4.81],
    monthlyBuyback: [0.18, 0.2, 0.25, 0.19, 0.27, 0.24],
    monthlyVolume: [43.4, 45.8, 48.6, 42.1, 50.1, 46.9],
    buybackEvents: [],
    risks: ["프로토콜 수수료와 UNI 홀더 수익은 구분해서 봐야 합니다.", "거래량은 커도 토큰 매수압은 낮을 수 있습니다."],
  },
  {
    id: "aave",
    name: "Aave",
    token: "AAVE",
    category: "Lending",
    defillamaSlug: "aave",
    dataConfidence: "high",
    buybackType: "estimated",
    buybackSource: "추정 모델",
    description: "대출·차입 시장에서 발생하는 수익성과 안전모듈, 토큰 이코노미 연결을 함께 확인해야 하는 프로젝트입니다.",
    lastUpdated: "2026-06-27 15:30 KST · 샘플",
    price: 286.4,
    expectedAverageTokenPrice: 300,
    marketCap: 4300000000,
    tvl: 20500000000,
    revenueToBuybackRatio: 0.24,
    daily: { volume: null, fees: 690000, revenue: 520000, buyback: 124800 },
    sevenDay: { volume: null, fees: 4720000, revenue: 3610000, buyback: 866400 },
    thirtyDay: { volume: null, fees: 19400000, revenue: 14900000, buyback: 3576000 },
    monthlyRevenue: [12.1, 13.0, 13.4, 14.1, 14.6, 14.9],
    monthlyBuyback: [2.4, 2.8, 3.0, 3.2, 3.4, 3.58],
    monthlyVolume: [],
    buybackEvents: [],
    risks: ["Lending 프로젝트는 DEX 거래량 대신 TVL, 차입 수요, 이자 수익을 봐야 합니다.", "거버넌스 결정에 따라 수익 분배 방식이 바뀔 수 있습니다."],
  },
  {
    id: "aerodrome",
    name: "Aerodrome",
    token: "AERO",
    category: "DEX",
    defillamaSlug: "aerodrome",
    dataConfidence: "medium",
    buybackType: "estimated",
    buybackSource: "추정 모델",
    description: "Base 생태계의 주요 DEX입니다. 수수료, 인센티브, 락업 구조를 같이 봐야 합니다.",
    lastUpdated: "2026-06-27 15:30 KST · 샘플",
    price: 0.91,
    expectedAverageTokenPrice: 0.98,
    marketCap: 980000000,
    revenueToBuybackRatio: 0.18,
    daily: { volume: 420000000, fees: 590000, revenue: 330000, buyback: 59400 },
    sevenDay: { volume: 2860000000, fees: 3920000, revenue: 2210000, buyback: 397800 },
    thirtyDay: { volume: 12100000000, fees: 16100000, revenue: 9100000, buyback: 1638000 },
    monthlyRevenue: [5.8, 6.4, 7.2, 8.8, 8.1, 9.1],
    monthlyBuyback: [0.9, 1.0, 1.2, 1.5, 1.45, 1.64],
    monthlyVolume: [9.4, 10.1, 10.7, 12.2, 11.8, 12.1],
    buybackEvents: [],
    risks: ["토큰 인센티브 비용을 수익과 함께 봐야 합니다.", "DEX 수익이 토큰 가격에 반영되는 경로가 복잡합니다."],
  },
];

const state = {
  selectedProjectId: "hyperliquid",
  category: "전체",
  search: "",
  activeTab: "dashboard",
  isRefreshing: false,
  status: "샘플 데이터 표시 중 · 데이터 새로고침을 누르면 공개 API 연동을 시도합니다.",
};

const months = ["1월", "2월", "3월", "4월", "5월", "6월"];
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
  if (type === "actual_onchain") return "actual fills";
  if (type === "actual_disclosed") return "public account";
  return "estimated model";
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
  const [feesResult, revenueResult] = await Promise.allSettled([
    fetchDefiLlamaFeesSummary(project.defillamaSlug),
    fetchDefiLlamaRevenueSummary(project.defillamaSlug),
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

  if (next.id === "hyperliquid" && isValidEvmAddress(next.assistanceFundAddress)) {
    const afData = await fetchHyperliquidAssistanceFundData(next.assistanceFundAddress, 180);
    const buyEvents = afData.events.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

    if (buyEvents.length) {
      next.buybackEvents = buyEvents.slice(0, 25);
      next.buybackType = "actual_onchain";
      next.buybackSource = "Hyperliquid Assistance Fund fills";
      next.daily.buyback = eventsSince(buyEvents, 1).reduce((sum, item) => sum + item.usd, 0);
      next.sevenDay.buyback = eventsSince(buyEvents, 7).reduce((sum, item) => sum + item.usd, 0);
      next.thirtyDay.buyback = eventsSince(buyEvents, 30).reduce((sum, item) => sum + item.usd, 0);
      next.monthlyBuyback = monthlyBuybacksFromEvents(buyEvents);
      sources.push("Hyperliquid fills");
    } else if (afData.hypeBalance.entryNotionalUsd > 0) {
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

function renderSummaryCards(project) {
  const volume = getVolumeMetric(project, "daily");
  const cards = [
    volume,
    { label: "24h Fees", value: formatCurrency(project.daily.fees), sub: "사용자 지불 수수료" },
    { label: "24h Revenue", value: formatCurrency(project.daily.revenue), sub: "프로토콜 귀속 수익" },
    { label: "7d Revenue", value: formatCurrency(project.sevenDay.revenue), sub: "최근 7일 수익" },
    { label: "24h Buyback", value: formatCurrency(project.daily.buyback), sub: buybackTypeLabel(project.buybackType) },
    { label: "Buyback Intensity", value: formatPercent(getBuybackIntensity(project)), sub: "연환산 매입액 / 시총" },
  ];

  $("#summaryCards").innerHTML = cards
    .map((card) => `
      <article class="summary-card">
        <p class="label">${escapeHtml(card.label)}</p>
        <div class="value">${escapeHtml(card.value)}</div>
        <div class="sub">${escapeHtml(card.sub)}</div>
      </article>
    `)
    .join("");
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
            <div>
              <strong>${escapeHtml(project.name)}</strong>
              <span>${escapeHtml(project.token)} · ${escapeHtml(project.category)}</span>
            </div>
            <span class="pill ${derived.signalType}">${escapeHtml(derived.signal)}</span>
          </div>
          <div class="project-card-metrics">
            <div><small>7d Rev</small><b>${formatCurrency(project.sevenDay.revenue)}</b></div>
            <div><small>30d Buyback</small><b>${formatCurrency(project.thirtyDay.buyback)}</b></div>
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
  $("#projectTitle").textContent = `${project.name} / ${project.token}`;
  $("#projectSignal").textContent = `${derived.signal} · ${derived.score}점`;
  $("#projectSignal").className = `pill ${derived.signalType}`;
  $("#projectSignal").setAttribute("aria-label", `시그널 ${derived.signal}, 점수 ${derived.score}점`);
  $("#projectDescription").textContent = project.description;
  $("#lastUpdated").textContent = project.lastUpdated;

  const metrics = [
    { label: "24h Revenue", value: formatCurrency(project.daily.revenue), sub: "프로젝트 수익성" },
    { label: "7d Revenue", value: formatCurrency(project.sevenDay.revenue), sub: "최근 7일 수익" },
    { label: "30d Buyback", value: formatCurrency(project.thirtyDay.buyback), sub: `${formatPercent(project.revenueToBuybackRatio)} of revenue · ${buybackTypeLabel(project.buybackType)}` },
    { label: project.tvl ? "TVL" : "Market Cap", value: formatCurrency(project.tvl || project.marketCap), sub: project.tvl ? "Lending 대체 지표" : `${project.token} 기준 시가총액` },
    { label: "Expected Avg Price", value: formatCurrency(project.expectedAverageTokenPrice, false), sub: "예상 매입 수량 계산 기준" },
  ];

  $("#projectMetrics").innerHTML = metrics
    .map((metric) => `
      <div class="metric-item">
        <p>${escapeHtml(metric.label)}</p>
        <strong>${escapeHtml(metric.value)}</strong>
        <span>${escapeHtml(metric.sub)}</span>
      </div>
    `)
    .join("");
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
  $("#revenueTrendLabel").textContent = `${revenueTrend >= 0 ? "+" : ""}${formatPercent(revenueTrend)}`;
  $("#buybackTrendLabel").textContent = `${buybackTrend >= 0 ? "+" : ""}${formatPercent(buybackTrend)}`;
  $("#revenueTrendLabel").className = `mini-change ${revenueTrend >= 0 ? "positive" : "negative"}`;
  $("#buybackTrendLabel").className = `mini-change ${buybackTrend >= 0 ? "positive" : "negative"}`;
  $("#revenueChart").innerHTML = createLineChart(project.monthlyRevenue, months, `${project.name} 6개월 수익 추세`);
  $("#buybackChart").innerHTML = createLineChart(project.monthlyBuyback, months, `${project.name} 6개월 바이백 추세`);
  $("#monthlyBuybackChart").innerHTML = createBarChart(project.monthlyBuyback, months, `${project.name} 월별 바이백 누적`);
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

function renderInsight(project) {
  const score = getProjectScore(project);
  const signal = getSignalFromScore(score);
  const projection = getProjection(project);
  $("#scoreRing").style.setProperty("--score", score);
  $("#scoreRing").setAttribute("aria-valuenow", String(score));
  $("#scoreValue").textContent = score;
  $("#verdictBox").innerHTML = `
    <strong>${escapeHtml(signal.signal)}</strong>
    <p>${score >= 80 ? "수익과 토큰 매입 연결성이 강합니다. 거래량이 유지될 경우 토큰 수급에 의미 있는 매수압을 만들 수 있습니다." : score >= 55 ? "수익성은 확인되지만 실제 체결 여부와 토큰 매입 강도는 추가 검증이 필요합니다." : "프로젝트 수익과 토큰 매수압의 직접 연결성이 낮거나 추정 비중이 높습니다."}</p>
  `;
  $("#projectedUsd").textContent = formatCurrency(projection.baseUsd);
  $("#projectedToken").textContent = `예상 매입 수량: ${formatNumber(projection.baseToken, 0)} ${project.token} · 예상 평균가 ${formatCurrency(projection.expectedAverageTokenPrice, false)}`;

  $("#scenarioList").innerHTML = [
    { name: "보수적", value: projection.conservativeUsd },
    { name: "기준", value: projection.baseUsd },
    { name: "공격적", value: projection.aggressiveUsd },
  ].map((scenario) => `
    <div class="scenario-item">
      <span>${escapeHtml(scenario.name)} 시나리오</span>
      <strong>${formatCurrency(scenario.value)}</strong>
    </div>
  `).join("");
  $("#riskList").innerHTML = project.risks.map((risk) => `<li>${escapeHtml(risk)}</li>`).join("");
}

function renderCompareTable() {
  $("#compareTable").innerHTML = projects
    .map((project) => {
      const intensity = getBuybackIntensity(project);
      const derived = applyDerivedSignal(project);
      return `
        <tr>
          <td>${escapeHtml(project.name)}</td>
          <td>${escapeHtml(project.token)}</td>
          <td>${escapeHtml(project.category)}</td>
          <td>${formatCurrency(project.daily.revenue)}</td>
          <td>${formatCurrency(project.sevenDay.revenue)}</td>
          <td>${formatCurrency(project.thirtyDay.revenue)}</td>
          <td>${formatCurrency(project.thirtyDay.buyback)}</td>
          <td>${formatPercent(project.revenueToBuybackRatio)}</td>
          <td>${formatPercent(intensity)}</td>
          <td><span class="pill ${project.dataConfidence === "high" ? "positive" : "warning"}">${escapeHtml(project.dataConfidence)}</span></td>
          <td><span class="pill ${derived.signalType}">${escapeHtml(derived.signal)} · ${derived.score}</span></td>
        </tr>
      `;
    })
    .join("");
}

function renderTabs() {
  $$(".tab").forEach((tab) => {
    const active = tab.dataset.tab === state.activeTab;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });

  ["dashboard", "compare", "buybacks", "settings"].forEach((tabId) => {
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
  renderSummaryCards(selectedProject);
  renderCategoryFilter();
  renderProjectList();
  renderProjectHero(selectedProject);
  renderCharts(selectedProject);
  renderBuybackTable(selectedProject);
  renderInsight(selectedProject);
  renderCompareTable();
  renderTabs();
  syncSettingsForm(selectedProject);
  $("#refreshButton").textContent = state.isRefreshing ? "갱신 중..." : "데이터 새로고침";
  $("#refreshButton").disabled = state.isRefreshing;
}

function initEvents() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.activeTab = tab.dataset.tab;
      renderTabs();
    });
  });

  $("#projectSearch").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderProjectList();
  });

  $("#refreshButton").addEventListener("click", refreshSelectedProject);
  $("#saveSettingsButton").addEventListener("click", saveSettings);
  $("#exportCsvButton").addEventListener("click", () => exportCsv(getSelectedProject()));
}

initEvents();
render();

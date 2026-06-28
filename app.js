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
  activeTab: "dashboard",
  compareSort: "revenue",
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
    { label: "30일 매출 1위", value: highlights.byRevenue?.name, sub: formatCurrency(highlights.byRevenue?.thirtyDay?.revenue) },
    { label: "30일 바이백 1위", value: highlights.byBuyback?.name, sub: formatCurrency(highlights.byBuyback?.thirtyDay?.buyback) },
    { label: "바이백 수익률 1위", value: highlights.byYield?.name, sub: formatPercent(getBuybackYield(highlights.byYield)) },
    { label: "언락 위험 최고", value: highlights.byUnlock?.name, sub: `${getUnlockRisk(highlights.byUnlock).label} · ${getUnlockPressureRatio(highlights.byUnlock).toFixed(2)}일치` },
    { label: "FDV/Revenue 저평가", value: highlights.byCheap?.name, sub: formatRatio(getValuation(highlights.byCheap).fdvToRevenue) },
    { label: "실사용 성장 1위", value: highlights.byUsage?.name, sub: getTrendLabel(highlights.byUsage?.usage?.userGrowth6m || []).label },
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
  $("#projectSourceLinks").innerHTML = (project.sourceLinks || [])
    .map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>`)
    .join("");

  const metrics = [
    { label: "24h Revenue", value: formatCurrency(project.daily.revenue), sub: "프로젝트 수익성" },
    { label: "7d Revenue", value: formatCurrency(project.sevenDay.revenue), sub: "최근 7일 수익" },
    { label: "30d Buyback", value: formatCurrency(project.thirtyDay.buyback), sub: `${formatPercent(project.revenueToBuybackRatio)} of revenue · ${buybackTypeLabel(project.buybackType)}` },
  ];
  if (project.cumulativeBuybackUsd) {
    metrics.push({ label: "Cumulative Buyback", value: formatCurrency(project.cumulativeBuybackUsd), sub: `DefiLlama 기준${project.latestBuybackDate ? ` · ${project.latestBuybackDate}` : ""}` });
  }
  if (project.assistanceFundHype) {
    metrics.push({ label: "AF HYPE Removed", value: `${formatNumber(project.assistanceFundHype, 0)} ${project.token}`, sub: "Assistance Fund 보유분, 소각 간주" });
  }
  metrics.push(
    { label: project.tvl ? "TVL" : "Market Cap", value: formatCurrency(project.tvl || project.marketCap), sub: project.tvl ? "Lending 대체 지표" : `${project.token} 기준 시가총액` },
    { label: "Expected Avg Price", value: formatCurrency(project.expectedAverageTokenPrice, false), sub: "예상 매입 수량 계산 기준" },
  );

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

function renderFundamentalSections(project) {
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
          { label: "바이백 수익률", value: formatPercent(getBuybackYield(project)), sub: "연환산 / 시총" },
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
  renderSummaryCards();
  renderCategoryFilter();
  renderProjectList();
  renderProjectHero(selectedProject);
  renderCharts(selectedProject);
  renderFundamentalSections(selectedProject);
  renderBuybackTable(selectedProject);
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
  $("#compareSort").addEventListener("change", (event) => {
    state.compareSort = event.target.value;
    renderCompareTable();
  });
}

initEvents();
render();

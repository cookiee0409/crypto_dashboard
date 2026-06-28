export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function getTrend(values = []) {
  if (values.length < 2) return 0;
  const first = Number(values[0]) || 0;
  const last = Number(values[values.length - 1]) || 0;
  return first === 0 ? 0 : (last - first) / first;
}

export function getTrendLabel(values = []) {
  const trend = getTrend(values);
  if (trend >= 0.25) return { label: "급등", type: "positive" };
  if (trend >= 0.05) return { label: "상승", type: "positive" };
  if (trend <= -0.25) return { label: "급락", type: "negative" };
  if (trend <= -0.05) return { label: "하락", type: "negative" };
  return { label: "유지", type: "warning" };
}

export function getUsageTrendLabel(usageTrend) {
  const labels = {
    strong_up: { label: "급등", type: "positive" },
    up: { label: "상승", type: "positive" },
    flat: { label: "유지", type: "warning" },
    down: { label: "하락", type: "negative" },
    strong_down: { label: "급락", type: "negative" },
  };
  return labels[usageTrend] || labels.flat;
}

export function getTokenReturnAmount(project) {
  const thirtyDay = project.thirtyDay || {};
  return Number(thirtyDay.buyback || 0) + Number(thirtyDay.burn || 0) + Number(thirtyDay.stakingDistribution || 0);
}

export function getAnnualizedBuyback(project) {
  return (Number(project.thirtyDay?.buyback) || 0) * 12;
}

export function getBuybackYield(project) {
  const marketCap = Number(project.marketCap) || 0;
  return marketCap > 0 ? getAnnualizedBuyback(project) / marketCap : 0;
}

export function getRevenueReturnRatio(project) {
  const revenue30d = Number(project.thirtyDay?.revenue) || 0;
  return revenue30d > 0 ? getTokenReturnAmount(project) / revenue30d : 0;
}

export function getBuybackIntensity(project) {
  const marketCap = Number(project.marketCap) || 0;
  if (marketCap <= 0) return 0;
  const avgDailyBuyback = (Number(project.thirtyDay?.buyback) || 0) / 30;
  return (avgDailyBuyback * 365) / marketCap;
}

export function getUnlockPressureRatio(project, window = "nextAmountUsd") {
  const amount = Number(project.unlocks?.[window]) || 0;
  const avgDailyVolume30d = (Number(project.thirtyDay?.volume) || 0) / 30;
  return avgDailyVolume30d > 0 ? amount / avgDailyVolume30d : 0;
}

export function getUnlockRisk(project) {
  const ratio = getUnlockPressureRatio(project);
  if (ratio >= 1) return { label: "높음", type: "negative", score: 3 };
  if (ratio >= 0.3) return { label: "보통", type: "warning", score: 2 };
  return { label: "낮음", type: "positive", score: 1 };
}

export function getValuation(project) {
  const annualizedRevenue = (Number(project.thirtyDay?.revenue) || 0) * 12;
  const annualizedHolderRevenue = (Number(project.thirtyDay?.holderRevenue) || 0) * 12;
  const tvl = Number(project.tvl) || 0;
  return {
    annualizedRevenue,
    annualizedHolderRevenue,
    fdvToRevenue: annualizedRevenue > 0 ? Number(project.fdv || 0) / annualizedRevenue : null,
    mcapToHolderRevenue: annualizedHolderRevenue > 0 ? Number(project.marketCap || 0) / annualizedHolderRevenue : null,
    fdvToTvl: tvl > 0 ? Number(project.fdv || 0) / tvl : null,
  };
}

export function getProjectScore(project) {
  const revenueScore = clamp((Number(project.thirtyDay?.revenue) || 0) / 65000000, 0, 1) * 18;
  const returnScore = clamp(getRevenueReturnRatio(project) / 0.75, 0, 1) * 22;
  const trendScore = getTrend(project.monthlyBuyback) > 0 ? 15 : 0;
  const intensityScore = clamp(getBuybackIntensity(project) / 0.08, 0, 1) * 18;
  const confidenceScore = project.dataConfidence === "high" ? 10 : project.dataConfidence === "medium" ? 5 : 0;
  const usageScore = getUsageTrendLabel(project.usage?.usageTrend).type === "positive" ? 8 : 0;
  const unlockPenalty = getUnlockRisk(project).score === 3 ? -12 : getUnlockRisk(project).score === 2 ? -5 : 0;
  const estimatedPenalty = project.buybackType === "estimated" ? -8 : 0;
  const nonePenalty = project.valueCaptureType === "none" ? -12 : 0;
  return Math.round(clamp(revenueScore + returnScore + trendScore + intensityScore + confidenceScore + usageScore + unlockPenalty + estimatedPenalty + nonePenalty, 0, 100));
}

export function getSignalFromScore(score) {
  if (score >= 80) return { signal: "강한 매수압", signalType: "positive" };
  if (score >= 60) return { signal: "매수압 우세", signalType: "positive" };
  if (score >= 40) return { signal: "중립 관찰", signalType: "warning" };
  return { signal: "매수압 약함", signalType: "negative" };
}

export function getProjection(project) {
  const recentMonthly = project.monthlyBuyback.slice(-3);
  const avgMonthly = recentMonthly.length
    ? recentMonthly.reduce((sum, value) => sum + Number(value || 0), 0) / recentMonthly.length
    : (Number(project.thirtyDay?.buyback) || 0) / 1000000;
  const trendMultiplier = clamp(1 + getTrend(project.monthlyBuyback), 0.55, 1.45);
  const baseUsd = avgMonthly * 6 * 1000000 * trendMultiplier;
  const conservativeUsd = baseUsd * 0.7;
  const aggressiveUsd = baseUsd * 1.25;
  const expectedAverageTokenPrice = Number(project.expectedAverageTokenPrice || project.price) || 1;
  return {
    baseUsd,
    conservativeUsd,
    aggressiveUsd,
    expectedAverageTokenPrice,
    baseToken: baseUsd / expectedAverageTokenPrice,
  };
}

export function getDashboardHighlights(projects) {
  const sorted = [...projects];
  const byRevenue = [...sorted].sort((a, b) => (b.thirtyDay?.revenue || 0) - (a.thirtyDay?.revenue || 0))[0];
  const byBuyback = [...sorted].sort((a, b) => (b.thirtyDay?.buyback || 0) - (a.thirtyDay?.buyback || 0))[0];
  const byYield = [...sorted].sort((a, b) => getBuybackYield(b) - getBuybackYield(a))[0];
  const byUnlock = [...sorted].sort((a, b) => getUnlockRisk(b).score - getUnlockRisk(a).score || getUnlockPressureRatio(b) - getUnlockPressureRatio(a))[0];
  const byCheap = [...sorted].filter((project) => getValuation(project).fdvToRevenue !== null).sort((a, b) => getValuation(a).fdvToRevenue - getValuation(b).fdvToRevenue)[0];
  const byUsage = [...sorted].sort((a, b) => getTrend(b.usage?.userGrowth6m || []) - getTrend(a.usage?.userGrowth6m || []))[0];
  return { byRevenue, byBuyback, byYield, byUnlock, byCheap, byUsage };
}

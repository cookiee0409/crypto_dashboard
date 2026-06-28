export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function getTrend(values = []) {
  if (values.length < 2) return 0;
  const first = Number(values[0]) || 0;
  const last = Number(values[values.length - 1]) || 0;
  return first === 0 ? 0 : (last - first) / first;
}

export function getBuybackIntensity(project) {
  const marketCap = Number(project.marketCap) || 0;
  if (marketCap <= 0) return 0;
  const avgDailyBuyback = (Number(project.thirtyDay?.buyback) || 0) / 30;
  return (avgDailyBuyback * 365) / marketCap;
}

export function getProjectScore(project) {
  const revenueScore = clamp((Number(project.thirtyDay?.revenue) || 0) / 65000000, 0, 1) * 20;
  const ratioScore = clamp((Number(project.revenueToBuybackRatio) || 0) / 0.9, 0, 1) * 25;
  const trend = getTrend(project.monthlyBuyback);
  const trendScore = trend > 0 ? 20 : 0;
  const intensityScore = clamp(getBuybackIntensity(project) / 0.08, 0, 1) * 20;
  const confidenceScore = project.dataConfidence === "high" ? 10 : 0;
  const volumeTrendPenalty = getTrend(project.monthlyVolume || []) < -0.2 ? -15 : 0;
  const estimatedPenalty = project.buybackType === "estimated" ? -10 : 0;
  return Math.round(clamp(revenueScore + ratioScore + trendScore + intensityScore + confidenceScore + volumeTrendPenalty + estimatedPenalty, 0, 100));
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

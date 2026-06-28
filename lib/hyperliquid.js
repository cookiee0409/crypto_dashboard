const HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info";
export const HYPERLIQUID_ASSISTANCE_FUND = "0xfefefefefefefefefefefefefefefefefefefefe";

async function postInfo(body) {
  const response = await fetch(HYPERLIQUID_INFO_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Hyperliquid 요청 실패: ${response.status}`);
  }
  return response.json();
}

export async function fetchHyperliquidUserFills(user, days = 180) {
  const endTime = Date.now();
  const startTime = endTime - days * 24 * 60 * 60 * 1000;
  const fills = [];
  let cursor = startTime;

  for (let page = 0; page < 25 && cursor < endTime; page += 1) {
    const pageFills = await postInfo({
      type: "userFillsByTime",
      user,
      startTime: cursor,
      endTime,
    });
    if (!Array.isArray(pageFills) || !pageFills.length) break;
    fills.push(...pageFills);
    const lastTime = Math.max(...pageFills.map((fill) => Number(fill.time) || cursor));
    if (pageFills.length < 2000 || lastTime <= cursor) break;
    cursor = lastTime + 1;
  }

  return fills.map((fill) => ({
    time: Number(fill.time || endTime),
    date: new Date(Number(fill.time || endTime)).toISOString().slice(0, 10),
    txHash: fill.hash || fill.tid || "hyperliquid-fill",
    token: fill.coin || "HYPE",
    side: fill.side || "",
    tokenAmount: Math.abs(Number(fill.sz) || 0),
    price: Number(fill.px) || 0,
    usd: Math.abs(Number(fill.sz) || 0) * (Number(fill.px) || 0),
    source: "Hyperliquid userFillsByTime",
    buybackType: "actual_onchain",
  }));
}

export async function fetchHyperliquidClearinghouseState(user) {
  return postInfo({ type: "clearinghouseState", user });
}

export async function fetchHyperliquidPortfolio(user) {
  return postInfo({ type: "portfolio", user });
}

export async function fetchHyperliquidSpotClearinghouseState(user) {
  return postInfo({ type: "spotClearinghouseState", user });
}

export async function fetchHyperliquidSpotMeta() {
  return postInfo({ type: "spotMeta" });
}

export function getLatestAccountValue(portfolio) {
  const daySection = Array.isArray(portfolio) ? portfolio.find((section) => section?.[0] === "day")?.[1] : null;
  const accountHistory = daySection?.accountValueHistory;
  const latest = Array.isArray(accountHistory) ? accountHistory.at(-1) : null;
  return Number(latest?.[1]) || 0;
}

export function getHypeSpotSymbols(spotMeta) {
  const hypeToken = spotMeta?.tokens?.find((token) => token?.name === "HYPE");
  if (!hypeToken) return new Set(["HYPE"]);
  const symbols = new Set(["HYPE"]);
  for (const market of spotMeta?.universe || []) {
    if (Array.isArray(market.tokens) && market.tokens.includes(hypeToken.index)) {
      symbols.add(market.name);
    }
  }
  return symbols;
}

export function getHypeBalance(spotState) {
  const balance = spotState?.balances?.find((item) => item?.coin === "HYPE");
  return {
    amount: Number(balance?.total) || 0,
    entryNotionalUsd: Number(balance?.entryNtl) || 0,
  };
}

export async function fetchHyperliquidAssistanceFundData(user = HYPERLIQUID_ASSISTANCE_FUND, days = 180) {
  const [portfolio, spotState, spotMeta, fills] = await Promise.all([
    fetchHyperliquidPortfolio(user),
    fetchHyperliquidSpotClearinghouseState(user),
    fetchHyperliquidSpotMeta(),
    fetchHyperliquidUserFills(user, days),
  ]);
  const hypeSymbols = getHypeSpotSymbols(spotMeta);
  const events = fills
    .filter((fill) => hypeSymbols.has(fill.token) && (!fill.side || String(fill.side).toLowerCase().includes("b")) && fill.usd > 0)
    .map((fill) => ({
      ...fill,
      token: "HYPE",
      source: "Hyperliquid Assistance Fund",
      buybackType: "actual_onchain",
    }));

  return {
    accountValueUsd: getLatestAccountValue(portfolio),
    hypeBalance: getHypeBalance(spotState),
    hypeSymbols: Array.from(hypeSymbols),
    events,
  };
}

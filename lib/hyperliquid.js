const HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info";

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
  const fills = await postInfo({
    type: "userFillsByTime",
    user,
    startTime,
    endTime,
  });
  return Array.isArray(fills)
    ? fills.map((fill) => ({
        date: new Date(Number(fill.time || endTime)).toISOString().slice(0, 10),
        txHash: fill.hash || fill.tid || "hyperliquid-fill",
        token: fill.coin || "HYPE",
        side: fill.side || "",
        tokenAmount: Math.abs(Number(fill.sz) || 0),
        price: Number(fill.px) || 0,
        usd: Math.abs(Number(fill.sz) || 0) * (Number(fill.px) || 0),
        source: "Hyperliquid userFillsByTime",
        buybackType: "actual",
      }))
    : [];
}

export async function fetchHyperliquidClearinghouseState(user) {
  return postInfo({ type: "clearinghouseState", user });
}

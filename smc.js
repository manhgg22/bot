// smc.js

// Tìm swing high/low (điểm đảo chiều)
export function findSwingPoints(candles, lookback = 2) {
  const swings = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const left = candles.slice(i - lookback, i);
    const right = candles.slice(i + 1, i + 1 + lookback);
    const isHigh = left.every(c => c.high < candles[i].high) &&
                   right.every(c => c.high < candles[i].high);
    const isLow = left.every(c => c.low > candles[i].low) &&
                  right.every(c => c.low > candles[i].low);
    if (isHigh || isLow) {
      swings.push({ ...candles[i], type: isHigh ? "SWING_HIGH" : "SWING_LOW" });
    }
  }
  return swings;
}

// Tìm order block đơn giản
export function findOrderBlock(candles, direction = "BULLISH") {
  if (direction === "BULLISH") {
    // tìm nến giảm cuối trước khi break đỉnh
    for (let i = candles.length - 3; i >= 0; i--) {
      if (candles[i].close < candles[i].open) {
        return { low: candles[i].low, high: candles[i].high };
      }
    }
  } else {
    // tìm nến tăng cuối trước khi break đáy
    for (let i = candles.length - 3; i >= 0; i--) {
      if (candles[i].close > candles[i].open) {
        return { low: candles[i].low, high: candles[i].high };
      }
    }
  }
  return null;
}

// Kiểm tra giá có chạm order block không
export function checkRetest(price, ob, direction) {
  if (!ob) return null;
  if (direction === "BULLISH" && price <= ob.high && price >= ob.low) return "LONG";
  if (direction === "BEARISH" && price <= ob.high && price >= ob.low) return "SHORT";
  return null;
}

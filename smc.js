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

// Lấy swing high/low gần nhất (dễ hiểu, dựa trên findSwingPoints đã có)
export function lastSwingHighLow(candles) {
  const swings = findSwingPoints(candles); // giả định trả về mảng {index, price, type: 'SWING_HIGH'|'SWING_LOW'}
  const lastHigh = [...swings].reverse().find(s => s.type === "SWING_HIGH");
  const lastLow  = [...swings].reverse().find(s => s.type === "SWING_LOW");
  return { lastHigh, lastLow };
}

// Phát hiện BOS đơn giản: giá đóng cửa phá qua swing gần nhất theo hướng kỳ vọng
export function detectBOS(candles, wantDirection = "BULLISH") {
  if (candles.length < 50) return false;
  const { lastHigh, lastLow } = lastSwingHighLow(candles);
  const close = candles[candles.length - 1].close;

  if (wantDirection === "BULLISH") {
    if (!lastHigh) return false;
    return close > lastHigh.price;
  } else {
    if (!lastLow) return false;
    return close < lastLow.price;
  }
}

// Tìm các mức giá chính (hỗ trợ/kháng cự)
export function findKeyLevels(candles, lookback = 5) {
  const levels = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const current = candles[i];
    const left = candles.slice(i - lookback, i);
    const right = candles.slice(i + 1, i + lookback);
    
    // Kiểm tra xem giá có phải cao nhất/thấp nhất trong khoảng không
    const isHigh = left.every(c => c.high <= current.high) && 
                   right.every(c => c.high <= current.high);
    const isLow = left.every(c => c.low >= current.low) &&
                  right.every(c => c.low >= current.low);
    
    if (isHigh) levels.push({ price: current.high, type: 'resistance' });
    if (isLow) levels.push({ price: current.low, type: 'support' });
  }
  return levels;
}

// Phát hiện động lượng dựa trên các nến gần đây
export function detectMomentum(candles, period = 10) {
  const closes = candles.slice(-period).map(c => c.close);
  const opens = candles.slice(-period).map(c => c.open);
  
  // Đếm số nến mạnh
  let bullCount = 0, bearCount = 0;
  for (let i = 0; i < period; i++) {
    if (closes[i] > opens[i] * 1.001) bullCount++;
    if (closes[i] < opens[i] * 0.999) bearCount++;
  }

  if (bullCount > period * 0.7) return "BULLISH";
  if (bearCount > period * 0.7) return "BEARISH";
  return "NEUTRAL";
}

// Tìm Fair Value Gap (FVG) - khoảng trống giá
export function findFVG(candles, direction = "BULLISH") {
  if (candles.length < 3) return null;
  
  // Tìm 3 nến liên tiếp để tạo FVG
  for (let i = candles.length - 3; i >= 0; i--) {
    const candle1 = candles[i];
    const candle2 = candles[i + 1];
    const candle3 = candles[i + 2];
    
    if (direction === "BULLISH") {
      // FVG tăng: nến 1 và 3 đều tăng, nến 2 tạo khoảng trống
      if (candle1.close > candle1.open && candle3.close > candle3.open) {
        const gapLow = Math.max(candle1.high, candle3.low);
        const gapHigh = Math.min(candle1.high, candle3.low);
        if (gapHigh > gapLow) {
          return { low: gapLow, high: gapHigh, type: "BULLISH_FVG" };
        }
      }
    } else {
      // FVG giảm: nến 1 và 3 đều giảm, nến 2 tạo khoảng trống
      if (candle1.close < candle1.open && candle3.close < candle3.open) {
        const gapLow = Math.max(candle1.low, candle3.high);
        const gapHigh = Math.min(candle1.low, candle3.high);
        if (gapHigh > gapLow) {
          return { low: gapLow, high: gapHigh, type: "BEARISH_FVG" };
        }
      }
    }
  }
  
  return null;
}

// Kiểm tra giá có retest FVG không
export function checkFVGRetest(price, fvg, direction) {
  if (!fvg) return false;
  if (direction === "BULLISH" && price >= fvg.low && price <= fvg.high) return true;
  if (direction === "BEARISH" && price >= fvg.low && price <= fvg.high) return true;
  return false;
}


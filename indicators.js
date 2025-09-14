import { getCandles } from "./okx.js";
import { findSwingPoints, findOrderBlock, checkRetest } from "./smc.js";

// ==== EMA ====
export function calcEMA(values, period) {
  const k = 2 / (period + 1);
  return values.reduce((acc, price, i) => {
    if (i === 0) return [price];
    const ema = price * k + acc[i - 1] * (1 - k);
    acc.push(ema);
    return acc;
  }, []);
}

// ==== RSI ====
export function calcRSI(candles, period = 14) {
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  let rsiArr = [];

  for (let i = period; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - diff) / period;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiArr.push(100 - 100 / (1 + rs));
  }
  return rsiArr[rsiArr.length - 1];
}

// ==== FVG ====
export function findFVG(candles, direction = "BULLISH") {
  for (let i = candles.length - 3; i >= 2; i--) {
    const c1 = candles[i - 2];
    const c2 = candles[i - 1];
    const c3 = candles[i];

    if (direction === "BULLISH" && c1.high < c3.low) {
      return { low: c1.high, high: c3.low };
    }
    if (direction === "BEARISH" && c1.low > c3.high) {
      return { low: c3.high, high: c1.low };
    }
  }
  return null;
}

export function checkFVG(price, fvg) {
  if (!fvg) return false;
  return price >= fvg.low && price <= fvg.high;
}

// ==== Daily Bias ====
export async function getDailyBias(symbol) {
  const candlesD = await getCandles(symbol, "1D", 100);
  const closes = candlesD.map(c => c.close);
  const ema50 = calcEMA(closes, 50);
  const lastClose = closes[closes.length - 1];
  const lastEMA50 = ema50[ema50.length - 1];

  return lastClose > lastEMA50 ? "BULLISH" : "BEARISH";
}

// ==== Hàm xác định xu hướng ngắn hạn ====
function getDirection(candles) {
  const swings = findSwingPoints(candles);
  const lastSwing = swings[swings.length - 1];
  return lastSwing?.type === "SWING_LOW" ? "BULLISH" : "BEARISH";
}

// ==== Hàm tính TP & SL ====
function calcTpSl(direction, ob, entryPrice) {
  if (!ob) return { tp: null, sl: null };

  if (direction === "BULLISH") {
    const sl = ob.low;
    const risk = entryPrice - sl;
    const tp = entryPrice + risk * 2;
    return { tp, sl };
  } else {
    const sl = ob.high;
    const risk = sl - entryPrice;
    const tp = entryPrice - risk * 2;
    return { tp, sl };
  }
}

// ==== Hàm quét & lọc tín hiệu ====
export async function scanSymbol(symbol, bot, chatId) {
  try {
    const [candles15m, candles1h, candles4h, dailyBias] = await Promise.all([
      getCandles(symbol, "15m", 100),
      getCandles(symbol, "1H", 100),
      getCandles(symbol, "4H", 100),
      getDailyBias(symbol),
    ]);

    const dir15 = getDirection(candles15m);
    const dir1h = getDirection(candles1h);
    const dir4h = getDirection(candles4h);

    if (dir15 === dir1h && dir1h === dir4h && dir1h === dailyBias) {
      const closes = candles1h.map(c => c.close);
      const ema20 = calcEMA(closes, 20);
      const ema50 = calcEMA(closes, 50);
      const lastEMA20 = ema20[ema20.length - 1];
      const lastEMA50 = ema50[ema50.length - 1];
      const price = closes[closes.length - 1];

      if (dir1h === "BULLISH" && !(price > lastEMA50 && lastEMA20 > lastEMA50)) return;
      if (dir1h === "BEARISH" && !(price < lastEMA50 && lastEMA20 < lastEMA50)) return;

      const rsi = calcRSI(candles15m);
      if (dir1h === "BULLISH" && rsi < 35) return;
      if (dir1h === "BEARISH" && rsi > 65) return;

      const vols = candles1h.map(c => Number(c.vol));
      const avgVol = vols.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const lastVol = vols[vols.length - 1];
      if (lastVol < avgVol) return;

      const ob = findOrderBlock(candles1h, dir1h);
      const fvg = findFVG(candles1h, dir1h);
      if (!checkFVG(price, fvg)) return;

      const signal = checkRetest(price, ob, dir1h);

      if (signal) {
        const { tp, sl } = calcTpSl(dir1h, ob, price);
        const text = 
`📊 ${symbol}
Hướng: ${dir1h === "BULLISH" ? "LONG ✅" : "SHORT 🔻"} (Daily Bias: ${dailyBias})
Giá hiện tại: ${price}
EMA20: ${lastEMA20.toFixed(2)} | EMA50: ${lastEMA50.toFixed(2)}
RSI(15m): ${rsi.toFixed(2)} | Volume: ${(lastVol / avgVol * 100).toFixed(1)}%
FVG: ${fvg ? `${fvg.low} - ${fvg.high}` : "Không có"}
Vùng OB: ${ob ? `${ob.low} - ${ob.high}` : "Không xác định"}
🎯 TP: ${tp ? tp.toFixed(4) : "?"}
🛑 SL: ${sl ? sl.toFixed(4) : "?"}`;

        console.log(text);
        if (bot && chatId) await bot.sendMessage(chatId, text);
      }
    }
  } catch (err) {
    console.error(`❌ Lỗi khi quét ${symbol}:`, err.message);
  }
}

import { getCandles } from "./okx.js";
import { findSwingPoints, findOrderBlock, checkRetest } from "./smc.js";
import { getOpenTrades, closeTrade } from "./tradeManager.js";

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
  const signals = await getSignals(symbol); // hàm cũ của bạn tính EMA, RSI...
  const trades = getOpenTrades();
  const trade = trades.find(t => t.symbol === symbol);

  // Nếu có lệnh đang theo dõi, check TP/SL hoặc đảo chiều
  if (trade) {
    if (
      (trade.direction === "LONG" && signals.price <= trade.sl) ||
      (trade.direction === "SHORT" && signals.price >= trade.sl)
    ) {
      bot.sendMessage(
        chatId,
        `❌ [STOP LOSS] ${symbol}: Giá chạm SL (${trade.sl}). Đóng lệnh ${trade.direction}`
      );
      closeTrade(symbol, bot, chatId, "Hit SL");
    } else if (
      (trade.direction === "LONG" && signals.price >= trade.tp) ||
      (trade.direction === "SHORT" && signals.price <= trade.tp)
    ) {
      bot.sendMessage(
        chatId,
        `✅ [TAKE PROFIT] ${symbol}: Giá chạm TP (${trade.tp}). Đóng lệnh ${trade.direction}`
      );
      closeTrade(symbol, bot, chatId, "Hit TP");
    } else if (
      (trade.direction === "LONG" && signals.direction === "SHORT") ||
      (trade.direction === "SHORT" && signals.direction === "LONG")
    ) {
      bot.sendMessage(
        chatId,
        `🚨 [EXIT] ${symbol}: Tín hiệu đảo chiều sang ${signals.direction}. Đề nghị thoát lệnh!`
      );
      closeTrade(symbol, bot, chatId, "Đảo chiều tín hiệu");
    }
  }
}

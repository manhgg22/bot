// indicators.js
import { getCandles } from "./okx.js";
import { findSwingPoints, findOrderBlock } from "./smc.js";
import { getOpenTrades, closeTrade } from "./tradeManager.js";

/* ==================== EMA ==================== */
export function calcEMA(values, period) {
  const k = 2 / (period + 1);
  return values.reduce((acc, price, i) => {
    if (i === 0) return [price];
    const ema = price * k + acc[i - 1] * (1 - k);
    acc.push(ema);
    return acc;
  }, []);
}

/* ==================== RSI ==================== */
export function calcRSI(candles, period = 14) {
  if (candles.length < period + 1) return 50; // phòng thiếu dữ liệu
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  const rsiArr = [];

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

/* ==================== FVG ==================== */
export function findFVG(candles, direction = "BULLISH") {
  // Tìm gap 3 nến gần nhất theo định nghĩa cơ bản
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

/* ==================== Daily Bias ==================== */
export async function getDailyBias(symbol) {
  const candlesD = await getCandles(symbol, "1D", 120);
  const closes = candlesD.map(c => c.close);
  const ema50 = calcEMA(closes, 50);
  const lastClose = closes[closes.length - 1];
  const lastEMA50 = ema50[ema50.length - 1];
  return lastClose > lastEMA50 ? "BULLISH" : "BEARISH";
}

/* ============ Xác định hướng ngắn hạn từ swing ============ */
function getDirection(candles) {
  const swings = findSwingPoints(candles);
  const lastSwing = swings[swings.length - 1];
  return lastSwing?.type === "SWING_LOW" ? "BULLISH" : "BEARISH";
}

/* ==================== TP/SL ==================== */
function calcTpSl(biasDir, ob, entryPrice) {
  // biasDir: "BULLISH" cho LONG, "BEARISH" cho SHORT
  if (!ob) return { tp: null, sl: null };

  if (biasDir === "BULLISH") {
    const sl = ob.low;
    const risk = entryPrice - sl;
    const tp = entryPrice + risk * 2; // RR mặc định 1:2, có thể đọc từ .env nếu muốn
    return { tp, sl };
  } else {
    const sl = ob.high;
    const risk = sl - entryPrice;
    const tp = entryPrice - risk * 2;
    return { tp, sl };
  }
}

/* =========================================================
   =============== TẠO HÀM getSignals() ====================
   Gom tín hiệu cho 3 TF (15m, 1H, 4H) + FVG + Daily Bias
   Trả về:
   {
     price,                // giá 15m hiện tại
     tf: { "15m": "...", "1h": "...", "4h": "..." }, // BULLISH/BEARISH/NEUTRAL
     dailyBias,            // BULLISH/BEARISH
     direction,            // LONG/SHORT/NONE (đồng thuận 3TF + dailyBias)
     ob,                   // order block trên 15m theo hướng direction
     fvg,                  // fair value gap theo hướng direction
     fvgOk,                // giá nằm trong FVG?
     retestOb,             // giá đang retest OB? (kiểm đơn giản)
     tp, sl                // gợi ý TP/SL theo OB
   }
========================================================= */
export async function getSignals(symbol) {
  // Lấy dữ liệu
  const [m15, h1, h4] = await Promise.all([
    getCandles(symbol, "15m", 200),
    getCandles(symbol, "1H",  200),
    getCandles(symbol, "4H",  200),
  ]);

  const lastPrice = m15[m15.length - 1]?.close ?? NaN;

  // Helper: tính tín hiệu cho 1 TF
  const tfSignal = (candles) => {
    const closes = candles.map(c => c.close);
    const ema50 = calcEMA(closes, 50);
    const emaLast = ema50[ema50.length - 1];
    const rsi14  = calcRSI(candles, 14);
    const price  = closes[closes.length - 1];
    const swingDir = getDirection(candles); // BULLISH/BEARISH

    // Đồng pha: giá > EMA50 + RSI>50 + swing BULLISH -> BULLISH
    if (price > emaLast && rsi14 > 50 && swingDir === "BULLISH") return "BULLISH";
    if (price < emaLast && rsi14 < 50 && swingDir === "BEARISH") return "BEARISH";
    return "NEUTRAL";
  };

  const s15 = tfSignal(m15);
  const s1h = tfSignal(h1);
  const s4h = tfSignal(h4);

  const dailyBias = await getDailyBias(symbol);

  // Đồng thuận + theo daily bias
  let direction = "NONE"; // LONG/SHORT/NONE
  if (s15 === "BULLISH" && s1h === "BULLISH" && s4h === "BULLISH" && dailyBias === "BULLISH") {
    direction = "LONG";
  } else if (s15 === "BEARISH" && s1h === "BEARISH" && s4h === "BEARISH" && dailyBias === "BEARISH") {
    direction = "SHORT";
  }

  // FVG + OB trên 15m theo hướng direction
  const biasDir = direction === "LONG" ? "BULLISH" : direction === "SHORT" ? "BEARISH" : null;
  const ob  = biasDir ? findOrderBlock(m15, biasDir) : null;
  const fvg = biasDir ? findFVG(m15, biasDir) : null;

  // Kiểm tra retest đơn giản (nằm trong khung OB)
  const retestOb = ob ? (lastPrice >= ob.low && lastPrice <= ob.high) : false;

  // TP/SL gợi ý theo OB
  const { tp, sl } = biasDir ? calcTpSl(biasDir, ob, lastPrice) : { tp: null, sl: null };

  // Giá có đang nằm trong FVG không?
  const fvgOk = checkFVG(lastPrice, fvg);

  return {
    price: lastPrice,
    tf: { "15m": s15, "1h": s1h, "4h": s4h },
    dailyBias,
    direction, // LONG / SHORT / NONE
    ob, fvg, fvgOk, retestOb,
    tp, sl,
  };
}

/* ==================== SCAN & QUẢN LÝ THOÁT LỆNH ==================== */
export async function scanSymbol(symbol, bot, chatId) {
  // >>> Sửa lỗi: thêm getSignals
  const signals = await getSignals(symbol);

  // Nếu bạn muốn thấy log TF:
  console.log(
    `📊 ${symbol} | 15m:${signals.tf["15m"]} 1h:${signals.tf["1h"]} 4h:${signals.tf["4h"]} | Bias:${signals.dailyBias} | Giá:${signals.price}`
  );

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
        `❌ [STOP LOSS] ${symbol}: Giá chạm SL (${trade.sl}). Đóng lệnh ${trade.direction}.`
      );
      closeTrade(symbol, bot, chatId, "Hit SL");
      return;
    }

    if (
      (trade.direction === "LONG" && signals.price >= trade.tp) ||
      (trade.direction === "SHORT" && signals.price <= trade.tp)
    ) {
      bot.sendMessage(
        chatId,
        `✅ [TAKE PROFIT] ${symbol}: Giá chạm TP (${trade.tp}). Đóng lệnh ${trade.direction}.`
      );
      closeTrade(symbol, bot, chatId, "Hit TP");
      return;
    }

    // Đảo chiều mạnh (đồng thuận ngược hướng)
    if (
      (trade.direction === "LONG"  && signals.direction === "SHORT") ||
      (trade.direction === "SHORT" && signals.direction === "LONG")
    ) {
      bot.sendMessage(
        chatId,
        `🚨 [EXIT] ${symbol}: Tín hiệu đảo chiều sang ${signals.direction}. Đề nghị thoát lệnh!`
      );
      closeTrade(symbol, bot, chatId, "Đảo chiều tín hiệu");
      return;
    }
  }

  // GHI CHÚ:
  // Ở đây mình không tự gửi ENTRY vì bạn đã nói sẽ chủ động báo lệnh (/long, /short).
  // Nếu muốn bot gợi ý entry khi có đồng thuận + retest OB + nằm trong FVG,
  // có thể bật đoạn dưới (bỏ comment) để nó gửi tín hiệu tham khảo:
  /*
  if (!trade && signals.direction !== "NONE" && signals.retestOb && signals.fvgOk) {
    const side = signals.direction; // LONG/SHORT
    bot.sendMessage(
      chatId,
      `🟢 [SETUP] ${symbol} | ${side}
15m:${signals.tf["15m"]} 1h:${signals.tf["1h"]} 4h:${signals.tf["4h"]} | Bias:${signals.dailyBias}
Giá:${signals.price}
OB:[${signals.ob?.low} - ${signals.ob?.high}] | FVG:${signals.fvg ? `${signals.fvg.low}-${signals.fvg.high}` : "none"}
🎯 TP:${signals.tp} | 🛑 SL:${signals.sl}`
    );
  }
  */
}

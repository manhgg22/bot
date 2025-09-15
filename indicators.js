// indicators.js
import { getCandles } from "./okx.js";
import { findSwingPoints, findOrderBlock } from "./smc.js";
import { detectBOS } from "./smc.js";
import { getOpenTrades, closeTrade } from "./tradeManager.js";

/* ============== EMA & RSI ============== */
export function calcEMA(values, period) {
  const k = 2 / (period + 1);
  return values.reduce((acc, price, i) => {
    if (i === 0) return [price];
    const ema = price * k + acc[i - 1] * (1 - k);
    acc.push(ema);
    return acc;
  }, []);
}

export function calcRSI(candles, period = 14) {
  if (candles.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gains += diff; else losses -= diff;
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
  return rsiArr.at(-1);
}

/* ============== ATR (cho SL/TP động) ============== */
export function calcATR(candles, period = 14) {
  if (candles.length < period + 2) return 0;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const pc = candles[i - 1].close;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trs.push(tr);
  }
  // SMA ATR
  const atr = trs.slice(-period).reduce((a, b) => a + b, 0) / period;
  return atr;
}

/* ============== FVG ============== */
export function findFVG(candles, direction = "BULLISH") {
  for (let i = candles.length - 3; i >= 2; i--) {
    const c1 = candles[i - 2];
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

/* ============== Daily Bias (EMA50) ============== */
export async function getDailyBias(symbol) {
  const daily = await getCandles(symbol, "1D", 150);
  if (!daily.length) return "NEUTRAL";
  const closes = daily.map(c => c.close);
  const ema50 = calcEMA(closes, 50).at(-1);
  const lastClose = closes.at(-1);
  return lastClose > ema50 ? "BULLISH" : "BEARISH";
}

/* ============== BOS trên H1/H4 ============== */
async function getHTFBOS(symbol, bias) {
  const [h1, h4] = await Promise.all([
    getCandles(symbol, "1H", 200),
    getCandles(symbol, "4H", 200)
  ]);
  const want = bias; // "BULLISH" -> muốn BOS lên; "BEARISH" -> BOS xuống
  const bosH1 = detectBOS(h1, want);
  const bosH4 = detectBOS(h4, want);
  return { bosH1, bosH4, h1, h4 };
}

/* ============== Entry trên 15m: OB/FVG + RSI xác nhận ============== */
async function getLTFEntry(symbol, bias) {
  const m15 = await getCandles(symbol, "15m", 220);
  if (m15.length < 50) return null;
  const price = m15.at(-1).close;

  const rsi = calcRSI(m15, 14);
  const ob = findOrderBlock(m15, bias);            // cần sẵn trong smc.js
  const fvg = findFVG(m15, bias);

  // retest OB: giá nằm trong khung OB
  const retestOb = ob ? (price >= ob.low && price <= ob.high) : false;
  // retest FVG: giá trong FVG
  const retestFvg = checkFVG(price, fvg);

  // xác nhận RSI "vừa đủ" theo bias (tránh quá mua/quá bán cực đoan lúc breakout)
  const rsiOk = (bias === "BULLISH") ? rsi >= 45 : rsi <= 55;

  // ATR để đặt SL/TP
  const atr = calcATR(m15, 14);
  if (!atr) return { price, rsi, ob, fvg, retestOb, retestFvg, rsiOk, atr: 0, tp: null, sl: null };

  let sl, tp;
  const ATR_SL = 1.0;   // SL = 1 ATR
  const ATR_TP = 2.0;   // TP = 2 ATR (RR 1:2)
  if (bias === "BULLISH") {
    sl = ob ? Math.min(ob.low, price - ATR_SL * atr) : price - ATR_SL * atr;
    tp = price + ATR_TP * atr;
  } else {
    sl = ob ? Math.max(ob.high, price + ATR_SL * atr) : price + ATR_SL * atr;
    tp = price - ATR_TP * atr;
  }

  return { price, rsi, ob, fvg, retestOb, retestFvg, rsiOk, atr, tp, sl };
}

/* ============== Tín hiệu Confluence tổng hợp ============== */
export async function getSignalsConfluence(symbol) {
  const dailyBias = await getDailyBias(symbol);             // BULLISH/BEARISH
  if (dailyBias === "NEUTRAL") return { direction: "NONE", reason: "No daily bias" };

  const { bosH1, bosH4 } = await getHTFBOS(symbol, dailyBias);
  // yêu cầu ít nhất BOS trên H1 đồng thuận; H4 có thì càng tốt
  if (!bosH1) return { direction: "NONE", reason: "No BOS on H1", dailyBias, bosH1, bosH4 };

  const ltf = await getLTFEntry(symbol, dailyBias);
  if (!ltf) return { direction: "NONE", reason: "No LTF data", dailyBias, bosH1, bosH4 };

  // điều kiện entry an toàn: retest OB hoặc FVG + RSI ok
  const entryOk = (ltf.retestOb || ltf.retestFvg) && ltf.rsiOk;

  if (!entryOk)
    return {
      direction: "NONE",
      reason: "No clean retest OB/FVG or RSI filter not passed",
      dailyBias, bosH1, bosH4, ...ltf
    };

  const direction = (dailyBias === "BULLISH") ? "LONG" : "SHORT";

  return {
    direction,
    dailyBias,
    bosH1,
    bosH4,
    price: ltf.price,
    rsi: ltf.rsi,
    ob: ltf.ob,
    fvg: ltf.fvg,
    retestOb: ltf.retestOb,
    retestFvg: ltf.retestFvg,
    atr: ltf.atr,
    tp: ltf.tp,
    sl: ltf.sl
  };
}

/* ============== Quét & quản lý lệnh mở (giữ nguyên cách bạn đang dùng) ============== */
export async function scanSymbol(symbol, bot, chatId) {
  try {
    const sig = await getSignalsConfluence(symbol);

    // Log gọn trạng thái
    console.log(`📊 ${symbol} | Bias:${sig.dailyBias || "-"} BOS(H1/H4):${sig.bosH1?"Y":"N"}/${sig.bosH4?"Y":"N"} Dir:${sig.direction} Price:${sig.price ?? "-"}`);

    // Quản lý lệnh đang theo dõi
    const trades = getOpenTrades();
    const trade = trades.find(t => t.symbol === symbol);

    if (trade) {
      // TP/SL
      if ((trade.direction === "LONG" && sig.price <= trade.sl) ||
          (trade.direction === "SHORT" && sig.price >= trade.sl)) {
        bot.sendMessage(chatId, `❌ [STOP LOSS] ${symbol}: Giá chạm SL (${trade.sl}). Đóng lệnh ${trade.direction}.`);
        closeTrade(symbol, bot, chatId, "Hit SL");
        return;
      }
      if ((trade.direction === "LONG" && sig.price >= trade.tp) ||
          (trade.direction === "SHORT" && sig.price <= trade.tp)) {
        bot.sendMessage(chatId, `✅ [TAKE PROFIT] ${symbol}: Giá chạm TP (${trade.tp}). Đóng lệnh ${trade.direction}.`);
        closeTrade(symbol, bot, chatId, "Hit TP");
        return;
      }
      // Đảo chiều mạnh (bias đổi + bos ngược)
      if (sig.direction !== "NONE" && sig.direction !== trade.direction) {
        bot.sendMessage(chatId, `🚨 [EXIT] ${symbol}: Tín hiệu đảo chiều (${sig.direction}). Nên thoát lệnh ${trade.direction}.`);
        closeTrade(symbol, bot, chatId, "Đảo chiều tín hiệu");
        return;
      }
    }

    // KHÔNG tự động gửi ENTRY vì bạn đang tự báo /long /short.
    // Nếu muốn bot gợi ý entry cực sạch, bật đoạn dưới (bỏ comment):
    /*
    if (!trade && sig.direction !== "NONE") {
      bot.sendMessage(
        chatId,
        `🟢 [SETUP] ${symbol} | ${sig.direction}
Bias: ${sig.dailyBias} | BOS H1/H4: ${sig.bosH1?"✔︎":"✖︎"}/${sig.bosH4?"✔︎":"✖︎"}
Giá: ${sig.price}
OB: ${sig.ob ? `[${sig.ob.low} - ${sig.ob.high}]` : "None"} | FVG: ${sig.fvg ? `${sig.fvg.low}-${sig.fvg.high}` : "None"}
RSI: ${sig.rsi?.toFixed(1)} | ATR(15m): ${sig.atr?.toFixed(4)}
🎯 TP: ${sig.tp?.toFixed(6)} | 🛑 SL: ${sig.sl?.toFixed(6)}`
      );
    }
    */
  } catch (err) {
    console.error(`❌ Lỗi scan ${symbol}:`, err.message);
  }
}

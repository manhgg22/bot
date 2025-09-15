// indicators.js
import { getCandles } from "./okx.js";
import { findOrderBlock, detectBOS } from "./smc.js";
import { getOpenTrades, closeTrade } from "./tradeManager.js";

/* ============== CÁC HÀM TÍNH TOÁN CƠ BẢN (GIỮ NGUYÊN) ============== */
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
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiArr.push(100 - 100 / (1 + rs));
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - diff) / period;
    }
  }
  return rsiArr.at(-1);
}

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
  const atr = trs.slice(-period).reduce((a, b) => a + b, 0) / period;
  return atr;
}

export function findFVG(candles, direction = "BULLISH") {
  for (let i = candles.length - 3; i >= 2; i--) {
    const c1 = candles[i - 2];
    const c3 = candles[i];
    if (direction === "BULLISH" && c1.high < c3.low) return { low: c1.high, high: c3.low };
    if (direction === "BEARISH" && c1.low > c3.high) return { low: c3.high, high: c1.low };
  }
  return null;
}
export function checkFVG(price, fvg) {
  if (!fvg) return false;
  return price >= fvg.low && price <= fvg.high;
}

/* ============== CÁC HÀM PHÂN TÍCH (GIỮ NGUYÊN) ============== */
export async function getDailyBias(symbol) {
  const daily = await getCandles(symbol, "1D", 150);
  if (!daily.length) return "NEUTRAL";
  const closes = daily.map(c => c.close);
  const ema50 = calcEMA(closes, 50).at(-1);
  const lastClose = closes.at(-1);
  return lastClose > ema50 ? "BULLISH" : "BEARISH";
}

async function getHTFBOS(symbol, bias) {
  const [h1, h4] = await Promise.all([
    getCandles(symbol, "1H", 200),
    getCandles(symbol, "4H", 200)
  ]);
  const want = bias;
  const bosH1 = detectBOS(h1, want);
  const bosH4 = detectBOS(h4, want);
  return { bosH1, bosH4, h1, h4 };
}

async function getLTFEntry(symbol, bias) {
  const m15 = await getCandles(symbol, "15m", 220);
  if (m15.length < 50) return null;
  const price = m15.at(-1).close;
  const rsi = calcRSI(m15, 14);
  const ob = findOrderBlock(m15, bias);
  const fvg = findFVG(m15, bias);
  const retestOb = ob ? (price >= ob.low && price <= ob.high) : false;
  const retestFvg = checkFVG(price, fvg);
  const rsiOk = (bias === "BULLISH") ? rsi >= 45 : rsi <= 55;
  const atr = calcATR(m15, 14);
  if (!atr) return { price, rsi, ob, fvg, retestOb, retestFvg, rsiOk, atr: 0, tp: null, sl: null };
  let sl, tp;
  const ATR_SL = 1.5, ATR_TP = 3.0;
  if (bias === "BULLISH") {
    sl = ob ? Math.min(ob.low, price - ATR_SL * atr) : price - ATR_SL * atr;
    tp = price + ATR_TP * atr;
  } else {
    sl = ob ? Math.max(ob.high, price + ATR_SL * atr) : price + ATR_SL * atr;
    tp = price - ATR_TP * atr;
  }
  return { price, rsi, ob, fvg, retestOb, retestFvg, rsiOk, atr, tp, sl };
}

/* ============== [CHIẾN LƯỢC 1 & 2] (GIỮ NGUYÊN) ============== */
export async function getSignalsSMC(symbol) {
  const dailyBias = await getDailyBias(symbol);
  if (dailyBias === "NEUTRAL") return { direction: "NONE" };
  const { bosH1 } = await getHTFBOS(symbol, dailyBias);
  if (!bosH1) return { direction: "NONE" };
  const ltf = await getLTFEntry(symbol, dailyBias);
  if (!ltf) return { direction: "NONE" };
  const entryOk = (ltf.retestOb || ltf.retestFvg) && ltf.rsiOk;
  if (!entryOk) return { direction: "NONE" };
  const direction = (dailyBias === "BULLISH") ? "LONG" : "SHORT";
  return { strategy: "SMC", direction, price: ltf.price, tp: ltf.tp, sl: ltf.sl };
}

export async function getSignalsEMACross(symbol) {
    const candles = await getCandles(symbol, "1H", 250);
    if (candles.length < 201) return { direction: "NONE" };
    const closes = candles.map(c => c.close);
    const ema12 = calcEMA(closes, 12), ema26 = calcEMA(closes, 26), ema200 = calcEMA(closes, 200);
    const lastClose = closes.at(-1), lastEma12 = ema12.at(-1), lastEma26 = ema26.at(-1), lastEma200 = ema200.at(-1);
    const prevEma12 = ema12.at(-2), prevEma26 = ema26.at(-2);
    const isLongSignal = prevEma12 <= prevEma26 && lastEma12 > lastEma26 && lastEma12 > lastEma200;
    const isShortSignal = prevEma12 >= prevEma26 && lastEma12 < lastEma26 && lastEma12 < lastEma200;
    if (isLongSignal || isShortSignal) {
        const atr = calcATR(candles, 14);
        if (!atr) return { direction: "NONE" };
        const direction = isLongSignal ? "LONG" : "SHORT";
        const sl = isLongSignal ? lastClose - 2 * atr : lastClose + 2 * atr;
        const tp = isLongSignal ? lastClose + 4 * atr : lastClose - 4 * atr;
        return { strategy: "EMA_CROSS", direction, price: lastClose, tp, sl };
    }
    return { direction: "NONE" };
}


/* ============== [ĐÃ NÂNG CẤP] Quét, Quản lý & Cảnh báo đảo chiều ============== */
export async function scanSymbol(symbol, bot, chatId) {
  try {
    const m5_candles = await getCandles(symbol, '5m', 2);
    if (!m5_candles.length) return false;
    const currentPrice = m5_candles.at(-1).close;
    const openTrade = getOpenTrades().find(t => t.symbol === symbol);

    // Bước 1: Luôn kiểm tra TP/SL cho lệnh đang mở
    if (openTrade) {
      if ((openTrade.direction === "LONG" && currentPrice <= openTrade.sl) ||
          (openTrade.direction === "SHORT" && currentPrice >= openTrade.sl)) {
        bot.sendMessage(chatId, `❌ [STOP LOSS] ${symbol}: Giá chạm SL (${openTrade.sl}). Đóng lệnh ${openTrade.direction}.`);
        closeTrade(symbol, bot, chatId, "Hit SL");
        return true; // Có sự kiện, trả về true
      }
      if ((openTrade.direction === "LONG" && currentPrice >= openTrade.tp) ||
          (openTrade.direction === "SHORT" && currentPrice <= openTrade.tp)) {
        bot.sendMessage(chatId, `✅ [TAKE PROFIT] ${symbol}: Giá chạm TP (${openTrade.tp}). Đóng lệnh ${openTrade.direction}.`);
        closeTrade(symbol, bot, chatId, "Hit TP");
        return true; // Có sự kiện, trả về true
      }
    }

    // Bước 2: Luôn tìm kiếm tín hiệu mới, bất kể có lệnh đang mở hay không
    let signal = await getSignalsSMC(symbol);
    if (signal.direction === "NONE") {
        signal = await getSignalsEMACross(symbol);
    }

    // Nếu không có tín hiệu mới, kết thúc
    if (signal.direction === "NONE") {
        // console.log(`📊 ${symbol} | Không có tín hiệu mới.`);
        return false;
    }
    
    // Bước 3: Xử lý tín hiệu mới tìm được
    // Trường hợp 1: Có lệnh đang mở
    if (openTrade) {
        // Nếu tín hiệu mới ngược hướng với lệnh đang mở -> CẢNH BÁO ĐẢO CHIỀU
        if (signal.direction !== openTrade.direction) {
            const message = `
🚨 *[CẢNH BÁO ĐẢO CHIỀU] - ${symbol}*
Lệnh đang mở: *${openTrade.direction}*
Tín hiệu mới: *${signal.direction}* (chiến lược ${signal.strategy})
Giá hiện tại: ${signal.price.toFixed(5)}

👉 Bạn nên cân nhắc đóng lệnh *${openTrade.direction}* hiện tại để tránh rủi ro.
Để đóng lệnh, dùng lệnh: \`/close ${symbol}\`
`;
            bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
            return true; // Có sự kiện cảnh báo
        }
    } 
    // Trường hợp 2: Không có lệnh đang mở -> Gửi tín hiệu mới
    else {
        const commandDirection = signal.direction.toLowerCase();
        const entryCommand = `\`/${commandDirection} ${symbol} ${signal.price} ${signal.sl}\``;
        const message = `
🔔 *[TÍN HIỆU MỚI - ${signal.strategy}]*
*Symbol:* \`${symbol}\` | *${signal.direction}*
*Giá hiện tại:* ${signal.price.toFixed(5)}
🎯 *Take Profit:* ${signal.tp.toFixed(5)}
🛑 *Stop Loss:* ${signal.sl.toFixed(5)}

Để vào lệnh, hãy dùng lệnh:
${entryCommand}
`;
        bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
        return true; // Có tín hiệu mới
    }
    
    // Nếu có tín hiệu mới nhưng cùng chiều với lệnh cũ, không làm gì cả
    return false;

  } catch (err) {
    console.error(`❌ Lỗi khi quét ${symbol}:`, err.message);
    return false;
  }
}
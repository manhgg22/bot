// indicators.js
import { getCandles, getCurrentPrice } from "./okx.js"; // Thêm getCurrentPrice
import { findOrderBlock, detectBOS } from "./smc.js";
import { getOpenTrades, closeTrade } from "./tradeManager.js";

/* ============== CÁC HÀM TÍNH TOÁN VÀ PHÂN TÍCH (GIỮ NGUYÊN) ============== */
// ... (Toàn bộ các hàm calcEMA, calcRSI, calcATR, findFVG, getDailyBias, getSignalsSMC, getSignalsEMACross... giữ nguyên như cũ)
export function calcEMA(values, period) { const k = 2 / (period + 1); return values.reduce((acc, price, i) => { if (i === 0) return [price]; const ema = price * k + acc[i - 1] * (1 - k); acc.push(ema); return acc; }, []); }
export function calcRSI(candles, period = 14) { if (candles.length < period + 1) return 50; let gains = 0, losses = 0; for (let i = 1; i <= period; i++) { const diff = candles[i].close - candles[i - 1].close; if (diff >= 0) gains += diff; else losses -= diff; } let avgGain = gains / period; let avgLoss = losses / period; const rsiArr = []; for (let i = period; i < candles.length; i++) { const rs = avgLoss === 0 ? 100 : avgGain / avgLoss; rsiArr.push(100 - 100 / (1 + rs)); const diff = candles[i].close - candles[i - 1].close; if (diff >= 0) { avgGain = (avgGain * (period - 1) + diff) / period; avgLoss = (avgLoss * (period - 1)) / period; } else { avgGain = (avgGain * (period - 1)) / period; avgLoss = (avgLoss * (period - 1) - diff) / period; } } return rsiArr.at(-1); }
export function calcATR(candles, period = 14) { if (candles.length < period + 2) return 0; const trs = []; for (let i = 1; i < candles.length; i++) { const h = candles[i].high; const l = candles[i].low; const pc = candles[i - 1].close; const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)); trs.push(tr); } const atr = trs.slice(-period).reduce((a, b) => a + b, 0) / period; return atr; }
export function findFVG(candles, direction = "BULLISH") { for (let i = candles.length - 3; i >= 2; i--) { const c1 = candles[i - 2]; const c3 = candles[i]; if (direction === "BULLISH" && c1.high < c3.low) return { low: c1.high, high: c3.low }; if (direction === "BEARISH" && c1.low > c3.high) return { low: c3.high, high: c1.low }; } return null; }
export async function getDailyBias(symbol) { const daily = await getCandles(symbol, "1D", 150); if (!daily.length) return "NEUTRAL"; const closes = daily.map(c => c.close); const ema50 = calcEMA(closes, 50).at(-1); const lastClose = closes.at(-1); return lastClose > ema50 ? "BULLISH" : "BEARISH"; }
async function getHTFBOS(symbol, bias) { const [h1, h4] = await Promise.all([ getCandles(symbol, "1H", 200), getCandles(symbol, "4H", 200) ]); const want = bias; const bosH1 = detectBOS(h1, want); const bosH4 = detectBOS(h4, want); return { bosH1, bosH4 }; }
async function getLTFEntry(symbol, bias) { const m15 = await getCandles(symbol, "15m", 220); if (m15.length < 50) return null; const price = m15.at(-1).close; const rsi = calcRSI(m15, 14); const ob = findOrderBlock(m15, bias); const fvg = findFVG(m15, bias); const retestOb = ob ? (price >= ob.low && price <= ob.high) : false; const retestFvg = fvg ? (price >= fvg.low && price <= fvg.high) : false; const rsiOk = (bias === "BULLISH") ? rsi >= 45 : rsi <= 55; const atr = calcATR(m15, 14); if (!atr) return null; let sl, tp; const ATR_SL = 1.5, ATR_TP = 3.0; if (bias === "BULLISH") { sl = ob ? Math.min(ob.low, price - ATR_SL * atr) : price - ATR_SL * atr; tp = price + ATR_TP * atr; } else { sl = ob ? Math.max(ob.high, price + ATR_SL * atr) : price + ATR_SL * atr; tp = price - ATR_TP * atr; } return { price, rsi, ob, fvg, retestOb, retestFvg, rsiOk, atr, tp, sl }; }
export async function getSignalsSMC(symbol) { const dailyBias = await getDailyBias(symbol); if (dailyBias === "NEUTRAL") return { direction: "NONE" }; const { bosH1 } = await getHTFBOS(symbol, dailyBias); if (!bosH1) return { direction: "NONE" }; const ltf = await getLTFEntry(symbol, dailyBias); if (!ltf) return { direction: "NONE" }; const entryOk = (ltf.retestOb || ltf.retestFvg) && ltf.rsiOk; if (!entryOk) return { direction: "NONE" }; const direction = (dailyBias === "BULLISH") ? "LONG" : "SHORT"; return { strategy: "SMC", direction, price: ltf.price, tp: ltf.tp, sl: ltf.sl }; }
export async function getSignalsEMACross(symbol) { const candles = await getCandles(symbol, "1H", 250); if (candles.length < 201) return { direction: "NONE" }; const closes = candles.map(c => c.close); const ema12 = calcEMA(closes, 12), ema26 = calcEMA(closes, 26), ema200 = calcEMA(closes, 200); const lastClose = closes.at(-1), lastEma12 = ema12.at(-1), lastEma26 = ema26.at(-1), lastEma200 = ema200.at(-1); const prevEma12 = ema12.at(-2), prevEma26 = ema26.at(-2); const isLongSignal = prevEma12 <= prevEma26 && lastEma12 > lastEma26 && lastEma12 > lastEma200; const isShortSignal = prevEma12 >= prevEma26 && lastEma12 < lastEma26 && lastEma12 < lastEma200; if (isLongSignal || isShortSignal) { const atr = calcATR(candles, 14); if (!atr) return { direction: "NONE" }; const direction = isLongSignal ? "LONG" : "SHORT"; const sl = isLongSignal ? lastClose - 2 * atr : lastClose + 2 * atr; const tp = isLongSignal ? lastClose + 4 * atr : lastClose - 4 * atr; return { strategy: "EMA_CROSS", direction, price: lastClose, tp, sl }; } return { direction: "NONE" }; }
/* ============================================================================ */

// [MỚI] Chức năng giám sát Real-time cho các lệnh đang mở
export async function monitorOpenTrades(bot, chatId) {
  const openTrades = getOpenTrades();
  if (openTrades.length === 0) {
    return; // Không có lệnh nào để giám sát
  }

  console.log(`[REAL-TIME MONITOR] Đang kiểm tra ${openTrades.length} lệnh đang mở...`);

  for (const trade of openTrades) {
    // Lấy giá hiện tại
    const currentPrice = await getCurrentPrice(trade.symbol);
    if (currentPrice === null) {
      console.log(`[REAL-TIME MONITOR] Bỏ qua ${trade.symbol} vì không lấy được giá.`);
      continue; // Bỏ qua nếu không lấy được giá
    }

    // 1. Kiểm tra TP/SL
    if ((trade.direction === "LONG" && currentPrice >= trade.tp) || (trade.direction === "SHORT" && currentPrice <= trade.tp)) {
      bot.sendMessage(chatId, `✅ [TAKE PROFIT] ${trade.symbol}: Giá chạm TP (${trade.tp}). Đóng lệnh ${trade.direction}.`);
      closeTrade(trade.symbol, bot, chatId, "Hit TP");
      continue; // Đã đóng lệnh, chuyển sang lệnh tiếp theo
    }
    if ((trade.direction === "LONG" && currentPrice <= trade.sl) || (trade.direction === "SHORT" && currentPrice >= trade.sl)) {
      bot.sendMessage(chatId, `❌ [STOP LOSS] ${trade.symbol}: Giá chạm SL (${trade.sl}). Đóng lệnh ${trade.direction}.`);
      closeTrade(trade.symbol, bot, chatId, "Hit SL");
      continue; // Đã đóng lệnh, chuyển sang lệnh tiếp theo
    }

    // 2. Kiểm tra tín hiệu đảo chiều
    let reversalSignal = await getSignalsSMC(trade.symbol);
    if (reversalSignal.direction === "NONE") {
        reversalSignal = await getSignalsEMACross(trade.symbol);
    }
    
    // Nếu có tín hiệu mới và ngược hướng -> Cảnh báo
    if (reversalSignal.direction !== "NONE" && reversalSignal.direction !== trade.direction) {
        const message = `
🚨 *[CẢNH BÁO ĐẢO CHIỀU] - ${trade.symbol}*
Lệnh đang mở: *${trade.direction}*
Tín hiệu mới: *${reversalSignal.direction}* (chiến lược ${reversalSignal.strategy})
Giá hiện tại: ${currentPrice.toFixed(5)}

👉 Bạn nên cân nhắc đóng lệnh *${trade.direction}* hiện tại để tránh rủi ro.
Để đóng lệnh, dùng lệnh: \`/close ${trade.symbol}\`
`;
        bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
        // Để tránh spam, chúng ta có thể thêm logic chỉ gửi cảnh báo 1 lần ở đây, nhưng hiện tại cứ để bot nhắc lại
    }
  }
}


// [NÂNG CẤP] Chức năng này giờ chỉ tìm tín hiệu MỚI
export async function scanForNewSignal(symbol, bot, chatId) {
  try {
    // Nếu đã có lệnh mở cho symbol này, bỏ qua không tìm tín hiệu mới
    const openTrade = getOpenTrades().find(t => t.symbol === symbol);
    if (openTrade) {
      return false;
    }

    // Tìm tín hiệu mới
    let signal = await getSignalsSMC(symbol);
    if (signal.direction === "NONE") {
        signal = await getSignalsEMACross(symbol);
    }

    // Nếu tìm thấy tín hiệu mới -> Gửi thông báo
    if (signal.direction !== "NONE") {
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
        return true; // Báo hiệu đã tìm thấy tín hiệu
    }
    
    return false; // Không có tín hiệu mới

  } catch (err) {
    console.error(`❌ Lỗi khi quét tín hiệu mới cho ${symbol}:`, err.message);
    return false;
  }
}
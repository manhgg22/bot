// indicators.js
import { getCandles, getCurrentPrice } from "./okx.js";
import { findOrderBlock, detectBOS } from "./smc.js";
import { getOpenTrades, closeTrade } from "./tradeManager.js";

/* ============== CÁC HÀM TÍNH TOÁN CHỈ BÁO (GIỮ NGUYÊN) ============== */
export function calcEMA(values, period) { const k = 2 / (period + 1); return values.reduce((acc, price, i) => { if (i === 0) return [price]; const ema = price * k + acc[i - 1] * (1 - k); acc.push(ema); return acc; }, []); }
export function calcRSI(candles, period = 14) { if (candles.length < period + 1) return 50; let gains = 0, losses = 0; for (let i = 1; i <= period; i++) { const diff = candles[i].close - candles[i - 1].close; if (diff >= 0) gains += diff; else losses -= diff; } let avgGain = gains / period; let avgLoss = losses / period; const rsiArr = []; for (let i = period; i < candles.length; i++) { const rs = avgLoss === 0 ? 100 : avgGain / avgLoss; rsiArr.push(100 - 100 / (1 + rs)); const diff = candles[i].close - candles[i - 1].close; if (diff >= 0) { avgGain = (avgGain * (period - 1) + diff) / period; avgLoss = (avgLoss * (period - 1)) / period; } else { avgGain = (avgGain * (period - 1)) / period; avgLoss = (avgLoss * (period - 1) - diff) / period; } } return rsiArr.at(-1); }
export function calcATR(candles, period = 14) { if (candles.length < period + 2) return 0; const trs = []; for (let i = 1; i < candles.length; i++) { const h = candles[i].high; const l = candles[i].low; const pc = candles[i - 1].close; const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)); trs.push(tr); } const atr = trs.slice(-period).reduce((a, b) => a + b, 0) / period; return atr; }
export function calcBollingerBands(candles, period = 20, stdDev = 2) { if (candles.length < period) return null; const closes = candles.map(c => c.close); const sma = closes.slice(-period).reduce((sum, val) => sum + val, 0) / period; const standardDeviation = Math.sqrt( closes.slice(-period).map(val => (val - sma) ** 2).reduce((sum, val) => sum + val, 0) / period ); return { upper: sma + stdDev * standardDeviation, middle: sma, lower: sma - stdDev * standardDeviation }; }
export function calcAvgVolume(candles, period = 20) { if (candles.length < period) return 0; const volumes = candles.map(c => c.volume || 0); return volumes.slice(-period).reduce((sum, val) => sum + val, 0) / period; }
function calcADX(candles, period = 14) { if (candles.length < period * 2) return { adx: 0 }; let trs = [], pdms = [], mdms = []; for (let i = 1; i < candles.length; i++) { const C = candles[i], P = candles[i - 1]; trs.push(Math.max(C.high - C.low, Math.abs(C.high - P.close), Math.abs(C.low - P.close))); const upMove = C.high - P.high; const downMove = P.low - C.low; pdms.push((upMove > downMove && upMove > 0) ? upMove : 0); mdms.push((downMove > upMove && downMove > 0) ? downMove : 0); } const ema = (data, p) => { let results = [data.slice(0, p).reduce((a, b) => a + b, 0) / p]; for (let i = p; i < data.length; i++) { results.push((results[results.length - 1] * (p - 1) + data[i]) / p); } return results; }; const smoothedTR = ema(trs, period); const smoothedPDM = ema(pdms, period); const smoothedMDM = ema(mdms, period); let dx = []; for (let i = 0; i < smoothedTR.length; i++) { const pdi_val = smoothedTR[i] === 0 ? 0 : (smoothedPDM[i] / smoothedTR[i]) * 100; const mdi_val = smoothedTR[i] === 0 ? 0 : (smoothedMDM[i] / smoothedTR[i]) * 100; const di_sum = pdi_val + mdi_val; dx.push(di_sum === 0 ? 0 : (Math.abs(pdi_val - mdi_val) / di_sum) * 100); } const adx = ema(dx.slice(period - 1), period); return { adx: adx.at(-1) || 0 }; }

/* ============== CÁC CHIẾN LƯỢC TÌM TÍN HIỆU ============== */

// [SỬA LỖI] Bổ sung kiểm tra null/undefined để đảm bảo hàm luôn ổn định
async function findSignalWithADX(symbol, strategyFn) {
    const signal = await strategyFn(symbol);
    // Nếu signal không hợp lệ (null/undefined), trả về đối tượng mặc định
    if (!signal) {
        return { direction: "NONE" };
    }
    
    if (signal.direction !== "NONE") {
        const adxCandles = await getCandles(symbol, '1H', 50);
        if (adxCandles && adxCandles.length > 0) {
            const { adx } = calcADX(adxCandles, 14);
            signal.adx = adx;
        } else {
            signal.adx = 0;
        }
    }
    return signal;
}

// Các hàm chiến lược (giữ nguyên logic, nhưng đảm bảo luôn return object)
async function getSignalsSMC(symbol) { 
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
async function getSignalsEMACross(symbol) { 
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
async function getSignalsBollingerBreakout(symbol) {
    const candles = await getCandles(symbol, "1H", 50);
    if (candles.length < 21) return { direction: "NONE" };
    const lastCandle = candles.at(-1);
    const bands = calcBollingerBands(candles, 20, 2);
    if (!bands) return { direction: "NONE" }; // Thêm kiểm tra
    const avgVolume = calcAvgVolume(candles, 20);
    if (avgVolume === 0) return { direction: "NONE" };
    const isHighVolume = lastCandle.volume > avgVolume * 1.8;
    const isLongSignal = lastCandle.close > bands.upper && isHighVolume;
    const isShortSignal = lastCandle.close < bands.lower && isHighVolume;
    if (isLongSignal || isShortSignal) {
        const atr = calcATR(candles, 14);
        if (!atr) return { direction: "NONE" };
        const direction = isLongSignal ? "LONG" : "SHORT";
        const sl = isLongSignal ? lastCandle.close - 2.5 * atr : lastCandle.close + 2.5 * atr;
        const tp = isLongSignal ? lastCandle.close + 5.0 * atr : lastCandle.close - 5.0 * atr;
        return { strategy: "BB_BREAKOUT", direction, price: lastCandle.close, tp, sl };
    }
    return { direction: "NONE" };
}

// ... (Các hàm con như getDailyBias, getHTFBOS, getLTFEntry giữ nguyên)

export async function getAllSignalsForSymbol(symbol) {
    const strategies = [getSignalsSMC, getSignalsEMACross, getSignalsBollingerBreakout];
    for (const strategyFn of strategies) {
        const signal = await findSignalWithADX(symbol, strategyFn);
        if (signal && signal.direction !== "NONE") { // Thêm kiểm tra signal tồn tại
            return signal;
        }
    }
    return { direction: "NONE" };
}

/* ============== CÁC HÀM QUẢN LÝ VÀ QUÉT CHÍNH (GIỮ NGUYÊN) ============== */
export async function monitorOpenTrades(bot, chatId) { /* ... giữ nguyên code cũ ... */ }
export async function scanForNewSignal(symbol, bot, chatId) {
  try {
    const openTrade = getOpenTrades().find(t => t.symbol === symbol);
    if (openTrade) return false;
    const signal = await getAllSignalsForSymbol(symbol);
    if (signal.direction !== "NONE") {
        const safetyLevel = signal.adx > 25 ? 'CAO' : (signal.adx >= 20 ? 'TRUNG BÌNH' : 'THẤP');
        const safetyIcon = signal.adx > 25 ? '✅' : (signal.adx >= 20 ? '⚠️' : '❌');
        const commandDirection = signal.direction.toLowerCase();
        const entryCommand = `\`/${commandDirection} ${symbol} ${signal.price} ${signal.sl}\``;
        const message = `
🔔 *[TÍN HIỆU MỚI - ${signal.strategy}]*
*Symbol:* \`${symbol}\` | *${signal.direction}*
*Giá hiện tại:* ${signal.price.toFixed(5)}
🎯 *Take Profit:* ${signal.tp.toFixed(5)}
🛑 *Stop Loss:* ${signal.sl.toFixed(5)}
${safetyIcon} *Độ an toàn (ADX):* ${signal.adx.toFixed(1)} (${safetyLevel})
Để vào lệnh, hãy dùng lệnh:
${entryCommand}
`;
        bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
        return true;
    }
    return false;
  } catch (err) {
    console.error(`❌ Lỗi khi quét tín hiệu mới cho ${symbol}:`, err.message);
    return false;
  }
}
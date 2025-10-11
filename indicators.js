// indicators.js
import { getCandles, getCurrentPrice } from "./okx.js";
import { findOrderBlock, detectBOS, findSwingPoints } from "./smc.js";
import { getOpenTrades, closeTrade } from "./tradeManager.js";
import { filterHighQualitySignals, generateSignalReport } from "./signalFilter.js";
import { analyzeRiskAndExitPoints, generateRiskReport } from "./advancedIndicators.js";

/* ============== CÁC HÀM TÍNH TOÁN CHỈ BÁO ============== */

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

export function calcBollingerBands(candles, period = 20, stdDev = 2) {
    if (candles.length < period) return null;
    const closes = candles.map(c => c.close);
    const sma = closes.slice(-period).reduce((sum, val) => sum + val, 0) / period;
    const standardDeviation = Math.sqrt(
        closes.slice(-period).map(val => (val - sma) ** 2).reduce((sum, val) => sum + val, 0) / period
    );
    return {
        upper: sma + stdDev * standardDeviation,
        middle: sma,
        lower: sma - stdDev * standardDeviation,
    };
}

export function calcAvgVolume(candles, period = 20) {
    if (candles.length < period) return 0;
    const volumes = candles.map(c => c.volume || 0);
    return volumes.slice(-period).reduce((sum, val) => sum + val, 0) / period;
}

export function calcADX(candles, period = 14) {
    if (candles.length < period * 2) return { adx: 0 };
    let trs = [], pdms = [], mdms = [];
    for (let i = 1; i < candles.length; i++) {
        const C = candles[i], P = candles[i - 1];
        trs.push(Math.max(C.high - C.low, Math.abs(C.high - P.close), Math.abs(C.low - P.close)));
        const upMove = C.high - P.high;
        const downMove = P.low - C.low;
        pdms.push((upMove > downMove && upMove > 0) ? upMove : 0);
        mdms.push((downMove > upMove && downMove > 0) ? downMove : 0);
    }
    const ema = (data, p) => {
        let results = [data.slice(0, p).reduce((a, b) => a + b, 0) / p];
        for (let i = p; i < data.length; i++) {
            results.push((results[results.length - 1] * (p - 1) + data[i]) / p);
        }
        return results;
    };
    const smoothedTR = ema(trs, period);
    const smoothedPDM = ema(pdms, period);
    const smoothedMDM = ema(mdms, period);
    let dx = [];
    for (let i = 0; i < smoothedTR.length; i++) {
        const pdi_val = smoothedTR[i] === 0 ? 0 : (smoothedPDM[i] / smoothedTR[i]) * 100;
        const mdi_val = smoothedTR[i] === 0 ? 0 : (smoothedMDM[i] / smoothedTR[i]) * 100;
        const di_sum = pdi_val + mdi_val;
        dx.push(di_sum === 0 ? 0 : (Math.abs(pdi_val - mdi_val) / di_sum) * 100);
    }
    const adx = ema(dx.slice(period - 1), period);
    return { adx: adx.at(-1) || 0 };
}

/**
 * [MỚI] Hàm tính toán chỉ báo Stochastic RSI.
 */
function calcStochRSI(candles, rsiPeriod = 14, stochPeriod = 14, kPeriod = 3, dPeriod = 3) {
    if (candles.length < rsiPeriod + stochPeriod) {
        return null;
    }
    const rsiValues = [];
    let gains = 0, losses = 0;
    for (let i = 1; i <= rsiPeriod; i++) {
        const diff = candles[i].close - candles[i - 1].close;
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / rsiPeriod;
    let avgLoss = losses / rsiPeriod;
    for (let i = rsiPeriod; i < candles.length; i++) {
        const diff = candles[i].close - candles[i - 1].close;
        if (diff >= 0) {
            avgGain = (avgGain * (rsiPeriod - 1) + diff) / rsiPeriod;
            avgLoss = (avgLoss * (rsiPeriod - 1)) / rsiPeriod;
        } else {
            avgGain = (avgGain * (rsiPeriod - 1)) / rsiPeriod;
            avgLoss = (avgLoss * (rsiPeriod - 1) - diff) / rsiPeriod;
        }
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        rsiValues.push(100 - 100 / (1 + rs));
    }
    
    if (rsiValues.length < stochPeriod) return null;

    const stochRSI_K = [];
    for (let i = stochPeriod - 1; i < rsiValues.length; i++) {
        const rsiSlice = rsiValues.slice(i - stochPeriod + 1, i + 1);
        const lowestRSI = Math.min(...rsiSlice);
        const highestRSI = Math.max(...rsiSlice);
        const currentRSI = rsiValues[i];
        const k = (highestRSI === lowestRSI) ? 100 : ((currentRSI - lowestRSI) / (highestRSI - lowestRSI)) * 100;
        stochRSI_K.push(k);
    }
    
    if (stochRSI_K.length < dPeriod) return null;
    
    const smoothK = [];
    for(let i = kPeriod - 1; i < stochRSI_K.length; i++) {
        const kSlice = stochRSI_K.slice(i - kPeriod + 1, i + 1);
        smoothK.push(kSlice.reduce((a,b) => a+b, 0) / kPeriod);
    }

    const smoothD = [];
    for(let i = dPeriod - 1; i < smoothK.length; i++) {
        const dSlice = smoothK.slice(i - dPeriod + 1, i + 1);
        smoothD.push(dSlice.reduce((a,b) => a+b, 0) / dPeriod);
    }

    return {
        k: smoothK.at(-1),
        d: smoothD.at(-1),
        prev_k: smoothK.at(-2),
        prev_d: smoothD.at(-2)
    };
}

/* ============== CÁC HÀM PHÂN TÍCH PHỤ ============== */

export async function getDailyBias(symbol) {
    const daily = await getCandles(symbol, "1D", 150);
    if (!daily || daily.length < 51) return "NEUTRAL";
    const closes = daily.map(c => c.close);
    const ema50 = calcEMA(closes, 50).at(-1);
    const lastClose = closes.at(-1);
    return lastClose > ema50 ? "BULLISH" : "BEARISH";
}

async function getHTFBOS(symbol, bias) {
    const h1_candles = await getCandles(symbol, "1H", 200);
    if (!h1_candles || h1_candles.length < 50) return { bosH1: false };
    const bosH1 = detectBOS(h1_candles, bias);
    return { bosH1 };
}

async function getLTFEntry(symbol, bias) {
    const m15_candles = await getCandles(symbol, "15m", 220);
    if (!m15_candles || m15_candles.length < 50) return null;
    const price = m15_candles.at(-1).close;
    const rsi = calcRSI(m15_candles, 14);
    const ob = findOrderBlock(m15_candles, bias);
    const fvg = findFVG(m15_candles, bias);
    const retestOb = ob ? (price >= ob.low && price <= ob.high) : false;
    const retestFvg = fvg ? (price >= fvg.low && price <= fvg.high) : false;
    const rsiOk = (bias === "BULLISH") ? rsi >= 45 : rsi <= 55;
    const atr = calcATR(m15_candles, 14);
    if (!atr) return null;
    let sl, tp;
    const ATR_SL = 1.5, ATR_TP = 3.0;
    if (bias === "BULLISH") {
        sl = ob ? Math.min(ob.low, price - ATR_SL * atr) : price - ATR_SL * atr;
        tp = price + ATR_TP * atr;
    } else {
        sl = ob ? Math.max(ob.high, price + ATR_SL * atr) : price + ATR_SL * atr;
        tp = price - ATR_TP * atr;
    }
    return { price, retestOb, retestFvg, rsiOk, tp, sl };
}

/* ============== CÁC CHIẾN LƯỢC TÌM TÍN HIỆU ============== */

async function findSignalWithADX(symbol, strategyFn) {
    const signal = await strategyFn(symbol);
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

async function getSignalsSMC(symbol) { 
    try {
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
    } catch (error) {
        return { direction: "NONE" };
    }
}

async function getSignalsEMACross(symbol) { 
    try {
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
    } catch (error) {
        return { direction: "NONE" };
    }
}

async function getSignalsBollingerBreakout(symbol) {
    try {
        const candles = await getCandles(symbol, "1H", 50);
        if (candles.length < 21) return { direction: "NONE" };
        const lastCandle = candles.at(-1);
        const bands = calcBollingerBands(candles, 20, 2);
        if (!bands) return { direction: "NONE" };
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
    } catch (error) {
        return { direction: "NONE" };
    }
}

async function getSignalsStochRSIReversal(symbol) {
    try {
        const candles = await getCandles(symbol, "4H", 100);
        if (!candles || candles.length < 50) return { direction: "NONE" };
        
        const stochRSI = calcStochRSI(candles);
        if (!stochRSI) return { direction: "NONE" };

        const { k, d, prev_k, prev_d } = stochRSI;
        const oversoldLevel = 20;
        const overboughtLevel = 80;

        const isLongSignal = prev_k < oversoldLevel && k > oversoldLevel && k > d;
        const isShortSignal = prev_k > overboughtLevel && k < overboughtLevel && k < d;

        if (isLongSignal || isShortSignal) {
            const lastCandle = candles.at(-1);
            const atr = calcATR(candles, 14);
            if (!atr) return { direction: "NONE" };
            const direction = isLongSignal ? "LONG" : "SHORT";
            const sl = isLongSignal ? lastCandle.close - 1.5 * atr : lastCandle.close + 1.5 * atr;
            const tp = isLongSignal ? lastCandle.close + 3.0 * atr : lastCandle.close - 3.0 * atr;
            return { strategy: "STOCH_RSI_REVERSAL", direction, price: lastCandle.close, tp, sl };
        }
        return { direction: "NONE" };
    } catch (error) {
        return { direction: "NONE" };
    }
}

// [NÂNG CẤP] Sử dụng hệ thống lọc tín hiệu chất lượng cao với StochRSI
export async function getAllSignalsForSymbol(symbol) {
    const strategies = [
        getSignalsStochRSIReversal, 
        getSignalsSMC, 
        getSignalsEMACross, 
        getSignalsBollingerBreakout
    ];
    const allSignals = [];
    
    // Thu thập tất cả tín hiệu từ các chiến lược
    for (const strategyFn of strategies) {
        const signal = await findSignalWithADX(symbol, strategyFn);
        if (signal && signal.direction !== "NONE") {
            signal.symbol = symbol; // Thêm symbol vào signal
            allSignals.push(signal);
        }
    }
    
    // Nếu không có tín hiệu nào, trả về NONE
    if (allSignals.length === 0) {
        return { direction: "NONE" };
    }
    
    // Lọc và chấm điểm tín hiệu chất lượng cao
    const autoThreshold = parseInt(process.env.QUALITY_THRESHOLD_AUTO) || 70;
    const filteredSignals = await filterHighQualitySignals(allSignals, autoThreshold);
    
    // Trả về tín hiệu tốt nhất (điểm cao nhất)
    if (filteredSignals.length > 0) {
        return filteredSignals[0];
    }
    
    return { direction: "NONE" };
}

/* ============== CÁC HÀM QUẢN LÝ VÀ QUÉT CHÍNH ============== */

export async function monitorOpenTrades(bot, chatId) {
    const openTrades = getOpenTrades();
    if (openTrades.length === 0) return;
    console.log(`[REAL-TIME MONITOR] Đang kiểm tra ${openTrades.length} lệnh đang mở...`);
    for (const trade of openTrades) {
        const currentPrice = await getCurrentPrice(trade.symbol);
        if (currentPrice === null) continue;
        if ((trade.direction === "LONG" && currentPrice >= trade.tp) || (trade.direction === "SHORT" && currentPrice <= trade.tp)) { bot.sendMessage(chatId, `✅ [TAKE PROFIT] ${trade.symbol}: Giá chạm TP (${trade.tp}). Đóng lệnh ${trade.direction}.`); closeTrade(trade.symbol, bot, chatId, "Hit TP"); continue; }
        if ((trade.direction === "LONG" && currentPrice <= trade.sl) || (trade.direction === "SHORT" && currentPrice >= trade.sl)) { bot.sendMessage(chatId, `❌ [STOP LOSS] ${trade.symbol}: Giá chạm SL (${trade.sl}). Đóng lệnh ${trade.direction}.`); closeTrade(trade.symbol, bot, chatId, "Hit SL"); continue; }
        let reversalSignal = await getAllSignalsForSymbol(trade.symbol);
        if (reversalSignal.direction !== "NONE" && reversalSignal.direction !== trade.direction) { const message = `🚨 *[CẢNH BÁO ĐẢO CHIỀU] - ${trade.symbol}*\nLệnh đang mở: *${trade.direction}*\nTín hiệu mới: *${reversalSignal.direction}* (chiến lược ${reversalSignal.strategy})\nGiá hiện tại: ${currentPrice.toFixed(5)}\n\n👉 Bạn nên cân nhắc đóng lệnh *${trade.direction}* hiện tại để tránh rủi ro.\nĐể đóng lệnh, dùng lệnh: \`/close ${trade.symbol}\``; bot.sendMessage(chatId, message, { parse_mode: "Markdown" }); }
    }
}

export async function scanForNewSignal(symbol, bot, chatId) {
  try {
    const openTrade = getOpenTrades().find(t => t.symbol === symbol);
    if (openTrade) return false;
    
    const signal = await getAllSignalsForSymbol(symbol);
    if (signal.direction !== "NONE") {
        // Xác định mức độ an toàn dựa trên điểm số
        let safetyLevel, safetyIcon;
        if (signal.score >= 85) {
            safetyLevel = 'RẤT CAO';
            safetyIcon = '🔥';
        } else if (signal.score >= 75) {
            safetyLevel = 'CAO';
            safetyIcon = '✅';
        } else if (signal.score >= 70) {
            safetyLevel = 'TRUNG BÌNH';
            safetyIcon = '⚠️';
        } else {
            safetyLevel = 'THẤP';
            safetyIcon = '❌';
        }

        const commandDirection = signal.direction.toLowerCase();
        const entryCommand = `\`/${commandDirection} ${symbol} ${signal.price} ${signal.sl}\``;
        
        // Tạo báo cáo chi tiết nếu có điểm số
        const detailedReport = signal.score ? await generateSignalReport(signal) : '';
        
        const message = `
🔔 *[TÍN HIỆU CHẤT LƯỢNG CAO - ${signal.strategy}]*
*Symbol:* \`${symbol}\` | *${signal.direction}*
*Giá hiện tại:* ${signal.price.toFixed(5)}
🎯 *Take Profit:* ${signal.tp.toFixed(5)}
🛑 *Stop Loss:* ${signal.sl.toFixed(5)}
${safetyIcon} *Điểm chất lượng:* ${signal.score}/100 (${safetyLevel})
📊 *ADX:* ${signal.adx.toFixed(1)}

Để vào lệnh, hãy dùng lệnh:
${entryCommand}

${detailedReport ? detailedReport : ''}
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

/**
 * Hàm cảnh báo rủi ro cho các lệnh đang mở
 */
export async function checkRiskAndWarn(bot, chatId) {
  try {
    const openTrades = getOpenTrades();
    if (openTrades.length === 0) return;

    for (const trade of openTrades) {
      const riskAnalysis = await analyzeRiskAndExitPoints(trade.symbol, trade.direction, trade.entry, trade.sl);
      
      if (riskAnalysis.riskLevel === "HIGH" || riskAnalysis.exitRecommendation === "EXIT_NOW") {
        const riskReport = generateRiskReport(riskAnalysis);
        const warningMessage = `
🚨 *CẢNH BÁO RỦI RO CAO - ${trade.symbol}*

${riskReport}

💡 *Khuyến nghị:* Thoát lệnh ngay để tránh SL
Để đóng lệnh: \`/close ${trade.symbol}\`
`;
        bot.sendMessage(chatId, warningMessage, { parse_mode: "Markdown" });
      } else if (riskAnalysis.riskLevel === "MEDIUM" || riskAnalysis.exitRecommendation === "CONSIDER_EXIT") {
        const riskReport = generateRiskReport(riskAnalysis);
        const warningMessage = `
⚠️ *CẢNH BÁO RỦI RO TRUNG BÌNH - ${trade.symbol}*

${riskReport}

💡 *Khuyến nghị:* Cân nhắc thoát lệnh hoặc theo dõi chặt chẽ
`;
        bot.sendMessage(chatId, warningMessage, { parse_mode: "Markdown" });
      }
    }
  } catch (error) {
    console.error("Lỗi khi kiểm tra rủi ro:", error);
  }
}

// premiumSignals.js - Hệ thống tín hiệu chất lượng cao với tỷ lệ thắng cao nhất
import axios from "axios";
import { getCandles, getCurrentPrice } from "./okx.js";
import { calcRSI, calcEMA, calcATR, calcBollingerBands, calcADX } from "./indicators.js";
import { findOrderBlock, detectBOS, findSwingPoints } from "./smc.js";
import { analyzeMarketSentiment, detectCrashRisk } from "./advancedIndicators.js";

/* ============== HỆ THỐNG TÍN HIỆU PREMIUM ============== */

/**
 * Tìm tín hiệu premium với tiêu chí nghiêm ngặt nhất
 */
export async function findPremiumSignals(symbol) {
    try {
        console.log(`[PREMIUM] Đang phân tích ${symbol}...`);
        
        // Lấy dữ liệu đa khung thời gian
        const [h1Candles, h4Candles, d1Candles, m15Candles] = await Promise.all([
            getCandles(symbol, "1H", 200),
            getCandles(symbol, "4H", 100),
            getCandles(symbol, "1D", 150),
            getCandles(symbol, "15m", 300)
        ]);
        
        if (!h1Candles || !h4Candles || !d1Candles || !m15Candles) {
            return { direction: "NONE", quality: 0 };
        }
        
        // Phân tích đa khung thời gian
        const analysis = {
            daily: analyzeDailyTrend(d1Candles),
            h4: analyzeH4Structure(h4Candles),
            h1: analyzeH1Momentum(h1Candles),
            m15: analyzeM15Entry(m15Candles),
            sentiment: await analyzeMarketSentiment(symbol),
            risk: detectCrashRisk(h1Candles)
        };
        
        // Tính điểm chất lượng tổng hợp
        const qualityScore = calculatePremiumQualityScore(analysis);
        
        // Chỉ trả về tín hiệu nếu đạt tiêu chuẩn premium
        if (qualityScore < 85) {
            return { direction: "NONE", quality: qualityScore };
        }
        
        // Xác định hướng và tính toán entry/sl/tp
        const signal = generatePremiumSignal(analysis, symbol);
        
        return {
            ...signal,
            quality: qualityScore,
            analysis: analysis
        };
        
    } catch (error) {
        console.error(`[PREMIUM] Lỗi phân tích ${symbol}:`, error);
        return { direction: "NONE", quality: 0 };
    }
}

/**
 * Phân tích xu hướng Daily
 */
function analyzeDailyTrend(candles) {
    if (candles.length < 50) return null;
    
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    
    // EMA 20, 50, 200
    const ema20 = calcEMA(closes, 20);
    const ema50 = calcEMA(closes, 50);
    const ema200 = calcEMA(closes, 200);
    
    const lastClose = closes.at(-1);
    const lastEma20 = ema20.at(-1);
    const lastEma50 = ema50.at(-1);
    const lastEma200 = ema200.at(-1);
    
    // ADX để đo độ mạnh xu hướng
    const adxData = calcADX(candles, 14);
    const adx = adxData.adx;
    
    // RSI để tránh overbought/oversold
    const rsi = calcRSI(candles, 14);
    
    // Phân tích cấu trúc giá
    const recentHighs = highs.slice(-20);
    const recentLows = lows.slice(-20);
    const maxHigh = Math.max(...recentHighs);
    const minLow = Math.min(...recentLows);
    
    // Xác định xu hướng
    let trend = "NEUTRAL";
    let strength = 0;
    
    if (lastClose > lastEma20 && lastEma20 > lastEma50 && lastEma50 > lastEma200) {
        trend = "STRONG_BULLISH";
        strength = 100;
    } else if (lastClose > lastEma20 && lastEma20 > lastEma50) {
        trend = "BULLISH";
        strength = 70;
    } else if (lastClose < lastEma20 && lastEma20 < lastEma50 && lastEma50 < lastEma200) {
        trend = "STRONG_BEARISH";
        strength = 100;
    } else if (lastClose < lastEma20 && lastEma20 < lastEma50) {
        trend = "BEARISH";
        strength = 70;
    }
    
    // Điều chỉnh theo ADX
    if (adx < 25) {
        strength *= 0.5; // Xu hướng yếu
    } else if (adx > 40) {
        strength *= 1.2; // Xu hướng mạnh
    }
    
    // Điều chỉnh theo RSI
    if (trend === "BULLISH" && rsi > 70) {
        strength *= 0.7; // Overbought
    } else if (trend === "BEARISH" && rsi < 30) {
        strength *= 0.7; // Oversold
    }
    
    return {
        trend,
        strength: Math.min(100, strength),
        adx,
        rsi,
        ema20: lastEma20,
        ema50: lastEma50,
        ema200: lastEma200,
        price: lastClose,
        maxHigh,
        minLow
    };
}

/**
 * Phân tích cấu trúc H4
 */
function analyzeH4Structure(candles) {
    if (candles.length < 50) return null;
    
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    
    // Tìm Higher Highs và Lower Lows
    let higherHighs = 0, lowerHighs = 0;
    let higherLows = 0, lowerLows = 0;
    
    for (let i = 2; i < candles.length - 2; i++) {
        const currentHigh = highs[i];
        const currentLow = lows[i];
        const prevHigh = highs[i-1];
        const prevLow = lows[i-1];
        
        if (currentHigh > prevHigh) higherHighs++;
        else if (currentHigh < prevHigh) lowerHighs++;
        
        if (currentLow > prevLow) higherLows++;
        else if (currentLow < prevLow) lowerLows++;
    }
    
    // Xác định cấu trúc
    let structure = "NEUTRAL";
    let structureStrength = 0;
    
    if (higherHighs > lowerHighs && higherLows > lowerLows) {
        structure = "BULLISH";
        structureStrength = ((higherHighs - lowerHighs) + (higherLows - lowerLows)) / (candles.length - 4) * 100;
    } else if (lowerHighs > higherHighs && lowerLows > higherLows) {
        structure = "BEARISH";
        structureStrength = ((lowerHighs - higherHighs) + (lowerLows - higherLows)) / (candles.length - 4) * 100;
    }
    
    // Bollinger Bands để xác định breakout
    const bb = calcBollingerBands(candles, 20, 2);
    const lastClose = closes.at(-1);
    
    let bbSignal = "NEUTRAL";
    if (bb && lastClose > bb.upper) {
        bbSignal = "BULLISH_BREAKOUT";
    } else if (bb && lastClose < bb.lower) {
        bbSignal = "BEARISH_BREAKOUT";
    }
    
    return {
        structure,
        structureStrength,
        higherHighs,
        lowerHighs,
        higherLows,
        lowerLows,
        bbSignal,
        bb: bb
    };
}

/**
 * Phân tích momentum H1
 */
function analyzeH1Momentum(candles) {
    if (candles.length < 50) return null;
    
    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume || 0);
    
    // MACD
    const macd = calcMACD(candles);
    
    // RSI
    const rsi = calcRSI(candles, 14);
    
    // Volume analysis
    const avgVolume = volumes.slice(-20).reduce((sum, vol) => sum + vol, 0) / 20;
    const lastVolume = volumes.at(-1);
    const volumeRatio = lastVolume / avgVolume;
    
    // Price momentum
    const priceChange5 = (closes.at(-1) - closes.at(-6)) / closes.at(-6) * 100;
    const priceChange10 = (closes.at(-1) - closes.at(-11)) / closes.at(-11) * 100;
    
    // Xác định momentum
    let momentum = "NEUTRAL";
    let momentumStrength = 0;
    
    if (macd && macd.macd > macd.signal && macd.histogram > 0 && rsi > 50 && rsi < 70) {
        momentum = "BULLISH";
        momentumStrength = 60;
    } else if (macd && macd.macd < macd.signal && macd.histogram < 0 && rsi < 50 && rsi > 30) {
        momentum = "BEARISH";
        momentumStrength = 60;
    }
    
    // Điều chỉnh theo volume
    if (volumeRatio > 1.5) {
        momentumStrength *= 1.3; // Volume cao
    } else if (volumeRatio < 0.7) {
        momentumStrength *= 0.7; // Volume thấp
    }
    
    // Điều chỉnh theo price momentum
    if (momentum === "BULLISH" && priceChange5 > 2) {
        momentumStrength *= 1.2;
    } else if (momentum === "BEARISH" && priceChange5 < -2) {
        momentumStrength *= 1.2;
    }
    
    return {
        momentum,
        momentumStrength: Math.min(100, momentumStrength),
        macd,
        rsi,
        volumeRatio,
        priceChange5,
        priceChange10
    };
}

/**
 * Phân tích entry M15
 */
function analyzeM15Entry(candles) {
    if (candles.length < 50) return null;
    
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    
    // Tìm Order Blocks
    const orderBlocks = findOrderBlocks(candles);
    
    // Tìm Swing Points
    const swingPoints = findSwingPoints(candles);
    
    // RSI cho entry timing
    const rsi = calcRSI(candles, 14);
    
    // ATR cho stop loss
    const atr = calcATR(candles, 14);
    
    // Bollinger Bands cho mean reversion
    const bb = calcBollingerBands(candles, 20, 2);
    
    const lastClose = closes.at(-1);
    
    // Xác định entry signal
    let entrySignal = "NONE";
    let entryStrength = 0;
    
    // Order Block retest
    if (orderBlocks && orderBlocks.length > 0) {
        const lastOB = orderBlocks[orderBlocks.length - 1];
        if (lastClose >= lastOB.low && lastClose <= lastOB.high) {
            entrySignal = lastOB.type === "bullish" ? "BULLISH_ENTRY" : "BEARISH_ENTRY";
            entryStrength = 40;
        }
    }
    
    // Bollinger Bands mean reversion
    if (bb && rsi < 30 && lastClose < bb.lower) {
        entrySignal = "BULLISH_ENTRY";
        entryStrength = Math.max(entryStrength, 30);
    } else if (bb && rsi > 70 && lastClose > bb.upper) {
        entrySignal = "BEARISH_ENTRY";
        entryStrength = Math.max(entryStrength, 30);
    }
    
    // RSI divergence
    if (rsi < 30 && closes.at(-1) > closes.at(-5)) {
        entrySignal = "BULLISH_ENTRY";
        entryStrength = Math.max(entryStrength, 35);
    } else if (rsi > 70 && closes.at(-1) < closes.at(-5)) {
        entrySignal = "BEARISH_ENTRY";
        entryStrength = Math.max(entryStrength, 35);
    }
    
    return {
        entrySignal,
        entryStrength,
        orderBlocks,
        swingPoints,
        rsi,
        atr,
        bb,
        price: lastClose
    };
}

/**
 * Tính điểm chất lượng premium
 */
function calculatePremiumQualityScore(analysis) {
    let score = 0;
    
    // Daily trend (40 điểm tối đa)
    if (analysis.daily) {
        if (analysis.daily.trend === "STRONG_BULLISH" || analysis.daily.trend === "STRONG_BEARISH") {
            score += 40;
        } else if (analysis.daily.trend === "BULLISH" || analysis.daily.trend === "BEARISH") {
            score += 25;
        }
        
        // ADX bonus
        if (analysis.daily.adx > 30) score += 10;
        if (analysis.daily.adx > 40) score += 5;
    }
    
    // H4 structure (25 điểm tối đa)
    if (analysis.h4) {
        if (analysis.h4.structure === "BULLISH" || analysis.h4.structure === "BEARISH") {
            score += 15;
            score += Math.min(10, analysis.h4.structureStrength / 10);
        }
        
        // BB breakout bonus
        if (analysis.h4.bbSignal.includes("BREAKOUT")) score += 5;
    }
    
    // H1 momentum (20 điểm tối đa)
    if (analysis.h1) {
        if (analysis.h1.momentum === "BULLISH" || analysis.h1.momentum === "BEARISH") {
            score += 10;
            score += Math.min(10, analysis.h1.momentumStrength / 10);
        }
        
        // Volume bonus
        if (analysis.h1.volumeRatio > 1.5) score += 5;
    }
    
    // M15 entry (15 điểm tối đa)
    if (analysis.m15) {
        if (analysis.m15.entrySignal.includes("ENTRY")) {
            score += 10;
            score += Math.min(5, analysis.m15.entryStrength / 10);
        }
    }
    
    // Risk adjustment
    if (analysis.risk && analysis.risk.riskLevel === "HIGH") {
        score -= 20;
    } else if (analysis.risk && analysis.risk.riskLevel === "LOW") {
        score += 5;
    }
    
    // Sentiment bonus
    if (analysis.sentiment) {
        if (analysis.sentiment.sentiment === "BULLISH" || analysis.sentiment.sentiment === "BEARISH") {
            score += 5;
        }
    }
    
    return Math.min(100, Math.max(0, score));
}

/**
 * Tạo tín hiệu premium
 */
async function generatePremiumSignal(analysis, symbol) {
    const currentPrice = await getCurrentPrice(symbol);
    if (!currentPrice) return { direction: "NONE" };
    
    // Xác định hướng chính
    let direction = "NONE";
    let confidence = 0;
    
    // Daily trend là yếu tố quyết định chính
    if (analysis.daily.trend.includes("BULLISH")) {
        direction = "LONG";
        confidence = analysis.daily.strength;
    } else if (analysis.daily.trend.includes("BEARISH")) {
        direction = "SHORT";
        confidence = analysis.daily.strength;
    }
    
    // Xác nhận với H4 structure
    if (direction === "LONG" && analysis.h4.structure === "BULLISH") {
        confidence += 10;
    } else if (direction === "SHORT" && analysis.h4.structure === "BEARISH") {
        confidence += 10;
    }
    
    // Xác nhận với H1 momentum
    if (direction === "LONG" && analysis.h1.momentum === "BULLISH") {
        confidence += 10;
    } else if (direction === "SHORT" && analysis.h1.momentum === "BEARISH") {
        confidence += 10;
    }
    
    // Xác nhận với M15 entry
    if (direction === "LONG" && analysis.m15.entrySignal === "BULLISH_ENTRY") {
        confidence += 15;
    } else if (direction === "SHORT" && analysis.m15.entrySignal === "BEARISH_ENTRY") {
        confidence += 15;
    }
    
    confidence = Math.min(95, confidence);
    
    // Tính Stop Loss và Take Profit
    const atr = analysis.m15.atr;
    const riskRewardRatio = 2.5; // Premium signals có R:R cao hơn
    
    let sl, tp;
    if (direction === "LONG") {
        sl = currentPrice - (atr * 1.5);
        tp = currentPrice + (atr * riskRewardRatio * 1.5);
    } else {
        sl = currentPrice + (atr * 1.5);
        tp = currentPrice - (atr * riskRewardRatio * 1.5);
    }
    
    return {
        direction,
        price: currentPrice,
        sl,
        tp,
        confidence,
        strategy: "PREMIUM_MULTI_TIMEFRAME",
        riskReward: riskRewardRatio,
        atr: atr
    };
}

/**
 * Tính MACD
 */
function calcMACD(candles, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (candles.length < slowPeriod + signalPeriod) return null;
    
    const closes = candles.map(c => c.close);
    const emaFast = calcEMA(closes, fastPeriod);
    const emaSlow = calcEMA(closes, slowPeriod);
    
    const macdLine = [];
    for (let i = 0; i < closes.length; i++) {
        macdLine.push(emaFast[i] - emaSlow[i]);
    }
    
    const signalLine = calcEMA(macdLine, signalPeriod);
    const histogram = [];
    for (let i = 0; i < macdLine.length; i++) {
        histogram.push(macdLine[i] - signalLine[i]);
    }
    
    return {
        macd: macdLine.at(-1),
        signal: signalLine.at(-1),
        histogram: histogram.at(-1),
        prevMacd: macdLine.at(-2),
        prevSignal: signalLine.at(-2),
        prevHistogram: histogram.at(-2)
    };
}

/**
 * Tìm Order Blocks
 */
function findOrderBlocks(candles) {
    if (candles.length < 20) return [];
    
    const orderBlocks = [];
    
    for (let i = 2; i < candles.length - 2; i++) {
        const current = candles[i];
        const prev = candles[i-1];
        const next = candles[i+1];
        
        // Bullish Order Block
        if (prev.close < prev.open && current.close > current.open && 
            current.close > prev.high && next.close > current.close) {
            orderBlocks.push({
                type: "bullish",
                high: current.high,
                low: current.low,
                open: current.open,
                close: current.close,
                index: i
            });
        }
        
        // Bearish Order Block
        if (prev.close > prev.open && current.close < current.open && 
            current.close < prev.low && next.close < current.close) {
            orderBlocks.push({
                type: "bearish",
                high: current.high,
                low: current.low,
                open: current.open,
                close: current.close,
                index: i
            });
        }
    }
    
    return orderBlocks.slice(-5); // Chỉ lấy 5 OB gần nhất
}


/* ============== EXPORT FUNCTIONS ============== */

export async function scanForPremiumSignals(symbols) {
    const premiumSignals = [];
    
    for (const symbol of symbols) {
        try {
            const signal = await findPremiumSignals(symbol);
            if (signal.direction !== "NONE" && signal.quality >= 85) {
                signal.symbol = symbol;
                premiumSignals.push(signal);
            }
        } catch (error) {
            console.error(`[PREMIUM] Lỗi quét ${symbol}:`, error);
        }
        
        // Delay để tránh rate limit
        await sleep(100);
    }
    
    // Sắp xếp theo chất lượng giảm dần
    premiumSignals.sort((a, b) => b.quality - a.quality);
    
    return premiumSignals;
}

/**
 * Quét hết tất cả coin để tìm cơ hội
 */
export async function scanAllCoinsForOpportunities() {
    try {
        console.log("[SCAN ALL] Bắt đầu quét tất cả coin...");
        
        // Lấy tất cả coin futures
        const response = await axios.get('https://www.okx.com/api/v5/public/instruments', {
            params: { instType: "SWAP" },
            timeout: 15000
        });
        
        const allSymbols = response.data.data
            .filter(t => t.state === 'live' && t.settleCcy === 'USDT')
            .map(t => t.instId);
        
        console.log(`[SCAN ALL] Tìm thấy ${allSymbols.length} coin để quét`);
        
        const opportunities = [];
        const batchSize = 10; // Xử lý theo batch để tránh timeout
        
        for (let i = 0; i < allSymbols.length; i += batchSize) {
            const batch = allSymbols.slice(i, i + batchSize);
            console.log(`[SCAN ALL] Đang xử lý batch ${i + 1}-${Math.min(i + batchSize, allSymbols.length)}/${allSymbols.length}`);
            
            const batchPromises = batch.map(async (symbol) => {
                try {
                    const signal = await findPremiumSignals(symbol);
                    if (signal.direction !== "NONE") {
                        signal.symbol = symbol;
                        return signal;
                    }
                } catch (error) {
                    console.error(`[SCAN ALL] Lỗi quét ${symbol}:`, error.message);
                }
                return null;
            });
            
            const batchResults = await Promise.all(batchPromises);
            opportunities.push(...batchResults.filter(s => s !== null));
            
            // Delay giữa các batch
            await sleep(200);
        }
        
        // Sắp xếp theo chất lượng giảm dần
        opportunities.sort((a, b) => b.quality - a.quality);
        
        console.log(`[SCAN ALL] Hoàn thành! Tìm thấy ${opportunities.length} cơ hội`);
        return opportunities;
        
    } catch (error) {
        console.error("[SCAN ALL] Lỗi quét tất cả coin:", error);
        return [];
    }
}

/**
 * Phân tích coin cụ thể
 */
export async function analyzeSpecificCoin(symbol) {
    try {
        console.log(`[ANALYZE] Đang phân tích ${symbol}...`);
        
        // Chuẩn hóa symbol
        const normalizedSymbol = symbol.toUpperCase();
        const fullSymbol = normalizedSymbol.includes('-USDT-SWAP') ? 
            normalizedSymbol : `${normalizedSymbol}-USDT-SWAP`;
        
        // Kiểm tra symbol có tồn tại không
        const response = await axios.get('https://www.okx.com/api/v5/public/instruments', {
            params: { instType: "SWAP" },
            timeout: 10000
        });
        
        const validSymbols = response.data.data
            .filter(t => t.state === 'live' && t.settleCcy === 'USDT')
            .map(t => t.instId);
        
        if (!validSymbols.includes(fullSymbol)) {
            return {
                success: false,
                error: `Symbol ${symbol} không tồn tại hoặc không được hỗ trợ`,
                suggestions: validSymbols.filter(s => s.includes(normalizedSymbol)).slice(0, 5)
            };
        }
        
        // Phân tích coin
        const analysis = await findPremiumSignals(fullSymbol);
        
        if (analysis.direction === "NONE") {
            return {
                success: true,
                symbol: fullSymbol,
                recommendation: "NEUTRAL",
                message: "Không có tín hiệu rõ ràng tại thời điểm này",
                quality: analysis.quality,
                analysis: analysis.analysis
            };
        }
        
        return {
            success: true,
            symbol: fullSymbol,
            recommendation: analysis.direction,
            confidence: analysis.confidence,
            quality: analysis.quality,
            price: analysis.price,
            sl: analysis.sl,
            tp: analysis.tp,
            riskReward: analysis.riskReward,
            analysis: analysis.analysis,
            message: generateAnalysisMessage(analysis)
        };
        
    } catch (error) {
        console.error(`[ANALYZE] Lỗi phân tích ${symbol}:`, error);
        return {
            success: false,
            error: `Lỗi khi phân tích ${symbol}: ${error.message}`
        };
    }
}

/**
 * Tạo thông điệp phân tích
 */
function generateAnalysisMessage(analysis) {
    const { direction, confidence, quality, analysis: details } = analysis;
    
    let message = `Khuyến nghị: ${direction} với độ tin cậy ${confidence.toFixed(1)}%\n`;
    message += `Điểm chất lượng: ${quality.toFixed(1)}/100\n\n`;
    
    if (details) {
        message += "Phân tích chi tiết:\n";
        
        if (details.daily) {
            message += `• Daily: ${details.daily.trend} (ADX: ${details.daily.adx?.toFixed(1)})\n`;
        }
        
        if (details.h4) {
            message += `• H4 Structure: ${details.h4.structure}\n`;
        }
        
        if (details.h1) {
            message += `• H1 Momentum: ${details.h1.momentum}\n`;
        }
        
        if (details.m15) {
            message += `• M15 Entry: ${details.m15.entrySignal}\n`;
        }
    }
    
    return message;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

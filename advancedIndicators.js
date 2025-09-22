// advancedIndicators.js - Các chỉ báo nâng cao và phân tích thị trường
import { getCandles, getCurrentPrice } from "./okx.js";

/* ============== CÁC CHỈ BÁO NÂNG CAO ============== */

/**
 * MACD (Moving Average Convergence Divergence)
 * Chỉ báo xu hướng và momentum mạnh mẽ
 */
export function calcMACD(candles, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
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
 * Volume Profile - Phân tích khối lượng giao dịch
 */
export function calcVolumeProfile(candles, period = 20) {
    if (candles.length < period) return null;
    
    const recentCandles = candles.slice(-period);
    const volumes = recentCandles.map(c => c.volume || 0);
    const avgVolume = volumes.reduce((sum, vol) => sum + vol, 0) / period;
    const maxVolume = Math.max(...volumes);
    const minVolume = Math.min(...volumes);
    
    // Volume spike detection
    const lastVolume = volumes.at(-1);
    const isVolumeSpike = lastVolume > avgVolume * 2;
    const isLowVolume = lastVolume < avgVolume * 0.5;
    
    return {
        avgVolume,
        maxVolume,
        minVolume,
        lastVolume,
        isVolumeSpike,
        isLowVolume,
        volumeRatio: lastVolume / avgVolume
    };
}

/**
 * Market Structure Analysis - Phân tích cấu trúc thị trường
 */
export function analyzeMarketStructure(candles, lookback = 50) {
    if (candles.length < lookback) return null;
    
    const recentCandles = candles.slice(-lookback);
    const highs = recentCandles.map(c => c.high);
    const lows = recentCandles.map(c => c.low);
    const closes = recentCandles.map(c => c.close);
    
    // Tìm Higher Highs, Lower Highs, Higher Lows, Lower Lows
    let higherHighs = 0, lowerHighs = 0;
    let higherLows = 0, lowerLows = 0;
    
    for (let i = 2; i < recentCandles.length - 2; i++) {
        const currentHigh = highs[i];
        const currentLow = lows[i];
        const prevHigh = highs[i-1];
        const prevLow = lows[i-1];
        
        if (currentHigh > prevHigh) higherHighs++;
        else if (currentHigh < prevHigh) lowerHighs++;
        
        if (currentLow > prevLow) higherLows++;
        else if (currentLow < prevLow) lowerLows++;
    }
    
    // Xác định xu hướng dựa trên cấu trúc
    let trend = "NEUTRAL";
    if (higherHighs > lowerHighs && higherLows > lowerLows) {
        trend = "BULLISH";
    } else if (lowerHighs > higherHighs && lowerLows > higherLows) {
        trend = "BEARISH";
    }
    
    // Tính độ mạnh của xu hướng
    const trendStrength = Math.abs((higherHighs - lowerHighs) + (higherLows - lowerLows)) / (lookback - 4);
    
    return {
        trend,
        trendStrength,
        higherHighs,
        lowerHighs,
        higherLows,
        lowerLows
    };
}

/**
 * Support & Resistance Levels - Tìm các mức hỗ trợ và kháng cự
 */
export function findSupportResistance(candles, lookback = 100) {
    if (candles.length < lookback) return null;
    
    const recentCandles = candles.slice(-lookback);
    const levels = [];
    
    // Tìm các đỉnh và đáy quan trọng
    for (let i = 3; i < recentCandles.length - 3; i++) {
        const current = recentCandles[i];
        const left = recentCandles.slice(i - 3, i);
        const right = recentCandles.slice(i + 1, i + 4);
        
        // Kiểm tra đỉnh
        const isPeak = left.every(c => c.high <= current.high) && 
                      right.every(c => c.high <= current.high);
        
        // Kiểm tra đáy
        const isTrough = left.every(c => c.low >= current.low) && 
                        right.every(c => c.low >= current.low);
        
        if (isPeak) {
            levels.push({ price: current.high, type: 'resistance', strength: 1 });
        }
        if (isTrough) {
            levels.push({ price: current.low, type: 'support', strength: 1 });
        }
    }
    
    // Sắp xếp và lọc các mức quan trọng nhất
    levels.sort((a, b) => b.strength - a.strength);
    return levels.slice(0, 10); // Top 10 levels
}

/**
 * Market Sentiment Analysis - Phân tích tâm lý thị trường
 */
export async function analyzeMarketSentiment(symbol) {
    try {
        const candles = await getCandles(symbol, "1H", 100);
        if (!candles || candles.length < 50) return null;
        
        const closes = candles.map(c => c.close);
        const volumes = candles.map(c => c.volume || 0);
        
        // RSI để đo overbought/oversold
        const rsi = calcRSI(candles, 14);
        
        // Price momentum
        const priceChange = (closes.at(-1) - closes.at(-20)) / closes.at(-20) * 100;
        
        // Volume momentum
        const recentVolume = volumes.slice(-10).reduce((sum, vol) => sum + vol, 0) / 10;
        const oldVolume = volumes.slice(-30, -20).reduce((sum, vol) => sum + vol, 0) / 10;
        const volumeChange = (recentVolume - oldVolume) / oldVolume * 100;
        
        // Xác định sentiment
        let sentiment = "NEUTRAL";
        let confidence = 0;
        
        if (rsi > 70 && priceChange > 5) {
            sentiment = "EXTREME_BULLISH";
            confidence = Math.min(90, 50 + Math.abs(priceChange));
        } else if (rsi < 30 && priceChange < -5) {
            sentiment = "EXTREME_BEARISH";
            confidence = Math.min(90, 50 + Math.abs(priceChange));
        } else if (rsi > 60 && priceChange > 2) {
            sentiment = "BULLISH";
            confidence = 60;
        } else if (rsi < 40 && priceChange < -2) {
            sentiment = "BEARISH";
            confidence = 60;
        }
        
        return {
            sentiment,
            confidence,
            rsi,
            priceChange,
            volumeChange,
            isOverbought: rsi > 70,
            isOversold: rsi < 30
        };
    } catch (error) {
        console.error(`Lỗi phân tích sentiment cho ${symbol}:`, error);
        return null;
    }
}

/**
 * Crash Detection - Phát hiện khả năng sập mạnh
 */
export function detectCrashRisk(candles, period = 20) {
    if (candles.length < period) return null;
    
    const recentCandles = candles.slice(-period);
    const closes = recentCandles.map(c => c.close);
    const volumes = recentCandles.map(c => c.volume || 0);
    
    // Tính volatility
    const returns = [];
    for (let i = 1; i < closes.length; i++) {
        returns.push((closes[i] - closes[i-1]) / closes[i-1]);
    }
    const volatility = Math.sqrt(returns.reduce((sum, ret) => sum + ret*ret, 0) / returns.length);
    
    // Phát hiện divergence giữa giá và volume
    const priceChange = (closes.at(-1) - closes.at(-10)) / closes.at(-10);
    const volumeChange = (volumes.at(-1) - volumes.at(-10)) / volumes.at(-10);
    const divergence = Math.abs(priceChange - volumeChange);
    
    // Phát hiện pattern giảm dần
    const recentHighs = closes.slice(-5).map((price, i) => {
        const left = closes.slice(-5 + i - 1, -5 + i);
        const right = closes.slice(-5 + i + 1, -5 + i + 2);
        return left.every(p => p <= price) && right.every(p => p <= price);
    });
    
    const isTopping = recentHighs.some(isHigh => isHigh);
    
    // Tính điểm rủi ro
    let riskScore = 0;
    if (volatility > 0.05) riskScore += 30; // High volatility
    if (divergence > 0.3) riskScore += 25; // Price-volume divergence
    if (isTopping) riskScore += 20; // Topping pattern
    if (priceChange > 0.1) riskScore += 25; // Recent pump
    
    return {
        riskScore,
        volatility,
        divergence,
        isTopping,
        priceChange,
        volumeChange,
        riskLevel: riskScore > 70 ? "HIGH" : riskScore > 40 ? "MEDIUM" : "LOW"
    };
}

/**
 * Reversal Detection - Phát hiện khả năng đảo chiều
 */
export function detectReversalSignals(candles) {
    if (candles.length < 50) return null;
    
    const recentCandles = candles.slice(-20);
    const closes = recentCandles.map(c => c.close);
    const highs = recentCandles.map(c => c.high);
    const lows = recentCandles.map(c => c.low);
    
    // Hammer/Doji patterns
    const lastCandle = recentCandles.at(-1);
    const bodySize = Math.abs(lastCandle.close - lastCandle.open);
    const totalSize = lastCandle.high - lastCandle.low;
    const isHammer = bodySize < totalSize * 0.3 && 
                    (lastCandle.close - lastCandle.low) > (lastCandle.high - lastCandle.close) * 2;
    
    // Engulfing patterns
    const prevCandle = recentCandles.at(-2);
    const isBullishEngulfing = prevCandle.close < prevCandle.open && 
                              lastCandle.close > lastCandle.open &&
                              lastCandle.open < prevCandle.close &&
                              lastCandle.close > prevCandle.open;
    
    const isBearishEngulfing = prevCandle.close > prevCandle.open && 
                              lastCandle.close < lastCandle.open &&
                              lastCandle.open > prevCandle.close &&
                              lastCandle.close < prevCandle.open;
    
    // RSI divergence
    const rsi = calcRSI(candles, 14);
    const priceSlope = (closes.at(-1) - closes.at(-5)) / 5;
    const rsiSlope = (rsi - calcRSI(candles.slice(0, -5), 14)) / 5;
    const isDivergence = (priceSlope > 0 && rsiSlope < 0) || (priceSlope < 0 && rsiSlope > 0);
    
    let reversalSignal = "NONE";
    let strength = 0;
    
    if (isHammer && closes.at(-1) > closes.at(-2)) {
        reversalSignal = "BULLISH";
        strength += 30;
    }
    if (isBullishEngulfing) {
        reversalSignal = "BULLISH";
        strength += 40;
    }
    if (isBearishEngulfing) {
        reversalSignal = "BEARISH";
        strength += 40;
    }
    if (isDivergence) {
        strength += 20;
    }
    
    return {
        signal: reversalSignal,
        strength,
        isHammer,
        isBullishEngulfing,
        isBearishEngulfing,
        isDivergence
    };
}

/**
 * Daily Market Analysis - Phân tích thị trường trong ngày
 */
export async function getDailyMarketAnalysis(symbol) {
    try {
        const [h1Candles, h4Candles, d1Candles] = await Promise.all([
            getCandles(symbol, "1H", 100),
            getCandles(symbol, "4H", 50),
            getCandles(symbol, "1D", 30)
        ]);
        
        if (!h1Candles || !h4Candles || !d1Candles) return null;
        
        // Phân tích đa khung thời gian
        const h1Structure = analyzeMarketStructure(h1Candles);
        const h4Structure = analyzeMarketStructure(h4Candles);
        const d1Structure = analyzeMarketStructure(d1Candles);
        
        // Phân tích sentiment
        const sentiment = await analyzeMarketSentiment(symbol);
        
        // Phân tích rủi ro
        const crashRisk = detectCrashRisk(h1Candles);
        const reversalSignals = detectReversalSignals(h1Candles);
        
        // Tổng hợp phân tích
        const analysis = {
            timeframe: {
                h1: h1Structure,
                h4: h4Structure,
                d1: d1Structure
            },
            sentiment,
            risk: crashRisk,
            reversal: reversalSignals,
            recommendation: generateRecommendation(h1Structure, h4Structure, d1Structure, sentiment, crashRisk)
        };
        
        return analysis;
    } catch (error) {
        console.error(`Lỗi phân tích thị trường cho ${symbol}:`, error);
        return null;
    }
}

/**
 * Tạo khuyến nghị giao dịch dựa trên phân tích
 */
function generateRecommendation(h1, h4, d1, sentiment, risk) {
    let score = 0;
    let direction = "NEUTRAL";
    let confidence = 0;
    
    // Điểm từ cấu trúc thị trường
    if (h1?.trend === "BULLISH") score += 20;
    if (h4?.trend === "BULLISH") score += 30;
    if (d1?.trend === "BULLISH") score += 40;
    
    if (h1?.trend === "BEARISH") score -= 20;
    if (h4?.trend === "BEARISH") score -= 30;
    if (d1?.trend === "BEARISH") score -= 40;
    
    // Điểm từ sentiment
    if (sentiment?.sentiment === "BULLISH") score += 15;
    if (sentiment?.sentiment === "BEARISH") score -= 15;
    if (sentiment?.sentiment === "EXTREME_BULLISH") score += 25;
    if (sentiment?.sentiment === "EXTREME_BEARISH") score -= 25;
    
    // Điểm từ rủi ro
    if (risk?.riskLevel === "HIGH") score -= 30;
    if (risk?.riskLevel === "LOW") score += 10;
    
    // Xác định hướng và độ tin cậy
    if (score > 50) {
        direction = "LONG";
        confidence = Math.min(95, score);
    } else if (score < -50) {
        direction = "SHORT";
        confidence = Math.min(95, Math.abs(score));
    } else {
        direction = "NEUTRAL";
        confidence = 50 - Math.abs(score);
    }
    
    return {
        direction,
        confidence,
        score,
        reasoning: generateReasoning(h1, h4, d1, sentiment, risk, score)
    };
}

function generateReasoning(h1, h4, d1, sentiment, risk, score) {
    const reasons = [];
    
    if (h1?.trend) reasons.push(`H1: ${h1.trend}`);
    if (h4?.trend) reasons.push(`H4: ${h4.trend}`);
    if (d1?.trend) reasons.push(`D1: ${d1.trend}`);
    if (sentiment?.sentiment) reasons.push(`Sentiment: ${sentiment.sentiment}`);
    if (risk?.riskLevel) reasons.push(`Risk: ${risk.riskLevel}`);
    
    return reasons.join(", ");
}

// Helper functions
function calcEMA(values, period) {
    const k = 2 / (period + 1);
    return values.reduce((acc, price, i) => {
        if (i === 0) return [price];
        const ema = price * k + acc[i - 1] * (1 - k);
        acc.push(ema);
        return acc;
    }, []);
}

function calcRSI(candles, period = 14) {
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

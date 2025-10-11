// advancedIndicators.js - Chỉ báo kỹ thuật nâng cao
import { getCandles, getCurrentPrice } from "./okx.js";
import { calcEMA, calcRSI, calcATR, calcBollingerBands, calcAvgVolume } from "./indicators.js";

/**
 * Tính toán MACD (Moving Average Convergence Divergence)
 */
export function calcMACD(candles, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (candles.length < slowPeriod + signalPeriod) return null;
    
    const closes = candles.map(c => c.close);
    const ema12 = calcEMA(closes, fastPeriod);
    const ema26 = calcEMA(closes, slowPeriod);
    
    const macdLine = [];
    for (let i = slowPeriod - 1; i < closes.length; i++) {
        macdLine.push(ema12[i] - ema26[i]);
    }
    
    const signalLine = calcEMA(macdLine, signalPeriod);
    const histogram = [];
    
    for (let i = signalPeriod - 1; i < macdLine.length; i++) {
        histogram.push(macdLine[i] - signalLine[i - signalPeriod + 1]);
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
 * Tính toán Stochastic Oscillator
 */
export function calcStochastic(candles, kPeriod = 14, dPeriod = 3) {
    if (candles.length < kPeriod + dPeriod) return null;
    
    const kValues = [];
    for (let i = kPeriod - 1; i < candles.length; i++) {
        const slice = candles.slice(i - kPeriod + 1, i + 1);
        const highest = Math.max(...slice.map(c => c.high));
        const lowest = Math.min(...slice.map(c => c.low));
        const current = candles[i].close;
        
        const k = highest === lowest ? 50 : ((current - lowest) / (highest - lowest)) * 100;
        kValues.push(k);
    }
    
    const dValues = [];
    for (let i = dPeriod - 1; i < kValues.length; i++) {
        const dSlice = kValues.slice(i - dPeriod + 1, i + 1);
        dValues.push(dSlice.reduce((a, b) => a + b, 0) / dPeriod);
    }
    
    return {
        k: kValues.at(-1),
        d: dValues.at(-1),
        prevK: kValues.at(-2),
        prevD: dValues.at(-2)
    };
}

/**
 * Tính toán Williams %R
 */
export function calcWilliamsR(candles, period = 14) {
    if (candles.length < period) return null;
    
    const slice = candles.slice(-period);
    const highest = Math.max(...slice.map(c => c.high));
    const lowest = Math.min(...slice.map(c => c.low));
    const current = candles.at(-1).close;
    
    const williamsR = highest === lowest ? -50 : ((highest - current) / (highest - lowest)) * -100;
    
    return {
        value: williamsR,
        prevValue: period < candles.length ? 
            ((highest - candles.at(-2).close) / (highest - lowest)) * -100 : williamsR
    };
}

/**
 * Tính toán Money Flow Index (MFI)
 */
export function calcMFI(candles, period = 14) {
    if (candles.length < period + 1) return null;
    
    const typicalPrices = [];
    const moneyFlows = [];
    
    for (let i = 1; i < candles.length; i++) {
        const typicalPrice = (candles[i].high + candles[i].low + candles[i].close) / 3;
        const prevTypicalPrice = (candles[i-1].high + candles[i-1].low + candles[i-1].close) / 3;
        
        typicalPrices.push(typicalPrice);
        
        const rawMoneyFlow = typicalPrice * candles[i].volume;
        
        if (typicalPrice > prevTypicalPrice) {
            moneyFlows.push({ positive: rawMoneyFlow, negative: 0 });
        } else if (typicalPrice < prevTypicalPrice) {
            moneyFlows.push({ positive: 0, negative: rawMoneyFlow });
        } else {
            moneyFlows.push({ positive: 0, negative: 0 });
        }
    }
    
    if (moneyFlows.length < period) return null;
    
    const recentFlows = moneyFlows.slice(-period);
    const positiveFlow = recentFlows.reduce((sum, flow) => sum + flow.positive, 0);
    const negativeFlow = recentFlows.reduce((sum, flow) => sum + flow.negative, 0);
    
    const mfi = negativeFlow === 0 ? 100 : 100 - (100 / (1 + positiveFlow / negativeFlow));
    
    return {
        value: mfi,
        prevValue: moneyFlows.length >= period + 1 ? 
            (() => {
                const prevFlows = moneyFlows.slice(-period - 1, -1);
                const prevPositive = prevFlows.reduce((sum, flow) => sum + flow.positive, 0);
                const prevNegative = prevFlows.reduce((sum, flow) => sum + flow.negative, 0);
                return prevNegative === 0 ? 100 : 100 - (100 / (1 + prevPositive / prevNegative));
            })() : mfi
    };
}

/**
 * Tính toán Commodity Channel Index (CCI)
 */
export function calcCCI(candles, period = 20) {
    if (candles.length < period) return null;
    
    const typicalPrices = candles.map(c => (c.high + c.low + c.close) / 3);
    const recentPrices = typicalPrices.slice(-period);
    const sma = recentPrices.reduce((sum, price) => sum + price, 0) / period;
    
    const meanDeviation = recentPrices.reduce((sum, price) => sum + Math.abs(price - sma), 0) / period;
    
    const cci = meanDeviation === 0 ? 0 : (typicalPrices.at(-1) - sma) / (0.015 * meanDeviation);
    
    return {
        value: cci,
        prevValue: typicalPrices.length >= period + 1 ? 
            (() => {
                const prevPrices = typicalPrices.slice(-period - 1, -1);
                const prevSma = prevPrices.reduce((sum, price) => sum + price, 0) / period;
                const prevMeanDev = prevPrices.reduce((sum, price) => sum + Math.abs(price - prevSma), 0) / period;
                return prevMeanDev === 0 ? 0 : (typicalPrices.at(-2) - prevSma) / (0.015 * prevMeanDev);
            })() : cci
    };
}

/**
 * Tính toán Parabolic SAR
 */
export function calcParabolicSAR(candles, acceleration = 0.02, maximum = 0.2) {
    if (candles.length < 2) return null;
    
    let sar = candles[0].low;
    let trend = 1; // 1 = uptrend, -1 = downtrend
    let af = acceleration;
    let ep = candles[0].high;
    
    for (let i = 1; i < candles.length; i++) {
        const candle = candles[i];
        
        if (trend === 1) {
            sar = sar + af * (ep - sar);
            if (candle.low <= sar) {
                trend = -1;
                sar = ep;
                ep = candle.low;
                af = acceleration;
            } else {
                if (candle.high > ep) {
                    ep = candle.high;
                    af = Math.min(af + acceleration, maximum);
                }
            }
        } else {
            sar = sar + af * (ep - sar);
            if (candle.high >= sar) {
                trend = 1;
                sar = ep;
                ep = candle.high;
                af = acceleration;
            } else {
                if (candle.low < ep) {
                    ep = candle.low;
                    af = Math.min(af + acceleration, maximum);
                }
            }
        }
    }
    
    return {
        value: sar,
        trend: trend,
        prevValue: candles.length >= 3 ? 
            (() => {
                // Simplified calculation for previous value
                return trend === 1 ? Math.min(sar, candles.at(-2).low) : Math.max(sar, candles.at(-2).high);
            })() : sar
    };
}

/**
 * Tính toán Ichimoku Cloud (simplified)
 */
export function calcIchimoku(candles, conversionPeriod = 9, basePeriod = 26, leadingSpanBPeriod = 52) {
    if (candles.length < leadingSpanBPeriod) return null;
    
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    
    // Tenkan-sen (Conversion Line)
    const tenkanHigh = Math.max(...highs.slice(-conversionPeriod));
    const tenkanLow = Math.min(...lows.slice(-conversionPeriod));
    const tenkan = (tenkanHigh + tenkanLow) / 2;
    
    // Kijun-sen (Base Line)
    const kijunHigh = Math.max(...highs.slice(-basePeriod));
    const kijunLow = Math.min(...lows.slice(-basePeriod));
    const kijun = (kijunHigh + kijunLow) / 2;
    
    // Senkou Span A (Leading Span A)
    const senkouA = (tenkan + kijun) / 2;
    
    // Senkou Span B (Leading Span B)
    const senkouBHigh = Math.max(...highs.slice(-leadingSpanBPeriod));
    const senkouBLow = Math.min(...lows.slice(-leadingSpanBPeriod));
    const senkouB = (senkouBHigh + senkouBLow) / 2;
    
    // Chikou Span (Lagging Span)
    const chikou = closes.at(-1);
    
    return {
        tenkan,
        kijun,
        senkouA,
        senkouB,
        chikou,
        cloudTop: Math.max(senkouA, senkouB),
        cloudBottom: Math.min(senkouA, senkouB),
        currentPrice: closes.at(-1),
        isAboveCloud: closes.at(-1) > Math.max(senkouA, senkouB),
        isBelowCloud: closes.at(-1) < Math.min(senkouA, senkouB)
    };
}

/**
 * Phân tích tất cả chỉ báo nâng cao cho một symbol
 */
export async function analyzeAdvancedIndicators(symbol, direction) {
    try {
        const candles = await getCandles(symbol, "1H", 100);
        if (!candles || candles.length < 50) {
            return { summary: {}, details: {} };
        }
        
        const macd = calcMACD(candles);
        const stochastic = calcStochastic(candles);
        const williamsR = calcWilliamsR(candles);
        const mfi = calcMFI(candles);
        const cci = calcCCI(candles);
        const sar = calcParabolicSAR(candles);
        const ichimoku = calcIchimoku(candles);
        
        // Phân tích tín hiệu cho từng chỉ báo
        const signals = {
            macdSignal: false,
            stochasticSignal: false,
            williamsSignal: false,
            mfiSignal: false,
            cciSignal: false,
            sarSignal: false,
            ichimokuSignal: false
        };
        
        // MACD Signal
        if (macd && macd.macd && macd.signal) {
            if (direction === 'LONG') {
                signals.macdSignal = macd.macd > macd.signal && macd.histogram > 0;
            } else if (direction === 'SHORT') {
                signals.macdSignal = macd.macd < macd.signal && macd.histogram < 0;
            }
        }
        
        // Stochastic Signal
        if (stochastic && stochastic.k && stochastic.d) {
            if (direction === 'LONG') {
                signals.stochasticSignal = stochastic.k > stochastic.d && stochastic.k < 80;
            } else if (direction === 'SHORT') {
                signals.stochasticSignal = stochastic.k < stochastic.d && stochastic.k > 20;
            }
        }
        
        // Williams %R Signal
        if (williamsR && williamsR.value !== null) {
            if (direction === 'LONG') {
                signals.williamsSignal = williamsR.value > -80 && williamsR.value < -20;
            } else if (direction === 'SHORT') {
                signals.williamsSignal = williamsR.value < -20 && williamsR.value > -80;
            }
        }
        
        // MFI Signal
        if (mfi && mfi.value !== null) {
            if (direction === 'LONG') {
                signals.mfiSignal = mfi.value > 20 && mfi.value < 80;
            } else if (direction === 'SHORT') {
                signals.mfiSignal = mfi.value < 80 && mfi.value > 20;
            }
        }
        
        // CCI Signal
        if (cci && cci.value !== null) {
            if (direction === 'LONG') {
                signals.cciSignal = cci.value > -100 && cci.value < 100;
            } else if (direction === 'SHORT') {
                signals.cciSignal = cci.value < 100 && cci.value > -100;
            }
        }
        
        // Parabolic SAR Signal
        if (sar && sar.trend !== null) {
            if (direction === 'LONG') {
                signals.sarSignal = sar.trend === 1;
            } else if (direction === 'SHORT') {
                signals.sarSignal = sar.trend === -1;
            }
        }
        
        // Ichimoku Signal
        if (ichimoku) {
            if (direction === 'LONG') {
                signals.ichimokuSignal = ichimoku.isAboveCloud && ichimoku.currentPrice > ichimoku.tenkan;
            } else if (direction === 'SHORT') {
                signals.ichimokuSignal = ichimoku.isBelowCloud && ichimoku.currentPrice < ichimoku.tenkan;
            }
        }
        
        return {
            summary: signals,
            details: {
                macd,
                stochastic,
                williamsR,
                mfi,
                cci,
                sar,
                ichimoku
            }
        };
        
    } catch (error) {
        console.error(`Lỗi phân tích chỉ báo nâng cao cho ${symbol}:`, error);
        return { summary: {}, details: {} };
    }
}

/**
 * Tạo báo cáo chi tiết về chỉ báo nâng cao
 */
export function generateAdvancedIndicatorReport(advancedIndicators) {
    if (!advancedIndicators || !advancedIndicators.details) {
        return "Không có dữ liệu chỉ báo nâng cao.";
    }
    
    const { details, summary } = advancedIndicators;
    let report = "🔥 *BÁO CÁO CHỈ BÁO NÂNG CAO*\n\n";
    
    // MACD
    if (details.macd) {
        const macdIcon = summary.macdSignal ? '✅' : '❌';
        report += `${macdIcon} *MACD:* ${details.macd.macd.toFixed(4)} | Signal: ${details.macd.signal.toFixed(4)}\n`;
        report += `   Histogram: ${details.macd.histogram.toFixed(4)}\n`;
    }
    
    // Stochastic
    if (details.stochastic) {
        const stochIcon = summary.stochasticSignal ? '✅' : '❌';
        report += `${stochIcon} *Stochastic:* K=${details.stochastic.k.toFixed(2)}, D=${details.stochastic.d.toFixed(2)}\n`;
    }
    
    // Williams %R
    if (details.williamsR) {
        const williamsIcon = summary.williamsSignal ? '✅' : '❌';
        report += `${williamsIcon} *Williams %R:* ${details.williamsR.value.toFixed(2)}\n`;
    }
    
    // MFI
    if (details.mfi) {
        const mfiIcon = summary.mfiSignal ? '✅' : '❌';
        report += `${mfiIcon} *MFI:* ${details.mfi.value.toFixed(2)}\n`;
    }
    
    // CCI
    if (details.cci) {
        const cciIcon = summary.cciSignal ? '✅' : '❌';
        report += `${cciIcon} *CCI:* ${details.cci.value.toFixed(2)}\n`;
    }
    
    // Parabolic SAR
    if (details.sar) {
        const sarIcon = summary.sarSignal ? '✅' : '❌';
        const trendText = details.sar.trend === 1 ? 'Tăng' : 'Giảm';
        report += `${sarIcon} *Parabolic SAR:* ${details.sar.value.toFixed(4)} (${trendText})\n`;
    }
    
    // Ichimoku
    if (details.ichimoku) {
        const ichimokuIcon = summary.ichimokuSignal ? '✅' : '❌';
        report += `${ichimokuIcon} *Ichimoku:* Tenkan=${details.ichimoku.tenkan.toFixed(4)}\n`;
        report += `   Cloud: ${details.ichimoku.cloudBottom.toFixed(4)} - ${details.ichimoku.cloudTop.toFixed(4)}\n`;
        report += `   Position: ${details.ichimoku.isAboveCloud ? 'Trên Cloud' : details.ichimoku.isBelowCloud ? 'Dưới Cloud' : 'Trong Cloud'}\n`;
    }
    
    // Tổng kết
    const signalCount = Object.values(summary).filter(Boolean).length;
    report += `\n🎯 *Tổng số chỉ báo đồng thuận:* ${signalCount}/7\n`;
    
    if (signalCount >= 5) {
        report += `🔥 *Đánh giá:* TÍN HIỆU RẤT MẠNH\n`;
    } else if (signalCount >= 3) {
        report += `⚠️ *Đánh giá:* Tín hiệu TRUNG BÌNH\n`;
    } else {
        report += `❌ *Đánh giá:* Tín hiệu YẾU\n`;
    }
    
    return report;
}

/**
 * Phát hiện tín hiệu đảo chiều
 */
export function detectReversalSignals(candles) {
    if (candles.length < 20) return null;
    
    const rsi = calcRSI(candles, 14);
    const stochastic = calcStochastic(candles);
    const williamsR = calcWilliamsR(candles);
    
    let bullishSignals = 0;
    let bearishSignals = 0;
    
    // RSI Divergence
    if (rsi < 30) bullishSignals++;
    if (rsi > 70) bearishSignals++;
    
    // Stochastic
    if (stochastic && stochastic.k < 20) bullishSignals++;
    if (stochastic && stochastic.k > 80) bearishSignals++;
    
    // Williams %R
    if (williamsR && williamsR.value < -80) bullishSignals++;
    if (williamsR && williamsR.value > -20) bearishSignals++;
    
    // Candlestick patterns
    const lastCandle = candles.at(-1);
    const prevCandle = candles.at(-2);
    
    // Hammer pattern
    const isHammer = (lastCandle.close > lastCandle.open) && 
                     ((lastCandle.close - lastCandle.open) * 2 < (lastCandle.open - lastCandle.low));
    
    // Engulfing pattern
    const isBullishEngulfing = (prevCandle.close < prevCandle.open) && 
                              (lastCandle.close > lastCandle.open) &&
                              (lastCandle.open < prevCandle.close) &&
                              (lastCandle.close > prevCandle.open);
    
    const isBearishEngulfing = (prevCandle.close > prevCandle.open) && 
                              (lastCandle.close < lastCandle.open) &&
                              (lastCandle.open > prevCandle.close) &&
                              (lastCandle.close < prevCandle.open);
    
    if (isHammer || isBullishEngulfing) bullishSignals += 2;
    if (isBearishEngulfing) bearishSignals += 2;
    
    const strength = Math.max(bullishSignals, bearishSignals) * 20;
    
    return {
        signal: bullishSignals > bearishSignals ? "BULLISH" : bearishSignals > bullishSignals ? "BEARISH" : "NONE",
        strength: Math.min(strength, 100),
        isHammer,
        isBullishEngulfing,
        isBearishEngulfing,
        isDivergence: bullishSignals > 0 || bearishSignals > 0
    };
}

/**
 * Phân tích thị trường hàng ngày
 */
export async function getDailyMarketAnalysis(symbol) {
    try {
        const candles = await getCandles(symbol, "1D", 30);
        if (!candles || candles.length < 20) return null;
        
        const closes = candles.map(c => c.close);
        const ema20 = calcEMA(closes, 20).at(-1);
        const ema50 = calcEMA(closes, 50).at(-1);
        const currentPrice = closes.at(-1);
        
        const rsi = calcRSI(candles, 14);
        const atr = calcATR(candles, 14);
        
        // Phân tích xu hướng
        let trend = "NEUTRAL";
        let confidence = 50;
        
        if (currentPrice > ema20 && ema20 > ema50) {
            trend = "BULLISH";
            confidence = 75;
        } else if (currentPrice < ema20 && ema20 < ema50) {
            trend = "BEARISH";
            confidence = 75;
        }
        
        // Điều chỉnh confidence dựa trên RSI
        if (trend === "BULLISH" && rsi > 70) confidence -= 20;
        if (trend === "BEARISH" && rsi < 30) confidence -= 20;
        
        // Phân tích rủi ro
        const volatility = atr / currentPrice;
        let riskLevel = "LOW";
        if (volatility > 0.05) riskLevel = "HIGH";
        else if (volatility > 0.03) riskLevel = "MEDIUM";
        
        return {
            recommendation: {
                direction: trend,
                confidence: Math.max(confidence, 30)
            },
            risk: {
                riskLevel,
                volatility,
                priceChange: (currentPrice - closes.at(-2)) / closes.at(-2)
            }
        };
        
    } catch (error) {
        console.error(`Lỗi phân tích thị trường cho ${symbol}:`, error);
        return null;
    }
}

/**
 * Phát hiện rủi ro crash
 */
export function detectCrashRisk(candles) {
    if (candles.length < 20) return null;
    
    const closes = candles.map(c => c.close);
    const recentPrices = closes.slice(-10);
    const olderPrices = closes.slice(-20, -10);
    
    const recentAvg = recentPrices.reduce((sum, price) => sum + price, 0) / recentPrices.length;
    const olderAvg = olderPrices.reduce((sum, price) => sum + price, 0) / olderPrices.length;
    
    const priceChange = (recentAvg - olderAvg) / olderAvg;
    const volatility = calcATR(candles.slice(-10), 10) / recentAvg;
    
    let riskScore = 0;
    
    // Giảm giá mạnh
    if (priceChange < -0.1) riskScore += 40;
    else if (priceChange < -0.05) riskScore += 20;
    
    // Biến động cao
    if (volatility > 0.08) riskScore += 30;
    else if (volatility > 0.05) riskScore += 15;
    
    // Volume spike (simplified)
    const volumes = candles.map(c => c.volume || 0);
    const avgVolume = volumes.slice(-20).reduce((sum, vol) => sum + vol, 0) / 20;
    const recentVolume = volumes.slice(-5).reduce((sum, vol) => sum + vol, 0) / 5;
    
    if (recentVolume > avgVolume * 2) riskScore += 20;
    else if (recentVolume > avgVolume * 1.5) riskScore += 10;
    
    let riskLevel = "LOW";
    if (riskScore > 60) riskLevel = "HIGH";
    else if (riskScore > 30) riskLevel = "MEDIUM";
    
    return {
        riskLevel,
        riskScore: Math.min(riskScore, 100),
        volatility,
        priceChange
    };
}

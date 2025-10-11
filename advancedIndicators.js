// advancedIndicators.js - Hệ thống chỉ báo nâng cao và cảnh báo rủi ro
import { getCandles, getCurrentPrice } from "./okx.js";
import { calcEMA, calcRSI, calcATR, calcBollingerBands, calcAvgVolume } from "./indicators.js";

/**
 * Tính toán MACD với tín hiệu mạnh mẽ
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
    
    const currentMacd = macdLine.at(-1);
    const currentSignal = signalLine.at(-1);
    const currentHistogram = histogram.at(-1);
    const prevHistogram = histogram.at(-2);
    
    return {
        macd: currentMacd,
        signal: currentSignal,
        histogram: currentHistogram,
        prevHistogram: prevHistogram,
        bullish: currentMacd > currentSignal && currentHistogram > prevHistogram,
        bearish: currentMacd < currentSignal && currentHistogram < prevHistogram,
        strength: Math.abs(currentHistogram)
    };
}

/**
 * Stochastic Oscillator với tín hiệu chính xác
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
    
    const currentK = kValues.at(-1);
    const currentD = dValues.at(-1);
    const prevK = kValues.at(-2);
    const prevD = dValues.at(-2);
    
    return {
        k: currentK,
        d: currentD,
        prevK: prevK,
        prevD: prevD,
        oversold: currentK < 20,
        overbought: currentK > 80,
        bullishCrossover: currentK > currentD && prevK <= prevD,
        bearishCrossover: currentK < currentD && prevK >= prevD
    };
}

/**
 * Williams %R với tín hiệu momentum
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
        oversold: williamsR < -80,
        overbought: williamsR > -20,
        bullish: williamsR > -80 && williamsR < -50,
        bearish: williamsR < -50 && williamsR > -20
    };
}

/**
 * Money Flow Index với xác nhận volume
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
        bullish: mfi < 20, // Oversold
        bearish: mfi > 80, // Overbought
        strength: Math.abs(mfi - 50) / 50
    };
}

/**
 * Commodity Channel Index với breakout detection
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
        bullish: cci > 100, // Bullish breakout
        bearish: cci < -100, // Bearish breakout
        overbought: cci > 200,
        oversold: cci < -200,
        strength: Math.abs(cci) / 100
    };
}

/**
 * Parabolic SAR với trend confirmation
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
    
    const currentPrice = candles.at(-1).close;
    
    return {
        value: sar,
        trend: trend,
        bullish: trend === 1 && currentPrice > sar,
        bearish: trend === -1 && currentPrice < sar,
        distance: Math.abs(currentPrice - sar) / currentPrice
    };
}

/**
 * Ichimoku Cloud với cloud analysis
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
    
    const currentPrice = closes.at(-1);
    const cloudTop = Math.max(senkouA, senkouB);
    const cloudBottom = Math.min(senkouA, senkouB);
    
    return {
        tenkan,
        kijun,
        senkouA,
        senkouB,
        cloudTop,
        cloudBottom,
        currentPrice,
        isAboveCloud: currentPrice > cloudTop,
        isBelowCloud: currentPrice < cloudBottom,
        isInCloud: currentPrice >= cloudBottom && currentPrice <= cloudTop,
        bullish: currentPrice > cloudTop && tenkan > kijun,
        bearish: currentPrice < cloudBottom && tenkan < kijun
    };
}

/**
 * Hệ thống phân tích chỉ báo nâng cao với điểm số (NÂNG CẤP với 10 chỉ báo mới)
 */
export async function analyzeAdvancedIndicators(symbol, direction) {
    try {
        const candles = await getCandles(symbol, "1H", 100);
        if (!candles || candles.length < 50) {
            return { score: 0, signals: {}, details: {} };
        }
        
        // Tính toán các chỉ báo nâng cao cũ (7 chỉ báo)
        const macd = calcMACD(candles);
        const stochastic = calcStochastic(candles);
        const williamsR = calcWilliamsR(candles);
        const mfi = calcMFI(candles);
        const cci = calcCCI(candles);
        const sar = calcParabolicSAR(candles);
        const ichimoku = calcIchimoku(candles);

        // Tính toán các chỉ báo nâng cao mới (10 chỉ báo)
        const macdHistogram = calcMACDHistogram(candles);
        const atrp = calcATRP(candles);
        const roc = calcROC(candles);
        const obv = calcOBV(candles);
        const adLine = calcADLine(candles);
        const vpt = calcVPT(candles);
        const ultimateOscillator = calcUltimateOscillator(candles);
        const adxr = calcADXR(candles);
        const massIndex = calcMassIndex(candles);
        const tsi = calcTSI(candles);
        
        // Đánh giá tín hiệu cho từng chỉ báo (17 chỉ báo tổng cộng)
        const signals = {
            // Chỉ báo cũ (7 chỉ báo)
            macdSignal: false,
            stochasticSignal: false,
            williamsSignal: false,
            mfiSignal: false,
            cciSignal: false,
            sarSignal: false,
            ichimokuSignal: false,
            
            // Chỉ báo mới (10 chỉ báo)
            macdHistogramSignal: false,
            atrpSignal: false,
            rocSignal: false,
            obvSignal: false,
            adLineSignal: false,
            vptSignal: false,
            ultimateOscillatorSignal: false,
            adxrSignal: false,
            massIndexSignal: false,
            tsiSignal: false
        };
        
        let totalScore = 0;
        const maxScore = 100;
        
        // MACD Analysis (20 điểm)
        if (macd) {
            if (direction === 'LONG' && macd.bullish) {
                signals.macdSignal = true;
                totalScore += 20;
            } else if (direction === 'SHORT' && macd.bearish) {
                signals.macdSignal = true;
                totalScore += 20;
            } else if (direction === 'LONG' && macd.macd > macd.signal) {
                totalScore += 10;
            } else if (direction === 'SHORT' && macd.macd < macd.signal) {
                totalScore += 10;
            }
        }
        
        // Stochastic Analysis (15 điểm)
        if (stochastic) {
            if (direction === 'LONG' && stochastic.bullishCrossover && stochastic.k < 80) {
                signals.stochasticSignal = true;
                totalScore += 15;
            } else if (direction === 'SHORT' && stochastic.bearishCrossover && stochastic.k > 20) {
                signals.stochasticSignal = true;
                totalScore += 15;
            } else if (direction === 'LONG' && stochastic.k < 50) {
                totalScore += 8;
            } else if (direction === 'SHORT' && stochastic.k > 50) {
                totalScore += 8;
            }
        }
        
        // Williams %R Analysis (10 điểm)
        if (williamsR) {
            if (direction === 'LONG' && williamsR.bullish) {
                signals.williamsSignal = true;
                totalScore += 10;
            } else if (direction === 'SHORT' && williamsR.bearish) {
                signals.williamsSignal = true;
                totalScore += 10;
            } else if (direction === 'LONG' && williamsR.oversold) {
                totalScore += 5;
            } else if (direction === 'SHORT' && williamsR.overbought) {
                totalScore += 5;
            }
        }
        
        // MFI Analysis (15 điểm)
        if (mfi) {
            if (direction === 'LONG' && mfi.bullish) {
                signals.mfiSignal = true;
                totalScore += 15;
            } else if (direction === 'SHORT' && mfi.bearish) {
                signals.mfiSignal = true;
                totalScore += 15;
            } else if (direction === 'LONG' && mfi.value < 50) {
                totalScore += 8;
            } else if (direction === 'SHORT' && mfi.value > 50) {
                totalScore += 8;
            }
        }
        
        // CCI Analysis (15 điểm)
        if (cci) {
            if (direction === 'LONG' && cci.bullish) {
                signals.cciSignal = true;
                totalScore += 15;
            } else if (direction === 'SHORT' && cci.bearish) {
                signals.cciSignal = true;
                totalScore += 15;
            } else if (direction === 'LONG' && cci.value > 0) {
                totalScore += 8;
            } else if (direction === 'SHORT' && cci.value < 0) {
                totalScore += 8;
            }
        }
        
        // Parabolic SAR Analysis (10 điểm)
        if (sar) {
            if (direction === 'LONG' && sar.bullish) {
                signals.sarSignal = true;
                totalScore += 10;
            } else if (direction === 'SHORT' && sar.bearish) {
                signals.sarSignal = true;
                totalScore += 10;
            }
        }
        
        // Ichimoku Analysis (15 điểm)
        if (ichimoku) {
            if (direction === 'LONG' && ichimoku.bullish) {
                signals.ichimokuSignal = true;
                totalScore += 15;
            } else if (direction === 'SHORT' && ichimoku.bearish) {
                signals.ichimokuSignal = true;
                totalScore += 15;
            } else if (direction === 'LONG' && ichimoku.isAboveCloud) {
                totalScore += 8;
            } else if (direction === 'SHORT' && ichimoku.isBelowCloud) {
                totalScore += 8;
            }
        }
        
        // ============== PHÂN TÍCH CÁC CHỈ BÁO MỚI (10 chỉ báo) ==============
        
        // MACD Histogram Analysis (8 điểm)
        if (macdHistogram) {
            if (direction === 'LONG' && macdHistogram.bullish) {
                signals.macdHistogramSignal = true;
                totalScore += 8;
            } else if (direction === 'SHORT' && macdHistogram.bearish) {
                signals.macdHistogramSignal = true;
                totalScore += 8;
            }
        }
        
        // ATRP Analysis (6 điểm)
        if (atrp) {
            if (!atrp.highVolatility) { // Tránh volatility cao
                signals.atrpSignal = true;
                totalScore += 6;
            }
        }
        
        // ROC Analysis (8 điểm)
        if (roc) {
            if (direction === 'LONG' && roc.bullish) {
                signals.rocSignal = true;
                totalScore += 8;
            } else if (direction === 'SHORT' && roc.bearish) {
                signals.rocSignal = true;
                totalScore += 8;
            } else if (direction === 'LONG' && roc.strongBullish) {
                totalScore += 4;
            } else if (direction === 'SHORT' && roc.strongBearish) {
                totalScore += 4;
            }
        }
        
        // OBV Analysis (7 điểm)
        if (obv) {
            if (direction === 'LONG' && obv.bullish) {
                signals.obvSignal = true;
                totalScore += 7;
            } else if (direction === 'SHORT' && obv.bearish) {
                signals.obvSignal = true;
                totalScore += 7;
            }
        }
        
        // A/D Line Analysis (6 điểm)
        if (adLine) {
            if (direction === 'LONG' && adLine.bullish) {
                signals.adLineSignal = true;
                totalScore += 6;
            } else if (direction === 'SHORT' && adLine.bearish) {
                signals.adLineSignal = true;
                totalScore += 6;
            }
        }
        
        // VPT Analysis (7 điểm)
        if (vpt) {
            if (direction === 'LONG' && vpt.bullish) {
                signals.vptSignal = true;
                totalScore += 7;
            } else if (direction === 'SHORT' && vpt.bearish) {
                signals.vptSignal = true;
                totalScore += 7;
            }
        }
        
        // Ultimate Oscillator Analysis (8 điểm)
        if (ultimateOscillator) {
            if (direction === 'LONG' && ultimateOscillator.bullish) {
                signals.ultimateOscillatorSignal = true;
                totalScore += 8;
            } else if (direction === 'SHORT' && ultimateOscillator.bearish) {
                signals.ultimateOscillatorSignal = true;
                totalScore += 8;
            }
        }
        
        // ADXR Analysis (6 điểm)
        if (adxr) {
            if (adxr.strong) {
                signals.adxrSignal = true;
                totalScore += 6;
            }
        }
        
        // Mass Index Analysis (5 điểm)
        if (massIndex) {
            if (massIndex.continuation) {
                signals.massIndexSignal = true;
                totalScore += 5;
            }
        }
        
        // TSI Analysis (9 điểm)
        if (tsi) {
            if (direction === 'LONG' && tsi.bullish) {
                signals.tsiSignal = true;
                totalScore += 9;
            } else if (direction === 'SHORT' && tsi.bearish) {
                signals.tsiSignal = true;
                totalScore += 9;
            } else if (direction === 'LONG' && tsi.strongBullish) {
                totalScore += 5;
            } else if (direction === 'SHORT' && tsi.strongBearish) {
                totalScore += 5;
            }
        }
        
        const finalScore = Math.round((totalScore / maxScore) * 100);
        const signalCount = Object.values(signals).filter(Boolean).length;
        
        return {
            score: finalScore,
            signalCount,
            signals,
            details: {
                // Chỉ báo cũ
                macd,
                stochastic,
                williamsR,
                mfi,
                cci,
                sar,
                ichimoku,
                
                // Chỉ báo mới
                macdHistogram,
                atrp,
                roc,
                obv,
                adLine,
                vpt,
                ultimateOscillator,
                adxr,
                massIndex,
                tsi
            }
        };
        
    } catch (error) {
        console.error(`Lỗi phân tích chỉ báo nâng cao cho ${symbol}:`, error);
        return { score: 0, signals: {}, details: {} };
    }
}

/**
 * Hệ thống cảnh báo rủi ro và điểm thoát lệnh
 */
export async function analyzeRiskAndExitPoints(symbol, direction, entryPrice, stopLoss) {
    try {
        const candles = await getCandles(symbol, "1H", 50);
        if (!candles || candles.length < 20) {
            return { riskLevel: "UNKNOWN", exitRecommendation: "HOLD" };
        }
        
        const currentPrice = await getCurrentPrice(symbol);
        if (!currentPrice) {
            return { riskLevel: "UNKNOWN", exitRecommendation: "HOLD" };
        }
        
        // Tính toán các chỉ báo rủi ro
        const rsi = calcRSI(candles, 14);
        const atr = calcATR(candles, 14);
        const macd = calcMACD(candles);
        const stochastic = calcStochastic(candles);
        const williamsR = calcWilliamsR(candles);
        
        // Phân tích rủi ro
        let riskScore = 0;
        let riskFactors = [];
        
        // RSI quá cao/thấp
        if (direction === 'LONG' && rsi > 80) {
            riskScore += 30;
            riskFactors.push("RSI quá cao");
        } else if (direction === 'SHORT' && rsi < 20) {
            riskScore += 30;
            riskFactors.push("RSI quá thấp");
        }
        
        // Stochastic quá cao/thấp
        if (stochastic) {
            if (direction === 'LONG' && stochastic.k > 85) {
                riskScore += 25;
                riskFactors.push("Stochastic quá cao");
            } else if (direction === 'SHORT' && stochastic.k < 15) {
                riskScore += 25;
                riskFactors.push("Stochastic quá thấp");
            }
        }
        
        // Williams %R quá cao/thấp
        if (williamsR) {
            if (direction === 'LONG' && williamsR.value > -10) {
                riskScore += 20;
                riskFactors.push("Williams %R quá cao");
            } else if (direction === 'SHORT' && williamsR.value < -90) {
                riskScore += 20;
                riskFactors.push("Williams %R quá thấp");
            }
        }
        
        // MACD divergence
        if (macd) {
            if (direction === 'LONG' && macd.bearish) {
                riskScore += 25;
                riskFactors.push("MACD bearish");
            } else if (direction === 'SHORT' && macd.bullish) {
                riskScore += 25;
                riskFactors.push("MACD bullish");
            }
        }
        
        // Khoảng cách đến SL
        const distanceToSL = Math.abs(currentPrice - stopLoss) / currentPrice;
        if (distanceToSL < 0.02) { // < 2%
            riskScore += 40;
            riskFactors.push("Gần Stop Loss");
        } else if (distanceToSL < 0.05) { // < 5%
            riskScore += 20;
            riskFactors.push("Khá gần Stop Loss");
        }
        
        // Biến động cao
        const volatility = atr / currentPrice;
        if (volatility > 0.05) {
            riskScore += 15;
            riskFactors.push("Biến động cao");
        }
        
        // Xác định mức rủi ro
        let riskLevel = "LOW";
        let exitRecommendation = "HOLD";
        
        if (riskScore >= 70) {
            riskLevel = "HIGH";
            exitRecommendation = "EXIT_NOW";
        } else if (riskScore >= 50) {
            riskLevel = "MEDIUM";
            exitRecommendation = "CONSIDER_EXIT";
        } else if (riskScore >= 30) {
            riskLevel = "LOW";
            exitRecommendation = "WATCH_CLOSELY";
        } else {
            riskLevel = "VERY_LOW";
            exitRecommendation = "HOLD";
        }
        
        // Tính điểm thoát tối ưu
        let optimalExitPrice = null;
        if (direction === 'LONG') {
            // Tìm điểm thoát dựa trên resistance levels
            const highs = candles.slice(-20).map(c => c.high);
            const resistanceLevel = Math.max(...highs);
            if (resistanceLevel > currentPrice && resistanceLevel < entryPrice * 1.1) {
                optimalExitPrice = resistanceLevel * 0.98; // 2% dưới resistance
            }
        } else {
            // Tìm điểm thoát dựa trên support levels
            const lows = candles.slice(-20).map(c => c.low);
            const supportLevel = Math.min(...lows);
            if (supportLevel < currentPrice && supportLevel > entryPrice * 0.9) {
                optimalExitPrice = supportLevel * 1.02; // 2% trên support
            }
        }
        
        return {
            riskLevel,
            riskScore: Math.min(riskScore, 100),
            riskFactors,
            exitRecommendation,
            optimalExitPrice,
            currentPrice,
            distanceToSL: (distanceToSL * 100).toFixed(2) + "%",
            volatility: (volatility * 100).toFixed(2) + "%",
            rsi: rsi.toFixed(1),
            atr: atr.toFixed(4)
        };
        
    } catch (error) {
        console.error(`Lỗi phân tích rủi ro cho ${symbol}:`, error);
        return { riskLevel: "UNKNOWN", exitRecommendation: "HOLD" };
    }
}

/**
 * Tạo báo cáo cảnh báo rủi ro
 */
export function generateRiskReport(riskAnalysis) {
    if (!riskAnalysis || riskAnalysis.riskLevel === "UNKNOWN") {
        return "Không thể phân tích rủi ro.";
    }
    
    const { riskLevel, riskScore, riskFactors, exitRecommendation, optimalExitPrice, currentPrice, distanceToSL, volatility, rsi } = riskAnalysis;
    
    let report = `🚨 *CẢNH BÁO RỦI RO*\n\n`;
    
    // Mức rủi ro
    let riskIcon = "🟢";
    if (riskLevel === "HIGH") riskIcon = "🔴";
    else if (riskLevel === "MEDIUM") riskIcon = "🟡";
    else if (riskLevel === "LOW") riskIcon = "🟠";
    
    report += `${riskIcon} *Mức rủi ro:* ${riskLevel} (${riskScore}/100)\n`;
    report += `💰 *Giá hiện tại:* ${currentPrice.toFixed(4)}\n`;
    report += `📏 *Khoảng cách SL:* ${distanceToSL}\n`;
    report += `📊 *Biến động:* ${volatility}\n`;
    report += `📈 *RSI:* ${rsi}\n\n`;
    
    // Các yếu tố rủi ro
    if (riskFactors.length > 0) {
        report += `⚠️ *Các yếu tố rủi ro:*\n`;
        riskFactors.forEach(factor => {
            report += `• ${factor}\n`;
        });
        report += `\n`;
    }
    
    // Khuyến nghị thoát lệnh
    let exitIcon = "✅";
    let exitText = "";
    
    switch (exitRecommendation) {
        case "EXIT_NOW":
            exitIcon = "🚨";
            exitText = "THOÁT LỆNH NGAY LẬP TỨC";
            break;
        case "CONSIDER_EXIT":
            exitIcon = "⚠️";
            exitText = "CÂN NHẮC THOÁT LỆNH";
            break;
        case "WATCH_CLOSELY":
            exitIcon = "👀";
            exitText = "THEO DÕI CHẶT CHẼ";
            break;
        default:
            exitIcon = "✅";
            exitText = "GIỮ LỆNH";
    }
    
    report += `${exitIcon} *Khuyến nghị:* ${exitText}\n`;
    
    if (optimalExitPrice) {
        report += `🎯 *Điểm thoát tối ưu:* ${optimalExitPrice.toFixed(4)}\n`;
    }
    
    return report;
}

/**
 * Tạo báo cáo chỉ báo nâng cao
 */
export function generateAdvancedIndicatorReport(analysis) {
    if (!analysis || !analysis.details) {
        return "Không có dữ liệu chỉ báo nâng cao.";
    }
    
    const { score, signalCount, signals, details } = analysis;
    
    let report = `🔥 *BÁO CÁO CHỈ BÁO NÂNG CAO*\n\n`;
    report += `🎯 *Điểm tổng thể:* ${score}/100\n`;
    report += `📊 *Chỉ báo đồng thuận:* ${signalCount}/17\n\n`;
    
    // Chi tiết từng chỉ báo
    report += `📈 *Chi tiết chỉ báo:*\n`;
    
    // MACD
    if (details.macd) {
        const icon = signals.macdSignal ? '✅' : '❌';
        report += `${icon} *MACD:* ${details.macd.macd.toFixed(4)} | Signal: ${details.macd.signal.toFixed(4)}\n`;
        report += `   Histogram: ${details.macd.histogram.toFixed(4)}\n`;
    }
    
    // Stochastic
    if (details.stochastic) {
        const icon = signals.stochasticSignal ? '✅' : '❌';
        report += `${icon} *Stochastic:* K=${details.stochastic.k.toFixed(2)}, D=${details.stochastic.d.toFixed(2)}\n`;
    }
    
    // Williams %R
    if (details.williamsR) {
        const icon = signals.williamsSignal ? '✅' : '❌';
        report += `${icon} *Williams %R:* ${details.williamsR.value.toFixed(2)}\n`;
    }
    
    // MFI
    if (details.mfi) {
        const icon = signals.mfiSignal ? '✅' : '❌';
        report += `${icon} *MFI:* ${details.mfi.value.toFixed(2)}\n`;
    }
    
    // CCI
    if (details.cci) {
        const icon = signals.cciSignal ? '✅' : '❌';
        report += `${icon} *CCI:* ${details.cci.value.toFixed(2)}\n`;
    }
    
    // Parabolic SAR
    if (details.sar) {
        const icon = signals.sarSignal ? '✅' : '❌';
        const trendText = details.sar.trend === 1 ? 'Tăng' : 'Giảm';
        report += `${icon} *Parabolic SAR:* ${details.sar.value.toFixed(4)} (${trendText})\n`;
    }
    
    // Ichimoku
    if (details.ichimoku) {
        const icon = signals.ichimokuSignal ? '✅' : '❌';
        report += `${icon} *Ichimoku:* Tenkan=${details.ichimoku.tenkan.toFixed(4)}\n`;
        report += `   Cloud: ${details.ichimoku.cloudBottom.toFixed(4)} - ${details.ichimoku.cloudTop.toFixed(4)}\n`;
        report += `   Position: ${details.ichimoku.isAboveCloud ? 'Trên Cloud' : details.ichimoku.isBelowCloud ? 'Dưới Cloud' : 'Trong Cloud'}\n`;
    }
    
    // ============== CHỈ BÁO MỚI (10 chỉ báo) ==============
    
    // MACD Histogram
    if (details.macdHistogram) {
        const icon = signals.macdHistogramSignal ? '✅' : '❌';
        report += `${icon} *MACD Histogram:* ${details.macdHistogram.histogram.toFixed(4)}\n`;
    }
    
    // ATRP
    if (details.atrp) {
        const icon = signals.atrpSignal ? '✅' : '❌';
        report += `${icon} *ATRP:* ${details.atrp.value.toFixed(2)}% (Volatility)\n`;
    }
    
    // ROC
    if (details.roc) {
        const icon = signals.rocSignal ? '✅' : '❌';
        report += `${icon} *ROC:* ${details.roc.value.toFixed(2)}%\n`;
    }
    
    // OBV
    if (details.obv) {
        const icon = signals.obvSignal ? '✅' : '❌';
        report += `${icon} *OBV:* ${details.obv.value.toFixed(0)}\n`;
    }
    
    // A/D Line
    if (details.adLine) {
        const icon = signals.adLineSignal ? '✅' : '❌';
        report += `${icon} *A/D Line:* ${details.adLine.value.toFixed(0)}\n`;
    }
    
    // VPT
    if (details.vpt) {
        const icon = signals.vptSignal ? '✅' : '❌';
        report += `${icon} *VPT:* ${details.vpt.value.toFixed(0)}\n`;
    }
    
    // Ultimate Oscillator
    if (details.ultimateOscillator) {
        const icon = signals.ultimateOscillatorSignal ? '✅' : '❌';
        report += `${icon} *Ultimate Oscillator:* ${details.ultimateOscillator.value.toFixed(2)}\n`;
    }
    
    // ADXR
    if (details.adxr) {
        const icon = signals.adxrSignal ? '✅' : '❌';
        report += `${icon} *ADXR:* ${details.adxr.value.toFixed(2)}\n`;
    }
    
    // Mass Index
    if (details.massIndex) {
        const icon = signals.massIndexSignal ? '✅' : '❌';
        report += `${icon} *Mass Index:* ${details.massIndex.value.toFixed(2)}\n`;
    }
    
    // TSI
    if (details.tsi) {
        const icon = signals.tsiSignal ? '✅' : '❌';
        report += `${icon} *TSI:* ${details.tsi.value.toFixed(2)}\n`;
    }
    
    // Đánh giá tổng thể
    report += `\n🎯 *Đánh giá tổng thể:*\n`;
    if (signalCount >= 12) {
        report += `🔥 TÍN HIỆU RẤT MẠNH - Nhiều chỉ báo đồng thuận\n`;
    } else if (signalCount >= 8) {
        report += `⚠️ Tín hiệu TRUNG BÌNH - Một số chỉ báo đồng thuận\n`;
    } else {
        report += `❌ Tín hiệu YẾU - Ít chỉ báo đồng thuận\n`;
    }
    
    return report;
}

// ============== 10 CHỈ BÁO NÂNG CAO MỚI ==============

/**
 * MACD Histogram với phân tích momentum
 */
export function calcMACDHistogram(candles, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
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
    
    const currentHistogram = histogram.at(-1);
    const prevHistogram = histogram.at(-2);
    const prev2Histogram = histogram.at(-3);
    
    return {
        histogram: currentHistogram,
        prevHistogram: prevHistogram,
        prev2Histogram: prev2Histogram,
        bullish: currentHistogram > prevHistogram && prevHistogram > prev2Histogram,
        bearish: currentHistogram < prevHistogram && prevHistogram < prev2Histogram,
        strength: Math.abs(currentHistogram)
    };
}

/**
 * Average True Range Percentage (ATRP)
 */
export function calcATRP(candles, period = 14) {
    if (candles.length < period + 1) return null;
    
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
        const h = candles[i].high;
        const l = candles[i].low;
        const pc = candles[i - 1].close;
        const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
        trs.push(tr);
    }
    
    const atr = trs.slice(-period).reduce((a, b) => a + b, 0) / period;
    const currentPrice = candles.at(-1).close;
    const atrp = (atr / currentPrice) * 100;
    
    return {
        value: atrp,
        highVolatility: atrp > 3,
        lowVolatility: atrp < 1,
        strength: Math.min(atrp / 5, 1) * 100
    };
}

/**
 * Rate of Change (ROC)
 */
export function calcROC(candles, period = 12) {
    if (candles.length < period + 1) return null;
    
    const currentPrice = candles.at(-1).close;
    const pastPrice = candles.at(-period - 1).close;
    const roc = ((currentPrice - pastPrice) / pastPrice) * 100;
    
    return {
        value: roc,
        bullish: roc > 5,
        bearish: roc < -5,
        strongBullish: roc > 10,
        strongBearish: roc < -10,
        strength: Math.abs(roc) / 10
    };
}

/**
 * On-Balance Volume (OBV)
 */
export function calcOBV(candles) {
    if (candles.length < 2) return null;
    
    let obv = 0;
    const obvValues = [];
    
    for (let i = 1; i < candles.length; i++) {
        const currentClose = candles[i].close;
        const prevClose = candles[i - 1].close;
        const volume = candles[i].volume || 0;
        
        if (currentClose > prevClose) {
            obv += volume;
        } else if (currentClose < prevClose) {
            obv -= volume;
        }
        
        obvValues.push(obv);
    }
    
    const currentOBV = obvValues.at(-1);
    const prevOBV = obvValues.at(-2);
    const prev2OBV = obvValues.at(-3);
    
    return {
        value: currentOBV,
        bullish: currentOBV > prevOBV && prevOBV > prev2OBV,
        bearish: currentOBV < prevOBV && prevOBV < prev2OBV,
        divergence: (candles.at(-1).close > candles.at(-2).close && currentOBV < prevOBV) ||
                   (candles.at(-1).close < candles.at(-2).close && currentOBV > prevOBV)
    };
}

/**
 * Accumulation/Distribution Line (A/D)
 */
export function calcADLine(candles) {
    if (candles.length < 2) return null;
    
    let ad = 0;
    const adValues = [];
    
    for (let i = 0; i < candles.length; i++) {
        const candle = candles[i];
        const high = candle.high;
        const low = candle.low;
        const close = candle.close;
        const volume = candle.volume || 0;
        
        if (high !== low) {
            const mfm = ((close - low) - (high - close)) / (high - low);
            ad += mfm * volume;
        }
        
        adValues.push(ad);
    }
    
    const currentAD = adValues.at(-1);
    const prevAD = adValues.at(-2);
    const prev2AD = adValues.at(-3);
    
    return {
        value: currentAD,
        bullish: currentAD > prevAD && prevAD > prev2AD,
        bearish: currentAD < prevAD && prevAD < prev2AD,
        strength: Math.abs(currentAD - prevAD) / Math.abs(prevAD || 1)
    };
}

/**
 * Volume Price Trend (VPT)
 */
export function calcVPT(candles) {
    if (candles.length < 2) return null;
    
    let vpt = 0;
    const vptValues = [];
    
    for (let i = 1; i < candles.length; i++) {
        const currentClose = candles[i].close;
        const prevClose = candles[i - 1].close;
        const volume = candles[i].volume || 0;
        
        const priceChange = (currentClose - prevClose) / prevClose;
        vpt += volume * priceChange;
        
        vptValues.push(vpt);
    }
    
    const currentVPT = vptValues.at(-1);
    const prevVPT = vptValues.at(-2);
    
    return {
        value: currentVPT,
        bullish: currentVPT > prevVPT,
        bearish: currentVPT < prevVPT,
        strength: Math.abs(currentVPT - prevVPT) / Math.abs(prevVPT || 1)
    };
}

/**
 * Ultimate Oscillator
 */
export function calcUltimateOscillator(candles, period1 = 7, period2 = 14, period3 = 28) {
    if (candles.length < period3) return null;
    
    const bp = []; // Buying Pressure
    const tr = []; // True Range
    
    for (let i = 1; i < candles.length; i++) {
        const current = candles[i];
        const previous = candles[i - 1];
        
        const bpValue = current.close - Math.min(current.low, previous.close);
        const trValue = Math.max(
            current.high - current.low,
            Math.abs(current.high - previous.close),
            Math.abs(current.low - previous.close)
        );
        
        bp.push(bpValue);
        tr.push(trValue);
    }
    
    const avg1 = bp.slice(-period1).reduce((a, b) => a + b, 0) / period1;
    const avg2 = bp.slice(-period2).reduce((a, b) => a + b, 0) / period2;
    const avg3 = bp.slice(-period3).reduce((a, b) => a + b, 0) / period3;
    
    const tr1 = tr.slice(-period1).reduce((a, b) => a + b, 0);
    const tr2 = tr.slice(-period2).reduce((a, b) => a + b, 0);
    const tr3 = tr.slice(-period3).reduce((a, b) => a + b, 0);
    
    const uo = 100 * ((4 * avg1 / tr1) + (2 * avg2 / tr2) + (avg3 / tr3)) / 7;
    
    return {
        value: uo,
        oversold: uo < 30,
        overbought: uo > 70,
        bullish: uo > 50 && uo < 70,
        bearish: uo < 50 && uo > 30
    };
}

/**
 * Average Directional Movement Index Rating (ADXR)
 */
export function calcADXR(candles, period = 14) {
    if (candles.length < period * 3) return null;
    
    const adx = calcADX(candles, period);
    const adxValues = [];
    
    // Simplified ADX calculation for ADXR
    for (let i = period; i < candles.length; i++) {
        const slice = candles.slice(i - period, i);
        const adxValue = calcADX(slice, period);
        adxValues.push(adxValue.adx);
    }
    
    const currentADX = adxValues.at(-1);
    const prevADX = adxValues.at(-2);
    const adxr = (currentADX + prevADX) / 2;
    
    return {
        value: adxr,
        strong: adxr > 25,
        weak: adxr < 20,
        strength: Math.min(adxr / 30, 1) * 100
    };
}

/**
 * Mass Index
 */
export function calcMassIndex(candles, period = 25) {
    if (candles.length < period + 1) return null;
    
    const ema9 = calcEMA(candles.map(c => c.high - c.low), 9);
    const ema9OfEMA9 = calcEMA(ema9, 9);
    
    const massIndex = [];
    for (let i = 0; i < ema9OfEMA9.length; i++) {
        if (ema9OfEMA9[i] !== 0) {
            massIndex.push(ema9[i] / ema9OfEMA9[i]);
        }
    }
    
    const currentMI = massIndex.at(-1);
    const sumMI = massIndex.slice(-period).reduce((a, b) => a + b, 0);
    
    return {
        value: sumMI,
        reversal: sumMI > 27,
        continuation: sumMI < 26.5,
        strength: Math.min(sumMI / 30, 1) * 100
    };
}

/**
 * True Strength Index (TSI)
 */
export function calcTSI(candles, longPeriod = 25, shortPeriod = 13) {
    if (candles.length < longPeriod + shortPeriod) return null;
    
    const priceChanges = [];
    for (let i = 1; i < candles.length; i++) {
        priceChanges.push(candles[i].close - candles[i - 1].close);
    }
    
    const smoothedPC = calcEMA(priceChanges, longPeriod);
    const doubleSmoothedPC = calcEMA(smoothedPC, shortPeriod);
    
    const absPriceChanges = priceChanges.map(pc => Math.abs(pc));
    const smoothedAPC = calcEMA(absPriceChanges, longPeriod);
    const doubleSmoothedAPC = calcEMA(smoothedAPC, shortPeriod);
    
    const tsi = (doubleSmoothedPC.at(-1) / doubleSmoothedAPC.at(-1)) * 100;
    
    return {
        value: tsi,
        bullish: tsi > 25,
        bearish: tsi < -25,
        strongBullish: tsi > 50,
        strongBearish: tsi < -50,
        strength: Math.abs(tsi) / 50
    };
}
// advancedIndicators.js - Hệ thống chỉ báo nâng cao và kết hợp
import { getCandles } from "./okx.js";

/**
 * MACD (Moving Average Convergence Divergence) với Histogram
 */
export function calcMACD(candles, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (candles.length < slowPeriod + signalPeriod) {
        return { macd: 0, signal: 0, histogram: 0, bullish: false, bearish: false };
    }

    const closes = candles.map(c => c.close);
    
    // Tính EMA
    const calcEMA = (values, period) => {
        const k = 2 / (period + 1);
        return values.reduce((acc, price, i) => {
            if (i === 0) return [price];
            const ema = price * k + acc[i - 1] * (1 - k);
            acc.push(ema);
            return acc;
        }, []);
    };

    const emaFast = calcEMA(closes, fastPeriod);
    const emaSlow = calcEMA(closes, slowPeriod);
    
    // Tính MACD line
    const macdLine = [];
    for (let i = slowPeriod - 1; i < closes.length; i++) {
        macdLine.push(emaFast[i] - emaSlow[i]);
    }
    
    // Tính Signal line
    const signalLine = calcEMA(macdLine, signalPeriod);
    
    const macd = macdLine.at(-1);
    const signal = signalLine.at(-1);
    const histogram = macd - signal;
    
    // Xác định tín hiệu
    const prevMacd = macdLine.at(-2);
    const prevSignal = signalLine.at(-2);
    
    const bullish = macd > signal && prevMacd <= prevSignal; // Bullish crossover
    const bearish = macd < signal && prevMacd >= prevSignal; // Bearish crossover
    
    return {
        macd: macd || 0,
        signal: signal || 0,
        histogram: histogram || 0,
        bullish,
        bearish,
        strength: Math.abs(histogram) // Độ mạnh của histogram
    };
}

/**
 * Stochastic Oscillator
 */
export function calcStochastic(candles, kPeriod = 14, dPeriod = 3) {
    if (candles.length < kPeriod) {
        return { k: 50, d: 50, oversold: false, overbought: false };
    }

    const recentCandles = candles.slice(-kPeriod);
    const currentClose = candles.at(-1).close;
    
    const highestHigh = Math.max(...recentCandles.map(c => c.high));
    const lowestLow = Math.min(...recentCandles.map(c => c.low));
    
    const k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
    
    // Tính %D (SMA của %K)
    const kValues = [];
    for (let i = kPeriod - 1; i < candles.length; i++) {
        const periodCandles = candles.slice(i - kPeriod + 1, i + 1);
        const hh = Math.max(...periodCandles.map(c => c.high));
        const ll = Math.min(...periodCandles.map(c => c.low));
        const cc = candles[i].close;
        kValues.push(((cc - ll) / (hh - ll)) * 100);
    }
    
    const d = kValues.slice(-dPeriod).reduce((a, b) => a + b, 0) / dPeriod;
    
    return {
        k: k || 50,
        d: d || 50,
        oversold: k < 20,
        overbought: k > 80,
        bullishDivergence: k > d && kValues.at(-2) <= kValues.at(-3), // Bullish crossover
        bearishDivergence: k < d && kValues.at(-2) >= kValues.at(-3)  // Bearish crossover
    };
}

/**
 * Williams %R
 */
export function calcWilliamsR(candles, period = 14) {
    if (candles.length < period) {
        return { williamsR: -50, oversold: false, overbought: false };
    }

    const recentCandles = candles.slice(-period);
    const currentClose = candles.at(-1).close;
    
    const highestHigh = Math.max(...recentCandles.map(c => c.high));
    const lowestLow = Math.min(...recentCandles.map(c => c.low));
    
    const williamsR = ((highestHigh - currentClose) / (highestHigh - lowestLow)) * -100;
    
    return {
        williamsR: williamsR || -50,
        oversold: williamsR < -80,
        overbought: williamsR > -20,
        bullish: williamsR < -50 && williamsR > -80, // Trong vùng oversold nhưng không quá cực đoan
        bearish: williamsR > -50 && williamsR < -20  // Trong vùng overbought nhưng không quá cực đoan
    };
}

/**
 * Money Flow Index (MFI)
 */
export function calcMFI(candles, period = 14) {
    if (candles.length < period + 1) {
        return { mfi: 50, bullish: false, bearish: false };
    }

    let positiveFlow = 0;
    let negativeFlow = 0;
    
    for (let i = candles.length - period; i < candles.length; i++) {
        const current = candles[i];
        const previous = candles[i - 1];
        
        const typicalPrice = (current.high + current.low + current.close) / 3;
        const prevTypicalPrice = (previous.high + previous.low + previous.close) / 3;
        
        const moneyFlow = typicalPrice * current.volume;
        
        if (typicalPrice > prevTypicalPrice) {
            positiveFlow += moneyFlow;
        } else if (typicalPrice < prevTypicalPrice) {
            negativeFlow += moneyFlow;
        }
    }
    
    const mfi = 100 - (100 / (1 + positiveFlow / negativeFlow));
    
    return {
        mfi: mfi || 50,
        bullish: mfi < 20, // Oversold
        bearish: mfi > 80, // Overbought
        strength: Math.abs(mfi - 50) / 50 // Độ mạnh của tín hiệu
    };
}

/**
 * Commodity Channel Index (CCI)
 */
export function calcCCI(candles, period = 20) {
    if (candles.length < period) {
        return { cci: 0, bullish: false, bearish: false };
    }

    const recentCandles = candles.slice(-period);
    const typicalPrices = recentCandles.map(c => (c.high + c.low + c.close) / 3);
    
    const sma = typicalPrices.reduce((a, b) => a + b, 0) / period;
    const meanDeviation = typicalPrices.reduce((sum, tp) => sum + Math.abs(tp - sma), 0) / period;
    
    const currentTypicalPrice = typicalPrices.at(-1);
    const cci = (currentTypicalPrice - sma) / (0.015 * meanDeviation);
    
    return {
        cci: cci || 0,
        bullish: cci > 100, // Bullish breakout
        bearish: cci < -100, // Bearish breakout
        strength: Math.abs(cci) / 100, // Độ mạnh của breakout
        overbought: cci > 200,
        oversold: cci < -200
    };
}

/**
 * Parabolic SAR
 */
export function calcParabolicSAR(candles, acceleration = 0.02, maximum = 0.2) {
    if (candles.length < 2) {
        return { sar: 0, trend: 'NEUTRAL', bullish: false, bearish: false };
    }

    let sar = candles[0].low;
    let trend = 'BULLISH';
    let af = acceleration;
    let ep = candles[0].high;
    
    for (let i = 1; i < candles.length; i++) {
        const current = candles[i];
        
        if (trend === 'BULLISH') {
            sar = sar + af * (ep - sar);
            
            if (current.low <= sar) {
                trend = 'BEARISH';
                sar = ep;
                af = acceleration;
                ep = current.low;
            } else {
                if (current.high > ep) {
                    ep = current.high;
                    af = Math.min(af + acceleration, maximum);
                }
            }
        } else {
            sar = sar + af * (ep - sar);
            
            if (current.high >= sar) {
                trend = 'BULLISH';
                sar = ep;
                af = acceleration;
                ep = current.high;
            } else {
                if (current.low < ep) {
                    ep = current.low;
                    af = Math.min(af + acceleration, maximum);
                }
            }
        }
    }
    
    const currentPrice = candles.at(-1).close;
    const bullish = trend === 'BULLISH' && currentPrice > sar;
    const bearish = trend === 'BEARISH' && currentPrice < sar;
    
    return {
        sar: sar || 0,
        trend: trend || 'NEUTRAL',
        bullish,
        bearish,
        distance: Math.abs(currentPrice - sar) / currentPrice // Khoảng cách từ SAR
    };
}

/**
 * Ichimoku Cloud (Simplified)
 */
export function calcIchimoku(candles, tenkanPeriod = 9, kijunPeriod = 26, senkouSpanBPeriod = 52) {
    if (candles.length < senkouSpanBPeriod) {
        return { 
            tenkan: 0, kijun: 0, senkouSpanA: 0, senkouSpanB: 0, 
            chikou: 0, bullish: false, bearish: false 
        };
    }

    // Tenkan-sen (Conversion Line)
    const tenkanHigh = Math.max(...candles.slice(-tenkanPeriod).map(c => c.high));
    const tenkanLow = Math.min(...candles.slice(-tenkanPeriod).map(c => c.low));
    const tenkan = (tenkanHigh + tenkanLow) / 2;
    
    // Kijun-sen (Base Line)
    const kijunHigh = Math.max(...candles.slice(-kijunPeriod).map(c => c.high));
    const kijunLow = Math.min(...candles.slice(-kijunPeriod).map(c => c.low));
    const kijun = (kijunHigh + kijunLow) / 2;
    
    // Senkou Span A (Leading Span A)
    const senkouSpanA = (tenkan + kijun) / 2;
    
    // Senkou Span B (Leading Span B)
    const senkouSpanBHigh = Math.max(...candles.slice(-senkouSpanBPeriod).map(c => c.high));
    const senkouSpanBLow = Math.min(...candles.slice(-senkouSpanBPeriod).map(c => c.low));
    const senkouSpanB = (senkouSpanBHigh + senkouSpanBLow) / 2;
    
    // Chikou Span (Lagging Span)
    const chikou = candles.at(-26).close;
    
    const currentPrice = candles.at(-1).close;
    
    // Xác định tín hiệu
    const bullish = currentPrice > senkouSpanA && currentPrice > senkouSpanB && tenkan > kijun;
    const bearish = currentPrice < senkouSpanA && currentPrice < senkouSpanB && tenkan < kijun;
    
    return {
        tenkan: tenkan || 0,
        kijun: kijun || 0,
        senkouSpanA: senkouSpanA || 0,
        senkouSpanB: senkouSpanB || 0,
        chikou: chikou || 0,
        bullish,
        bearish,
        cloudThickness: Math.abs(senkouSpanA - senkouSpanB) / currentPrice // Độ dày của cloud
    };
}

/**
 * Hệ thống kết hợp tất cả chỉ báo để đánh giá chất lượng tín hiệu
 */
export async function analyzeAdvancedIndicators(symbol, signalDirection) {
    try {
        const candles = await getCandles(symbol, '1H', 100);
        if (candles.length < 50) {
            return { score: 0, details: {} };
        }

        // Tính tất cả chỉ báo
        const macd = calcMACD(candles);
        const stochastic = calcStochastic(candles);
        const williamsR = calcWilliamsR(candles);
        const mfi = calcMFI(candles);
        const cci = calcCCI(candles);
        const parabolicSAR = calcParabolicSAR(candles);
        const ichimoku = calcIchimoku(candles);

        // Đánh giá từng chỉ báo theo hướng tín hiệu
        let totalScore = 0;
        let maxScore = 0;
        const details = {};

        // MACD Analysis (20 điểm)
        maxScore += 20;
        if (signalDirection === 'LONG') {
            if (macd.bullish) totalScore += 20;
            else if (macd.macd > macd.signal) totalScore += 10;
            else if (macd.histogram > 0) totalScore += 5;
        } else if (signalDirection === 'SHORT') {
            if (macd.bearish) totalScore += 20;
            else if (macd.macd < macd.signal) totalScore += 10;
            else if (macd.histogram < 0) totalScore += 5;
        }
        details.macd = { score: totalScore, ...macd };

        // Stochastic Analysis (15 điểm)
        maxScore += 15;
        if (signalDirection === 'LONG') {
            if (stochastic.oversold && stochastic.bullishDivergence) totalScore += 15;
            else if (stochastic.oversold) totalScore += 10;
            else if (stochastic.k < 50) totalScore += 5;
        } else if (signalDirection === 'SHORT') {
            if (stochastic.overbought && stochastic.bearishDivergence) totalScore += 15;
            else if (stochastic.overbought) totalScore += 10;
            else if (stochastic.k > 50) totalScore += 5;
        }
        details.stochastic = { score: totalScore - details.macd.score, ...stochastic };

        // Williams %R Analysis (10 điểm)
        maxScore += 10;
        if (signalDirection === 'LONG') {
            if (williamsR.oversold) totalScore += 10;
            else if (williamsR.bullish) totalScore += 5;
        } else if (signalDirection === 'SHORT') {
            if (williamsR.overbought) totalScore += 10;
            else if (williamsR.bearish) totalScore += 5;
        }
        details.williamsR = { score: totalScore - details.stochastic.score - details.macd.score, ...williamsR };

        // MFI Analysis (15 điểm)
        maxScore += 15;
        if (signalDirection === 'LONG') {
            if (mfi.bullish) totalScore += 15;
            else if (mfi.mfi < 50) totalScore += 8;
        } else if (signalDirection === 'SHORT') {
            if (mfi.bearish) totalScore += 15;
            else if (mfi.mfi > 50) totalScore += 8;
        }
        details.mfi = { score: totalScore - details.williamsR.score - details.stochastic.score - details.macd.score, ...mfi };

        // CCI Analysis (15 điểm)
        maxScore += 15;
        if (signalDirection === 'LONG') {
            if (cci.bullish) totalScore += 15;
            else if (cci.cci > 0) totalScore += 8;
        } else if (signalDirection === 'SHORT') {
            if (cci.bearish) totalScore += 15;
            else if (cci.cci < 0) totalScore += 8;
        }
        details.cci = { score: totalScore - details.mfi.score - details.williamsR.score - details.stochastic.score - details.macd.score, ...cci };

        // Parabolic SAR Analysis (10 điểm)
        maxScore += 10;
        if (signalDirection === 'LONG' && parabolicSAR.bullish) {
            totalScore += 10;
        } else if (signalDirection === 'SHORT' && parabolicSAR.bearish) {
            totalScore += 10;
        }
        details.parabolicSAR = { score: totalScore - details.cci.score - details.mfi.score - details.williamsR.score - details.stochastic.score - details.macd.score, ...parabolicSAR };

        // Ichimoku Analysis (15 điểm)
        maxScore += 15;
        if (signalDirection === 'LONG' && ichimoku.bullish) {
            totalScore += 15;
        } else if (signalDirection === 'SHORT' && ichimoku.bearish) {
            totalScore += 15;
        }
        details.ichimoku = { score: totalScore - details.parabolicSAR.score - details.cci.score - details.mfi.score - details.williamsR.score - details.stochastic.score - details.macd.score, ...ichimoku };

        const finalScore = Math.round((totalScore / maxScore) * 100);

        return {
            score: finalScore,
            totalScore,
            maxScore,
            details,
            summary: {
                macdSignal: macd.bullish || macd.bearish,
                stochasticSignal: stochastic.oversold || stochastic.overbought,
                williamsSignal: williamsR.oversold || williamsR.overbought,
                mfiSignal: mfi.bullish || mfi.bearish,
                cciSignal: cci.bullish || cci.bearish,
                sarSignal: parabolicSAR.bullish || parabolicSAR.bearish,
                ichimokuSignal: ichimoku.bullish || ichimoku.bearish
            }
        };

    } catch (error) {
        console.error(`Lỗi phân tích chỉ báo nâng cao cho ${symbol}:`, error);
        return { score: 0, details: {} };
    }
}

/**
 * Tạo báo cáo chi tiết về các chỉ báo
 */
export function generateAdvancedIndicatorReport(analysis) {
    if (!analysis || !analysis.details) {
        return "Không có dữ liệu phân tích chỉ báo.";
    }

    const { details, summary } = analysis;
    
    let report = `📊 *PHÂN TÍCH CHỈ BÁO NÂNG CAO*\n\n`;
    report += `🎯 *Điểm tổng thể:* ${analysis.score}/100\n\n`;
    
    report += `📈 *Chi tiết từng chỉ báo:*\n`;
    report += `• MACD: ${details.macd?.score || 0}/20 ${summary.macdSignal ? '✅' : '❌'}\n`;
    report += `• Stochastic: ${details.stochastic?.score || 0}/15 ${summary.stochasticSignal ? '✅' : '❌'}\n`;
    report += `• Williams %R: ${details.williamsR?.score || 0}/10 ${summary.williamsSignal ? '✅' : '❌'}\n`;
    report += `• MFI: ${details.mfi?.score || 0}/15 ${summary.mfiSignal ? '✅' : '❌'}\n`;
    report += `• CCI: ${details.cci?.score || 0}/15 ${summary.cciSignal ? '✅' : '❌'}\n`;
    report += `• Parabolic SAR: ${details.parabolicSAR?.score || 0}/10 ${summary.sarSignal ? '✅' : '❌'}\n`;
    report += `• Ichimoku: ${details.ichimoku?.score || 0}/15 ${summary.ichimokuSignal ? '✅' : '❌'}\n\n`;
    
    const signalCount = Object.values(summary).filter(Boolean).length;
    report += `🔥 *Tổng số chỉ báo đồng thuận:* ${signalCount}/7\n`;
    
    if (signalCount >= 5) {
        report += `✅ *Đánh giá:* Tín hiệu RẤT MẠNH - Nhiều chỉ báo đồng thuận\n`;
    } else if (signalCount >= 3) {
        report += `⚠️ *Đánh giá:* Tín hiệu TRUNG BÌNH - Một số chỉ báo đồng thuận\n`;
    } else {
        report += `❌ *Đánh giá:* Tín hiệu YẾU - Ít chỉ báo đồng thuận\n`;
    }
    
    return report;
}

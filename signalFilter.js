// signalFilter.js - Lọc và chấm điểm tín hiệu đơn giản
import { getCandles } from "./okx.js";
import { calcEMA, calcRSI, calcATR, calcBollingerBands, calcAvgVolume, calcADX } from "./indicators.js";

/**
 * Chấm điểm tín hiệu đơn giản
 */
export async function calculateSignalScore(signal, symbol) {
    if (!signal || signal.direction === "NONE") {
        return { totalScore: 0, details: {} };
    }

    try {
        const candles = await getCandles(symbol, '1H', 50);
        if (candles.length < 20) {
            return { totalScore: signal.confidence || 50, details: {} };
        }

        const adxScore = signal.adx >= 30 ? 100 : signal.adx >= 20 ? (signal.adx / 30) * 100 : 0;
        const structureScore = signal.confidence || 50;
        
        const totalScore = (adxScore * 0.3) + (structureScore * 0.7);

        return {
            totalScore: Math.round(totalScore),
            details: {
                adxScore: Math.round(adxScore),
                structureScore: Math.round(structureScore)
            }
        };
    } catch (error) {
        return { totalScore: signal.confidence || 50, details: {} };
    }
}

/**
 * Lọc tín hiệu chất lượng cao
 */
export async function filterHighQualitySignals(signals, minScore = 45) {
    const filteredSignals = [];
    
    for (const signal of signals) {
        if (!signal || signal.direction === "NONE") continue;
        
        const scoreResult = await calculateSignalScore(signal, signal.symbol);
        
        if (scoreResult.totalScore >= minScore) {
            signal.score = scoreResult.totalScore;
            signal.scoreDetails = scoreResult.details;
            filteredSignals.push(signal);
        }
    }
    
    return filteredSignals.sort((a, b) => b.score - a.score);
}

/**
 * Tạo báo cáo tín hiệu
 */
export async function generateSignalReport(signal) {
    if (!signal || !signal.scoreDetails) {
        return "Không có thông tin chi tiết.";
    }

    let report = `📊 *PHÂN TÍCH TÍN HIỆU*\n\n`;
    report += `🎯 *Điểm tổng thể:* ${signal.score}/100\n\n`;
    report += `📈 *Chi tiết:*\n`;
    report += `• ADX Score: ${signal.scoreDetails.adxScore}/100\n`;
    report += `• Structure Score: ${signal.scoreDetails.structureScore}/100\n`;

    return report;
}
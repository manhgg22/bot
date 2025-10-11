// signalFilter.js - Hệ thống lọc và chấm điểm tín hiệu chất lượng cao
import { getCandles, getCurrentPrice } from "./okx.js";
import { calcEMA, calcRSI, calcATR, calcBollingerBands, calcAvgVolume, calcADX } from "./indicators.js";
import { findSwingPoints, detectMomentum, findKeyLevels } from "./smc.js";
import { analyzeAdvancedIndicators, generateAdvancedIndicatorReport } from "./advancedIndicators.js";

/**
 * Hệ thống chấm điểm tín hiệu đa chiều
 * Mỗi tín hiệu sẽ được đánh giá qua nhiều tiêu chí để đảm bảo chất lượng cao
 */

// Cấu hình điểm số
const SCORE_CONFIG = {
    ADX_MIN: 20,           // ADX tối thiểu để có tín hiệu
    ADX_STRONG: 30,        // ADX mạnh
    RSI_OVERSOLD: 30,      // RSI oversold
    RSI_OVERBOUGHT: 70,    // RSI overbought
    VOLUME_MULTIPLIER: 1.5, // Volume phải cao hơn trung bình
    MOMENTUM_PERIOD: 10,    // Chu kỳ phân tích momentum
    STRUCTURE_PERIOD: 20    // Chu kỳ phân tích cấu trúc
};

/**
 * Phân tích cấu trúc thị trường để loại bỏ sideways market
 */
export async function analyzeMarketStructure(symbol) {
    try {
        const candles = await getCandles(symbol, '1H', 50);
        if (candles.length < SCORE_CONFIG.STRUCTURE_PERIOD) {
            return { trend: 'UNKNOWN', strength: 0 };
        }

        // Tính EMA để xác định xu hướng
        const closes = candles.map(c => c.close);
        const ema20 = calcEMA(closes, 20);
        const ema50 = calcEMA(closes, 50);
        
        const lastEma20 = ema20.at(-1);
        const lastEma50 = ema50.at(-1);
        const prevEma20 = ema20.at(-2);
        const prevEma50 = ema50.at(-2);

        // Phân tích swing points để xác định cấu trúc
        const swings = findSwingPoints(candles, 3);
        const recentSwings = swings.slice(-5); // 5 swing gần nhất
        
        let higherHighs = 0, lowerLows = 0;
        let higherLows = 0, lowerHighs = 0;

        for (let i = 1; i < recentSwings.length; i++) {
            const current = recentSwings[i];
            const previous = recentSwings[i - 1];
            
            if (current.type === 'SWING_HIGH' && previous.type === 'SWING_HIGH') {
                if (current.high > previous.high) higherHighs++;
                else lowerHighs++;
            }
            if (current.type === 'SWING_LOW' && previous.type === 'SWING_LOW') {
                if (current.low > previous.low) higherLows++;
                else lowerLows++;
            }
        }

        // Xác định xu hướng dựa trên cấu trúc
        let trend = 'SIDEWAYS';
        let strength = 0;

        if (higherHighs > lowerHighs && higherLows > lowerLows) {
            trend = 'BULLISH';
            strength = (higherHighs + higherLows) / (higherHighs + higherLows + lowerHighs + lowerLows);
        } else if (lowerHighs > higherHighs && lowerLows > higherLows) {
            trend = 'BEARISH';
            strength = (lowerHighs + lowerLows) / (higherHighs + higherLows + lowerHighs + lowerLows);
        }

        // Kiểm tra EMA alignment
        const emaAlignment = lastEma20 > lastEma50 ? 'BULLISH' : 'BEARISH';
        const emaSlope = (lastEma20 - prevEma20) > 0 ? 'RISING' : 'FALLING';

        return {
            trend,
            strength,
            emaAlignment,
            emaSlope,
            swingStructure: { higherHighs, lowerHighs, higherLows, lowerLows }
        };
    } catch (error) {
        console.error(`Lỗi phân tích cấu trúc thị trường cho ${symbol}:`, error);
        return { trend: 'UNKNOWN', strength: 0 };
    }
}

/**
 * Phân tích volume và momentum để xác nhận tín hiệu
 */
export async function analyzeVolumeAndMomentum(symbol) {
    try {
        const candles = await getCandles(symbol, '1H', 30);
        if (candles.length < 20) {
            return { volumeScore: 0, momentumScore: 0 };
        }

        // Phân tích volume
        const avgVolume = calcAvgVolume(candles, 20);
        const recentVolumes = candles.slice(-5).map(c => c.volume);
        const avgRecentVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
        
        const volumeRatio = avgRecentVolume / avgVolume;
        const volumeScore = Math.min(volumeRatio / SCORE_CONFIG.VOLUME_MULTIPLIER, 1) * 100;

        // Phân tích momentum
        const momentum = detectMomentum(candles, SCORE_CONFIG.MOMENTUM_PERIOD);
        const closes = candles.map(c => c.close);
        const rsi = calcRSI(candles, 14);
        
        let momentumScore = 0;
        if (momentum === 'BULLISH') {
            momentumScore = rsi < SCORE_CONFIG.RSI_OVERBOUGHT ? 80 : 40;
        } else if (momentum === 'BEARISH') {
            momentumScore = rsi > SCORE_CONFIG.RSI_OVERSOLD ? 80 : 40;
        }

        return {
            volumeScore,
            momentumScore,
            volumeRatio,
            momentum,
            rsi
        };
    } catch (error) {
        console.error(`Lỗi phân tích volume/momentum cho ${symbol}:`, error);
        return { volumeScore: 0, momentumScore: 0 };
    }
}

/**
 * Phân tích các mức hỗ trợ/kháng cự để tối ưu entry
 */
export async function analyzeKeyLevels(symbol) {
    try {
        const candles = await getCandles(symbol, '1H', 50);
        if (candles.length < 30) {
            return { supportResistanceScore: 0 };
        }

        const keyLevels = findKeyLevels(candles, 5);
        const currentPrice = candles.at(-1).close;
        
        // Tìm các mức gần giá hiện tại
        const nearbyLevels = keyLevels.filter(level => 
            Math.abs(level.price - currentPrice) / currentPrice < 0.02 // Trong vòng 2%
        );

        // Đếm số lần giá test các mức này
        let testCount = 0;
        for (const level of nearbyLevels) {
            for (let i = candles.length - 20; i < candles.length; i++) {
                const candle = candles[i];
                if (candle.low <= level.price && candle.high >= level.price) {
                    testCount++;
                }
            }
        }

        // Mức có nhiều test sẽ có điểm cao hơn
        const supportResistanceScore = Math.min(testCount * 20, 100);

        return {
            supportResistanceScore,
            nearbyLevels: nearbyLevels.length,
            testCount
        };
    } catch (error) {
        console.error(`Lỗi phân tích key levels cho ${symbol}:`, error);
        return { supportResistanceScore: 0 };
    }
}

/**
 * Hệ thống chấm điểm tổng thể cho tín hiệu (NÂNG CẤP với chỉ báo nâng cao)
 */
export async function calculateSignalScore(signal, symbol) {
    if (!signal || signal.direction === "NONE") {
        return { totalScore: 0, details: {} };
    }

    try {
        // Lấy các phân tích cần thiết (bao gồm chỉ báo nâng cao)
        const [marketStructure, volumeMomentum, keyLevels, advancedIndicators] = await Promise.all([
            analyzeMarketStructure(symbol),
            analyzeVolumeAndMomentum(symbol),
            analyzeKeyLevels(symbol),
            analyzeAdvancedIndicators(symbol, signal.direction)
        ]);

        // Tính điểm ADX
        const adxScore = signal.adx >= SCORE_CONFIG.ADX_STRONG ? 100 : 
                        signal.adx >= SCORE_CONFIG.ADX_MIN ? (signal.adx / SCORE_CONFIG.ADX_STRONG) * 100 : 0;

        // Tính điểm cấu trúc thị trường
        let structureScore = 0;
        if (signal.direction === 'LONG' && marketStructure.trend === 'BULLISH') {
            structureScore = marketStructure.strength * 100;
        } else if (signal.direction === 'SHORT' && marketStructure.trend === 'BEARISH') {
            structureScore = marketStructure.strength * 100;
        }

        // Tính điểm EMA alignment
        let emaScore = 0;
        if (signal.direction === 'LONG' && marketStructure.emaAlignment === 'BULLISH' && marketStructure.emaSlope === 'RISING') {
            emaScore = 100;
        } else if (signal.direction === 'SHORT' && marketStructure.emaAlignment === 'BEARISH' && marketStructure.emaSlope === 'FALLING') {
            emaScore = 100;
        }

        // Tính điểm momentum
        let momentumAlignmentScore = 0;
        if (signal.direction === 'LONG' && volumeMomentum.momentum === 'BULLISH') {
            momentumAlignmentScore = volumeMomentum.momentumScore;
        } else if (signal.direction === 'SHORT' && volumeMomentum.momentum === 'BEARISH') {
            momentumAlignmentScore = volumeMomentum.momentumScore;
        }

        // Tính điểm chỉ báo nâng cao
        const advancedScore = advancedIndicators.score || 0;

        // Tính điểm tổng hợp (trọng số mới với chỉ báo nâng cao)
        const weights = {
            adx: 0.15,              // 15% - Độ mạnh xu hướng (giảm từ 25%)
            structure: 0.15,         // 15% - Cấu trúc thị trường (giảm từ 20%)
            ema: 0.10,               // 10% - EMA alignment (giảm từ 15%)
            volume: 0.10,            // 10% - Volume confirmation (giảm từ 15%)
            momentum: 0.10,          // 10% - Momentum alignment (giảm từ 15%)
            keyLevels: 0.10,         // 10% - Support/Resistance (giữ nguyên)
            advanced: 0.30           // 30% - Chỉ báo nâng cao (MỚI)
        };

        const totalScore = 
            adxScore * weights.adx +
            structureScore * weights.structure +
            emaScore * weights.ema +
            volumeMomentum.volumeScore * weights.volume +
            momentumAlignmentScore * weights.momentum +
            keyLevels.supportResistanceScore * weights.keyLevels +
            advancedScore * weights.advanced;

        return {
            totalScore: Math.round(totalScore),
            details: {
                adxScore: Math.round(adxScore),
                structureScore: Math.round(structureScore),
                emaScore: Math.round(emaScore),
                volumeScore: Math.round(volumeMomentum.volumeScore),
                momentumScore: Math.round(momentumAlignmentScore),
                keyLevelsScore: Math.round(keyLevels.supportResistanceScore),
                advancedScore: Math.round(advancedScore),
                marketStructure,
                volumeMomentum,
                keyLevels,
                advancedIndicators
            }
        };
    } catch (error) {
        console.error(`Lỗi tính điểm tín hiệu cho ${symbol}:`, error);
        return { totalScore: 0, details: {} };
    }
}

/**
 * Lọc tín hiệu dựa trên điểm số và các tiêu chí nghiêm ngặt (NÂNG CẤP)
 */
export async function filterHighQualitySignals(signals, minScore = 70) {
    const filteredSignals = [];
    
    for (const signal of signals) {
        if (!signal || signal.direction === "NONE") continue;
        
        const scoreResult = await calculateSignalScore(signal, signal.symbol);
        
        // Chỉ chấp nhận tín hiệu có điểm cao và đáp ứng các tiêu chí nghiêm ngặt
        if (scoreResult.totalScore >= minScore) {
            // Kiểm tra thêm các điều kiện nghiêm ngặt với chỉ báo nâng cao
            const { details } = scoreResult;
            const { advancedIndicators } = details;
            
            // Điều kiện bắt buộc cơ bản:
            const basicConditions = 
                details.adxScore >= 20 &&
                details.structureScore >= 30 &&
                details.volumeScore >= 50;

            // Điều kiện nghiêm ngặt với chỉ báo nâng cao:
            const advancedConditions = advancedIndicators && advancedIndicators.summary ? 
                Object.values(advancedIndicators.summary).filter(Boolean).length >= 3 : false;

            // Điều kiện tổng hợp: Cơ bản + Nâng cao
            if (basicConditions && advancedConditions) {
                signal.score = scoreResult.totalScore;
                signal.scoreDetails = details;
                filteredSignals.push(signal);
            }
        }
    }
    
    // Sắp xếp theo điểm số giảm dần
    return filteredSignals.sort((a, b) => b.score - a.score);
}

/**
 * Tạo báo cáo chi tiết về chất lượng tín hiệu (NÂNG CẤP)
 */
export function generateSignalReport(signal) {
    if (!signal || !signal.scoreDetails) {
        return "Không có thông tin chi tiết về tín hiệu.";
    }

    const { details } = signal.scoreDetails;
    const { marketStructure, volumeMomentum, keyLevels, advancedIndicators } = details;

    let report = `📊 *PHÂN TÍCH CHẤT LƯỢNG TÍN HIỆU NÂNG CAO*\n\n`;
    report += `🎯 *Điểm tổng thể:* ${signal.score}/100\n\n`;

    report += `📈 *Chi tiết điểm số:*\n`;
    report += `• ADX (Xu hướng): ${details.adxScore}/100\n`;
    report += `• Cấu trúc thị trường: ${details.structureScore}/100\n`;
    report += `• EMA Alignment: ${details.emaScore}/100\n`;
    report += `• Volume: ${details.volumeScore}/100\n`;
    report += `• Momentum: ${details.momentumScore}/100\n`;
    report += `• Key Levels: ${details.keyLevelsScore}/100\n`;
    report += `• Chỉ báo nâng cao: ${details.advancedScore}/100\n\n`;

    report += `🔍 *Phân tích chi tiết:*\n`;
    report += `• Xu hướng: ${marketStructure.trend} (${(marketStructure.strength * 100).toFixed(1)}%)\n`;
    report += `• EMA: ${marketStructure.emaAlignment} - ${marketStructure.emaSlope}\n`;
    report += `• Volume: ${volumeMomentum.volumeRatio.toFixed(2)}x trung bình\n`;
    report += `• Momentum: ${volumeMomentum.momentum}\n`;
    report += `• RSI: ${volumeMomentum.rsi.toFixed(1)}\n`;
    report += `• Key Levels gần: ${keyLevels.nearbyLevels} mức\n\n`;

    // Thêm báo cáo chỉ báo nâng cao
    if (advancedIndicators && advancedIndicators.details) {
        report += `🔥 *CHỈ BÁO NÂNG CAO:*\n`;
        const { summary } = advancedIndicators;
        const signalCount = Object.values(summary).filter(Boolean).length;
        
        report += `• MACD: ${summary.macdSignal ? '✅' : '❌'}\n`;
        report += `• Stochastic: ${summary.stochasticSignal ? '✅' : '❌'}\n`;
        report += `• Williams %R: ${summary.williamsSignal ? '✅' : '❌'}\n`;
        report += `• MFI: ${summary.mfiSignal ? '✅' : '❌'}\n`;
        report += `• CCI: ${summary.cciSignal ? '✅' : '❌'}\n`;
        report += `• Parabolic SAR: ${summary.sarSignal ? '✅' : '❌'}\n`;
        report += `• Ichimoku: ${summary.ichimokuSignal ? '✅' : '❌'}\n\n`;
        
        report += `🎯 *Tổng số chỉ báo đồng thuận:* ${signalCount}/7\n`;
        
        if (signalCount >= 5) {
            report += `🔥 *Đánh giá:* TÍN HIỆU RẤT MẠNH - Nhiều chỉ báo đồng thuận\n`;
        } else if (signalCount >= 3) {
            report += `⚠️ *Đánh giá:* Tín hiệu TRUNG BÌNH - Một số chỉ báo đồng thuận\n`;
        } else {
            report += `❌ *Đánh giá:* Tín hiệu YẾU - Ít chỉ báo đồng thuận\n`;
        }
    }

    return report;
}

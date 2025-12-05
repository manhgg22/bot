// signals.js - Hệ thống tín hiệu đơn giản và chặt chẽ
import { getCandles, getCurrentPrice } from "./okx.js";

/**
 * Tính EMA (Exponential Moving Average)
 */
function calcEMA(values, period) {
    if (values.length < period) return null;
    const k = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((sum, val) => sum + val, 0) / period;
    
    for (let i = period; i < values.length; i++) {
        ema = values[i] * k + ema * (1 - k);
    }
    return ema;
}

/**
 * Tính MACD (Moving Average Convergence Divergence)
 */
function calcMACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (closes.length < slowPeriod + signalPeriod) return null;
    
    const emaFast = calcEMA(closes, fastPeriod);
    const emaSlow = calcEMA(closes, slowPeriod);
    
    if (!emaFast || !emaSlow) return null;
    
    const macdLine = emaFast - emaSlow;
    const macdHistory = [];
    
    // Tính MACD cho nhiều điểm để có signal line
    for (let i = slowPeriod - 1; i < closes.length; i++) {
        const fastEMA = calcEMA(closes.slice(0, i + 1), fastPeriod);
        const slowEMA = calcEMA(closes.slice(0, i + 1), slowPeriod);
        if (fastEMA && slowEMA) {
            macdHistory.push(fastEMA - slowEMA);
        }
    }
    
    const signalLine = calcEMA(macdHistory, signalPeriod);
    const histogram = macdLine - (signalLine || 0);
    
    return {
        macd: macdLine,
        signal: signalLine || 0,
        histogram: histogram,
        trend: histogram > 0 ? 'BULLISH' : 'BEARISH'
    };
}

/**
 * Tính Stochastic %K và %D
 */
function calcStochastic(candles, kPeriod = 14, dPeriod = 3) {
    if (candles.length < kPeriod) return null;
    
    const recentCandles = candles.slice(-kPeriod);
    const highestHigh = Math.max(...recentCandles.map(c => c.high));
    const lowestLow = Math.min(...recentCandles.map(c => c.low));
    const currentClose = candles[candles.length - 1].close;
    
    const k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
    
    // Tính %D (SMA của %K)
    const kValues = [];
    for (let i = candles.length - dPeriod; i < candles.length; i++) {
        if (i >= kPeriod - 1) {
            const slice = candles.slice(i - kPeriod + 1, i + 1);
            const high = Math.max(...slice.map(c => c.high));
            const low = Math.min(...slice.map(c => c.low));
            const close = candles[i].close;
            kValues.push(((close - low) / (high - low)) * 100);
        }
    }
    
    const d = kValues.length > 0 ? kValues.reduce((sum, val) => sum + val, 0) / kValues.length : k;
    
    return {
        k: k,
        d: d,
        oversold: k < 20,
        overbought: k > 80,
        signal: k > d ? 'BULLISH' : 'BEARISH'
    };
}

/**
 * Tính Bollinger Bands
 */
function calcBollingerBands(candles, period = 20, stdDev = 2) {
    if (candles.length < period) return null;
    
    const closes = candles.slice(-period).map(c => c.close);
    const sma = closes.reduce((sum, val) => sum + val, 0) / period;
    
    const variance = closes.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period;
    const standardDeviation = Math.sqrt(variance);
    
    const upper = sma + (stdDev * standardDeviation);
    const lower = sma - (stdDev * standardDeviation);
    const currentPrice = candles[candles.length - 1].close;
    
    return {
        upper: upper,
        middle: sma,
        lower: lower,
        position: currentPrice > upper ? 'ABOVE' : currentPrice < lower ? 'BELOW' : 'MIDDLE',
        squeeze: (upper - lower) / sma < 0.1 // Bollinger squeeze
    };
}

/**
 * Tính Williams %R
 */
function calcWilliamsR(candles, period = 14) {
    if (candles.length < period) return null;
    
    const recentCandles = candles.slice(-period);
    const highestHigh = Math.max(...recentCandles.map(c => c.high));
    const lowestLow = Math.min(...recentCandles.map(c => c.low));
    const currentClose = candles[candles.length - 1].close;
    
    const williamsR = ((highestHigh - currentClose) / (highestHigh - lowestLow)) * -100;
    
    return {
        value: williamsR,
        oversold: williamsR < -80,
        overbought: williamsR > -20,
        signal: williamsR > -50 ? 'BULLISH' : 'BEARISH'
    };
}

/**
 * Tính RSI (Relative Strength Index)
 */
function calcRSI(candles, period = 14) {
    if (candles.length < period + 1) return 50;
    
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = candles[i].close - candles[i - 1].close;
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }
    
    let avgGain = gains / period;
    let avgLoss = losses / period;
    
    for (let i = period + 1; i < candles.length; i++) {
        const diff = candles[i].close - candles[i - 1].close;
        if (diff >= 0) {
            avgGain = (avgGain * (period - 1) + diff) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - diff) / period;
        }
    }
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

/**
 * Tính ATR (Average True Range)
 */
function calcATR(candles, period = 14) {
    if (candles.length < period + 1) return 0;
    
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i - 1].close;
        const tr = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
        );
        trs.push(tr);
    }
    
    return trs.slice(-period).reduce((sum, tr) => sum + tr, 0) / period;
}

/**
 * CHIẾN LƯỢC NÂNG CAO: Multi-Indicator Confluence
 * Kết hợp 7 chỉ báo để giảm rủi ro và tăng độ chính xác
 */
export async function getSignal(symbol) {
    try {
        // Lấy dữ liệu 15M (nhanh hơn 1H, ít lag hơn)
        const candles = await getCandles(symbol, '15m', 200);
        if (!candles || candles.length < 100) {
            return { direction: "NONE", reason: "Không đủ dữ liệu" };
        }

        const currentPrice = await getCurrentPrice(symbol);
        if (!currentPrice) {
            return { direction: "NONE", reason: "Không lấy được giá hiện tại" };
        }

        // Tính tất cả chỉ báo
        const closes = candles.map(c => c.close);
        const ema9 = calcEMA(closes, 9);   // Nhanh hơn EMA 20
        const ema21 = calcEMA(closes, 21); // Thay cho EMA 50
        const rsi = calcRSI(candles, 14);
        const atr = calcATR(candles, 14);
        const macd = calcMACD(closes);
        const stoch = calcStochastic(candles);
        const bb = calcBollingerBands(candles);
        const williamsR = calcWilliamsR(candles);
        
        // Volume analysis
        const volumes = candles.map(c => c.volume || 0);
        const avgVolume = volumes.slice(-20).reduce((sum, vol) => sum + vol, 0) / 20;
        const currentVolume = candles[candles.length - 1].volume || 0;
        const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;

        // ĐIỀU KIỆN BẮT BUỘC
        if (volumeRatio < 1.1) {
            return { direction: "NONE", reason: "Volume quá thấp" };
        }

        if (!ema9 || !ema21 || !atr || !macd || !stoch || !bb || !williamsR) {
            return { direction: "NONE", reason: "Lỗi tính toán chỉ báo" };
        }

        // TÍNH ĐIỂM CONFLUENCE CHO LONG
        let longScore = 0;
        let longReasons = [];

        // 1. EMA Trend (20 điểm)
        if (ema9 > ema21 && currentPrice > ema9) {
            longScore += 20;
            longReasons.push("EMA Bullish");
        }

        // 2. RSI Momentum (15 điểm)
        if (rsi >= 45 && rsi <= 65) {
            longScore += 15;
            longReasons.push(`RSI ${rsi.toFixed(1)}`);
        } else if (rsi >= 35 && rsi <= 70) {
            longScore += 10;
            longReasons.push(`RSI ${rsi.toFixed(1)} (OK)`);
        }

        // 3. MACD (15 điểm)
        if (macd.trend === 'BULLISH' && macd.histogram > 0) {
            longScore += 15;
            longReasons.push("MACD Bullish");
        } else if (macd.macd > macd.signal) {
            longScore += 10;
            longReasons.push("MACD Cross");
        }

        // 4. Stochastic (10 điểm)
        if (stoch.signal === 'BULLISH' && !stoch.overbought) {
            longScore += 10;
            longReasons.push("Stoch Bullish");
        } else if (stoch.oversold) {
            longScore += 8;
            longReasons.push("Stoch Oversold");
        }

        // 5. Bollinger Bands (10 điểm)
        if (bb.position === 'BELOW' || (bb.position === 'MIDDLE' && currentPrice > bb.middle)) {
            longScore += 10;
            longReasons.push("BB Support");
        }

        // 6. Williams %R (10 điểm)
        if (williamsR.signal === 'BULLISH' || williamsR.oversold) {
            longScore += 10;
            longReasons.push("Williams R");
        }

        // 7. Volume (20 điểm)
        if (volumeRatio >= 2.0) {
            longScore += 20;
            longReasons.push(`Vol ${volumeRatio.toFixed(1)}x`);
        } else if (volumeRatio >= 1.5) {
            longScore += 15;
            longReasons.push(`Vol ${volumeRatio.toFixed(1)}x`);
        } else if (volumeRatio >= 1.2) {
            longScore += 10;
            longReasons.push(`Vol ${volumeRatio.toFixed(1)}x`);
        }

        // TÍNH ĐIỂM CONFLUENCE CHO SHORT
        let shortScore = 0;
        let shortReasons = [];

        // 1. EMA Trend (20 điểm)
        if (ema9 < ema21 && currentPrice < ema9) {
            shortScore += 20;
            shortReasons.push("EMA Bearish");
        }

        // 2. RSI Momentum (15 điểm)
        if (rsi >= 35 && rsi <= 55) {
            shortScore += 15;
            shortReasons.push(`RSI ${rsi.toFixed(1)}`);
        } else if (rsi >= 30 && rsi <= 65) {
            shortScore += 10;
            shortReasons.push(`RSI ${rsi.toFixed(1)} (OK)`);
        }

        // 3. MACD (15 điểm)
        if (macd.trend === 'BEARISH' && macd.histogram < 0) {
            shortScore += 15;
            shortReasons.push("MACD Bearish");
        } else if (macd.macd < macd.signal) {
            shortScore += 10;
            shortReasons.push("MACD Cross");
        }

        // 4. Stochastic (10 điểm)
        if (stoch.signal === 'BEARISH' && !stoch.oversold) {
            shortScore += 10;
            shortReasons.push("Stoch Bearish");
        } else if (stoch.overbought) {
            shortScore += 8;
            shortReasons.push("Stoch Overbought");
        }

        // 5. Bollinger Bands (10 điểm)
        if (bb.position === 'ABOVE' || (bb.position === 'MIDDLE' && currentPrice < bb.middle)) {
            shortScore += 10;
            shortReasons.push("BB Resistance");
        }

        // 6. Williams %R (10 điểm)
        if (williamsR.signal === 'BEARISH' || williamsR.overbought) {
            shortScore += 10;
            shortReasons.push("Williams R");
        }

        // 7. Volume (20 điểm) - Same as LONG
        if (volumeRatio >= 2.0) {
            shortScore += 20;
            shortReasons.push(`Vol ${volumeRatio.toFixed(1)}x`);
        } else if (volumeRatio >= 1.5) {
            shortScore += 15;
            shortReasons.push(`Vol ${volumeRatio.toFixed(1)}x`);
        } else if (volumeRatio >= 1.2) {
            shortScore += 10;
            shortReasons.push(`Vol ${volumeRatio.toFixed(1)}x`);
        }

        // QUYẾT ĐỊNH TÍN HIỆU (cần ít nhất 70 điểm)
        const minScore = 70;
        
        if (longScore >= minScore && longScore > shortScore) {
            // Tính SL/TP thông minh cho LONG
            const supportLevel = Math.min(...candles.slice(-20).map(c => c.low));
            const sl = Math.max(supportLevel * 0.999, currentPrice - (atr * 1.8));
            const tp = currentPrice + (atr * 2.5);
            
            const risk = currentPrice - sl;
            const reward = tp - currentPrice;
            const rrRatio = reward / risk;
            
            if (rrRatio >= 1.5) {
                return {
                    direction: "LONG",
                    symbol: symbol,
                    entry: currentPrice,
                    sl: sl,
                    tp: tp,
                    confidence: Math.min(95, longScore),
                    reason: longReasons.join(" + "),
                    riskReward: rrRatio,
                    atr: atr,
                    score: longScore,
                    indicators: {
                        ema: ema9 > ema21,
                        rsi: rsi,
                        macd: macd.trend,
                        stoch: stoch.signal,
                        bb: bb.position,
                        williams: williamsR.signal,
                        volume: volumeRatio
                    }
                };
            }
        }

        if (shortScore >= minScore && shortScore > longScore) {
            // Tính SL/TP thông minh cho SHORT
            const resistanceLevel = Math.max(...candles.slice(-20).map(c => c.high));
            const sl = Math.min(resistanceLevel * 1.001, currentPrice + (atr * 1.8));
            const tp = currentPrice - (atr * 2.5);
            
            const risk = sl - currentPrice;
            const reward = currentPrice - tp;
            const rrRatio = reward / risk;
            
            if (rrRatio >= 1.5) {
                return {
                    direction: "SHORT",
                    symbol: symbol,
                    entry: currentPrice,
                    sl: sl,
                    tp: tp,
                    confidence: Math.min(95, shortScore),
                    reason: shortReasons.join(" + "),
                    riskReward: rrRatio,
                    atr: atr,
                    score: shortScore,
                    indicators: {
                        ema: ema9 < ema21,
                        rsi: rsi,
                        macd: macd.trend,
                        stoch: stoch.signal,
                        bb: bb.position,
                        williams: williamsR.signal,
                        volume: volumeRatio
                    }
                };
            }
        }

        return { 
            direction: "NONE", 
            reason: `Điểm không đủ (LONG: ${longScore}, SHORT: ${shortScore}, cần ≥${minScore})`,
            longScore: longScore,
            shortScore: shortScore
        };

    } catch (error) {
        console.error(`Lỗi phân tích ${symbol}:`, error.message);
        return { direction: "NONE", reason: "Lỗi kỹ thuật" };
    }
}

/**
 * Quét nhiều coin để tìm tín hiệu tốt nhất
 */
export async function scanTopSignals(symbols, minConfidence = 75) {
    const signals = [];
    
    console.log(`🔍 Bắt đầu quét ${symbols.length} coins...`);
    
    for (let i = 0; i < symbols.length; i++) {
        const symbol = symbols[i];
        try {
            const signal = await getSignal(symbol);
            
            if (signal.direction !== "NONE" && signal.confidence >= minConfidence) {
                signals.push(signal);
                console.log(`✅ Tìm thấy: ${symbol} ${signal.direction} (${signal.confidence.toFixed(1)}%)`);
            }
            
            // Progress update
            if ((i + 1) % 20 === 0) {
                console.log(`📊 Đã quét ${i + 1}/${symbols.length} coins. Tìm thấy ${signals.length} tín hiệu.`);
            }
            
            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 150));
            
        } catch (error) {
            console.error(`Lỗi quét ${symbol}:`, error.message);
        }
    }
    
    // Sắp xếp theo confidence
    return signals.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Format tín hiệu cho Telegram
 */
export function formatSignalMessage(signal) {
    const directionIcon = signal.direction === 'LONG' ? '📈' : '📉';
    const confidenceIcon = signal.confidence >= 85 ? '🔥🔥🔥' : signal.confidence >= 80 ? '🔥🔥' : '🔥';
    
    const riskPercent = Math.abs(((signal.entry - signal.sl) / signal.entry * 100)).toFixed(2);
    const rewardPercent = Math.abs(((signal.tp - signal.entry) / signal.entry * 100)).toFixed(2);
    
    let message = `${confidenceIcon} *MULTI-INDICATOR SIGNAL* ${confidenceIcon}

${directionIcon} *${signal.symbol}* | **${signal.direction}**
🎯 *Confidence:* ${signal.confidence.toFixed(1)}% (Score: ${signal.score}/100)

💰 *Entry:* ${signal.entry.toFixed(6)}
🛑 *Stop Loss:* ${signal.sl.toFixed(6)}
🎯 *Take Profit:* ${signal.tp.toFixed(6)}
📊 *Risk/Reward:* 1:${signal.riskReward.toFixed(1)}

📈 *Confluence Analysis:*
${signal.reason}

📊 *Technical Details:*`;

    if (signal.indicators) {
        message += `
• EMA: ${signal.indicators.ema ? '✅' : '❌'} (9/21 Cross)
• RSI: ${signal.indicators.rsi.toFixed(1)} ${signal.indicators.rsi >= 45 && signal.indicators.rsi <= 65 ? '✅' : '⚠️'}
• MACD: ${signal.indicators.macd} ${signal.indicators.macd === 'BULLISH' ? '✅' : signal.indicators.macd === 'BEARISH' ? '❌' : '⚠️'}
• Stochastic: ${signal.indicators.stoch} ${signal.indicators.stoch === 'BULLISH' ? '✅' : '❌'}
• Bollinger: ${signal.indicators.bb} ${signal.indicators.bb === 'BELOW' || signal.indicators.bb === 'ABOVE' ? '✅' : '⚠️'}
• Williams %R: ${signal.indicators.williams} ${signal.indicators.williams === 'BULLISH' ? '✅' : '❌'}
• Volume: ${signal.indicators.volume.toFixed(1)}x ${signal.indicators.volume >= 1.5 ? '✅' : '⚠️'}`;
    }

    message += `

⚠️ *Risk Management:*
• Risk: ${riskPercent}% | Reward: ${rewardPercent}%
• Timeframe: 15M (Low Lag)
• Position Size: 1-2% of portfolio

💡 *Entry Command:*
\`/${signal.direction.toLowerCase()} ${signal.symbol} ${signal.entry} ${signal.sl}\`

⏰ ${new Date().toLocaleString('vi-VN')}`;

    return message;
}
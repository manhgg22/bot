// wyckoffVolumeProfile.js
// Module Volume Profile cho phân tích Wyckoff + Key Volume + Dual RSI

import { getCandles } from "./okx.js";

/**
 * Volume Profile - Phân tích phân bố volume theo giá
 * Tạo biểu đồ volume profile để xác định các vùng giá quan trọng
 */
export class VolumeProfile {
    constructor(candles, priceLevels = 50) {
        this.candles = candles;
        this.priceLevels = priceLevels;
        this.profile = this.calculateVolumeProfile();
    }

    /**
     * Tính toán Volume Profile
     */
    calculateVolumeProfile() {
        if (!this.candles || this.candles.length === 0) return null;

        // Tìm giá cao nhất và thấp nhất
        const prices = this.candles.map(c => [c.high, c.low]).flat();
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);

        // Tạo các mức giá
        const priceStep = (maxPrice - minPrice) / this.priceLevels;
        const levels = [];
        
        for (let i = 0; i <= this.priceLevels; i++) {
            levels.push({
                price: minPrice + (i * priceStep),
                volume: 0,
                trades: 0
            });
        }

        // Phân bố volume theo giá
        this.candles.forEach(candle => {
            const volume = candle.volume || 0;
            const priceRange = candle.high - candle.low;
            
            if (priceRange > 0) {
                // Phân bố volume đều trong khoảng giá của nến
                const volumePerPrice = volume / priceRange;
                
                levels.forEach(level => {
                    if (level.price >= candle.low && level.price <= candle.high) {
                        level.volume += volumePerPrice;
                        level.trades += 1;
                    }
                });
            }
        });

        return levels.sort((a, b) => b.volume - a.volume);
    }

    /**
     * Tìm Point of Control (POC) - mức giá có volume cao nhất
     */
    getPOC() {
        if (!this.profile || this.profile.length === 0) return null;
        return this.profile[0];
    }

    /**
     * Tính Value Area (70% volume)
     */
    getValueArea() {
        if (!this.profile || this.profile.length === 0) return null;

        const totalVolume = this.profile.reduce((sum, level) => sum + level.volume, 0);
        const targetVolume = totalVolume * 0.7;
        
        let accumulatedVolume = 0;
        const valueAreaLevels = [];
        
        // Bắt đầu từ POC và mở rộng ra hai bên
        const poc = this.getPOC();
        const pocIndex = this.profile.findIndex(level => level.price === poc.price);
        
        let leftIndex = pocIndex;
        let rightIndex = pocIndex;
        
        while (accumulatedVolume < targetVolume && 
               (leftIndex > 0 || rightIndex < this.profile.length - 1)) {
            
            const leftVolume = leftIndex > 0 ? this.profile[leftIndex - 1].volume : 0;
            const rightVolume = rightIndex < this.profile.length - 1 ? 
                               this.profile[rightIndex + 1].volume : 0;
            
            if (leftVolume >= rightVolume && leftIndex > 0) {
                leftIndex--;
                accumulatedVolume += leftVolume;
                valueAreaLevels.push(this.profile[leftIndex]);
            } else if (rightIndex < this.profile.length - 1) {
                rightIndex++;
                accumulatedVolume += rightVolume;
                valueAreaLevels.push(this.profile[rightIndex]);
            } else {
                break;
            }
        }

        const sortedLevels = valueAreaLevels.sort((a, b) => a.price - b.price);
        
        return {
            high: sortedLevels.length > 0 ? Math.max(...sortedLevels.map(l => l.price)) : poc.price,
            low: sortedLevels.length > 0 ? Math.min(...sortedLevels.map(l => l.price)) : poc.price,
            levels: sortedLevels,
            volumePercentage: (accumulatedVolume / totalVolume) * 100
        };
    }

    /**
     * Tìm High Volume Nodes (HVN) - các mức giá có volume cao
     */
    getHVN(threshold = 0.8) {
        if (!this.profile || this.profile.length === 0) return [];
        
        const maxVolume = this.profile[0].volume;
        const volumeThreshold = maxVolume * threshold;
        
        return this.profile.filter(level => level.volume >= volumeThreshold);
    }

    /**
     * Tìm Low Volume Nodes (LVN) - các mức giá có volume thấp
     */
    getLVN(threshold = 0.2) {
        if (!this.profile || this.profile.length === 0) return [];
        
        const maxVolume = this.profile[0].volume;
        const volumeThreshold = maxVolume * threshold;
        
        return this.profile.filter(level => level.volume <= volumeThreshold);
    }

    /**
     * Kiểm tra giá hiện tại có nằm trong Value Area không
     */
    isInValueArea(currentPrice) {
        const valueArea = this.getValueArea();
        if (!valueArea) return false;
        
        return currentPrice >= valueArea.low && currentPrice <= valueArea.high;
    }

    /**
     * Tìm các mức hỗ trợ/kháng cự từ Volume Profile
     */
    getSupportResistanceLevels() {
        const hvn = this.getHVN(0.7);
        const poc = this.getPOC();
        const valueArea = this.getValueArea();
        
        const levels = [];
        
        // Thêm POC
        if (poc) {
            levels.push({
                price: poc.price,
                type: 'POC',
                strength: 'HIGH',
                volume: poc.volume
            });
        }
        
        // Thêm Value Area High/Low
        if (valueArea) {
            levels.push({
                price: valueArea.high,
                type: 'VAH',
                strength: 'MEDIUM',
                volume: 0
            });
            levels.push({
                price: valueArea.low,
                type: 'VAL',
                strength: 'MEDIUM',
                volume: 0
            });
        }
        
        // Thêm HVN
        hvn.forEach(level => {
            if (level.price !== poc?.price) {
                levels.push({
                    price: level.price,
                    type: 'HVN',
                    strength: 'MEDIUM',
                    volume: level.volume
                });
            }
        });
        
        return levels.sort((a, b) => a.price - b.price);
    }
}

/**
 * Key Volume Detection - Phát hiện volume đột biến
 */
export class KeyVolumeDetector {
    constructor(candles, lookbackPeriod = 20) {
        this.candles = candles;
        this.lookbackPeriod = lookbackPeriod;
    }

    /**
     * Tính volume trung bình
     */
    getAverageVolume() {
        if (!this.candles || this.candles.length < this.lookbackPeriod) return 0;
        
        const recentVolumes = this.candles
            .slice(-this.lookbackPeriod)
            .map(c => c.volume || 0);
        
        return recentVolumes.reduce((sum, vol) => sum + vol, 0) / recentVolumes.length;
    }

    /**
     * Phát hiện Key Volume (volume đột biến) - giảm ngưỡng để có nhiều tín hiệu hơn
     */
    detectKeyVolume(threshold = 1.3) {
        if (!this.candles || this.candles.length === 0) return null;
        
        const avgVolume = this.getAverageVolume();
        const lastCandle = this.candles[this.candles.length - 1];
        const currentVolume = lastCandle.volume || 0;
        
        if (currentVolume > avgVolume * threshold) {
            return {
                isKeyVolume: true,
                volume: currentVolume,
                averageVolume: avgVolume,
                multiplier: currentVolume / avgVolume,
                candle: lastCandle,
                strength: this.calculateVolumeStrength(currentVolume, avgVolume)
            };
        }
        
        return {
            isKeyVolume: false,
            volume: currentVolume,
            averageVolume: avgVolume,
            multiplier: currentVolume / avgVolume,
            candle: lastCandle,
            strength: 0
        };
    }

    /**
     * Tính độ mạnh của volume - giảm ngưỡng để có nhiều tín hiệu hơn
     */
    calculateVolumeStrength(currentVolume, avgVolume) {
        const multiplier = currentVolume / avgVolume;
        
        if (multiplier >= 2.5) return 'VERY_HIGH';
        if (multiplier >= 2.0) return 'HIGH';
        if (multiplier >= 1.5) return 'MEDIUM';
        if (multiplier >= 1.3) return 'LOW';
        return 'VERY_LOW';
    }

    /**
     * Phân tích volume theo xu hướng
     */
    analyzeVolumeTrend() {
        if (!this.candles || this.candles.length < 10) return null;
        
        const recentCandles = this.candles.slice(-10);
        const volumes = recentCandles.map(c => c.volume || 0);
        const prices = recentCandles.map(c => c.close);
        
        // Tính xu hướng volume
        let volumeTrend = 'NEUTRAL';
        const volumeSlope = this.calculateSlope(volumes);
        const priceSlope = this.calculateSlope(prices);
        
        if (volumeSlope > 0.1) volumeTrend = 'INCREASING';
        else if (volumeSlope < -0.1) volumeTrend = 'DECREASING';
        
        // Phân tích volume vs price
        let volumePriceRelation = 'NEUTRAL';
        if (priceSlope > 0 && volumeSlope > 0) volumePriceRelation = 'BULLISH';
        else if (priceSlope < 0 && volumeSlope > 0) volumePriceRelation = 'BEARISH';
        else if (priceSlope > 0 && volumeSlope < 0) volumePriceRelation = 'DIVERGENCE_BEARISH';
        else if (priceSlope < 0 && volumeSlope < 0) volumePriceRelation = 'DIVERGENCE_BULLISH';
        
        return {
            volumeTrend,
            volumePriceRelation,
            volumeSlope,
            priceSlope,
            avgVolume: volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length
        };
    }

    /**
     * Tính slope của một chuỗi số
     */
    calculateSlope(values) {
        if (values.length < 2) return 0;
        
        const n = values.length;
        const sumX = (n * (n - 1)) / 2;
        const sumY = values.reduce((sum, val) => sum + val, 0);
        const sumXY = values.reduce((sum, val, i) => sum + (i * val), 0);
        const sumXX = values.reduce((sum, val, i) => sum + (i * i), 0);
        
        return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    }
}

/**
 * Dual RSI System - Hệ thống RSI kép
 */
export class DualRSI {
    constructor(candles, fastPeriod = 5, slowPeriod = 14) {
        this.candles = candles;
        this.fastPeriod = fastPeriod;
        this.slowPeriod = slowPeriod;
        this.fastRSI = this.calculateRSI(fastPeriod);
        this.slowRSI = this.calculateRSI(slowPeriod);
    }

    /**
     * Tính RSI
     */
    calculateRSI(period) {
        if (!this.candles || this.candles.length < Math.min(period + 1, 10)) {
            return [];
        }

        const closes = this.candles.map(c => c.close);
        const gains = [];
        const losses = [];

        for (let i = 1; i < closes.length; i++) {
            const change = closes[i] - closes[i - 1];
            gains.push(change > 0 ? change : 0);
            losses.push(change < 0 ? -change : 0);
        }

        const rsiValues = [];
        const actualPeriod = Math.min(period, gains.length);
        let avgGain = gains.slice(0, actualPeriod).reduce((sum, gain) => sum + gain, 0) / actualPeriod;
        let avgLoss = losses.slice(0, actualPeriod).reduce((sum, loss) => sum + loss, 0) / actualPeriod;

        for (let i = actualPeriod; i < gains.length; i++) {
            const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
            const rsi = 100 - (100 / (1 + rs));
            rsiValues.push(rsi);

            avgGain = ((avgGain * (actualPeriod - 1)) + gains[i]) / actualPeriod;
            avgLoss = ((avgLoss * (actualPeriod - 1)) + losses[i]) / actualPeriod;
        }

        return rsiValues;
    }

    /**
     * Lấy giá trị RSI hiện tại
     */
    getCurrentRSI() {
        return {
            fast: this.fastRSI[this.fastRSI.length - 1] || 50,
            slow: this.slowRSI[this.slowRSI.length - 1] || 50,
            prevFast: this.fastRSI[this.fastRSI.length - 2] || 50,
            prevSlow: this.slowRSI[this.slowRSI.length - 2] || 50
        };
    }

    /**
     * Phân tích tín hiệu Dual RSI
     */
    analyzeSignals() {
        const current = this.getCurrentRSI();
        const signals = [];

        // Tín hiệu crossover
        if (current.prevFast <= current.prevSlow && current.fast > current.slow) {
            signals.push({
                type: 'BULLISH_CROSSOVER',
                strength: this.calculateCrossoverStrength(current),
                description: 'RSI nhanh cắt lên RSI chậm'
            });
        }

        if (current.prevFast >= current.prevSlow && current.fast < current.slow) {
            signals.push({
                type: 'BEARISH_CROSSOVER',
                strength: this.calculateCrossoverStrength(current),
                description: 'RSI nhanh cắt xuống RSI chậm'
            });
        }

        // Tín hiệu oversold/overbought
        if (current.fast < 30 && current.slow < 30) {
            signals.push({
                type: 'OVERSOLD',
                strength: 'HIGH',
                description: 'Cả hai RSI đều oversold'
            });
        }

        if (current.fast > 70 && current.slow > 70) {
            signals.push({
                type: 'OVERBOUGHT',
                strength: 'HIGH',
                description: 'Cả hai RSI đều overbought'
            });
        }

        // Tín hiệu divergence
        const divergence = this.detectDivergence();
        if (divergence) {
            signals.push(divergence);
        }

        return signals;
    }

    /**
     * Tính độ mạnh của crossover
     */
    calculateCrossoverStrength(current) {
        const fastDiff = Math.abs(current.fast - current.slow);
        const prevDiff = Math.abs(current.prevFast - current.prevSlow);
        
        if (fastDiff > 10 && prevDiff < 5) return 'HIGH';
        if (fastDiff > 5 && prevDiff < 3) return 'MEDIUM';
        return 'LOW';
    }

    /**
     * Phát hiện divergence
     */
    detectDivergence() {
        if (this.candles.length < 20) return null;

        const closes = this.candles.map(c => c.close);
        const recentCloses = closes.slice(-10);
        const recentFastRSI = this.fastRSI.slice(-10);
        const recentSlowRSI = this.slowRSI.slice(-10);

        // Bullish divergence: giá giảm nhưng RSI tăng
        const priceLow = Math.min(...recentCloses);
        const priceHigh = Math.max(...recentCloses);
        const rsiLow = Math.min(...recentFastRSI);
        const rsiHigh = Math.max(...recentFastRSI);

        if (priceLow === recentCloses[recentCloses.length - 1] && 
            rsiLow === recentFastRSI[recentFastRSI.length - 1] &&
            priceHigh !== recentCloses[recentCloses.length - 1]) {
            return {
                type: 'BULLISH_DIVERGENCE',
                strength: 'MEDIUM',
                description: 'Bullish divergence giữa giá và RSI'
            };
        }

        if (priceHigh === recentCloses[recentCloses.length - 1] && 
            rsiHigh === recentFastRSI[recentFastRSI.length - 1] &&
            priceLow !== recentCloses[recentCloses.length - 1]) {
            return {
                type: 'BEARISH_DIVERGENCE',
                strength: 'MEDIUM',
                description: 'Bearish divergence giữa giá và RSI'
            };
        }

        return null;
    }

    /**
     * Xác định xu hướng chính
     */
    getTrend() {
        const current = this.getCurrentRSI();
        if (current.slow > 50 && current.fast > 50) {
            return 'BULLISH';
        }
        if (current.slow < 50 && current.fast < 50) {
            return 'BEARISH';
        }
        return 'NEUTRAL';
    }

    /**
     * Tính Differential RSI (hiệu số giữa RSI nhanh và chậm)
     */
    getDifferentialRSI() {
        const current = this.getCurrentRSI();
        return current.fast - current.slow;
    }
}

/**
 * Wyckoff Volume Analysis - Phân tích tổng hợp
 */
export class WyckoffVolumeAnalysis {
    constructor(symbol, timeframe = '1H', lookbackPeriod = 100) {
        this.symbol = symbol;
        this.timeframe = timeframe;
        this.lookbackPeriod = lookbackPeriod;
    }

    /**
     * Thực hiện phân tích đầy đủ
     */
    async performAnalysis() {
        try {
            // Lấy dữ liệu nến
            const candles = await getCandles(this.symbol, this.timeframe, this.lookbackPeriod);
            
            if (!candles || candles.length < 20) {
                return { success: false, error: `Không đủ dữ liệu (cần ít nhất 20 nến, chỉ có ${candles ? candles.length : 0})` };
            }

            // Khởi tạo các analyzer
            const volumeProfile = new VolumeProfile(candles);
            const keyVolumeDetector = new KeyVolumeDetector(candles);
            const dualRSI = new DualRSI(candles);

            // Thực hiện phân tích
            const analysis = {
                symbol: this.symbol,
                timeframe: this.timeframe,
                timestamp: new Date(),
                
                // Volume Profile Analysis
                volumeProfile: {
                    poc: volumeProfile.getPOC(),
                    valueArea: volumeProfile.getValueArea(),
                    hvn: volumeProfile.getHVN(),
                    lvn: volumeProfile.getLVN(),
                    supportResistance: volumeProfile.getSupportResistanceLevels()
                },
                
                // Key Volume Analysis
                keyVolume: keyVolumeDetector.detectKeyVolume(),
                volumeTrend: keyVolumeDetector.analyzeVolumeTrend(),
                
                // Dual RSI Analysis
                dualRSI: {
                    current: dualRSI.getCurrentRSI(),
                    signals: dualRSI.analyzeSignals(),
                    trend: dualRSI.getTrend(),
                    differential: dualRSI.getDifferentialRSI()
                },
                
                // Current Price Analysis
                currentPrice: candles[candles.length - 1].close,
                isInValueArea: volumeProfile.isInValueArea(candles[candles.length - 1].close)
            };

            return { success: true, analysis };

        } catch (error) {
            console.error(`Lỗi phân tích Wyckoff cho ${this.symbol}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Tạo tín hiệu giao dịch dựa trên phân tích
     */
    async generateTradingSignal() {
        const analysisResult = await this.performAnalysis();
        
        if (!analysisResult.success) {
            return { direction: 'NONE', reason: analysisResult.error };
        }

        const analysis = analysisResult.analysis;
        const signals = [];

        // Phân tích Key Volume - giảm ngưỡng để có nhiều tín hiệu hơn
        if (analysis.keyVolume.isKeyVolume) {
            const lastCandle = analysis.keyVolume.candle;
            const isBullishVolume = lastCandle.close > lastCandle.open;
            
            if (isBullishVolume) {
                signals.push({
                    type: 'KEY_VOLUME_BULLISH',
                    strength: analysis.keyVolume.strength,
                    score: this.calculateVolumeScore(analysis.keyVolume)
                });
            } else {
                signals.push({
                    type: 'KEY_VOLUME_BEARISH',
                    strength: analysis.keyVolume.strength,
                    score: this.calculateVolumeScore(analysis.keyVolume)
                });
            }
        } else if (analysis.keyVolume && analysis.keyVolume.multiplier >= 1.2) {
            // Tín hiệu volume cao hơn trung bình 20%
            const lastCandle = analysis.keyVolume.candle;
            const isBullishVolume = lastCandle.close > lastCandle.open;
            
            if (isBullishVolume) {
                signals.push({
                    type: 'VOLUME_BULLISH',
                    strength: 'LOW',
                    score: 15
                });
            } else {
                signals.push({
                    type: 'VOLUME_BEARISH',
                    strength: 'LOW',
                    score: 15
                });
            }
        }

        // Phân tích Volume Profile
        if (analysis.volumeProfile.poc) {
            const currentPrice = analysis.currentPrice;
            const poc = analysis.volumeProfile.poc.price;
            const valueArea = analysis.volumeProfile.valueArea;
            
            // Giá phá vỡ khỏi Value Area với volume cao
            if (!analysis.isInValueArea && analysis.keyVolume.isKeyVolume) {
                if (currentPrice > valueArea.high) {
                    signals.push({
                        type: 'BREAKOUT_BULLISH',
                        strength: 'HIGH',
                        score: 80
                    });
                } else if (currentPrice < valueArea.low) {
                    signals.push({
                        type: 'BREAKDOWN_BEARISH',
                        strength: 'HIGH',
                        score: 80
                    });
                }
            }
        }

        // Phân tích Dual RSI - giảm ngưỡng để có nhiều tín hiệu hơn
        const rsiSignals = analysis.dualRSI.signals;
        rsiSignals.forEach(signal => {
            if (signal.type === 'BULLISH_CROSSOVER' || signal.type === 'OVERSOLD') {
                signals.push({
                    type: 'RSI_BULLISH',
                    strength: signal.strength,
                    score: this.calculateRSIScore(signal)
                });
            } else if (signal.type === 'BEARISH_CROSSOVER' || signal.type === 'OVERBOUGHT') {
                signals.push({
                    type: 'RSI_BEARISH',
                    strength: signal.strength,
                    score: this.calculateRSIScore(signal)
                });
            }
        });
        
        // Tín hiệu RSI đơn giản dựa trên giá trị hiện tại
        const currentRSI = analysis.dualRSI.current;
        if (currentRSI) {
            if (currentRSI.fast > 60) {
                signals.push({
                    type: 'RSI_BULLISH',
                    strength: 'MEDIUM',
                    score: 20
                });
            } else if (currentRSI.fast < 40) {
                signals.push({
                    type: 'RSI_BEARISH',
                    strength: 'MEDIUM',
                    score: 20
                });
            }
        }

        // Tổng hợp tín hiệu
        const bullishSignals = signals.filter(s => 
            s.type.includes('BULLISH') || s.type.includes('BREAKOUT')
        );
        const bearishSignals = signals.filter(s => 
            s.type.includes('BEARISH') || s.type.includes('BREAKDOWN')
        );

        const bullishScore = bullishSignals.reduce((sum, s) => sum + s.score, 0);
        const bearishScore = bearishSignals.reduce((sum, s) => sum + s.score, 0);

        let direction = 'NONE';
        let confidence = 0;
        let reason = '';

        if (bullishScore > bearishScore && bullishScore > 10) {
            direction = 'LONG';
            confidence = Math.min(bullishScore, 100);
            reason = `Tín hiệu tích cực (${bullishSignals.length} tín hiệu)`;
        } else if (bearishScore > bullishScore && bearishScore > 10) {
            direction = 'SHORT';
            confidence = Math.min(bearishScore, 100);
            reason = `Tín hiệu tiêu cực (${bearishSignals.length} tín hiệu)`;
        } else {
            reason = 'Tín hiệu không rõ ràng hoặc mâu thuẫn';
        }

        return {
            direction,
            confidence,
            reason,
            signals,
            analysis: analysis
        };
    }

    /**
     * Tính điểm cho volume signal
     */
    calculateVolumeScore(keyVolume) {
        const multipliers = {
            'VERY_HIGH': 40,
            'HIGH': 30,
            'MEDIUM': 20,
            'LOW': 10,
            'VERY_LOW': 5
        };
        
        return multipliers[keyVolume.strength] || 10;
    }

    /**
     * Tính điểm cho RSI signal
     */
    calculateRSIScore(signal) {
        const multipliers = {
            'HIGH': 30,
            'MEDIUM': 20,
            'LOW': 10
        };
        
        return multipliers[signal.strength] || 10;
    }
}

export default WyckoffVolumeAnalysis;

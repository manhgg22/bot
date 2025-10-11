// riskManager.js - Quản lý rủi ro nâng cao và an toàn giao dịch
import { getCurrentPrice } from "./okx.js";
import { detectCrashRisk, analyzeMarketSentiment } from "./advancedIndicators.js";

/* ============== QUẢN LÝ RỦI RO NÂNG CAO ============== */

/**
 * Position Sizing Calculator - Tính toán kích thước lệnh an toàn
 */
export function calculatePositionSize(accountBalance, riskPercent, entryPrice, stopLoss) {
    const riskAmount = accountBalance * (riskPercent / 100);
    const riskPerUnit = Math.abs(entryPrice - stopLoss);
    const positionSize = riskAmount / riskPerUnit;
    
    return {
        positionSize,
        riskAmount,
        riskPerUnit,
        maxLoss: riskAmount,
        riskPercent
    };
}

/**
 * Risk Assessment - Đánh giá rủi ro tổng thể
 */
export async function assessRisk(symbol, direction, entryPrice, stopLoss) {
    try {
        const currentPrice = await getCurrentPrice(symbol);
        if (!currentPrice) return null;
        
        // Lấy dữ liệu phân tích
        const [crashRisk, sentiment] = await Promise.all([
            detectCrashRisk(await getCandles(symbol, "1H", 50)),
            analyzeMarketSentiment(symbol)
        ]);
        
        let riskScore = 0;
        let warnings = [];
        
        // Rủi ro từ crash detection
        if (crashRisk?.riskLevel === "HIGH") {
            riskScore += 40;
            warnings.push("⚠️ Rủi ro sập cao - Thị trường có thể giảm mạnh");
        } else if (crashRisk?.riskLevel === "MEDIUM") {
            riskScore += 20;
            warnings.push("⚠️ Rủi ro sập trung bình");
        }
        
        // Rủi ro từ sentiment
        if (sentiment?.sentiment === "EXTREME_BEARISH" && direction === "LONG") {
            riskScore += 30;
            warnings.push("⚠️ Tâm lý thị trường cực kỳ bi quan - Không nên LONG");
        } else if (sentiment?.sentiment === "EXTREME_BULLISH" && direction === "SHORT") {
            riskScore += 30;
            warnings.push("⚠️ Tâm lý thị trường cực kỳ lạc quan - Không nên SHORT");
        }
        
        // Rủi ro từ khoảng cách SL
        const slDistance = Math.abs(entryPrice - stopLoss) / entryPrice * 100;
        if (slDistance > 5) {
            riskScore += 25;
            warnings.push("⚠️ Stop Loss quá xa - Rủi ro cao");
        } else if (slDistance < 1) {
            riskScore += 15;
            warnings.push("⚠️ Stop Loss quá gần - Có thể bị quét");
        }
        
        // Rủi ro từ volatility
        if (crashRisk?.volatility > 0.05) {
            riskScore += 20;
            warnings.push("⚠️ Biến động cao - Thị trường không ổn định");
        }
        
        // Xác định mức rủi ro
        let riskLevel = "LOW";
        if (riskScore > 70) riskLevel = "CRITICAL";
        else if (riskScore > 50) riskLevel = "HIGH";
        else if (riskScore > 30) riskLevel = "MEDIUM";
        
        return {
            riskScore,
            riskLevel,
            warnings,
            recommendations: generateRiskRecommendations(riskLevel, warnings),
            shouldTrade: riskScore < 50
        };
    } catch (error) {
        console.error(`Lỗi đánh giá rủi ro cho ${symbol}:`, error);
        return null;
    }
}

/**
 * Smart Trailing Stop Loss - Trailing stop thông minh
 */
export class SmartTrailingStop {
    constructor(symbol, direction, initialSL, entryPrice, atr) {
        this.symbol = symbol;
        this.direction = direction;
        this.initialSL = initialSL;
        this.entryPrice = entryPrice;
        this.currentSL = initialSL;
        this.atr = atr;
        this.breakevenTriggered = false;
        this.trailingDistance = atr * 1.5; // Khoảng cách trailing
    }
    
    update(currentPrice) {
        if (this.direction === "LONG") {
            // Kiểm tra breakeven
            if (!this.breakevenTriggered && currentPrice >= this.entryPrice + this.atr) {
                this.currentSL = this.entryPrice;
                this.breakevenTriggered = true;
                return { action: "BREAKEVEN", newSL: this.currentSL };
            }
            
            // Trailing stop
            if (this.breakevenTriggered && currentPrice - this.trailingDistance > this.currentSL) {
                this.currentSL = currentPrice - this.trailingDistance;
                return { action: "TRAILING", newSL: this.currentSL };
            }
        } else {
            // Kiểm tra breakeven
            if (!this.breakevenTriggered && currentPrice <= this.entryPrice - this.atr) {
                this.currentSL = this.entryPrice;
                this.breakevenTriggered = true;
                return { action: "BREAKEVEN", newSL: this.currentSL };
            }
            
            // Trailing stop
            if (this.breakevenTriggered && currentPrice + this.trailingDistance < this.currentSL) {
                this.currentSL = currentPrice + this.trailingDistance;
                return { action: "TRAILING", newSL: this.currentSL };
            }
        }
        
        return { action: "NONE", newSL: this.currentSL };
    }
}

/**
 * Portfolio Risk Manager - Quản lý rủi ro danh mục
 */
export class PortfolioRiskManager {
    constructor(maxRiskPerTrade = 2, maxTotalRisk = 10, maxConsecutiveLosses = 3) {
        this.maxRiskPerTrade = maxRiskPerTrade; // % rủi ro tối đa mỗi lệnh
        this.maxTotalRisk = maxTotalRisk; // % rủi ro tối đa tổng cộng
        this.maxConsecutiveLosses = maxConsecutiveLosses; // Số lệnh thua liên tiếp tối đa
        this.consecutiveLosses = 0;
        this.totalRisk = 0;
        this.trades = [];
    }
    
    canOpenNewTrade(riskAmount, accountBalance) {
        const riskPercent = (riskAmount / accountBalance) * 100;
        
        // Kiểm tra rủi ro mỗi lệnh
        if (riskPercent > this.maxRiskPerTrade) {
            return {
                allowed: false,
                reason: `Rủi ro mỗi lệnh (${riskPercent.toFixed(2)}%) vượt quá giới hạn (${this.maxRiskPerTrade}%)`
            };
        }
        
        // Kiểm tra rủi ro tổng cộng
        if (this.totalRisk + riskPercent > this.maxTotalRisk) {
            return {
                allowed: false,
                reason: `Rủi ro tổng cộng sẽ vượt quá giới hạn (${this.maxTotalRisk}%)`
            };
        }
        
        // Kiểm tra chuỗi thua
        if (this.consecutiveLosses >= this.maxConsecutiveLosses) {
            return {
                allowed: false,
                reason: `Đã thua ${this.consecutiveLosses} lệnh liên tiếp. Tạm dừng giao dịch.`
            };
        }
        
        return { allowed: true };
    }
    
    addTrade(trade) {
        this.trades.push(trade);
        this.totalRisk += trade.riskPercent;
    }
    
    closeTrade(tradeId, result) {
        const trade = this.trades.find(t => t.id === tradeId);
        if (trade) {
            this.totalRisk -= trade.riskPercent;
            this.trades = this.trades.filter(t => t.id !== tradeId);
            
            if (result === "LOSS") {
                this.consecutiveLosses++;
            } else {
                this.consecutiveLosses = 0;
            }
        }
    }
    
    getRiskStatus() {
        return {
            totalRisk: this.totalRisk,
            maxTotalRisk: this.maxTotalRisk,
            consecutiveLosses: this.consecutiveLosses,
            maxConsecutiveLosses: this.maxConsecutiveLosses,
            activeTrades: this.trades.length,
            riskUtilization: (this.totalRisk / this.maxTotalRisk) * 100
        };
    }
}

/**
 * Market Condition Filter - Bộ lọc điều kiện thị trường
 */
export async function filterMarketConditions(symbol) {
    try {
        const [sentiment, crashRisk] = await Promise.all([
            analyzeMarketSentiment(symbol),
            detectCrashRisk(await getCandles(symbol, "1H", 50))
        ]);
        
        const conditions = {
            isTradeable: true,
            warnings: [],
            recommendations: []
        };
        
        // Kiểm tra sentiment cực đoan
        if (sentiment?.sentiment === "EXTREME_BULLISH" || sentiment?.sentiment === "EXTREME_BEARISH") {
            conditions.warnings.push("⚠️ Tâm lý thị trường cực đoan - Cẩn thận");
            conditions.recommendations.push("Giảm kích thước lệnh");
        }
        
        // Kiểm tra rủi ro sập
        if (crashRisk?.riskLevel === "HIGH") {
            conditions.isTradeable = false;
            conditions.warnings.push("🚨 Rủi ro sập cao - Không nên giao dịch");
            conditions.recommendations.push("Chờ thị trường ổn định");
        } else if (crashRisk?.riskLevel === "MEDIUM") {
            conditions.warnings.push("⚠️ Rủi ro sập trung bình");
            conditions.recommendations.push("Giảm kích thước lệnh");
        }
        
        // Kiểm tra volatility
        if (crashRisk?.volatility > 0.08) {
            conditions.warnings.push("⚠️ Biến động rất cao");
            conditions.recommendations.push("Sử dụng stop loss rộng hơn");
        }
        
        return conditions;
    } catch (error) {
        console.error(`Lỗi lọc điều kiện thị trường cho ${symbol}:`, error);
        return { isTradeable: true, warnings: [], recommendations: [] };
    }
}

/**
 * Generate Risk Recommendations - Tạo khuyến nghị rủi ro
 */
function generateRiskRecommendations(riskLevel, warnings) {
    const recommendations = [];
    
    switch (riskLevel) {
        case "CRITICAL":
            recommendations.push("🚨 KHÔNG NÊN GIAO DỊCH");
            recommendations.push("Chờ thị trường ổn định");
            break;
        case "HIGH":
            recommendations.push("⚠️ Giảm kích thước lệnh xuống 50%");
            recommendations.push("Sử dụng stop loss chặt chẽ");
            recommendations.push("Theo dõi sát sao");
            break;
        case "MEDIUM":
            recommendations.push("⚠️ Cẩn thận với kích thước lệnh");
            recommendations.push("Đặt stop loss hợp lý");
            break;
        case "LOW":
            recommendations.push("✅ Điều kiện giao dịch tốt");
            recommendations.push("Có thể giao dịch bình thường");
            break;
    }
    
    return recommendations;
}

/**
 * Correlation Risk Check - Kiểm tra rủi ro tương quan
 */
export function checkCorrelationRisk(symbol, existingTrades) {
    // Danh sách các cặp coin có tương quan cao
    const correlatedPairs = {
        'BTC-USDT-SWAP': ['ETH-USDT-SWAP', 'BNB-USDT-SWAP'],
        'ETH-USDT-SWAP': ['BTC-USDT-SWAP', 'BNB-USDT-SWAP'],
        'BNB-USDT-SWAP': ['BTC-USDT-SWAP', 'ETH-USDT-SWAP']
    };
    
    const correlatedSymbols = correlatedPairs[symbol] || [];
    const correlatedTrades = existingTrades.filter(trade => 
        correlatedSymbols.includes(trade.symbol)
    );
    
    if (correlatedTrades.length > 0) {
        return {
            hasCorrelationRisk: true,
            correlatedTrades,
            warning: `⚠️ ${symbol} có tương quan cao với ${correlatedTrades.length} lệnh khác`
        };
    }
    
    return { hasCorrelationRisk: false };
}

// Helper function
async function getCandles(symbol, timeframe, limit) {
    const { getCandles } = await import("./okx.js");
    return getCandles(symbol, timeframe, limit);
}

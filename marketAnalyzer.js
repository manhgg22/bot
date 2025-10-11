// marketAnalyzer.js - Phân tích thị trường tổng thể và dự báo
import axios from "axios";
import { getCandles, getCurrentPrice } from "./okx.js";
import { analyzeMarketSentiment, detectCrashRisk, getDailyMarketAnalysis } from "./advancedIndicators.js";

/* ============== PHÂN TÍCH THỊ TRƯỜNG TỔNG THỂ ============== */

/**
 * Fear & Greed Index - Chỉ số sợ hãi và tham lam
 */
export async function getFearGreedIndex() {
    try {
        // Sử dụng API thực tế của Fear & Greed Index
        const response = await axios.get('https://api.alternative.me/fng/');
        const data = response.data.data[0];
        
        return {
            value: parseInt(data.value),
            classification: data.value_classification,
            timestamp: data.timestamp,
            interpretation: interpretFearGreed(parseInt(data.value))
        };
    } catch (error) {
        console.error("Lỗi lấy Fear & Greed Index:", error);
        return null;
    }
}

/**
 * Market Overview - Tổng quan thị trường
 */
export async function getMarketOverview() {
    try {
        const [fearGreed, topCoins] = await Promise.all([
            getFearGreedIndex(),
            getTopCoinsAnalysis()
        ]);
        
        return {
            fearGreed,
            topCoins,
            marketTrend: analyzeOverallTrend(topCoins),
            recommendations: generateMarketRecommendations(fearGreed, topCoins)
        };
    } catch (error) {
        console.error("Lỗi phân tích tổng quan thị trường:", error);
        return null;
    }
}

/**
 * Top Coins Analysis - Phân tích top coin
 */
async function getTopCoinsAnalysis() {
    try {
        // Lấy top 20 coin theo volume
        const response = await axios.get('https://www.okx.com/api/v5/market/tickers', {
            params: { instType: "SWAP" }
        });
        
        const tickers = response.data.data
            .filter(t => t.settleCcy === 'USDT' && t.state === 'live')
            .sort((a, b) => Number(b.volCcy24h) - Number(a.volCcy24h))
            .slice(0, 20);
        
        const analysis = await Promise.all(
            tickers.map(async (ticker) => {
                const symbol = ticker.instId;
                const priceChange = parseFloat(ticker.chg24h);
                const volume = parseFloat(ticker.volCcy24h);
                
                // Phân tích sentiment và rủi ro
                const [sentiment, crashRisk] = await Promise.all([
                    analyzeMarketSentiment(symbol),
                    detectCrashRisk(await getCandles(symbol, "1H", 50))
                ]);
                
                return {
                    symbol,
                    price: parseFloat(ticker.last),
                    priceChange,
                    volume,
                    sentiment: sentiment?.sentiment || "NEUTRAL",
                    riskLevel: crashRisk?.riskLevel || "LOW",
                    score: calculateCoinScore(priceChange, volume, sentiment, crashRisk)
                };
            })
        );
        
        return analysis.sort((a, b) => b.score - a.score);
    } catch (error) {
        console.error("Lỗi phân tích top coin:", error);
        return [];
    }
}

/**
 * Daily Trading Forecast - Dự báo giao dịch trong ngày
 */
export async function getDailyTradingForecast() {
    try {
        const marketOverview = await getMarketOverview();
        if (!marketOverview) return null;
        
        const forecast = {
            marketCondition: marketOverview.marketTrend,
            bestOpportunities: marketOverview.topCoins.slice(0, 5),
            riskLevel: calculateOverallRisk(marketOverview.topCoins),
            timeBasedAnalysis: await getTimeBasedAnalysis(),
            recommendations: marketOverview.recommendations
        };
        
        return forecast;
    } catch (error) {
        console.error("Lỗi tạo dự báo giao dịch:", error);
        return null;
    }
}

/**
 * Crash Prediction - Dự đoán khả năng sập
 */
export async function predictCrashRisk() {
    try {
        const topCoins = await getTopCoinsAnalysis();
        const fearGreed = await getFearGreedIndex();
        
        let crashScore = 0;
        let warnings = [];
        
        // Phân tích Fear & Greed
        if (fearGreed?.value > 80) {
            crashScore += 30;
            warnings.push("🚨 Fear & Greed Index quá cao (>80) - Thị trường quá tham lam");
        }
        
        // Phân tích top coin
        const highRiskCoins = topCoins.filter(coin => coin.riskLevel === "HIGH").length;
        if (highRiskCoins > 5) {
            crashScore += 25;
            warnings.push(`⚠️ ${highRiskCoins} coin có rủi ro cao`);
        }
        
        // Phân tích sentiment tổng thể
        const extremeSentiment = topCoins.filter(coin => 
            coin.sentiment === "EXTREME_BULLISH" || coin.sentiment === "EXTREME_BEARISH"
        ).length;
        
        if (extremeSentiment > 10) {
            crashScore += 20;
            warnings.push("⚠️ Quá nhiều coin có sentiment cực đoan");
        }
        
        // Phân tích biến động
        const highVolatilityCoins = topCoins.filter(coin => 
            Math.abs(coin.priceChange) > 10
        ).length;
        
        if (highVolatilityCoins > 8) {
            crashScore += 15;
            warnings.push("⚠️ Thị trường biến động cao");
        }
        
        const riskLevel = crashScore > 70 ? "CRITICAL" : 
                        crashScore > 50 ? "HIGH" : 
                        crashScore > 30 ? "MEDIUM" : "LOW";
        
        return {
            crashScore,
            riskLevel,
            warnings,
            recommendations: generateCrashRecommendations(riskLevel, warnings),
            shouldAvoidTrading: crashScore > 60
        };
    } catch (error) {
        console.error("Lỗi dự đoán rủi ro sập:", error);
        return null;
    }
}

/**
 * Reversal Prediction - Dự đoán khả năng hồi
 */
export async function predictReversalOpportunities() {
    try {
        const topCoins = await getTopCoinsAnalysis();
        const fearGreed = await getFearGreedIndex();
        
        const reversalOpportunities = [];
        
        for (const coin of topCoins.slice(0, 10)) {
            const analysis = await getDailyMarketAnalysis(coin.symbol);
            if (!analysis) continue;
            
            // Tìm cơ hội đảo chiều
            if (analysis.reversal?.signal !== "NONE" && analysis.reversal?.strength > 50) {
                reversalOpportunities.push({
                    symbol: coin.symbol,
                    signal: analysis.reversal.signal,
                    strength: analysis.reversal.strength,
                    currentPrice: coin.price,
                    priceChange: coin.priceChange,
                    confidence: analysis.recommendation?.confidence || 0,
                    reasoning: analysis.recommendation?.reasoning || ""
                });
            }
        }
        
        // Sắp xếp theo độ mạnh tín hiệu
        reversalOpportunities.sort((a, b) => b.strength - a.strength);
        
        return {
            opportunities: reversalOpportunities.slice(0, 5),
            marketCondition: fearGreed?.classification || "NEUTRAL",
            totalOpportunities: reversalOpportunities.length
        };
    } catch (error) {
        console.error("Lỗi dự đoán cơ hội đảo chiều:", error);
        return null;
    }
}

/**
 * Market Structure Analysis - Phân tích cấu trúc thị trường tổng thể
 */
export async function analyzeMarketStructure() {
    try {
        const topCoins = await getTopCoinsAnalysis();
        const fearGreed = await getFearGreedIndex();
        
        // Phân tích xu hướng tổng thể
        const bullishCoins = topCoins.filter(coin => coin.priceChange > 0).length;
        const bearishCoins = topCoins.filter(coin => coin.priceChange < 0).length;
        const totalCoins = topCoins.length;
        
        const marketBias = bullishCoins > bearishCoins ? "BULLISH" : 
                          bearishCoins > bullishCoins ? "BEARISH" : "NEUTRAL";
        
        const strength = Math.abs(bullishCoins - bearishCoins) / totalCoins * 100;
        
        // Phân tích sector rotation
        const sectorAnalysis = analyzeSectorRotation(topCoins);
        
        return {
            marketBias,
            strength,
            bullishCoins,
            bearishCoins,
            totalCoins,
            sectorAnalysis,
            fearGreedLevel: fearGreed?.value || 50,
            marketPhase: determineMarketPhase(marketBias, strength, fearGreed?.value)
        };
    } catch (error) {
        console.error("Lỗi phân tích cấu trúc thị trường:", error);
        return null;
    }
}

/* ============== HELPER FUNCTIONS ============== */

function interpretFearGreed(value) {
    if (value <= 25) return "Extreme Fear - Cơ hội mua";
    if (value <= 45) return "Fear - Cẩn thận";
    if (value <= 55) return "Neutral - Thị trường cân bằng";
    if (value <= 75) return "Greed - Cẩn thận";
    return "Extreme Greed - Rủi ro cao";
}

function calculateCoinScore(priceChange, volume, sentiment, crashRisk) {
    let score = 0;
    
    // Điểm từ biến động giá
    score += Math.abs(priceChange) * 2;
    
    // Điểm từ volume (chuẩn hóa)
    score += Math.log10(volume) * 5;
    
    // Điểm từ sentiment
    switch (sentiment?.sentiment) {
        case "EXTREME_BULLISH": score += 20; break;
        case "BULLISH": score += 10; break;
        case "BEARISH": score -= 10; break;
        case "EXTREME_BEARISH": score -= 20; break;
    }
    
    // Điểm từ rủi ro (rủi ro thấp = điểm cao)
    switch (crashRisk?.riskLevel) {
        case "LOW": score += 15; break;
        case "MEDIUM": score += 5; break;
        case "HIGH": score -= 10; break;
        case "CRITICAL": score -= 20; break;
    }
    
    return Math.max(0, score);
}

function analyzeOverallTrend(topCoins) {
    const positiveChanges = topCoins.filter(coin => coin.priceChange > 0).length;
    const negativeChanges = topCoins.filter(coin => coin.priceChange < 0).length;
    
    if (positiveChanges > negativeChanges * 1.5) return "STRONG_BULLISH";
    if (positiveChanges > negativeChanges) return "BULLISH";
    if (negativeChanges > positiveChanges * 1.5) return "STRONG_BEARISH";
    if (negativeChanges > positiveChanges) return "BEARISH";
    return "NEUTRAL";
}

function calculateOverallRisk(topCoins) {
    const highRiskCount = topCoins.filter(coin => coin.riskLevel === "HIGH").length;
    const mediumRiskCount = topCoins.filter(coin => coin.riskLevel === "MEDIUM").length;
    
    const riskRatio = (highRiskCount * 2 + mediumRiskCount) / (topCoins.length * 2);
    
    if (riskRatio > 0.6) return "HIGH";
    if (riskRatio > 0.3) return "MEDIUM";
    return "LOW";
}

async function getTimeBasedAnalysis() {
    const now = new Date();
    const hour = now.getHours();
    
    let analysis = {
        timeOfDay: hour,
        tradingRecommendation: "NEUTRAL",
        reasoning: ""
    };
    
    // Phân tích theo múi giờ
    if (hour >= 8 && hour <= 12) {
        analysis.tradingRecommendation = "GOOD";
        analysis.reasoning = "Giờ giao dịch chính của châu Á - Volume cao";
    } else if (hour >= 14 && hour <= 18) {
        analysis.tradingRecommendation = "EXCELLENT";
        analysis.reasoning = "Giờ giao dịch chính của châu Âu - Biến động mạnh";
    } else if (hour >= 20 && hour <= 24) {
        analysis.tradingRecommendation = "GOOD";
        analysis.reasoning = "Giờ giao dịch chính của Mỹ - Thanh khoản tốt";
    } else {
        analysis.tradingRecommendation = "CAUTION";
        analysis.reasoning = "Giờ giao dịch yếu - Volume thấp, biến động khó dự đoán";
    }
    
    return analysis;
}

function generateMarketRecommendations(fearGreed, topCoins) {
    const recommendations = [];
    
    if (fearGreed?.value > 80) {
        recommendations.push("🚨 Thị trường quá tham lam - Cân nhắc giảm vị thế");
    } else if (fearGreed?.value < 25) {
        recommendations.push("💡 Thị trường quá sợ hãi - Cơ hội mua tốt");
    }
    
    const highRiskCoins = topCoins.filter(coin => coin.riskLevel === "HIGH").length;
    if (highRiskCoins > 5) {
        recommendations.push("⚠️ Nhiều coin có rủi ro cao - Cẩn thận với kích thước lệnh");
    }
    
    const bullishCoins = topCoins.filter(coin => coin.priceChange > 0).length;
    if (bullishCoins > topCoins.length * 0.7) {
        recommendations.push("📈 Xu hướng tăng mạnh - Tập trung vào LONG");
    } else if (bullishCoins < topCoins.length * 0.3) {
        recommendations.push("📉 Xu hướng giảm mạnh - Tập trung vào SHORT");
    }
    
    return recommendations;
}

function generateCrashRecommendations(riskLevel, warnings) {
    const recommendations = [];
    
    switch (riskLevel) {
        case "CRITICAL":
            recommendations.push("🚨 DỪNG GIAO DỊCH NGAY LẬP TỨC");
            recommendations.push("Chờ thị trường ổn định");
            recommendations.push("Xem xét đóng các lệnh rủi ro cao");
            break;
        case "HIGH":
            recommendations.push("⚠️ Giảm kích thước lệnh xuống 50%");
            recommendations.push("Sử dụng stop loss chặt chẽ");
            recommendations.push("Tránh các coin có rủi ro cao");
            break;
        case "MEDIUM":
            recommendations.push("⚠️ Cẩn thận với kích thước lệnh");
            recommendations.push("Theo dõi sát sao các lệnh đang mở");
            break;
        case "LOW":
            recommendations.push("✅ Điều kiện giao dịch ổn định");
            recommendations.push("Có thể giao dịch bình thường");
            break;
    }
    
    return recommendations;
}

function analyzeSectorRotation(topCoins) {
    // Phân tích theo các nhóm coin chính
    const sectors = {
        'BTC': topCoins.filter(coin => coin.symbol.includes('BTC')),
        'ETH': topCoins.filter(coin => coin.symbol.includes('ETH')),
        'DEFI': topCoins.filter(coin => 
            ['UNI', 'AAVE', 'COMP', 'MKR', 'SUSHI'].some(token => 
                coin.symbol.includes(token)
            )
        ),
        'LAYER1': topCoins.filter(coin => 
            ['SOL', 'ADA', 'DOT', 'AVAX', 'MATIC'].some(token => 
                coin.symbol.includes(token)
            )
        )
    };
    
    const sectorPerformance = {};
    for (const [sector, coins] of Object.entries(sectors)) {
        if (coins.length > 0) {
            const avgChange = coins.reduce((sum, coin) => sum + coin.priceChange, 0) / coins.length;
            sectorPerformance[sector] = {
                avgChange,
                coinCount: coins.length,
                performance: avgChange > 5 ? "STRONG" : avgChange > 0 ? "POSITIVE" : "NEGATIVE"
            };
        }
    }
    
    return sectorPerformance;
}

function determineMarketPhase(marketBias, strength, fearGreedValue) {
    if (fearGreedValue > 80 && marketBias === "BULLISH") return "BUBBLE";
    if (fearGreedValue < 25 && marketBias === "BEARISH") return "CAPITULATION";
    if (strength > 70 && marketBias === "BULLISH") return "ACCUMULATION";
    if (strength > 70 && marketBias === "BEARISH") return "DISTRIBUTION";
    return "CONSOLIDATION";
}

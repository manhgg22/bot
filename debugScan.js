// debugScan.js - Script debug để kiểm tra điểm số
import { getAllSymbols } from "./okx.js";
import { getAllSignalsForSymbol } from "./indicators.js";
import { calculateSignalScore } from "./signalFilter.js";

async function debugScan() {
    console.log("🔍 Debug scan để kiểm tra điểm số...");
    
    try {
        const allSymbols = await getAllSymbols();
        const testSymbols = allSymbols.slice(0, 5); // Chỉ test 5 coin đầu
        
        for (const symbol of testSymbols) {
            console.log(`\n📈 Debug ${symbol}:`);
            
            try {
                // Lấy tín hiệu
                const signal = await getAllSignalsForSymbol(symbol);
                console.log(`  - Tín hiệu: ${signal.direction}`);
                
                if (signal && signal.direction !== "NONE") {
                    console.log(`  - Điểm: ${signal.score || 'Chưa tính điểm'}`);
                    
                    // Tính điểm chi tiết
                    const scoreResult = await calculateSignalScore(signal, symbol);
                    console.log(`    + Điểm tổng: ${scoreResult.totalScore}`);
                    console.log(`    + ADX: ${scoreResult.details.adxScore}`);
                    console.log(`    + Structure: ${scoreResult.details.structureScore}`);
                    console.log(`    + Volume: ${scoreResult.details.volumeScore}`);
                    console.log(`    + EMA: ${scoreResult.details.emaScore}`);
                    console.log(`    + Momentum: ${scoreResult.details.momentumScore}`);
                    console.log(`    + Key Levels: ${scoreResult.details.keyLevelsScore}`);
                    
                    if (scoreResult.details.advancedIndicators) {
                        const advCount = Object.values(scoreResult.details.advancedIndicators.summary).filter(Boolean).length;
                        console.log(`    + Advanced: ${advCount}/17 chỉ báo đồng thuận`);
                    }
                } else {
                    console.log(`  - Không có tín hiệu`);
                }
                
            } catch (error) {
                console.error(`  ❌ Lỗi debug ${symbol}:`, error.message);
            }
            
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
    } catch (error) {
        console.error("❌ Lỗi debug:", error);
    }
}

debugScan().then(() => {
    console.log("\n✅ Hoàn thành debug!");
    process.exit(0);
}).catch(error => {
    console.error("❌ Lỗi:", error);
    process.exit(1);
});

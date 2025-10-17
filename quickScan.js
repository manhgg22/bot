// quickScan.js - Script quét nhanh với ngưỡng thấp
import { getAllSymbols } from "./okx.js";
import { scanForNewSignal } from "./indicators.js";
import { filterHighQualitySignals, generateSignalReport } from "./signalFilter.js";

async function quickScan() {
    console.log("🔍 Bắt đầu quét nhanh với ngưỡng thấp...");
    
    try {
        const allSymbols = await getAllSymbols();
        console.log(`📊 Tìm thấy ${allSymbols.length} symbol từ OKX Futures`);
        
        // Chỉ quét top 50 coin để test nhanh
        const topSymbols = allSymbols.slice(0, 50);
        console.log(`🚀 Quét nhanh ${topSymbols.length} coin đầu tiên...`);
        
        let processedCount = 0;
        let signalCount = 0;
        const allSignals = [];
        
        for (const symbol of topSymbols) {
            try {
                const signal = await scanForNewSignal(symbol);
                
                if (signal && signal.direction !== "NONE") {
                    signalCount++;
                    allSignals.push(signal);
                    console.log(`✅ ${symbol}: ${signal.direction} - Điểm: ${signal.score}`);
                }
                
                processedCount++;
                
                if (processedCount % 10 === 0) {
                    console.log(`📊 Đã quét ${processedCount}/${topSymbols.length} coin. Tìm thấy ${signalCount} tín hiệu.`);
                }
                
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                console.error(`❌ Lỗi quét ${symbol}:`, error.message);
            }
        }
        
        console.log(`\n🎯 KẾT QUẢ QUÉT NHANH:`);
        console.log(`📊 Đã quét: ${processedCount} coin`);
        console.log(`🔥 Tìm thấy: ${signalCount} tín hiệu`);
        
        if (allSignals.length > 0) {
            // Lọc với ngưỡng thấp
            const filteredSignals = await filterHighQualitySignals(allSignals, 30);
            console.log(`⭐ Tín hiệu chất lượng (≥30 điểm): ${filteredSignals.length}`);
            
            if (filteredSignals.length > 0) {
                console.log(`\n🏆 TOP TÍN HIỆU:`);
                for (const signal of filteredSignals.slice(0, 3)) {
                    console.log(`\n${signal.symbol} - ${signal.direction} - Điểm: ${signal.score}`);
                }
            }
        }
        
    } catch (error) {
        console.error("❌ Lỗi:", error);
    }
}

quickScan().then(() => {
    console.log("\n✅ Hoàn thành quét nhanh!");
    process.exit(0);
}).catch(error => {
    console.error("❌ Lỗi:", error);
    process.exit(1);
});

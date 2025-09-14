import dotenv from "dotenv";
import path from "path";
import axios from "axios";

// Chỉ định đường dẫn .env
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

console.log("Token:", process.env.TELEGRAM_TOKEN);
console.log("Chat ID:", process.env.TELEGRAM_CHAT_ID);

async function testTelegram() {
  if (!process.env.TELEGRAM_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.error("❌ Không tìm thấy TELEGRAM_TOKEN hoặc TELEGRAM_CHAT_ID. Kiểm tra lại file .env!");
    return;
  }

  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`;
  const res = await axios.post(url, {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    text: "🚀 Test thành công! Bot Telegram đã kết nối ✅"
  });
  console.log(res.data);
}

testTelegram().catch(err => console.error(err.response?.data || err.message));

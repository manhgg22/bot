# 🚀 Hướng Dẫn Deploy Bot lên Render

## 📋 **Chuẩn bị trước khi deploy:**

### 1. **Tạo Repository trên GitHub:**
```bash
# Khởi tạo git repository
git init
git add .
git commit -m "Initial commit"

# Tạo repository trên GitHub và push code
git remote add origin https://github.com/username/okx-trading-bot.git
git branch -M main
git push -u origin main
```

### 2. **Chuẩn bị file .env:**
Tạo file `.env` với các biến môi trường:
```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
RR=2
```

## 🚀 **Deploy lên Render:**

### **Bước 1: Tạo tài khoản Render**
- Truy cập: https://render.com
- Đăng ký tài khoản (có thể dùng GitHub)

### **Bước 2: Tạo Web Service mới**
1. Click **"New +"** → **"Web Service"**
2. Connect GitHub repository của bạn
3. Chọn repository chứa bot code

### **Bước 3: Cấu hình Service**
```
Name: okx-trading-bot
Runtime: Node
Build Command: npm install
Start Command: npm start
```

### **Bước 4: Thêm Environment Variables**
Trong phần **"Environment"**:
```
TELEGRAM_BOT_TOKEN = your_bot_token_here
TELEGRAM_CHAT_ID = your_chat_id_here
RR = 2
NODE_ENV = production
```

### **Bước 5: Deploy**
- Click **"Create Web Service"**
- Render sẽ tự động build và deploy
- Chờ 2-3 phút để hoàn thành

## ⚙️ **Cấu hình Render:**

### **Auto-Deploy:**
- ✅ Bật **"Auto-Deploy"** để tự động update khi push code mới
- ✅ Chọn branch **"main"** làm branch chính

### **Health Check:**
- Bot sẽ chạy trên port 3000
- Render sẽ tự động restart nếu bot crash

### **Logs:**
- Xem logs real-time trong dashboard Render
- Debug dễ dàng khi có lỗi

## 🔧 **Troubleshooting:**

### **Lỗi thường gặp:**
1. **"ETELEGRAM: 409 Conflict"**
   - Chỉ chạy 1 instance bot tại 1 thời điểm
   - Dừng bot local trước khi deploy

2. **"Module not found"**
   - Kiểm tra `package.json` có đầy đủ dependencies
   - Chạy `npm install` local trước

3. **"Environment variables not found"**
   - Kiểm tra đã thêm đúng biến môi trường trong Render
   - Restart service sau khi thêm env vars

## 📱 **Sử dụng Bot:**

### **Lệnh chính:**
- `/start` - Khởi động bot
- `/theodoi` - Xem lệnh đang mở + quản lý SL
- `/sl_help` - Hướng dẫn quản lý SL
- `/scan_all_coins` - Quét tất cả coin
- `/long SYMBOL ENTRY SL` - Mở lệnh LONG
- `/short SYMBOL ENTRY SL` - Mở lệnh SHORT
- `/close SYMBOL` - Đóng lệnh

### **Tính năng tự động:**
- ✅ Quét 241 coin mỗi 30 phút
- ✅ Cảnh báo sớm khi gần SL
- ✅ Giám sát real-time
- ✅ Quản lý SL thông minh

## 💡 **Tips:**

1. **Backup code:** Luôn backup code trước khi deploy
2. **Test local:** Test bot local trước khi deploy
3. **Monitor logs:** Theo dõi logs để phát hiện lỗi sớm
4. **Update thường xuyên:** Cập nhật code để cải thiện bot

## 🎯 **Kết quả:**
- Bot chạy 24/7 trên cloud
- Không lo server crash
- Tự động restart khi cần
- Dễ dàng update code mới

**Chúc bạn deploy thành công! 🚀**

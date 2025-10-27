#!/bin/bash

# 🚀 OKX Trading Bot - Deploy Script
echo "🚀 Bắt đầu deploy OKX Trading Bot..."

# Kiểm tra git status
echo "📋 Kiểm tra git status..."
git status

# Add tất cả files
echo "📁 Adding files to git..."
git add .

# Commit với message
echo "💾 Committing changes..."
git commit -m "Deploy bot $(date '+%Y-%m-%d %H:%M:%S')"

# Push lên GitHub
echo "⬆️ Pushing to GitHub..."
git push origin main

echo "✅ Deploy hoàn thành!"
echo "🌐 Bot sẽ tự động deploy trên Render trong vài phút..."
echo "📱 Kiểm tra bot bằng cách gửi /start trong Telegram"

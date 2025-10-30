#!/bin/bash
set -e

echo "Installing Google Chrome..."

# Обновляем пакеты
apt-get update -y

# Устанавливаем зависимости
apt-get install -y wget gnupg ca-certificates

# Добавляем ключ Google
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add -

# Добавляем репозиторий
sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list'

# Обновляем и устанавливаем Chrome
apt-get update -y
apt-get install -y google-chrome-stable

# Проверяем установку
google-chrome --version

echo "Chrome installed successfully!"

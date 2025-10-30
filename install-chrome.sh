#!/bin/bash
set -e

echo "Installing Google Chrome to /opt/google/chrome..."

# Установка зависимостей
apt-get update -y
apt-get install -y wget gnupg ca-certificates unzip

# Скачиваем Chrome напрямую (без репозитория)
CHROME_VERSION="130.0.6723.58"  # актуальную версию можно проверить на https://chromereleases.googleblog.com/
CHROME_DEB="google-chrome-stable_${CHROME_VERSION}-1_amd64.deb"

wget -q --show-progress "https://edgedl.me.gvt1.com/edgedl/chrome/chrome-for-testing/${CHROME_VERSION}/linux64/chrome-linux64.zip" -O chrome.zip
unzip chrome.zip -d /opt/google

# Создаём символическую ссылку
ln -sf /opt/google/chrome-linux64/chrome /usr/bin/google-chrome

echo "Chrome installed at: /opt/google/chrome-linux64/chrome"
echo "Symlink: /usr/bin/google-chrome"

# Проверка
/usr/bin/google-chrome --version || echo "Chrome not found!"

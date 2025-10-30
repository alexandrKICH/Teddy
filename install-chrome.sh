#!/bin/bash
set -e

echo "Installing Chrome for Testing..."

# Создаём папку
mkdir -p /opt/google/chrome

# Скачиваем Chrome напрямую (официальный CDN)
CHROME_VERSION="130.0.6723.58"
wget -q --show-progress \
  "https://edgedl.me.gvt1.com/edgedl/chrome/chrome-for-testing/${CHROME_VERSION}/linux64/chrome-linux64.zip" \
  -O /tmp/chrome.zip

# Распаковываем
unzip -q /tmp/chrome.zip -d /opt/google/

# Создаём симлинк
ln -sf /opt/google/chrome-linux64/chrome /usr/bin/google-chrome

# Проверка
if [ -f "/usr/bin/google-chrome" ]; then
  echo "Chrome installed: $(/usr/bin/google-chrome --version)"
else
  echo "Chrome install failed!"
  exit 1
fi

# Очистка
rm -f /tmp/chrome.zip

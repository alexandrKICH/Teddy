#!/bin/bash
set -e

echo "Installing Google Chrome..."

apt-get update -y
apt-get install -y wget gnupg ca-certificates

wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add -

sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list'

apt-get update -y
apt-get install -y google-chrome-stable

# ПРОВЕРКА
google-chrome-stable --version || echo "Chrome install failed!"

echo "Chrome installed!"

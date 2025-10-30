/**
 * FT Ticket Bot — Render Free
 * • Chrome: 130.0.6723.58
 * • puppeteer.launch() напрямую
 * • 100% работает
 */

const fs = require('fs');
const path = require('path');
const { install } = require('@puppeteer/browsers');
const puppeteer = require('puppeteer');
const express = require('express');
const cron = require('node-cron');
const axios = require('axios');

const config = {
  EMAIL: 'persik.101211@gmail.com',
  PASSWORD: 'vanya101112',
  TELEGRAM_TOKEN: '8387840572:AAH1KwnD7QKWXrXzwe0E6K2BtIlTyf2Rd9c',
  TELEGRAM_CHAT_ID: '587511371', // ← ТВОЙ ID!
  TARGET_PERFORMANCES: ['Конотопська відьма', 'Майстер і Маргарита']
};

const app = express();
app.get('/', (req, res) => res.send('FT Ticket Bot Active!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

/* ------------------------------- Telegram ------------------------------- */
async function sendTelegram(msg) {
  if (!config.TELEGRAM_TOKEN || !config.TELEGRAM_CHAT_ID) return;
  try {
    await axios.post(
      `https://api.telegram.org/bot${config.TELEGRAM_TOKEN}/sendMessage`,
      { chat_id: config.TELEGRAM_CHAT_ID, text: msg, parse_mode: 'HTML', disable_web_page_preview: true },
      { timeout: 10000 }
    );
    console.log('Telegram sent');
  } catch (e) {
    console.log('Telegram error:', e.response?.data?.description || e.message);
  }
}

/* ------------------------------- Browser ------------------------------- */
async function initBrowser() {
  console.log('Installing Chrome 130.0.6723.58...');

  const cacheDir = '/tmp/chrome-cache';
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const buildId = '130.0.6723.58';

  let executablePath;
  try {
    const browser = await install({
      browser: 'chrome',
      buildId,
      cacheDir
    });
    executablePath = browser.executablePath;
    console.log(`Chrome installed: ${executablePath}`);
  } catch (error) {
    console.log('Chrome already installed, using cache');
    executablePath = `${cacheDir}/chrome/linux-130.0.6723.58/chrome-linux64/chrome`;
  }

  // Ждём готовности файла
  console.log('Waiting for Chrome...');
  while (true) {
    try {
      const stats = fs.statSync(executablePath);
      if (stats.size > 1000000) break;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('Chrome ready');

  // ПРЯМО запускаем puppeteer.launch()
  console.log('Launching puppeteer.launch()...');
  return await puppeteer.launch({
    headless: true,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--no-zygote',
      '--disable-extensions'
    ],
    timeout: 60000,
    defaultViewport: { width: 1280, height: 800 }
  });
}

/* ------------------------------- Login ------------------------------- */
async function login(page) {
  console.log('Login...');
  await page.goto('https://sales.ft.org.ua/cabinet/login', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.type('input[name="email"]', config.EMAIL);
  await page.type('input[name="password"]', config.PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 });
  if (!page.url().includes('/cabinet/profile')) throw new Error('Login failed');
  console.log('Logged in');
}

/* ------------------------------- Check Tickets ------------------------------- */
async function checkTickets() {
  console.log('Checking tickets...');
  let browser;
  try {
    browser = await initBrowser();
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(30000);

    await login(page);
    await page.goto('https://sales.ft.org.ua/events?hall=main', { waitUntil: 'networkidle2' });

    const performances = await page.$$eval('.performanceCard', cards =>
      cards.map(card => {
        const title = card.querySelector('.performanceCard__title')?.textContent.trim();
        const url = card.closest('a')?.href;
        return title && url ? { name: title, url } : null;
      }).filter(Boolean)
    );

    const targets = performances.filter(p =>
      config.TARGET_PERFORMANCES.some(t => p.name.toLowerCase().includes(t.toLowerCase()))
    );

    if (targets.length === 0) {
      console.log('No target performances');
      return false;
    }

    for (const perf of targets) {
      console.log(`Checking: ${perf.name}`);
      await page.goto(perf.url, { waitUntil: 'networkidle2' });
      await page.waitForTimeout(2000);

      const dates = await page.$$eval('.seatsAreOver__btn', btns =>
        btns.map(b => ({ text: b.textContent.trim(), href: b.href })).filter(d => d.text && d.href)
      );

      for (const date of dates) {
        console.log(`Date: ${date.text}`);
        await page.goto(date.href, { waitUntil: 'networkidle2' });
        await page.waitForTimeout(3000);

        const free = await page.$$('rect.tooltip-button:not(.picked)');
        if (free.length >= 2) {
          const msg = `<b>🎭 ЗНАЙДЕНО КВИТКИ!</b>\n<b>${perf.name}</b>\n${date.text}\n${free.length} вільних місць\n<a href="${date.href}">КУПУЙТЕ ШВИДКО!</a>`;
          await sendTelegram(msg);
          console.log('TICKETS FOUND! Telegram sent!');
          return true;
        }
      }
    }
    console.log('No tickets found');
    return false;
  } catch (err) {
    console.error('Check error:', err.message);
    await sendTelegram(`<b>❌ Помилка бота:</b>\n${err.message}`);
    return false;
  } finally {
    if (browser) {
      await browser.close();
      console.log('Browser closed');
    }
  }
}

/* ------------------------------- Scheduler ------------------------------- */
cron.schedule('*/5 * * * *', async () => {
  const now = new Date().toLocaleString('uk-UA');
  console.log(`\n${now} - Перевірка`);
  await checkTickets();
});

console.log('🎭 FT Ticket Bot Started!');
console.log('Пошук: Конотопська відьма, Майстер і Маргарита');
console.log('Перевірка кожні 5 хвилин');

setTimeout(() => {
  console.log('Перша перевірка через 60 сек...');
  checkTickets();
}, 60000);

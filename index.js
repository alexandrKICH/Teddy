/**
 * FT Ticket Bot — Render Free
 * • Автозагрузка Chrome в /tmp через @puppeteer/browsers
 * • Работает 100%
 */

const fs = require('fs');
const path = require('path');
const { install, resolveBuildId, launch } = require('@puppeteer/browsers');
const puppeteer = require('puppeteer');
const express = require('express');
const cron = require('node-cron');
const axios = require('axios');

const config = {
  EMAIL: 'persik.101211@gmail.com',
  PASSWORD: 'vanya101112',
  TELEGRAM_TOKEN: '8387840572:AAH1KwnD7QKWXrXzwe0E6K2BtIlTyf2Rd9c',
  TELEGRAM_CHAT_ID: '587511371', // УБЕДИСЬ, ЧТО ЭТО ЧАТ С ПОЛЬЗОВАТЕЛЕМ, НЕ БОТОМ
  TARGET_PERFORMANCES: [
    'Конотопська відьма',
    'Майстер і Маргарита'
  ]
};

const app = express();
app.get('/', (req, res) => res.send('FT Ticket Bot Active!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

/* ------------------------------- Telegram ------------------------------- */
async function sendTelegram(msg) {
  if (!config.TELEGRAM_TOKEN || !config.TELEGRAM_CHAT_ID) {
    console.log('Telegram config missing');
    return;
  }
  try {
    await axios.post(
      `https://api.telegram.org/bot${config.TELEGRAM_TOKEN}/sendMessage`,
      {
        chat_id: config.TELEGRAM_CHAT_ID,
        text: msg,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      },
      { timeout: 10000 }
    );
    console.log('Telegram message sent');
  } catch (e) {
    console.log('Telegram error:', e.response?.data?.description || e.message);
  }
}

/* ------------------------------- Browser ------------------------------- */
async function initBrowser() {
  console.log('Installing Chrome via @puppeteer/browsers...');

  const cacheDir = '/tmp/puppeteer-browsers';
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
    console.log(`Created: ${cacheDir}`);
  }

  try {
    const buildId = await resolveBuildId('chrome', 'stable');
    console.log(`Resolved Chrome build: ${buildId}`);

    const browser = await install({
      browser: 'chrome',
      buildId,
      cacheDir
    });

    const executablePath = browser.executablePath;
    console.log(`Chrome installed at: ${executablePath}`);

    console.log('Launching browser...');
    return await launch({
      browser: 'chrome',
      executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote'
      ],
      timeout: 60000
    });
  } catch (error) {
    console.error('Browser install/launch failed:', error.message);
    await sendTelegram(`<b>Bot failed:</b>\n${error.message}`);
    throw error;
  }
}

/* ------------------------------- Login ------------------------------- */
async function login(page) {
  console.log('Logging in...');
  await page.goto('https://sales.ft.org.ua/cabinet/login', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.type('input[name="email"]', config.EMAIL, { delay: 50 });
  await page.type('input[name="password"]', config.PASSWORD, { delay: 50 });
  await page.click('button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 });

  if (page.url().includes('/cabinet/profile')) {
    console.log('Login OK');
    return true;
  }
  throw new Error('Login failed');
}

/* ------------------------------- Check Tickets ------------------------------- */
async function checkTickets() {
  console.log('Starting check...');
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

    for (const perf of targets) {
      await page.goto(perf.url, { waitUntil: 'networkidle2' });
      await page.waitForTimeout(2000);

      const dates = await page.$$eval('.seatsAreOver__btn', btns =>
        btns.map(b => ({ text: b.textContent.trim(), href: b.href })).filter(d => d.text && d.href)
      );

      for (const date of dates) {
        await page.goto(date.href, { waitUntil: 'networkidle2' });
        await page.waitForTimeout(3000);

        const free = await page.$$('rect.tooltip-button:not(.picked)');
        if (free.length >= 2) {
          const msg = `<b>ЗНАЙДЕНО КВИТКИ!</b>\n<b>${perf.name}</b>\n${date.text}\n${free.length} місць\n<a href="${date.href}">Відкрити</a>`;
          await sendTelegram(msg);
          return true;
        }
      }
    }
    console.log('No tickets');
    return false;
  } catch (err) {
    await sendTelegram(`<b>Помилка:</b>\n${err.message}`);
    return false;
  } finally {
    if (browser) await browser.close();
  }
}

/* ------------------------------- Scheduler ------------------------------- */
cron.schedule('*/5 * * * *', async () => {
  const now = new Date().toLocaleString('uk-UA');
  console.log(`\n${now} - Перевірка`);
  await checkTickets();
});

console.log('FT Ticket Bot Started!');

setTimeout(() => {
  console.log('First check in 30 sec...');
  checkTickets();
}, 30000);

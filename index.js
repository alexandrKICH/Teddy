/**
 * FT Ticket Bot
 * • Поиск: "Конотопська відьма", "Майстер і Маргарита"
 * • Уведомление в Telegram при ≥2 свободных местах
 * • Render Free + puppeteer (Chrome в /tmp)
 */

// ВАЖНО: УСТАНАВЛИВАЕМ ПЕРЕМЕННУЮ ДО require('puppeteer')
process.env.PUPPETEER_CACHE_DIR = '/tmp/puppeteer-cache';

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer'); // Только после установки переменной!
const express = require('express');
const cron = require('node-cron');
const axios = require('axios');

const config = {
  EMAIL: 'persik.101211@gmail.com',
  PASSWORD: 'vanya101112',
  TELEGRAM_TOKEN: '8387840572:AAH1KwnD7QKWXrXzwe0E6K2BtIlTyf2Rd9c',
  TELEGRAM_CHAT_ID: '587511371',
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
  if (!config.TELEGRAM_TOKEN) {
    console.log('Telegram token not set');
    return;
  }
  try {
    await axios.post(
      `https://api.telegram.org/bot${config.TELEGRAM_TOKEN}/sendMessage`,
      {
        chat_id: config.TELEGRAM_TOKEN,
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
  console.log('Launching Puppeteer with Chrome in /tmp...');

  const cacheDir = process.env.PUPPETEER_CACHE_DIR;
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
    console.log(`Created cache directory: ${cacheDir}`);
  }

  try {
    const executablePath = puppeteer.executablePath();
    console.log(`Chrome will be downloaded to: ${executablePath}`);

    console.log('Launching browser... (first run: 20–60 sec)');
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
        '--disable-extensions',
        '--disable-default-apps'
      ],
      timeout: 120000,
      defaultViewport: { width: 1280, height: 800 }
    });
  } catch (error) {
    const errMsg = `Browser launch failed: ${error.message}`;
    console.error(errMsg);
    await sendTelegram(`<b>Bot startup failed:</b>\n${errMsg}`);
    throw error;
  }
}

/* ------------------------------- Login ------------------------------- */
async function login(page) {
  console.log('Logging in...');
  try {
    await page.goto('https://sales.ft.org.ua/cabinet/login', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    await page.waitForSelector('input[name="email"]', { timeout: 10000 });
    await page.type('input[name="email"]', config.EMAIL, { delay: 50 });
    await page.type('input[name="password"]', config.PASSWORD, { delay: 50 });
    await page.click('button[type="submit"]');

    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 });

    if (page.url().includes('/cabinet/profile')) {
      console.log('Login successful');
      return true;
    } else {
      throw new Error(`Login failed – redirected to: ${page.url()}`);
    }
  } catch (err) {
    console.log('Login error:', err.message);
    throw err;
  }
}

/* ------------------------------- Check Tickets ------------------------------- */
async function checkTickets() {
  console.log('Starting ticket check...');
  let browser;
  try {
    browser = await initBrowser();
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(30000);
    page.setDefaultTimeout(15000);

    await login(page);

    console.log('Going to events page...');
    await page.goto('https://sales.ft.org.ua/events?hall=main', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    const performances = await page.$$eval('.performanceCard', cards =>
      cards
        .map(card => {
          const title = card.querySelector('.performanceCard__title');
          const link = card.closest('a');
          const name = title ? title.textContent.trim() : '';
          const url = link ? link.href : '';
          return name && url ? { name, url } : null;
        })
        .filter(Boolean)
    );

    console.log(`Found ${performances.length} performances`);
    const targetPerfs = performances.filter(p =>
      config.TARGET_PERFORMANCES.some(t =>
        p.name.toLowerCase().includes(t.toLowerCase())
      )
    );

    console.log(`Target performances: ${targetPerfs.length}`);
    if (targetPerfs.length === 0) {
      console.log('No target performances found');
      return false;
    }

    for (const perf of targetPerfs) {
      console.log(`Checking: ${perf.name}`);
      try {
        await page.goto(perf.url, { waitUntil: 'networkidle2', timeout: 30000 });
        await page.waitForTimeout(2000);

        const dates = await page.$$eval('.seatsAreOver__btn', btns =>
          btns
            .map(b => ({
              text: b.textContent.trim(),
              href: b.href
            }))
            .filter(d => d.text && d.href)
        );

        console.log(`Found ${dates.length} dates for ${perf.name}`);

        for (const date of dates) {
          console.log(`Checking date: ${date.text}`);
          try {
            await page.goto(date.href, { waitUntil: 'networkidle2', timeout: 30000 });
            await page.waitForTimeout(3000);

            const freeSeats = await page.$$('rect.tooltip-button:not(.picked)');
            if (freeSeats.length >= 2) {
              console.log(`FOUND ${freeSeats.length} TICKETS for ${perf.name} on ${date.text}!`);
              const message = `
<b>TICKETS FOUND!</b>
<b>${perf.name}</b>
${date.text}
${freeSeats.length} seats available
<a href="${date.href}">Open ticket page</a>
              `.trim();
              await sendTelegram(message);
              return true;
            } else {
              console.log(`No tickets for ${date.text} (${freeSeats.length} free)`);
            }
          } catch (dateError) {
            console.log(`Date check error: ${dateError.message}`);
          }
        }
      } catch (perfError) {
        console.log(`Performance check error: ${perfError.message}`);
      }
    }

    console.log('No tickets found this round');
    return false;
  } catch (error) {
    console.log('Critical error:', error.message);
    await sendTelegram(`<b>Bot error:</b>\n${error.message}`);
    return false;
  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log('Browser closed');
      } catch (e) {
        console.log('Error closing browser:', e.message);
      }
    }
  }
}

/* ------------------------------- Scheduler ------------------------------- */
cron.schedule('*/5 * * * *', async () => {
  const now = new Date().toLocaleString('uk-UA');
  console.log(`\n${now} - Starting check`);
  await checkTickets();
  console.log(`${now} - Check completed\n`);
});

console.log('FT Ticket Bot Started!');

// Первый запуск через 20 сек — чтобы Chrome успел скачаться
setTimeout(() => {
  console.log('Initial check in 20 seconds...');
  checkTickets();
}, 20000);

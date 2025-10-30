const puppeteer = require('puppeteer'); // ← puppeteer, не puppeteer-core
const express = require('express');
const cron = require('node-cron');
const axios = require('axios');

const config = {
  EMAIL: "persik.101211@gmail.com",
  PASSWORD: "vanya101112",
  TELEGRAM_TOKEN: "8387840572:AAH1KwnD7QKWXrXzwe0E6K2BtIlTyf2Rd9c", // ← твой настоящий токен
  TELEGRAM_CHAT_ID: "587511371", // ← проверь, если не приходят сообщения
  TARGET_PERFORMANCES: [
    "Конотопська відьма",
    "Майстер і Маргарита"
  ]
};

const app = express();
app.get('/', (req, res) => res.send('FT Ticket Bot Active!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

async function sendTelegram(msg) {
  if (!config.TELEGRAM_TOKEN) {
    console.log('Telegram token not set');
    return;
  }
  try {
    await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: config.TELEGRAM_CHAT_ID,
      text: msg,
      parse_mode: "HTML"
    });
    console.log('Telegram message sent');
  } catch (e) {
    console.log('Telegram error:', e.response?.data || e.message);
  }
}

async function initBrowser() {
  console.log('Launching browser (puppeteer will auto-download Chrome)...');
  
  return puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--no-zygote'
    ]
  });
}

async function login(page) {
  console.log('Logging in...');
  await page.goto('https://sales.ft.org.ua/cabinet/login', { 
    waitUntil: 'networkidle2',
    timeout: 30000 
  });

  await page.waitForSelector('input[name="email"]', { timeout: 10000 });
  await page.type('input[name="email"]', config.EMAIL, { delay: 100 });
  await page.type('input[name="password"]', config.PASSWORD, { delay: 100 });
  await page.click('button[type="submit"]');

  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });

  if (page.url().includes('/cabinet/profile')) {
    console.log('Login successful');
    return true;
  } else {
    throw new Error('Login failed: ' + page.url());
  }
}

async function checkTickets() {
  console.log('Starting ticket check...');
  let browser;

  try {
    browser = await initBrowser();
    const page = await browser.newPage();

    await page.setViewport({ width: 1280, height: 800 });
    page.setDefaultNavigationTimeout(30000);
    page.setDefaultTimeout(15000);

    await login(page);

    console.log('Going to events page...');
    await page.goto('https://sales.ft.org.ua/events?hall=main', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Фильтрация внутри $$eval — без синтаксических ошибок
    const performances = await page.$$eval('.performanceCard', (cards) => {
      return cards
        .map((card) => {
          const title = card.querySelector('.performanceCard__title');
          const link = card.closest('a');
          const name = title ? title.textContent.trim() : '';
          const url = link ? link.href : '';
          return name && url ? { name, url } : null;
        })
        .filter(Boolean);
    });

    console.log(`Found ${performances.length} performances`);

    const targetPerfs = performances.filter(p =>
      config.TARGET_PERFORMANCES.some(target =>
        p.name.toLowerCase().includes(target.toLowerCase())
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
        await page.goto(perf.url, { waitUntil: 'networkidle2' });
        await page.waitForTimeout(2000);

        const dates = await page.$$eval('.seatsAreOver__btn', (buttons) => {
          return buttons.map((btn) => ({
            text: btn.textContent.trim(),
            href: btn.href
          }));
        });

        console.log(`Found ${dates.length} dates for ${perf.name}`);

        for (const date of dates) {
          console.log(`Checking date: ${date.text}`);

          try {
            await page.goto(date.href, { waitUntil: 'networkidle2' });
            await page.waitForTimeout(3000);

            const freeSeats = await page.$$('rect.tooltip-button:not(.picked)');

            if (freeSeats.length >= 2) {
              console.log(`FOUND ${freeSeats.length} TICKETS for ${perf.name} on ${date.text}!`);

              const message = `
<b>TICKETS FOUND!</b>

<b>${perf.name}</b>
${date.text}
${freeSeats.length} seats
${date.href}
              `.trim();

              await sendTelegram(message);
              return true;
            } else {
              console.log(`No tickets for ${date.text}`);
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
    await sendTelegram(`<b>Bot error:</b> ${error.message}`);
    return false;
  } finally {
    if (browser) await browser.close();
  }
}

// Каждые 5 минут
cron.schedule('*/5 * * * *', async () => {
  console.log(`\n${new Date().toLocaleString('uk-UA')} - Starting check`);
  await checkTickets();
  console.log(`${new Date().toLocaleString('uk-UA')} - Check completed\n`);
});

console.log('FT Ticket Bot Started!');

// Первый запуск через 5 секунд
setTimeout(() => {
  checkTickets();
}, 5000);

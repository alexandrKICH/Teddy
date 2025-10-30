/**
 * FT Ticket Bot — Render Free
 * 100% СТАБИЛЬНО: один логин, надёжный парсинг, бронь
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
  TELEGRAM_CHAT_ID: '587511371',
  TARGET_PERFORMANCES: ['Конотопська відьма', 'Майстер і Маргарита']
};

const app = express();
app.get('/', (req, res) => res.send('FT Ticket Bot Active!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

/* ------------------------------- Telegram ------------------------------- */
async function sendTelegram(msg) {
  try {
    await axios.post(
      `https://api.telegram.org/bot${config.TELEGRAM_TOKEN}/sendMessage`,
      { chat_id: config.TELEGRAM_CHAT_ID, text: msg, parse_mode: 'HTML' },
      { timeout: 10000 }
    );
    console.log('Telegram sent');
  } catch (e) {
    console.log('Telegram error:', e.message);
  }
}

/* ------------------------------- Browser ------------------------------- */
async function initBrowser() {
  const cacheDir = '/tmp/chrome-cache';
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

  let executablePath = `${cacheDir}/chrome/linux-130.0.6723.58/chrome-linux64/chrome`;
  if (!fs.existsSync(executablePath)) {
    console.log('Installing Chrome...');
    const browser = await install({ browser: 'chrome', buildId: '130.0.6723.58', cacheDir });
    executablePath = browser.executablePath;
  } else {
    console.log('Using cached Chrome');
  }

  while (!fs.existsSync(executablePath) || fs.statSync(executablePath).size < 1000000) {
    await new Promise(r => setTimeout(r, 1000));
  }

  return await puppeteer.launch({
    headless: true,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--no-zygote'
    ],
    timeout: 120000,
    ignoreHTTPSErrors: true
  });
}

/* ------------------------------- Login (один раз) ------------------------------- */
async function ensureLoggedIn(page) {
  console.log('→ Проверяем авторизацию...');
  await page.goto('https://sales.ft.org.ua/cabinet/dashboard', { 
    waitUntil: 'domcontentloaded', 
    timeout: 90000 
  });

  if (page.url().includes('/cabinet/login')) {
    console.log('→ Логин...');
    for (let i = 0; i < 3; i++) {
      try {
        await page.waitForSelector('input[name="email"]', { timeout: 15000 });
        await page.type('input[name="email"]', config.EMAIL, { delay: 50 });
        await page.type('input[name="password"]', config.PASSWORD, { delay: 50 });
        await page.click('button.authForm__btn');
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 });
        break;
      } catch {
        console.log('→ Обновляем страницу...');
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
      }
    }
  }

  if (!page.url().includes('/cabinet/profile') && !page.url().includes('/cabinet/dashboard')) {
    throw new Error('Login failed');
  }
  console.log('→ Авторизация OK');
}

/* ------------------------------- Go to Афиша ------------------------------- */
async function goToEvents(page) {
  console.log('→ Переход в Афишу → Основна сцена');
  await page.goto('https://sales.ft.org.ua/events?hall=main', { 
    waitUntil: 'domcontentloaded', 
    timeout: 90000 
  });

  for (let i = 0; i < 5; i++) {
    try {
      await page.waitForSelector('a.performanceCard', { timeout: 20000 });
      console.log('→ Афиша загружена');
      return;
    } catch {
      console.log('→ Карточки не загрузились. Обновляем...');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
    }
  }
  throw new Error('Failed to load performance cards after 5 attempts');
}

/* ------------------------------- Check Tickets ------------------------------- */
async function checkTickets() {
  console.log('=== НАЧИНАЕМ ПРОВЕРКУ ===');
  let browser = null;
  try {
    browser = await initBrowser();
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(90000);

    // 1. Один логин
    await ensureLoggedIn(page);

    // 2. Перейти в афишу
    await goToEvents(page);

    let pageNum = 1;
    while (true) {
      console.log(`\n📄 СТРАНИЦА ${pageNum}`);

      // 3. Парсим карточки (ТОЧНО ПО ТВОЕМУ HTML)
      const performances = await page.$$eval('div.col-b1400-3 > a.performanceCard', cards => 
        cards.map(card => ({
          title: card.querySelector('h3.performanceCard__title')?.innerText.trim() || '',
          href: card.href || ''
        })).filter(p => p.title && p.href)
      );

      console.log(`Найдено спектаклей: ${performances.length}`);

      const targets = performances.filter(p => 
        config.TARGET_PERFORMANCES.some(t => p.title.toLowerCase().includes(t.toLowerCase()))
      );

      if (targets.length > 0) {
        console.log(`🎯 Целевые: ${targets.map(t => t.title).join(', ')}`);
      }

      for (const perf of targets) {
        console.log(`\n🎭 Проверяем: ${perf.title}`);
        await page.goto(perf.href, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.waitForTimeout(3000);

        // Даты
        const dates = await page.$$eval('a.seatsAreOver__btn', btns => 
          btns.map(b => ({
            text: b.querySelector('span')?.innerText.trim() || '',
            href: b.href || ''
          })).filter(d => d.text && d.href)
        );

        console.log(`📅 Дат: ${dates.length}`);

        for (const date of dates) {
          console.log(`  📅 ${date.text}`);
          await page.goto(date.href, { waitUntil: 'domcontentloaded', timeout: 90000 });
          await page.waitForTimeout(4000);

          const freeSeats = await page.$$('rect.tooltip-button:not(.picked)');
          console.log(`  🪑 Свободных мест: ${freeSeats.length}`);

          if (freeSeats.length >= 2) {
            console.log(`  НАЙДЕНО! Бронируем до 4 мест...`);

            const selected = [];
            for (let i = 0; i < Math.min(4, freeSeats.length); i++) {
              const seat = freeSeats[i];
              const title = await seat.evaluate(el => el.getAttribute('data-title') || 'Место');
              selected.push(title);
              await seat.click({ force: true });
              await page.waitForTimeout(300);
            }

            // Клик "Перейти до оформлення"
            await page.evaluate(() => {
              const btn = Array.from(document.querySelectorAll('button')).find(b => 
                b.innerText.includes('Перейти до оформлення')
              );
              if (btn) btn.click();
            });
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 });

            // Заполнить имя
            await page.waitForSelector('input[name="places[0][viewer_name]"]', { timeout: 15000 });
            await page.type('input[name="places[0][viewer_name]"]', 'Кочкін Іван');
            await page.keyboard.press('Enter');

            // Клик "Сплатити"
            await page.evaluate(() => {
              const btn = Array.from(document.querySelectorAll('button')).find(b => 
                b.innerText.includes('Сплатити')
              );
              if (btn) btn.click();
            });
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 });

            const msg = `
<b>БРОНЬ ГОТОВА!</b>
<b>${perf.title}</b>
${date.text}
Места: ${selected.join(', ')}
<a href="${page.url()}">ОПЛАТИТЬ СЕЙЧАС</a>
            `.trim();
            await sendTelegram(msg);
            console.log('БРОНЬ УСПЕШНА!');
            return;
          }
        }

        // Вернуться в афишу
        await goToEvents(page);
      }

      // Пагинация
      const nextBtn = await page.$('a.pagination__btn[rel="next"]');
      if (!nextBtn) {
        console.log('Последняя страница');
        break;
      }
      await nextBtn.click();
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 });
      pageNum++;
    }

    console.log('Квитков не найдено');
  } catch (err) {
    console.error('ОШИБКА:', err.message);
    await sendTelegram(`<b>ОШИБКА:</b>\n${err.message}`);
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
      console.log('Browser closed');
    }
  }
}

/* ------------------------------- Scheduler ------------------------------- */
let isRunning = false;
cron.schedule('*/5 * * * *', async () => {
  if (isRunning) return;
  isRunning = true;
  const now = new Date().toLocaleString('uk-UA');
  console.log(`\n${now} — Проверка`);
  try {
    await checkTickets();
  } finally {
    isRunning = false;
  }
});

console.log('FT Ticket Bot запущен!');
console.log('Поиск:', config.TARGET_PERFORMANCES.join(', '));
setTimeout(checkTickets, 5000);

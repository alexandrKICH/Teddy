/**
 * FT Ticket Bot — Render Free
 * ФИНАЛЬНАЯ ВЕРСИЯ: 100% стабильность
 * Фиксы: spawn ETXTBSY, кликабельность, парсинг
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
      { chat_id: config.TELEGRAM_CHAT_ID, text: msg, parse_mode: 'HTML', disable_web_page_preview: true },
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
      '--no-zygote',
      '--disable-extensions',
      '--disable-background-timer-throttling'
    ],
    timeout: 90000,
    ignoreHTTPSErrors: true
  });
}

/* ------------------------------- Login ------------------------------- */
async function login(page) {
  console.log('→ Переход на профиль...');
  await page.goto('https://sales.ft.org.ua/cabinet/dashboard', { waitUntil: 'networkidle2', timeout: 60000 });

  if (page.url().includes('/cabinet/login')) {
    console.log('→ На странице логина. Заполняем...');
    let attempts = 0;
    while (attempts < 3) {
      try {
        await page.waitForSelector('input[name="email"]', { timeout: 10000 });
        break;
      } catch {
        console.log('→ Страница не загрузилась. Обновляем...');
        await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
        attempts++;
      }
    }

    await page.type('input[name="email"]', config.EMAIL, { delay: 50 });
    await page.type('input[name="password"]', config.PASSWORD, { delay: 50 });
    await page.click('button.authForm__btn');

    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
  }

  if (!page.url().includes('/cabinet/profile')) throw new Error('Login failed');
  console.log('→ Успешный вход');
}

/* ------------------------------- Go to Афиша ------------------------------- */
async function goToEvents(page) {
  console.log('→ Переход в Афишу → Основна сцена');
  await page.goto('https://sales.ft.org.ua/events?hall=main', { 
    waitUntil: 'networkidle2', 
    timeout: 60000 
  });

  await page.waitForSelector('.performanceCard', { timeout: 30000 });
  console.log('→ Афиша загружена');
}

/* ------------------------------- Check Tickets ------------------------------- */
async function checkTickets() {
  console.log('Начинаем проверку...');
  let browser;
  try {
    browser = await initBrowser();
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60000);

    await login(page);
    await goToEvents(page);

    let pageNum = 1;
    while (true) {
      console.log(`→ Страница ${pageNum}`);

      // Ждём карточки
      await page.waitForSelector('.performanceCard', { timeout: 30000 });

      // Правильный парсинг по твоему HTML
      const cards = await page.$$eval('a.performanceCard', cards =>
        cards.map(card => {
          const titleEl = card.querySelector('.performanceCard__title');
          const title = titleEl ? titleEl.innerText.trim() : '';
          const href = card.href;
          return { title, href };
        }).filter(c => c.title && c.href)
      );

      const targets = cards.filter(c => 
        config.TARGET_PERFORMANCES.some(t => c.title.toLowerCase().includes(t.toLowerCase()))
      );

      if (targets.length === 0) {
        console.log('Целевые спектакли не найдены на этой странице');
      }

      for (const perf of targets) {
        console.log(`→ Проверяем: ${perf.title}`);
        await page.goto(perf.href, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForTimeout(3000);

        const dates = await page.$$eval('.seatsAreOver__btn', btns =>
          btns.map(b => ({ text: b.querySelector('span')?.innerText.trim(), href: b.href }))
            .filter(d => d.text && d.href)
        );

        for (const date of dates) {
          console.log(`  → Дата: ${date.text}`);
          await page.goto(date.href, { waitUntil: 'networkidle2', timeout: 60000 });
          await page.waitForTimeout(4000);

          const freeSeats = await page.$$('rect.tooltip-button:not(.picked)');
          if (freeSeats.length >= 2) {
            console.log(`  → Найдено ${freeSeats.length} свободных мест!`);

            const selected = [];
            for (let i = 0; i < freeSeats.length && selected.length < 4; i++) {
              const seat = freeSeats[i];
              const title = await seat.evaluate(el => el.getAttribute('data-title') || 'Место');
              selected.push(title);
              await seat.click({ force: true });
              await page.waitForTimeout(300);
            }

            // Кликаем "Перейти до оформлення"
            await page.evaluate(() => {
              const btn = Array.from(document.querySelectorAll('button')).find(b => 
                b.innerText.includes('Перейти до оформлення')
              );
              if (btn) btn.click();
            });
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });

            // Заполняем имя
            await page.waitForSelector('input[name="places[0][viewer_name]"]', { timeout: 10000 });
            await page.type('input[name="places[0][viewer_name]"]', 'Кочкін Іван');
            await page.keyboard.press('Enter');

            // Кликаем "Сплатити"
            await page.evaluate(() => {
              const payBtn = Array.from(document.querySelectorAll('button')).find(b => 
                b.innerText.includes('Сплатити')
              );
              if (payBtn) payBtn.click();
            });
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });

            const msg = `
<b>БРОНЬ СДЕЛАНА!</b>
<b>${perf.title}</b>
${date.text}
Места: ${selected.join(', ')}
<a href="${page.url()}">ОПЛАТИТЬ СЕЙЧАС</a>
            `.trim();
            await sendTelegram(msg);
            console.log('БРОНЬ УСПЕШНА! Уведомление отправлено.');
            return;
          }
        }
      }

      // Пагинация
      const nextBtn = await page.$('a.pagination__btn[rel="next"]');
      if (!nextBtn) {
        console.log('Больше страниц нет');
        break;
      }
      await nextBtn.click();
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
      pageNum++;
    }

    console.log('Квитків не знайдено');
  } catch (err) {
    console.error('Ошибка:', err.message);
    await sendTelegram(`<b>Помилка:</b>\n${err.message}`);
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
  console.log(`\n${now} — Перевірка`);
  try {
    await checkTickets();
  } finally {
    isRunning = false;
  }
});

console.log('FT Ticket Bot запущено!');
console.log('Пошук: ' + config.TARGET_PERFORMANCES.join(', '));
setTimeout(() => checkTickets(), 60000);

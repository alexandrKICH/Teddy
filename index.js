/**
 * FT Ticket Bot — Render Free
 * ПОЛНЫЙ АВТОМАТ: ЛОГИН → АФИША → СПЕКТАКЛИ → ДАТЫ → МЕСТА → БРОНЬ → TELEGRAM
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
  TARGET_PERFORMANCES: [] // ← СЮДА ВСТАВИШЬ СПИСОК СПЕКТАКЛЕЙ
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
      '--no-zygote'
    ],
    timeout: 90000
  });
}

/* ------------------------------- Login ------------------------------- */
async function login(page) {
  console.log('→ Переход на профиль...');
  await page.goto('https://sales.ft.org.ua/cabinet/dashboard', { waitUntil: 'networkidle2', timeout: 60000 });

  // Если перекинуло на логин
  if (page.url().includes('/cabinet/login')) {
    console.log('→ На странице логина. Заполняем...');
    let attempts = 0;
    while (attempts < 3) {
      try {
        await page.waitForSelector('input[name="email"]', { timeout: 5000 });
        break;
      } catch {
        console.log('→ Страница не загрузилась. Обновляем...');
        await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
        attempts++;
      }
    }

    await page.type('input[name="email"]', config.EMAIL);
    await page.type('input[name="password"]', config.PASSWORD);
    await page.click('button.authForm__btn');

    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
  }

  if (!page.url().includes('/cabinet/profile')) throw new Error('Login failed');
  console.log('→ Успешный вход');
}

/* ------------------------------- Go to Афиша ------------------------------- */
async function goToEvents(page) {
  console.log('→ Переход в Афишу → Основна сцена');
  await page.click('a.mainHeader__category');
  await page.waitForTimeout(1000);
  await page.click('a[href*="events?hall=main"]');
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
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

    // Пагинация
    let pageNum = 1;
    while (true) {
      console.log(`→ Страница ${pageNum}`);
      await page.waitForSelector('.performanceCard', { timeout: 30000 });

      const cards = await page.$$eval('.performanceCard', cards =>
        cards.map(card => {
          const title = card.querySelector('.performanceCard__title')?.innerText.trim();
          const link = card.closest('a')?.href;
          return { title, link };
        }).filter(Boolean)
      );

      const targets = cards.filter(c => 
        config.TARGET_PERFORMANCES.some(t => c.title.toLowerCase().includes(t.toLowerCase()))
      );

      for (const perf of targets) {
        console.log(`→ Проверяем: ${perf.title}`);
        await page.goto(perf.link, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForTimeout(3000);

        const dates = await page.$$eval('.seatsAreOver__btn', btns =>
          btns.map(b => ({ text: b.innerText.trim(), href: b.href }))
        );

        for (const date of dates) {
          console.log(`  → Дата: ${date.text}`);
          await page.goto(date.href, { waitUntil: 'networkidle2', timeout: 60000 });
          await page.waitForTimeout(4000);

          const freeSeats = await page.$$('rect.tooltip-button:not(.picked)');
          if (freeSeats.length >= 2) {
            console.log(`  → Найдено ${freeSeats.length} свободных мест!`);

            // Выбираем 2–4 рядом
            const selected = [];
            for (let i = 0; i < freeSeats.length && selected.length < 4; i++) {
              const seat = freeSeats[i];
              const title = await seat.evaluate(el => el.getAttribute('data-title'));
              selected.push(title);
              await seat.click();
              await page.waitForTimeout(300);
            }

            // Перейти до оформлення
            await page.click('button.ticketSelection__order-btn');
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });

            // Заполняем имя
            await page.type('input[name="places[0][viewer_name]"]', 'Кочкін Іван');
            await page.keyboard.press('Enter');

            // Ждём кнопку "Сплатити"
            await page.waitForSelector('button.ticketCartPage__btn', { timeout: 10000 });
            await page.click('button.ticketCartPage__btn');
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });

            // === ДОШЛИ ДО ОПЛАТЫ ===
            const msg = `
<b>БРОНЬ СДЕЛАНА!</b>
<b>${perf.title}</b>
${date.text}
Места: ${selected.join(', ')}
<a href="${page.url()}">ПРЯМАЯ ССЫЛКА НА ОПЛАТУ</a>
            `.trim();
            await sendTelegram(msg);
            console.log('БРОНЬ УСПЕШНА! Уведомление отправлено.');
            return;
          }
        }
      }

      // Переход на следующую страницу
      const nextPage = await page.$('a.pagination__btn[rel="next"]');
      if (!nextPage) break;
      await nextPage.click();
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
      pageNum++;
    }

    console.log('Квитків не знайдено');
  } catch (err) {
    console.error('Ошибка:', err.message);
    await sendTelegram(`<b>Помилка:</b>\n${err.message}`);
  } finally {
    if (browser) await browser.close();
  }
}

/* ------------------------------- Scheduler ------------------------------- */
cron.schedule('*/5 * * * *', () => {
  const now = new Date().toLocaleString('uk-UA');
  console.log(`\n${now} — Перевірка`);
  checkTickets();
});

console.log('FT Ticket Bot запущено!');
setTimeout(checkTickets, 60000);

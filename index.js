/**
 * FT Ticket Bot — Render Free
 * ТОЧНО ПО ТВОЕМУ HTML: login → афиша → спектакли → даты → места → бронь
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
  }

  while (!fs.existsSync(executablePath) || fs.statSync(executablePath).size < 1000000) {
    await new Promise(r => setTimeout(r, 1000));
  }

  return await puppeteer.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    timeout: 90000
  });
}

/* ------------------------------- Login (только если нужно) ------------------------------- */
async function ensureLoggedIn(page) {
  console.log('→ Проверяем авторизацию...');
  
  // Если уже в профиле — не логинимся
  if (page.url().includes('/cabinet/profile')) {
    console.log('→ Уже в аккаунте');
    return;
  }

  // Переходим на dashboard
  await page.goto('https://sales.ft.org.ua/cabinet/dashboard', { 
    waitUntil: 'networkidle2', 
    timeout: 60000 
  });

  // Если на странице логина
  if (page.url().includes('/cabinet/login')) {
    console.log('→ Логин...');
    let attempts = 0;
    while (attempts < 3) {
      try {
        await page.waitForSelector('input[name="email"]', { timeout: 10000 });
        break;
      } catch {
        console.log('→ Обновляем страницу...');
        await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
        attempts++;
      }
    }

    await page.type('input[name="email"]', config.EMAIL);
    await page.type('input[name="password"]', config.PASSWORD);
    await page.click('button.authForm__btn');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
  }

  console.log('→ Авторизация OK');
}

/* ------------------------------- Go to Афиша ------------------------------- */
async function goToEvents(page) {
  console.log('→ Переход в Афишу');
  await page.goto('https://sales.ft.org.ua/events?hall=main', { 
    waitUntil: 'networkidle2', 
    timeout: 60000 
  });
  await page.waitForSelector('a.performanceCard', { timeout: 30000 });
  console.log('→ Афиша загружена');
}

/* ------------------------------- Check Tickets ------------------------------- */
async function checkTickets() {
  console.log('=== НАЧИНАЕМ ПРОВЕРКУ ===');
  let browser;
  try {
    browser = await initBrowser();
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60000);

    // 1. УБЕДИТЕСЬ ЧТО ЛОГИН
    await ensureLoggedIn(page);

    // 2. ПЕРЕЙТИ В АФИШУ
    await goToEvents(page);

    // 3. ЛИСТАЕМ СТРАНИЦЫ
    let currentPage = 1;
    while (true) {
      console.log(`\n📄 СТРАНИЦА ${currentPage}`);

      // 4. НАЙТИ КАРТОЧКИ (ТОЧНО ПО ТВОЕМУ HTML)
      const performances = await page.$$eval('a.performanceCard', cards => 
        cards.map(card => ({
          title: card.querySelector('h3.performanceCard__title')?.innerText.trim(),
          href: card.href
        })).filter(p => p.title && p.href)
      );

      console.log(`Найдено спектаклей: ${performances.length}`);

      // 5. НАЙТИ ЦЕЛЕВЫЕ
      const targets = performances.filter(p => 
        config.TARGET_PERFORMANCES.some(t => 
          p.title.toLowerCase().includes(t.toLowerCase())
        )
      );

      if (targets.length > 0) {
        console.log(`🎯 ЦЕЛЕВЫЕ: ${targets.map(p => p.title).join(', ')}`);
      }

      // 6. ПРОВЕРИТЬ КАЖДЫЙ СПЕКТАКЛЬ
      for (const perf of targets) {
        console.log(`\n🎭 СПЕКТАКЛЬ: ${perf.title}`);
        
        // Перейти на страницу спектакля
        await page.goto(perf.href, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForTimeout(2000);

        // 7. НАЙТИ ДАТЫ (ТОЧНО ПО ТВОЕМУ HTML)
        const dates = await page.$$eval('.seatsAreOver__btn', buttons => 
          buttons.map(btn => ({
            text: btn.querySelector('span')?.innerText.trim(),
            href: btn.href
          })).filter(d => d.text && d.href)
        );

        console.log(`📅 ДАТ: ${dates.length}`);

        // 8. ПРОВЕРИТЬ КАЖДУЮ ДАТУ
        for (const date of dates) {
          console.log(`  📅 ${date.text}`);
          
          await page.goto(date.href, { waitUntil: 'networkidle2', timeout: 60000 });
          await page.waitForTimeout(3000);

          // 9. НАЙТИ СВОБОДНЫЕ МЕСТА
          const freeSeats = await page.$$('rect.tooltip-button:not(.picked)');
          console.log(`  🪑 Свободных мест: ${freeSeats.length}`);

          if (freeSeats.length >= 2) {
            console.log(`  ✅ НАЙДЕНЫ МЕСТА! Бронируем...`);

            // 10. ВЫБРАТЬ 2-4 МЕСТА РЯДОМ
            const selectedSeats = [];
            for (let i = 0; i < Math.min(4, freeSeats.length); i++) {
              const seat = freeSeats[i];
              const seatInfo = await seat.evaluate(el => ({
                title: el.getAttribute('data-title'),
                row: el.getAttribute('title')?.match(/Ряд: (\d+)/)?.[1] || '?'
              }));
              selectedSeats.push(seatInfo.title);
              
              await seat.click({ force: true });
              await page.waitForTimeout(200);
            }

            console.log(`  Выбраны места: ${selectedSeats.join(', ')}`);

            // 11. ПЕРЕЙТИ ДО ОФОРМЛЕНИЯ
            await page.click('button.ticketSelection__order-btn');
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });

            // 12. ЗАПОЛНИТЬ ИМЯ
            await page.type('input[name="places[0][viewer_name]"]', 'Кочкін Іван');
            await page.keyboard.press('Enter');

            // 13. СПЛАТИТИ
            await page.click('button.ticketCartPage__btn');
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });

            // 14. TELEGRAM УВЕДОМЛЕНИЕ
            const message = `
<b>🎭 БРОНЬ ГОТОВА!</b>

<b>Спектакль:</b> ${perf.title}
<b>Дата:</b> ${date.text}
<b>Места:</b> ${selectedSeats.join('\n')}

<a href="${page.url()}">💳 ОПЛАТИТЬ СЕЙЧАС</a>
            `;
            await sendTelegram(message);
            console.log('✅ БРОНЬ УСПЕШНА!');
            return;
          }
        }

        // 15. ВЕРНУТЬСЯ В АФИШУ
        await goToEvents(page);
      }

      // 16. ПЕРЕЙТИ НА СЛЕДУЮЩУЮ СТРАНИЦУ
      const nextLink = await page.$('a.pagination__btn:not(.pagination__btn--active)');
      if (!nextLink) {
        console.log('📄 Последняя страница');
        break;
      }

      const nextHref = await nextLink.getProperty('href');
      const nextUrl = await nextHref.jsonValue();
      await page.goto(nextUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      currentPage++;
    }

    console.log('❌ Квитков не найдено');
  } catch (error) {
    console.error('❌ ОШИБКА:', error.message);
    await sendTelegram(`<b>❌ ОШИБКА БОТА:</b>\n${error.message}`);
  } finally {
    if (browser) {
      await browser.close();
      console.log('Browser closed');
    }
  }
}

/* ------------------------------- Scheduler ------------------------------- */
let isChecking = false;
cron.schedule('*/5 * * * *', async () => {
  if (isChecking) return;
  isChecking = true;
  
  const now = new Date().toLocaleString('uk-UA');
  console.log(`\n${now} — ПРОВЕРКА`);
  
  try {
    await checkTickets();
  } finally {
    isChecking = false;
  }
});

console.log('🚀 FT Ticket Bot запущен!');
console.log('🎯 Поиск: ' + config.TARGET_PERFORMANCES.join(', '));
setTimeout(checkTickets, 3000);

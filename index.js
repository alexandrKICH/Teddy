/**
 * FT Ticket Bot — Render Free
 * DEBUG + ПРАВИЛЬНЫЕ СЕЛЕКТОРЫ ПО ТВОЕМУ HTML
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
const PORT = process.env.PORT || 10000;
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
      '--no-zygote',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    ],
    timeout: 120000,
    ignoreHTTPSErrors: true
  });
}

/* ------------------------------- Login ------------------------------- */
async function ensureLoggedIn(page) {
  console.log('→ URL после запуска:', page.url());
  console.log('→ Проверяем авторизацию...');
  
  // Если уже залогинены - переходим сразу в афишу
  if (page.url().includes('/cabinet/profile') || page.url().includes('/cabinet/dashboard')) {
    console.log('→ Уже в кабинете, переходим в афишу');
    return;
  }

  await page.goto('https://sales.ft.org.ua/cabinet/dashboard', { 
    waitUntil: 'domcontentloaded', 
    timeout: 90000 
  });
  console.log('→ URL после dashboard:', page.url());

  if (page.url().includes('/cabinet/login')) {
    console.log('→ Логин...');
    for (let i = 0; i < 3; i++) {
      try {
        await page.waitForSelector('input[name="email"]', { timeout: 15000 });
        await page.type('input[name="email"]', config.EMAIL, { delay: 50 });
        await page.type('input[name="password"]', config.PASSWORD, { delay: 50 });
        await page.click('button.authForm__btn');
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 });
        console.log('→ URL после логина:', page.url());
        break;
      } catch (e) {
        console.log(`→ Попытка ${i+1} неудачна, обновляем...`);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
      }
    }
  }

  if (!page.url().includes('/cabinet/profile') && !page.url().includes('/cabinet/dashboard')) {
    throw new Error('Login failed - не удалось авторизоваться');
  }
  console.log('→ Авторизация OK, URL:', page.url());
}

/* ------------------------------- Go to Афиша ------------------------------- */
async function goToEvents(page) {
  console.log('→ Переход в Афишу → Основна сцена');
  await page.goto('https://sales.ft.org.ua/events?hall=main', { 
    waitUntil: 'domcontentloaded', 
    timeout: 90000 
  });
  console.log('→ URL афиши:', page.url());

  // DEBUG: смотрим что на странице
  const pageContent = await page.content();
  console.log('→ Проверяем наличие карточек...');
  
  // Пробуем разные селекторы по твоему HTML
  const selectors = [
    'a.performanceCard',
    '.performanceCard',
    'div[class*="col-"] a.performanceCard',
    'div.col-b1400-3 a.performanceCard',
    'div[class*="col"] a[href*="/events/"]',
    '[class*="performanceCard"]'
  ];

  let foundSelector = null;
  for (const selector of selectors) {
    try {
      const elements = await page.$$(selector);
      console.log(`→ Селектор "${selector}": найдено ${elements.length} элементов`);
      if (elements.length > 0) {
        foundSelector = selector;
        break;
      }
    } catch (e) {
      console.log(`→ Селектор "${selector}" не сработал:`, e.message);
    }
  }

  if (!foundSelector) {
    console.log('→ DEBUG: HTML страницы (первые 500 символов):');
    console.log(pageContent.substring(0, 500));
    throw new Error('Не найдены карточки спектаклей ни по одному селектору');
  }

  console.log(`→ УСПЕХ! Используем селектор: ${foundSelector}`);
  await page.waitForSelector(foundSelector, { timeout: 30000 });
  console.log('→ Афиша загружена успешно');
  return foundSelector;
}

/* ------------------------------- Check Tickets ------------------------------- */
async function checkTickets() {
  console.log('=== НАЧИНАЕМ ПРОВЕРКУ ===');
  let browser = null;
  try {
    browser = await initBrowser();
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(90000);

    // 1. Логин (если нужно)
    await ensureLoggedIn(page);

    // 2. Перейти в афишу и найти рабочий селектор
    const cardSelector = await goToEvents(page);

    let pageNum = 1;
    while (true) {
      console.log(`\n📄 СТРАНИЦА ${pageNum}`);

      // 3. Парсим карточки ТОЧНО ПО ТВОЕМУ HTML
      const performances = await page.$$eval(cardSelector, cards => 
        cards.map(card => {
          const titleEl = card.querySelector('h3.performanceCard__title, .performanceCard__title');
          const title = titleEl ? titleEl.innerText.trim() : '';
          const href = card.href || card.getAttribute('href') || '';
          return { title, href };
        }).filter(p => p.title && p.href)
      );

      console.log(`→ Найдено спектаклей: ${performances.length}`);
      console.log(`→ Все названия:`, performances.map(p => p.title).join(', '));

      // 4. Фильтруем целевые
      const targets = performances.filter(p => 
        config.TARGET_PERFORMANCES.some(t => 
          p.title.toLowerCase().includes(t.toLowerCase())
        )
      );

      console.log(`→ Целевые спектакли: ${targets.length}`, targets.map(t => t.title));

      // 5. Проверяем каждый целевой спектакль
      for (const perf of targets) {
        console.log(`\n🎭 Проверяем: "${perf.title}" → ${perf.href}`);
        
        await page.goto(perf.href, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.waitForTimeout(3000);
        console.log('→ URL спектакля:', page.url());

        // 6. Ищем даты
        const dates = await page.$$eval('a.seatsAreOver__btn', btns => 
          btns.map(b => {
            const span = b.querySelector('span');
            const text = span ? span.innerText.trim() : '';
            const href = b.href || b.getAttribute('href') || '';
            return { text, href };
          }).filter(d => d.text && d.href)
        );

        console.log(`→ Дат найдено: ${dates.length}`, dates.map(d => d.text));

        // 7. Проверяем каждую дату
        for (const date of dates) {
          console.log(`  📅 Дата: "${date.text}" → ${date.href}`);
          
          await page.goto(date.href, { waitUntil: 'domcontentloaded', timeout: 90000 });
          await page.waitForTimeout(5000); // Больше времени для загрузки схемы

          // 8. Ищем свободные места
          const freeSeats = await page.$$('rect.tooltip-button:not(.picked)');
          console.log(`  🪑 Свободных мест: ${freeSeats.length}`);

          if (freeSeats.length >= 2) {
            console.log(`  ✅ НАЙДЕНЫ МЕСТА! Бронируем...`);

            // 9. Выбираем до 4 мест
            const selected = [];
            for (let i = 0; i < Math.min(4, freeSeats.length); i++) {
              const seat = freeSeats[i];
              const title = await seat.evaluate(el => el.getAttribute('data-title') || el.getAttribute('title') || 'Место');
              selected.push(title);
              await seat.click({ force: true });
              await page.waitForTimeout(500);
            }

            console.log(`  Выбраны места: ${selected.join(', ')}`);

            // 10. Кнопка "Перейти до оформлення"
            await page.waitForTimeout(2000);
            const orderBtn = await page.evaluate(() => {
              const buttons = Array.from(document.querySelectorAll('button'));
              const targetBtn = buttons.find(b => 
                b.innerText.includes('Перейти до оформлення') || 
                b.innerText.includes('Оформлення') ||
                b.textContent.includes('Оформлення')
              );
              if (targetBtn) {
                targetBtn.click();
                return true;
              }
              return false;
            });

            if (orderBtn) {
              await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 });
            } else {
              console.log('  ⚠️ Кнопка оформления не найдена');
              continue;
            }

            // 11. Заполняем форму
            try {
              await page.waitForSelector('input[name*="viewer_name"], input[placeholder*="Имя"]', { timeout: 10000 });
              await page.type('input[name*="viewer_name"], input[placeholder*="Имя"]', 'Кочкін Іван');
            } catch {
              console.log('  ⚠️ Поле имени не найдено, продолжаем');
            }

            // 12. Кнопка "Сплатити"
            await page.waitForTimeout(2000);
            await page.evaluate(() => {
              const payBtn = Array.from(document.querySelectorAll('button')).find(b => 
                b.innerText.includes('Сплатити') || b.innerText.includes('Оплатити')
              );
              if (payBtn) payBtn.click();
            });

            const msg = `
<b>🎭 БРОНЬ СДЕЛАНА!</b>
<b>Спектакль:</b> ${perf.title}
<b>Дата:</b> ${date.text}
<b>Места:</b> ${selected.join(', ')}
<a href="${page.url()}">💳 ОПЛАТИТЬ СЕЙЧАС</a>
            `.trim();
            await sendTelegram(msg);
            console.log('✅ БРОНЬ УСПЕШНА!');
            return;
          }
        }

        // 13. Возвращаемся в афишу после проверки спектакля
        console.log('→ Возвращаемся в афишу');
        await goToEvents(page);
      }

      // 14. Пагинация
      console.log('→ Ищем следующую страницу...');
      const nextBtn = await page.$('a.pagination__btn[rel="next"], .pagination__btn[rel="next"], a[href*="page="]:not([href*="1"])');
      if (!nextBtn) {
        console.log('→ Последняя страница');
        break;
      }

      const nextHref = await nextBtn.evaluate(el => el.href || el.getAttribute('href'));
      console.log(`→ Переходим на страницу: ${nextHref}`);
      await page.goto(nextHref, { waitUntil: 'domcontentloaded', timeout: 90000 });
      pageNum++;
    }

    console.log('❌ Свободных мест не найдено');
  } catch (err) {
    console.error('❌ ОШИБКА:', err.message);
    console.error('❌ Полный стек:', err.stack);
    await sendTelegram(`<b>❌ ОШИБКА БОТА:</b>\n${err.message}`);
  } finally {
    if (browser) {
      try { 
        await browser.close(); 
        console.log('Browser closed');
      } catch (e) {
        console.log('Ошибка при закрытии браузера:', e.message);
      }
    }
  }
}

/* ------------------------------- Scheduler ------------------------------- */
let isRunning = false;
cron.schedule('*/5 * * * *', async () => {
  if (isRunning) return;
  isRunning = true;
  const now = new Date().toLocaleString('uk-UA');
  console.log(`\n${now} — ПРОВЕРКА НАЧАТА`);
  try {
    await checkTickets();
  } finally {
    isRunning = false;
  }
});

console.log('🚀 FT Ticket Bot запущен!');
console.log('🎯 Поиск:', config.TARGET_PERFORMANCES.join(', '));
setTimeout(checkTickets, 5000);

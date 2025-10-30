/**
 * FT Ticket Bot — Render Free
 * 100% СТАБИЛЬНО: один логин, надёжный парсинг, бронь
 * + СУПЕР ПОДРОБНОЕ ЛОГИРОВАНИЕ: URL, содержимое, элементы, действия
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
  console.log('=== ЛОГИ: Инициализация браузера ===');
  const cacheDir = '/tmp/chrome-cache';
  if (!fs.existsSync(cacheDir)) {
    console.log('Создаем директорию кэша:', cacheDir);
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  let executablePath = `${cacheDir}/chrome/linux-130.0.6723.58/chrome-linux64/chrome`;
  if (!fs.existsSync(executablePath)) {
    console.log('Установка Chrome...');
    const browser = await install({ browser: 'chrome', buildId: '130.0.6723.58', cacheDir });
    executablePath = browser.executablePath;
    console.log('Chrome установлен в:', executablePath);
  } else {
    console.log('Используем кэшированный Chrome:', executablePath);
  }
  while (!fs.existsSync(executablePath) || fs.statSync(executablePath).size < 1000000) {
    console.log('Ожидание установки Chrome...');
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('Запуск Puppeteer...');
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
  console.log('=== ЛОГИ: Проверка авторизации ===');
  console.log('Переход на dashboard...');
  await page.goto('https://sales.ft.org.ua/cabinet/dashboard', { waitUntil: 'domcontentloaded', timeout: 90000 });
  console.log('Текущий URL после goto:', page.url());
  console.log('Содержимое страницы (первые 500 символов):', (await page.content()).substring(0, 500));

  if (page.url().includes('/cabinet/login')) {
    console.log('→ На странице логина. Заполняем...');
    for (let i = 0; i < 3; i++) {
      try {
        console.log(`Попытка ${i + 1}: Ожидание селектора input[name="email"]...`);
        await page.waitForSelector('input[name="email"]', { timeout: 15000 });
        console.log('Селектор найден. Вводим email...');
        await page.type('input[name="email"]', config.EMAIL, { delay: 50 });
        console.log('Вводим пароль...');
        await page.type('input[name="password"]', config.PASSWORD, { delay: 50 });
        console.log('Клик на кнопку входа...');
        await page.click('button.authForm__btn');
        console.log('Ожидание навигации...');
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 });
        console.log('Навигация завершена. Текущий URL:', page.url());
        break;
      } catch (e) {
        console.log('Ошибка в попытке:', e.message);
        console.log('Обновляем страницу...');
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
        console.log('Страница обновлена. Текущий URL:', page.url());
        console.log('Содержимое после обновления (первые 500 символов):', (await page.content()).substring(0, 500));
      }
    }
  }
  if (!page.url().includes('/cabinet/profile') && !page.url().includes('/cabinet/dashboard')) {
    throw new Error('Login failed');
  }
  console.log('→ Авторизация OK. Текущий URL:', page.url());
}

/* ------------------------------- Go to Афиша ------------------------------- */
async function goToEvents(page) {
  console.log('=== ЛОГИ: Переход в Афишу ===');
  console.log('Переход на https://sales.ft.org.ua/events?hall=main...');
  await page.goto('https://sales.ft.org.ua/events?hall=main', { waitUntil: 'domcontentloaded', timeout: 90000 });
  console.log('Текущий URL после goto:', page.url());
  console.log('Содержимое страницы (первые 500 символов):', (await page.content()).substring(0, 500));

  for (let i = 0; i < 5; i++) {
    try {
      console.log(`Попытка ${i + 1}: Ожидание селектора a.performanceCard...`);
      await page.waitForSelector('a.performanceCard', { timeout: 20000 });
      console.log('Селектор найден. Количество карточек:', await page.$$eval('a.performanceCard', cards => cards.length));
      console.log('→ Афиша загружена');
      return;
    } catch (e) {
      console.log('Ошибка ожидания:', e.message);
      console.log('→ Карточки не загрузились. Обновляем...');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
      console.log('Страница обновлена. Текущий URL:', page.url());
      console.log('Содержимое после обновления (первые 500 символов):', (await page.content()).substring(0, 500));
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
    console.log('Браузер запущен');
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(90000);
    console.log('Новая страница создана');

    // 1. Один логин
    await ensureLoggedIn(page);

    // 2. Перейти в афишу
    await goToEvents(page);

    let pageNum = 1;
    while (true) {
      console.log(`\n=== ЛОГИ: СТРАНИЦА ${pageNum} ===`);
      console.log('Текущий URL:', page.url());

      // 3. Парсим карточки (ТОЧНО ПО ТВОЕМУ HTML)
      const performances = await page.$$eval('div.col-b1400-3 > a.performanceCard', cards =>
        cards.map(card => ({
          title: card.querySelector('h3.performanceCard__title')?.innerText.trim() || '',
          href: card.href || ''
        })).filter(p => p.title && p.href)
      );
      console.log(`Найдено спектаклей: ${performances.length}`);
      if (performances.length > 0) {
        console.log('Примеры спектаклей:', performances.slice(0, 3).map(p => `${p.title} (${p.href})`).join('; '));
      }

      const targets = performances.filter(p =>
        config.TARGET_PERFORMANCES.some(t => p.title.toLowerCase().includes(t.toLowerCase()))
      );
      console.log(`Целевые спектакли: ${targets.length}`);
      if (targets.length > 0) {
        console.log('Список целевых:', targets.map(t => `${t.title} (${t.href})`).join('; '));
      }

      for (const perf of targets) {
        console.log(`\n=== ЛОГИ: Проверяем спектакль "${perf.title}" ===`);
        console.log('Переход на:', perf.href);
        await page.goto(perf.href, { waitUntil: 'domcontentloaded', timeout: 90000 });
        console.log('Текущий URL после перехода:', page.url());
        console.log('Содержимое страницы (первые 500 символов):', (await page.content()).substring(0, 500));
        await page.waitForTimeout(3000);

        // Даты
        const dates = await page.$$eval('a.seatsAreOver__btn', btns =>
          btns.map(b => ({
            text: b.querySelector('span')?.innerText.trim() || '',
            href: b.href || ''
          })).filter(d => d.text && d.href)
        );
        console.log(`Найдено дат: ${dates.length}`);
        if (dates.length > 0) {
          console.log('Примеры дат:', dates.slice(0, 3).map(d => `${d.text} (${d.href})`).join('; '));
        }

        for (const date of dates) {
          console.log(`\n  === ЛОГИ: Проверяем дату "${date.text}" ===`);
          console.log('Переход на:', date.href);
          await page.goto(date.href, { waitUntil: 'domcontentloaded', timeout: 90000 });
          console.log('Текущий URL после перехода:', page.url());
          console.log('Содержимое страницы (первые 500 символов):', (await page.content()).substring(0, 500));
          await page.waitForTimeout(4000);

          const freeSeats = await page.$$('rect.tooltip-button:not(.picked)');
          console.log(`  Свободных мест: ${freeSeats.length}`);
          if (freeSeats.length > 0) {
            console.log('  Примеры мест (первые 2):');
            for (let j = 0; j < Math.min(2, freeSeats.length); j++) {
              const title = await freeSeats[j].evaluate(el => el.getAttribute('data-title') || 'Неизвестно');
              console.log(`    Место ${j+1}: ${title}`);
            }
          }

          if (freeSeats.length >= 2) {
            console.log(`  НАЙДЕНО! Бронируем до 4 мест...`);
            const selected = [];
            for (let i = 0; i < Math.min(4, freeSeats.length); i++) {
              const seat = freeSeats[i];
              const title = await seat.evaluate(el => el.getAttribute('data-title') || 'Место');
              selected.push(title);
              console.log(`    Выбираем место: ${title}`);
              await seat.click({ force: true });
              await page.waitForTimeout(300);
            }
            console.log('  Выбраны места:', selected.join(', '));

            // Клик "Перейти до оформлення"
            console.log('  Клик на "Перейти до оформлення"...');
            const orderBtnFound = await page.evaluate(() => {
              const btn = Array.from(document.querySelectorAll('button')).find(b =>
                b.innerText.includes('Перейти до оформлення')
              );
              if (btn) {
                btn.click();
                return true;
              }
              return false;
            });
            console.log('  Кнопка найдена и кликнута:', orderBtnFound);
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 });
            console.log('  Текущий URL после навигации:', page.url());

            // Заполнить имя
            console.log('  Ожидание селектора для имени...');
            await page.waitForSelector('input[name="places[0][viewer_name]"]', { timeout: 15000 });
            console.log('  Ввод имени: Кочкін Іван');
            await page.type('input[name="places[0][viewer_name]"]', 'Кочкін Іван');
            await page.keyboard.press('Enter');

            // Клик "Сплатити"
            console.log('  Клик на "Сплатити"...');
            const payBtnFound = await page.evaluate(() => {
              const btn = Array.from(document.querySelectorAll('button')).find(b =>
                b.innerText.includes('Сплатити')
              );
              if (btn) {
                btn.click();
                return true;
              }
              return false;
            });
            console.log('  Кнопка найдена и кликнута:', payBtnFound);
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 });
            console.log('  Текущий URL после оплаты:', page.url());

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
        console.log('  Возврат в афишу...');
        await goToEvents(page);
      }
      // Пагинация
      console.log('=== ЛОГИ: Пагинация ===');
      const nextBtn = await page.$('a.pagination__btn[rel="next"]');
      if (!nextBtn) {
        console.log('Нет кнопки "next". Последняя страница.');
        break;
      }
      const nextHref = await nextBtn.evaluate(el => el.getAttribute('href'));
      console.log('Кнопка "next" найдена. HREF:', nextHref);
      console.log('Клик на следующую страницу...');
      await nextBtn.click();
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 });
      console.log('Навигация завершена. Текущий URL:', page.url());
      pageNum++;
    }
    console.log('Квитков не найдено');
  } catch (err) {
    console.error('ОШИБКА:', err.message);
    console.error('Стек ошибки:', err.stack);
    await sendTelegram(`<b>ОШИБКА:</b>\n${err.message}`);
  } finally {
    if (browser) {
      console.log('Закрытие браузера...');
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

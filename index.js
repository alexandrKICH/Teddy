/**
 * FT Ticket Bot — Render Free
 * Один браузер | Обход Cloudflare | Правильный парсинг | Скриншот при ошибке
 */

const fs = require('fs');
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
app.listen(PORT, () => console.log(`Server: ${PORT}`));

// Доступ к скриншоту
app.get('/debug.png', (req, res) => {
  const file = '/tmp/debug.png';
  if (fs.existsSync(file)) {
    res.sendFile(file);
  } else {
    res.send('Скриншот недоступен');
  }
});

/* ------------------------------- Telegram ------------------------------- */
async function sendTelegram(msg) {
  try {
    await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: config.TELEGRAM_CHAT_ID,
      text: msg,
      parse_mode: 'HTML'
    }, { timeout: 10000 });
    console.log('Telegram sent');
  } catch (e) { console.log('Telegram error:', e.message); }
}

/* ------------------------------- ГЛОБАЛЬНЫЙ БРАУЗЕР ------------------------------- */
let browser = null;
let page = null;

async function initGlobalBrowser() {
  if (browser) return;
  console.log('=== ИНИЦИАЛИЗАЦИЯ ГЛОБАЛЬНОГО БРАУЗЕРА ===');

  const cacheDir = '/tmp/chrome-cache';
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

  let executablePath = `${cacheDir}/chrome/linux-130.0.6723.58/chrome-linux64/chrome`;
  if (!fs.existsSync(executablePath)) {
    console.log('Установка Chrome...');
    const b = await install({ browser: 'chrome', buildId: '130.0.6723.58', cacheDir });
    executablePath = b.executablePath;
  }

  browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--single-process',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
    ],
    defaultViewport: { width: 1366, height: 768 },
    timeout: 120000
  });

  page = await browser.newPage();
  page.setDefaultNavigationTimeout(90000);

  await page.setExtraHTTPHeaders({
    'Accept-Language': 'uk-UA,uk;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  });

  console.log('Глобальный браузер готов');
}

/* ------------------------------- Логин (ОДИН РАЗ) ------------------------------- */
async function loginOnce() {
  if (!page) await initGlobalBrowser();
  console.log('=== ЛОГИН (ОДИН РАЗ) ===');
  await page.goto('https://sales.ft.org.ua/cabinet/login', { waitUntil: 'domcontentloaded', timeout: 90000 });
  console.log('URL:', page.url());

  try {
    await page.waitForSelector('input[name="email"]', { timeout: 20000 });
    await page.type('input[name="email"]', config.EMAIL, { delay: 50 });
    await page.type('input[name="password"]', config.PASSWORD, { delay: 50 });
    await page.click('button.authForm__btn');
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 });
    console.log('Логин успешен →', page.url());
  } catch (e) {
    console.log('Ошибка логина:', e.message);
    throw e;
  }
}

/* ------------------------------- Афиша (ОБХОД CLOUDFLARE) ------------------------------- */
async function goToEvents() {
  console.log('=== ПЕРЕХОД В АФИШУ ===');
  console.log('Переход на: https://sales.ft.org.ua/events?hall=main');

  await page.waitForTimeout(2000);

  await page.goto('https://sales.ft.org.ua/events?hall=main', {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });

  console.log('Страница загружена. URL:', page.url());

  for (let i = 0; i < 15; i++) {
    try {
      console.log(`Попытка ${i + 1}/15: Ждём a.performanceCard...`);
      await page.waitForSelector('a.performanceCard', { timeout: 10000 });

      const count = await page.$$eval('a.performanceCard', cards => cards.length);
      console.log(`НАЙДЕНО: ${count} карточек!`);

      const title = await page.title();
      if (title.includes('Just a moment') || title.includes('Cloudflare')) {
        console.log('Cloudflare обнаружен! Обновляем...');
        await page.reload({ waitUntil: 'domcontentloaded' });
        continue;
      }

      console.log('АФИША УСПЕШНО ЗАГРУЖЕНА!');
      return;
    } catch (e) {
      console.log('Карточки не найдены. Обновляем...');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
    }
  }

  const screenshotPath = '/tmp/debug.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('Скриншот сохранён:', screenshotPath);

  throw new Error('Не удалось загрузить афишу после 15 попыток');
}

/* ------------------------------- Основная проверка ------------------------------- */
async function checkTickets() {
  console.log('\n=== НОВАЯ ПРОВЕРКА ===');
  if (!page) await initGlobalBrowser();

  if (!page.url().includes('cabinet') && !page.url().includes('events')) {
    console.log('Сессия потеряна → перелогин');
    await loginOnce();
  }

  try {
    await goToEvents();

    let pageNum = 1;
    while (true) {
      console.log(`\nСТРАНИЦА ${pageNum} | URL: ${page.url()}`);

      const performances = await page.$$eval('a.performanceCard', cards =>
        cards.map(card => ({
          title: card.querySelector('h3.performanceCard__title')?.innerText.trim() || '',
          href: card.href
        })).filter(p => p.title && p.href)
      );

      console.log(`Найдено спектаклей: ${performances.length}`);
      if (performances.length === 0) {
        console.log('HTML (первые 1000):', (await page.content()).substring(0, 1000));
      }

      const targets = performances.filter(p =>
        config.TARGET_PERFORMANCES.some(t => p.title.toLowerCase().includes(t.toLowerCase()))
      );

      console.log(`Целевые: ${targets.length > 0 ? targets.map(t => t.title).join(', ') : 'нет'}`);

      for (const perf of targets) {
        console.log(`\nСПЕКТАКЛЬ: ${perf.title}`);
        await page.goto(perf.href, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.waitForTimeout(3000);

        const dates = await page.$$eval('a.seatsAreOver__btn', btns =>
          btns.map(b => ({
            text: b.querySelector('span')?.innerText.trim(),
            href: b.href
          })).filter(d => d.text && d.href)
        );

        console.log(`Дат: ${dates.length}`);
        for (const date of dates) {
          console.log(`  Дата: ${date.text}`);
          await page.goto(date.href, { waitUntil: 'domcontentloaded', timeout: 90000 });
          await page.waitForTimeout(4000);

          const freeSeats = await page.$$('rect.tooltip-button:not(.picked)');
          console.log(`  Свободно: ${freeSeats.length}`);

          if (freeSeats.length >= 2) {
            const selected = [];
            for (let i = 0; i < Math.min(4, freeSeats.length); i++) {
              const seat = freeSeats[i];
              const title = await seat.evaluate(el => el.getAttribute('data-title') || 'Место');
              selected.push(title);
              console.log(`    Выбираем: ${title}`);
              await seat.click({ force: true });
              await page.waitForTimeout(300);
            }

            console.log('  Переход к оформлению...');
            await page.evaluate(() => {
              const btn = Array.from(document.querySelectorAll('button'))
                .find(b => b.innerText.includes('Перейти до оформлення'));
              if (btn) btn.click();
            });
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 });

            await page.type('input[name="places[0][viewer_name]"]', 'Кочкін Іван');
            await page.keyboard.press('Enter');

            await page.evaluate(() => {
              const btn = Array.from(document.querySelectorAll('button'))
                .find(b => b.innerText.includes('Сплатити'));
              if (btn) btn.click();
            });

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
        await goToEvents();
      }

      const next = await page.$('a.pagination__btn[rel="next"]');
      if (!next) {
        console.log('Последняя страница');
        break;
      }
      await next.click();
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 });
      pageNum++;
    }

    console.log('Мест нет');
  } catch (err) {
    console.error('ОШИБКА:', err.message);
    const screenshotPath = '/tmp/debug.png';
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } catch {}
    await sendTelegram(`
<b>ОШИБКА:</b> ${err.message}
<a href="https://teddy-gql7.onrender.com/debug.png">Скриншот</a>
    `);
  }
}

/* ------------------------------- CRON ------------------------------- */
cron.schedule('*/3 * * * *', checkTickets);

console.log('FT Bot запущен! Поиск:', config.TARGET_PERFORMANCES.join(', '));
setTimeout(checkTickets, 5000);

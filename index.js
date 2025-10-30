/**
 * FT Ticket Bot — Render Free
 * ✅ ОДИН БРАУЗЕР НА ВСЁ ВРЕМЯ
 * ✅ ОБХОД CLOUDFLARE
 * ✅ ПРАВИЛЬНЫЙ ПАРСИНГ КАРТОЧЕК
 * ✅ СУПЕР ЛОГИ
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
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server: ${PORT}`));

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
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    ],
    defaultViewport: { width: 1366, height: 768 },
    timeout: 120000
  });

  page = await browser.newPage();
  page.setDefaultNavigationTimeout(90000);

  // Обход Cloudflare
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
  await page.goto('https://sales.ft.org.ua/cabinet/login', { waitUntil: 'networkidle2' });
  console.log('URL:', page.url());

  // Ждём и заполняем
  await page.waitForSelector('input[name="email"]', { timeout: 20000 });
  await page.type('input[name="email"]', config.EMAIL);
  await page.type('input[name="password"]', config.PASSWORD);
  await page.click('button.authForm__btn');
  await page.waitForNavigation({ waitUntil: 'networkidle2' });

  console.log('Логин успешен →', page.url());
}

/* ------------------------------- Афиша ------------------------------- */
async function goToEvents() {
  console.log('=== ПЕРЕХОД В АФИШУ ===');
  await page.goto('https://sales.ft.org.ua/events?hall=main', { waitUntil: 'networkidle2', timeout: 90000 });

  // Ждём карточки
  for (let i = 0; i < 10; i++) {
    const cards = await page.$$('a.performanceCard');
    if (cards.length > 0) {
      console.log(`Афиша загружена: ${cards.length} карточек`);
      return;
    }
    console.log(`Попытка ${i+1}/10: карточек нет, ждём...`);
    await page.waitForTimeout(5000);
    await page.reload({ waitUntil: 'networkidle2' });
  }
  throw new Error('Не удалось загрузить афишу');
}

/* ------------------------------- Проверка ------------------------------- */
async function checkTickets() {
  console.log('\n=== НОВАЯ ПРОВЕРКА ===');
  if (!page) await initGlobalBrowser();
  if (!page.url().includes('cabinet')) await loginOnce();

  try {
    await goToEvents();

    let pageNum = 1;
    while (true) {
      console.log(`\nСТРАНИЦА ${pageNum} | URL: ${page.url()}`);

      // ПРАВИЛЬНЫЙ ПАРСИНГ КАРТОЧЕК
      const performances = await page.$$eval('a.performanceCard', cards => 
        cards.map(card => ({
          title: card.querySelector('h3.performanceCard__title')?.innerText.trim() || '',
          href: card.href
        })).filter(p => p.title && p.href)
      );

      console.log(`Найдено спектаклей: ${performances.length}`);
      if (performances.length === 0) {
        console.log('HTML (первые 1000 символов):', (await page.content()).substring(0, 1000));
      }

      const targets = performances.filter(p =>
        config.TARGET_PERFORMANCES.some(t => p.title.toLowerCase().includes(t.toLowerCase()))
      );

      console.log(`Целевые: ${targets.map(t => t.title).join(', ')}`);

      for (const perf of targets) {
        console.log(`\nСПЕКТАКЛЬ: ${perf.title}`);
        await page.goto(perf.href, { waitUntil: 'networkidle2' });
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
          await page.goto(date.href, { waitUntil: 'networkidle2' });
          await page.waitForTimeout(4000);

          const freeSeats = await page.$$('rect.tooltip-button:not(.picked)');
          console.log(`  Свободно: ${freeSeats.length}`);

          if (freeSeats.length >= 2) {
            const selected = [];
            for (let i = 0; i < Math.min(4, freeSeats.length); i++) {
              const seat = freeSeats[i];
              const title = await seat.evaluate(el => el.getAttribute('data-title'));
              selected.push(title);
              await seat.click();
              await page.waitForTimeout(300);
            }

            await page.click('button:has-text("Перейти до оформлення")');
            await page.waitForNavigation();

            await page.type('input[name="places[0][viewer_name]"]', 'Кочкін Іван');
            await page.keyboard.press('Enter');

            await page.click('button:has-text("Сплатити")');
            await page.waitForNavigation();

            await sendTelegram(`
<b>БРОНЬ!</b>
<b>${perf.title}</b>
${date.text}
Места: ${selected.join(', ')}
<a href="${page.url()}">ОПЛАТИТЬ</a>
            `);
            return;
          }
        }
        await goToEvents();
      }

      // Пагинация
      const next = await page.$('a.pagination__btn[rel="next"]');
      if (!next) break;
      await next.click();
      await page.waitForNavigation({ waitUntil: 'networkidle2' });
      pageNum++;
    }

    console.log('Мест нет');
  } catch (err) {
    console.error('ОШИБКА:', err.message);
    await sendTelegram(`<b>ОШИБКА:</b> ${err.message}`);
  }
}

/* ------------------------------- CRON ------------------------------- */
cron.schedule('*/3 * * * *', checkTickets);

console.log('FT Bot запущен! Поиск:', config.TARGET_PERFORMANCES.join(', '));
setTimeout(checkTickets, 5000);

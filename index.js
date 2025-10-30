/**
 * FT Ticket Bot — Render Free
 * Один браузер | Обход Cloudflare | Без waitForTimeout
 */

const fs = require('fs');
const puppeteer = require('puppeteer');
const express = require('express');
const cron = require('node-cron');
const axios = require('axios');

// Утилита вместо waitForTimeout
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const config = {
  EMAIL: 'persik.101211@gmail.com',
  PASSWORD: 'vanya101112',
  TELEGRAM_TOKEN: '8387840572:AAH1KwnD7QKWXrXzwe0E6K2BtIlTyf2Rd9c',
  TELEGRAM_CHAT_ID: '587511371',
  TARGET_PERFORMANCES: ['Мартин Боруля', 'Земля', 'Річард III', 'Лимерівна', 'КОНОТОПСЬКА ВІДЬМА']
};

// Файл для хранения истории броней
const BOOKED_FILE = './booked.json';

// Загрузка истории забронированных билетов
function loadBookedHistory() {
  try {
    if (fs.existsSync(BOOKED_FILE)) {
      const data = fs.readFileSync(BOOKED_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.log('Ошибка чтения истории броней:', e.message);
  }
  return [];
}

// Сохранение истории броней
function saveBookedHistory(history) {
  try {
    fs.writeFileSync(BOOKED_FILE, JSON.stringify(history, null, 2), 'utf8');
  } catch (e) {
    console.log('Ошибка сохранения истории броней:', e.message);
  }
}

// Проверка, были ли эти билеты уже забронированы
function isAlreadyBooked(performanceTitle, dateText, seatIds) {
  const history = loadBookedHistory();
  const key = `${performanceTitle}|${dateText}|${seatIds.sort().join(',')}`;
  return history.some(record => record.key === key);
}

// Добавление брони в историю
function addToBookedHistory(performanceTitle, dateText, seatIds) {
  const history = loadBookedHistory();
  const key = `${performanceTitle}|${dateText}|${seatIds.sort().join(',')}`;
  history.push({
    key,
    performanceTitle,
    dateText,
    seatIds,
    timestamp: new Date().toISOString()
  });
  saveBookedHistory(history);
  console.log('✅ Бронь добавлена в историю');
}

const app = express();
app.get('/', (req, res) => res.send('FT Ticket Bot Active!'));
const PORT = process.env.PORT || 8000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server: ${PORT}`));

app.get('/debug.png', (req, res) => {
  const file = '/tmp/debug.png';
  if (fs.existsSync(file)) res.sendFile(file);
  else res.send('Скриншот недоступен');
});

app.get('/login-debug.png', (req, res) => {
  const file = '/tmp/login-debug.png';
  if (fs.existsSync(file)) res.sendFile(file);
  else res.send('Скриншот логина недоступен');
});

app.get('/login-error.png', (req, res) => {
  const file = '/tmp/login-error.png';
  if (fs.existsSync(file)) res.sendFile(file);
  else res.send('Скриншот ошибки недоступен');
});

app.get('/events-debug.png', (req, res) => {
  const file = '/tmp/events-debug.png';
  if (fs.existsSync(file)) res.sendFile(file);
  else res.send('Скриншот афиши недоступен');
});

app.get('/events-error.png', (req, res) => {
  const file = '/tmp/events-error.png';
  if (fs.existsSync(file)) res.sendFile(file);
  else res.send('Скриншот ошибки афиши недоступен');
});

app.get('/booking-page.png', (req, res) => {
  const file = '/tmp/booking-page.png';
  if (fs.existsSync(file)) res.sendFile(file);
  else res.send('Скриншот страницы бронирования недоступен');
});

app.get('/booking-error.png', (req, res) => {
  const file = '/tmp/booking-error.png';
  if (fs.existsSync(file)) res.sendFile(file);
  else res.send('Скриншот ошибки бронирования недоступен');
});

app.get('/booked-history', (req, res) => {
  const history = loadBookedHistory();
  res.json({
    total: history.length,
    bookings: history
  });
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

  // Определяем путь к Chrome в зависимости от платформы
  let chromePath;
  if (fs.existsSync('/nix/store')) {
    // Replit (NixOS)
    chromePath = '/nix/store/khk7xpgsm5insk81azy9d560yq4npf77-chromium-131.0.6778.204/bin/chromium';
  } else {
    // Render - используем встроенный Chrome от Puppeteer
    chromePath = undefined;
  }

  console.log('Chrome path:', chromePath || 'bundled-chrome');

  browser = await puppeteer.launch({
    headless: true,
    executablePath: chromePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--single-process',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-blink-features=AutomationControlled',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
    ],
    defaultViewport: { width: 1366, height: 768 },
    timeout: 120000
  });

  page = await browser.newPage();
  page.setDefaultNavigationTimeout(90000);

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  await page.setExtraHTTPHeaders({
    'Accept-Language': 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  });

  console.log('Глобальный браузер готов');
}

/* ------------------------------- Логин ------------------------------- */
async function loginOnce() {
  if (!page) await initGlobalBrowser();
  console.log('=== ЛОГИН (ОДИН РАЗ) ===');

  await page.goto('https://sales.ft.org.ua/cabinet/login', { 
    waitUntil: 'networkidle2', 
    timeout: 90000 
  });
  console.log('URL:', page.url());

  await delay(3000 + Math.random() * 2000);

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const title = await page.title();
      console.log(`Попытка ${attempt + 1}/10, Заголовок: ${title}`);

      if (title.includes('Just a moment') || title.includes('Cloudflare') || title.includes('Checking')) {
        console.log('Cloudflare challenge обнаружен, ждем...');
        await delay(5000 + Math.random() * 3000);
        await page.reload({ waitUntil: 'networkidle2' });
        continue;
      }

      const emailInput = await page.$('input[name="email"]');
      if (!emailInput) {
        console.log('Форма не найдена, перезагрузка...');
        await page.screenshot({ path: '/tmp/login-debug.png', fullPage: true });
        await delay(3000);
        await page.reload({ waitUntil: 'networkidle2' });
        continue;
      }

      console.log('Форма найдена! Вводим данные...');
      await emailInput.type(config.EMAIL, { delay: 100 });
      await page.type('input[name="password"]', config.PASSWORD, { delay: 100 });

      await delay(1000);
      await page.click('button.authForm__btn');

      await page.waitForNavigation({ 
        waitUntil: 'networkidle2', 
        timeout: 90000 
      });

      console.log('Логин успешен →', page.url());
      return;
    } catch (e) {
      console.log(`Ошибка на попытке ${attempt + 1}:`, e.message);
      await page.screenshot({ path: '/tmp/login-error.png', fullPage: true });

      if (attempt === 9) {
        console.log('Все попытки исчерпаны');
        throw e;
      }
      await delay(3000 + Math.random() * 2000);
    }
  }
}

/* ------------------------------- Афиша ------------------------------- */
async function goToEvents() {
  console.log('=== ПЕРЕХОД В АФИШУ ===');
  console.log('Переход на: https://sales.ft.org.ua/events');

  await delay(2000 + Math.random() * 3000);

  await page.goto('https://sales.ft.org.ua/events', {
    waitUntil: 'networkidle2',
    timeout: 90000
  });

  console.log('Страница загружена. URL:', page.url());

  for (let i = 0; i < 15; i++) {
    try {
      const title = await page.title();
      console.log(`Попытка ${i + 1}/15: Заголовок: ${title}`);

      if (title.includes('Just a moment') || title.includes('Cloudflare') || title.includes('Checking')) {
        console.log('Cloudflare challenge! Ждем...');
        await delay(8000 + Math.random() * 5000);
        await page.reload({ waitUntil: 'networkidle2' });
        continue;
      }

      const cards = await page.$$('a.performanceCard');
      if (cards.length === 0) {
        console.log('Карточки не найдены. Обновляем...');
        await page.screenshot({ path: '/tmp/events-debug.png', fullPage: true });
        await delay(3000 + Math.random() * 3000);
        await page.reload({ waitUntil: 'networkidle2' });
        continue;
      }

      console.log(`НАЙДЕНО: ${cards.length} карточек!`);
      console.log('АФИША ЗАГРУЖЕНА!');
      return;
    } catch (e) {
      console.log('Ошибка:', e.message);
      await page.screenshot({ path: '/tmp/events-error.png', fullPage: true });
      await delay(3000 + Math.random() * 3000);
      await page.reload({ waitUntil: 'networkidle2' });
    }
  }

  const screenshotPath = '/tmp/debug.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('Скриншот:', screenshotPath);
  throw new Error('Афиша не загрузилась');
}

/* ------------------------------- Проверка ------------------------------- */
async function checkTickets() {
  console.log('\n=== НОВАЯ ПРОВЕРКА ===');
  if (!page) await initGlobalBrowser();

  const currentUrl = page.url();
  if (!currentUrl.includes('cabinet') && !currentUrl.includes('events') && !currentUrl.includes('sales.ft.org.ua')) {
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

      console.log(`Спектаклей: ${performances.length}`);
      if (performances.length === 0) {
        console.log('HTML:', (await page.content()).substring(0, 1000));
      }

      const targets = performances.filter(p =>
        config.TARGET_PERFORMANCES.some(t => p.title.toLowerCase().includes(t.toLowerCase()))
      );

      console.log(`Целевые: ${targets.length > 0 ? targets.map(t => t.title).join(', ') : 'нет'}`);

      for (const perf of targets) {
        console.log(`\nСПЕКТАКЛЬ: ${perf.title}`);
        try {
          await page.goto(perf.href, { waitUntil: 'networkidle2', timeout: 120000 });
        } catch (navError) {
          console.log('Таймаут навигации к спектаклю, повторяем...');
          await delay(5000);
          await page.goto(perf.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
        }
        await delay(3000 + Math.random() * 2000);

        let dates = [];
        try {
          dates = await page.$$eval('a.seatsAreOver__btn', btns =>
            btns.map(b => ({
              text: b.querySelector('span')?.innerText.trim(),
              href: b.href
            })).filter(d => d.text && d.href)
          );
        } catch (contextError) {
          console.log('Страница обновилась, пропускаем спектакль...');
          await goToEvents();
          continue;
        }

        console.log(`Дат: ${dates.length}`);
        for (const date of dates) {
          console.log(`  Дата: ${date.text}`);
          try {
            await page.goto(date.href, { waitUntil: 'networkidle2', timeout: 120000 });
          } catch (navError) {
            console.log('Таймаут навигации к дате, повторяем...');
            await delay(5000);
            await page.goto(date.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
          }
          await delay(4000 + Math.random() * 2000);

          let soldOutCheck = false;
          try {
            soldOutCheck = await page.evaluate(() => {
              const soldOutTitle = document.querySelector('.seatsAreOver__title');
              return soldOutTitle && soldOutTitle.innerText.includes('закінчились');
            });
          } catch (evalError) {
            console.log('Страница обновилась во время проверки, пропускаем дату...');
            await goToEvents();
            break;
          }

          if (soldOutCheck) {
            console.log(`  ❌ Все билеты проданы (seatsAreOver)`);
            continue;
          }

          let seatsInfo;
          try {
            seatsInfo = await page.evaluate(() => {
            const allSeats = document.querySelectorAll('rect.tooltip-button');
            const result = {
              total: allSeats.length,
              free: 0,
              occupied: 0,
              picked: 0,
              classes: {}
            };

            allSeats.forEach(seat => {
              const classList = Array.from(seat.classList).join(' ');
              result.classes[classList] = (result.classes[classList] || 0) + 1;

              if (seat.classList.contains('occupied')) result.occupied++;
              else if (seat.classList.contains('picked')) result.picked++;
              else {
                const fill = seat.getAttribute('fill');
                if (fill && fill !== '#ADADAD') {
                  result.free++;
                }
              }
            });

            return result;
          });
          } catch (evalError) {
            console.log('Страница обновилась во время сбора информации о местах, пропускаем дату...');
            await goToEvents();
            break;
          }

          console.log(`  Всего мест: ${seatsInfo.total}`);
          console.log(`  Свободно: ${seatsInfo.free}, Занято: ${seatsInfo.occupied}`);

          // Получаем все свободные места с информацией о ряде и месте
          let allFreeSeats = [];
          try {
            allFreeSeats = await page.evaluate(() => {
            const seats = [];
            document.querySelectorAll('rect.tooltip-button:not(.occupied):not(.picked)').forEach(seat => {
              const fill = seat.getAttribute('fill');
              if (fill && fill !== '#ADADAD') {
                const dataTitle = seat.getAttribute('data-title') || '';
                const id = seat.getAttribute('id');
                // Парсим: "Балкон 1 ярусу, 1 Ряд, 1 Місце"
                const match = dataTitle.match(/(\d+)\s+Ряд,\s*(\d+)\s+Місце/);
                if (match) {
                  const section = dataTitle.split(',')[0].trim(); // Например, "Балкон 1 ярусу"
                  const row = parseInt(match[1]);

                  // ТОЛЬКО "Балкон 1 ярусу" И ТОЛЬКО 1 ряд
                  if (section === 'Балкон 1 ярусу' && row === 1) {
                    seats.push({
                      id,
                      dataTitle,
                      row,
                      seat: parseInt(match[2]),
                      section
                    });
                  }
                }
              }
            });
            return seats;
          });
          } catch (evalError) {
            console.log('Страница обновилась во время поиска свободных мест, пропускаем дату...');
            await goToEvents();
            break;
          }

          if (allFreeSeats.length >= 2) {
            // Группируем по секциям и рядам
            const grouped = {};
            allFreeSeats.forEach(s => {
              const key = `${s.section}|${s.row}`;
              if (!grouped[key]) grouped[key] = [];
              grouped[key].push(s);
            });

            // Сортируем каждый ряд по номерам мест
            Object.values(grouped).forEach(arr => arr.sort((a, b) => a.seat - b.seat));

            // Ищем группы из 4 или 2 последовательных мест
            let bestGroup = null;
            for (const [key, seats] of Object.entries(grouped)) {
              for (let i = 0; i < seats.length; i++) {
                // Проверяем группу из 4
                if (i + 3 < seats.length) {
                  const group = [seats[i], seats[i+1], seats[i+2], seats[i+3]];
                  const isSequential = group.every((s, idx) => idx === 0 || s.seat === group[idx-1].seat + 1);
                  if (isSequential) {
                    bestGroup = { seats: group, size: 4 };
                    break;
                  }
                }
                // Проверяем группу из 2
                if (i + 1 < seats.length) {
                  const group = [seats[i], seats[i+1]];
                  if (group[1].seat === group[0].seat + 1) {
                    if (!bestGroup || bestGroup.size < 2) {
                      bestGroup = { seats: group, size: 2 };
                    }
                  }
                }
              }
              if (bestGroup && bestGroup.size === 4) break; // Нашли 4 — хватит
            }

            if (bestGroup) {
              console.log(`  ✅ Найдено ${bestGroup.size} места РЯДОМ:`);
              const selected = [];
              for (const seat of bestGroup.seats) {
                console.log(`     ${seat.dataTitle}`);
                selected.push(seat.id);
              }

              // Проверяем, не были ли эти билеты уже забронированы
              if (isAlreadyBooked(perf.title, date.text, selected)) {
                console.log('  ⏭️ Эти билеты уже были забронированы ранее, пропускаем...');
                continue;
              }

              // Кликаем на каждое место (SVG элементы требуют dispatchEvent)
              for (const id of selected) {
                await page.evaluate((seatId) => {
                  const seat = document.querySelector(`rect[id="${seatId}"]`);
                  if (seat) {
                    const clickEvent = new MouseEvent('click', {
                      view: window,
                      bubbles: true,
                      cancelable: true
                    });
                    seat.dispatchEvent(clickEvent);
                  }
                }, id);
                await delay(300);
              }
            } else {
              console.log('  ⚠️ Не найдено 2 или 4 мест рядом, пропускаем...');
              continue;
            }

            console.log('Переход к оформлению...');
            await page.evaluate(() => {
              const btn = Array.from(document.querySelectorAll('button'))
                .find(b => b.innerText.includes('Перейти до оформлення'));
              if (btn) btn.click();
            });

            try {
              await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 120000 });
            } catch (navError) {
              console.log('Таймаут перехода к оформлению, ждем...');
              await delay(10000);
            }

            console.log('Страница оформления:', page.url());
            await delay(3000);

            await page.screenshot({ path: '/tmp/booking-page.png', fullPage: true });
            console.log('Скриншот страницы бронирования сохранен');

            const nameInput = await page.waitForSelector('input[name="places[0][viewer_name]"]', { 
              timeout: 30000 
            }).catch(async () => {
              console.log('Поле имени не найдено! Пробуем альтернативный селектор...');
              await page.screenshot({ path: '/tmp/booking-error.png', fullPage: true });
              return await page.$('input[placeholder*="мя"], input[placeholder*="Ім"], input[type="text"]').catch(() => null);
            });

            if (nameInput) {
              console.log('Заполняем данные...');
              await nameInput.type('Кочкін Іван', { delay: 100 });
              await delay(1000);
              await page.keyboard.press('Enter');
              await delay(2000);

              await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button'))
                  .find(b => b.innerText.includes('Сплатити'));
                if (btn) btn.click();
              });
            } else {
              console.log('Не удалось найти поле для имени. Пропускаем...');
              await page.screenshot({ path: '/tmp/booking-skip.png', fullPage: true });
            }

            // Добавляем в историю забронированных билетов
            addToBookedHistory(perf.title, date.text, selected);

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

      const next = await page.$('a.pagination__btn[rel="next"]');
      if (!next) break;
      await next.click();
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 });
      pageNum++;
    }

    console.log('Мест нет');
  } catch (err) {
    console.error('ОШИБКА:', err.message);
    try { await page.screenshot({ path: '/tmp/debug.png', fullPage: true }); } catch {}
    // Ошибки не отправляются в Telegram
  }
}

/* ------------------------------- CRON ------------------------------- */
cron.schedule('*/3 * * * *', checkTickets);

console.log('FT Bot запущен! Поиск:', config.TARGET_PERFORMANCES.join(', '));
setTimeout(checkTickets, 5000);

/**
 * FT Ticket Bot – Optimized Fast Booking
 * Мгновенная отправка уведомлений при находке билетов
 */

const fs = require('fs');
const puppeteer = require('puppeteer');
const express = require('express');
const cron = require('node-cron');
const axios = require('axios');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const config = {
  EMAIL: 'persik.101211@gmail.com',
  PASSWORD: 'vanya101112',
  TELEGRAM_TOKEN: '8387840572:AAH1KwnD7QKWXrXzwe0E6K2BtIlTyf2Rd9c',
  TELEGRAM_CHAT_ID: '587511371',
  // Группа 1: Балкон 1 ярусу, ряды 1-2
  TARGET_BALCONY: ['КОНОТОПСЬКА ВІДЬМА', 'МАРІЯ СТЮАРТ', 'ТАРТЮФ', 'БЕЗТАЛАННА', 'КАЙДАШЕВА СІМ\'Я', 'МАКБЕТ'],
  // Группа 2: Партер, ряды 6-10
  TARGET_PARTER: ['ЗЕМЛЯ', 'КАЛІГУЛА', 'ЛІМЕРІКА', 'INTERMEZZO', 'ТРАМВАЙ "БАЖАННЯ"', 'ЗАДАНИЙ КІНЬ']
};

const BOOKED_FILE = './booked.json';

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

function saveBookedHistory(history) {
  try {
    fs.writeFileSync(BOOKED_FILE, JSON.stringify(history, null, 2), 'utf8');
  } catch (e) {
    console.log('Ошибка сохранения истории броней:', e.message);
  }
}

function isAlreadyBooked(performanceTitle, dateText, seatIds) {
  const history = loadBookedHistory();
  const key = `${performanceTitle}|${dateText}|${seatIds.sort().join(',')}`;
  return history.some(record => record.key === key);
}

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

app.get('/booking-page.png', (req, res) => {
  const file = '/tmp/booking-page.png';
  if (fs.existsSync(file)) res.sendFile(file);
  else res.send('Скриншот страницы бронирования недоступен');
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

  let chromePath;
  if (fs.existsSync('/nix/store')) {
    chromePath = '/nix/store/khk7xpgsm5insk81azy9d560yq4npf77-chromium-131.0.6778.204/bin/chromium';
  } else if (fs.existsSync('/usr/bin/google-chrome-stable')) {
    chromePath = '/usr/bin/google-chrome-stable';
  } else {
    chromePath = undefined;
  }

  console.log('Chrome path:', chromePath || 'auto-detect');

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
    timeout: 90000
  });

  page = await browser.newPage();
  page.setDefaultNavigationTimeout(60000);

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
        await delay(3000 + Math.random() * 3000);
        await page.reload({ waitUntil: 'networkidle2' });
        continue;
      }

      console.log(`НАЙДЕНО: ${cards.length} карточек!`);
      console.log('АФИША ЗАГРУЖЕНА!');
      return;
    } catch (e) {
      console.log('Ошибка:', e.message);
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
let isChecking = false;

async function checkTickets() {
  if (isChecking) {
    console.log('\n⏳ Проверка уже выполняется, пропускаем...');
    return;
  }
  
  isChecking = true;
  console.log('\n=== НОВАЯ ПРОВЕРКА ===');
  console.log('Время:', new Date().toLocaleString('uk-UA'));
  
  try {
    if (!page) await initGlobalBrowser();

    const currentUrl = page.url();
    if (!currentUrl.includes('cabinet') && !currentUrl.includes('events') && !currentUrl.includes('sales.ft.org.ua')) {
      console.log('Сессия потеряна → перелогин');
      await loginOnce();
    }
  } catch (browserError) {
    console.log('Ошибка браузера, переинициализация...');
    if (browser) {
      try { await browser.close(); } catch {}
    }
    browser = null;
    page = null;
    await initGlobalBrowser();
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

      const uniqueTargets = [];
      const seen = new Set();
      const allTargets = [...config.TARGET_BALCONY, ...config.TARGET_PARTER];
      performances.filter(p =>
        allTargets.some(t => p.title.toUpperCase().includes(t.toUpperCase()))
      ).forEach(p => {
        if (!seen.has(p.href)) {
          seen.add(p.href);
          uniqueTargets.push(p);
        }
      });

      console.log(`Целевые: ${uniqueTargets.length > 0 ? uniqueTargets.map(t => t.title).join(', ') : 'нет'}`);

      for (const perf of uniqueTargets) {
        console.log(`\nСПЕКТАКЛЬ: ${perf.title}`);
        
        if (!page || page.isClosed()) {
          console.log('Страница закрыта, перезапускаем проверку...');
          return;
        }
        
        try {
          await page.goto(perf.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await delay(4000 + Math.random() * 2000);
          
          const pageReady = await page.evaluate(() => {
            return document.readyState === 'complete' || document.readyState === 'interactive';
          }).catch(() => false);
          
          if (!pageReady) {
            console.log('Страница не готова, пропускаем...');
            continue;
          }
        } catch (navError) {
          if (navError.message.includes('Target closed') || 
              navError.message.includes('Session closed') || 
              navError.message.includes('detached Frame') ||
              navError.message.includes('Execution context was destroyed') ||
              navError.message.includes('Cannot read properties of null')) {
            console.log('Браузер/страница недоступна, перезапускаем проверку...');
            return;
          }
          console.log('Ошибка навигации к спектаклю, пропускаем...');
          continue;
        }

        let dates = [];
        try {
          await page.waitForSelector('a.seatsAreOver__btn', { timeout: 10000 }).catch(() => null);
          await delay(1000);
          
          dates = await page.$$eval('a.seatsAreOver__btn', btns =>
            btns.map(b => ({
              text: b.querySelector('span')?.innerText.trim(),
              href: b.href
            })).filter(d => d.text && d.href)
          ).catch(err => {
            console.log('Не удалось получить даты:', err.message);
            return [];
          });
        } catch (contextError) {
          console.log('Ошибка получения дат, пропускаем спектакль...');
          continue;
        }

        console.log(`Дат: ${dates.length}`);
        for (const date of dates) {
          console.log(`  Дата: ${date.text}`);
          
          if (!page || page.isClosed()) {
            console.log('Страница закрыта, перезапускаем проверку...');
            return;
          }
          
          try {
            await page.goto(date.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await delay(5000 + Math.random() * 2000);
            
            const ready = await page.evaluate(() => {
              return document.readyState === 'complete' || document.readyState === 'interactive';
            }).catch(() => false);
            
            if (!ready) {
              console.log('Страница даты не готова, пропускаем...');
              continue;
            }
          } catch (navError) {
            if (navError.message.includes('Target closed') || 
                navError.message.includes('Session closed') || 
                navError.message.includes('detached Frame') ||
                navError.message.includes('Execution context was destroyed') ||
                navError.message.includes('Cannot read properties of null')) {
              console.log('Браузер/страница недоступна, перезапускаем проверку...');
              return;
            }
            console.log('Ошибка навигации к дате, пропускаем...');
            continue;
          }

          let soldOutCheck = false;
          try {
            if (!page || page.isClosed()) {
              console.log('Страница закрыта, перезапускаем проверку...');
              return;
            }
            soldOutCheck = await page.evaluate(() => {
              const soldOutTitle = document.querySelector('.seatsAreOver__title');
              return soldOutTitle && soldOutTitle.innerText.includes('закінчилися');
            });
          } catch (evalError) {
            console.log('Ошибка проверки распродажи, пропускаем дату...');
            continue;
          }

          if (soldOutCheck) {
            console.log(`  ❌ Все билеты проданы (seatsAreOver)`);
            continue;
          }

          let seatsInfo;
          try {
            if (!page || page.isClosed()) {
              console.log('Страница закрыта, перезапускаем проверку...');
              return;
            }
            
            await page.waitForSelector('rect.tooltip-button', { timeout: 10000 }).catch(() => null);
            await delay(2000);
            
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
            }).catch(err => {
              console.log('Ошибка evaluate:', err.message);
              return { total: 0, free: 0, occupied: 0, picked: 0, classes: {} };
            });
          } catch (evalError) {
            console.log('Ошибка сбора информации о местах, пропускаем...');
            continue;
          }

          console.log(`  Всего мест: ${seatsInfo.total}`);
          console.log(`  Свободно: ${seatsInfo.free}, Занято: ${seatsInfo.occupied}`);

          const isBalconyPerformance = config.TARGET_BALCONY.some(t => 
            perf.title.toUpperCase().includes(t.toUpperCase())
          );
          const isParterPerformance = config.TARGET_PARTER.some(t => 
            perf.title.toUpperCase().includes(t.toUpperCase())
          );

          let allFreeSeats = [];
          try {
            if (!page || page.isClosed()) {
              console.log('Страница закрыта, перезапускаем проверку...');
              return;
            }
            
            await delay(1000);
            
            allFreeSeats = await page.evaluate((isBalcony, isParter) => {
              const seats = [];
              document.querySelectorAll('rect.tooltip-button:not(.occupied):not(.picked)').forEach(seat => {
                const fill = seat.getAttribute('fill');
                if (fill && fill !== '#ADADAD') {
                  const dataTitle = seat.getAttribute('data-title') || '';
                  const id = seat.getAttribute('id');
                  const match = dataTitle.match(/(\d+)\s+Ряд,\s*(\d+)\s+Місце/);
                  if (match) {
                    const section = dataTitle.split(',')[0].trim();
                    const row = parseInt(match[1]);
                    const seatNum = parseInt(match[2]);

                    if (isBalcony && section === 'Балкон 1 ярусу' && row >= 1 && row <= 2 && seatNum >= 1 && seatNum <= 18) {
                      seats.push({
                        id,
                        dataTitle,
                        row,
                        seat: seatNum,
                        section
                      });
                    }

                    if (isParter && section === 'Партер' && row >= 6 && row <= 10 && seatNum >= 5 && seatNum <= 8) {
                      seats.push({
                        id,
                        dataTitle,
                        row,
                        seat: seatNum,
                        section
                      });
                    }
                  }
                }
              });
              return seats;
            }, isBalconyPerformance, isParterPerformance).catch(err => {
              console.log('Ошибка evaluate при поиске мест:', err.message);
              return [];
            });
          } catch (evalError) {
            console.log('Ошибка поиска мест, пропускаем...');
            continue;
          }

          if (allFreeSeats.length >= 2) {
            const grouped = {};
            allFreeSeats.forEach(s => {
              const key = `${s.section}|${s.row}`;
              if (!grouped[key]) grouped[key] = [];
              grouped[key].push(s);
            });

            Object.values(grouped).forEach(arr => arr.sort((a, b) => a.seat - b.seat));

            let bestGroup = null;
            for (const [key, seats] of Object.entries(grouped)) {
              for (let i = 0; i < seats.length; i++) {
                if (i + 3 < seats.length) {
                  const group = [seats[i], seats[i+1], seats[i+2], seats[i+3]];
                  const isSequential = group.every((s, idx) => idx === 0 || s.seat === group[idx-1].seat + 1);
                  if (isSequential) {
                    bestGroup = { seats: group, size: 4 };
                    break;
                  }
                }
                if (i + 1 < seats.length) {
                  const group = [seats[i], seats[i+1]];
                  if (group[1].seat === group[0].seat + 1) {
                    if (!bestGroup || bestGroup.size < 2) {
                      bestGroup = { seats: group, size: 2 };
                    }
                  }
                }
              }
              if (bestGroup && bestGroup.size === 4) break;
            }

            if (bestGroup) {
              console.log(`  ✅ Найдено ${bestGroup.size} места РЯДОМ:`);
              const selected = [];
              for (const seat of bestGroup.seats) {
                console.log(`     ${seat.dataTitle}`);
                selected.push(seat.id);
              }

              if (isAlreadyBooked(perf.title, date.text, selected)) {
                console.log('  ⭐ Эти билеты уже были забронированы ранее, пропускаем...');
                continue;
              }

              if (!page || page.isClosed()) {
                console.log('  ⚠️ Страница закрыта перед бронированием, пропускаем...');
                continue;
              }

              console.log('⚡ БЫСТРОЕ БРОНИРОВАНИЕ...');

              for (const id of selected) {
                try {
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
                  await delay(200);
                } catch (clickError) {
                  console.log('  ⚠️ Ошибка клика на место, продолжаем...');
                  continue;
                }
              }

              await delay(500);

              // СРАЗУ ОТПРАВЛЯЕМ В TELEGRAM
              const seatsList = bestGroup.seats.map(s => s.dataTitle).join('\n');
              const telegramMessage = `
🔥 <b>НАЙДЕНЫ БИЛЕТЫ!</b>

<b>${perf.title}</b>
📅 ${date.text}

🎫 Мест: ${bestGroup.size}
${seatsList}

⚡ Идет бронирование...
<a href="${page.url()}">ОТКРЫТЬ СТРАНИЦУ</a>
              `;
              
              console.log('📤 Отправляем уведомление в Telegram...');
              await sendTelegram(telegramMessage);
              console.log('✅ Уведомление отправлено!');

              // Добавляем в историю СРАЗУ
              addToBookedHistory(perf.title, date.text, selected);

              // Пытаемся оформить
              try {
                if (!page || page.isClosed()) {
                  console.log('Страница закрыта, оформление невозможно');
                  return;
                }

                await page.evaluate(() => {
                  const btn = Array.from(document.querySelectorAll('button'))
                    .find(b => b.innerText.includes('Перейти до оформлення'));
                  if (btn) btn.click();
                }).catch(() => console.log('Кнопка оформления не найдена'));

                console.log('⏳ Ждем страницу оформления...');
                
                await page.waitForNavigation({ 
                  waitUntil: 'domcontentloaded',
                  timeout: 30000 
                }).catch(() => console.log('Таймаут навигации'));

                const currentUrl = page.url();
                console.log('📄 Текущая страница:', currentUrl);

                for (let attempt = 1; attempt <= 5; attempt++) {
                  try {
                    const filled = await page.evaluate(() => {
                      const inputs = document.querySelectorAll('input[name*="viewer_name"]');
                      if (inputs.length === 0) return false;
                      
                      inputs.forEach(input => {
                        if (!input.value || input.value.trim() === '') {
                          input.value = 'Кочкін Іван';
                          input.dispatchEvent(new Event('input', { bubbles: true }));
                          input.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                      });
                      return true;
                    });

                    if (filled) {
                      console.log(`✅ Форма заполнена на попытке ${attempt}`);
                      break;
                    }
                    
                    if (attempt < 5) await delay(1000);
                  } catch (e) {
                    console.log(`Попытка ${attempt} неудачна:`, e.message);
                    if (attempt < 5) await delay(1000);
                  }
                }

                await delay(500);
                await page.evaluate(() => {
                  const btns = Array.from(document.querySelectorAll('button, a, input[type="submit"]'));
                  const payBtn = btns.find(b => {
                    const txt = b.innerText || b.value || '';
                    return txt.includes('Сплатити') || txt.includes('Оплатити');
                  });
                  if (payBtn) payBtn.click();
                }).catch(() => console.log('Кнопка оплаты не найдена'));

                await delay(2000);
                
                await sendTelegram(`
✅ <b>БРОНЬ ЗАВЕРШЕНА!</b>

<b>${perf.title}</b>
📅 ${date.text}

🎫 ${seatsList}

<a href="${page.url()}">ПЕРЕЙТИ К ОПЛАТЕ</a>
                `);
                
                console.log('🎉 ПОЛНОСТЬЮ ЗАВЕРШЕНО!');

              } catch (checkoutError) {
                console.log('⚠️ Ошибка при оформлении:', checkoutError.message);
                
                await sendTelegram(`
⚠️ <b>МЕСТА ВЫБРАНЫ, НО ОШИБКА ОФОРМЛЕНИЯ</b>

<b>${perf.title}</b>
📅 ${date.text}

🎫 ${seatsList}

❗ Нужно завершить вручную!
<a href="https://sales.ft.org.ua/events">ОТКРЫТЬ САЙТ</a>
                `).catch(() => {});
                
                await page.screenshot({ path: '/tmp/checkout-error.png', fullPage: true });
              }

              return;

            } else {
              console.log('  ⚠️ Не найдено 2 или 4 мест рядом, пропускаем...');
              continue;
            }
          }
        }
        
        try {
          if (!page || page.isClosed()) {
            console.log('Страница закрыта, выходим из цикла...');
            return;
          }
          await goToEvents();
        } catch (goBackError) {
          console.log('Ошибка возврата к афише:', goBackError.message);
          return;
        }
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
    
    if (err.message.includes('Target closed') || 
        err.message.includes('Session closed') || 
        err.message.includes('Protocol error') ||
        err.message.includes('detached Frame') ||
        err.message.includes('Execution context was destroyed')) {
      console.log('Переинициализация браузера после ошибки...');
      if (browser) {
        try { await browser.close(); } catch {}
      }
      browser = null;
      page = null;
    } else {
      try { 
        if (page) await page.screenshot({ path: '/tmp/debug.png', fullPage: true }); 
      } catch {}
    }
  } finally {
    isChecking = false;
    console.log('🔓 Проверка завершена, блокировка снята');
  }
}

/* ------------------------------- SELF-PING ------------------------------- */
async function keepAlive() {
  try {
    const replUrl = process.env.REPL_SLUG && process.env.REPL_OWNER 
      ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`
      : `http://0.0.0.0:${PORT}`;
    
    await axios.get(replUrl, { timeout: 5000 });
    console.log('✅ Self-ping успешен');
  } catch (e) {
    console.log('⚠️ Self-ping ошибка (это нормально на старте):', e.message);
  }
}

setInterval(keepAlive, 5 * 60 * 1000);

/* ------------------------------- CRON ------------------------------- */
cron.schedule('*/3 * * * *', checkTickets);

console.log('FT Bot запущен!');
console.log('📍 Балкон (ряды 1-2):', config.TARGET_BALCONY.join(', '));
console.log('📍 Партер (ряды 6-10):', config.TARGET_PARTER.join(', '));
console.log('📢 Мгновенные уведомления активированы!');
console.log('🔄 Автопинг активирован для поддержания проекта');
setTimeout(checkTickets, 5000);
setTimeout(keepAlive, 60000);

const fs = require('fs');
const { install } = require('@puppeteer/browsers');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');

puppeteer.use(StealthPlugin());

const delay = ms => new Promise(r => setTimeout(r, ms));

/////////////////////// CONFIG ///////////////////////
const CONFIG = {
  EMAIL: 'persik.101211@gmail.com',
  PASSWORD: 'vanya101112',
  TELEGRAM_TOKEN: '8387840572:AAH1KwnD7QKWXrXzwe0E6K2BtIlTyf2Rd9c',
  TELEGRAM_CHAT_ID: '587511371',
  BUILD_ID: '131.0.6778.205', // Новее Chrome
  CACHE_DIR: '/tmp/chrome-cache',
  MIN_SEATS: 2,
  PREFERRED_SEATS: 4,
  NAV_TIMEOUT: 180_000,
  SELECTOR_TIMEOUT: 180_000,
  GLOBAL_LOOP_DELAY_MS: 5_000
};
//////////////////////////////////////////////////////

function ts() {
  return new Date().toISOString();
}

async function sendTelegram(message) {
  try {
    await axios.post(
      `https://api.telegram.org/bot${CONFIG.TELEGRAM_TOKEN}/sendMessage`,
      { chat_id: CONFIG.TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' },
      { timeout: 10000 }
    );
    console.log(ts(), '[TG] OK');
  } catch (e) {
    console.log(ts(), '[TG] ERROR:', e.message);
  }
}

async function ensureChromeInstalled() {
  if (!fs.existsSync(CONFIG.CACHE_DIR)) fs.mkdirSync(CONFIG.CACHE_DIR, { recursive: true });
  console.log(ts(), `Installing Chrome ${CONFIG.BUILD_ID}...`);
  const browserInfo = await install({
    browser: 'chrome',
    buildId: CONFIG.BUILD_ID,
    cacheDir: CONFIG.CACHE_DIR
  });
  console.log(ts(), 'Chrome ready:', browserInfo.executablePath);
  return browserInfo.executablePath;
}

async function launchBrowser(executablePath) {
  console.log(ts(), '🚀 Launching STEALTH browser...');
  
  const browser = await puppeteer.launch({
    executablePath,
    headless: false, // 🔥 КЛЮЧЕВОЕ! Headless=true = Cloudflare блок
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1366,768',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    ]
  });
  
  console.log(ts(), '✅ Browser launched');
  return browser;
}

async function goTo(page, url, label = '') {
  console.log(ts(), `[NAV ${label}] -> ${url}`);
  await page.goto(url, { 
    waitUntil: 'networkidle2', 
    timeout: CONFIG.NAV_TIMEOUT 
  });
  await delay(3000); // Доп. ожидание JS
  console.log(ts(), `[NAV ${label}] ✅ ${page.url()}`);
}

async function waitForSelectorWithLog(page, selector, label, timeout = 60_000) {
  console.log(ts(), `[WAIT ${label}] ${selector}`);
  await page.waitForSelector(selector, { timeout });
  console.log(ts(), `[WAIT ${label}] ✅ OK`);
}

async function login(page) {
  console.log(ts(), '🔐 ЛОГИН...');
  
  // Идём на dashboard (как в старой версии)
  await goTo(page, 'https://sales.ft.org.ua/cabinet/dashboard', 'LOGIN');
  
  // Проверяем, нужно ли логиниться
  if (page.url().includes('login')) {
    console.log(ts(), '📝 Форма логина найдена');
    
    // Ждём поля email
    await waitForSelectorWithLog(page, 'input[name="email"]', 'EMAIL');
    
    // Вводим данные МЕДЛЕННО
    await page.type('input[name="email"]', CONFIG.EMAIL, { delay: 100 });
    await delay(500);
    await page.type('input[name="password"]', CONFIG.PASSWORD, { delay: 100 });
    await delay(500);
    
    // Кликаем кнопку
    const submitBtn = await page.$('button.authForm__btn, button[type="submit"]');
    if (submitBtn) {
      await submitBtn.click();
      console.log(ts(), '✅ Кнопка отправлена');
    } else {
      await page.keyboard.press('Enter');
    }
    
    // Ждём редирект
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30_000 });
    console.log(ts(), '✅ Логин завершён:', page.url());
  } else {
    console.log(ts(), '✅ Уже залогинен');
  }
}

async function checkSeats(page, perf, dateBtn, eventsUrl) {
  console.log(ts(), `🎫 CHECK ${perf.title} | ${dateBtn.text}`);
  
  await goTo(page, dateBtn.href, 'SEATS');
  
  // Ждём карту мест
  try {
    await waitForSelectorWithLog(page, 'rect.tooltip-button', 'SEATMAP', 30_000);
  } catch {
    console.log(ts(), '❌ Нет карты мест');
    return false;
  }
  
  // Ищем свободные места
  const freeSeats = await page.$$eval('rect.tooltip-button:not(.picked)', nodes =>
    nodes.map(n => ({
      id: n.id,
      x: +n.getAttribute('x'),
      y: +n.getAttribute('y'),
      width: +n.getAttribute('width') || 20,
      height: +n.getAttribute('height') || 20
    }))
  );
  
  console.log(ts(), `🎯 ${freeSeats.length} свободных мест`);
  if (freeSeats.length < CONFIG.MIN_SEATS) return false;
  
  // Группируем по рядам и ищем подряд
  const byRow = {};
  freeSeats.forEach(s => {
    const row = Math.round(s.y / 15) * 15;
    byRow[row] = byRow[row] || [];
    byRow[row].push(s);
  });
  
  let bestRun = null;
  for (const row of Object.values(byRow)) {
    const sorted = row.sort((a, b) => a.x - b.x);
    let run = [sorted[0]];
    
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].x - run[run.length - 1].x <= 25) {
        run.push(sorted[i]);
      } else {
        if (run.length >= CONFIG.MIN_SEATS && (!bestRun || run.length > bestRun.length)) {
          bestRun = run.slice(0, CONFIG.PREFERRED_SEATS);
        }
        run = [sorted[i]];
      }
    }
    if (run.length >= CONFIG.MIN_SEATS && (!bestRun || run.length > bestRun.length)) {
      bestRun = run.slice(0, CONFIG.PREFERRED_SEATS);
    }
  }
  
  if (!bestRun) {
    console.log(ts(), '❌ Нет подряд мест');
    return false;
  }
  
  console.log(ts(), `✅ НАШЛИ ${bestRun.length} МЕСТ ПОДРЯД!`);
  
  // Кликаем места
  for (const seat of bestRun) {
    if (seat.id) {
      await page.eval(`document.getElementById('${seat.id}').click()`);
    } else {
      const cx = seat.x + seat.width / 2;
      const cy = seat.y + seat.height / 2;
      await page.mouse.click(cx, cy);
    }
    await delay(400);
  }
  
  // Кнопка "Перейти до оформлення"
  try {
    const orderBtn = await page.$x("//button[contains(text(), 'Перейти до оформлення')]");
    if (orderBtn.length) {
      await orderBtn[0].click();
      await delay(2000);
      
      // Заполняем имя
      const nameInputs = await page.$$('input[name*="viewer_name"]');
      for (const input of nameInputs) {
        await input.type('Кочкін Іван');
      }
      
      // Уведомляем!
      const message = `<b>🎟️ БИЛЕТЫ НАЙДЕНЫ!</b>\n${perf.title}\n${dateBtn.text}\n${bestRun.length} мест\n🔗 ${dateBtn.href}`;
      await sendTelegram(message);
      
      // Скриншот
      await page.screenshot({ path: `/tmp/success_${Date.now()}.png` });
      
      return true;
    }
  } catch (e) {
    console.log(ts(), '❌ Ошибка оформления:', e.message);
  }
  
  return false;
}

async function scanEvents(page) {
  let pageNum = 1;
  
  while (true) {
    try {
      const url = `https://sales.ft.org.ua/events?hall=main&page=${pageNum}`;
      await goTo(page, url, `PAGE-${pageNum}`);
      
      const events = await page.$$eval('a.performanceCard', els =>
        els.map(el => ({
          href: el.href,
          title: el.querySelector('.performanceCard__title')?.textContent?.trim() || ''
        }))
      );
      
      console.log(ts(), `📋 Страница ${pageNum}: ${events.length} событий`);
      
      for (const event of events) {
        await goTo(page, event.href, `EVENT-${event.title}`);
        
        const dates = await page.$$eval('.seatsAreOver__btn', els =>
          els.map(el => ({
            href: el.href || el.getAttribute('onclick')?.match(/'([^']+)'/)?.[1],
            text: el.textContent.trim()
          })).filter(d => d.href)
        );
        
        for (const date of dates) {
          if (await checkSeats(page, event, date, url)) {
            console.log(ts(), '🎉 БИЛЕТЫ ЗАБРОНИРОВАНЫ! Перезапуск...');
            await delay(10_000);
            return; // Перезапуск для новой проверки
          }
          await delay(1000);
        }
        
        await delay(500);
      }
      
      // Следующая страница
      const next = await page.$('a[rel="next"]');
      if (!next) {
        console.log(ts(), '🔄 Конец списка, пауза 5с');
        pageNum = 1;
        await delay(CONFIG.GLOBAL_LOOP_DELAY_MS);
      } else {
        pageNum++;
      }
      
    } catch (e) {
      console.log(ts(), '❌ Ошибка сканирования:', e.message);
      await sendTelegram(`<b>❌ Ошибка бота:</b>\n${e.message}`);
      await delay(10_000);
    }
  }
}

/** 🔥 MAIN */
(async () => {
  console.log(ts(), '🤖 FT TICKET BOT v2.0 START!');
  await sendTelegram('<b>🚀 Бот запущен!</b>');
  
  try {
    const exePath = await ensureChromeInstalled();
    const browser = await launchBrowser(exePath);
    const page = await browser.newPage();
    
    await page.setViewport({ width: 1366, height: 768 });
    
    // ЛОГИН
    await login(page);
    
    // СКАНИРОВАНИЕ
    await scanEvents(page);
    
  } catch (e) {
    console.error(ts(), '💥 FATAL:', e);
    await sendTelegram(`<b>💥 КРИТИЧЕСКАЯ ОШИБКА:</b>\n${e.message}`);
  }
})();

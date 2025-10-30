const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { install } = require('@puppeteer/browsers');
const axios = require('axios');

puppeteer.use(StealthPlugin());

const delay = ms => new Promise(r => setTimeout(r, ms));

/////////////////////// CONFIG ///////////////////////
const CONFIG = {
  EMAIL: 'persik.101211@gmail.com',
  PASSWORD: 'vanya101112',
  TELEGRAM_TOKEN: '8387840572:AAH1KwnD7QKWXrXzwe0E6K2BtIlTyf2Rd9c',
  TELEGRAM_CHAT_ID: '587511371',
  BUILD_ID: '131.0.6778.205', 
  CACHE_DIR: '/tmp/chrome-cache',
  MIN_SEATS: 2,
  PREFERRED_SEATS: 4
};
//////////////////////////////////////////////////////

function ts() { return new Date().toISOString(); }

async function sendTelegram(message) {
  try {
    await axios.post(`https://api.telegram.org/bot${CONFIG.TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: CONFIG.TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    }, { timeout: 10000 });
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
  console.log(ts(), '🚀 Launching HEADLESS STEALTH browser...');
  
  const browser = await puppeteer.launch({
    executablePath,
    **headless: 'new'**,  // 🔥 НОВЫЙ HEADLESS (v23+)
    args: [
      // БАЗОВЫЕ ДЛЯ RENDER
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--no-zygote',
      
      // 🔥 CLOUDFLARE BYPASS
      '--disable-blink-features=AutomationControlled',
      '--disable-features=VizDisplayCompositor',
      '--disable-extensions',
      '--disable-default-apps',
      '--disable-component-extensions-with-background-pages',
      
      // X11/DISPLAY FIX
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-field-trial-config',
      '--disable-ipc-flooding-protection',
      
      // СТАБИЛЬНОСТЬ
      '--disable-hang-monitor',
      '--disable-prompt-on-repost',
      '--disable-client-side-phishing-detection',
      '--disable-sync',
      '--metrics-recording-only',
      '--no-first-run',
      '--enable-automation',
      '--password-store=basic',
      '--use-mock-keychain',
      
      // USER-AGENT
      '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    ],
    ignoreDefaultArgs: ['--enable-automation'],
    timeout: 60_000
  });
  
  console.log(ts(), '✅ Browser launched SUCCESS!');
  return browser;
}

async function goTo(page, url, label = '') {
  console.log(ts(), `[NAV ${label}] -> ${url}`);
  try {
    await page.goto(url, { 
      waitUntil: 'networkidle2', 
      timeout: 120_000 
    });
    await delay(5000); // Ждём Cloudflare/JS
    console.log(ts(), `[NAV ${label}] ✅ ${page.url()}`);
  } catch (e) {
    console.log(ts(), `[NAV ${label}] ❌ ${e.message}`);
    throw e;
  }
}

async function waitForSelector(page, selector, label, timeout = 60_000) {
  console.log(ts(), `[WAIT ${label}] ${selector}`);
  try {
    await page.waitForSelector(selector, { timeout });
    console.log(ts(), `[WAIT ${label}] ✅ OK`);
    return true;
  } catch {
    console.log(ts(), `[WAIT ${label}] ❌ TIMEOUT`);
    return false;
  }
}

// 🔥 CLOUDFLARE BYPASS
async function handleCloudflare(page) {
  const title = await page.title();
  if (title.includes('Just a moment') || title.includes('Checking')) {
    console.log(ts(), '🔄 Cloudflare detected, waiting...');
    await delay(10000);
    // Имитируем скролл/движение мыши
    await page.mouse.move(100, 100);
    await page.mouse.move(200, 150);
    await delay(5000);
    console.log(ts(), '🔄 Cloudflare bypassed');
  }
}

async function login(page) {
  console.log(ts(), '🔐 LOGIN...');
  
  await goTo(page, 'https://sales.ft.org.ua/cabinet/dashboard', 'DASHBOARD');
  await handleCloudflare(page);
  
  // Проверяем URL на login
  const currentUrl = page.url();
  if (currentUrl.includes('login')) {
    console.log(ts(), '📝 Login form found');
    
    // Ждём поля
    if (await waitForSelector(page, 'input[name="email"]', 'EMAIL', 30000)) {
      await page.type('input[name="email"]', CONFIG.EMAIL, { delay: 150 });
      await delay(800);
      await page.type('input[name="password"]', CONFIG.PASSWORD, { delay: 150 });
      await delay(800);
      
      // Кнопка
      const btn = await page.$('button[type="submit"], button.authForm__btn');
      if (btn) {
        await btn.click();
      } else {
        await page.keyboard.press('Enter');
      }
      
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
      console.log(ts(), '✅ LOGIN SUCCESS:', page.url());
    } else {
      console.log(ts(), '❌ Email field not found');
    }
  } else {
    console.log(ts(), '✅ Already logged in');
  }
}

async function mainLoop(page) {
  let pageNum = 1;
  
  while (true) {
    try {
      const eventsUrl = `https://sales.ft.org.ua/events?hall=main&page=${pageNum}`;
      await goTo(page, eventsUrl, `EVENTS-${pageNum}`);
      await handleCloudflare(page);
      
      // Ищем перформансы
      const events = await page.evaluate(() => 
        Array.from(document.querySelectorAll('a.performanceCard')).map(el => ({
          href: el.href,
          title: el.querySelector('.performanceCard__title')?.textContent?.trim() || ''
        }))
      );
      
      console.log(ts(), `📋 Page ${pageNum}: ${events.length} events`);
      
      if (events.length === 0) {
        console.log(ts(), '🔄 No events, restart from page 1');
        pageNum = 1;
        await delay(5000);
        continue;
      }
      
      for (const event of events) {
        console.log(ts(), `🎭 Checking: ${event.title}`);
        
        await goTo(page, event.href, `PERF-${event.title}`);
        await handleCloudflare(page);
        
        // Ищем даты
        const dates = await page.evaluate(() => 
          Array.from(document.querySelectorAll('.seatsAreOver__btn')).map(el => ({
            href: el.href || el.getAttribute('onclick')?.match(/'([^']+)'/)?.[1],
            text: el.textContent.trim()
          })).filter(d => d.href)
        );
        
        console.log(ts(), `📅 ${dates.length} dates for ${event.title}`);
        
        for (const date of dates) {
          console.log(ts(), `🎫 Checking date: ${date.text}`);
          
          await goTo(page, date.href, `DATE-${date.text}`);
          await handleCloudflare(page);
          
          // Карта мест
          if (!await waitForSelector(page, 'rect.tooltip-button', 'SEATMAP', 20000)) {
            console.log(ts(), '❌ No seat map');
            continue;
          }
          
          // Свободные места
          const freeSeats = await page.evaluate(() => 
            Array.from(document.querySelectorAll('rect.tooltip-button:not(.picked)')).map(el => ({
              id: el.id,
              x: parseFloat(el.getAttribute('x') || 0),
              y: parseFloat(el.getAttribute('y') || 0),
              width: parseFloat(el.getAttribute('width') || 20),
              height: parseFloat(el.getAttribute('height') || 20)
            }))
          );
          
          console.log(ts(), `🎯 ${freeSeats.length} free seats`);
          
          if (freeSeats.length < CONFIG.MIN_SEATS) continue;
          
          // Ищем подряд
          const rows = {};
          freeSeats.forEach(s => {
            const rowKey = Math.round(s.y / 20) * 20;
            rows[rowKey] = rows[rowKey] || [];
            rows[rowKey].push(s);
          });
          
          let bestRun = null;
          for (const rowSeats of Object.values(rows)) {
            const sorted = rowSeats.sort((a, b) => a.x - b.x);
            let currentRun = [sorted[0]];
            
            for (let i = 1; i < sorted.length; i++) {
              if (sorted[i].x - currentRun[currentRun.length - 1].x <= 30) {
                currentRun.push(sorted[i]);
              } else {
                if (currentRun.length >= CONFIG.MIN_SEATS && 
                    (!bestRun || currentRun.length > bestRun.length)) {
                  bestRun = currentRun.slice(0, CONFIG.PREFERRED_SEATS);
                }
                currentRun = [sorted[i]];
              }
            }
            if (currentRun.length >= CONFIG.MIN_SEATS && 
                (!bestRun || currentRun.length > bestRun.length)) {
              bestRun = currentRun.slice(0, CONFIG.PREFERRED_SEATS);
            }
          }
          
          if (!bestRun) {
            console.log(ts(), '❌ No consecutive seats');
            continue;
          }
          
          console.log(ts(), `🎉 FOUND ${bestRun.length} CONSECUTIVE SEATS!`);
          
          // КЛИКАЕМ МЕСТА
          for (const seat of bestRun) {
            if (seat.id) {
              await page.evaluate(id => {
                const el = document.getElementById(id);
                if (el) el.click();
              }, seat.id);
            } else {
              const cx = seat.x + seat.width / 2;
              const cy = seat.y + seat.height / 2;
              await page.mouse.click(cx, cy);
            }
            await delay(500);
          }
          
          // КНОПКА ОФОРМЛЕНИЯ
          await delay(2000);
          const orderBtn = await page.$x("//button[contains(text(), 'Перейти до оформлення')]");
          if (orderBtn.length) {
            await orderBtn[0].click();
            await delay(3000);
            
            // ИМЯ
            await page.evaluate(() => {
              document.querySelectorAll('input[name*="viewer_name"]').forEach(input => {
                input.value = 'Кочкін Іван';
                input.dispatchEvent(new Event('input', { bubbles: true }));
              });
            });
            
            // ✅ УВЕДОМЛЕНИЕ
            const message = `<b>🎟️ БИЛЕТЫ НАЙДЕНЫ!</b>\n<b>${event.title}</b>\n${date.text}\n${bestRun.length} мест подряд\n🔗 ${date.href}`;
            await sendTelegram(message);
            
            await page.screenshot({ path: `/tmp/SUCCESS_${Date.now()}.png` });
            console.log(ts(), '🎉 TICKETS BOOKED! Notification sent');
            
            // Возврат к событиям
            await goTo(page, eventsUrl, 'BACK-AFTER-BOOK');
          }
          
          await delay(1000);
        }
        
        await delay(1000);
      }
      
      // ПАГИНАЦИЯ
      const nextBtn = await page.$('a[rel="next"]');
      if (nextBtn) {
        pageNum++;
        console.log(ts(), `➡️ Next page: ${pageNum}`);
      } else {
        pageNum = 1;
        console.log(ts(), '🔄 Restart from page 1');
        await delay(5000);
      }
      
    } catch (e) {
      console.log(ts(), '❌ Loop error:', e.message);
      await delay(10000);
    }
  }
}

/** 🔥 MAIN */
(async () => {
  console.log(ts(), '🤖 FT TICKET BOT v3.0 START!');
  await sendTelegram('<b>🚀 Бот v3.0 запущен!</b>');
  
  let browser, page;
  
  try {
    const exePath = await ensureChromeInstalled();
    browser = await launchBrowser(exePath);
    page = await browser.newPage();
    
    await page.setViewport({ width: 1366, height: 768 });
    
    // ЛОГИН
    await login(page);
    
    // БЕСКОНЕЧНЫЙ ЛУП
    await mainLoop(page);
    
  } catch (e) {
    console.log(ts(), '💥 FATAL:', e);
    await sendTelegram(`<b>💥 ОШИБКА:</b>\n${e.message}`);
  } finally {
    if (browser) await browser.close();
  }
})();

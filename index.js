const fs = require('fs');
const { install } = require('@puppeteer/browsers');
const puppeteer = require('puppeteer');
const axios = require('axios');

const delay = ms => new Promise(r => setTimeout(r, ms));

/////////////////////// CONFIG ///////////////////////
const CONFIG = {
  EMAIL: 'persik.101211@gmail.com',
  PASSWORD: 'vanya101112',
  TELEGRAM_TOKEN: '8387840572:AAH1KwnD7QKWXrXzwe0E6K2BtIlTyf2Rd9c',
  TELEGRAM_CHAT_ID: '587511371',
  BUILD_ID: '129.0.6668.100', // Стабильная версия для Render
  CACHE_DIR: '/tmp/chrome-cache',
  MIN_SEATS: 2,
  PREFERRED_SEATS: 4,
  NAV_TIMEOUT: 120_000
};
//////////////////////////////////////////////////////

function ts() {
  return new Date().toISOString();
}

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
  console.log(ts(), 'Chrome ready');
  return browserInfo.executablePath;
}

async function launchBrowser(executablePath) {
  console.log(ts(), '🚀 Launching browser...');
  
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,  // ✅ HEADLESS = TRUE
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=TranslateUI',
      '--disable-ipc-flooding-protection',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-sync',
      '--disable-translate',
      '--hide-scrollbars',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-default-browser-check',
      '--no-pings',
      '--password-store=basic',
      '--use-mock-keychain',
      '--window-position=0,0'
    ],
    ignoreDefaultArgs: ['--disable-extensions']
  });
  
  console.log(ts(), '✅ Browser launched');
  return browser;
}

async function waitForLoad(page) {
  try {
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30_000 });
  } catch {}
  await delay(3000);
}

async function login(page) {
  console.log(ts(), '🔐 Login...');
  
  // Идём на dashboard (редиректит на login если не залогинен)
  await page.goto('https://sales.ft.org.ua/cabinet/dashboard', { 
    waitUntil: 'domcontentloaded', 
    timeout: CONFIG.NAV_TIMEOUT 
  });
  
  // Проверяем, находимся ли на странице логина
  const isLoginPage = await page.evaluate(() => 
    window.location.href.includes('login') || 
    !!document.querySelector('input[name="email"]')
  );
  
  if (isLoginPage) {
    console.log(ts(), '📝 Filling login form...');
    
    // Ждём поля
    await page.waitForSelector('input[name="email"], input[type="email"]', { timeout: 30_000 });
    
    // Медленный ввод
    await page.type('input[name="email"], input[type="email"]', CONFIG.EMAIL, { delay: 80 });
    await delay(500);
    await page.type('input[name="password"], input[type="password"]', CONFIG.PASSWORD, { delay: 80 });
    await delay(500);
    
    // Клик по кнопке
    await page.click('button[type="submit"], .authForm__btn, button:contains("Вхід")', { timeout: 10_000 });
    await waitForLoad(page);
    
    console.log(ts(), '✅ Login complete:', page.url());
  } else {
    console.log(ts(), '✅ Already logged in');
  }
}

async function bypassCloudflare(page) {
  console.log(ts(), '[CF] Waiting Cloudflare...');
  await delay(5000);
  
  try {
    await page.waitForFunction(() => {
      return !document.title.includes('Just a moment') && 
             !document.querySelector('#cf-challenge-running') &&
             document.readyState === 'complete';
    }, { timeout: 60_000 });
    console.log(ts(), '[CF] ✅ Passed');
  } catch {
    console.log(ts(), '[CF] ⚠️ Timeout, but continuing...');
  }
}

async function mainLoop(page) {
  let pageNum = 1;
  
  while (true) {
    try {
      const eventsUrl = `https://sales.ft.org.ua/events?hall=main&page=${pageNum}`;
      console.log(ts(), `📋 Scanning page ${pageNum}...`);
      
      await page.goto(eventsUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.NAV_TIMEOUT });
      await bypassCloudflare(page);
      
      // Ищем спектакли
      const performances = await page.$$eval('a.performanceCard', els => 
        els.map(el => ({
          href: el.href,
          title: el.querySelector('.performanceCard__title')?.textContent?.trim() || 'Unknown'
        }))
      );
      
      console.log(ts(), `🎭 Found ${performances.length} performances`);
      
      if (performances.length === 0) {
        console.log(ts(), '🔄 No events, restart from page 1');
        pageNum = 1;
        await delay(5000);
        continue;
      }
      
      for (const perf of performances) {
        console.log(ts(), `🎪 ${perf.title}`);
        
        await page.goto(perf.href, { waitUntil: 'domcontentloaded', timeout: CONFIG.NAV_TIMEOUT });
        await bypassCloudflare(page);
        
        // Ищем даты
        const dates = await page.$$eval('.seatsAreOver__btn', els => 
          els.map(el => ({
            href: el.href || el.getAttribute('onclick')?.match(/location\.href\s*=\s*'([^']+)'/)?.[1],
            text: el.textContent.trim()
          })).filter(d => d.href)
        );
        
        console.log(ts(), `📅 ${dates.length} dates`);
        
        for (const date of dates.slice(0, 3)) { // Первые 3 даты
          console.log(ts(), `🎟️ Checking ${date.text}`);
          
          await page.goto(date.href, { waitUntil: 'domcontentloaded', timeout: CONFIG.NAV_TIMEOUT });
          await bypassCloudflare(page);
          
          // Проверяем наличие карты мест
          try {
            await page.waitForSelector('rect.tooltip-button', { timeout: 10_000 });
            
            const freeSeats = await page.$$eval('rect.tooltip-button:not(.picked)', els => 
              els.map(el => ({
                id: el.id,
                x: parseFloat(el.getAttribute('x') || 0),
                y: parseFloat(el.getAttribute('y') || 0)
              }))
            );
            
            if (freeSeats.length >= CONFIG.MIN_SEATS) {
              console.log(ts(), `🎉 ${freeSeats.length} FREE SEATS!`);
              
              // Кликаем первые N мест
              for (let i = 0; i < Math.min(freeSeats.length, CONFIG.PREFERRED_SEATS); i++) {
                if (freeSeats[i].id) {
                  await page.evaluate(id => document.getElementById(id)?.click(), freeSeats[i].id);
                }
                await delay(300);
              }
              
              // Кнопка оформления
              const orderBtn = await page.$x("//button[contains(., 'Перейти до оформлення')]");
              if (orderBtn.length) {
                await orderBtn[0].click();
                await delay(2000);
                
                // Заполняем имя
                await page.$$eval('input[name*="viewer_name"]', (inputs, name) => {
                  inputs.forEach(input => {
                    if (input.offsetParent) {
                      input.value = name;
                      input.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                  });
                }, 'Кочкін Іван');
                
                // УВЕДОМЛЕНИЕ!
                const message = `<b>🎟️ БИЛЕТЫ НАЙДЕНЫ!</b>\n🎪 <b>${perf.title}</b>\n📅 <b>${date.text}</b>\n🎫 <b>${Math.min(freeSeats.length, CONFIG.PREFERRED_SEATS)} мест</b>\n🔗 ${date.href}`;
                await sendTelegram(message);
                
                await page.screenshot({ path: `/tmp/SUCCESS_${Date.now()}.png` });
                console.log(ts(), '🎉 SUCCESS NOTIFIED!');
              }
            }
          } catch {
            // Нет мест или карта не загрузилась
          }
          
          await delay(1000);
        }
        
        await delay(1000);
      }
      
      // Следующая страница?
      pageNum++;
      if (pageNum > 5) {
        pageNum = 1;
        await delay(10000);
      }
      
    } catch (e) {
      console.log(ts(), '❌ Loop error:', e.message);
      await delay(5000);
    }
  }
}

/** 🔥 MAIN */
(async () => {
  console.log(ts(), '🤖 FT BOT START!');
  await sendTelegram('<b>🚀 Бот запущен!</b>');
  
  let browser, page;
  
  try {
    const exePath = await ensureChromeInstalled();
    browser = await launchBrowser(exePath);
    page = await browser.newPage();
    
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36');
    
    // Логин
    await login(page);
    
    // Основной цикл
    await mainLoop(page);
    
  } catch (e) {
    console.log(ts(), '💥 FATAL:', e);
    await sendTelegram(`<b>💥 ОШИБКА:</b>\n${e.message}`);
  } finally {
    if (browser) await browser.close();
  }
})();

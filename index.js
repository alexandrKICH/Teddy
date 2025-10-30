/**
 * FT Ticket Bot — исправленная версия
 * - Убраны page.waitForTimeout
 * - Добавлена защита от Cloudflare (stealth + задержки)
 * - Исправлен логин (двойной goto)
 * - Улучшена обработка ошибок
 */

const fs = require('fs');
const path = require('path');
const { install } = require('@puppeteer/browsers');
const puppeteer = require('puppeteer');
const axios = require('axios');

// Утилита вместо page.waitForTimeout
const delay = ms => new Promise(r => setTimeout(r, ms));

/////////////////////// CONFIG ///////////////////////
const CONFIG = {
  EMAIL: 'persik.101211@gmail.com',
  PASSWORD: 'vanya101112',
  TELEGRAM_TOKEN: '8387840572:AAH1KwnD7QKWXrXzwe0E6K2BtIlTyf2Rd9c',
  TELEGRAM_CHAT_ID: '587511371',
  ROOT_EVENTS: 'https://sales.ft.org.ua/events?hall=main&page=1',
  BUILD_ID: '130.0.6723.58',
  CACHE_DIR: '/tmp/chrome-cache',
  MIN_SEATS: 2,
  PREFERRED_SEATS: 4,
  NAV_TIMEOUT: 120_000,
  SELECTOR_TIMEOUT: 120_000,
  GLOBAL_LOOP_DELAY_MS: 4_000,
  MAX_RETRY_ON_ERROR_MS: 30_000
};
//////////////////////////////////////////////////////

function ts() {
  return new Date().toISOString();
}

async function sendTelegram(message) {
  if (!CONFIG.TELEGRAM_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) {
    console.log(ts(), '[TG] telegram config missing — skip send');
    return;
  }
  try {
    await axios.post(
      `https://api.telegram.org/bot${CONFIG.TELEGRAM_TOKEN}/sendMessage`,
      {
        chat_id: CONFIG.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      },
      { timeout: 10000 }
    );
    console.log(ts(), '[TG] sent ->', message.split('\n')[0]);
  } catch (e) {
    console.log(ts(), '[TG] error:', e.response?.data?.description || e.message);
  }
}

async function ensureChromeInstalled() {
  console.log(ts(), 'Ensure chrome cache dir', CONFIG.CACHE_DIR);
  if (!fs.existsSync(CONFIG.CACHE_DIR)) fs.mkdirSync(CONFIG.CACHE_DIR, { recursive: true });
  console.log(ts(), `Installing Chrome build ${CONFIG.BUILD_ID} to ${CONFIG.CACHE_DIR} ...`);
  const browserInfo = await install({
    browser: 'chrome',
    buildId: CONFIG.BUILD_ID,
    cacheDir: CONFIG.CACHE_DIR
  });
  const executablePath = browserInfo.executablePath;
  console.log(ts(), 'Chrome installed at:', executablePath);

  // Ждём готовности файла
  console.log(ts(), 'Waiting for chrome executable to be ready...');
  while (true) {
    try {
      const s = fs.statSync(executablePath);
      if (s.size > 1_000_000) break;
    } catch {}
    await delay(1000);
  }
  console.log(ts(), 'Chrome executable ready:', executablePath);
  return executablePath;
}

async function launchBrowser(executablePath) {
  console.log(ts(), 'Launching puppeteer...');
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--no-zygote',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-features=ImproveInIncognito,Translate',
      '--disable-extensions',
      '--disable-default-apps',
      '--disable-component-extensions-with-background-pages',
      '--disable-ipc-flooding-protection',
      '--disable-hang-monitor',
      '--disable-prompt-on-repost',
      '--disable-client-side-phishing-detection',
      '--disable-sync',
      '--disable-translate',
      '--disable-domain-reliability',
      '--disable-features=AudioServiceOutOfProcess',
      '--disable-threaded-animation',
      '--disable-threaded-scrolling',
      '--disable-web-security',
      '--allow-running-insecure-content',
      '--disable-component-update',
      '--disable-print-preview',
      '--disable-speech-api',
      '--disable-remote-fonts',
      '--disable-voice-input',
      '--disable-wake-on-wifi',
      '--disable-databases',
      '--disk-cache-size=0',
      '--media-cache-size=0'
    ],
    timeout: 120_000
  });
  console.log(ts(), 'Puppeteer launched');
  return browser;
}

async function goTo(page, url, label = '') {
  try {
    console.log(ts(), `[NAV] ${label} -> goto ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CONFIG.NAV_TIMEOUT });
    console.log(ts(), `[NAV] ${label} -> loaded ${page.url()}`);
  } catch (err) {
    console.log(ts(), `[NAV] ${label} -> goto error: ${err.message}`);
    throw err;
  }
}

async function waitForSelectorWithLog(page, selector, label = '', timeout = CONFIG.SELECTOR_TIMEOUT) {
  try {
    console.log(ts(), `[WAIT] ${label} waiting for selector ${selector} (timeout ${timeout}ms)`);
    await page.waitForSelector(selector, { timeout });
    console.log(ts(), `[WAIT] ${label} selector ${selector} found`);
  } catch (e) {
    console.log(ts(), `[WAIT] ${label} selector ${selector} NOT found: ${e.message}`);
    throw e;
  }
}

// === ОБХОД CLOUDFLARE ===
async function bypassCloudflare(page) {
  console.log(ts(), '[CF] Проверка Cloudflare...');
  const title = await page.title();
  if (title.includes('Just a moment') || title.includes('Checking your browser')) {
    console.log(ts(), '[CF] Обнаружен Cloudflare. Ожидание...');
    await delay(8000); // Ждём выполнения JS-челленджа
    try {
      await page.waitForFunction(() => !document.title.includes('Just a moment'), { timeout: 30_000 });
      console.log(ts(), '[CF] Cloudflare пройден');
    } catch {
      console.log(ts(), '[CF] Не удалось пройти Cloudflare автоматически');
    }
  }
}

async function checkAllEventsLoop(page) {
  let pageIndex = 1;
  while (true) {
    try {
      const eventsPageUrl = `https://sales.ft.org.ua/events?hall=main&page=${pageIndex}`;
      await goTo(page, eventsPageUrl, `events-page-${pageIndex}`);
      await bypassCloudflare(page);

      console.log(ts(), `Page title: ${await page.title()}`);

      try {
        await waitForSelectorWithLog(page, '.performanceCard', `events-page-${pageIndex}`, 30_000);
      } catch {
        console.log(ts(), `No .performanceCard on page ${pageIndex} (maybe empty)`);
      }

      const perfLinks = await page.$$eval('a.performanceCard', nodes =>
        nodes.map(n => ({ href: n.href, title: n.querySelector('.performanceCard__title')?.textContent?.trim() || '' }))
      );
      console.log(ts(), `events-page-${pageIndex} -> found ${perfLinks.length} performanceCard(s)`);

      for (let i = 0; i < perfLinks.length; i++) {
        const perf = perfLinks[i];
        console.log(ts(), `-> [PERF ${i + 1}/${perfLinks.length}] ${perf.title} -> ${perf.href}`);

        try {
          await goTo(page, perf.href, `perf-${i + 1}`);
          await bypassCloudflare(page);
        } catch (e) {
          console.log(ts(), `perf navigate error, skip: ${e.message}`);
          continue;
        }

        try {
          await waitForSelectorWithLog(page, '.seatsAreOver__btn', `perf-${i + 1}`, 20_000);
        } catch {
          console.log(ts(), `No date buttons on this performance (skip)`);
          await goTo(page, eventsPageUrl, `back-to-events-${pageIndex}`);
          continue;
        }

        const dateButtons = await page.$$eval('.seatsAreOver__btn', nodes =>
          nodes.map(n => ({ href: n.href || n.getAttribute('href'), text: n.textContent.trim() }))
        );
        console.log(ts(), `perf ${perf.title} -> found ${dateButtons.length} date button(s)`);

        for (let di = 0; di < dateButtons.length; di++) {
          const d = dateButtons[di];
          console.log(ts(), `--> [DATE ${di + 1}/${dateButtons.length}] ${d.text} -> ${d.href}`);

          try {
            await goTo(page, d.href, `perf-${i + 1}-date-${di + 1}`);
            await bypassCloudflare(page);
          } catch (e) {
            console.log(ts(), `nav to date failed: ${e.message}`);
            continue;
          }

          let seatSelector = 'rect.tooltip-button';
          try {
            await waitForSelectorWithLog(page, seatSelector, `seat-check`, 15_000);
          } catch {
            console.log(ts(), `No seat map found on this date (skip)`);
            continue;
          }

          const freeSeats = await page.$$eval('rect.tooltip-button:not(.picked)', nodes =>
            nodes.map(n => ({
              id: n.id || null,
              x: parseFloat(n.getAttribute('x') || '0'),
              y: parseFloat(n.getAttribute('y') || '0'),
              width: parseFloat(n.getAttribute('width') || '0'),
              height: parseFloat(n.getAttribute('height') || '0'),
              dataTitle: n.getAttribute('data-title') || '',
              title: n.getAttribute('title') || ''
            }))
          );

          console.log(ts(), `Found ${freeSeats.length} free seat(s) on date ${d.text}`);
          if (freeSeats.length === 0) continue;

          const byRow = {};
          for (const s of freeSeats) {
            const rowKey = Math.round(s.y / 10) * 10;
            if (!byRow[rowKey]) byRow[rowKey] = [];
            byRow[rowKey].push(s);
          }

          let chosenRun = null;
          for (const rowKey of Object.keys(byRow)) {
            const rowSeats = byRow[rowKey].sort((a, b) => a.x - b.x);
            const diffs = [];
            for (let k = 1; k < rowSeats.length; k++) diffs.push(rowSeats[k].x - rowSeats[k - 1].x);
            const medianDiff = diffs.length ? diffs.sort((a, b) => a - b)[Math.floor(diffs.length / 2)] : 20;
            const maxGap = (medianDiff || 20) + 6;

            let run = [rowSeats[0]];
            for (let k = 1; k < rowSeats.length; k++) {
              if (rowSeats[k].x - rowSeats[k - 1].x <= maxGap) {
                run.push(rowSeats[k]);
              } else {
                if (run.length >= CONFIG.MIN_SEATS) {
                  if (!chosenRun || run.length > chosenRun.length) chosenRun = run.slice(0, CONFIG.PREFERRED_SEATS);
                }
                run = [rowSeats[k]];
              }
            }
            if (run.length >= CONFIG.MIN_SEATS) {
              if (!chosenRun || run.length > chosenRun.length) chosenRun = run.slice(0, CONFIG.PREFERRED_SEATS);
            }
            if (chosenRun && chosenRun.length >= CONFIG.MIN_SEATS) break;
          }

          if (!chosenRun) {
            console.log(ts(), `No consecutive group of ${CONFIG.MIN_SEATS}+ seats found on this date`);
            continue;
          }

          console.log(ts(), `Chosen seats count: ${chosenRun.length}`);
          chosenRun.forEach((s, idx) =>
            console.log(ts(), ` - [seat ${idx + 1}] id=${s.id} x=${s.x} y=${s.y} title="${s.dataTitle || s.title}"`)
          );

          // Клик по местам
          for (const s of chosenRun) {
            if (s.id) {
              const clicked = await page.evaluate(id => {
                const el = document.getElementById(id);
                if (el) {
                  el.scrollIntoView({ block: 'center', inline: 'center' });
                  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                  return true;
                }
                return false;
              }, s.id);
              console.log(ts(), `Clicked seat id=${s.id} -> ${clicked ? 'OK' : 'FAIL'}`);
            } else {
              const cx = s.x + (s.width || 10) / 2;
              const cy = s.y + (s.height || 10) / 2;
              await page.mouse.click(cx, cy);
              console.log(ts(), `Clicked seat by coords x=${cx} y=${cy}`);
            }
            await delay(350);
          }

          // Клик "Перейти до оформлення"
          try {
            await delay(500);
            const orderBtn = await page.$x("//button[contains(., 'Перейти до оформлення')]");
            if (orderBtn.length) {
              await orderBtn[0].click();
              console.log(ts(), 'Clicked "Перейти до оформлення" via XPath');
            } else {
              const s = await page.$('button._f-order-btn, .ticketSelection__order-btn');
              if (s) await s.click();
            }
            await delay(1400);
          } catch (e) {
            console.log(ts(), `Order button error: ${e.message}`);
            continue;
          }

          // Заполнение имени
          try {
            const nameInputSelector = 'input[name^="places"][name$="[viewer_name]"], input[name*="viewer_name"]';
            await page.waitForSelector(nameInputSelector, { timeout: 10_000 });
            await page.$$eval(nameInputSelector, (nodes, value) => {
              nodes.forEach(n => {
                if (n.offsetParent !== null) {
                  n.focus();
                  n.value = value;
                  n.dispatchEvent(new Event('input', { bubbles: true }));
                }
              });
            }, 'Кочкін Іван');
            console.log(ts(), 'Filled viewer name');
          } catch (e) {
            console.log(ts(), 'Name input not found:', e.message);
          }

          // Проверка карточки
          try {
            await page.waitForSelector('input[name="cardNum"], input[autocomplete="cc-number"]', { timeout: 10_000 });
            const message = `<b>Бронь зроблена (дошов до вводу картки)</b>\nПерформанс: ${perf.title}\nДата: ${d.text}\nПосилання: ${d.href}\nМісць: ${chosenRun.length}`;
            await sendTelegram(message);
            await page.screenshot({ path: `/tmp/ftbot_${Date.now()}.png` });
            await goTo(page, eventsPageUrl, 'back-after-notify');
            await delay(2000);
          } catch {
            const payBtn = await page.$x("//button[contains(., 'Сплатити')]");
            if (payBtn.length) {
              const message = `<b>Місця виділені, є кнопка Сплатити</b>\n${perf.title}\n${d.text}\n${d.href}`;
              await sendTelegram(message);
              await goTo(page, eventsPageUrl, 'back-after-pay');
            }
          }

          await delay(800);
        }

        await goTo(page, eventsPageUrl, `back-to-events-${pageIndex}`);
        await delay(600);
      }

      const nextPageExists = await page.$('a.pagination__btn[rel="next"], a[rel="next"]');
      if (nextPageExists) {
        pageIndex += 1;
        console.log(ts(), `Going to next events page -> ${pageIndex}`);
        await delay(600);
      } else {
        console.log(ts(), `No next page - restarting from page 1`);
        pageIndex = 1;
        await delay(CONFIG.GLOBAL_LOOP_DELAY_MS);
      }
    } catch (err) {
      console.log(ts(), 'Top-level error:', err.message);
      await sendTelegram(`<b>FT Bot Error:</b>\n${err.message}`);
      await delay(CONFIG.MAX_RETRY_ON_ERROR_MS);
    }
  }
}

/** Main */
(async () => {
  console.log(ts(), 'FT Ticket Bot starting...');
  try {
    const executablePath = await ensureChromeInstalled();
    const browser = await launchBrowser(executablePath);
    const page = await browser.newPage();
    page.setDefaultTimeout(CONFIG.SELECTOR_TIMEOUT);
    page.setDefaultNavigationTimeout(CONFIG.NAV_TIMEOUT);
    await page.setViewport({ width: 1280, height: 900 });

    // === Логин ===
    await goTo(page, 'https://sales.ft.org.ua/cabinet/login', 'login-start');
    await bypassCloudflare(page);

    try {
      await waitForSelectorWithLog(page, 'input[name="email"]', 'login', 30_000);
      await page.type('input[name="email"]', CONFIG.EMAIL, { delay: 60 });
      await page.type('input[name="password"]', CONFIG.PASSWORD, { delay: 60 });
      await page.click('button[type="submit"]');
      await delay(3000);
      await bypassCloudflare(page);
      console.log(ts(), 'Login attempted');
    } catch (e) {
      console.log(ts(), 'Login failed:', e.message);
    }

    await goTo(page, 'https://sales.ft.org.ua/events?hall=main&page=1', 'start-scan');
    await bypassCloudflare(page);
    await checkAllEventsLoop(page);
  } catch (e) {
    console.log(ts(), 'Fatal error:', e.message);
    await sendTelegram(`<b>FT Bot fatal:</b>\n${e.message}`);
  }
})();

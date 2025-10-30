/**
 * FT Ticket Bot — full, debug-heavy, continuous
 * - Uses @puppeteer/browsers to install Chrome in /tmp
 * - Launches Puppeteer with executablePath
 * - Iterates pages, performances, dates -> scans seats
 * - Selects consecutive free seats (min 2, prefer 4), clicks "Перейти до оформлення"
 * - Fills viewer name "Кочкін Іван", stops before card input and notifies in Telegram
 * - Detailed console.log for Render logs, Telegram only for important events
 *
 * IMPORTANT: This code uses credentials hardcoded below (as requested).
 * If you want to hide them, replace with process.env.* and set env vars on Render.
 */

const fs = require('fs');
const path = require('path');
const { install } = require('@puppeteer/browsers');
const puppeteer = require('puppeteer');
const axios = require('axios');

/////////////////////// CONFIG ///////////////////////
const CONFIG = {
  EMAIL: 'persik.101211@gmail.com',
  PASSWORD: 'vanya101112',
  TELEGRAM_TOKEN: '8387840572:AAH1KwnD7QKWXrXzwe0E6K2BtIlTyf2Rd9c',
  TELEGRAM_CHAT_ID: '587511371', // user id to notify
  ROOT_EVENTS: 'https://sales.ft.org.ua/events?hall=main&page=1',
  BUILD_ID: '130.0.6723.58',
  CACHE_DIR: '/tmp/chrome-cache',
  MIN_SEATS: 2,
  PREFERRED_SEATS: 4,
  NAV_TIMEOUT: 120_000, // ms
  SELECTOR_TIMEOUT: 120_000,
  GLOBAL_LOOP_DELAY_MS: 4_000, // delay between iterations (if nothing found)
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

  // Wait until file is fully ready (ETXTBSY fix)
  console.log(ts(), 'Waiting for chrome executable to be ready...');
  while (true) {
    try {
      const s = fs.statSync(executablePath);
      if (s.size > 1000000) break;
    } catch (e) {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 1000));
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
      '--disable-backgrounding-occluded-windows'
    ],
    timeout: 120_000
  });
  console.log(ts(), 'Puppeteer launched');
  return browser;
}

/**
 * Utility: robust page.goto with logging and timeout
 */
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

/**
 * Try wait for selector with long timeout and logs
 */
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

/**
 * Main checking routine.
 * - page: Puppeteer Page instance
 * - will iterate pages of event list, go to each performance link, iterate dates, check seats
 */
async function checkAllEventsLoop(page) {
  let pageIndex = 1;

  while (true) {
    try {
      const eventsPageUrl = `https://sales.ft.org.ua/events?hall=main&page=${pageIndex}`;
      await goTo(page, eventsPageUrl, `events-page-${pageIndex}`);
      console.log(ts(), `Page title: ${await page.title()}`);

      // Wait for at least some content
      try {
        await waitForSelectorWithLog(page, '.performanceCard', `events-page-${pageIndex}`, 30_000);
      } catch {
        // If no performanceCard found on this page -> assume empty or JS delayed; try to read pagination or proceed
        console.log(ts(), `No .performanceCard on page ${pageIndex} (maybe empty)`);
      }

      // Collect performance anchors that are visible
      const perfLinks = await page.$$eval('a.performanceCard', nodes =>
        nodes.map(n => ({ href: n.href, title: n.querySelector('.performanceCard__title')?.textContent?.trim() || '' }))
      );

      console.log(ts(), `events-page-${pageIndex} -> found ${perfLinks.length} performanceCard(s)`);
      for (let i = 0; i < perfLinks.length; i++) {
        const perf = perfLinks[i];
        console.log(ts(), `-> [PERF ${i + 1}/${perfLinks.length}] ${perf.title} -> ${perf.href}`);

        // open performance (use new page navigation on same tab)
        try {
          await goTo(page, perf.href, `perf-${i + 1}`);
        } catch (e) {
          console.log(ts(), `perf navigate error, skip: ${e.message}`);
          continue;
        }

        // On performance page wait for date buttons (.seatsAreOver__btn)
        try {
          await waitForSelectorWithLog(page, '.seatsAreOver__btn', `perf-${i + 1}`, 20_000);
        } catch {
          console.log(ts(), `No date buttons on this performance (skip)`);
          // go back to events page and continue
          await goTo(page, eventsPageUrl, `back-to-events-${pageIndex}`);
          continue;
        }

        // Collect dates
        const dateButtons = await page.$$eval('.seatsAreOver__btn', nodes =>
          nodes.map(n => ({ href: n.href || n.getAttribute('href'), text: n.textContent.trim() }))
        );

        console.log(ts(), `perf ${perf.title} -> found ${dateButtons.length} date button(s)`);

        for (let di = 0; di < dateButtons.length; di++) {
          const d = dateButtons[di];
          console.log(ts(), `--> [DATE ${di + 1}/${dateButtons.length}] ${d.text} -> ${d.href}`);
          // open the date page (this may be same perf url or specific)
          try {
            await goTo(page, d.href, `perf-${i + 1}-date-${di + 1}`);
          } catch (e) {
            console.log(ts(), `nav to date failed: ${e.message}`);
            continue;
          }

          // wait for seat map (rect.tooltip-button) — seats are svg rects
          // Try a few strategies: wait for rect.tooltip-button OR .ticket-map or container
          let seatSelector = 'rect.tooltip-button';
          try {
            await waitForSelectorWithLog(page, seatSelector, `seat-check`, 15_000);
          } catch {
            // No seat selector - skip this date
            console.log(ts(), `No seat map found on this date (skip)`);
            continue;
          }

          // Get list of free seats (those without .picked)
          const freeSeats = await page.$$eval('rect.tooltip-button:not(.picked)', nodes =>
            nodes.map(n => {
              // collect numeric attributes for adjacency decisions
              return {
                id: n.id || null,
                x: parseFloat(n.getAttribute('x') || '0'),
                y: parseFloat(n.getAttribute('y') || '0'),
                width: parseFloat(n.getAttribute('width') || '0'),
                height: parseFloat(n.getAttribute('height') || '0'),
                dataTitle: n.getAttribute('data-title') || '',
                title: n.getAttribute('title') || ''
              };
            })
          );

          console.log(ts(), `Found ${freeSeats.length} free seat(s) on date ${d.text}`);

          if (freeSeats.length === 0) {
            console.log(ts(), `No free seats -> going back to events list`);
            // optionally go back
            await goTo(page, eventsPageUrl, `back-to-events-${pageIndex}`);
            break; // proceed to next performance
          }

          // Group free seats by approximate row (y coordinate), sort by x to find consecutive
          const byRow = {};
          for (const s of freeSeats) {
            const rowKey = Math.round(s.y / 10) * 10; // bucket by y ~10px
            if (!byRow[rowKey]) byRow[rowKey] = [];
            byRow[rowKey].push(s);
          }

          // For each row, sort by x and find runs of consecutive seats
          let chosenRun = null;
          for (const rowKey of Object.keys(byRow)) {
            const rowSeats = byRow[rowKey].sort((a, b) => a.x - b.x);
            // compute spacing threshold (median diff)
            const diffs = [];
            for (let k = 1; k < rowSeats.length; k++) diffs.push(rowSeats[k].x - rowSeats[k - 1].x);
            const medianDiff = diffs.length ? diffs.sort((a, b) => a - b)[Math.floor(diffs.length / 2)] : 20;
            const maxGap = (medianDiff || 20) + 6; // tolerance

            // find runs
            let run = [rowSeats[0]];
            for (let k = 1; k < rowSeats.length; k++) {
              if (rowSeats[k].x - rowSeats[k - 1].x <= maxGap) {
                run.push(rowSeats[k]);
              } else {
                // evaluate run
                if (run.length >= CONFIG.MIN_SEATS) {
                  // prefer longer runs up to PREFERRED_SEATS
                  if (!chosenRun || run.length > chosenRun.length) chosenRun = run.slice(0, CONFIG.PREFERRED_SEATS);
                }
                run = [rowSeats[k]];
              }
            }
            // check last run
            if (run.length >= CONFIG.MIN_SEATS) {
              if (!chosenRun || run.length > chosenRun.length) chosenRun = run.slice(0, CONFIG.PREFERRED_SEATS);
            }
            if (chosenRun && chosenRun.length >= CONFIG.MIN_SEATS) break;
          }

          if (!chosenRun) {
            console.log(ts(), `No consecutive group of ${CONFIG.MIN_SEATS}+ seats found on this date`);
            continue; // try next date
          }

          console.log(ts(), `Chosen seats count: ${chosenRun.length}`);
          chosenRun.forEach((s, idx) =>
            console.log(ts(), ` - [seat ${idx + 1}] id=${s.id} x=${s.x} y=${s.y} title="${s.dataTitle || s.title}"`)
          );

          // Click seats (via evaluate using their id attributes or coordinates)
          try {
            // If element has id -> click by id; otherwise attempt coordinate click
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
                await page.waitForTimeout(350);
              } else {
                // fallback: click by position
                const cx = s.x + (s.width || 10) / 2;
                const cy = s.y + (s.height || 10) / 2;
                await page.mouse.click(cx, cy);
                console.log(ts(), `Clicked seat by coords x=${cx} y=${cy}`);
                await page.waitForTimeout(350);
              }
            }
          } catch (e) {
            console.log(ts(), 'Error clicking seats:', e.message);
            continue; // try next date
          }

          // After selecting, try to click "Перейти до оформлення"
          try {
            // two possible selectors: button._f-order-btn or button[type="submit"] with span text
            const orderBtnSelector = 'button._f-order-btn, button.ticketSelection__order-btn, button[type="submit"]._f-order-btn';
            console.log(ts(), 'Waiting for order button...');
            await page.waitForTimeout(500); // small wait after seat clicks
            // Attempt to find visible order button with expected text
            const orderBtn = await page.$x("//button[contains(., 'Перейти до оформлення') or contains(., 'Перейти до оформлення')]");
            if (orderBtn.length) {
              console.log(ts(), 'Found order button via XPath. Clicking...');
              await orderBtn[0].click();
            } else {
              // fallback to selector
              const s = await page.$('button._f-order-btn, .ticketSelection__order-btn, button[type="submit"]');
              if (s) {
                console.log(ts(), 'Found order button via selector. Clicking...');
                await s.click();
              } else {
                console.log(ts(), 'Order button not found! trying to submit form...');
                // try to submit form with id 'order'
                await page.evaluate(() => {
                  const f = document.getElementById('order');
                  if (f) f.submit();
                });
              }
            }
            console.log(ts(), 'Clicked "Перейти до оформлення" - waiting for cart page...');
            // wait for cart page's name input field
            await page.waitForTimeout(1400);
          } catch (e) {
            console.log(ts(), `Order button click error: ${e.message}`);
            continue; // try next date
          }

          // Now on ordering page - fill name fields
          try {
            // Wait for the viewer name input(s)
            const nameInputSelector = 'input[name^="places"][name$="[viewer_name]"], input[name*="viewer_name"]';
            await page.waitForSelector(nameInputSelector, { timeout: 10_000 });
            // Fill all visible viewer_name inputs with "Кочкін Іван"
            const filled = await page.$$eval(nameInputSelector, (nodes, value) => {
              let cnt = 0;
              nodes.forEach(n => {
                if (n.offsetParent !== null) { // visible
                  n.focus();
                  n.value = value;
                  n.dispatchEvent(new Event('input', { bubbles: true }));
                  cnt++;
                }
              });
              return cnt;
            }, 'Кочкін Іван');
            console.log(ts(), `Filled ${filled} viewer_name input(s) with "Кочкін Іван"`);

            // Try to press Enter on first input to simulate proceed
            try {
              await page.focus(nameInputSelector);
              await page.keyboard.press('Enter');
              console.log(ts(), 'Pressed Enter after filling name');
            } catch {
              // ignore
            }
          } catch (e) {
            console.log(ts(), 'No viewer_name input found on order page:', e.message);
          }

          // Wait for card input fields to appear (we stop here and notify)
          try {
            console.log(ts(), 'Waiting for card input (cardNum) to decide to notify user...');
            await page.waitForSelector('input[name="cardNum"], input[name="card_number"], input[autocomplete="cc-number"]', {
              timeout: 10_000
            });
            // If present => we reached payment step
            const message = `<b>Бронь зроблена (дошов до вводу картки)</b>\nПерформанс: ${perf.title}\nДата: ${d.text}\nПосилання: ${d.href}\nМісць: ${chosenRun.length}`;
            console.log(ts(), '[ALERT] reached card input -> sending TG notification');
            await sendTelegram(message);
            // Optionally, take a screenshot for debug (store in /tmp) - but not sending file, only saved in render logs if needed
            try {
              const scpath = `/tmp/ftbot_booking_${Date.now()}.png`;
              await page.screenshot({ path: scpath, fullPage: false });
              console.log(ts(), `Saved screenshot at ${scpath}`);
            } catch (e) {
              console.log(ts(), 'Screenshot failed:', e.message);
            }

            // After notifying, return to events listing to continue scanning (to not attempt to pay)
            console.log(ts(), 'Returning to events list after notifying user.');
            await goTo(page, eventsPageUrl, 'back-after-notify');
            // optionally short delay
            await page.waitForTimeout(2000);
            // Continue scanning (we keep looping)
          } catch (e) {
            console.log(ts(), 'Card input not found yet — maybe extra step required. Continuing scanning.');
            // If card input not found — maybe there is intermediate page with "Сплатити" button
            // Try to find and click "Сплатити" buttons (but we will NOT submit payment by default)
            const payBtn = await page.$x("//button[contains(., 'Сплатити') or contains(., 'Оплатити')]");
            if (payBtn.length) {
              console.log(ts(), 'Found pay button element on page — NOT pressing to avoid real payment. Notifying user instead.');
              const message = `<b>Бронь: місця виділені</b>\nПерформанс: ${perf.title}\nДата: ${d.text}\nПосилання: ${d.href}\nМісць: ${chosenRun.length}\n(Не натискаю оплату, чекаю введення картки)`;
              await sendTelegram(message);
              await goTo(page, eventsPageUrl, 'back-after-pay-notify');
            } else {
              console.log(ts(), 'No pay button either — continuing normal scanning.');
            }
          }

          // After dealing with found seats => short delay before next date
          await page.waitForTimeout(800);
        } // end dates loop

        // After each performance processed -> go back to events page to continue
        console.log(ts(), `Finished performance ${perf.title}, returning to events list page ${pageIndex}.`);
        await goTo(page, eventsPageUrl, `back-to-events-${pageIndex}`);
        // small delay
        await page.waitForTimeout(600);
      } // end performances loop

      // Pagination: check if next page exists
      const nextPageExists = await page.$('a.pagination__btn[rel="next"], .pagination__btn[rel="next"], a[rel="next"]');
      if (nextPageExists) {
        pageIndex += 1;
        console.log(ts(), `Going to next events page -> ${pageIndex}`);
        await page.waitForTimeout(600);
        continue;
      } else {
        // no next page -> restart from 1
        console.log(ts(), `No next page found - restarting from page 1 after short delay`);
        pageIndex = 1;
        await page.waitForTimeout(CONFIG.GLOBAL_LOOP_DELAY_MS);
      }
    } catch (err) {
      console.log(ts(), 'Top-level error in checkAllEventsLoop:', err.message);
      await sendTelegram(`<b>FT Bot Error:</b>\n${err.message}`);
      // wait and then restart cycle
      await new Promise(r => setTimeout(r, CONFIG.MAX_RETRY_ON_ERROR_MS));
    }
  } // end while true
}

/** Main entry */
(async () => {
  console.log(ts(), 'FT Ticket Bot starting...');
  try {
    const executablePath = await ensureChromeInstalled();
    const browser = await launchBrowser(executablePath);

    const page = await browser.newPage();
    page.setDefaultTimeout(CONFIG.SELECTOR_TIMEOUT);
    page.setDefaultNavigationTimeout(CONFIG.NAV_TIMEOUT);
    await page.setViewport({ width: 1280, height: 900 });

    // Check if already logged in by visiting profile
    try {
      console.log(ts(), 'Checking if already logged in (visiting /cabinet/profile)...');
      await goTo(page, 'https://sales.ft.org.ua/cabinet/profile', 'check-login');
      const onProfile = page.url().includes('/cabinet/profile');
      if (onProfile) {
        console.log(ts(), 'Already on profile page -> logged in');
      } else {
        console.log(ts(), 'Not on profile page, need to login');
      }

      if (!onProfile) {
        // perform login
        console.log(ts(), 'Navigating to login page...');
        await goTo(page, 'https://sales.ft.org.ua/cabinet/login', 'login');
        // fill credentials and submit
        try {
          await waitForSelectorWithLog(page, 'input[name="email"]', 'login');
          await page.type('input[name="email"]', CONFIG.EMAIL, { delay: 60 });
          await page.type('input[name="password"]', CONFIG.PASSWORD, { delay: 60 });
          // click submit
          const submitBtn = await page.$('button[type="submit"]');
          if (submitBtn) {
            await submitBtn.click();
            console.log(ts(), 'Clicked login submit');
          } else {
            // fallback: press Enter on password
            await page.keyboard.press('Enter');
          }
          // wait for navigation to profile
          try {
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 25_000 });
          } catch { /* ignore */ }
          console.log(ts(), 'Post-login current url:', page.url());
          if (!page.url().includes('/cabinet/profile')) {
            console.log(ts(), 'Login did not land on profile — attempt to check page content for success');
          } else {
            console.log(ts(), 'Login OK');
          }
        } catch (e) {
          console.log(ts(), 'Login step failed:', e.message);
        }
      }

      // After login or if already logged in -> go to events main page
      console.log(ts(), 'Going to events main page to start scanning...');
      await goTo(page, 'https://sales.ft.org.ua/events?hall=main&page=1', 'start-scan');

      // Start continuous scan loop
      await checkAllEventsLoop(page);
    } catch (e) {
      console.log(ts(), 'Fatal error during startup:', e.message);
      await sendTelegram(`<b>FT Bot startup error:</b>\n${e.message}`);
    }
  } catch (e) {
    console.log(ts(), 'Unable to start browser / bot:', e.message);
    await sendTelegram(`<b>FT Bot fatal:</b>\n${e.message}`);
  }
})();

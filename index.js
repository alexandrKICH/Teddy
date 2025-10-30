const puppeteer = require('puppeteer-core');
const express = require('express');
const cron = require('node-cron');
const axios = require('axios');

const config = {
  EMAIL: "persik.101211@gmail.com",
  PASSWORD: "vanya101112",
  TELEGRAM_TOKEN: "8387840572:AAH1KwnD7QKWXrXzwe0E6K2BtIlTyf2Rd9c", // ЗАМЕНИ!
  TELEGRAM_CHAT_ID: "587511371",
  TARGET_PERFORMANCES: [
    "Конотопська відьма",
    "Майстер і Маргарита"
  ]
};

const app = express();
app.get('/', (req, res) => res.send('🎭 FT Ticket Bot Active!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

// Telegram функция
async function sendTelegram(msg) {
  if (!config.TELEGRAM_TOKEN || config.TELEGRAM_TOKEN.includes('YOUR_TOKEN')) {
    console.log('⚠️ Telegram token not set');
    return;
  }
  try {
    await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: config.TELEGRAM_CHAT_ID,
      text: msg
    });
    console.log('📢 Telegram sent');
  } catch (e) {
    console.log('❌ Telegram error:', e.message);
  }
}

// Инициализация браузера
async function initBrowser() {
  const chromePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable';
  console.log(`🔧 Using Chrome from: ${chromePath}`);
  
  return await puppeteer.launch({
    headless: true,
    executablePath: chromePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--no-zygote',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    ]
  });
}

// Основная функция проверки
async function checkTickets() {
  console.log('🔍 Starting ticket check...');
  let browser;
  
  try {
    browser = await initBrowser();
    const page = await browser.newPage();
    
    // Настройки
    await page.setViewport({ width: 1280, height: 800 });
    page.setDefaultNavigationTimeout(30000);
    page.setDefaultTimeout(15000);

    // Логин
    console.log('🔐 Logging in...');
    await page.goto('https://sales.ft.org.ua/cabinet/login', { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });

    await page.waitForSelector('input[name="email"]', { timeout: 10000 });
    await page.type('input[name="email"]', config.EMAIL, { delay: 100 });
    await page.type('input[name="password"]', config.PASSWORD, { delay: 100 });
    await page.click('button[type="submit"]');
    
    // Ждем редирект
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
    
    if (page.url().includes('/cabinet/profile')) {
      console.log('✅ Login successful');
      await sendTelegram('✅ Bot logged in successfully');
    } else {
      throw new Error('Login failed - wrong credentials or captcha');
    }

    // Переходим на афишу
    console.log('🎭 Going to events page...');
    await page.goto('https://sales.ft.org.ua/events?hall=main', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Получаем все спектакли
    const performances = await page.$$eval('.performanceCard', cards => 
      cards.map(card => {
        const title = card.querySelector('.performanceCard__title');
        const link = card.closest('a');
        return {
          name: title?.textContent?.trim() || '',
          url: link?.href || ''
        };
      }).filter(p => p.name && p.url)
    );

    console.log(`📊 Found ${performances.length} performances`);

    // Ищем целевые спектакли
    const targetPerfs = performances.filter(p => 
      config.TARGET_PERFORMANCES.some(target => 
        p.name.toLowerCase().includes(target.toLowerCase())
      )
    );

    console.log(`🎯 Target performances: ${targetPerfs.length}`);

    if (targetPerfs.length === 0) {
      console.log('❌ No target performances found on this page');
      return false;
    }

    // Проверяем каждый целевой спектакль
    for (const perf of targetPerfs) {
      console.log(`🔍 Checking: ${perf.name}`);
      
      try {
        await page.goto(perf.url, { waitUntil: 'networkidle2' });
        await page.waitForTimeout(2000);

        // Ищем даты
        const dates = await page.$$eval('.seatsAreOver__btn', buttons => 
          buttons.map(btn => ({
            text: btn.textContent.trim(),
            href: btn.href
          }))
        );

        console.log(`📅 Dates found: ${dates.length} for ${perf.name}`);

        // Проверяем каждую дату
        for (const date of dates) {
          console.log(`⏰ Checking date: ${date.text}`);
          
          try {
            await page.goto(date.href, { waitUntil: 'networkidle2' });
            await page.waitForTimeout(3000);

            // Ищем свободные места
            const freeSeats = await page.$$('rect.tooltip-button:not(.picked)');
            
            if (freeSeats.length >= 2) {
              console.log(`🎉 FOUND ${freeSeats.length} TICKETS for ${perf.name} on ${date.text}!`);
              
              const message = `🚨 TICKETS FOUND!\n\n🎭 ${perf.name}\n📅 ${date.text}\n🎫 ${freeSeats.length} seats\n🔗 ${date.href}`;
              await sendTelegram(message);
              
              await browser.close();
              return true;
            } else {
              console.log(`❌ No tickets for ${date.text}`);
            }
          } catch (dateError) {
            console.log(`❌ Date check error: ${dateError.message}`);
          }
        }
      } catch (perfError) {
        console.log(`❌ Performance check error: ${perfError.message}`);
      }
    }

    console.log('❌ No tickets found this round');
    return false;

  } catch (error) {
    console.log('💥 Critical error:', error.message);
    await sendTelegram(`❌ Bot error: ${error.message}`);
    return false;
  } finally {
    if (browser) await browser.close();
  }
}

// 🔄 Расписание - каждые 5 минут
cron.schedule('*/5 * * * *', async () => {
  console.log(`\n⏰ ${new Date().toLocaleString('uk-UA')} - Starting check`);
  await checkTickets();
  console.log(`⏰ ${new Date().toLocaleString('uk-UA')} - Check completed\n`);
});

// Первый запуск с задержкой
console.log('🚀 FT Ticket Bot Started! Waiting for Chrome to initialize...');
setTimeout(() => {
  checkTickets();
}, 10000);    
  } catch (error) {
    console.log(`❌ Ошибка проверки спектакля: ${error.message}`);
    return false;
  }
}

async function checkDateForTickets(page, dateUrl, performanceName, dateText) {
  console.log(`🔍 Проверяю дату: ${dateText}`);
  
  try {
    await page.goto(dateUrl, { waitUntil: 'networkidle2' });
    await page.waitForTimeout(2000);
    
    // Ищем свободные места
    const freeSeats = await page.$$eval('rect.tooltip-button:not(.picked)', seats => 
      seats.map(seat => ({
        id: seat.id,
        title: seat.getAttribute('title'),
        dataTitle: seat.getAttribute('data-title')
      }))
    );
    
    console.log(`🎫 Свободных мест: ${freeSeats.length} на ${dateText}`);
    
    if (freeSeats.length >= 2) {
      // Ищем 2+ места рядом
      const adjacentSeats = findAdjacentSeats(freeSeats);
      
      if (adjacentSeats.length >= 2) {
        console.log(`✅ Найдены соседние места! Бронируем...`);
        
        // Выбираем места
        for (const seat of adjacentSeats.slice(0, 2)) {
          await page.click(`#${seat.id}`);
          await page.waitForTimeout(500);
        }
        
        // Нажимаем "Перейти до оформлення"
        await page.click('button._f-order-btn');
        await page.waitForNavigation({ waitUntil: 'networkidle2' });
        
        // Заполняем имена
        await fillBookingForm(page);
        
        const message = `🚨 УСПЕХ! Забронированы билеты на "${performanceName}" - ${dateText}`;
        await sendTelegram(message);
        
        return true;
      }
    }
    
    return false;
    
  } 
  catch (error) {
    console.log(`❌ Ошибка проверки даты: ${error.message}`);
    return false;
  }
}

function findAdjacentSeats(seats) {
  // Группируем места по рядам
  const seatsByRow = {};
  
  seats.forEach(seat => {
    const rowMatch = seat.dataTitle.match(/Ряд[,\s]*(\d+)/);
    if (rowMatch) {
      const row = parseInt(rowMatch[1]);
      const seatMatch = seat.dataTitle.match(/Місце[,\s]*(\d+)/);
      if (seatMatch) {
        const seatNum = parseInt(seatMatch[1]);
        if (!seatsByRow[row]) seatsByRow[row] = [];
        seatsByRow[row].push({ ...seat, seatNum, row });
      }
    }
  });
  
  // Ищем соседние места в каждом ряду
  for (const row in seatsByRow) {
    const rowSeats = seatsByRow[row].sort((a, b) => a.seatNum - b.seatNum);
    
    for (let i = 0; i < rowSeats.length - 1; i++) {
      if (rowSeats[i + 1].seatNum - rowSeats[i].seatNum === 1) {
        return [rowSeats[i], rowSeats[i + 1]];
      }
    }
  }
  
  return seats.slice(0, 2); // Возвращаем первые 2 места если соседних нет
}

async function fillBookingForm(page) {
  try {
    console.log('✍️ Заполняю форму бронирования...');
    
    // Заполняем имя для первого места
    await page.waitForSelector('input[name="places[0][viewer_name]"]', { timeout: 5000 });
    await page.type('input[name="places[0][viewer_name]"]', 'Кочкін Іван');
    
    // Если есть второе место, заполняем его
    const secondPlaceInput = await page.$('input[name="places[1][viewer_name]"]');
    if (secondPlaceInput) {
      await page.type('input[name="places[1][viewer_name]"]', 'Кочкін Іван');
    }
    
    console.log('✅ Форма заполнена, можно переходить к оплате');
    
    // Останавливаемся перед оплатой и отправляем сообщение
    await sendTelegram('✅ БРОНЬ ГОТОВА! Переходи к оплате вручную или настрой автоматическую оплату');
    
  } catch (error) {
    console.log(`❌ Ошибка заполнения формы: ${error.message}`);
  }
}

async function scanAllPerformances() {
  console.log('🔄 Начинаю сканирование...');
  const browser = await initBrowser();
  const page = await browser.newPage();
  
  try {
    // Устанавливаем таймауты
    page.setDefaultNavigationTimeout(30000);
    page.setDefaultTimeout(10000);
    
    // Логинимся
    await login(page);
    
    // Переходим на афишу
    await page.goto('https://sales.ft.org.ua/events?hall=main', { 
      waitUntil: 'networkidle2' 
    });
    
    let currentPage = 1;
    let hasNextPage = true;
    
    while (hasNextPage) {
      console.log(`📄 Проверяю страницу ${currentPage}`);
      
      // Получаем все спектакли на странице
      const performances = await page.$$eval('.performanceCard__title', titles => 
        titles.map(title => ({
          name: title.textContent.trim(),
          url: title.closest('a')?.href
        }))
      );
      
      console.log(`🎭 Найдено спектаклей на странице: ${performances.length}`);
      
      // Фильтруем только целевые спектакли
      const targetPerformances = performances.filter(p => 
        config.TARGET_PERFORMANCES.some(target => 
          p.name.toLowerCase().includes(target.toLowerCase())
        )
      );
      
      console.log(`🎯 Целевых спектаклей: ${targetPerformances.length}`);
      
      // Проверяем каждый целевой спектакль
      for (const perf of targetPerformances) {
        if (perf.url) {
          const foundTickets = await checkPerformance(page, perf.url, perf.name);
          if (foundTickets) {
            await browser.close();
            return true; // Билеты найдены и забронированы
          }
        }
      }
      
      // Проверяем есть ли следующая страница
      const nextButton = await page.$('a.pagination__btn[rel="next"]');
      if (nextButton) {
        await nextButton.click();
        await page.waitForTimeout(3000);
        currentPage++;
      } else {
        hasNextPage = false;
      }
    }
    
    console.log('🔚 Все спектакли проверены, билетов нет');
    return false;
    
  } catch (error) {
    console.log(`💥 Критическая ошибка: ${error.message}`);
    await sendTelegram(`❌ Ошибка бота: ${error.message}`);
    return false;
  } finally {
    await browser.close();
  }
}

// 🔄 Запускаем проверку каждые 2 минуты
cron.schedule('*/2 * * * *', async () => {
  console.log('\n=== 🔍 ЗАПУСК ПРОВЕРКИ ===');
  await scanAllPerformances();
  console.log('=== ✅ ПРОВЕРКА ЗАВЕРШЕНА ===\n');
});

// Первый запуск
console.log('🚀 FT Ticket Bot запущен!');
scanAllPerformances();

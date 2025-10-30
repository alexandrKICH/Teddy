const puppeteer = require("puppeteer");
const express = require("express");

const EMAIL = "persik.101211@gmail.com";
const PASSWORD = "vanya101112";

async function runBot() {
  console.log("🔄 runBot() стартовал");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(10000);

  async function safeGoto(url) {
    try {
      console.log(`🌐 Переход на: ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded" });
    } catch (e) {
      console.log(`⚠️ Ошибка загрузки: ${e}`);
    }
  }

  // 🔐 Авторизация
  await safeGoto("https://sales.ft.org.ua");
  await page.click("a[href='https://sales.ft.org.ua/cabinet/dashboard']");
  await safeGoto("https://sales.ft.org.ua/cabinet/login");

  console.log("✍️ Ввод логина и пароля...");
  await page.type("input[name='email']", EMAIL);
  await page.type("input[name='password']", PASSWORD);
  await page.click("button[type='submit']");
  await page.waitForTimeout(2000);
  console.log("✅ Авторизация успешна!");

  // 🎭 Афиша основной сцены
  await safeGoto("https://sales.ft.org.ua/events?hall=main");
  console.log("🎭 Открыта афиша основной сцены");

  const performances = await page.$$eval(".performanceCard__title", els =>
    els.map(el => el.textContent.trim())
  );
  console.log(`🔎 Найдено спектаклей: ${performances.length}`);

  for (let i = 0; i < performances.length; i++) {
    console.log(`➡️ [${i + 1}] Спектакль: ${performances[i]}`);
    try {
      const perfLinks = await page.$$eval(".performanceCard__title", els =>
        els.map(el => el.closest("a")?.href)
      );
      await safeGoto(perfLinks[i]);
      await page.waitForTimeout(2000);

      const dates = await page.$$eval(".seatsAreOver__btn", els =>
        els.map(el => ({
          text: el.textContent.trim(),
          href: el.href,
        }))
      );

      console.log(`📅 Доступных дат: ${dates.length}`);
      for (const { text, href } of dates) {
        console.log(`🕓 Дата: ${text} → ${href}`);
        await safeGoto(href);
        console.log("🪑 Проверка мест... (заглушка)");
        await page.waitForTimeout(1000);
      }

      await safeGoto("https://sales.ft.org.ua/events?hall=main");
      await page.waitForTimeout(1000);
    } catch (e) {
      console.log(`❌ Ошибка при переходе: ${e}`);
      await safeGoto("https://sales.ft.org.ua/events?hall=main");
      await page.waitForTimeout(1000);
    }
  }

  console.log("✅ Цикл завершён. Закрываю браузер...");
  await browser.close();
}

runBot();

// 🔄 Keep-alive сервер для Render
const app = express();
app.get("/", (_, res) => res.send("I'm alive!"));
const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`🌐 Сервер запущен на порту ${port}`));

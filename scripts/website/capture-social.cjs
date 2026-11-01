"use strict";
const { chromium } = require("playwright");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
(async () => {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "chrome",
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 1,
    });
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "social-card.html")).href,
    );
    await page.locator("img").evaluate((image) => image.decode());
    await page.screenshot({
      path: path.resolve(__dirname, "../../website/assets/social-card.png"),
    });
    console.log("Captured the 1200×630 FDO 1.0.5 social preview.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

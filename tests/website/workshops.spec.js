const { test, expect } = require("@playwright/test");

test("workshops are discoverable, ordered, and link directly to the supplied videos", async ({
  page,
  request,
}) => {
  const requests = [];
  const errors = [];
  page.on("request", (entry) => requests.push(entry.url()));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Workshops" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Video workshops" }).click();
  await expect(page).toHaveURL(/\/workshops\.html$/);
  await expect(page).toHaveTitle(/FDO workshops/);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://fdo.alexvwan.me/workshops.html",
  );
  await expect(page.locator(".nav-workshops")).toHaveAttribute(
    "aria-current",
    "page",
  );
  const cards = page.locator(".workshop-card");
  await expect(cards).toHaveCount(2);
  const urls = ["https://youtu.be/TMmLsL6ZCdc", "https://youtu.be/da2ojSPlC7w"];
  for (let i = 0; i < urls.length; i++) {
    const watch = cards.nth(i).locator(".workshop-video");
    await expect(watch).toHaveAttribute("href", urls[i]);
    await expect(watch).toHaveAccessibleName(
      new RegExp(`Watch workshop ${i + 1} on YouTube`),
    );
    await expect
      .poll(() =>
        watch
          .locator("img")
          .evaluate((img) => img.complete && img.naturalWidth === 1280),
      )
      .toBe(true);
    await watch.focus();
    await expect(watch).toBeFocused();
  }
  await expect(
    cards.nth(1).getByRole("link", { name: /Source & setup guide/ }),
  ).toHaveAttribute(
    "href",
    "https://github.com/anikitenko/fdo/tree/main/examples/workshop/2",
  );
  await expect(page.locator("iframe, video")).toHaveCount(0);
  const data = JSON.parse(
    await page.locator('script[type="application/ld+json"]').textContent(),
  );
  expect(data["@type"]).toBe("CollectionPage");
  expect(data.mainEntity.itemListElement.map((item) => item.url)).toEqual(urls);
  expect(await (await request.get("/sitemap.xml")).text()).toContain(
    "https://fdo.alexvwan.me/workshops.html",
  );
  for (const name of ["workshop-1.jpg", "workshop-2.jpg"]) {
    const image = await request.get("/assets/" + name);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toContain("image/jpeg");
  }
  expect(
    requests.every((url) => new URL(url).origin === "http://127.0.0.1:4174"),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.locator("h1").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: test.info().outputPath("workshops-desktop.png"),
    fullPage: true,
  });
});

test("workshops remain usable without JavaScript and reachable in compact navigation", async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of [
      "/",
      "/workshops.html",
      "/ai-coding.html",
      "/cli.html",
      "/templates.html",
      "/workspace-history.html",
      "/privacy.html",
    ]) {
      await page.goto("http://127.0.0.1:4174" + route);
      await expect(
        page.locator(".nav-workshops"),
        `${route} at ${width}px`,
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${route} overflow at ${width}px`,
      ).toBe(true);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:4174/workshops.html");
  for (const card of await page.locator(".workshop-card").all()) {
    await expect(card.locator(".workshop-video")).toBeVisible();
    await expect(card.locator(".workshop-resources a")).toBeVisible();
  }
  await page.screenshot({
    path: test.info().outputPath("workshops-mobile.png"),
    fullPage: true,
  });
  await context.close();
});

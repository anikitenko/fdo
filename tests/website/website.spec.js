const { test, expect } = require("@playwright/test");

test("1.0.5 product tour works with keyboard, full-size images and clipboard", async ({
  page,
  context,
}) => {
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400)
      failures.push(response.url() + ": " + response.status());
  });
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: /AVAILABLE NOW FDO 1.0.5/ }),
  ).toBeVisible();
  await expect(page.getByText(/preparing for its first release/)).toHaveCount(
    0,
  );
  const choices = page.locator("[data-tour]");
  await expect(choices).toHaveCount(5);
  for (const button of await choices.all()) {
    await button.click();
    const id = await button.getAttribute("aria-controls");
    const panel = page.locator("#" + id);
    await expect(panel).toBeVisible();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(panel.locator("img")).toHaveAttribute("loading", "eager");
    await expect
      .poll(() =>
        panel
          .locator("img")
          .evaluate((img) => img.complete && img.naturalWidth > 0),
      )
      .toBe(true);
    const image = await panel.locator("figure > a").getAttribute("href");
    expect((await page.request.get(image)).status()).toBe(200);
  }
  await choices.first().focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#tour-manage")).toBeVisible();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: /Copy commands/ }).click();
  await expect(page.locator("#copy-status")).toHaveText(
    "Commands copied to clipboard.",
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "fdo init ./my-tool --template blank",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("heading", { level: 1 }).click();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: test.info().outputPath("website-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  expect(failures).toEqual([]);
});

test("mobile layout and progressive enhancement retain every screenshot", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4174/");
  await page.getByRole("button", { name: /Web & Docker/ }).click();
  await expect(page.locator("#tour-ship")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `No horizontal overflow at ${width}px`,
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("heading", { level: 1 }).click();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: test.info().outputPath("website-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await context.close();
  const plain = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const fallback = await plain.newPage();
  await fallback.goto("http://127.0.0.1:4174/");
  await expect(fallback.locator(".tour-controls")).toBeHidden();
  for (const panel of await fallback.locator("[data-tour-panel]").all())
    await expect(panel).toBeVisible();
  expect(
    await fallback.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await plain.close();
});

test("verification and existing public guides remain available", async ({
  request,
}) => {
  const verification = await request.get("/google9d9ae653e6dbd173.html");
  expect(verification.status()).toBe(200);
  expect(await verification.text()).toBe(
    "google-site-verification: google9d9ae653e6dbd173.html",
  );
  expect((await request.get("/cli.html")).status()).toBe(200);
  expect((await request.get("/privacy.html")).status()).toBe(200);
  expect((await request.get("/README.md")).status()).toBe(404);
});

test("product requirements, template sources, history guide and SEO metadata are accurate", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/FDO.*DevOps workspace/);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("link[rel=canonical]")).toHaveAttribute(
    "href",
    "https://fdo.alexvwan.me/",
  );
  const graph = JSON.parse(
    await page.locator('script[type="application/ld+json"]').textContent(),
  )["@graph"];
  const app = graph.find((item) => item["@type"] === "SoftwareApplication");
  expect(app.softwareVersion).toBe("1.0.5");
  expect(app.operatingSystem).toEqual(["macOS", "Windows", "Linux"]);
  expect(app.aggregateRating).toBeUndefined();
  await expect(page.locator("#questions")).toContainText(
    "FDO includes its own SSH client on macOS, Windows and Linux",
  );
  await expect(page.locator("#questions")).toContainText(
    "must be installed on the computer running FDO",
  );
  await expect(
    page.getByRole("link", { name: "Explore snapshots & history ↗" }),
  ).toHaveAttribute("href", "workspace-history.html");
  await page.locator("[data-tour=manage]").click();
  const image = page.locator("#tour-manage img");
  await expect
    .poll(() =>
      image.evaluate((node) => node.complete && node.naturalWidth > 0),
    )
    .toBe(true);
  const asset = await request.get("/assets/fdo-plugin-management.png");
  expect(asset.status()).toBe(200);
  expect(asset.headers()["content-type"]).toContain("image/png");
  await page.goto("/templates.html");
  await expect(page.locator(".template-guide-card")).toHaveCount(10);
  await expect(
    page.getByRole("heading", { name: "SSH connections", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Git with SSH profiles", exact: true }),
  ).toBeVisible();
  for (const link of await page
    .getByRole("link", { name: "View actual template source ↗" })
    .all())
    expect(await link.getAttribute("href")).toContain(
      "/src/components/editor/utils/",
    );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("templates-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.goto("/workspace-history.html");
  await expect(
    page.getByRole("heading", { name: "1. Capture a useful checkpoint." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("history-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  expect((await request.get("/sitemap.xml")).status()).toBe(200);
});

test("the hero features a running plugin and editing tools remain optional", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".hero-visual img")).toHaveAttribute(
    "src",
    "assets/fdo-azure-finops.png",
  );
  await expect
    .poll(() =>
      page
        .locator(".hero-visual img")
        .evaluate((img) => img.complete && img.naturalWidth > 0),
    )
    .toBe(true);
  await expect(page.locator("#monaco-editor img")).toHaveAttribute(
    "src",
    "assets/fdo-editor.png",
  );
  await expect(page.locator("#monaco-editor")).toContainText(
    "built-in Monaco editor",
  );
  await expect(page.locator("#tour-design")).toContainText(
    "visual alternative to Monaco",
  );
  await expect(page.locator("[data-tour]").first()).toHaveAttribute(
    "data-tour",
    "manage",
  );
  await page.locator("[data-tour=design]").click();
  await expect(page.locator("#tour-design")).toBeVisible();
  await expect(page.locator("#tour-design")).toContainText(
    "Return to Monaco for code and backend logic",
  );
});

test("plugin use cases and terminal automation have distinct content", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#build")).toContainText("A plugin for");
  await expect(page.locator("#build .plugin-use-cases article")).toHaveCount(3);
  await expect(page.locator("#build")).toContainText("Azure FinOps");
  await expect(page.locator("#build")).not.toContainText("fdo init");
  await expect(page.locator("#cli")).toContainText("Less clicking.");
  await expect(page.locator("#cli")).toContainText(
    "fdo init ./my-tool --template blank",
  );
  await expect(page.locator(".hero-visual img")).toHaveAttribute(
    "width",
    "3438",
  );
  await expect(page.locator(".hero-visual img")).toHaveAttribute(
    "height",
    "1944",
  );
  await expect(page.locator(".hero-visual figcaption")).toContainText(
    "Azure FinOps & Resource Manager",
  );
});

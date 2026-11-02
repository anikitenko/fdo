const { test, expect } = require("@playwright/test");

for (const width of [1440, 390]) {
  test(`every page has the same usable navigation at ${width}px without JavaScript`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width, height: 1000 },
    });
    const page = await context.newPage();
    const labels = [
      "Product tour",
      "Features",
      "AI coding",
      "Build plugins",
      "CLI",
      "Workshops",
      "Docs",
    ];
    let expectedLinks;
    for (const route of [
      "/",
      "/ai-coding.html",
      "/cli.html",
      "/templates.html",
      "/workspace-history.html",
      "/workshops.html",
      "/privacy.html",
      "/404.html",
      "/missing/nested/page",
    ]) {
      await page.goto("http://127.0.0.1:4174" + route);
      const nav = page.getByRole("navigation", { name: "Main navigation" });
      await expect(nav.getByRole("link")).toHaveText(labels);
      const links = await nav
        .getByRole("link")
        .evaluateAll((items) => items.map((a) => a.href));
      expectedLinks ??= links;
      expect(links, `Targets differ on ${route}`).toEqual(expectedLinks);
      for (const label of labels) {
        await expect(
          nav.getByRole("link", { name: label, exact: true }),
          `${label} on ${route}`,
        ).toBeVisible();
      }
      const current = nav.locator('[aria-current="page"]');
      if (["/ai-coding.html", "/cli.html", "/workshops.html"].includes(route)) {
        await expect(current).toHaveCount(1);
        await expect(current).toHaveAttribute("href", route);
      } else {
        await expect(current).toHaveCount(0);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `Overflow on ${route}`,
      ).toBe(true);
    }
    // Root-relative header targets must recover from a nested 404 as well.
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Workshops" })
      .click();
    await expect(page).toHaveURL("http://127.0.0.1:4174/workshops.html");
    await expect(page.locator(".workshop-card")).toHaveCount(2);
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "CLI", exact: true })
      .click();
    await expect(page).toHaveURL("http://127.0.0.1:4174/cli.html");
    const tour = page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Product tour" });
    await tour.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("http://127.0.0.1:4174/index.html#tour");
    await context.close();
  });
}

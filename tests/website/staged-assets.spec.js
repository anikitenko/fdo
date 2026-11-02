const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");

let folder, output, server, origin;

test.beforeAll(async () => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "fdo-staged-website-"));
  output = path.join(folder, "public");
  execFileSync(process.execPath, ["scripts/website/site.cjs", "stage"], {
    cwd: path.resolve(__dirname, "../.."),
    env: { ...process.env, SITE_OUTPUT: output },
    stdio: "pipe",
  });
  server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const file = path.resolve(
      output,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    if (
      !file.startsWith(output + path.sep) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()
    ) {
      response.writeHead(404).end();
      return;
    }
    const types = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "text/javascript",
      ".jpg": "image/jpeg",
      ".png": "image/png",
    };
    response.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
    });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = "http://127.0.0.1:" + server.address().port;
});

test.afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (folder) fs.rmSync(folder, { recursive: true, force: true });
});

test("deployment HTML references the exact content-hashed CSS and JS assets", () => {
  for (const asset of ["styles.css", "site.js"]) {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../website", asset),
    );
    const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
    const parsed = path.parse(asset);
    const expected = `${parsed.name}.${hash}${parsed.ext}`;
    expect(fs.readFileSync(path.join(output, expected))).toEqual(source);
    for (const name of fs
      .readdirSync(output)
      .filter((file) => file.endsWith(".html"))) {
      const html = fs.readFileSync(path.join(output, name), "utf8");
      expect(html).not.toMatch(
        new RegExp(`(?:href|src)="/?${asset.replace(".", "\\.")}"`),
      );
      if (asset === "styles.css" && name !== "google9d9ae653e6dbd173.html")
        expect(html).toContain(expected);
    }
    if (asset === "site.js")
      expect(
        fs.readFileSync(path.join(output, "index.html"), "utf8"),
      ).toContain(expected);
  }
  expect(fs.readFileSync(path.join(output, "404.html"), "utf8")).toMatch(
    /href="\/styles\.[a-f0-9]{12}\.css"/,
  );
});

test("deployed workshop layout remains styled with stale canonical CSS available", async ({
  page,
}) => {
  let staleRequests = 0;
  await page.route("**/styles.css", (route) => {
    staleRequests++;
    // Simulate the preceding release's cached stylesheet without workshop rules.
    return route.fulfill({
      contentType: "text/css",
      body: "body { color: white; background: black; }",
    });
  });
  for (const [width, columns] of [
    [1440, 2],
    [390, 1],
  ]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(origin + "/workshops.html");
    await expect(page.locator('link[rel="stylesheet"]')).toHaveAttribute(
      "href",
      /styles\.[a-f0-9]{12}\.css/,
    );
    await expect(page.locator(".workshop-grid")).toHaveCSS("display", "grid");
    await expect(page.locator(".workshop-card").first()).toHaveCSS(
      "border-top-width",
      "1px",
    );
    await expect(page.locator(".workshop-play").first()).toHaveCSS(
      "position",
      "absolute",
    );
    expect(
      await page
        .locator(".workshop-grid")
        .evaluate(
          (node) =>
            getComputedStyle(node).gridTemplateColumns.split(" ").length,
        ),
    ).toBe(columns);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`deployed-workshops-${width}.png`),
      fullPage: true,
    });
  }
  expect(staleRequests).toBe(0);
});

"use strict";

// Keep the public site independent of Electron and the application's dependencies.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "../../website");
const publicFiles = [
  "index.html",
  "404.html",
  "cli.html",
  "styles.css",
  "site.js",
  "CNAME",
  "robots.txt",
  "sitemap.xml",
  "assets/sitemap.xsd",
  "assets/fdo-icon.png",
  "assets/social-card.png",
  "assets/fdo-editor.png",
];
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".xml": "application/xml",
  ".xsd": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

function check() {
  for (const file of publicFiles) {
    const target = path.join(root, file);
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size)
      throw new Error(`Missing or invalid public file: ${file}`);
  }
  if (
    fs.readFileSync(path.join(root, "CNAME"), "utf8").trim() !==
    "fdo.alexvwan.me"
  )
    throw new Error("Unexpected Pages domain.");
  for (const name of ["index.html", "404.html", "cli.html"]) {
    const html = fs.readFileSync(path.join(root, name), "utf8");
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    if (new Set(ids).size !== ids.length)
      throw new Error(`Duplicate element IDs in ${name}`);
    for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      const value = match[1];
      if (/^https:\/\//.test(value)) continue;
      if (value.startsWith("#")) {
        if (value.length > 1 && !ids.includes(value.slice(1)))
          throw new Error(`Broken anchor in ${name}: ${value}`);
        continue;
      }
      const [pathname, fragment] = value.split("#");
      const relative = pathname.startsWith("/")
        ? pathname.slice(1)
        : path.posix.join(path.posix.dirname(name), pathname);
      if (!relative) continue;
      const target = path.resolve(
        root,
        relative === "./" || relative === "." ? "index.html" : relative,
      );
      if (!target.startsWith(root + path.sep) || !fs.existsSync(target))
        throw new Error(`Broken local reference in ${name}: ${value}`);
      if (
        fragment &&
        !fs.readFileSync(target, "utf8").includes(`id="${fragment}"`)
      )
        throw new Error(`Broken page anchor in ${name}: ${value}`);
    }
  }
  execFileSync(process.execPath, ["--check", path.join(root, "site.js")], {
    stdio: "inherit",
  });
  console.log(
    `Website checks passed: ${publicFiles.length} public files, local references, anchors, and JavaScript syntax.`,
  );
}

function serve() {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be an integer from 1 to 65535.");
  const allowed = new Set(publicFiles);
  /**
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   */
  const handleRequest = (request, response) => {
    let pathname;
    try {
      pathname =
        decodeURIComponent(
          new URL(request.url, "http://localhost").pathname,
        ).replace(/^\//, "") || "index.html";
    } catch {
      response.writeHead(400).end();
      return;
    }
    const exists = allowed.has(pathname);
    const file = path.join(root, exists ? pathname : "404.html");
    response.writeHead(exists ? 200 : 404, {
      "Content-Type": mime[path.extname(file)] || "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") response.end();
    else fs.createReadStream(file).pipe(response);
  };
  const server = http.createServer(handleRequest);
  server.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () =>
    console.log(`FDO website: http://127.0.0.1:${port}`),
  );
}

function stage() {
  check();
  const output = process.env.SITE_OUTPUT;
  if (!output) throw new Error("SITE_OUTPUT is required for staging.");
  const destination = path.resolve(output);
  if (destination === root || destination.startsWith(root + path.sep))
    throw new Error("Stage outside the website source folder.");
  // Refuse existing paths: never clear a directory supplied by the caller.
  fs.mkdirSync(destination);
  for (const file of publicFiles) {
    const target = path.join(destination, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target, fs.constants.COPYFILE_EXCL);
  }
  console.log(`Staged ${publicFiles.length} public files in ${destination}`);
}

try {
  if (process.argv[2] === "serve") serve();
  else if (process.argv[2] === "check") check();
  else if (process.argv[2] === "stage") stage();
  else {
    console.error("Usage: node scripts/website/site.cjs <serve|check|stage>");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

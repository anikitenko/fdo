"use strict";

// Generate committed HTML so navigation works without JavaScript or a build.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../../website");
const pages = [
  "index.html",
  "ai-coding.html",
  "cli.html",
  "templates.html",
  "workspace-history.html",
  "workshops.html",
  "privacy.html",
  "404.html",
];
const links = [
  ["Product tour", "/index.html#tour"],
  ["Features", "/index.html#workspace"],
  ["AI coding", "/ai-coding.html"],
  ["Build plugins", "/index.html#build"],
  ["CLI", "/cli.html"],
  ["Workshops", "/workshops.html"],
  ["Docs", "/index.html#resources"],
];
const headerPattern = /<header class="site-header">[\s\S]*?<\/header>/g;

function header(page) {
  const current = page === "index.html" ? ' aria-current="page"' : "";
  const items = links
    .map(([label, href]) => {
      const className = label === "Workshops" ? ' class="nav-workshops"' : "";
      const active = href === "/" + page ? ' aria-current="page"' : "";
      return `<a${className} href="${href}"${active}>${label}</a>`;
    })
    .join("\n");
  return `<header class="site-header">
  <div class="container navigation">
    <a class="brand" href="/" aria-label="FDO home"${current}><img src="/assets/fdo-icon.png" width="128" height="128" alt="" /><span>FDO<span class="brand-dot">.</span></span></a>
    <nav aria-label="Main navigation">
      ${items}
    </nav>
    <a class="nav-github" href="https://github.com/anikitenko/fdo">GitHub <span aria-hidden="true">↗</span></a>
  </div>
</header>`;
}

function normalize(html) {
  return html
    .replace(/>\s+</g, "><")
    .replace(/\s+/g, " ")
    .replace(/\s+>/g, ">")
    .trim();
}

function navigation(write = false) {
  for (const page of pages) {
    const target = path.join(root, page);
    const html = fs.readFileSync(target, "utf8");
    const matches = [...html.matchAll(headerPattern)];
    if (matches.length !== 1)
      throw new Error(`Expected one shared header in ${page}`);
    const expected = header(page);
    if (write) fs.writeFileSync(target, html.replace(headerPattern, expected));
    else if (normalize(matches[0][0]) !== normalize(expected)) {
      throw new Error(
        `Navigation differs in ${page}. Run npm run website:nav.`,
      );
    }
  }
}

module.exports = { checkNavigation: () => navigation(), pages, links };
if (require.main === module) {
  navigation(process.argv.includes("--write"));
  console.log(
    "Shared website navigation " +
      (process.argv.includes("--write") ? "updated." : "verified."),
  );
}

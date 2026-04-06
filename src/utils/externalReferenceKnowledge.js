function stripTags(html = "") {
    return String(html || "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function decodeEntities(text = "") {
    return String(text || "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

export function extractReferenceUrls(text = "") {
    const matches = String(text || "").match(/https?:\/\/[^\s)>\]]+/gi) || [];
    return Array.from(new Set(matches.map((value) => value.replace(/[.,;!?]+$/g, ""))));
}

export function summarizeHtmlReference(url, html = "") {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const descriptionMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i)
        || html.match(/<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["']/i);
    const headingMatches = Array.from(html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi))
        .map((match) => decodeEntities(stripTags(match[1])))
        .filter(Boolean)
        .slice(0, 4);
    const listMatches = Array.from(html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi))
        .map((match) => decodeEntities(stripTags(match[1])))
        .filter((item) => item && item.length > 12)
        .slice(0, 6);
    const bodyText = decodeEntities(stripTags(html)).slice(0, 1200);

    return {
        url,
        title: decodeEntities(stripTags(titleMatch?.[1] || "")),
        description: decodeEntities(descriptionMatch?.[1] || ""),
        headings: headingMatches,
        bullets: listMatches,
        excerpt: bodyText,
    };
}

export function formatExternalReferenceContext(references = []) {
    if (!Array.isArray(references) || references.length === 0) {
        return "";
    }

    let output = "Relevant external reference material:\n";
    for (const ref of references) {
        output += `\nReference URL: ${ref.url}\n`;
        if (ref.title) output += `Title: ${ref.title}\n`;
        if (ref.description) output += `Description: ${ref.description}\n`;
        if (ref.headings?.length) output += `Key headings: ${ref.headings.join(" | ")}\n`;
        if (ref.bullets?.length) output += `Feature bullets: ${ref.bullets.join(" | ")}\n`;
        if (ref.excerpt) output += `Excerpt: ${ref.excerpt}\n`;
    }
    return `${output}\n---\n\n`;
}

export function shouldUseExternalReferenceKnowledge({ prompt = "", code = "", context = "" } = {}) {
    return extractReferenceUrls([prompt, code, context].filter(Boolean).join("\n")).length > 0;
}

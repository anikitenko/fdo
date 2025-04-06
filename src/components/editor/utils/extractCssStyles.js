import cssData from 'mdn-data/css/properties.json'
import htmlTags from 'html-tags'

const htmlTagSet = new Set(htmlTags)
const mdnProperties = new Set(Object.keys(cssData))

export function extractCssStyles(cssString) {
    cssString = replace(
        `:host{${cssString}}`,
        /**
         * Clean line breaks and normalize spaces
         */
        [/\s+/g, " "],
        /**
         * Delete comments
         */
        [/\/\*.+?\*\//g, ""],
        /**
         * Replace double characters with single characters
         */
        [/\"/g, `'`],
        /**
         * Add ";" in case of css compression
         */
        [/:([^;}]+)}/g, `:$1;}`],
        /**
         * Add import support
         */
        [/(@import +[^;]+);/g,`$1{}`],
        /**
         * Capture the selectors and generate an index block for the JSON
         */
        [/ *([^;{}]+) *{/g, (match, p1) => `"${p1.trim().replace(/^\./, "")}":{`], // Trims space in selector
        /**
         * Capture the css blocks "{}", to transform the css props into json props
         */
        [/{[^{}]+}/g, props],
        /**
         * Capture the first excluded block when using nested selectors
         */
        [/{([^"]+)/g, props],
        /**
         * Fix the union of props
         */
        [/}"/g, `},"`],
        /**
         * Fix props separation
         */
        [/, *}/g, `}`]
    );

    const parsed = JSON.parse(`{${cssString}}`)[":host"]
    const merged = mergeSubSelectors(parsed)
    return returnRemovedDots(injectPseudoVariants(merged))
}

/**
 * Formats properties as JSON
 * @param {string} block
 */
const props = (block) =>
    block.replace(/([\w-&+.\s]+) *: *([^;]+);/g, (match, p1, p2) => {
        return `"${p1.trim()}":"${p2.trim()}",`;
    });

/**
 * Execute multiple replace operations on a string
 * @param {string} str
 * @param {any[]} args
 */
const replace = (str, ...args) =>
    args.reduce((str, args) => str.replace(...args), str);

const returnRemovedDots = (styles) => {
    const output = {}

    for (const key in styles) {
        const value = styles[key]

        const baseMatch = key.match(/^([^.]+)(?:\.(.+))?$/)

        if (baseMatch && !key.startsWith('@')) {
            const base = baseMatch[1] // e.g. "details"
            const extension = baseMatch[2] // e.g. "visible"

            if (extension) {
                // Merge into base
                output[base] = output[base] || {}
                output[base][`&.${extension}`] = styles[key]
            } else {
                // Base element
                if (typeof value === 'object' && value !== null) {
                    output[base] = {
                        ...(output[base] || {}),
                        ...processStyles(value)
                    }
                } else {
                    output[base] = value
                }
            }
        } else {
            // Keep untouched (e.g. @import or full selectors)
            output[key] = value
        }
    }

    return output

    function processStyles(obj) {
        const result = {}
        for (const key in obj) {
            const value = obj[key]
            const isLikelyClass =
                /^[a-zA-Z][\w-]*$/.test(key) &&
                !mdnProperties.has(key) &&
                !htmlTagSet.has(key.toLowerCase())

            const isPseudoOrCombinator =
                key.startsWith('&') ||
                /^[^a-zA-Z0-9]/.test(key) ||
                key.includes(' ') ||
                key.startsWith(':')

            const newKey =
                isLikelyClass ? `&.${key}` :
                    isPseudoOrCombinator ? key :
                        key

            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                result[newKey] = processStyles(value)
            } else {
                result[newKey] = value
            }
        }
        return result
    }
}

const injectPseudoVariants = (styles) => {
    const updated = { ...styles }

    for (const selector in styles) {
        if (!(selector.includes(":") || selector.includes("[") || selector.includes(" "))) continue // skip if there's no pseudo/combinator

        // Try to find the base class name (e.g., "toggleCheckbox")
        const baseMatch = selector.match(/^([\w-]+)/)
        const base = baseMatch?.[1]

        if (base && updated[base]) {
            const suffix = selector.slice(base.length) // e.g., ":checked + .toggleSwitch.toggle-large::before"
            updated[base] = {
                ...updated[base],
                [`${selector.includes(" ") ? "" : "&"}${suffix}`]: styles[selector]
            }

            // Remove from top-level
            delete updated[selector]
        }
    }

    return updated
}

const mergeSubSelectors = (styles) => {
    const grouped = {}

    for (const selector in styles) {
        const baseMatch = selector.match(/^(\.[\w-]+)/)
        const base = baseMatch?.[1] || selector
        const suffix = selector.slice(base.length).trim()

        // Ensure the base exists
        if (!grouped[base]) grouped[base] = {}

        if (!suffix) {
            // top-level selector like `.toggle-large`
            Object.assign(grouped[base], styles[selector])
        } else if (suffix.startsWith(":") || suffix.startsWith("::") || suffix.startsWith("[")) {
            // pseudo selectors like `.toggle-large::before`
            grouped[base][suffix] = styles[selector]
        } else {
            // treat as its own full selector (like `.modal + .modalInner`)
            grouped[selector] = styles[selector]
        }
    }

    return grouped
}

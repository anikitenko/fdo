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
         * Uncomment to add import support
         * [/(@import +[^;]+);/g,`$1{}`],
         */
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

    return JSON.parse(`{${cssString}}`)[":host"];
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

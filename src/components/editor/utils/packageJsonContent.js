export const packageJsonContent = (name) => JSON.stringify({
    name: name,
    main: "dist/index.cjs",
    source: "index.ts"
}, null, 2);

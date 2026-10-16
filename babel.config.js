module.exports = api => {
  const isTest = api.env("test");
  return {
    presets: [
      ["@babel/preset-env", {targets: {node: "current"}, modules: isTest ? "commonjs" : "auto"}],
      ["@babel/preset-react", {development: false}],
    ],
    plugins: isTest ? ["@babel/plugin-transform-dynamic-import"] : [],
  };
};

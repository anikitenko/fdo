// Playwright global setup to add a delay before tests
module.exports = async () => {
  // Wait 1 second before starting tests
  await new Promise(resolve => setTimeout(resolve, 1000));
};

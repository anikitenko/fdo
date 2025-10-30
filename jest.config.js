module.exports = {
  testEnvironment: 'node', // Default to node for backend/unit tests
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.{js,jsx}',
    '!src/assets/**',
    '!**/node_modules/**'
  ],
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': '<rootDir>/tests/__mocks__/styleMock.js',
    '\\.(gif|ttf|eot|svg|png|jpg|jpeg|woff|woff2)$': '<rootDir>/tests/__mocks__/fileMock.js',
    '^monaco-editor$': '<rootDir>/tests/__mocks__/monacoMock.js'
  },
  transform: {
    '^.+\\.jsx?$': 'babel-jest'
  },
  transformIgnorePatterns: [
    'node_modules/(?!(monaco-editor)/)'
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  verbose: true
};


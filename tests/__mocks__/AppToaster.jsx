// Jest mock for AppToaster that matches the async export shape
export const AppToaster = Promise.resolve({
  show: jest.fn(),
  dismiss: jest.fn(),
});

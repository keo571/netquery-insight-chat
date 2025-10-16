export const debugLog = (...args) => {
  if (process.env.NODE_ENV !== 'production') {
    console.debug(...args);
  }
};

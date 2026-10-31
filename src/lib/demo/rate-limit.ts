// Bounded, best-effort protection per server process. No IP headers or external service.
// Restarts and additional instances have separate budgets; this is not a global quota.
export function createDemoLimiter(limit = 30) {
  let window = -1;
  let attempts = 0;
  return (now = Date.now()) => {
    const current = Math.floor(now / 60000);
    if (current !== window) { window = current; attempts = 0; }
    attempts += 1;
    return attempts <= limit;
  };
}
export const takeDemoLoginSlot = createDemoLimiter();

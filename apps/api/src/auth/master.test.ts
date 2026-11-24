import { describe, expect, it } from 'vitest';
import { createLoginLimiter, verifyMasterCredentials } from './master.js';

const master = { username: 'root', password: 'correct-horse-battery' };

describe('verifyMasterCredentials', () => {
  it('accepts only the exact username and password', () => {
    expect(verifyMasterCredentials(master, 'root', 'correct-horse-battery')).toBe(true);
    expect(verifyMasterCredentials(master, 'root', 'correct-horse-batter')).toBe(false);
    expect(verifyMasterCredentials(master, 'Root', 'correct-horse-battery')).toBe(false);
    expect(verifyMasterCredentials(master, '', '')).toBe(false);
  });
});

describe('createLoginLimiter', () => {
  it('blocks after maxFailures within the window and recovers when it passes', () => {
    let now = 0;
    const limiter = createLoginLimiter({ maxFailures: 3, windowMs: 1000, now: () => now });
    limiter.fail();
    limiter.fail();
    expect(limiter.blocked()).toBe(false);
    limiter.fail();
    expect(limiter.blocked()).toBe(true);
    now = 1001;
    expect(limiter.blocked()).toBe(false);
  });

  it('reset clears the failures', () => {
    const limiter = createLoginLimiter({ maxFailures: 1 });
    limiter.fail();
    expect(limiter.blocked()).toBe(true);
    limiter.reset();
    expect(limiter.blocked()).toBe(false);
  });
});

class RateLimiter {
  constructor() {
    this.limits = {
      'start-scan': { maxCalls: 1, windowMs: 60000 }, // 1 per minute
      'stop-scan': { maxCalls: 10, windowMs: 60000 },
      'export-results': { maxCalls: 5, windowMs: 60000 },
      'save-config': { maxCalls: 20, windowMs: 60000 }
    };
    
    this.calls = new Map();
  }
  
  checkLimit(channel) {
    const limit = this.limits[channel];
    if (!limit) return true; // No limit defined
    
    const now = Date.now();
    const key = channel;
    
    if (!this.calls.has(key)) {
      this.calls.set(key, []);
    }
    
    const calls = this.calls.get(key);
    
    // Remove old calls outside window
    const validCalls = calls.filter(time => now - time < limit.windowMs);
    this.calls.set(key, validCalls);
    
    // Check if limit exceeded
    if (validCalls.length >= limit.maxCalls) {
      const oldestCall = Math.min(...validCalls);
      const resetTime = Math.ceil((limit.windowMs - (now - oldestCall)) / 1000);
      throw new Error(`Rate limit exceeded for ${channel}. Try again in ${resetTime} seconds.`);
    }
    
    // Record this call
    validCalls.push(now);
    return true;
  }
  
  reset(channel) {
    if (channel) {
      this.calls.delete(channel);
    } else {
      this.calls.clear();
    }
  }
}

module.exports = RateLimiter;
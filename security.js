// security.js
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes

// Clean up old attempts every hour
setInterval(() => {
    const now = Date.now();
    for (const [ip, attemptData] of loginAttempts.entries()) {
        if (now - attemptData.lastAttempt > LOCKOUT_TIME * 2) {
            loginAttempts.delete(ip);
        }
    }
}, 60 * 60 * 1000); // Cleanup every hour

function recordFailedAttempt(ip) {
    const now = Date.now();
    let attemptData = loginAttempts.get(ip) || { 
        count: 0, 
        firstAttempt: now,
        lastAttempt: now,
        lockedUntil: 0 
    };
    
    attemptData.count++;
    attemptData.lastAttempt = now;
    
    if (attemptData.count >= MAX_ATTEMPTS) {
        attemptData.lockedUntil = now + LOCKOUT_TIME;
    }
    
    loginAttempts.set(ip, attemptData);
    return attemptData;
}

function getRemainingAttempts(ip) {
    const attemptData = loginAttempts.get(ip);
    if (!attemptData) return MAX_ATTEMPTS;
    
    if (attemptData.lockedUntil > Date.now()) {
        return 0; // Locked out
    }
    
    return Math.max(0, MAX_ATTEMPTS - attemptData.count);
}

function isIpLocked(ip) {
    const attemptData = loginAttempts.get(ip);
    return attemptData && attemptData.lockedUntil > Date.now();
}

module.exports = {
    loginAttempts,
    MAX_ATTEMPTS,
    LOCKOUT_TIME,
    recordFailedAttempt,
    getRemainingAttempts,
    isIpLocked
};
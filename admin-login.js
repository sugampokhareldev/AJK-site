// admin-login.js - Secure External JavaScript file with Brute Force Protection
document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    const errorMessage = document.getElementById('errorMessage');
    const successMessage = document.getElementById('successMessage');
    const loading = document.getElementById('loading');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const loginButton = loginForm ? loginForm.querySelector('button[type="submit"]') : null;
    
    // Constants for brute force protection
    const MAX_ATTEMPTS = 5;
    const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes in milliseconds
    
    // Clear any pre-filled values for security
    if (usernameInput) usernameInput.value = '';
    if (passwordInput) passwordInput.value = '';
    
    // Check login attempts status on page load
    checkLoginAttempts();
    
    if (loginForm) {
        loginForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const username = usernameInput.value;
            const password = passwordInput.value;
            
            // Basic validation
            if (!username || !password) {
                showError('Please enter both username and password');
                return;
            }
            
            // Check attempts before submitting
            const attemptsInfo = await checkLoginAttempts();
            if (attemptsInfo.isLocked) {
                const minutes = Math.ceil((attemptsInfo.lockedUntil - Date.now()) / 60000);
                showError(`Account locked. Try again in ${minutes} minutes.`);
                return;
            }
            
            // Reset messages
            hideMessages();
            loading.style.display = 'block';
            if (loginButton) loginButton.disabled = true;
            
            try {
                console.log('Attempting secure login');
                
                const response = await fetch('/api/admin/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ username, password }),
                    credentials: 'include'
                });
                
                console.log('Response status:', response.status);
                
                // Handle different HTTP status codes
                if (response.status === 429) {
                    const data = await response.json();
                    showError(data.error || 'Too many login attempts. Please try again later.');
                    await checkLoginAttempts(); // Update attempt status
                    return;
                }
                
                const data = await response.json();
                console.log('Response data:', data);
                
                loading.style.display = 'none';
                if (loginButton) loginButton.disabled = false;
                
                if (data.success) {
                    showSuccess('Login successful! Redirecting...');
                    
                    // Clear form and redirect
                    loginForm.reset();
                    
                    setTimeout(() => {
                        window.location.href = '/admin';
                    }, 1000);
                } else {
                    showError(data.error || 'Login failed. Please check your credentials.');
                    // Update attempt status after failed login
                    setTimeout(checkLoginAttempts, 500);
                }
            } catch (error) {
                console.error('Login error:', error);
                loading.style.display = 'none';
                if (loginButton) loginButton.disabled = false;
                showError('Network error. Please check if server is running and try again.');
            }
        });
    }
    
    // Check login attempts status
    async function checkLoginAttempts() {
        try {
            const response = await fetch('/api/admin/login-attempts', {
                credentials: 'include'
            });
            
            if (response.ok) {
                const data = await response.json();
                
                if (data.isLocked && loginButton) {
                    const minutes = Math.ceil((data.lockedUntil - Date.now()) / 60000);
                    showError(`Account locked. Try again in ${minutes} minutes.`);
                    loginButton.disabled = true;
                } else if (data.remainingAttempts < MAX_ATTEMPTS && data.remainingAttempts > 0) {
                    showError(`${data.remainingAttempts} login attempts remaining.`);
                    if (loginButton) loginButton.disabled = false;
                } else if (data.remainingAttempts === 0) {
                    showError('No login attempts remaining. Account locked.');
                    if (loginButton) loginButton.disabled = true;
                } else {
                    hideMessages();
                    if (loginButton) loginButton.disabled = false;
                }
                
                return data;
            }
        } catch (error) {
            console.log('Could not check login attempts:', error);
            if (loginButton) loginButton.disabled = false;
        }
        return { isLocked: false, remainingAttempts: MAX_ATTEMPTS };
    }
    
    // Helper functions
    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
        successMessage.style.display = 'none';
        loading.style.display = 'none';
    }
    
    function showSuccess(message) {
        successMessage.textContent = message;
        successMessage.style.display = 'block';
        errorMessage.style.display = 'none';
        loading.style.display = 'none';
    }
    
    function hideMessages() {
        errorMessage.style.display = 'none';
        successMessage.style.display = 'none';
        loading.style.display = 'none';
    }
    
    // Test the connection on page load
    console.log('Secure login page loaded');
    
    // Test if API is reachable and check auth status
    checkAuthStatus();
    
    function checkAuthStatus() {
        fetch('/api/admin/status', {
            credentials: 'include'
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('API not reachable');
            }
            return response.json();
        })
        .then(data => {
            console.log('API status check:', data);
            if (data.authenticated) {
                // Already logged in, redirect to admin panel
                showSuccess('Already logged in. Redirecting...');
                setTimeout(() => {
                    window.location.href = '/admin';
                }, 500);
            }
        })
        .catch(error => {
            console.log('API status check:', error.message);
            // Don't show error to user, just log it
        });
    }
    
    // Add security: Clear form on page refresh
    window.addEventListener('beforeunload', function() {
        if (loginForm) {
            loginForm.reset();
        }
    });
    
    // Add security: Prevent form autofill
    if (usernameInput && passwordInput) {
        usernameInput.autocomplete = 'off';
        passwordInput.autocomplete = 'off';
        
        // Additional security: Clear fields if page is shown from back-forward cache
        window.addEventListener('pageshow', function(event) {
            if (event.persisted) {
                usernameInput.value = '';
                passwordInput.value = '';
                hideMessages();
                checkLoginAttempts(); // Re-check attempt status
            }
        });
    }
    
    // Periodically check attempt status if form is visible
    setInterval(checkLoginAttempts, 30000); // Check every 30 seconds
});
// admin-login.js - External JavaScript file
document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    const errorMessage = document.getElementById('errorMessage');
    const successMessage = document.getElementById('successMessage');
    const loading = document.getElementById('loading');
    
    if (loginForm) {
        loginForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            
            // Reset messages
            errorMessage.style.display = 'none';
            successMessage.style.display = 'none';
            loading.style.display = 'block';
            
            try {
                console.log('Attempting login with:', username);
                
                const response = await fetch('/api/admin/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ username, password }),
                    credentials: 'include'
                });
                
                console.log('Response status:', response.status);
                
                const data = await response.json();
                console.log('Response data:', data);
                
                loading.style.display = 'none';
                
                if (data.success) {
                    successMessage.textContent = 'Login successful! Redirecting...';
                    successMessage.style.display = 'block';
                    
                    // Redirect to admin panel after successful login
                    setTimeout(() => {
                        window.location.href = '/admin';
                    }, 1000);
                } else {
                    errorMessage.textContent = data.error || 'Login failed';
                    errorMessage.style.display = 'block';
                }
            } catch (error) {
                console.error('Login error:', error);
                loading.style.display = 'none';
                errorMessage.textContent = 'Network error. Please check if server is running.';
                errorMessage.style.display = 'block';
            }
        });
    }
    
    // Test the connection on page load
    console.log('Login page loaded');
    
    // Test if API is reachable
    fetch('/api/admin/status', {
        credentials: 'include'
    })
    .then(response => response.json())
    .then(data => {
        console.log('API status check:', data);
        if (data.authenticated) {
            // Already logged in, redirect to admin panel
            window.location.href = '/admin';
        }
    })
    .catch(error => {
        console.log('API status check failed - server might be down:', error);
    });
});
// admin.js - Fixed version with proper authentication handling
console.log('Admin JS loaded successfully!');

let autoRefreshInterval = null;
let isAutoRefreshEnabled = false;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, initializing admin panel...');
    checkAuthStatus();
    setupEventListeners();
});

function setupEventListeners() {
    // Set up event listeners using event delegation
    document.addEventListener('click', function(event) {
        // Handle view buttons
        if (event.target.classList.contains('view-btn')) {
            const id = event.target.getAttribute('data-id');
            if (id) viewDetails(parseInt(id));
        }
        
        // Handle delete buttons
        if (event.target.classList.contains('delete-btn')) {
            const id = event.target.getAttribute('data-id');
            if (id) deleteSubmission(parseInt(id));
        }
        
        // Handle refresh button
        if (event.target.id === 'refresh-btn' || event.target.closest('#refresh-btn')) {
            loadSubmissions();
        }
        
        // Handle auto-refresh toggle
        if (event.target.id === 'autoRefreshBtn' || event.target.closest('#autoRefreshBtn')) {
            toggleAutoRefresh();
        }
        
        // Handle export button
        if (event.target.id === 'export-btn' || event.target.closest('#export-btn')) {
            exportData();
        }
        
        // Handle logout button
        if (event.target.id === 'logout-btn' || event.target.closest('#logout-btn')) {
            handleLogout();
        }
    });

    // Set up interval input change listener
    const refreshIntervalInput = document.getElementById('refreshInterval');
    if (refreshIntervalInput) {
        refreshIntervalInput.addEventListener('change', updateRefreshInterval);
    }

    // Set up login form submission
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', function(e) {
            e.preventDefault();
            handleLogin();
        });
    }
}

// Check authentication status
async function checkAuthStatus() {
    console.log('Checking authentication status...');
    try {
        const response = await fetch('/api/admin/status', {
            credentials: 'include'
        });
        
        console.log('Auth status response:', response.status);
        const data = await response.json();
        console.log('Auth status data:', data);
        
        if (data.authenticated) {
            console.log('User is authenticated, loading submissions...');
            showAdminPanel();
            loadSubmissions();
        } else {
            console.log('User not authenticated, showing login form...');
            showLoginForm();
        }
    } catch (error) {
        console.error('Auth check error:', error);
        showLoginForm();
        showNotification('Authentication check failed: ' + error.message, 'error');
    }
}

// Handle login
async function handleLogin() {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    
    if (!username || !password) {
        showNotification('Please enter both username and password', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/admin/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password }),
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Login successful!');
            showAdminPanel();
            loadSubmissions();
        } else {
            showNotification('Login failed: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('Login error:', error);
        showNotification('Login error: ' + error.message, 'error');
    }
}

// Handle logout
async function handleLogout() {
    try {
        const response = await fetch('/api/admin/logout', {
            method: 'POST',
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Logged out successfully');
            showLoginForm();
        } else {
            showNotification('Logout failed: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('Logout error:', error);
        showNotification('Logout error: ' + error.message, 'error');
    }
}

// Show login form
function showLoginForm() {
    const loginSection = document.getElementById('login-section');
    const adminPanel = document.getElementById('admin-panel');
    
    if (loginSection) loginSection.style.display = 'block';
    if (adminPanel) adminPanel.style.display = 'none';
}

// Show admin panel
function showAdminPanel() {
    const loginSection = document.getElementById('login-section');
    const adminPanel = document.getElementById('admin-panel');
    
    if (loginSection) loginSection.style.display = 'none';
    if (adminPanel) adminPanel.style.display = 'block';
}

// Function to show notification
function showNotification(message, type = 'success') {
    // Create notification element if it doesn't exist
    let notification = document.getElementById('notification');
    if (!notification) {
        notification = document.createElement('div');
        notification.id = 'notification';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            border-radius: 5px;
            color: white;
            z-index: 1000;
            opacity: 0;
            transform: translateY(-20px);
            transition: all 0.3s ease;
        `;
        document.body.appendChild(notification);
    }
    
    notification.textContent = message;
    notification.className = type === 'error' ? 'notification error' : 'notification success';
    notification.style.backgroundColor = type === 'error' ? '#e53e3e' : '#48bb78';
    notification.style.opacity = '1';
    notification.style.transform = 'translateY(0)';
    
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateY(-20px)';
    }, 3000);
}

// Load submissions from server
async function loadSubmissions() {
    console.log('Loading submissions...');
    try {
        const response = await fetch('/api/submissions', {
            credentials: 'include'
        });
        
        console.log('Submissions response status:', response.status);
        
        if (response.status === 401) {
            console.log('Not authorized, showing login form...');
            showLoginForm();
            return;
        }
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Submissions data received:', data);
        
        displaySubmissions(data);
        updateLastRefreshed();
        
    } catch (error) {
        console.error('Error loading submissions:', error);
        showNotification('Error loading submissions: ' + error.message, 'error');
        updateLastRefreshed(true);
    }
}

// Display submissions in the table
function displaySubmissions(data) {
    const tableBody = document.querySelector('#submissionsTable tbody');
    if (!tableBody) {
        console.error('Submissions table body not found!');
        showNotification('Table element not found', 'error');
        return;
    }
    
    if (data.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5">
                    <div class="empty-state">
                        <i>📝</i>
                        <p>No submissions yet. Form data will appear here.</p>
                    </div>
                </td>
            </tr>
        `;
        updateStats(0);
        return;
    }
    
    tableBody.innerHTML = '';
    
    data.forEach(submission => {
        const row = document.createElement('tr');
        const date = new Date(submission.submitted_at);
        const formattedDate = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        
        row.innerHTML = `
            <td>${submission.id}</td>
            <td>${submission.name}</td>
            <td>${submission.email}</td>
            <td>${formattedDate}</td>
            <td>
                <button class="view-btn" data-id="${submission.id}">View</button>
                <button class="delete-btn" data-id="${submission.id}">Delete</button>
            </td>
        `;
        tableBody.appendChild(row);
    });
    
    updateStats(data.length);
}

// Update statistics
function updateStats(total) {
    const totalEl = document.getElementById('totalSubmissions');
    const todayEl = document.getElementById('todaySubmissions');
    const weekEl = document.getElementById('weekSubmissions');
    
    if (totalEl) totalEl.textContent = total;
    if (todayEl) todayEl.textContent = Math.min(total, 5);
    if (weekEl) weekEl.textContent = Math.min(total, 12);
}

// Update last refreshed timestamp
function updateLastRefreshed(isError = false) {
    const lastRefreshedEl = document.getElementById('lastRefreshed');
    if (!lastRefreshedEl) return;
    
    const now = new Date();
    const timeString = now.toLocaleTimeString();
    const dateString = now.toLocaleDateString();
    
    if (isError) {
        lastRefreshedEl.innerHTML = 
            `Last refresh attempt: <span style="color: #e53e3e;">${dateString} ${timeString} (Failed)</span>`;
    } else {
        lastRefreshedEl.innerHTML = 
            `Last refreshed: ${dateString} ${timeString}`;
    }
}

// View submission details
// View submission details - FIXED VERSION
async function viewDetails(id) {
    console.log('Viewing details for submission:', id, typeof id);
    
    try {
        const response = await fetch(`/api/submissions/${id}`, {
            credentials: 'include'
        });
        
        console.log('Detail response status:', response.status);
        
        if (response.status === 404) {
            throw new Error('Submission not found');
        }
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Detail data received:', data);
        
        if (data && data.id) {
            const date = new Date(data.submitted_at);
            document.getElementById('detail-id').textContent = data.id;
            document.getElementById('detail-name').textContent = data.name;
            document.getElementById('detail-email').textContent = data.email;
            document.getElementById('detail-message').textContent = data.message;
            document.getElementById('detail-date').textContent = date.toLocaleString();
            
            document.getElementById('detailView').style.display = 'block';
        } else {
            throw new Error('Invalid response data');
        }
    } catch (error) {
        console.error('Error loading submission details:', error);
        showNotification('Error: ' + error.message, 'error');
    }
}

// Delete a submission - FIXED VERSION
async function deleteSubmission(id) {
    console.log('Deleting submission:', id, typeof id);
    
    if (!confirm('Are you sure you want to delete this submission? This action cannot be undone.')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/submissions/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        console.log('Delete response status:', response.status);
        
        const data = await response.json();
        console.log('Delete response data:', data);
        
        if (response.ok && data.success) {
            showNotification('Submission deleted successfully!');
            loadSubmissions();
            document.getElementById('detailView').style.display = 'none';
        } else {
            throw new Error(data.error || 'Delete failed');
        }
    } catch (error) {
        console.error('Error deleting submission:', error);
        showNotification('Error: ' + error.message, 'error');
    }
}

// Export data as CSV
async function exportData() {
    try {
        const response = await fetch('/api/submissions', {
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.length === 0) {
            showNotification('No data to export', 'error');
            return;
        }
        
        let csvContent = "ID,Name,Email,Message,Date\n";
        
        data.forEach(submission => {
            csvContent += `"${submission.id}","${submission.name}","${submission.email}","${submission.message.replace(/"/g, '""')}","${submission.submitted_at}"\n`;
        });
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", "form_submissions.csv");
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        showNotification('Data exported successfully!');
    } catch (error) {
        console.error('Error exporting data:', error);
        showNotification('Error exporting data', 'error');
    }
}

// Toggle auto-refresh
function toggleAutoRefresh() {
    const autoRefreshBtn = document.getElementById('autoRefreshBtn');
    const statusText = document.getElementById('statusText');
    const statusIndicator = document.querySelector('.status-indicator');
    
    if (isAutoRefreshEnabled) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
        isAutoRefreshEnabled = false;
        autoRefreshBtn.innerHTML = '<i>⏱️</i> Auto-Refresh: OFF';
        autoRefreshBtn.classList.remove('active');
        statusText.textContent = 'Auto-Refresh Paused';
        statusIndicator.className = 'status-indicator status-paused';
    } else {
        const interval = parseInt(document.getElementById('refreshInterval').value) * 1000;
        autoRefreshInterval = setInterval(loadSubmissions, interval);
        isAutoRefreshEnabled = true;
        autoRefreshBtn.innerHTML = '<i>⏱️</i> Auto-Refresh: ON';
        autoRefreshBtn.classList.add('active');
        statusText.textContent = 'Auto-Refresh Active';
        statusIndicator.className = 'status-indicator status-live';
        loadSubmissions();
    }
}

// Update refresh interval
function updateRefreshInterval() {
    if (isAutoRefreshEnabled) {
        clearInterval(autoRefreshInterval);
        const interval = parseInt(document.getElementById('refreshInterval').value) * 1000;
        autoRefreshInterval = setInterval(loadSubmissions, interval);
    }
}

// Add this debug function
async function debugAPI() {
    console.log('Debugging API endpoints...');
    
    try {
        // Test authentication status
        const authResponse = await fetch('/api/admin/status', { credentials: 'include' });
        console.log('Auth status:', authResponse.status, await authResponse.json());
        
        // Test submissions endpoint
        const submissionsResponse = await fetch('/api/submissions', { credentials: 'include' });
        console.log('Submissions status:', submissionsResponse.status);
        const submissions = await submissionsResponse.json();
        console.log('Submissions data:', submissions);
        
        if (submissions.length > 0) {
            // Test single submission endpoint
            const singleResponse = await fetch(`/api/submissions/${submissions[0].id}`, { 
                credentials: 'include' 
            });
            console.log('Single submission status:', singleResponse.status);
            console.log('Single submission data:', await singleResponse.json());
        }
    } catch (error) {
        console.error('Debug error:', error);
    }
}

// Call it when needed for debugging
// debugAPI();

// Make functions available globally for HTML onclick attributes if needed
window.loadSubmissions = loadSubmissions;
window.viewDetails = viewDetails;
window.deleteSubmission = deleteSubmission;
window.exportData = exportData;
window.toggleAutoRefresh = toggleAutoRefresh;
// admin.js - Complete Fixed Admin Panel
class AdminPanel {
    constructor() {
        this.ws = null;
        this.clientId = null;
        this.isAuthenticated = false;
        this.currentChatClientId = null;
        this.isTyping = false;
        this.typingTimer = null;
        this.autoRefreshInterval = null;
        this.autoRefreshEnabled = false;
        this.currentSubmissionId = null;
        this.activeChats = [];
        this.currentChatName = null;
        this.reconnectTimeout = null;
        this.lastMessageIds = new Set();
        this.isRefreshing = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        
        this.initializeElements();
        this.setupEventListeners();
        this.checkAuthStatus();
    }

    // Initialize DOM elements
    initializeElements() {
        this.elements = {};
        
        const elementIds = [
            'login-section', 'admin-panel', 'login-btn', 'username', 'password',
            'login-message', 'refresh-btn', 'autoRefreshBtn', 'export-btn',
            'chat-btn', 'logout-btn', 'refreshInterval', 'refreshStatus',
            'statusText', 'totalSubmissions', 'todaySubmissions', 'weekSubmissions', 
            'submissionsTable', 'detailView', 'close-details', 'lastRefreshed', 
            'chat-history', 'reply-message', 'send-reply', 'connectionStatus', 
            'active-chats-list', 'no-active-chats', 'refresh-chats', 'chat-search',
            'user-details', 'clear-chat', 'close-chat', 'char-count', 'typing-indicator',
            'current-chat-name', 'current-chat-avatar', 'chat-header', 'reply-section',
            'no-chat-selected', 'statusIndicator'
        ];

        elementIds.forEach(id => {
            this.elements[id] = document.getElementById(id);
        });

        // Get status indicator if not found by ID
        if (!this.elements.statusIndicator) {
            this.elements.statusIndicator = document.querySelector('.status-indicator');
        }
    }

    // Setup event listeners
    setupEventListeners() {
        // Login events
        if (this.elements['login-btn']) {
            this.elements['login-btn'].addEventListener('click', (e) => {
                e.preventDefault();
                this.handleLogin();
            });
        }

        if (this.elements.password) {
            this.elements.password.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.handleLogin();
                }
            });
        }

        // Control buttons
        if (this.elements['refresh-btn']) {
            this.elements['refresh-btn'].addEventListener('click', () => this.refreshData());
        }

        if (this.elements.autoRefreshBtn) {
            this.elements.autoRefreshBtn.addEventListener('click', () => this.toggleAutoRefresh());
        }

        if (this.elements['export-btn']) {
            this.elements['export-btn'].addEventListener('click', () => this.exportCSV());
        }

        if (this.elements['logout-btn']) {
            this.elements['logout-btn'].addEventListener('click', () => this.logout());
        }

        // Chat functionality
        if (this.elements['send-reply']) {
            this.elements['send-reply'].addEventListener('click', () => this.sendReplyMessage());
        }

        if (this.elements['reply-message']) {
            this.elements['reply-message'].addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendReplyMessage();
                }
            });

            this.elements['reply-message'].addEventListener('input', () => this.handleTyping());
        }

        // Search functionality
        if (this.elements['chat-search']) {
            let searchTimeout;
            this.elements['chat-search'].addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    this.filterChats(e.target.value);
                }, 300); // Debounce search
            });
        }

        // Detail view close button
        if (this.elements['close-details']) {
            this.elements['close-details'].addEventListener('click', () => {
                this.elements.detailView.style.display = 'none';
                this.currentSubmissionId = null;
            });
        }

        // Chat action buttons
        if (this.elements['refresh-chats']) {
            this.elements['refresh-chats'].addEventListener('click', () => {
                this.elements['refresh-chats'].classList.add('refreshing');
                this.loadActiveChats().finally(() => {
                    setTimeout(() => {
                        this.elements['refresh-chats'].classList.remove('refreshing');
                    }, 500);
                });
            });
        }

        if (this.elements['user-details']) {
            this.elements['user-details'].addEventListener('click', () => {
                if (this.currentChatClientId) {
                    this.showUserDetails();
                } else {
                    this.showNotification('Please select a chat first', 'error');
                }
            });
        }

        if (this.elements['clear-chat']) {
            this.elements['clear-chat'].addEventListener('click', () => {
                if (this.currentChatClientId) {
                    if (confirm('Are you sure you want to delete this chat and all its history?')) {
                        this.deleteChat(this.currentChatClientId);
                    }
                } else {
                    this.showNotification('Please select a chat first', 'error');
                }
            });
        }

        if (this.elements['close-chat']) {
            this.elements['close-chat'].addEventListener('click', () => {
                this.resetChatUI();
            });
        }

        // Initialize auto refresh interval input
        if (this.elements.refreshInterval) {
            this.elements.refreshInterval.addEventListener('change', () => {
                if (this.autoRefreshEnabled) {
                    this.startAutoRefresh();
                }
            });
        }

        // Initialize keyboard shortcuts
        this.initializeKeyboardShortcuts();
    }

    // Initialize keyboard shortcuts
    initializeKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + R to refresh
            if ((e.ctrlKey || e.metaKey) && e.key === 'r' && this.isAuthenticated) {
                e.preventDefault();
                this.refreshData();
            }
            
            // Escape to close modals
            if (e.key === 'Escape') {
                if (this.elements.detailView?.style.display === 'block') {
                    this.elements.detailView.style.display = 'none';
                    this.currentSubmissionId = null;
                } else if (this.currentChatClientId) {
                    this.resetChatUI();
                }
            }
        });
    }

    // Check authentication status
    async checkAuthStatus() {
        try {
            const response = await fetch('/api/admin/status');
            if (!response.ok) throw new Error('Network response was not ok');
            
            const data = await response.json();
            
            if (data.authenticated) {
                this.isAuthenticated = true;
                this.showAdminPanel();
                this.connectWebSocket();
                this.loadStats();
                this.loadSubmissions();
                this.loadActiveChats();
                this.startAutoRefresh();
            } else {
                this.showLoginForm();
            }
        } catch (error) {
            console.error('Auth check error:', error);
            this.showLoginForm();
        }
    }

    // Handle login
    async handleLogin() {
        const username = this.elements.username?.value;
        const password = this.elements.password?.value;
        
        if (!username || !password) {
            this.showLoginMessage('Please enter both username and password', 'error');
            return;
        }
        
        const loginBtn = this.elements['login-btn'];
        if (loginBtn) {
            loginBtn.disabled = true;
            loginBtn.textContent = 'Logging in...';
        }
        
        try {
            const response = await fetch('/api/admin/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password })
            });
            
            if (!response.ok) throw new Error('Login failed');
            
            const data = await response.json();
            
            if (data.success) {
                this.isAuthenticated = true;
                this.showAdminPanel();
                this.connectWebSocket();
                this.loadStats();
                this.loadSubmissions();
                this.loadActiveChats();
                this.startAutoRefresh();
            } else {
                this.showLoginMessage(data.error || 'Login failed', 'error');
            }
        } catch (error) {
            console.error('Login error:', error);
            this.showLoginMessage('Login error. Please try again.', 'error');
        } finally {
            if (loginBtn) {
                loginBtn.disabled = false;
                loginBtn.textContent = 'Login';
            }
        }
    }

    // Connect to WebSocket
    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        this.updateConnectionStatus('connecting');
        
        try {
            // Close existing connection if any
            if (this.ws) {
                this.ws.close();
            }
            
            // Clear any existing reconnect timeout
            if (this.reconnectTimeout) {
                clearTimeout(this.reconnectTimeout);
            }
            
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('WebSocket connected');
                this.updateConnectionStatus('connected');
                this.reconnectAttempts = 0; // Reset reconnect attempts on successful connection
                
                // Identify as admin
                this.ws.send(JSON.stringify({
                    type: 'identify',
                    isAdmin: true,
                    name: 'Admin'
                }));
                
                // Request active chats
                this.loadActiveChats();
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.handleWebSocketMessage(message);
                } catch (error) {
                    console.error('Error parsing message:', error);
                }
            };
            
            this.ws.onclose = () => {
                console.log('WebSocket disconnected');
                this.updateConnectionStatus('disconnected');
                
                // Reconnect with exponential backoff
                if (this.reconnectAttempts < this.maxReconnectAttempts) {
                    const delay = Math.min(30000, Math.pow(2, this.reconnectAttempts) * 1000);
                    console.log(`Reconnecting in ${delay/1000} seconds...`);
                    
                    this.reconnectTimeout = setTimeout(() => {
                        this.reconnectAttempts++;
                        this.connectWebSocket();
                    }, delay);
                } else {
                    console.log('Max reconnection attempts reached');
                    this.showNotification('Connection lost. Please refresh the page.', 'error');
                }
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.updateConnectionStatus('disconnected');
            };
        } catch (error) {
            console.error('WebSocket connection error:', error);
            this.updateConnectionStatus('disconnected');
            
            // Retry connection
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                const delay = Math.min(30000, Math.pow(2, this.reconnectAttempts) * 1000);
                this.reconnectTimeout = setTimeout(() => {
                    this.reconnectAttempts++;
                    this.connectWebSocket();
                }, delay);
            }
        }
    }

    // Handle WebSocket messages
    handleWebSocketMessage(message) {
        switch (message.type) {
            case 'client_id':
                this.clientId = message.clientId;
                break;
                
            case 'chat':
                this.handleChatMessage(message);
                break;
                
            case 'history':
                this.displayChatHistory(message.messages || []);
                break;
                
            case 'active_chats':
                this.activeChats = message.chats || [];
                this.renderActiveChatsList();
                break;
                
            case 'typing':
                this.handleTypingIndicator(message);
                break;
                
            case 'admin':
                this.showNotification(message.message, 'info');
                break;
                
            case 'system':
                this.showNotification(message.message, 'success');
                break;
                
            case 'chat_deleted':
                if (message.success) {
                    this.showNotification('Chat deleted successfully', 'success');
                } else {
                    this.showNotification('Failed to delete chat', 'error');
                }
                break;
                
            default:
                console.log('Unknown message type:', message.type);
        }
    }

    // Handle chat message with deduplication
    handleChatMessage(message) {
        const messageText = message.message || message.text;
        
        // Check for duplicate messages using ID
        if (message.id && this.lastMessageIds.has(message.id)) {
            console.log('Duplicate message detected, skipping:', message.id);
            return;
        }
        
        // Store message ID to prevent duplicates
        if (message.id) {
            this.lastMessageIds.add(message.id);
            
            // Clean up old message IDs to prevent memory leaks
            if (this.lastMessageIds.size > 1000) {
                const oldestIds = Array.from(this.lastMessageIds).slice(0, 100);
                oldestIds.forEach(id => this.lastMessageIds.delete(id));
            }
        }
        
        // If this message is related to the current chat, display it
        if (this.currentChatClientId && message.clientId === this.currentChatClientId) {
            this.displayChatMessage({
                ...message,
                message: messageText
            });
        }
        
        // Update active chats list
        this.updateActiveChatsList({
            ...message,
            message: messageText
        });
    }

    // Update active chats list when a new message arrives
    updateActiveChatsList(message) {
        // Check if this client is already in our active chats
        const existingChatIndex = this.activeChats.findIndex(chat => chat.clientId === message.clientId);
        
        if (existingChatIndex === -1) {
            // Add new chat to the list
            this.activeChats.push({
                clientId: message.clientId,
                name: message.name || 'Unknown',
                lastMessage: message.message || message.text || '',
                timestamp: message.timestamp || new Date().toISOString(),
                unread: this.currentChatClientId !== message.clientId
            });
        } else {
            // Update existing chat
            this.activeChats[existingChatIndex].lastMessage = message.message || message.text || '';
            this.activeChats[existingChatIndex].timestamp = message.timestamp || new Date().toISOString();
            
            // Mark as unread if not the current chat
            if (this.currentChatClientId !== message.clientId) {
                this.activeChats[existingChatIndex].unread = true;
            }
        }
        
        // Sort by timestamp (newest first)
        this.activeChats.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        // Update the UI
        this.renderActiveChatsList();
    }

    // Load active chats
    async loadActiveChats() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'get_active_chats'
            }));
        } else {
            // Fallback to HTTP API
            try {
                const response = await fetch('/api/active-chats');
                const data = await response.json();
                this.activeChats = data.chats || [];
                this.renderActiveChatsList();
            } catch (error) {
                console.error('Error loading active chats:', error);
            }
        }
    }

    // Render active chats list
    renderActiveChatsList() {
        if (!this.elements['active-chats-list']) return;
        
        if (this.activeChats.length === 0) {
            if (this.elements['no-active-chats']) this.elements['no-active-chats'].style.display = 'block';
            this.elements['active-chats-list'].innerHTML = '';
            return;
        }
        
        if (this.elements['no-active-chats']) this.elements['no-active-chats'].style.display = 'none';
        this.elements['active-chats-list'].innerHTML = '';
        
        this.activeChats.forEach(chat => {
            const chatItem = document.createElement('div');
            chatItem.className = `chat-item ${chat.unread ? 'unread' : ''} ${this.currentChatClientId === chat.clientId ? 'active' : ''}`;
            chatItem.dataset.clientId = chat.clientId;
            
            const time = new Date(chat.timestamp).toLocaleTimeString();
            const preview = chat.lastMessage.length > 30 ? 
                chat.lastMessage.substring(0, 30) + '...' : chat.lastMessage;
            
            // Get initials for avatar
            const initials = chat.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
            const avatarColor = this.stringToColor(chat.name);
            
            chatItem.innerHTML = `
                <div class="chat-avatar" style="background: ${avatarColor};">${initials}</div>
                <div class="chat-item-info">
                    <div class="chat-item-header">
                        <div class="chat-name">${chat.name}</div>
                        <div class="chat-time">${time}</div>
                    </div>
                    <div class="chat-preview">${preview}</div>
                </div>
                ${chat.unread ? '<div class="unread-indicator"></div>' : ''}
            `;
            
            chatItem.addEventListener('click', () => {
                this.selectChat(chat.clientId, chat.name);
                
                // Mark as read
                chat.unread = false;
                chatItem.classList.remove('unread');
                
                // Update all chat items active state
                document.querySelectorAll('.chat-item').forEach(item => {
                    item.classList.remove('active');
                });
                chatItem.classList.add('active');
            });
            
            this.elements['active-chats-list'].appendChild(chatItem);
        });
    }

    // Select a chat
    selectChat(clientId, clientName) {
        this.currentChatClientId = clientId;
        this.currentChatName = clientName;
        
        // Clear typing indicator when switching chats
        this.isTyping = false;
        if (this.elements['typing-indicator']) {
            this.elements['typing-indicator'].style.display = 'none';
        }
        
        // Update UI to show which chat is selected
        if (this.elements['current-chat-name']) {
            this.elements['current-chat-name'].textContent = clientName;
        }
        
        if (this.elements['current-chat-avatar']) {
            this.elements['current-chat-avatar'].textContent = clientName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
            this.elements['current-chat-avatar'].style.background = this.stringToColor(clientName);
        }
        
        // Show/hide UI elements
        if (this.elements['chat-header']) this.elements['chat-header'].style.display = 'flex';
        if (this.elements['reply-section']) this.elements['reply-section'].style.display = 'block';
        if (this.elements['no-chat-selected']) this.elements['no-chat-selected'].style.display = 'none';
        
        // Clear chat history and show loading
        if (this.elements['chat-history']) {
            this.elements['chat-history'].innerHTML = '<div class="loading">Loading messages...</div>';
        }
        
        // Request chat history for this client
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'get_history',
                clientId: clientId
            }));
        } else {
            // Fallback to HTTP API
            fetch(`/api/chat-history/${clientId}`)
                .then(response => response.json())
                .then(data => {
                    this.displayChatHistory(data.messages);
                })
                .catch(error => {
                    console.error('Error loading chat history:', error);
                    if (this.elements['chat-history']) {
                        this.elements['chat-history'].innerHTML = '<div class="error">Error loading messages</div>';
                    }
                });
        }
    }

    // Display chat history
    displayChatHistory(messages) {
        if (!this.elements['chat-history']) return;
        
        this.elements['chat-history'].innerHTML = '';
        
        if (!messages || messages.length === 0) {
            this.elements['chat-history'].innerHTML = '<div class="no-chat-history">No messages yet. Start the conversation!</div>';
            return;
        }
        
        messages.forEach(message => {
            this.displayChatMessage(message, false);
        });
        
        // Ensure we scroll to the bottom after rendering
        setTimeout(() => {
            this.elements['chat-history'].scrollTop = this.elements['chat-history'].scrollHeight;
        }, 100);
    }

    // Display chat message
    displayChatMessage(message, scrollToBottom = true) {
        if (!this.elements['chat-history']) return;
        
        const messageElement = document.createElement('div');
        messageElement.className = `message ${message.isAdmin ? 'message-outgoing' : 'message-incoming'}`;
        messageElement.dataset.messageId = message.id || Date.now();
        
        const timestamp = new Date(message.timestamp).toLocaleTimeString();
        
        let statusHtml = '';
        if (message.isAdmin) {
            if (message.status === 'read') {
                statusHtml = '<span class="message-status read">✓✓</span>';
            } else if (message.status === 'delivered') {
                statusHtml = '<span class="message-status delivered">✓✓</span>';
            } else {
                statusHtml = '<span class="message-status sent">✓</span>';
            }
        }
        
        messageElement.innerHTML = `
            <div class="message-content">${this.formatMessage(message.message || message.text)}</div>
            <div class="message-meta">
                <span>${timestamp}</span>
                <span class="message-sender">${message.name || (message.isAdmin ? 'Support' : 'Guest')}</span>
                ${statusHtml}
            </div>
        `;
        
        // Remove placeholder messages
        const placeholder = this.elements['chat-history'].querySelector('.no-chat-history, .loading, .no-chat-selected, .error');
        if (placeholder) {
            placeholder.remove();
        }
        
        this.elements['chat-history'].appendChild(messageElement);
        
        if (scrollToBottom) {
            this.elements['chat-history'].scrollTop = this.elements['chat-history'].scrollHeight;
        }
        
        // Add animation
        messageElement.style.animation = 'messageAppear 0.3s ease';
    }

    // Format message content with XSS protection
    formatMessage(message) {
        if (!message) return '';
        
        // Escape HTML to prevent XSS
        const div = document.createElement('div');
        div.textContent = message;
        let safeMessage = div.innerHTML;
        
        // Convert URLs to clickable links (safe way)
        const urlRegex = /(https?:\/\/[^\s<]+)/g;
        safeMessage = safeMessage.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
        
        // Preserve line breaks
        safeMessage = safeMessage.replace(/\n/g, '<br>');
        
        return safeMessage;
    }

    // Send reply message with deduplication
    sendReplyMessage() {
        if (!this.elements['reply-message'] || !this.elements['reply-message'].value.trim() || !this.currentChatClientId) {
            this.showNotification('Please select a chat and enter a message', 'error');
            return;
        }
        
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.showNotification('Not connected to chat server', 'error');
            return;
        }
        
        const messageText = this.elements['reply-message'].value.trim();
        const messageId = 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        
        // Prevent duplicate message sending
        if (this.lastMessageIds.has(messageId)) {
            return;
        }
        
        this.lastMessageIds.add(messageId);
        
        const messageData = {
            type: 'admin_message',
            targetClientId: this.currentChatClientId,
            message: messageText,
            timestamp: new Date().toISOString(),
            id: messageId
        };
        
        // Add message to chat immediately (optimistic update)
        this.displayChatMessage({
            type: 'chat',
            message: messageData.message,
            name: 'Support',
            timestamp: messageData.timestamp,
            isAdmin: true,
            clientId: this.currentChatClientId,
            id: messageId,
            status: 'sending'
        });
        
        // Send via WebSocket
        this.ws.send(JSON.stringify(messageData));
        this.elements['reply-message'].value = '';
        
        this.updateCharCount();
    }

    // Handle typing
    handleTyping() {
        if (!this.isTyping) {
            this.isTyping = true;
            this.sendTypingIndicator(true);
        }
        
        clearTimeout(this.typingTimer);
        this.typingTimer = setTimeout(() => {
            this.isTyping = false;
            this.sendTypingIndicator(false);
        }, 1000);
        
        this.updateCharCount();
    }

    // Send typing indicator
    sendTypingIndicator(isTyping) {
        if (!this.currentChatClientId || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        
        this.ws.send(JSON.stringify({
            type: 'typing',
            targetClientId: this.currentChatClientId,
            typing: isTyping
        }));
    }

    // Handle typing indicator
    handleTypingIndicator(data) {
        const typingIndicator = this.elements['typing-indicator'];
        if (!typingIndicator) return;
        
        if (data.typing && data.clientId === this.currentChatClientId) {
            typingIndicator.style.display = 'flex';
            if (typingIndicator.querySelector('span')) {
                typingIndicator.querySelector('span').textContent = `${this.currentChatName || 'Customer'} is typing...`;
            }
        } else {
            typingIndicator.style.display = 'none';
        }
    }

    // Update character count
    updateCharCount() {
        const charCount = this.elements['char-count'];
        const replyMessage = this.elements['reply-message'];
        
        if (!charCount || !replyMessage) return;
        
        const length = replyMessage.value.length;
        charCount.textContent = `${length}/500`;
        
        if (length > 450) {
            charCount.classList.add('warning');
        } else {
            charCount.classList.remove('warning');
        }
    }

    // Load statistics
    async loadStats() {
        try {
            const response = await fetch('/api/statistics');
            const data = await response.json();
            this.updateStatsDisplay(data);
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }

    // Load submissions
    async loadSubmissions() {
        try {
            const response = await fetch('/api/submissions');
            const submissions = await response.json();
            this.displaySubmissions(submissions);
            this.updateLastRefreshed();
        } catch (error) {
            console.error('Error loading submissions:', error);
            this.showNotification('Error loading submissions', 'error');
        }
    }

    // Display submissions
    displaySubmissions(submissions) {
        if (!this.elements.submissionsTable) return;
        
        const tbody = this.elements.submissionsTable.querySelector('tbody');
        if (!tbody) return;
        
        if (!submissions || submissions.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7">
                        <div class="empty-state">
                            📝
                            <p>No submissions yet</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }
        
        tbody.innerHTML = '';
        
        submissions.forEach(submission => {
            const row = document.createElement('tr');
            const date = new Date(submission.submitted_at).toLocaleDateString();
            
            row.innerHTML = `
                <td>${submission.id}</td>
                <td>${submission.name}</td>
                <td>${submission.email}</td>
                <td>${submission.phone || '-'}</td>
                <td>${submission.service || '-'}</td>
                <td>${date}</td>
                <td>
                    <button class="view-btn" data-id="${submission.id}">View</button>
                    <button class="chat-from-submission" data-id="${submission.id}" data-name="${submission.name}">Chat</button>
                    <button class="delete-btn" data-id="${submission.id}">Delete</button>
                </td>
            `;
            
            tbody.appendChild(row);
        });
        
        // Add event listeners to buttons
        this.setupSubmissionEventListeners();
    }

    // Setup submission event listeners
    setupSubmissionEventListeners() {
        // View buttons
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                this.viewSubmission(id);
            });
        });
        
        // Chat buttons
        document.querySelectorAll('.chat-from-submission').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                const name = btn.getAttribute('data-name');
                this.startChatFromSubmission(id, name);
            });
        });
        
        // Delete buttons
        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                this.deleteSubmission(id);
            });
        });
    }

    // View submission
    async viewSubmission(id) {
        try {
            const response = await fetch(`/api/submissions/${id}`);
            const submission = await response.json();
            this.showSubmissionDetails(submission);
            this.currentSubmissionId = id;
        } catch (error) {
            console.error('Error loading submission:', error);
            this.showNotification('Error loading submission details', 'error');
        }
    }

    // Show submission details
    showSubmissionDetails(submission) {
        if (!this.elements.detailView) return;
        
        const elements = {
            'detail-id': submission.id,
            'detail-name': submission.name,
            'detail-email': submission.email,
            'detail-phone': submission.phone || '-',
            'detail-service': submission.service || '-',
            'detail-message': submission.message,
            'detail-date': new Date(submission.submitted_at).toLocaleString()
        };
        
        Object.entries(elements).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        });
        
        this.elements.detailView.style.display = 'block';
    }

    // Delete submission
    async deleteSubmission(id) {
        if (!confirm('Are you sure you want to delete this submission?')) return;
        
        try {
            const response = await fetch(`/api/submissions/${id}`, {
                method: 'DELETE'
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showNotification('Submission deleted successfully', 'success');
                this.loadSubmissions();
                this.loadStats();
            } else {
                this.showNotification('Error deleting submission', 'error');
            }
        } catch (error) {
            console.error('Error deleting submission:', error);
            this.showNotification('Error deleting submission', 'error');
        }
    }

    // Export CSV
    async exportCSV() {
        try {
            const response = await fetch('/api/submissions');
            const submissions = await response.json();
            
            if (!submissions || submissions.length === 0) {
                this.showNotification('No data to export', 'info');
                return;
            }
            
            // Create CSV content
            let csvContent = 'ID,Name,Email,Phone,Service,Message,Date\n';
            
            submissions.forEach(submission => {
                const row = [
                    submission.id,
                    `"${submission.name.replace(/"/g, '""')}"`,
                    submission.email,
                    submission.phone || '',
                    submission.service ? `"${submission.service.replace(/"/g, '""')}"` : '',
                    `"${submission.message.replace(/"/g, '""')}"`,
                    new Date(submission.submitted_at).toLocaleDateString()
                ];
                
                csvContent += row.join(',') + '\n';
            });
            
            // Create download link
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', `ajk-submissions-${new Date().toISOString().split('T')[0]}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            this.showNotification('CSV exported successfully', 'success');
        } catch (error) {
            console.error('Error exporting CSV:', error);
            this.showNotification('Error exporting CSV', 'error');
        }
    }

    // Toggle auto refresh
    toggleAutoRefresh() {
        this.autoRefreshEnabled = !this.autoRefreshEnabled;
        
        if (this.autoRefreshEnabled) {
            this.startAutoRefresh();
        } else {
            this.stopAutoRefresh();
        }
        
        this.updateAutoRefreshUI();
    }

    // Start auto refresh with configurable interval
    startAutoRefresh() {
        this.stopAutoRefresh();
        
        const interval = parseInt(this.elements.refreshInterval?.value || '30') * 1000;
        
        // Allow any interval but set a reasonable minimum
        if (interval < 1000) {
            this.showNotification('Refresh interval must be at least 1 second', 'error');
            return;
        }
        
        this.autoRefreshInterval = setInterval(() => {
            this.refreshData();
        }, interval);
        
        this.autoRefreshEnabled = true;
        this.updateAutoRefreshUI();
    }

    // Stop auto refresh
    stopAutoRefresh() {
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
        }
        this.autoRefreshEnabled = false;
        this.updateAutoRefreshUI();
    }

    // Update auto refresh UI
    updateAutoRefreshUI() {
        if (this.elements.autoRefreshBtn) {
            this.elements.autoRefreshBtn.textContent = this.autoRefreshEnabled ? 
                '⏱️ Auto-Refresh: ON' : '⏱️ Auto-Refresh: OFF';
            this.elements.autoRefreshBtn.classList.toggle('active', this.autoRefreshEnabled);
        }
        
        if (this.elements.statusIndicator) {
            this.elements.statusIndicator.classList.toggle('status-live', this.autoRefreshEnabled);
            this.elements.statusIndicator.classList.toggle('status-paused', !this.autoRefreshEnabled);
        }
        
        if (this.elements.statusText) {
            this.elements.statusText.textContent = this.autoRefreshEnabled ? 
                'Auto-Refresh Enabled' : 'Auto-Refresh Paused';
        }
    }

    // Refresh data
    async refreshData() {
        if (this.isRefreshing) return;
        
        this.isRefreshing = true;
        const refreshBtn = this.elements['refresh-btn'];
        if (refreshBtn) {
            refreshBtn.classList.add('refreshing');
            refreshBtn.disabled = true;
        }
        
        try {
            await Promise.all([
                this.loadSubmissions(),
                this.loadStats(),
                this.loadActiveChats()
            ]);
        } catch (error) {
            console.error('Refresh error:', error);
        } finally {
            this.isRefreshing = false;
            if (refreshBtn) {
                setTimeout(() => {
                    refreshBtn.classList.remove('refreshing');
                    refreshBtn.disabled = false;
                }, 1000);
            }
        }
    }

    // Logout
    async logout() {
        try {
            await fetch('/api/admin/logout', { method: 'POST' });
            this.isAuthenticated = false;
            this.stopAutoRefresh();
            if (this.ws) this.ws.close();
            this.showLoginForm();
        } catch (error) {
            console.error('Logout error:', error);
        }
    }

    // Delete chat (both UI and server)
    async deleteChat(clientId) {
        try {
            // Try HTTP API first
            const response = await fetch(`/api/chats/${clientId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                // Remove from active chats
                this.activeChats = this.activeChats.filter(chat => chat.clientId !== clientId);
                this.renderActiveChatsList();
                
                // If this was the current chat, reset UI
                if (this.currentChatClientId === clientId) {
                    this.resetChatUI();
                }
                
                this.showNotification('Chat deleted successfully', 'success');
            } else {
                throw new Error('HTTP request failed');
            }
        } catch (error) {
            // Fallback to WebSocket
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'delete_chat',
                    clientId: clientId
                }));
                
                // Optimistically update UI
                this.activeChats = this.activeChats.filter(chat => chat.clientId !== clientId);
                this.renderActiveChatsList();
                
                if (this.currentChatClientId === clientId) {
                    this.resetChatUI();
                }
                
                this.showNotification('Chat deletion requested', 'info');
            } else {
                this.showNotification('Failed to delete chat. Not connected to server.', 'error');
            }
        }
    }

    // Reset chat UI
    resetChatUI() {
        this.currentChatClientId = null;
        this.currentChatName = null;
        
        // Hide chat-specific UI elements
        if (this.elements['chat-header']) this.elements['chat-header'].style.display = 'none';
        if (this.elements['reply-section']) this.elements['reply-section'].style.display = 'none';
        
        // Show no-chat-selected message
        if (this.elements['no-chat-selected']) this.elements['no-chat-selected'].style.display = 'block';
        
        // Clear chat history
        if (this.elements['chat-history']) {
            this.elements['chat-history'].innerHTML = '<div class="no-chat-selected">Select a conversation to start messaging</div>';
        }
        
        // Reset active states
        document.querySelectorAll('.chat-item').forEach(item => {
            item.classList.remove('active');
        });
    }

    // Show notification
    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        const colors = {
            error: '#e53e3e',
            success: '#48bb78',
            info: '#4299e1'
        };
        
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${colors[type] || colors.info};
            color: white;
            padding: 15px;
            border-radius: 5px;
            z-index: 1000;
            max-width: 300px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        `;
        
        document.body.appendChild(notification);
        
        // Remove after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 5000);
    }

    // UI state management
    showLoginForm() {
        if (this.elements['login-section']) this.elements['login-section'].style.display = 'block';
        if (this.elements['admin-panel']) this.elements['admin-panel'].style.display = 'none';
    }

    showAdminPanel() {
        if (this.elements['login-section']) this.elements['login-section'].style.display = 'none';
        if (this.elements['admin-panel']) this.elements['admin-panel'].style.display = 'block';
    }

    showLoginMessage(message, type) {
        const loginMessage = this.elements['login-message'];
        if (!loginMessage) return;
        
        loginMessage.textContent = message;
        loginMessage.className = `login-message ${type === 'error' ? 'login-error' : ''}`;
        loginMessage.style.display = 'block';
        
        setTimeout(() => {
            loginMessage.style.display = 'none';
        }, 5000);
    }

    // Update connection status
    updateConnectionStatus(status) {
        if (!this.elements.connectionStatus) return;
        
        this.elements.connectionStatus.style.display = 'block';
        this.elements.connectionStatus.className = `connection-status ${status}`;
        
        switch(status) {
            case 'connected':
                this.elements.connectionStatus.textContent = 'Connected ✓';
                break;
            case 'disconnected':
                this.elements.connectionStatus.textContent = 'Disconnected ✗ - Reconnecting...';
                break;
            case 'connecting':
                this.elements.connectionStatus.textContent = 'Connecting...';
                break;
        }
    }

    // Update stats display
    updateStatsDisplay(stats) {
        if (this.elements.totalSubmissions) this.elements.totalSubmissions.textContent = stats.total || 0;
        if (this.elements.todaySubmissions) this.elements.todaySubmissions.textContent = stats.today || 0;
        if (this.elements.weekSubmissions) this.elements.weekSubmissions.textContent = stats.week || 0;
    }

    // Update last refreshed time
    updateLastRefreshed() {
        if (this.elements.lastRefreshed) {
            this.elements.lastRefreshed.textContent = `Last refreshed: ${new Date().toLocaleTimeString()}`;
        }
    }

    // Filter chats
    filterChats(searchTerm) {
        if (!this.elements['active-chats-list']) return;
        
        const chatItems = this.elements['active-chats-list'].querySelectorAll('.chat-item');
        const term = searchTerm.toLowerCase();
        
        chatItems.forEach(item => {
            const name = item.querySelector('.chat-name')?.textContent?.toLowerCase() || '';
            const preview = item.querySelector('.chat-preview')?.textContent?.toLowerCase() || '';
            
            if (name.includes(term) || preview.includes(term)) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
    }

    // Start chat from submission
    startChatFromSubmission(submissionId, name) {
        // Show chat sidebar
        const chatSidebar = document.getElementById('chat-sidebar');
        if (chatSidebar) chatSidebar.style.display = 'block';
        
        // Check if chat already exists
        const existingChat = this.activeChats.find(chat => chat.clientId === submissionId);
        
        if (existingChat) {
            this.selectChat(submissionId, name);
        } else {
            // Add to active chats
            this.activeChats.unshift({
                clientId: submissionId,
                name: name,
                lastMessage: "New conversation started",
                timestamp: new Date().toISOString(),
                unread: false
            });
            
            this.renderActiveChatsList();
            this.selectChat(submissionId, name);
        }
    }

    // Show user details
    showUserDetails() {
        const user = this.activeChats.find(chat => chat.clientId === this.currentChatClientId);
        
        if (user) {
            alert(`User Details:\nName: ${user.name}\nClient ID: ${user.clientId}\nLast Active: ${new Date(user.timestamp).toLocaleString()}`);
        }
    }

    // Utility function to generate color from string
    stringToColor(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        let color = '#';
        for (let i = 0; i < 3; i++) {
            const value = (hash >> (i * 8)) & 0xFF;
            color += ('00' + value.toString(16)).substr(-2);
        }
        return color;
    }
}

// Initialize the admin panel
document.addEventListener('DOMContentLoaded', function() {
    window.adminPanel = new AdminPanel();
});
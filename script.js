// Tailwind configuration
tailwind.config = {
  theme: {
    extend: {
      colors: {
        primary: '#1e40af',
        'primary-dark': '#1e3a8a',
        secondary: '#059669',
        'secondary-dark': '#047857',
      }
    }
  }
}

// Enhanced Chat Widget System for AJK Cleaning
class ChatWidget {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.isTyping = false;
    this.typingTimeout = null;
    this.reconnectInterval = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.unreadCount = 0;
    this.identifyTimeout = null;
    
    // Try to load existing client ID from storage
    this.clientId = localStorage.getItem('chatClientId') || this.generateClientId();
    this.userName = localStorage.getItem('chatUserName') || 'Guest';
    this.userEmail = localStorage.getItem('chatUserEmail') || '';
    
    // Store client ID for future sessions
    localStorage.setItem('chatClientId', this.clientId);
    
    this.init();
  }
  
  generateClientId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return 'client_' + crypto.randomUUID();
      }
    } catch (e) {}
    return 'client_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }
  
  init() {
    this.attachEventListeners();
    this.connectWebSocket();
    
    // Load any saved messages
    this.loadSavedMessages();
    
    // Auto-open chat if there are unread messages
    if (localStorage.getItem('chat-unread-count')) {
      this.unreadCount = parseInt(localStorage.getItem('chat-unread-count')) || 0;
      this.updateUnreadBadge();
    }
  }
  
  // Method to save user info
  saveUserInfo() {
    localStorage.setItem('chatUserName', this.userName);
    localStorage.setItem('chatUserEmail', this.userEmail);
    
    // Send identification to server
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendIdentifyMessage();
    }
  }
  
  sendIdentifyMessage() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'identify',
        name: this.userName,
        email: this.userEmail,
        isAdmin: false,
        clientId: this.clientId
      }));
    }
  }
  
  attachEventListeners() {
    const chatToggle = document.getElementById('chat-toggle-enhanced');
    const chatWindow = document.getElementById('chat-window-enhanced');
    const closeChat = document.getElementById('close-chat');
    const minimizeChat = document.getElementById('minimize-chat');
    const chatInput = document.getElementById('chat-input-enhanced');
    const chatSend = document.getElementById('chat-send-enhanced');
    const saveUserInfo = document.getElementById('save-user-info');
    
    if (!chatToggle) {
      console.error('Chat toggle element not found');
      return;
    }
    
    chatToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleChat();
    });
    
    if (closeChat) closeChat.addEventListener('click', () => this.closeChat());
    if (minimizeChat) minimizeChat.addEventListener('click', () => this.minimizeChat());
    if (chatSend) chatSend.addEventListener('click', () => this.sendMessage());
    if (saveUserInfo) saveUserInfo.addEventListener('click', () => this.saveUserInfoForm());
    
    // Handle Enter key for sending messages
    if (chatInput) {
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendMessage();
        }
      });
      
      chatInput.addEventListener('input', () => this.handleTyping());
    }
    
    // Click outside to close
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#chat-widget-enhanced') && 
          chatWindow && chatWindow.classList.contains('open')) {
        this.closeChat();
      }
    });
  }
  
  connectWebSocket() {
    try {
      // Determine WebSocket protocol based on current page protocol
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}?clientId=${encodeURIComponent(this.clientId)}`;
      
      console.log('Attempting WebSocket connection to:', wsUrl);
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        console.log('WebSocket connected successfully');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.updateConnectionStatus();
        this.enableChatInput();
        
        // Set timeout to send identify if we don't get client_id from server
        this.identifyTimeout = setTimeout(() => {
          console.log('No client_id received from server, identifying with current clientId');
          this.sendIdentifyMessage();
        }, 3000);
      };
      
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleServerMessage(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };
      
      this.ws.onclose = (event) => {
        console.log('WebSocket connection closed:', event.code, event.reason);
        this.isConnected = false;
        this.updateConnectionStatus();
        this.disableChatInput();
        
        // Clear the identify timeout
        if (this.identifyTimeout) {
          clearTimeout(this.identifyTimeout);
          this.identifyTimeout = null;
        }
        
        this.attemptReconnect();
      };
      
      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.isConnected = false;
        this.updateConnectionStatus('Connection error');
        
        // Clear the identify timeout
        if (this.identifyTimeout) {
          clearTimeout(this.identifyTimeout);
          this.identifyTimeout = null;
        }
      };
      
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      this.enableDemoMode();
    }
  }
  
  enableDemoMode() {
    console.log('Running in demo mode - no WebSocket connection');
    this.isConnected = true;
    setTimeout(() => {
      this.updateConnectionStatus();
      this.enableChatInput();
      this.sendWelcomeMessage();
    }, 1000);
  }
  
  sendWelcomeMessage() {
    // Only send welcome message if we haven't sent it before in this session
    if (!localStorage.getItem('welcomeSent')) {
      this.displayMessage(
        "Thank you for contacting AJK Cleaning! We have received your message and will get back to you shortly. For immediate assistance, please call us at +49-17661852286 or email Rajau691@gmail.com.",
        'system',
        'Support'
      );
      localStorage.setItem('welcomeSent', 'true');
    }
  }
  
  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
      
      console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay/1000}s...`);
      this.updateConnectionStatus(`Reconnecting in ${delay/1000}s...`);
      
      setTimeout(() => {
        if (!this.isConnected) {
          this.connectWebSocket();
        }
        this.updateConnectionStatus();
      }, delay);
    } else {
      console.log('Max reconnection attempts reached');
      this.updateConnectionStatus('Disconnected');
    }
  }
  
  updateConnectionStatus(customStatus = null) {
    const indicator = document.getElementById('connection-indicator');
    const status = document.getElementById('chat-status');
    
    if (!indicator || !status) return;
    
    if (customStatus) {
      status.textContent = customStatus;
      indicator.classList.remove('connected');
      return;
    }
    
    if (this.isConnected) {
      status.textContent = 'Online';
      indicator.classList.add('connected');
    } else {
      status.textContent = 'Connecting...';
      indicator.classList.remove('connected');
    }
  }
  
  enableChatInput() {
    const chatInput = document.getElementById('chat-input-enhanced');
    const chatSend = document.getElementById('chat-send-enhanced');
    
    if (chatInput) {
      chatInput.disabled = false;
      chatInput.placeholder = 'Type your message...';
    }
    if (chatSend) {
      chatSend.disabled = false;
    }
  }
  
  disableChatInput() {
    const chatInput = document.getElementById('chat-input-enhanced');
    const chatSend = document.getElementById('chat-send-enhanced');
    
    if (chatInput) {
      chatInput.disabled = true;
      chatInput.placeholder = 'Connecting to chat...';
    }
    if (chatSend) {
      chatSend.disabled = true;
    }
  }
  
  handleServerMessage(data) {
    console.log('Received server message:', data);
    
    switch (data.type) {
      case 'chat':
        // Always display admin messages, only display user messages if they're not from this client
        if (data.isAdmin || data.clientId !== this.clientId) {
          // Use data.message OR data.text (server might send either)
          const messageText = data.message || data.text;
          const messageType = data.type === 'system' ? 'system' : (data.isAdmin ? 'admin' : 'user');
          this.displayMessage(
            messageText,
            messageType, 
            data.name || (data.isAdmin ? 'Support' : 'Guest'),
            data.timestamp
          );
          
          // Save message to localStorage
          this.saveMessageToStorage({
            text: messageText,
            type: messageType,
            sender: data.name || (data.isAdmin ? 'Support' : 'Guest'),
            timestamp: data.timestamp || new Date().toISOString()
          });
          
          if (data.isAdmin) {
            this.playNotificationSound();
            this.incrementUnreadCount();
          }
        }
        break;
        
      case 'system':
        this.displayMessage(data.message, 'system', 'System', data.timestamp);
        break;
        
      case 'history':
        // Load chat history from server
        if (data.messages && Array.isArray(data.messages)) {
          // Clear UI and local cache before rendering server history
          const messagesContainer = document.getElementById('chat-messages');
          if (messagesContainer) { messagesContainer.innerHTML = ''; }
          try { localStorage.setItem('chatMessages', '[]'); } catch (e) {}

          data.messages.forEach(msg => {
            // Use msg.message OR msg.text (server might send either)
            const messageText = msg.message || msg.text;
            const messageType = msg.type === 'system' ? 'system' : (msg.isAdmin ? 'admin' : 'user');
            this.displayMessage(
              messageText,
              messageType,
              msg.name || (msg.isAdmin ? 'Support' : 'Guest'),
              msg.timestamp
            );
            
            // Save to localStorage
            this.saveMessageToStorage({
              text: messageText,
              type: messageType,
              sender: msg.name || (msg.isAdmin ? 'Support' : 'Guest'),
              timestamp: msg.timestamp
            });
          });
        }
        break;
        
      case 'typing':
        // Only show typing indicators from others
        if (data.clientId !== this.clientId) {
          this.showTypingIndicator(data.isTyping, data.name);
        }
        break;
        
      case 'admin':
        // Admin notifications (for debugging)
        console.log('Admin notification:', data.message);
        break;
        
      case 'chat_reset':
        this.handleChatReset();
        break;
        
      case 'client_id':
        // Clear the identify timeout
        if (this.identifyTimeout) {
          clearTimeout(this.identifyTimeout);
          this.identifyTimeout = null;
        }

        // Update client ID if server provides a different one
        if (data.clientId && data.clientId !== this.clientId) {
          this.clientId = data.clientId;
          localStorage.setItem('chatClientId', this.clientId);
          console.log('Received new client ID:', this.clientId);
        }
        
        // Do not clear UI or local cache on client_id; history may have just been loaded
        // Now identify ourselves to the server with the updated clientId
        this.sendIdentifyMessage();
        break;
    }
  }
  
  saveMessageToStorage(message) {
    try {
      // Get existing messages
      const storedMessages = JSON.parse(localStorage.getItem('chatMessages') || '[]');
      
      // Add new message
      storedMessages.push(message);
      
      // Save back to localStorage (limit to 100 messages to prevent storage issues)
      if (storedMessages.length > 100) {
        storedMessages.splice(0, storedMessages.length - 100);
      }
      
      localStorage.setItem('chatMessages', JSON.stringify(storedMessages));
    } catch (error) {
      console.error('Error saving message to storage:', error);
    }
  }
  
  loadSavedMessages() {
    try {
      const storedMessages = JSON.parse(localStorage.getItem('chatMessages') || '[]');
      
      storedMessages.forEach(msg => {
        this.displayMessage(
          msg.text,
          msg.type,
          msg.sender,
          msg.timestamp
        );
      });
    } catch (error) {
      console.error('Error loading saved messages:', error);
    }
  }
  
  displayMessage(message, type, sender = '', timestamp = null) {
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}-message`;
    
    const time = timestamp ? new Date(timestamp) : new Date();
    const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    messageDiv.innerHTML = `
      <div class="message-content">
        ${message.split('\n').map(line => `<p>${this.escapeHtml(line)}</p>`).join('')}
      </div>
      <div class="message-time">${timeStr}${sender && sender !== 'Guest' ? ` • ${sender}` : ''}</div>
    `;
    
    messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }
  
  showTypingIndicator(isTyping, senderName = 'Support') {
    const indicator = document.getElementById('typing-indicator');
    if (!indicator) return;
    
    const typingText = indicator.querySelector('.typing-text');
    
    if (isTyping) {
      typingText.textContent = `${senderName} is typing...`;
      indicator.style.display = 'flex';
    } else {
      indicator.style.display = 'none';
    }
    
    this.scrollToBottom();
  }
  
  toggleChat() {
    const chatWindow = document.getElementById('chat-window-enhanced');
    if (!chatWindow) return;
    
    const isOpen = chatWindow.classList.contains('open');
    
    if (isOpen) {
      this.closeChat();
    } else {
      this.openChat();
    }
  }
  
  openChat() {
    const chatWindow = document.getElementById('chat-window-enhanced');
    const userInfo = document.getElementById('user-info');
    const chatInputArea = document.getElementById('chat-input-area');
    
    if (!chatWindow) return;
    
    chatWindow.style.display = 'flex';
    setTimeout(() => {
      chatWindow.classList.add('open');
    }, 10);
    
    // Show user info form if name is not set
    if ((!this.userName || this.userName === 'Guest') && userInfo && chatInputArea) {
      userInfo.style.display = 'flex';
      chatInputArea.style.display = 'none';
    } else if (userInfo && chatInputArea) {
      userInfo.style.display = 'none';
      chatInputArea.style.display = 'flex';
    }
    
    this.clearUnreadCount();
    this.scrollToBottom();
  }
  
  closeChat() {
    const chatWindow = document.getElementById('chat-window-enhanced');
    if (!chatWindow) return;
    
    chatWindow.classList.remove('open');
    
    setTimeout(() => {
      chatWindow.style.display = 'none';
    }, 300);
  }
  
  minimizeChat() {
    this.closeChat();
  }
  
  // This method is called when the user submits the user info form
  saveUserInfoForm() {
    const nameInput = document.getElementById('user-name');
    const emailInput = document.getElementById('user-email');
    const userInfo = document.getElementById('user-info');
    const chatInputArea = document.getElementById('chat-input-area');
    const chatInput = document.getElementById('chat-input-enhanced');
    
    if (!nameInput) return;
    
    const name = nameInput.value.trim();
    const email = emailInput ? emailInput.value.trim() : '';
    
    if (!name) {
      nameInput.focus();
      nameInput.style.borderColor = '#ef4444';
      setTimeout(() => {
        nameInput.style.borderColor = '';
      }, 3000);
      return;
    }
    
    this.userName = name;
    this.userEmail = email;
    
    // Save to localStorage
    localStorage.setItem('chatUserName', name);
    if (email) localStorage.setItem('chatUserEmail', email);
    
    // Hide user info form and show chat input
    if (userInfo) userInfo.style.display = 'none';
    if (chatInputArea) chatInputArea.style.display = 'flex';
    
    // Update identification on server if connected
    this.sendIdentifyMessage();
    
    if (chatInput) chatInput.focus();
  }
  
  sendMessage() {
    const chatInput = document.getElementById('chat-input-enhanced');
    if (!chatInput) return;
    
    const message = chatInput.value.trim();
    
    if (!message) return;
    
    // Clear input immediately to prevent double-sending
    chatInput.value = '';
    
    console.log('Sending message:', message);
    
    // Display user message immediately for better UX
    this.displayMessage(message, 'user', this.userName);
    
    // Save to localStorage
    this.saveMessageToStorage({
      text: message,
      type: 'user',
      sender: this.userName,
      timestamp: new Date().toISOString()
    });
    
    // Send to server if connected
    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'chat',
        text: message,
        name: this.userName,
        email: this.userEmail,
        clientId: this.clientId,
        timestamp: new Date().toISOString()
      }));
    } else {
      // Demo response when not connected to server
      console.log('Not connected to server, showing demo response');
      setTimeout(() => {
        this.displayMessage(
          "Thanks for your message! We're currently offline, but we'll get back to you soon. You can also call us at +49 017616146259.", 
          'admin', 
          'Support'
        );
        
        // Save demo response to storage
        this.saveMessageToStorage({
          text: "Thanks for your message! We're currently offline, but we'll get back to you soon. You can also call us at +49 017616146259.",
          type: 'admin',
          sender: 'Support',
          timestamp: new Date().toISOString()
        });
      }, 1000);
    }
    
    this.stopTyping();
  }
  
  handleTyping() {
    if (!this.isConnected) return;
    
    if (!this.isTyping) {
      this.isTyping = true;
      // Send typing indicator to server
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'typing',
          isTyping: true,
          clientId: this.clientId
        }));
      }
    }
    
    // Clear existing timeout
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }
    
    // Set new timeout to stop typing indicator
    this.typingTimeout = setTimeout(() => {
      this.stopTyping();
    }, 1000);
  }
  
  stopTyping() {
    if (this.isTyping) {
      this.isTyping = false;
      // Send stop typing indicator to server
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'typing',
          isTyping: false,
          clientId: this.clientId
        }));
      }
    }
  }
  
  scrollToBottom() {
    const messagesContainer = document.getElementById('chat-messages');
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }
  
  incrementUnreadCount() {
    const chatWindow = document.getElementById('chat-window-enhanced');
    if (!chatWindow || chatWindow.classList.contains('open')) return;
    
    this.unreadCount++;
    this.updateUnreadBadge();
    localStorage.setItem('chat-unread-count', this.unreadCount.toString());
  }
  
  clearUnreadCount() {
    this.unreadCount = 0;
    this.updateUnreadBadge();
    localStorage.setItem('chat-unread-count', '0');
  }

  // Handle server-initiated chat reset (e.g., admin deleted this chat)
  handleChatReset() {
    try {
      localStorage.removeItem('chatMessages');
      localStorage.removeItem('chat-unread-count');
      localStorage.removeItem('welcomeSent');
      localStorage.removeItem('chatUserName');
      localStorage.removeItem('chatUserEmail');
      localStorage.removeItem('chatClientId');
    } catch (e) {}

    this.userName = 'Guest';
    this.userEmail = '';
    this.clearUnreadCount();

    const messagesContainer = document.getElementById('chat-messages');
    if (messagesContainer) {
      messagesContainer.innerHTML = '';
    }

    // Generate a new clientId so the next session is a brand-new ticket
    this.clientId = this.generateClientId();
    try { localStorage.setItem('chatClientId', this.clientId); } catch (e) {}

    // Inform the user
    this.displayMessage('Chat was reset. Please start a new conversation.', 'system', 'System', new Date().toISOString());

    // Force a reconnect so the server can initialize a fresh chat session
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.close(4000, 'reset'); } catch (e) {}
    } else {
      // If not open, connect immediately with the new clientId
      this.connectWebSocket();
    }
  }
  
  updateUnreadBadge() {
    const badge = document.getElementById('unread-badge');
    if (!badge) return;
    
    if (this.unreadCount > 0) {
      badge.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount.toString();
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }
  
  playNotificationSound() {
    // Create a subtle notification sound
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      
      oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
      gain.gain.setValueAtTime(0.1, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.2);
    } catch (error) {
      // Ignore audio errors
    }
  }
  
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', function() {
  // Enhanced mobile menu toggle
  const menuBtn = document.getElementById('menu-btn');
  const mobileMenu = document.getElementById('mobile-menu');
  
  if (menuBtn && mobileMenu) {
    menuBtn.addEventListener('click', () => {
      const isExpanded = menuBtn.getAttribute('aria-expanded') === 'true';
      mobileMenu.classList.toggle('open');
      menuBtn.classList.toggle('menu-open');
      menuBtn.setAttribute('aria-expanded', !isExpanded);
      mobileMenu.setAttribute('aria-hidden', isExpanded);
    });
    
    // Close mobile menu when clicking on links
    document.querySelectorAll('#mobile-menu a').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.remove('open');
        menuBtn.classList.remove('menu-open');
        menuBtn.setAttribute('aria-expanded', 'false');
        mobileMenu.setAttribute('aria-hidden', 'true');
      });
    });
  }
  
  // Enhanced Navbar scroll effect
  const navbar = document.getElementById('navbar');
  const navLinks = document.querySelectorAll('.nav-link');
  
  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      navbar.classList.add('navbar-scrolled');
      navbar.classList.add('py-2');
      navbar.classList.remove('py-3');
    } else {
      navbar.classList.remove('navbar-scrolled');
      navbar.classList.remove('py-2');
      navbar.classList.add('py-3');
    }
    
    // Update active nav link based on scroll position
    const sections = document.querySelectorAll('section');
    let currentSection = '';
    
    sections.forEach(section => {
      const sectionTop = section.offsetTop;
      const sectionHeight = section.clientHeight;
      
      if (window.scrollY >= sectionTop - 100) {
        currentSection = section.getAttribute('id');
      }
    });
    
    navLinks.forEach(link => {
      link.classList.remove('active');
      link.setAttribute('aria-current', 'false');
      if (link.getAttribute('href').substring(1) === currentSection) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      }
    });
    
    // Set Home as active if at the top of the page
    if (window.scrollY < 100) {
      const homeLink = document.querySelector('a[href="#home"]');
      if (homeLink) {
        homeLink.classList.add('active');
        homeLink.setAttribute('aria-current', 'page');
      }
    }
  });
  
  // Testimonial carousel
  const testimonialContainer = document.getElementById('testimonial-container');
  const testimonialDots = document.querySelectorAll('.testimonial-dot');
  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');
  let currentTestimonial = 0;
  
  function showTestimonial(index) {
    if (testimonialContainer) {
      testimonialContainer.scrollTo({
        left: testimonialContainer.clientWidth * index,
        behavior: 'smooth'
      });
    }
    
    // Update active dot
    testimonialDots.forEach((dot, i) => {
      if (i === index) {
        dot.classList.add('bg-primary');
        dot.classList.remove('bg-gray-300');
        dot.setAttribute('aria-current', 'true');
      } else {
        dot.classList.remove('bg-primary');
        dot.classList.add('bg-gray-300');
        dot.setAttribute('aria-current', 'false');
      }
    });
    
    currentTestimonial = index;
  }
  
  testimonialDots.forEach((dot, index) => {
    dot.addEventListener('click', () => showTestimonial(index));
  });
  
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      let newIndex = currentTestimonial - 1;
      if (newIndex < 0) newIndex = testimonialDots.length - 1;
      showTestimonial(newIndex);
    });
  }
  
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      let newIndex = currentTestimonial + 1;
      if (newIndex >= testimonialDots.length) newIndex = 0;
      showTestimonial(newIndex);
    });
  }
  
  // Auto-rotate testimonials
  if (testimonialDots.length > 0) {
    setInterval(() => {
      let newIndex = currentTestimonial + 1;
      if (newIndex >= testimonialDots.length) newIndex = 0;
      showTestimonial(newIndex);
    }, 6000);
  }
  
  // FIXED FORM VALIDATION AND SUBMISSION
  const contactForm = document.getElementById('contact-form');
  const nameInput = document.getElementById('name');
  const emailInput = document.getElementById('email');
  const nameError = document.getElementById('name-error');
  const emailError = document.getElementById('email-error');
  const submitBtn = document.getElementById('submit-btn');
  const submitText = document.getElementById('submit-text');
  const submitLoading = document.getElementById('submit-loading');
  const formSuccess = document.getElementById('form-success');
  const formError = document.getElementById('form-error');
  
  if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      console.log('Form submission started...');
      
      let isValid = true;
      
      // Validate name
      if (!nameInput.value.trim()) {
        if (nameError) nameError.classList.remove('hidden');
        if (nameInput) nameInput.setAttribute('aria-invalid', 'true');
        isValid = false;
        console.log('Name validation failed');
      } else {
        if (nameError) nameError.classList.add('hidden');
        if (nameInput) nameInput.setAttribute('aria-invalid', 'false');
      }
      
      // Validate email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(emailInput.value)) {
        if (emailError) emailError.classList.remove('hidden');
        if (emailInput) emailInput.setAttribute('aria-invalid', 'true');
        isValid = false;
        console.log('Email validation failed');
      } else {
        if (emailError) emailError.classList.add('hidden');
        if (emailInput) emailInput.setAttribute('aria-invalid', 'false');
      }
      
      if (isValid) {
        // Show loading state
        if (submitText) submitText.classList.add('hidden');
        if (submitLoading) submitLoading.classList.remove('hidden');
        if (submitBtn) submitBtn.disabled = true;
        
        try {
          // Prepare form data
          const formData = {
            name: document.getElementById('name').value.trim(),
            email: document.getElementById('email').value.trim(),
            phone: document.getElementById('phone')?.value?.trim() || '',
            service: document.getElementById('service')?.value || '',
            message: document.getElementById('message')?.value?.trim() || ''
          };
          
          console.log('Submitting form data:', formData);
          
          // Submit to the correct endpoint
          const response = await fetch('/api/form/submit', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(formData),
            credentials: 'include'
          });
          
          console.log('Response status:', response.status);
          const responseData = await response.json();
          console.log('Response data:', responseData);
          
          if (response.ok && responseData.success) {
            // Show success message
            if (formSuccess) formSuccess.classList.remove('hidden');
            if (formError) formError.classList.add('hidden');
            
            // Reset form
            contactForm.reset();
            
            console.log('✅ Form submitted successfully!');
            
            // Auto-hide success message after 5 seconds
            setTimeout(() => {
              if (formSuccess) formSuccess.classList.add('hidden');
            }, 5000);
            
          } else {
            throw new Error(responseData.error || 'Submission failed');
          }
          
        } catch (error) {
          console.error('❌ Form submission error:', error);
          
          // Show error message
          if (formError) {
            formError.classList.remove('hidden');
            formError.textContent = `Error: ${error.message}`;
          }
          if (formSuccess) formSuccess.classList.add('hidden');
          
        } finally {
          // Reset button state
          if (submitText) submitText.classList.remove('hidden');
          if (submitLoading) submitLoading.classList.add('hidden');
          if (submitBtn) submitBtn.disabled = false;
        }
      } else {
        console.log('Form validation failed');
      }
    });
  }
  
  // Add intersection observer for animations
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  };
  
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animate-fade-in-up');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);
  
  // Observe elements with the animation class
  document.querySelectorAll('.service-card, .testimonial-slide').forEach(el => {
    observer.observe(el);
  });
  
  // Set Home as active on page load
  const homeLink = document.querySelector('a[href="#home"]');
  if (homeLink) {
    homeLink.classList.add('active');
    homeLink.setAttribute('aria-current', 'page');
  }
  
  // Add touch event listeners for mobile
  if ('ontouchstart' in window) {
    // Increase touch targets for mobile
    document.querySelectorAll('a, button').forEach(el => {
      if (el.offsetWidth < 44 || el.offsetHeight < 44) {
        el.style.minWidth = '44px';
        el.style.minHeight = '44px';
        el.style.display = 'inline-flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
      }
    });
  }
  
  // Initialize enhanced chat widget
  setTimeout(() => {
    window.chatWidget = new ChatWidget();
    console.log('Chat widget initialized');
  }, 500);
});

// Test function to check server connectivity
async function testServerConnection() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    console.log('Server connection test:', data);
    return data;
  } catch (error) {
    console.error('Server connection failed:', error);
    return null;
  }
}
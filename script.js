// Form submission handling
document.getElementById('contact-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const submitBtn = document.getElementById('submit-btn');
  const submitText = document.getElementById('submit-text');
  const submitLoading = document.getElementById('submit-loading');
  const formSuccess = document.getElementById('form-success');
  const formError = document.getElementById('form-error');
  
  // Show loading state
  submitText.classList.add('hidden');
  submitLoading.classList.remove('hidden');
  submitBtn.disabled = true;
  
  // Get form data
  const formData = {
    name: document.getElementById('name').value,
    email: document.getElementById('email').value,
    phone: document.getElementById('phone').value,
    service: document.getElementById('service').value,
    message: document.getElementById('message').value
  };
  
  try {
    // Send to backend
    const response = await fetch('https://your-backend-url.com/api/form/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(formData)
    });
    
    const result = await response.json();
    
    if (result.success) {
      // Show success message
      formSuccess.classList.remove('hidden');
      formError.classList.add('hidden');
      document.getElementById('contact-form').reset();
    } else {
      throw new Error(result.message);
    }
  } catch (error) {
    // Show error message
    formError.classList.remove('hidden');
    formSuccess.classList.add('hidden');
    console.error('Form submission error:', error);
  } finally {
    // Reset button state
    submitText.classList.remove('hidden');
    submitLoading.classList.add('hidden');
    submitBtn.disabled = false;
  }
});

// Chat functionality
const socket = io('https://your-backend-url.com');
const chatWidget = document.getElementById('chat-widget');
const chatBox = document.getElementById('chat-box');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');

// Generate a unique user ID for this session
const userId = 'user_' + Math.random().toString(36).substr(2, 9);

// Open chat
chatWidget.addEventListener('click', () => {
  chatBox.classList.toggle('hidden');
  if (!chatBox.classList.contains('hidden')) {
    socket.emit('join-chat', { userId });
  }
});

// Send message
document.getElementById('chat-send-btn').addEventListener('click', sendMessage);

function sendMessage() {
  const message = chatInput.value.trim();
  if (message) {
    socket.emit('send-message', {
      userId,
      message,
      isAdmin: false
    });
    chatInput.value = '';
  }
}

// Receive messages
socket.on('new-message', (data) => {
  const messageElement = document.createElement('div');
  messageElement.classList.add('message');
  messageElement.classList.add(data.isAdmin ? 'admin-message' : 'user-message');
  messageElement.textContent = data.message;
  chatMessages.appendChild(messageElement);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});
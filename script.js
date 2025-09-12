document.addEventListener('DOMContentLoaded', function() {
  // Handle contact form submission
  const contactForm = document.getElementById('contactForm');
  if (contactForm) {
    contactForm.addEventListener('submit', function(e) {
      e.preventDefault();
      
      const formData = {
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        message: document.getElementById('message').value
      };
      
      // Send data to server
      fetch('/submit-form', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          alert('Thank you for your submission!');
          contactForm.reset();
        } else {
          alert('Error: ' + data.error);
        }
      })
      .catch(error => {
        console.error('Error:', error);
        alert('An error occurred. Please try again.');
      });
    });
  }
  
  // Load submissions for admin page
  if (document.getElementById('submissionsTable')) {
    loadSubmissions();
  }
});

function loadSubmissions() {
  fetch('/api/submissions')
    .then(response => response.json())
    .then(data => {
      const tableBody = document.getElementById('submissionsTable').querySelector('tbody');
      tableBody.innerHTML = ''; // Clear existing content
      
      data.forEach(submission => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${submission.id}</td>
          <td>${submission.name}</td>
          <td>${submission.email}</td>
          <td>${submission.message}</td>
          <td>${new Date(submission.submitted_at).toLocaleString()}</td>
        `;
        tableBody.appendChild(row);
      });
    })
    .catch(error => {
      console.error('Error loading submissions:', error);
    });
}
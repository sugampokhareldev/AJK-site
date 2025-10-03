const nodemailer = require('nodemailer');

// Create transporter with timeout and connection settings for Render
const transporter = nodemailer.createTransporter({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER || process.env.ADMIN_EMAIL,
    pass: process.env.SMTP_PASS || process.env.ADMIN_PASSWORD
  },
  // Connection timeout settings for Render
  connectionTimeout: 60000, // 60 seconds
  greetingTimeout: 30000,   // 30 seconds
  socketTimeout: 60000,     // 60 seconds
  // Retry settings
  pool: true,
  maxConnections: 1,
  maxMessages: 3,
  rateDelta: 20000, // 20 seconds
  rateLimit: 5, // max 5 messages per rateDelta
  // TLS settings for better compatibility
  tls: {
    rejectUnauthorized: false
  }
});

// Function to send email notification
const sendEmailNotification = async (submission) => {
  try {
    const mailOptions = {
      from: `"AJK Cleaning Company" <${process.env.SMTP_USER || process.env.ADMIN_EMAIL}>`,
      to: process.env.ADMIN_EMAIL,
      subject: 'New Contact Form Submission - AJK Cleaning',
      html: `
        <h2>New Contact Form Submission</h2>
        <p><strong>Name:</strong> ${submission.name}</p>
        <p><strong>Email:</strong> ${submission.email}</p>
        <p><strong>Phone:</strong> ${submission.phone || 'Not provided'}</p>
        <p><strong>Service:</strong> ${submission.service || 'Not specified'}</p>
        <p><strong>Message:</strong> ${submission.message || 'No message'}</p>
        <p><strong>Date:</strong> ${submission.date.toLocaleString()}</p>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('Email notification sent successfully');
  } catch (error) {
    console.error('Error sending email:', error);
  }
};

// Function to send confirmation email to customer
const sendConfirmationEmail = async (submission) => {
  try {
    const mailOptions = {
      from: `"AJK Cleaning Company" <${process.env.SMTP_USER || process.env.ADMIN_EMAIL}>`,
      to: submission.email,
      subject: 'Thank you for contacting AJK Cleaning',
      html: `
        <h2>Thank you for your inquiry!</h2>
        <p>Dear ${submission.name},</p>
        <p>We have received your message and will get back to you within 24 hours.</p>
        <p><strong>Your message:</strong> ${submission.message || 'No message'}</p>
        <br>
        <p>Best regards,</p>
        <p>The AJK Cleaning Team</p>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('Confirmation email sent to customer');
  } catch (error) {
    console.error('Error sending confirmation email:', error);
  }
};

module.exports = {
  sendEmailNotification,
  sendConfirmationEmail
};
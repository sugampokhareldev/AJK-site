const nodemailer = require('nodemailer');

// Create transporter
const transporter = nodemailer.createTransporter({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Function to send email notification
const sendEmailNotification = async (submission) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
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
      from: process.env.EMAIL_USER,
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
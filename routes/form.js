const express = require('express');
const router = express.Router();
const FormSubmission = require('../models/FormSubmission');
const { sendEmailNotification } = require('../utils/emailService');

router.post('/submit', async (req, res) => {
  try {
    const { name, email, phone, service, message } = req.body;

    // Validate required fields
    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: 'Name and email are required fields'
      });
    }

    // Create new form submission
    const submission = new FormSubmission({
      name,
      email,
      phone,
      service,
      message
    });

    // Save to database
    await submission.save();

    // Send email notification
    await sendEmailNotification(submission);

    res.status(200).json({
      success: true,
      message: 'Form submitted successfully'
    });
  } catch (error) {
    console.error('Form submission error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again later.'
    });
  }
});

module.exports = router;
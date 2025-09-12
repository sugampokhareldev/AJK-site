const mongoose = require('mongoose');

const formSubmissionSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true
  },
  phone: String,
  service: String,
  message: String,
  date: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('FormSubmission', formSubmissionSchema);
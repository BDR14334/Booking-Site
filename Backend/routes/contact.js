const express = require('express');
const router = express.Router();
const sendEmail = require('../utils/email'); // SendGrid helper

router.post('/', async (req, res) => {
  const { firstName, lastName, email, phone, message } = req.body;

  const html = `
    <h2>New Contact Form Submission</h2>
    <p><b>Name:</b> ${firstName} ${lastName}</p>
    <p><b>Email:</b> ${email}</p>
    <p><b>Phone:</b> ${phone}</p>
    <p><b>Message:</b><br>${message}</p>
  `;

  try {
    await sendEmail(
      'info@Zephyrsstrengthandperformance.com', // To ZSP
      'New Contact Form Submission',
      html
    );
    res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send email.' });
  }
});

module.exports = router;
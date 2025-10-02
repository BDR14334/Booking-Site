const express = require('express');
const router = express.Router();
const sendEmail = require('../utils/email'); // SendGrid helper

router.post('/', async (req, res) => {
  const { firstName, lastName, email, phone, message } = req.body;

const html = `
  <div style="font-family: Arial, sans-serif; color:#333; line-height:1.6; max-width:600px;">
    <p>Hi ZSP,</p>

    <p style="margin: 15px 0; white-space: pre-line;">${message}</p>

    <p>Best,</p>
    <p>
      ${firstName} ${lastName}<br>
      <strong>Email:</strong> ${email}<br>
      <strong>Phone:</strong> ${phone || 'N/A'}
    </p>
  </div>
`;


  try {
    await sendEmail(
      'info@Zephyrsstrengthandperformance.com',
      'New Contact Form Submission',
      html,
      process.env.CONTACT_EMAIL, // verified sender
      email // customer's email as replyTo
    );
    res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send email.' });
  }
});

module.exports = router;
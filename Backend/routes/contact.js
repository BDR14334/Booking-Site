const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');

router.post('/', async (req, res) => {
  const { firstName, lastName, email, phone, message } = req.body;

  // Configure transporter (use your own credentials)
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'robinsontech30@gmail.com',
      pass: process.env.GMAIL_APP_PASSWORD // Use an App Password, not your Gmail password!
    }
  });

  const mailOptions = {
    from: email,
    to: 'info@Zephyrsstrengthandperformance.com',
    subject: 'New Contact Form Submission',
    text: `
      Name: ${firstName} ${lastName}
      Email: ${email}
      Phone: ${phone}
      Message: ${message}
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send email.' });
  }
});

module.exports = router;
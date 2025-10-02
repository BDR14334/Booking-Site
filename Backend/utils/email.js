const Mailjet = require('node-mailjet');

const mailjet = Mailjet.apiConnect(
  process.env.MJ_API_KEY,
  process.env.MJ_API_SECRET
);

/**
 * Send email with Mailjet
 * @param {string|string[]} to - Recipient(s)
 * @param {string} subject - Subject line
 * @param {string} html - HTML body
 */
async function sendEmail(to, subject, html, from, replyTo) {
  try {
    const request = mailjet
      .post('send', { version: 'v3.1' })
      .request({
        Messages: [
          {
            From: {
              Email: from || process.env.NO_REPLY_EMAIL,
              Name: 'Zephyrs Strength & Performance',
            },
            To: Array.isArray(to) ? to.map(email => ({ Email: email })) : [{ Email: to }],
            Subject: subject,
            HTMLPart: html,
            ...(replyTo ? { ReplyTo: { Email: replyTo } } : {}),
          },
        ],
      });

    const result = await request;
    console.log(`✅ Mailjet email sent to ${to}`, result.body);
  } catch (err) {
    console.error('❌ Mailjet error:', err.message || err);
  }
}

module.exports = sendEmail;


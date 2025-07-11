// routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
require('dotenv').config();
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const validRoles = ['admin', 'coach', 'athlete'];
const ADMIN_SECRET_ID = process.env.ADMIN_SECRET_ID;

// Password validation
function isValidPassword(password) {
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()\-_=+\[\]{}|;:'",.<>?/])[A-Za-z\d!@#$%^&*()\-_=+\[\]{}|;:'",.<>?/]{8,64}$/;
  return passwordRegex.test(password) && !password.includes(' ');
}

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// REGISTER
router.post('/register', async (req, res) => {
  const { first_name, last_name, email, password, role, admin_id } = req.body;

  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid or missing role. Must be admin, coach, or athlete.' });
  }

  if (!isValidPassword(password)) {
    return res.status(400).json({
      error: 'Password must be 8–64 characters and include at least one uppercase, lowercase, number, and special character. No spaces.'
    });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Invalid email format.' });
  }

  if (role === 'admin' && admin_id !== ADMIN_SECRET_ID) {
    return res.status(403).json({ error: 'Invalid Admin ID.' });
  }

  try {
    const existingUser = await pool.query(`SELECT * FROM public.users WHERE LOWER(email) = LOWER($1)`, [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await pool.query(
      `INSERT INTO public.users (first_name, last_name, email, password_hash, role) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, email, role, created_at`,
      [first_name, last_name, email, hashedPassword, role]
    );

    if (role === 'admin') {
      const hashedAdminId = await bcrypt.hash(admin_id, 10);
      await pool.query(
        `INSERT INTO public.admin_profile (user_id, first_name, last_name, phone, admin_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [newUser.rows[0].id, first_name, last_name, '', hashedAdminId]
      );
    }

    res.status(201).json({ message: 'User registered successfully', user: newUser.rows[0] });

  } catch (err) {
    console.error('Registration error:', err.message);
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  const { email, password, admin_id } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    // Find user by email only
    const userQuery = await pool.query(
      `SELECT * FROM public.users WHERE LOWER(email) = LOWER($1)`,
      [email]
    );

    if (userQuery.rows.length === 0) {
      return res.status(401).json({ error: 'User not found.' });
    }

    const user = userQuery.rows[0];
    const role = user.role;

    // Check password
    const isPasswordMatch = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordMatch) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }

    // Admins no longer need to provide admin ID for login

    // Generate token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        first_name: user.first_name,
        last_name: user.last_name,
      },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Set cookie
    res
      .cookie('token', token, {
        httpOnly: true,
        secure: true,
        maxAge: 3600000,
        sameSite: 'None',
      })
      .status(200)
      .json({
        message: 'Login successful',
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          is_first_login: user.is_first_login,
        },
      });

    // Mark user as not first-time login
    if (user.is_first_login) {
      await pool.query(`UPDATE users SET is_first_login = false WHERE id = $1`, [user.id]);
    }
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Server error during login.' });
  }
});


// LOGOUT
router.post('/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: true,
    sameSite: 'None'
  });
  res.status(200).json({ message: 'Logout successful' });
});


// VERIFY (check login status)
router.get('/verify', (req, res) => {
    try {
      const token = req.cookies.token;
      if (!token) return res.status(401).json({ loggedIn: false });
  
      const decoded = jwt.verify(token, JWT_SECRET);
      res.json({ loggedIn: true, user: decoded });
    } catch (err) {
      res.status(401).json({ loggedIn: false });
    }
});

// GET current logged-in user
router.get('/me', (req, res) => {
  try {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Not logged in' });

    const decoded = jwt.verify(token, JWT_SECRET);
    res.status(200).json({ user: decoded });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// sends password reset link to then update password
router.post('/forgot-password', async (req, res) => {
  const { email, role } = req.body;

  try {
    const userRes = await pool.query(`SELECT * FROM users WHERE email = $1 AND role = $2`, [email, role]);
    if (userRes.rows.length === 0) {
      return res.status(200).json({ message: 'If your email exists, a reset link has been sent.' }); // Don't leak info
    }

    const user = userRes.rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 15); // 15 minutes

    await pool.query(`
      INSERT INTO password_resets (user_id, token, expires_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at
    `, [user.id, token, expiresAt]);

    const resetLink = `http://localhost:5500/Booking-Site/Frontend/ResetPassword.html?token=${token}`;

    // Replace with real email service (e.g., SendGrid or SMTP)
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'robinsontech30@gmail.com',
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Password Reset',
      html: `<p>Click <a href="${resetLink}">here</a> to reset your password. The link expires in 15 minutes.</p>`
    });

    res.json({ message: 'If your email exists, a reset link has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Updates password in database
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;

  if (!isValidPassword(newPassword)) {
    return res.status(400).json({
      error: 'Password must be 8–64 characters and include uppercase, lowercase, number, special character. No spaces.'
    });
  }

  try {
    const resetRes = await pool.query(`
      SELECT * FROM password_resets WHERE token = $1 AND expires_at > NOW()
    `, [token]);

    if (resetRes.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired token.' });
    }

    const userId = resetRes.rows[0].user_id;
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hashedPassword, userId]);
    await pool.query(`DELETE FROM password_resets WHERE user_id = $1`, [userId]);

    res.json({ message: 'Password successfully updated.' });
  } catch (err) {
    console.error('Reset password error:', err.message);
    res.status(500).json({ error: 'Server error during password reset.' });
  }
});


module.exports = router;

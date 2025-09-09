// routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
require('dotenv').config();
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { allowedOrigins } = require('../config');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const validRoles = ['admin', 'coach', 'athlete', 'adult-athlete'];
const ADMIN_SECRET_ID = process.env.ADMIN_SECRET_ID;

// Use the first allowed origin as the default FRONTEND_BASE_URL
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || allowedOrigins[0];

// Add near the top, after your requires
function authenticateToken(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid token' });
  }
}

// Password validation
function isValidPassword(password) {
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()\-_=+\[\]{}|;:'",.<>?/])[A-Za-z\d!@#$%^&*()\-_=+\[\]{}|;:'",.<>?/]{8,64}$/;
  return passwordRegex.test(password) && !password.includes(' ');
}

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function isValidUsername(username) {
  return /^[a-zA-Z0-9_]{3,30}$/.test(username);
}

// GET current logged-in user
router.get('/me', (req, res) => {
  try {
    const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Not logged in' });

    const decoded = jwt.verify(token, JWT_SECRET);
    res.status(200).json({ user: decoded });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// REGISTER
router.post('/register', async (req, res) => {
  const { first_name, last_name, username, email, password, role, admin_id } = req.body;

  console.log('Register body:', req.body);

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

  if (!isValidUsername(username)) {
    return res.status(400).json({ error: 'Username must be 3-30 characters and contain only letters, numbers, or underscores.' });
  }

  if (role === 'admin' && admin_id !== ADMIN_SECRET_ID) {
    return res.status(403).json({ error: 'Invalid Admin ID.' });
  }

  try {
    // Check for existing user with same username or email
    const existing = await pool.query(
      'SELECT * FROM public.users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2)',
      [username, email]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Username or email already taken.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await pool.query(
      `INSERT INTO public.users (first_name, last_name, username, email, password_hash, role) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id, username, email, role, created_at`,
      [first_name, last_name, username, email, hashedPassword, role]
    );

    if (role === 'admin') {
      const hashedAdminId = await bcrypt.hash(admin_id, 10);
      await pool.query(
        `INSERT INTO public.admin_profile (user_id, first_name, last_name, phone, admin_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [newUser.rows[0].id, first_name, last_name, '', hashedAdminId]
      );
    } else if (role === 'athlete' || role === 'adult-athlete') { // <-- Add adult-athlete here
      await pool.query(
        `INSERT INTO public.customer (first_name, last_name, email, user_id, phone)
         VALUES ($1, $2, $3, $4, $5)`,
        [first_name, last_name, email, newUser.rows[0].id, '']
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
  // const { email, password } = req.body;
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    // Find user by email only
    const userQuery = await pool.query(
      `SELECT * FROM public.users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)`,
      [identifier]
    );

    if (userQuery.rows.length === 0) {
      return res.status(401).json({ error: 'User not found.' });
    }

    const user = userQuery.rows[0];

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
        token,
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
      const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
      if (!token) return res.status(401).json({ loggedIn: false });
  
      const decoded = jwt.verify(token, JWT_SECRET);
      res.json({ loggedIn: true, user: decoded });
    } catch (err) {
      res.status(401).json({ loggedIn: false });
    }
});

// Helper to hash tokens
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Send password reset link
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  try {
    const userRes = await pool.query(
      `SELECT * FROM users WHERE LOWER(email) = LOWER($1)`, [email]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'Account with this email does not exist.' });
    }

    const user = userRes.rows[0];
    const rawToken = crypto.randomBytes(32).toString('hex');
    const token = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 15); // 15 minutes

    // Cleanup expired tokens
    await pool.query(`DELETE FROM password_resets WHERE expires_at <= NOW()`);

    await pool.query(`
      INSERT INTO password_resets (user_id, token, expires_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at
    `, [user.id, token, expiresAt]);

    const origin = req.get('origin');
    const isAllowed = allowedOrigins.includes(origin);
    const baseUrl = isAllowed ? origin : allowedOrigins[1]; // fallback to your production URL
    const resetLink = `${baseUrl}/reset-password?token=${rawToken}`;

    // Send email (same as before)
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

    res.json({ message: 'Reset link sent to your email address.' });
  } catch (err) {
    console.error('Forgot password error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Check if reset token is valid (for frontend)
router.get('/check-reset-token', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required' });

  try {
    // Cleanup expired tokens
    await pool.query(`DELETE FROM password_resets WHERE expires_at <= NOW()`);

    const hashed = hashToken(token);
    const result = await pool.query(
      `SELECT 1 FROM password_resets WHERE token = $1 AND expires_at > NOW()`,
      [hashed]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }
    res.json({ valid: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Actually reset the password
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;

  if (!isValidPassword(newPassword)) {
    return res.status(400).json({
      error: 'Password must be 8–64 characters and include uppercase, lowercase, number, special character. No spaces.'
    });
  }

  try {
    // Cleanup expired tokens
    await pool.query(`DELETE FROM password_resets WHERE expires_at <= NOW()`);

    const hashed = hashToken(token);
    const resetRes = await pool.query(`
      SELECT * FROM password_resets WHERE token = $1 AND expires_at > NOW()
    `, [hashed]);

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

router.get('/auth/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, role, first_name, last_name FROM public.users WHERE id = $1 LIMIT 1',
      [req.user.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Error fetching user:', err.message);
    res.status(500).json({ error: 'Error fetching user' });
  }
});


module.exports = {
  router,
  authenticateToken
};

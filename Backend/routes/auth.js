// routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
require('dotenv').config();
const crypto = require('crypto');
const { allowedOrigins } = require('../config');
const sendEmail = require('../utils/email'); // new mailjet helper

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const validRoles = ['admin', 'coach', 'athlete', 'adult-athlete'];
const ADMIN_SECRET_ID = process.env.ADMIN_SECRET_ID;

// Use the first allowed origin as the default FRONTEND_BASE_URL
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || allowedOrigins[0];

// Authenticate token
function authenticateToken(req, res, next) {
  // Only check cookies and Authorization header (never localStorage/sessionStorage)
  const token =
    req.cookies.token ||
    req.headers.authorization?.split(' ')[1];

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
    // Only check cookies and Authorization header
    const token =
      req.cookies.token ||
      req.headers.authorization?.split(' ')[1];

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
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    // Find user by email or username
    const userQuery = await pool.query(
      `SELECT * FROM public.users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)`,
      [identifier]
    );

    // Always use a constant-time password check to avoid timing attacks
    let user = userQuery.rows[0];
    let isPasswordMatch = false;

    if (user) {
      isPasswordMatch = await bcrypt.compare(password, user.password_hash);
    } else {
      // Dummy hash compare to mitigate timing attacks
      await bcrypt.compare(password, "$2a$10$7a8b9c0d1e2f3g4h5i6j7k8l9m0n1o2p3q4r5s6t7u8v9w0x1y2z3a");
    }

    if (!user || !isPasswordMatch) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

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
    res.cookie("token", token, {
      httpOnly: true,
      secure: true,       // only over HTTPS
      sameSite: "None",   // allows cross-site frontend/backend
      maxAge: 3600000     // 1 hour
    });

    // Send welcome email on first login
    if (user.is_first_login) {
      await pool.query(`UPDATE users SET is_first_login = false WHERE id = $1`, [user.id]);

      // Send welcome email using SendGrid and no-reply address
      try {
        await sendEmail(
          user.email,
          'Welcome to Zephyrs Strength & Performance!',
          `
            <p>Hi ${user.first_name},</p>
            <p>Welcome to Zephyrs Strength & Performance! We’re excited to have you join our community.</p>
            <p>Our founders, Coach Warren Archer and Coach Dennis Robinson, created Zephyrs Strength & Performance with one goal in mind: to help athletes unlock their full potential through science-based training. Together, they bring decades of experience developing athletes of all ages—from first-timers to national champions—blending evidence-driven programming with mentorship that extends beyond the track.</p>
            <p>As part of Zephyrs Strength & Performance, you’ll gain access to training that builds speed, strength, endurance, and resilience. More than workouts, we’re here to help you grow as an athlete and as a person.</p>
            <p>We encourage you to log in, explore your account, and check out available packages. Your journey to becoming stronger, faster, and more confident starts today.</p>
            <p>Welcome to the ZSP family, we’re glad you’re here.</p>
            <p>Best,<br>The Zephyrs Strength & Performance Team</p>
          `
        );
      } catch (emailErr) {
        console.error('Failed to send welcome email:', emailErr);
        // Do not block login if email fails
      }
    }

    // Respond with token and user info
    res.status(200).json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        is_first_login: user.is_first_login,
      },
    });

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
    // Only check cookies and Authorization header
    const token =
      req.cookies.token ||
      req.headers.authorization?.split(' ')[1];

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
    const baseUrl = isAllowed ? origin : allowedOrigins[2]; // fallback to your production URL
    const resetLink = `${baseUrl}/auth/reset-link/${rawToken}`;

    // Send password reset email using SendGrid and no-reply address
    await sendEmail(
      email,
      'Password Reset',
      `<p>Click <a href="${resetLink}">here</a> to reset your password. The link expires in 15 minutes.</p>`
    );

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
  const { newPassword } = req.body;
  const token = req.cookies.reset_token; // Read from cookie

  if (!token) {
    return res.status(400).json({ error: 'Reset token missing or expired.' });
  }

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

    // On success, clear the cookie:
    res.clearCookie('reset_token', {
      httpOnly: true,
      secure: true,
      sameSite: 'None'
    });

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

function requireRole(role) {
  return function (req, res, next) {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

// Membership route
router.get('/membership', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.is_member
      FROM customer c
      WHERE c.user_id = $1
    `, [req.user.id]);

    if (result.rows.length === 0) {
      return res.json({ is_member: false });
    }
    res.json({ is_member: result.rows[0].is_member });
  } catch (err) {
    console.error("Error fetching user membership:", err);
    res.status(500).json({ error: "Failed to fetch user info" });
  }
});

// When the user clicks the link in the email, direct them to this backend route:
router.get('/reset-link/:token', (req, res) => {
  const rawToken = req.params.token;
  res.cookie("reset_token", rawToken, {
    httpOnly: true,
    secure: true,
    sameSite: "None",
    maxAge: 15 * 60 * 1000 // 15 minutes
  });
  res.redirect('/reset-password');
});

module.exports = {
  router,
  authenticateToken,
  requireRole
};

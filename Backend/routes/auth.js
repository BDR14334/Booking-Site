// routes/auth.js
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');
require('dotenv').config();

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const validRoles = ['admin', 'coach', 'athlete'];
const ADMIN_SECRET_ID = process.env.ADMIN_SECRET_ID;

// Password validation
function isValidPassword(password) {
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()\-_=+\[\]{}|;:'",.<>?/])[A-Za-z\d!@#$%^&*()\-_=+\[\]{}|;:'",.<>?/]{8,64}$/;
  return passwordRegex.test(password) && !password.includes(' ');
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

  if (role === 'admin' && admin_id !== ADMIN_SECRET_ID) {
    return res.status(403).json({ error: 'Invalid Admin ID.' });
  }

  try {
    const existingUser = await pool.query(`SELECT * FROM public.users WHERE email = $1`, [email]);
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
  const { email, password, role, admin_id } = req.body;

  if (!email || !password || !role) {
    return res.status(400).json({ error: 'Email, password, and role are required.' });
  }

  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role.' });
  }

  try {
    const userQuery = await pool.query(`SELECT * FROM public.users WHERE email = $1 AND role = $2`, [email, role]);
    if (userQuery.rows.length === 0) {
      return res.status(401).json({ error: 'User not found or role mismatch.' });
    }

    const user = userQuery.rows[0];
    const isPasswordMatch = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordMatch) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }

    if (role === 'admin') {
      if (!admin_id) {
        return res.status(400).json({ error: 'Admin ID is required for admin login.' });
      }

      const adminProfileQuery = await pool.query(`SELECT * FROM public.admin_profile WHERE user_id = $1`, [user.id]);
      if (adminProfileQuery.rows.length === 0) {
        return res.status(403).json({ error: 'Admin profile not found.' });
      }

      const adminProfile = adminProfileQuery.rows[0];
      const isAdminIdMatch = await bcrypt.compare(admin_id, adminProfile.admin_id);
      if (!isAdminIdMatch) {
        return res.status(403).json({ error: 'Invalid Admin ID.' });
      }
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 3600000, // 1 hour
        sameSite: 'strict',
      })
      .status(200)
      .json({ message: 'Login successful', user: { id: user.id, email: user.email, role: user.role } });

  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// LOGOUT
router.post('/logout', (req, res) => {
  res.clearCookie('token').status(200).json({ message: 'Logout successful' });
});

// VERIFY (optional endpoint to check login status)
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

module.exports = router;

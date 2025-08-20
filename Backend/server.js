// server.js
const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const coachRoutes = require('./routes/coach'); 
const adminRoutes = require('./routes/admin');
const athleteRoutes = require('./routes/athlete');
const bookingRoutes = require('./routes/booking');  
const timeslotRoutes = require('./routes/timeslot'); 
const contactRoutes = require('./routes/contact');

// NEW: Load Stripe
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // Make sure your .env has this key


const app = express();
const PORT = process.env.PORT || 5000;
const allowedOrigins = [
  'http://localhost:5500',       // dev
  'https://booking-site-frontend.onrender.com', // 🚀 your deployed frontend
  'https://www.zephyrsstrengthandperformance.com'
];

// CORS config to allow credentials (cookies) from frontend
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

// Serve static HTML + image assets
app.use(express.static(path.join(__dirname, '../Frontend')));
app.use('/img', express.static(path.join(__dirname, '../Frontend/img')));


// Mount routes
app.use('/auth', authRoutes.router);
app.use('/coach', coachRoutes); 
app.use('/athlete', athleteRoutes); 
app.use('/admin', adminRoutes);
app.use('/booking', bookingRoutes);
app.use('/timeslot', timeslotRoutes);
app.use('/contact', contactRoutes); 

// NEW: Stripe payment intent route
app.post('/payment/create-payment-intent', async (req, res) => {
  try {
    const { amount, currency, metadata } = req.body;

    const paymentIntent = await stripe.paymentIntents.create({
      amount, // in cents
      currency,
      metadata,
    });

    res.status(200).json({
      clientSecret: paymentIntent.client_secret
    });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: 'Payment processing failed' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});


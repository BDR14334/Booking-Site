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

// NEW: Load Stripe
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // Make sure your .env has this key

const app = express();
const PORT = process.env.PORT || 5000;

// CORS config to allow credentials (cookies) from frontend
app.use(cors({
  origin: 'http://localhost:5500', // frontend URL 
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

// Mount routes
app.use('/auth', authRoutes);
app.use('/coach', coachRoutes); 
app.use('/athlete', athleteRoutes); 
app.use('/admin', adminRoutes);
app.use('/booking', bookingRoutes);
app.use('/timeslot', timeslotRoutes);
app.use('/img', express.static(path.join(__dirname, '../Frontend/img')));


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


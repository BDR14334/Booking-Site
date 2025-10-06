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

const db = require('../Backend/db'); // adjust path as needed

app.get('/packages', async (req, res) => {
  try {
    const packages = await db.getPackages();

    // Build SEO meta tags and JSON-LD from package data
    const packageNames = packages.map(pkg => pkg.title).join(', ');
    const packageDescriptions = packages.map(pkg => pkg.description).join(' | ');

    const seoTags = `
      <meta charset="UTF-8" />
      <meta http-equiv="X-UA-Compatible" content="IE=edge" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Packages | Zephyrs Strength & Performance</title>
      <meta name="description" content="Packages: ${packageNames}. ${packageDescriptions}" />
      <meta name="keywords" content="${packageNames}" />
      <meta name="author" content="Zephyrs Strength & Performance" />
      <meta name="robots" content="index, follow" />
      <link rel="icon" type="image/png" href="img/favicon.png" />
      <link rel="canonical" href="https://www.zephyrsstrengthandperformance.com/packages" />
      <meta property="og:title" content="Packages | Zephyrs Strength & Performance" />
      <meta property="og:description" content="Packages: ${packageNames}. ${packageDescriptions}" />
      <meta property="og:image" content="https://www.zephyrsstrengthandperformance.com/img/ZSP-logo1.png" />
      <meta property="og:url" content="https://www.zephyrsstrengthandperformance.com/packages" />
      <meta property="og:type" content="website" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content="Packages | Zephyrs Strength & Performance" />
      <meta name="twitter:description" content="Packages: ${packageNames}. ${packageDescriptions}" />
      <meta name="twitter:image" content="https://www.zephyrsstrengthandperformance.com/img/ZSP-logo1.png" />
      <link href="https://unpkg.com/boxicons@2.1.4/css/boxicons.min.css" rel="stylesheet" />
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css">
      <link rel="stylesheet" href="style.css" />
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "ProductCatalog",
        "name": "Zephyrs Strength & Performance Packages",
        "url": "https://www.zephyrsstrengthandperformance.com/packages",
        "description": "${packageDescriptions}",
        "brand": {
          "@type": "SportsOrganization",
          "name": "Zephyrs Strength & Performance"
        },
        "itemListElement": [
          ${packages.map(pkg => `
            {
              "@type": "Product",
              "name": "${pkg.title}",
              "description": "${pkg.description}",
              "offers": {
                "@type": "Offer",
                "price": "${pkg.price}",
                "priceCurrency": "USD"
              }
            }
          `).join(',')}
        ]
      }
      </script>
    `;

    // Read your static packages.html file
    const fs = require('fs');
    const html = fs.readFileSync(path.join(__dirname, '../Frontend/packages.html'), 'utf8');

    // Inject SEO tags right after the opening <head> tag
    const finalHtml = html.replace('<head>', `<head>\n${seoTags}\n`);

    res.send(finalHtml);
  } catch (err) {
    console.error('Error loading packages:', err);
    res.status(500).send('Error loading packages');
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});


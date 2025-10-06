// server.js
const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const coachRoutes = require('./routes/coach'); 
const adminRoutes = require('./routes/admin');
const athleteRoutes = require('./routes/athlete');
const bookingRoutes = require('./routes/booking');  
const timeslotRoutes = require('./routes/timeslot'); 
const contactRoutes = require('./routes/contact');
const db = require('./db'); // Adjust path if needed

// NEW: Load Stripe
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // Make sure your .env has this key


const app = express();
const PORT = process.env.PORT || 5000;
const allowedOrigins = [
  'http://localhost:5500',       // dev
  'https://booking-site-frontend.onrender.com', // 🚀 your deployed frontend
  'https://www.zephyrsstrengthandperformance.com'
];

// Block everything on API from indexing
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send('User-agent: *\nDisallow: /');
});

// And also block all responses with X-Robots-Tag
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});


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

app.get('/packages', async (req, res) => {
  try {
    // Fetch packages from your database
    const packages = await db.getPackages(); // You need to implement getPackages()

    // Build dynamic SEO meta tags and JSON-LD
    const packageNames = packages.map(pkg => pkg.title).join(', ');
    const packageDescriptions = packages.map(pkg => pkg.description).join(' | ');

    const seoHead = `
      <title>Packages | Zephyrs Strength & Performance</title>
      <meta name="description" content="Packages: ${packageNames}. ${packageDescriptions}" />
      <meta name="keywords" content="${packageNames}" />
      <!-- ...other meta tags... -->
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
    const html = fs.readFileSync(path.join(__dirname, '../Frontend/packages.html'), 'utf8');

    // Replace the <head> section with your dynamic SEO head
    const finalHtml = html.replace(/<head>[\s\S]*?<\/head>/, `<head>${seoHead}</head>`);

    res.send(finalHtml);
  } catch (err) {
    res.status(500).send('Error loading packages');
  }
});

// Prevent API favicon confusion
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/favicon.png', (req, res) => res.status(204).end());

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});


// server.js
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS config to allow credentials (cookies) from frontend
app.use(cors({
  origin: ['http://127.0.0.1:5500', 'http://localhost:5500'], // frontend URL 
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

// Mount routes
app.use('/auth', authRoutes);

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

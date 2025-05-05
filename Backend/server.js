// server.js
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
// const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const coachRoutes = require('./routes/coach'); 
const athleteRoutes = require('./routes/athlete'); 

const app = express();
const PORT = process.env.PORT || 5000;

// CORS config to allow credentials (cookies) from frontend
app.use(cors({
  origin: 'http://localhost:5500', // frontend URL 
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

// app.use((req, res, next) => {
//   req.requestId = uuidv4();
//   console.log(`[${req.requestId}] ${req.method} ${req.url}`);
//   next();
// });

// Mount routes
app.use('/auth', authRoutes);
app.use('/coach', coachRoutes); 
app.use('/athlete', athleteRoutes); 

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});


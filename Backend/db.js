// db.js
const { Pool } = require('pg');
require('dotenv').config();

let pool;

if (process.env.DATABASE_URL) {
  // Production/Render/Supabase
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      require: true,
      rejectUnauthorized: false, // needed for Supabase
    },
  });
} else {
  // Local development (no SSL)
  pool = new Pool({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: process.env.SUPABASE_PASSWORD,
    database: 'Booking',
  });
}

// Global error handler to prevent crashes
pool.on('error', (err) => {
  console.error('Unexpected PG client error:', err);
});

pool.connect()
  .then(() => console.log('✅ Connected to PostgreSQL'))
  .catch(err => console.error('❌ Database connection error:', err.stack));

module.exports = pool;

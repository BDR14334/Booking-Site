// db.js
const { Pool } = require('pg');
require('dotenv').config();

let pool;

if (process.env.DATABASE_URL) {
  // ✅ Production (Render/Supabase)
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      require: true,
      rejectUnauthorized: false, // Required for Render/Supabase SSL
    },
  });
} else {
  // ✅ Local development
  pool = new Pool({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: process.env.SUPABASE_PASSWORD,
    database: 'Booking',
  });
}

// Handle unexpected errors so server doesn't crash
pool.on('error', (err) => {
  console.error('❌ Unexpected PostgreSQL client error:', err);
});

pool
  .connect()
  .then(() => console.log('✅ Connected to PostgreSQL'))
  .catch((err) => console.error('❌ Database connection error:', err.stack));


async function getPackages() {
  try {
    const result = await pool.query(
      'SELECT name AS title, description, price FROM packages ORDER BY id'
    );
    return result.rows;
  } catch (err) {
    console.error('Error fetching packages:', err);
    throw err;
  }
}

// 👇 This keeps compatibility with all your existing routes
pool.getPackages = getPackages;

module.exports = pool;

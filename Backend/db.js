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
    idleTimeoutMillis: 10000,      // close idle clients reasonably fast
    connectionTimeoutMillis: 5000, // fail fast if DB is unreachable
    keepAlive: true
  });
} else {
  // ✅ Local development
  pool = new Pool({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: process.env.SUPABASE_PASSWORD,
    database: 'Booking',
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    keepAlive: true
  });
}

// Handle unexpected errors so server doesn't crash
pool.on('error', (err) => {
  console.error('❌ Unexpected PostgreSQL client error:', err);
});

// Do NOT call pool.connect() here; let pg manage connections per query to avoid leaks
console.log('🔌 PostgreSQL pool initialized');


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

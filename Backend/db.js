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
    try {
      const result = await pool.query(
      `SELECT name AS title, slug, description, price, sessions_included AS sessions,
        features, is_member_priced
         FROM packages
         WHERE is_active = true
         ORDER BY id`
      );
      return result.rows;
    } catch (err) {
      // Local DB may not have been migrated yet
      if (err && err.code === '42703') {
        const fallback = await pool.query(
          `SELECT name AS title, slug, description, price, sessions_included AS sessions,
                  features, is_member_priced
           FROM packages
           ORDER BY id`
        );
        return fallback.rows;
      }
      throw err;
    }
  } catch (err) {
    console.error('Error fetching packages:', err);
    throw err;
  }
}

async function getPackageBySlug(slug) {
  const result = await pool.query(
    `SELECT name AS title, slug, description, price, sessions_included AS sessions,
            features, is_member_priced
     FROM packages
     WHERE slug = $1
       AND is_active = true
     LIMIT 1`,
    [slug]
  );
  return result.rows[0] || null;
}

async function getStories() {
  try {
    const result = await pool.query(
      `SELECT id, name, story, image_url, slug
       FROM success_stories
       WHERE slug IS NOT NULL
         AND is_active = true
       ORDER BY created_at DESC`
    );
    return result.rows;
  } catch (err) {
    if (err && err.code === '42703') {
      const fallback = await pool.query(
        `SELECT id, name, story, image_url, slug
         FROM success_stories
         WHERE slug IS NOT NULL
         ORDER BY created_at DESC`
      );
      return fallback.rows;
    }
    throw err;
  }
}

async function getStoryBySlug(slug) {
  try {
    const result = await pool.query(
      `SELECT id, name, story, image_url, slug
       FROM success_stories
       WHERE slug = $1
         AND is_active = true
       LIMIT 1`,
      [slug]
    );
    return result.rows[0] || null;
  } catch (err) {
    if (err && err.code === '42703') {
      const fallback = await pool.query(
        `SELECT id, name, story, image_url, slug
         FROM success_stories
         WHERE slug = $1
         LIMIT 1`,
        [slug]
      );
      return fallback.rows[0] || null;
    }
    throw err;
  }
}

// 👇 This keeps compatibility with all your existing routes
pool.getPackages = getPackages;
pool.getPackageBySlug = getPackageBySlug;
pool.getStories = getStories;
pool.getStoryBySlug = getStoryBySlug;

module.exports = pool;

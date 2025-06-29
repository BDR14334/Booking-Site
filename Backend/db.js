// db.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      host: 'db.akujlgqrdnvuqntgsgko.supabase.co',
      port: 5432,
      user: 'postgres',
      password: process.env.SUPABASE_PASSWORD,
      database: 'postgres',
      ssl: { rejectUnauthorized: false },
    });

pool.connect()
  .then(() => console.log('✅ Connected to PostgreSQL'))
  .catch(err => console.error('❌ Database connection error:', err.stack));

module.exports = pool;

const express = require('express');
const router = express.Router();
const pool = require('../db');
const nodemailer = require('nodemailer'); 
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { authenticateToken, requireRole } = require('./auth');
const sendEmail = require('../utils/email');

async function getAdminRecipientsFromDb() {
  // Pull recipient list from admin accounts (not from contact inbox).
  // If a users.is_active column exists, we filter to active admins; otherwise, we send to all admins.
  try {
    const res = await pool.query(
      `SELECT LOWER(TRIM(email)) AS email
       FROM users
       WHERE role = 'admin'
         AND COALESCE(is_active, true) = true
         AND email IS NOT NULL
         AND TRIM(email) <> ''`
    );
    const emails = (res.rows || []).map(r => r.email).filter(Boolean);
    return Array.from(new Set(emails));
  } catch (err) {
    // If is_active doesn't exist (common), retry without it.
    if (err && err.code === '42703') {
      const res = await pool.query(
        `SELECT LOWER(TRIM(email)) AS email
         FROM users
         WHERE role = 'admin'
           AND email IS NOT NULL
           AND TRIM(email) <> ''`
      );
      const emails = (res.rows || []).map(r => r.email).filter(Boolean);
      return Array.from(new Set(emails));
    }
    throw err;
  }
}

// Guard Supabase client initialization so local dev doesn't crash
let supabase = null;
if (process.env.NODE_ENV === 'production') {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  if (SUPABASE_URL && SUPABASE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  } else {
    console.warn('Supabase env vars missing in production; image upload will be disabled.');
  }
}

// Saves images for success stories
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../Frontend/img/stories')); // Save to /public/img/stories
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname); // Get file extension
    const baseName = req.body.athleteName || 'athlete'; // Fallback if name missing
    const safeName = baseName.replace(/[^a-z0-9]/gi, '_').toLowerCase(); // Sanitize
    cb(null, `${safeName}${ext}`);
  }
});
const upload = multer({ storage });

// Athlete Stories Section
// Adds new success story to database
router.post('/add-story', authenticateToken, requireRole('admin'), upload.single('athleteImage'), async (req, res) => {
  const { athleteName, storyText } = req.body;
  const imageFile = req.file;
  if (!athleteName || !storyText || !imageFile) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  let imageUrl;
  if (process.env.NODE_ENV === 'production') {
    try {
      imageUrl = await uploadImageToSupabase(
        fs.readFileSync(imageFile.path),
        imageFile.filename,
        imageFile.mimetype
      );
      fs.unlinkSync(imageFile.path);
    } catch (err) {
      return res.status(500).json({ error: 'Supabase upload failed.' });
    }
  } else {
    imageUrl = `/img/stories/${imageFile.filename}`;
  }
  try {
    const result = await pool.query(
      `INSERT INTO success_stories (name, story, image_url)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [athleteName, storyText, imageUrl]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error saving story:', err);
    res.status(500).json({ error: 'Server error saving story.' });
  }
});

router.put('/update-story/:id', authenticateToken, requireRole('admin'), upload.single('athleteImage'), async (req, res) => {
  const { id } = req.params;
  const { athleteName, storyText } = req.body;
  const imageFile = req.file;
  try {
    const existing = await pool.query('SELECT * FROM success_stories WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Story not found' });
    }
    let imageUrl = existing.rows[0].image_url;
    if (imageFile) {
      if (process.env.NODE_ENV === 'production') {
        // Upload to Supabase
        try {
          imageUrl = await uploadImageToSupabase(
            fs.readFileSync(imageFile.path),
            imageFile.filename,
            imageFile.mimetype
          );
          fs.unlinkSync(imageFile.path);
        } catch (err) {
          return res.status(500).json({ error: 'Supabase upload failed.' });
        }
      } else {
        imageUrl = `/img/stories/${imageFile.filename}`;
      }
    }
    const result = await pool.query(
      `UPDATE success_stories SET name = $1, story = $2, image_url = $3 WHERE id = $4 RETURNING *`,
      [athleteName, storyText, imageUrl, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Update story failed:", err);
    res.status(500).json({ error: "Failed to update story." });
  }
});

// Gets the user story in database
router.get('/stories', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, story, image_url
      FROM success_stories
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching stories:', err);
    res.status(500).json({ error: 'Could not load stories' });
  }
});

// Reorder stories without schema changes by adjusting created_at to encode order
router.post('/reorder-stories', authenticateToken, requireRole('admin'), async (req, res) => {
  const { orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return res.status(400).json({ error: 'orderedIds array required' });
  }

  // Validate IDs
  const ids = orderedIds.map(id => parseInt(id, 10));
  if (ids.some(n => !Number.isInteger(n))) {
    return res.status(400).json({ error: 'All orderedIds must be integers' });
  }

  try {
    await pool.query('BEGIN');
    // Use current time as base; subtract i seconds so later items sort below earlier ones
    const base = Date.now();
    for (let i = 0; i < ids.length; i++) {
      const ts = new Date(base - i * 1000); // 1s spacing
      await pool.query('UPDATE success_stories SET created_at = $1 WHERE id = $2', [ts, ids[i]]);
    }
    await pool.query('COMMIT');
    res.json({ message: 'Order saved', orderedIds: ids });
  } catch (err) {
    try { await pool.query('ROLLBACK'); } catch (_) {}
    console.error('Error reordering stories:', err);
    res.status(500).json({ error: 'Failed to save order' });
  }
});

// Delete a success story by ID
router.delete('/delete-story/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    // 1. Get the story to find the image filename
    const storyResult = await pool.query('SELECT image_url FROM success_stories WHERE id = $1', [id]);
    if (storyResult.rowCount === 0) {
      return res.status(404).json({ error: 'Story not found.' });
    }
    const imageUrl = storyResult.rows[0].image_url;
    // 2. Delete the story from the database
    const result = await pool.query('DELETE FROM success_stories WHERE id = $1 RETURNING *', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Story not found.' });
    }

    // 3. Delete the image file from storage (if it exists and is not a placeholder)
    if (imageUrl && !imageUrl.includes('placeholder')) {
      const imagePath = path.join(__dirname, '../../Frontend', imageUrl);
      fs.unlink(imagePath, (err) => {
        if (err && err.code !== 'ENOENT') {
          console.error('Error deleting image file:', err);
        }
      });
    }
    res.json({ message: 'Story deleted.', deleted: result.rows[0] });
  } catch (err) {
    console.error('Error deleting story:', err);
    res.status(500).json({ error: 'Server error deleting story.' });
  }
});

// --- Packages Section (with Calendly URL) ---

// Create a new package
router.post('/create-package', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { packageTitle, price, sessionNumber, description, features, calendlyUrl, isMemberPriced } = req.body;
    const cleanedTitle = typeof packageTitle === 'string' ? packageTitle.trim() : '';
    if (!cleanedTitle) {
      return res.status(400).json({ error: 'Package must include a title.' });
    }

    const rawPrice = price === undefined || price === null ? '' : String(price).trim();
    const parsedPrice = rawPrice ? Number(rawPrice.replace(/[^0-9.\-]/g, '')) : NaN;
    if (!Number.isFinite(parsedPrice)) {
      return res.status(400).json({ error: 'Price must be a valid number (e.g. 49.99).' });
    }

    const rawSessions = sessionNumber === undefined || sessionNumber === null ? '' : String(sessionNumber).trim();
    const parsedSessions = rawSessions ? parseInt(rawSessions, 10) : NaN;
    if (!Number.isInteger(parsedSessions) || parsedSessions <= 0) {
      return res.status(400).json({ error: 'Number of sessions must be a positive integer.' });
    }

    const cleanedDescription = typeof description === 'string' ? description.trim() : '';
    if (!cleanedDescription) {
      return res.status(400).json({ error: 'Package must include a description.' });
    }
    const cleanedFeatures = Array.isArray(features)
      ? features.map(f => f.trim()).filter(f => f !== '')
      : [];
    if (cleanedFeatures.length === 0) {
      return res.status(400).json({ error: 'Package must include at least one feature.' });
    }
    const result = await pool.query(
      `INSERT INTO packages (name, price, description, features, sessions_included, calendly_url, is_member_priced)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [cleanedTitle, parsedPrice, cleanedDescription, cleanedFeatures, parsedSessions, calendlyUrl, !!isMemberPriced]
    );
    res.status(201).json({ message: 'Package created', package: result.rows[0] });
  } catch (err) {
    console.error('Error creating package:', err);
    res.status(500).json({ error: 'Server error creating package' });
  }
});

// Update an existing package by ID
router.put('/update-package/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { packageTitle, sessionNumber, price, description, features, calendlyUrl, isMemberPriced } = req.body;
  const cleanedTitle = typeof packageTitle === 'string' ? packageTitle.trim() : '';
  if (!cleanedTitle) {
    return res.status(400).json({ error: 'Package must include a title.' });
  }

  const rawPrice = price === undefined || price === null ? '' : String(price).trim();
  const parsedPrice = rawPrice ? Number(rawPrice.replace(/[^0-9.\-]/g, '')) : NaN;
  if (!Number.isFinite(parsedPrice)) {
    return res.status(400).json({ error: 'Price must be a valid number (e.g. 49.99).' });
  }

  const rawSessions = sessionNumber === undefined || sessionNumber === null ? '' : String(sessionNumber).trim();
  const parsedSessions = rawSessions ? parseInt(rawSessions, 10) : NaN;
  if (!Number.isInteger(parsedSessions) || parsedSessions <= 0) {
    return res.status(400).json({ error: 'Number of sessions must be a positive integer.' });
  }

  const cleanedDescription = typeof description === 'string' ? description.trim() : '';
  const cleanedFeatures = Array.isArray(features)
    ? features.map(f => f.trim()).filter(f => f !== '')
    : [];
  if (!cleanedDescription) {
    return res.status(400).json({ error: 'Package must include a description.' });
  }
  if (cleanedFeatures.length === 0) {
    return res.status(400).json({ error: 'Package must include at least one feature.' });
  }
  try {
    const result = await pool.query(
      `UPDATE packages
       SET name = $1,
           sessions_included = $2,
           price = $3,
           description = $4,
           features = $5,
           calendly_url = $6,
           is_member_priced = $7
       WHERE id = $8
       RETURNING *`,
      [cleanedTitle, parsedSessions, parsedPrice, cleanedDescription, cleanedFeatures, calendlyUrl, !!isMemberPriced, id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Package not found.' });
    }
    res.json({ message: 'Package updated successfully.', package: result.rows[0] });
  } catch (err) {
    console.error('Error updating package:', err);
    res.status(500).json({ error: 'Failed to update package.' });
  }
});

// Delete a package by ID
router.delete('/delete-package/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    // Default behavior: archive (soft delete).
    // If you truly want to hard delete, call: DELETE /admin/delete-package/:id?hard=true
    const hardDelete = String(req.query.hard || '').toLowerCase() === 'true';

    // If a package was ever purchased/used, deleting it either:
    // - fails (FK constraint), or
    // - breaks receipts/dashboards (inner joins).
    // So we block deletion when it's in use.
    const depsRes = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM package_usage WHERE package_id = $1) AS usage_count,
         (SELECT COUNT(*)::int FROM orders WHERE package_id = $1) AS orders_count,
         (SELECT COUNT(*)::int FROM booking WHERE package_id = $1) AS booking_count,
         (SELECT COUNT(*)::int FROM timeslots WHERE package_id = $1) AS timeslots_count`,
      [id]
    );

    const deps = depsRes.rows[0] || {};
    const inUse = [deps.usage_count, deps.orders_count, deps.booking_count, deps.timeslots_count]
      .some(n => Number(n) > 0);

    // Archive: always allowed (even if in use)
    if (!hardDelete) {
      // Fetch impacted assignments (sessions remaining) so admins get a heads-up.
      // NOTE: This is best-effort; archiving should still succeed even if this query/email fails.
      let packageInfo = null;
      let impacted = [];
      try {
        const pkgRes = await pool.query('SELECT id, name FROM packages WHERE id = $1', [id]);
        packageInfo = pkgRes.rows[0] || { id, name: '(unknown package)' };

        const impactedRes = await pool.query(
          `SELECT
             pu.customer_id,
             pu.athlete_id,
             pu.sessions_remaining,
             COALESCE(
               NULLIF(TRIM(concat_ws(' ', a.first_name, a.last_name)), ''),
               '(unknown athlete)'
             ) AS athlete_name,
             COALESCE(
               NULLIF(TRIM(concat_ws(' ', u.first_name, u.last_name)), ''),
               NULLIF(TRIM(concat_ws(' ', c.first_name, c.last_name)), ''),
               '(unknown customer)'
             ) AS customer_name,
             COALESCE(NULLIF(TRIM(u.email), ''), NULL) AS customer_email
           FROM package_usage pu
           LEFT JOIN athlete a ON pu.athlete_id = a.id
           LEFT JOIN customer c ON pu.customer_id = c.id
           LEFT JOIN users u ON c.user_id = u.id
           WHERE pu.package_id = $1 AND pu.sessions_remaining > 0
           ORDER BY pu.sessions_remaining DESC, customer_name ASC, athlete_name ASC`,
          [id]
        );
        impacted = impactedRes.rows || [];
      } catch (notifyPrepErr) {
        console.warn('Archive notification pre-query failed:', notifyPrepErr);
      }

      let result;
      try {
        result = await pool.query(
          'UPDATE packages SET is_active = false WHERE id = $1 RETURNING id, name, is_active',
          [id]
        );
      } catch (err) {
        // If DB wasn't migrated yet
        if (err && err.code === '42703') {
          return res.status(500).json({
            error: 'Archiving is not available because packages.is_active does not exist in this database.',
            suggestion: 'Run: ALTER TABLE public.packages ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;'
          });
        }
        throw err;
      }
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Package not found' });
      }

      // Notify admins (best-effort; do not block response).
      try {
        const recipients = await getAdminRecipientsFromDb();
        const totalImpacted = impacted.length;
        const totalSessionsRemaining = impacted.reduce(
          (sum, row) => sum + (Number(row.sessions_remaining) || 0),
          0
        );

        // Only notify admins if someone is actually affected.
        if (recipients.length > 0 && totalImpacted > 0 && totalSessionsRemaining > 0) {
          const rowsHtml = impacted
            .map(r => {
              const safeCustomer = String(r.customer_name || '').replace(/[<>]/g, '');
              const safeAthlete = String(r.athlete_name || '').replace(/[<>]/g, '');
              const safeEmail = String(r.customer_email || '').replace(/[<>]/g, '');
              const safeSessions = Number(r.sessions_remaining) || 0;
              return `
                <tr>
                  <td style="padding:6px 8px;border-bottom:1px solid #eee;">${safeCustomer}</td>
                  <td style="padding:6px 8px;border-bottom:1px solid #eee;">${safeEmail || '—'}</td>
                  <td style="padding:6px 8px;border-bottom:1px solid #eee;">${safeAthlete}</td>
                  <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${safeSessions}</td>
                </tr>`;
            })
            .join('');

          const pkgName = (packageInfo && packageInfo.name) ? packageInfo.name : '(unknown package)';
          const subject = `Package archived: ${pkgName} (ID ${id})`;
          const archivedAt = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });

          const html = `
            <div style="font-family:Arial,sans-serif;color:#222;line-height:1.5;max-width:720px;">
              <h2 style="margin:0 0 10px;">Package Archived (Admin Notice)</h2>
              <p style="margin:0 0 12px;">
                The package <b>${pkgName}</b> (ID <b>${id}</b>) was archived on <b>${archivedAt}</b>.
                This will hide it from the public packages list, but existing entitlements may still be active.
              </p>
              <p style="margin:0 0 12px;">
                <b>Impacted assignments with sessions remaining:</b> ${totalImpacted} &nbsp;|&nbsp;
                <b>Total sessions remaining:</b> ${totalSessionsRemaining}
              </p>

              <table style="border-collapse:collapse;width:100%;font-size:14px;">
                <thead>
                  <tr>
                    <th align="left" style="padding:6px 8px;border-bottom:2px solid #ddd;">Customer</th>
                    <th align="left" style="padding:6px 8px;border-bottom:2px solid #ddd;">Customer Email</th>
                    <th align="left" style="padding:6px 8px;border-bottom:2px solid #ddd;">Athlete</th>
                    <th align="right" style="padding:6px 8px;border-bottom:2px solid #ddd;">Sessions Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  ${rowsHtml}
                </tbody>
              </table>

              <p style="margin:14px 0 0;">
                <b>Reminder:</b> If anyone still has sessions remaining, be aware they can still book/use them.
              </p>
            </div>`;

          await sendEmail(recipients, subject, html);
        }
      } catch (notifyErr) {
        console.warn('Admin archive notification failed:', notifyErr);
      }

      return res.json({ message: 'Package archived', package: result.rows[0] });
    }

    // Hard delete: only allowed if not in use
    if (inUse) {
      return res.status(409).json({
        error: 'Package is in use and cannot be hard-deleted.',
        details: {
          usage: deps.usage_count || 0,
          orders: deps.orders_count || 0,
          bookings: deps.booking_count || 0,
          timeslots: deps.timeslots_count || 0
        },
        suggestion: 'Archive/disable the package instead.'
      });
    }

    const result = await pool.query('DELETE FROM packages WHERE id = $1 RETURNING id, name', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Package not found' });
    }
    res.json({ message: 'Package deleted', deletedPackage: result.rows[0] });
  } catch (err) {
    console.error('Error deleting package:', err);
    // FK violation (if constraints exist)
    if (err && err.code === '23503') {
      return res.status(409).json({
        error: 'Package is referenced by other records and cannot be hard-deleted.',
        suggestion: 'Archive/disable the package instead.'
      });
    }
    res.status(500).json({ error: 'Server error deleting package' });
  }
});

// Get all packages (with Calendly URL)
router.get(
  '/get-packages',
  (req, res, next) => {
    const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true';
    if (!includeInactive) return next();
    return authenticateToken(req, res, () => requireRole('admin')(req, res, next));
  },
  async (req, res) => {
  try {
    const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true';
    let result;
    try {
      result = await pool.query(`
        SELECT 
          id,
          name AS package_title,
          sessions_included AS session_number,
          price,
          description,
          features,
          calendly_url,
          is_member_priced,
          is_active
        FROM packages
        WHERE ($1::boolean = true) OR (is_active = true)
      `, [includeInactive]);
    } catch (err) {
      // Local DB may not have been migrated yet
      if (err && err.code === '42703') {
        result = await pool.query(`
          SELECT 
            id,
            name AS package_title,
            sessions_included AS session_number,
            price,
            description,
            features,
            calendly_url,
            is_member_priced
          FROM packages
        `);
      } else {
        throw err;
      }
    }
    const packages = result.rows.map(pkg => ({
      id: pkg.id,
      title: pkg.package_title,
      sessions: pkg.session_number,
      price: pkg.price,
      description: typeof pkg.description === 'string' ? pkg.description : '',
      features: Array.isArray(pkg.features) ? pkg.features : [],
      calendlyUrl: pkg.calendly_url || '',
      is_member_priced: pkg.is_member_priced,
      is_active: pkg.is_active
    }));
    res.json(packages);
  } catch (error) {
    console.error('Error fetching packages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Everything below this point is admin-only.
router.use(authenticateToken, requireRole('admin'));

// Get all packages (simple list)
router.get('/all-packages', async (req, res) => {
  try {
    const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true';
    let result;
    try {
      result = await pool.query(
        `SELECT id, name
         FROM packages
         WHERE ($1::boolean = true) OR (is_active = true)
         ORDER BY name`,
        [includeInactive]
      );
    } catch (err) {
      if (err && err.code === '42703') {
        result = await pool.query('SELECT id, name FROM packages ORDER BY name');
      } else {
        throw err;
      }
    }
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load packages' });
  }
});

// --- Coach Management Section ---

// Gets coaches that have registered 
router.get('/pending-coaches', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id AS user_id,
        u.first_name,
        u.last_name,
        u.email
      FROM users u
      LEFT JOIN coaches c ON u.id = c.user_id
      WHERE u.role = 'coach' AND c.user_id IS NULL;
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching pending coaches:', err);
    res.status(500).json({ error: 'Failed to load coaches' });
  }
});

// Post coaches as approved to login
router.post('/approve-coach', async (req, res) => {
  const { coachId, coachCode } = req.body;
  try {
    // Get user details from users table
    const userResult = await pool.query(
      `SELECT first_name, last_name, email FROM users WHERE id = $1 AND role = 'coach'`,
      [coachId]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Coach user not found.' });
    }
    const { first_name, last_name, email: userEmail } = userResult.rows[0];
    // Insert into coaches table
    await pool.query(
      `INSERT INTO coaches (user_id, coach_id, first_name, last_name, email)
       VALUES ($1, $2, $3, $4, $5)`,
      [coachId, coachCode, first_name, last_name, userEmail]
    );
    await sendCoachIdEmail(userEmail, coachCode);
    res.status(200).json({ message: 'Coach approved and ID sent' });
  } catch (err) {
    console.error('Error approving coach:', err);
    res.status(500).json({ error: 'Approval failed' });
  }
});

// Get approved coaches
router.get('/approved-coaches', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, first_name, last_name, email, coach_id
      FROM coaches
      WHERE coach_id IS NOT NULL
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching approved coaches:', err);
    res.status(500).json({ error: 'Failed to fetch approved coaches' });
  }
});

// Fires coach and removes from database
router.delete('/fire-coach/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(`
      DELETE FROM coach_packages WHERE coach_id = $1;
      DELETE FROM coaches WHERE id = $1;
    `, [id]);
    res.status(200).json({ message: 'Coach and related data deleted successfully' });
  } catch (err) {
    console.error('Error firing coach:', err);
    res.status(500).json({ error: 'Failed to delete coach' });
  }
});

// --- Assign Coaches to Packages Section ---

// Get all coaches
router.get('/coaches', async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, first_name || ' ' || last_name AS name, specialization FROM coaches`);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching coaches:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Assign coach to package
router.post('/coach-packages', async (req, res) => {
  const { coachId, packageId } = req.body;
  try {
    await pool.query(
      `INSERT INTO coach_packages (coach_id, packages_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [coachId, packageId]
    );
    res.sendStatus(200);
  } catch (err) {
    console.error('Error assigning package:', err);
    res.status(500).send('Server error');
  }
});

// Get packages assigned to a coach
router.get('/coach-packages/:coachId', async (req, res) => {
  const { coachId } = req.params;
  try {
    const result = await pool.query(
      `SELECT p.id, p.name
       FROM packages p
       JOIN coach_packages cp ON cp.packages_id = p.id
       WHERE cp.coach_id = $1`,
      [coachId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching coach packages:', err);
    res.status(500).send('Server error');
  }
});

// Remove coach from package
router.delete('/coach-packages', async (req, res) => {
  const { coachId, packageId } = req.body;
  try {
    await pool.query(
      'DELETE FROM coach_packages WHERE coach_id = $1 AND packages_id = $2',
      [coachId, packageId]
    );
    res.sendStatus(200);
  } catch (err) {
    console.error('Error removing coach package:', err);
    res.status(500).send('Server error');
  }
});

// --- Helper for sending coach email ---
async function sendCoachIdEmail(email, code) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'robinsontech30@gmail.com',
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });
  const mailOptions = {
    from: '"ZSP Admin" <robinsontech30@gmail.com>',
    to: email,
    subject: 'Your ZSP Coach Login ID',
    text: `You have been approved as a coach.\nYour login Coach ID is: ${code}`
  };
  await transporter.sendMail(mailOptions);
}

// --- Helper for Supabase image upload ---
async function uploadImageToSupabase(fileBuffer, fileName, mimeType) {
  if (!supabase) {
    throw new Error('Supabase client not initialized');
  }
  const { data, error } = await supabase.storage
    .from('stories')
    .upload(fileName, fileBuffer, { contentType: mimeType, upsert: true });
  if (error) throw error;
  const { publicUrl } = supabase.storage.from('stories').getPublicUrl(fileName).data;
  return publicUrl;
}

// Get all athlete package usage
router.get('/athlete-packages', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        pu.id AS usage_id,
        a.first_name || ' ' || a.last_name AS athlete_name,
        a.age_group,
        a.sport,
        COALESCE(p.name, '(deleted package)') AS package_name,
        CASE
          WHEN p.id IS NULL THEN '(deleted package) [ID ' || pu.package_id::text || ']'
          ELSE p.name
        END AS package_display_name,
        pu.sessions_remaining,
        pu.sessions_purchased,
        pu.athlete_id,
        pu.package_id,
        c.dob,
        EXTRACT(YEAR FROM age(c.dob)) AS age
      FROM package_usage pu
      JOIN athlete a ON pu.athlete_id = a.id
      LEFT JOIN packages p ON pu.package_id = p.id
      JOIN customer c ON a.customer_id = c.id
      ORDER BY (CASE WHEN p.id IS NULL THEN '(deleted package)' ELSE p.name END), athlete_name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching athlete packages:', err);
    res.status(500).json({ error: 'Failed to load athlete packages' });
  }
});

// Update (subtract sessions or delete when zero)
router.put('/athlete-packages/:id', async (req, res) => {
  const { id } = req.params;
  const { subtract } = req.body;
  try {
    const result = await pool.query(`
      UPDATE package_usage
      SET sessions_remaining = GREATEST(sessions_remaining - $1, 0)
      WHERE id = $2
      RETURNING *
    `, [subtract, id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating athlete package:', err);
    res.status(500).json({ error: 'Failed to update athlete package' });
  }
});

// Get all active users
router.get('/active-users', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id,
        c.id AS customer_id,  -- add this line
        u.first_name || ' ' || u.last_name AS full_name,
        u.role,
        u.email,
        c.phone,
        c.is_member
      FROM users u
      LEFT JOIN customer c ON u.id = c.user_id
      ORDER BY u.first_name, u.last_name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching active users:', err);
    res.status(500).json({ error: 'Failed to load active users' });
  }
});

// Get booking transactions with customer + payment details
router.get('/transactions', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        o.id AS order_id,
        c.first_name || ' ' || c.last_name AS customer_name,
        c.email,
        c.phone,
        p.transaction_id,
        o.receipt_code AS friendly_id,
        o.order_date
      FROM orders o
      JOIN customer c ON o.customer_id = c.id
      JOIN payments p ON p.order_id = o.id
      ORDER BY o.order_date DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching transactions:', err);
    res.status(500).json({ error: 'Failed to load transactions' });
  }
});

router.put('/toggle-member/:userId', async (req, res) => {
  const { userId } = req.params;
  const { hasMemberPricing } = req.body;
  try {
    const result = await pool.query(
      `UPDATE customer SET has_member_pricing = $1 WHERE user_id = $2 RETURNING *`,
      [!!hasMemberPricing, userId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error toggling member pricing:', err);
    res.status(500).json({ error: 'Failed to toggle member pricing' });
  }
});

// Update customer membership status
router.put('/customer/:id/membership', authenticateToken, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { isMember } = req.body;

  try {
    const result = await pool.query(
      `UPDATE customer SET is_member = $1 WHERE id = $2 RETURNING *`,
      [isMember, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating customer membership:', err);
    res.status(500).json({ error: 'Failed to update membership' });
  }
});


module.exports = router;


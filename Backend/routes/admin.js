const express = require('express');
const router = express.Router();
const pool = require('../db');
const nodemailer = require('nodemailer'); 
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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
router.post('/add-story', upload.single('athleteImage'), async (req, res) => {
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

router.put('/update-story/:id', upload.single('athleteImage'), async (req, res) => {
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

// Delete a success story by ID
router.delete('/delete-story/:id', async (req, res) => {
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
router.post('/create-package', async (req, res) => {
  try {
    const { packageTitle, price, sessionNumber, description, features, calendlyUrl } = req.body;
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
      `INSERT INTO packages (name, price, description, features, sessions_included, calendly_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [packageTitle, price, cleanedDescription, cleanedFeatures, sessionNumber, calendlyUrl]
    );
    res.status(201).json({ message: 'Package created', package: result.rows[0] });
  } catch (err) {
    console.error('Error creating package:', err);
    res.status(500).json({ error: 'Server error creating package' });
  }
});

// Update an existing package by ID
router.put('/update-package/:id', async (req, res) => {
  const { id } = req.params;
  const { packageTitle, sessionNumber, price, description, features, calendlyUrl } = req.body;
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
           calendly_url = $6
       WHERE id = $7
       RETURNING *`,
      [packageTitle, sessionNumber, price, cleanedDescription, cleanedFeatures, calendlyUrl, id]
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
router.delete('/delete-package/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM packages WHERE id = $1 RETURNING *', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Package not found' });
    }
    res.json({ message: 'Package deleted', deletedPackage: result.rows[0] });
  } catch (err) {
    console.error('Error deleting package:', err);
    res.status(500).json({ error: 'Server error deleting package' });
  }
});

// Get all packages (with Calendly URL)
router.get('/get-packages', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        name AS package_title,
        sessions_included AS session_number,
        price,
        description,
        features,
        calendly_url
      FROM packages
    `);
    const packages = result.rows.map(pkg => ({
      id: pkg.id,
      title: pkg.package_title,
      sessions: pkg.session_number,
      price: pkg.price,
      description: typeof pkg.description === 'string' ? pkg.description : '',
      features: Array.isArray(pkg.features) ? pkg.features : [],
      calendlyUrl: pkg.calendly_url || ''
    }));
    res.json(packages);
  } catch (error) {
    console.error('Error fetching packages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all packages (simple list)
router.get('/all-packages', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name FROM packages ORDER BY name');
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
  const { coachId, email, coachCode } = req.body;
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
    await sendCoachIdEmail(email, coachCode);
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
        p.name AS package_name,
        pu.sessions_remaining,
        pu.sessions_purchased,
        pu.athlete_id,
        pu.package_id
      FROM package_usage pu
      JOIN athlete a ON pu.athlete_id = a.id
      JOIN packages p ON pu.package_id = p.id
      ORDER BY p.name, athlete_name
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
        u.first_name || ' ' || u.last_name AS full_name,
        u.role,
        u.email,
        c.phone,
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

module.exports = router;


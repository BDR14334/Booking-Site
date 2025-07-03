const express = require('express');
const router = express.Router();
const pool = require('../db');
const nodemailer = require('nodemailer'); 
const multer = require('multer');
const path = require('path');
const fs = require('fs');

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

  const imageUrl = `/img/stories/${imageFile.filename}`;

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

// Upades success story already in database
router.put('/update-story/:id', upload.single('athleteImage'), async (req, res) => {
  const { id } = req.params;
  const { athleteName, storyText } = req.body;
  const imageFile = req.file;

  try {
    const existing = await pool.query('SELECT * FROM success_stories WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Story not found' });
    }

    const imageUrl = imageFile
      ? `/img/stories/${imageFile.filename}`
      : existing.rows[0].image_url;

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


//Packages Choices
// Create a new package
router.post('/create-package', async (req, res) => {
  try {
    const { packageTitle, price, sessionNumber, description } = req.body;

    const cleanedDescription = Array.isArray(description)
      ? description.map(d => d.trim()).filter(d => d !== '')
      : [];

    if (cleanedDescription.length === 0) {
      return res.status(400).json({ error: 'Package must include at least one description item.' });
    }

    const result = await pool.query(
      `INSERT INTO packages (name, price, description, sessions_included)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [packageTitle, price, cleanedDescription, sessionNumber]
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
    const { packageTitle, sessionNumber, price, description } = req.body;
  
    const cleanedDescription = Array.isArray(description)
      ? description.map(d => d.trim()).filter(d => d !== '')
      : [];
  
    if (cleanedDescription.length === 0) {
      return res.status(400).json({ error: 'Package must include at least one description item.' });
    }
  
    try {
      const result = await pool.query(
        `UPDATE packages
         SET name = $1,
             sessions_included = $2,
             price = $3,
             description = $4
         WHERE id = $5
         RETURNING *`,
        [packageTitle, sessionNumber, price, cleanedDescription, id]
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

// Get all packages
router.get('/get-packages', async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT 
          id,
          name AS package_title,
          sessions_included AS session_number,
          price,
          description  -- already a TEXT[] array
        FROM packages
      `);
  
      const packages = result.rows.map(pkg => ({
        id: pkg.id,
        title: pkg.package_title,
        sessions: pkg.session_number,
        price: pkg.price,
        description: Array.isArray(pkg.description)
          ? pkg.description.map(d => d.trim()).filter(d => d !== '')
          : []
      }));
  
      res.json(packages);
    } catch (error) {
      console.error('Error fetching packages:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
});

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
      DELETE FROM timeslots WHERE user_id = $1;
      DELETE FROM coaches WHERE id = $1;
    `, [id]);

    res.status(200).json({ message: 'Coach and related data deleted successfully' });
  } catch (err) {
    console.error('Error firing coach:', err);
    res.status(500).json({ error: 'Failed to delete coach' });
  }
});


//Connect Packages to Coaches
// Get coaches
router.get('/coaches', async (req, res) => {
    try {
      const result = await pool.query(`SELECT id, first_name || ' ' || last_name AS name, specialization FROM coaches`);
      res.json(result.rows);
    } catch (err) {
      console.error('Error fetching coaches:', err);
      res.status(500).json({ error: 'Server error' });
    }
});

// Post coach to packages
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

// Gets coaches that are assigned to packages
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

// Detes the assignment of coach to package
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

// Gets coach by ID
router.get('/:coachId', async (req, res) => {
  const { coachId } = req.params;
  const { packageId } = req.query;

  try {
    const query = packageId
      ? `SELECT * FROM timeslots WHERE user_id = $1 AND package_id = $2`
      : `SELECT * FROM timeslots WHERE user_id = $1 AND package_id IS NULL`;
    const values = packageId ? [coachId, packageId] : [coachId];
    const { rows } = await pool.query(query, values);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// function to send coach email with login ID for security
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
  
module.exports = router;


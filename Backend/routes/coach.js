// Import Express and create a router instance
const express = require('express');
const pool = require('../db'); // Import PostgreSQL connection pool
const router = express.Router(); // Creates a new router instance
const { v4: uuidv4 } = require('uuid');

// ---------------------- Create a new coach ----------------------
router.post('/create', async (req, res) => {
  const { first_name, last_name, specialization, email, phone, user_id } = req.body;

  try {
    // Check if the provided user ID exists in the users table
    const userRes = await pool.query('SELECT id FROM public.users WHERE id = $1', [user_id]);
    if (userRes.rows.length === 0) {
      return res.status(400).json({ error: 'User not found' });
    }

    // Insert new coach details into the coaches table
    const newCoach = await pool.query(
      `INSERT INTO public.coaches (first_name, last_name, specialization, email, phone, user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [first_name, last_name, specialization, email, phone, user_id]
    );

    // Return the created coach
    res.status(201).json({ message: 'Coach created successfully', coach: newCoach.rows[0] });
  } catch (err) {
    console.error('Error creating coach:', err.message);
    res.status(500).json({ error: 'Error creating coach' });
  }
});

// ---------------------- Update an existing coach ----------------------
router.put('/update/:id', async (req, res) => {
  const { id } = req.params;
  const { first_name, last_name, specialization, email, phone, user_id } = req.body;

  try {
    // Check if the user ID exists
    const userRes = await pool.query('SELECT id FROM public.users WHERE id = $1', [user_id]);
    if (userRes.rows.length === 0) {
      return res.status(400).json({ error: 'User not found' });
    }

    // Update coach information
    const result = await pool.query(
      `UPDATE public.coaches
       SET first_name = $1,
           last_name = $2,
           specialization = $3,
           email = $4,
           phone = $5,
           user_id = $6
       WHERE id = $7
       RETURNING *`,
      [first_name, last_name, specialization, email, phone, user_id, id]
    );

    // Return updated coach or 404 if not found
    if (result.rows.length > 0) {
      res.status(200).json({ message: 'Coach updated successfully', coach: result.rows[0] });
    } else {
      res.status(404).json({ error: 'Coach not found' });
    }
  } catch (err) {
    console.error('Error updating coach:', err.message);
    res.status(500).json({ error: 'Error updating coach' });
  }
});

// ---------------------- Get coach by user ID ----------------------
router.get('/by-user/:user_id', async (req, res) => {
  const { user_id } = req.params;

  try {
    // Retrieve the coach linked to the given user ID
    const result = await pool.query(
      `SELECT * FROM public.coaches WHERE user_id = $1 LIMIT 1`,
      [user_id]
    );

    // Return coach data or 404 if not found
    if (result.rows.length > 0) {
      res.status(200).json(result.rows[0]);
    } else {
      res.status(404).json({ error: 'Coach not found' });
    }
  } catch (err) {
    console.error('Error fetching coach:', err.message);
    res.status(500).json({ error: 'Error fetching coach data' });
  }
});

// ---------------------- Get all timeslots for a coach ----------------------
router.get('/timeslots/:user_id', async (req, res) => {
  const user_id = req.params.user_id;

  try {
    // Get all timeslots for the given user (coach), ordered by date and time
    const result = await pool.query(
      `SELECT * FROM public.timeslots WHERE user_id = $1 ORDER BY date, start_time`,
      [user_id]
    );

    res.status(200).json({ timeslots: result.rows });
  } catch (err) {
    console.error('Error fetching timeslots:', err.message);
    res.status(500).json({ error: 'Error fetching timeslots' });
  }
});

// routes/coach.js
// GET /coach/assigned-timeslots/:userId
router.get('/assigned-timeslots/:userId', async (req, res) => {
  const { userId } = req.params;

  if (!userId || isNaN(userId)) {
    return res.status(400).json({ error: 'Invalid userId' });
  }

  try {
    const assignedQuery = `
      SELECT t.*, p.name AS package_name, ta.coach_user_id, ta.status AS assignment_status
      FROM timeslots t
      INNER JOIN timeslot_assignments ta ON t.id = ta.timeslot_id
      LEFT JOIN packages p ON t.package_id = p.id
      WHERE ta.coach_user_id = $1 AND ta.status IN ('assigned', 'pending')
    `;

    const unassignedQuery = `
      SELECT t.*, p.name AS package_name, NULL AS coach_user_id, NULL AS assignment_status
      FROM timeslots t
      LEFT JOIN packages p ON t.package_id = p.id
      WHERE NOT EXISTS (
        SELECT 1 FROM timeslot_assignments ta
        WHERE ta.timeslot_id = t.id AND ta.status IN ('assigned', 'pending')
      )
    `;

    const [assignedResult, unassignedResult] = await Promise.all([
      pool.query(assignedQuery, [userId]),
      pool.query(unassignedQuery)
    ]);

    const allRelevantTimeslots = [...assignedResult.rows, ...unassignedResult.rows];
    res.json(allRelevantTimeslots);
  } catch (err) {
    console.error('Error loading assigned/unassigned timeslots:', err.message, err.stack);
    res.status(500).json({ error: 'Failed to load assigned timeslots.' });
  }
});


// PUT /coach/request-time-off
router.put('/request-time-off', async (req, res) => {
  const { timeslot_id, coach_user_id } = req.body;

  try {
    // Get the slot's datetime
    const slotRes = await pool.query(
      `SELECT date, start_time FROM timeslots WHERE id = $1`, 
      [timeslot_id]
    );
    const slot = slotRes.rows[0];
    const slotDateTime = new Date(`${slot.date}T${slot.start_time}`);
    const now = new Date();

    if ((slotDateTime - now) < 24 * 60 * 60 * 1000) {
      return res.status(400).json({ error: 'Must request time off at least 24 hours in advance.' });
    }

    const result = await pool.query(
      `UPDATE timeslot_assignments
       SET status = 'pending', requested_at = NOW()
       WHERE timeslot_id = $1 AND coach_user_id = $2 AND status = 'assigned'`,
      [timeslot_id, coach_user_id]
    );

    if (result.rowCount === 0) {
      return res.status(400).json({ error: 'No active assignment found or request already made.' });
    }

    res.status(200).json({ message: 'Time off request submitted.' });
  } catch (err) {
    console.error('Error requesting time off:', err.message);
    res.status(500).json({ error: 'Server error submitting time off request.' });
  }
});



// Export the router to be used in app.js
module.exports = router;



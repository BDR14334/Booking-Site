// Import Express and create a router instance
const express = require('express');
const pool = require('../db'); // Import PostgreSQL connection pool
const router = express.Router(); // Creates a new router instance
// const { v4: uuidv4 } = require('uuid');

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

// ---------------------- Create a timeslot ----------------------
router.post('/create-timeslot', async (req, res) => {
  const { date, start_time, end_time, user_id, exclusive_booking = false, capacity = 1 } = req.body;

  const max_capacity = capacity;
  
  console.log('Request body:', req.body); // Debug log for request data

  try {
    // Check for an exact existing timeslot
    const existingSlot = await pool.query(
      `SELECT * FROM public.timeslots
       WHERE user_id = $1 AND date = $2 AND start_time = $3 AND end_time = $4`,
      [user_id, date, start_time, end_time]
    );

    if (existingSlot.rows.length > 0) {
      // Timeslot already exists; return it
      return res.status(200).json({
        message: 'Timeslot already exists.',
        timeslot: existingSlot.rows[0]
      });
    } else {
      // Check for overlapping timeslots
      const conflict = await pool.query(
        `SELECT * FROM public.timeslots
         WHERE user_id = $1 AND date = $2 AND (start_time, end_time) OVERLAPS ($3::time, $4::time)`,
        [user_id, date, start_time, end_time]
      );

      if (conflict.rows.length > 0) {
        return res.status(400).json({ error: 'A conflicting timeslot already exists.' });
      }

      // Insert the new timeslot
      const inserted = await pool.query(
        `INSERT INTO public.timeslots (date, start_time, end_time, user_id, exclusive_booking, max_capacity)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [date, start_time, end_time, user_id, exclusive_booking, max_capacity]
      );

      return res.status(201).json({
        message: 'Timeslot created successfully.',
        timeslot: inserted.rows[0]
      });
    }
  } catch (err) {
    console.error('Error creating/deleting timeslot:', err);
    res.status(500).json({ error: 'Server error' });
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


// Delete a single timeslot
router.delete('/delete-timeslot/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Delete the timeslot by its ID
    const result = await pool.query(
      'DELETE FROM public.timeslots WHERE id = $1 RETURNING *',
      [id]
    );

    // If no row was deleted, timeslot not found
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Timeslot not found' });
    }

    res.status(200).json({ message: 'Timeslot deleted successfully' });
  } catch (err) {
    console.error('Error deleting timeslot:', err.message);
    res.status(500).json({ error: 'Error deleting timeslot' });
  }
});




// Export the router to be used in app.js
module.exports = router;



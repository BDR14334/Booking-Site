// Import Express and create a router instance
const express = require('express');
const pool = require('../db'); // Import PostgreSQL connection pool
const router = express.Router(); // Creates a new router instance
const { v4: uuidv4 } = require('uuid');

// ---------------------- Create a timeslot ----------------------
router.post('/create-timeslot', async (req, res) => {
    const {
        date,
        start_time,
        end_time,
        user_id,
        exclusive_booking = false,
        capacity = 1,
        recurrence_type = null,   // 'daily', 'weekly', 'monthly', or null
        recurrence_count = 1,      // e.g., 5 daily repeats
        package_id 
    } = req.body;

    const recurrence_id = recurrence_type ? uuidv4() : null;

    try {
        const createdSlots = [];

        for (let i = 0; i < recurrence_count; i++) {
        let newDate = new Date(date);
        if (recurrence_type === 'daily') newDate.setDate(newDate.getDate() + i);
        if (recurrence_type === 'weekly') newDate.setDate(newDate.getDate() + i * 7);
        if (recurrence_type === 'monthly') newDate.setMonth(newDate.getMonth() + i);

        const formattedDate = newDate.toISOString().split('T')[0]; // 'YYYY-MM-DD'

        const conflict = await pool.query(
            `SELECT * FROM public.timeslots
            WHERE user_id = $1 AND date = $2 AND (start_time, end_time) OVERLAPS ($3::time, $4::time)`,
            [user_id, formattedDate, start_time, end_time]
        );

        if (conflict.rows.length > 0) continue; // skip conflicting slots

        const result = await pool.query(
            `INSERT INTO public.timeslots (date, start_time, end_time, user_id, exclusive_booking, max_capacity, recurrence_id, recurrence_type, package_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *`,
            [formattedDate, start_time, end_time, user_id, exclusive_booking, capacity, recurrence_id, recurrence_type, package_id]
        );

        createdSlots.push(result.rows[0]);
        }

        res.status(201).json({
        message: 'Timeslots created successfully.',
        timeslots: createdSlots
        });
    } catch (err) {
        console.error('Error creating recurring timeslots:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/by-package/:packageId', async (req, res) => {
    const { packageId } = req.params;
  
    if (!packageId) {
      return res.status(400).json({ error: 'Package ID is required' });
    }
  
    try {
      const queryText = `
        SELECT id, package_id, date, start_time, end_time, max_capacity, recurrence_id
        FROM timeslots
        WHERE package_id = $1
        ORDER BY date, start_time
      `;
      const { rows } = await pool.query(queryText, [packageId]);
  
      return res.json({ timeslots: rows });
    } catch (err) {
      console.error('Error fetching timeslots by package:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
});

// ---------------------- Get all timeslots for a package ----------------------
router.get('/timeslots/:package_id', async (req, res) => {
    const package_id = req.params.package_id;
  
    try {
      const result = await pool.query(
        `SELECT * FROM public.timeslots WHERE package_id = $1 ORDER BY date, start_time`,
        [package_id]
      );
  
      res.status(200).json({timeslots: result.rows});  // <-- return array directly
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

// DELETE all future timeslots in a recurrence group
router.delete('/delete-future-timeslots/:recurrence_id/:from_date', async (req, res) => {
    const { recurrence_id, from_date } = req.params;

    try {
        const result = await pool.query(
            `DELETE FROM public.timeslots
             WHERE recurrence_id = $1 AND date >= $2
             RETURNING *`,
            [recurrence_id, from_date]
        );

        res.status(200).json({
            message: `${result.rowCount} future timeslots deleted.`,
            deleted: result.rows
        });
    } catch (err) {
        console.error('Error deleting future timeslots:', err.message);
        res.status(500).json({ error: 'Server error deleting future timeslots' });
    }
});

//Assing Coach Timeslots
// GET /timeslot/by-package/:packageId?coachId=...
router.get('/by-package-with-coaches/:packageId', async (req, res) => {
    const { packageId } = req.params;
    const { coachId } = req.query;
  
    if (!packageId || !coachId) {
      return res.status(400).json({ error: 'Package ID and Coach ID are required' });
    }
  
    try {
      // Step 1: Get all timeslots for this package
      const timeslotQuery = `
        SELECT 
          t.id, t.package_id, t.date, t.start_time, t.end_time, t.max_capacity, t.recurrence_id
        FROM timeslots t
        WHERE t.package_id = $1
        ORDER BY t.date, t.start_time
      `;
      const { rows: timeslots } = await pool.query(timeslotQuery, [packageId]);
  
      // Step 2: For each timeslot, get assigned coaches with their names
      const assignmentsQuery = `
        SELECT ta.timeslot_id, c.id AS coach_id, u.first_name, u.last_name, ta.status
        FROM timeslot_assignments ta
        INNER JOIN coaches c ON ta.coach_user_id = c.user_id
        INNER JOIN users u ON u.id = c.user_id
        WHERE ta.timeslot_id IN (
            SELECT id FROM timeslots WHERE package_id = $1
        )
      `;

      const { rows: assignments } = await pool.query(assignmentsQuery, [packageId]);

      // Map assignments by timeslot_id with coach info
      const assignmentMap = {};
      for (const row of assignments) {
        if (!assignmentMap[row.timeslot_id]) {
            assignmentMap[row.timeslot_id] = [];
        }
        assignmentMap[row.timeslot_id].push({
            coach_id: row.coach_id,
            first_name: row.first_name,
            last_name: row.last_name,
            status: row.status
        });
      }

      // Merge assignment info into timeslot objects
      const enrichedTimeslots = timeslots.map(slot => ({
        ...slot,
        assigned_coaches: assignmentMap[slot.id] || []
      }));

      return res.json({ timeslots: enrichedTimeslots });
    } catch (err) {
      console.error('Error fetching enriched timeslots:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
});
  
router.post('/assign-coach', async (req, res) => {
    const { timeslot_id, coach_id } = req.body;
  
    if (!timeslot_id || !coach_id) {
      return res.status(400).json({ error: 'timeslot_id and coach_id are required' });
    }
  
    try {
      // Get user_id from coach ID
      const userRes = await pool.query(
        `SELECT user_id FROM coaches WHERE id = $1`,
        [coach_id]
      );
      if (userRes.rows.length === 0) {
        return res.status(404).json({ error: 'Coach not found' });
      }
  
      const coach_user_id = userRes.rows[0].user_id;
  
      // Either insert or update existing assignment
      const result = await pool.query(
        `INSERT INTO public.timeslot_assignments (timeslot_id, coach_user_id, status)
         VALUES ($1, $2, 'assigned')
         ON CONFLICT (timeslot_id, coach_user_id)
         DO UPDATE SET status = 'assigned', requested_at = NULL
         RETURNING *`,
        [timeslot_id, coach_user_id]
      );
  
      // Update user_id on timeslot if not already set
      await pool.query(
        `UPDATE timeslots
         SET user_id = $1
         WHERE id = $2`,
        [coach_user_id, timeslot_id]
      );
  
      res.status(201).json({
        message: 'Coach successfully assigned to timeslot',
        assignment: result.rows[0]
      });
    } catch (err) {
      console.error('Error assigning coach:', err.message);
      res.status(500).json({ error: 'Server error assigning coach to timeslot' });
    }
});
  

router.get('/assigned-coaches/:timeslot_id', async (req, res) => {
    const { timeslot_id } = req.params;

    try {
        const result = await pool.query(
            `SELECT c.id AS coach_id, u.id AS user_id, u.first_name, u.last_name, u.email
             FROM public.timeslot_assignments ta
             JOIN public.users u ON ta.coach_user_id = u.id
             JOIN public.coaches c ON c.user_id = u.id
             WHERE ta.timeslot_id = $1`,
            [timeslot_id]
        );

        res.status(200).json({ coaches: result.rows });
    } catch (err) {
        console.error('Error fetching assigned coaches:', err.message);
        res.status(500).json({ error: 'Error fetching assigned coaches' });
    }
});

router.delete('/unassign-coach', async (req, res) => {
    const { timeslot_id, coach_id } = req.body;

    if (!timeslot_id || !coach_id) {
        return res.status(400).json({ error: 'timeslot_id and coach_id are required' });
    }

    try {
        // Lookup coach_user_id
        const userRes = await pool.query(
            `SELECT user_id FROM coaches WHERE id = $1`,
            [coach_id]
        );

        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: 'Coach not found' });
        }

        const coach_user_id = userRes.rows[0].user_id;

        // Now delete the assignment
        const result = await pool.query(
            `DELETE FROM public.timeslot_assignments
             WHERE timeslot_id = $1 AND coach_user_id = $2
             RETURNING *`,
            [timeslot_id, coach_user_id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Assignment not found' });
        }

        res.status(200).json({ message: 'Coach unassigned from timeslot' });
    } catch (err) {
        console.error('Error unassigning coach:', err.message);
        res.status(500).json({ error: 'Error unassigning coach from timeslot' });
    }
});

// PUT /admin/approve-time-off/:timeslot_id/:coach_user_id
router.put('/admin/approve-time-off/:timeslot_id/:coach_id', async (req, res) => {
    const { timeslot_id, coach_id } = req.params;
  
    try {
      const userResult = await pool.query(
        `SELECT user_id FROM coaches WHERE id = $1`,
        [coach_id]
      );
  
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'Coach not found' });
      }
  
      const coach_user_id = userResult.rows[0].user_id;
  
      const updateRes = await pool.query(
        `UPDATE timeslot_assignments
         SET status = 'unassigned'
         WHERE timeslot_id = $1 AND coach_user_id = $2
         RETURNING *`,
        [timeslot_id, coach_user_id]
      );
  
      if (updateRes.rowCount === 0) {
        return res.status(404).json({ error: 'Assignment not found' });
      }
  
      // ✅ Important line
      await pool.query(
        `UPDATE timeslots
         SET user_id = NULL
         WHERE id = $1 AND user_id = $2`,
        [timeslot_id, coach_user_id]
      );
  
      res.status(200).json({ message: 'Time-off approved and coach marked unassigned.' });
    } catch (err) {
      console.error('Error approving time-off:', err.message);
      res.status(500).json({ error: 'Server error approving time-off' });
    }
});
  
  
  
router.put('/admin/decline-time-off/:timeslot_id/:coach_id', async (req, res) => {
    const { timeslot_id, coach_id } = req.params;

    // Step 0: Look up coach_user_id using coach_id
    const userResult = await pool.query(
    `SELECT user_id FROM coaches WHERE id = $1`,
    [coach_id]
    );
    
    if (userResult.rows.length === 0) {
    return res.status(404).json({ error: 'Coach not found' });
    }
    
    const coach_user_id = userResult.rows[0].user_id;
  
    try {
      const result = await pool.query(
        `UPDATE timeslot_assignments
         SET status = 'assigned'
         WHERE timeslot_id = $1 AND coach_user_id = $2
         RETURNING *`,
        [timeslot_id, coach_user_id]
      );
  
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Assignment not found' });
      }
  
      res.status(200).json({ message: 'Time-off request declined and coach remains assigned.' });
    } catch (err) {
      console.error('Error declining time-off:', err.message);
      res.status(500).json({ error: 'Server error declining time-off' });
    }
});

// Export the router to be used in app.js
module.exports = router;
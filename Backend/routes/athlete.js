const express = require('express');
const pool = require('../db');
const { authenticateToken } = require('./auth'); // Adjust path if needed
const router = express.Router();

function requireRole(expectedRole) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== expectedRole) {
      return res.status(403).json({ error: 'Not authorized for this dashboard' });
    }
    next();
  };
}

router.get('/me', authenticateToken, async (req, res) => {
  console.log('req.user:', req.user); // <--- Add this
  const userId = req.user.id;
  try {
    const result = await pool.query(
      'SELECT first_name, last_name, email FROM customer WHERE user_id = $1 LIMIT 1',
      [userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching customer:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new customer (athlete)
router.post('/create', async (req, res) => {
  const { first_name, last_name, email, phone, user_id } = req.body;

  try {
    // Check if user ID exists in users table
    const userRes = await pool.query('SELECT id FROM public.users WHERE id = $1', [user_id]);
    if (userRes.rows.length === 0) {
      return res.status(400).json({ error: 'User not found' });
    }

    // Insert into the correct table (customer)
    const newCustomer = await pool.query(
      `INSERT INTO public.customer (first_name, last_name, email, phone, user_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [first_name, last_name, email, phone, user_id]
    );

    res.status(201).json({ message: 'Client created successfully', customer: newCustomer.rows[0] });
  } catch (err) {
    console.error('Error creating client:', err.message);
    res.status(500).json({ error: 'Error creating client' });
  }
});

// Update an existing customer 
router.put('/update/:id', async (req, res) => {
  const { id } = req.params;
  const { first_name, last_name, email, phone, user_id } = req.body;

  try {
    // Check if user ID exists
    const userRes = await pool.query('SELECT id FROM public.users WHERE id = $1', [user_id]);
    if (userRes.rows.length === 0) {
      return res.status(400).json({ error: 'User not found' });
    }

    // Update customer info in the correct table
    const result = await pool.query(
      `UPDATE public.customer
       SET first_name = $1,
           last_name = $2,
           email = $3,
           phone = $4,
           user_id = $5
       WHERE id = $6
       RETURNING *`,
      [first_name, last_name, email, phone, user_id, id]
    );

    if (result.rows.length > 0) {
      res.status(200).json({ message: 'Client updated successfully', customer: result.rows[0] });
    } else {
      res.status(404).json({ error: 'Client not found' });
    }
  } catch (err) {
    console.error('Error updating client:', err.message);
    res.status(500).json({ error: 'Error updating client' });
  }
});

// Get customer by user ID 
router.get('/by-user/:user_id', async (req, res) => {
  const { user_id } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM public.customer WHERE user_id = $1 LIMIT 1`,
      [user_id]
    );

    if (result.rows.length > 0) {
      res.status(200).json({ customer: result.rows[0] });
    } else {
      res.status(404).json({ error: 'Client not found' });
    }
  } catch (err) {
    console.error('Error fetching Client:', err.message);
    res.status(500).json({ error: 'Error fetching Client data' });
  }
});

// GET athletes for a customer
router.get('/:customerId', async (req, res) => {
    const { customerId } = req.params;
    try {
        const result = await pool.query(
        'SELECT id, first_name, last_name, age_group, sport FROM athlete WHERE customer_id = $1',
        [customerId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching athletes:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST new athlete
router.post('/', async (req, res) => {
    const { customer_id, first_name, last_name, age_group, sport } = req.body;

    // Validation: require name, sport, and age_group
    if (!first_name || !age_group || !sport) {
        return res.status(400).json({ error: 'First name, age group, and sport are required.' });
    }

    try {
        const result = await pool.query(
        `INSERT INTO athlete (customer_id, first_name, last_name, age_group, sport)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *`,
        [customer_id, first_name, last_name, age_group, sport]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error adding athlete:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT update athlete by ID
router.put('/:athleteId', async (req, res) => {
    const { athleteId } = req.params;
    const { customer_id, first_name, last_name, age_group, sport } = req.body;

    // Validation: require name, sport, and age_group
    if (!first_name || !age_group || !sport) {
        return res.status(400).json({ error: 'First name, age group, and sport are required.' });
    }

    try {
        // Check if athlete exists
        const check = await pool.query('SELECT id FROM athlete WHERE id = $1', [athleteId]);
        if (check.rows.length === 0) {
        return res.status(404).json({ error: 'Athlete not found' });
        }

        // Update athlete
        const result = await pool.query(
        `UPDATE athlete
            SET customer_id = $1,
                first_name = $2,
                last_name = $3,
                age_group = $4,
                sport = $5
            WHERE id = $6
            RETURNING *`,
        [customer_id, first_name, last_name, age_group, sport, athleteId]
        );

        res.status(200).json(result.rows[0]);
    } catch (err) {
        console.error('Error updating athlete:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE athlete by ID
router.delete('/:athleteId', async (req, res) => {
    const { athleteId } = req.params;
  
    try {
      // Check if athlete exists
      const check = await pool.query('SELECT id FROM athlete WHERE id = $1', [athleteId]);
      if (check.rows.length === 0) {
        return res.status(404).json({ error: 'Athlete not found' });
      }
  
      // Delete athlete
      await pool.query('DELETE FROM athlete WHERE id = $1', [athleteId]);
      res.status(200).json({ message: 'Athlete deleted successfully' });
    } catch (err) {
      console.error('Error deleting athlete:', err);
      res.status(500).json({ error: 'Server error' });
    }
});

router.get('/receipts/:athleteId', async(req, res) => {
    const { athleteId } = req.params;

    try {
      const result = await pool.query(
        `SELECT 
            b.id AS booking_id, b.status AS booking_status,
            pmt.amount AS amount_paid, pmt.payment_method, pmt.payment_status, pmt.transaction_id, pmt.created_at AS payment_date,
            pk.name AS package_name, pk.price AS package_price, pk.description AS package_description,
            ts.date, ts.start_time, ts.end_time,
            a.first_name AS athlete_first, a.last_name AS athlete_last,
            c.first_name AS customer_first, c.last_name AS customer_last, 
            u.first_name AS coach_first, u.last_name AS coach_last, 
          FROM booking b
          JOIN packages pk ON b.package_id = pk.id
          JOIN timeslots ts ON b.timeslot_id = ts.id
          JOIN athlete a ON b.athlete_id = a.id
          JOIN customer c ON b.customer_id = c.id
          JOIN timeslot_assignments ta ON ts.id = ta.timeslot_id
          JOIN users u ON ta.coach_user_id = u.id
          JOIN orders o ON b.order_id = o.id
          JOIN payments pmt ON o.id = pmt.order_id
          WHERE b.athlete_id = $1
          ORDER BY pmt.created_at DESC`,
        [athleteId]  
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({error: err.message});
    }
});
  
// Get receipts by customer ID
router.get('/receipts/by-customer/:customerId', async (req, res) => {
  const { customerId } = req.params;
  try {
    const result = await pool.query(
      `SELECT 
          b.order_id,
          MIN(b.id) AS booking_id, -- just to have a booking reference
          pmt.amount AS amount_paid,
          pmt.payment_method,
          pmt.payment_status,
          pmt.transaction_id,
          pmt.created_at AS payment_date,
          pk.name AS package_name,
          pk.price AS package_price,
          pk.description AS package_description,
          a.first_name AS athlete_first,
          a.last_name AS athlete_last,
          c.first_name AS customer_first,
          c.last_name AS customer_last,
          array_agg(
              to_char(ts.date, 'Mon DD') || ' from ' ||
              to_char(ts.start_time, 'HH12:MIam') || ' - ' ||
              to_char(ts.end_time, 'HH12:MIam')
              ORDER BY ts.date, ts.start_time
          ) AS sessions
      FROM booking b
      JOIN packages pk ON b.package_id = pk.id
      JOIN athlete a ON b.athlete_id = a.id
      JOIN customer c ON b.customer_id = c.id
      JOIN timeslots ts ON b.timeslot_id = ts.id
      JOIN orders o ON b.order_id = o.id
      LEFT JOIN payments pmt ON o.id = pmt.order_id
      WHERE b.customer_id = $1
      GROUP BY b.order_id, pmt.amount, pmt.payment_method, pmt.payment_status, pmt.transaction_id, pmt.created_at,
               pk.name, pk.price, pk.description,
               a.first_name, a.last_name,
               c.first_name, c.last_name
      ORDER BY pmt.created_at DESC`,
      [customerId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Receipts error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- REMOVE all timeslot/calendar endpoints ---
// Remove: /booked-timeslots/by-customer/:customerId
// Remove timeslot/session logic from receipts if you want to fully decouple

// --- ADD: Endpoint to get all paid packages for a customer (for both youth and adult dashboards) ---
router.get('/paid-packages/:customerId', authenticateToken, async (req, res) => {
  const { customerId } = req.params;
  try {
    const result = await pool.query(
      `SELECT 
          pu.id as usage_id,
          p.id as package_id, 
          p.name, 
          p.calendly_url, 
          pu.sessions_remaining,
          pu.athlete_id
       FROM package_usage pu
       JOIN packages p ON pu.package_id = p.id
       WHERE pu.customer_id = $1 AND pu.sessions_remaining > 0
       ORDER BY pu.id DESC`,
      [customerId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching paid packages:', err);
    res.status(500).json({ error: 'Error fetching paid packages' });
  }
});

// Create adult athlete (with dob)
router.post('/adult-athlete/create', async (req, res) => {
  const { first_name, last_name, dob, email, phone, user_id, sport } = req.body;
  try {
    // Insert into customer table with dob
    const customerRes = await pool.query(
      `INSERT INTO public.customer (first_name, last_name, dob, email, phone, user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [first_name, last_name, dob, email, phone, user_id]
    );
    const customerId = customerRes.rows[0].id;

    // Calculate age group from dob
    function getAgeGroup(dob) {
      const birthDate = new Date(dob);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      if (age <= 8) return "8 & Under";
      if (age <= 10) return "9-10";
      if (age <= 12) return "11-12";
      if (age <= 14) return "13-14";
      if (age <= 16) return "15-16";
      if (age <= 18) return "17-18";
      return "18+";
    }
    const age_group = getAgeGroup(dob);

    // Insert into athlete table
    const athleteRes = await pool.query(
      `INSERT INTO athlete (customer_id, first_name, last_name, age_group, sport)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [customerId, first_name, last_name, age_group, sport]
    );

    res.status(201).json({ customer: customerRes.rows[0], athlete: athleteRes.rows[0] });
  } catch (err) {
    console.error('Error creating adult athlete:', err.message);
    res.status(500).json({ error: 'Error creating adult athlete' });
  }
});

// Update adult athlete
router.put('/adult-athlete/update/:id', async (req, res) => {
  const { id } = req.params;
  const { first_name, last_name, dob, email, phone, user_id, sport } = req.body;
  try {
    // Update customer table with dob
    const customerRes = await pool.query(
      `UPDATE public.customer
       SET first_name = $1, last_name = $2, dob = $3, email = $4, phone = $5, user_id = $6
       WHERE id = $7
       RETURNING *`,
      [first_name, last_name, dob, email, phone, user_id, id]
    );

    // Calculate age_group from dob
    function getAgeGroup(dob) {
      const birthDate = new Date(dob);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      if (age <= 8) return "8 & Under";
      if (age <= 10) return "9-10";
      if (age <= 12) return "11-12";
      if (age <= 14) return "13-14";
      if (age <= 16) return "15-16";
      if (age <= 18) return "17-18";
      return "18+";
    }
    const age_group = getAgeGroup(dob);

    // Check if athlete row exists
    const athleteCheck = await pool.query(
      `SELECT id FROM athlete WHERE customer_id = $1 LIMIT 1`,
      [id]
    );

    let athleteRes;
    if (athleteCheck.rows.length > 0) {
      // Update athlete
      athleteRes = await pool.query(
        `UPDATE athlete
         SET sport = $1, age_group = $2, first_name = $3, last_name = $4
         WHERE customer_id = $5
         RETURNING *`,
        [sport, age_group, first_name, last_name, id]
      );
    } else {
      // Insert athlete if not exists
      athleteRes = await pool.query(
        `INSERT INTO athlete (customer_id, first_name, last_name, age_group, sport)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [id, first_name, last_name, age_group, sport]
      );
    }

    res.status(200).json({ customer: customerRes.rows[0], athlete: athleteRes.rows[0] });
  } catch (err) {
    console.error('Error updating adult athlete:', err.message);
    res.status(500).json({ error: 'Error updating adult athlete' });
  }
});

// Get adult athlete by user_id (returns both customer and athlete)
router.get('/adult-athlete/by-user/:user_id', async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT 
          c.id AS customer_id,
          a.id AS athlete_id,
          c.first_name, c.last_name, c.email, c.phone, c.dob,
          a.sport, a.age_group
       FROM customer c
       JOIN athlete a ON c.id = a.customer_id
       WHERE c.user_id = $1
       LIMIT 1`,
      [user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Adult athlete not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching adult athlete:', err.message);
    res.status(500).json({ error: 'Error fetching adult athlete data' });
  }
});

// Youth Athlete dashboard
router.get('/by-user/:user_id', authenticateToken, requireRole('athlete'), async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT * FROM public.customer WHERE user_id = $1 LIMIT 1`,
      [user_id]
    );
    if (result.rows.length > 0) {
      res.status(200).json({ customer: result.rows[0] });
    } else {
      res.status(404).json({ error: 'Client not found' });
    }
  } catch (err) {
    console.error('Error fetching Client:', err.message);
    res.status(500).json({ error: 'Error fetching Client data' });
  }
});

module.exports = router;

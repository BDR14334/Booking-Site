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

router.get('/adult-athlete/by-user/:user_id', async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT 
          c.id AS customer_id,
          a.id AS athlete_id,
          c.first_name AS customer_first_name,
          c.last_name AS customer_last_name,
          c.email AS customer_email,
          c.phone AS customer_phone,
          c.dob,
          a.first_name AS athlete_first_name,
          a.last_name AS athlete_last_name,
          a.sport,
          a.age_group
       FROM customer c
       JOIN athlete a ON c.id = a.customer_id
       WHERE c.user_id = $1
       LIMIT 1`,
      [user_id]
    );

    if (result.rows.length === 0) {
      // fallback: if no customer/athlete yet, return user info for autofill
      const fallback = await pool.query(
        `SELECT first_name, last_name, email FROM users WHERE id = $1 LIMIT 1`,
        [user_id]
      );
      if (fallback.rows.length > 0) {
        return res.json({
          customer: {
            id: null,
            first_name: fallback.rows[0].first_name,
            last_name: fallback.rows[0].last_name,
            email: fallback.rows[0].email,
            phone: null,
            dob: null
          },
          athlete: null,
          age: null
        });
      }
      return res.status(404).json({ error: 'Adult athlete not found' });
    }

    const row = result.rows[0];

    // Calculate age from dob
    let age = null;
    if (row.dob) {
      const birthDate = new Date(row.dob);
      const today = new Date();
      age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
    }

    res.json({
      customer: {
        id: row.customer_id,
        first_name: row.customer_first_name,
        last_name: row.customer_last_name,
        email: row.customer_email,
        phone: row.customer_phone,
        dob: row.dob
      },
      athlete: row.athlete_id
        ? {
            id: row.athlete_id,
            first_name: row.athlete_first_name,
            last_name: row.athlete_last_name,
            sport: row.sport,
            age_group: row.age_group
          }
        : null,
      age
    });
  } catch (err) {
    console.error('Error fetching adult athlete:', err.message);
    res.status(500).json({ error: 'Error fetching adult athlete data' });
  }
});

router.get('/me', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    let result = await pool.query(
      'SELECT first_name, last_name, email FROM customer WHERE user_id = $1 LIMIT 1',
      [userId]
    );

    if (result.rows.length === 0) {
      // fallback to users table
      result = await pool.query(
        'SELECT first_name, last_name, email FROM users WHERE id = $1 LIMIT 1',
        [userId]
      );
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching user/customer:', err);
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

    // Fetch current values
    const current = await pool.query('SELECT * FROM public.customer WHERE id = $1', [id]);
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    const existing = current.rows[0];

    // Use existing value if new value is empty
    const updatedFirstName = first_name || existing.first_name;
    const updatedLastName = last_name || existing.last_name;
    const updatedEmail = email || existing.email;
    const updatedPhone = phone || existing.phone;

    // Update customer
    await pool.query(
      `UPDATE public.customer
       SET first_name = $1, last_name = $2, email = $3, phone = $4, user_id = $5
       WHERE id = $6`,
      [updatedFirstName, updatedLastName, updatedEmail, updatedPhone, user_id, id]
    );

    // Update users.email
    await pool.query(
      `UPDATE public.users
       SET email = $1
       WHERE id = $2`,
      [updatedEmail, user_id]
    );

    res.status(200).json({ message: 'Client updated successfully' });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'That email is already in use. Please use a different email.' });
    }
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
            COALESCE(pk.name, '(deleted package)') AS package_name,
            pk.price AS package_price,
            COALESCE(pk.description, '') AS package_description,
            ts.date, ts.start_time, ts.end_time,
            a.first_name AS athlete_first, a.last_name AS athlete_last,
            c.first_name AS customer_first, c.last_name AS customer_last, 
            u.first_name AS coach_first, u.last_name AS coach_last
          FROM booking b
          LEFT JOIN packages pk ON b.package_id = pk.id
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
          COALESCE(pk.name, '(deleted package)') AS package_name,
          pk.price AS package_price,
          COALESCE(pk.description, '') AS package_description,
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
      LEFT JOIN packages pk ON b.package_id = pk.id
      JOIN athlete a ON b.athlete_id = a.id
      JOIN customer c ON b.customer_id = c.id
      JOIN timeslots ts ON b.timeslot_id = ts.id
      JOIN orders o ON b.order_id = o.id
      LEFT JOIN payments pmt ON o.id = pmt.order_id
      WHERE b.customer_id = $1
      GROUP BY b.order_id, pmt.amount, pmt.payment_method, pmt.payment_status, pmt.transaction_id, pmt.created_at,
               COALESCE(pk.name, '(deleted package)'), pk.price, COALESCE(pk.description, ''),
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
    const customerIdNum = Number(customerId);
    if (!Number.isInteger(customerIdNum) || customerIdNum <= 0) {
      return res.status(400).json({ error: 'Invalid customerId' });
    }

    // Authorization: allow admins to view any customer; otherwise only the owning user can view.
    const ownerRes = await pool.query(
      'SELECT user_id FROM customer WHERE id = $1 LIMIT 1',
      [customerIdNum]
    );
    if (ownerRes.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const owningUserId = ownerRes.rows[0].user_id;
    const isAdmin = req.user && req.user.role === 'admin';
    if (!isAdmin && String(owningUserId) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Not authorized to view these packages' });
    }

    const result = await pool.query(
      `SELECT 
          pu.id as usage_id,
          pu.package_id as package_id,
          COALESCE(p.name, '(deleted package)') as name,
          p.calendly_url, 
          pu.sessions_remaining,
          pu.athlete_id
       FROM package_usage pu
       LEFT JOIN packages p ON pu.package_id = p.id
       WHERE pu.customer_id = $1 AND pu.sessions_remaining > 0
       ORDER BY pu.id DESC`,
      [customerIdNum]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching paid packages:', err);
    res.status(500).json({ error: 'Error fetching paid packages' });
  }
});

// Create or update adult athlete (with customer and athlete separation)
router.post('/adult-athlete/create', async (req, res) => {
  const { first_name, last_name, dob, email, phone, user_id, sport } = req.body;

  try {
    // 1. Upsert customer
    let customerId;
    const existingCustomer = await pool.query(
      `SELECT id FROM public.customer WHERE user_id = $1 LIMIT 1`,
      [user_id]
    );
    if (existingCustomer.rows.length > 0) {
      customerId = existingCustomer.rows[0].id;
      await pool.query(
        `UPDATE public.customer
         SET first_name = $1, last_name = $2, dob = $3, email = $4, phone = $5
         WHERE id = $6`,
        [first_name, last_name, dob, email, phone, customerId]
      );
    } else {
      const customerRes = await pool.query(
        `INSERT INTO public.customer (first_name, last_name, dob, email, phone, user_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [first_name, last_name, dob, email, phone, user_id]
      );
      customerId = customerRes.rows[0].id;
    }

    // 2. Calculate age group
    function getAgeGroup(dob) {
      if (!dob) return null;
      const birthDate = new Date(dob);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
      if (age <= 8) return "8 & Under";
      if (age <= 10) return "9-10";
      if (age <= 12) return "11-12";
      if (age <= 14) return "13-14";
      if (age <= 16) return "15-16";
      if (age <= 18) return "17-18";
      return "18+";
    }
    const age_group = getAgeGroup(dob);

    // 3. Upsert athlete
    const existingAthlete = await pool.query(
      `SELECT id FROM athlete WHERE customer_id = $1 LIMIT 1`,
      [customerId]
    );

    let athlete;
    if (existingAthlete.rows.length > 0) {
      // Update athlete instead of inserting duplicate
      const athleteRes = await pool.query(
        `UPDATE athlete
         SET first_name=$1, last_name=$2, age_group=$3, sport=$4
         WHERE customer_id=$5
         RETURNING *`,
        [first_name, last_name, age_group, sport, customerId]
      );
      athlete = athleteRes.rows[0];
    } else {
      // Insert new athlete
      const athleteRes = await pool.query(
        `INSERT INTO athlete (customer_id, first_name, last_name, age_group, sport)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [customerId, first_name, last_name, age_group, sport]
      );
      athlete = athleteRes.rows[0];
    }

    res.status(201).json({ customer_id: customerId, athlete });
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
    // Update customer table with dob and email
    const customerRes = await pool.query(
      `UPDATE public.customer
       SET first_name = $1, last_name = $2, dob = $3, email = $4, phone = $5, user_id = $6
       WHERE id = $7
       RETURNING *`,
      [first_name, last_name, dob, email, phone, user_id, id]
    );

    // Update users.email
    await pool.query(
      `UPDATE public.users
       SET email = $1
       WHERE id = $2`,
      [email, user_id]
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

    // Upsert athlete by customer_id
    const athleteCheck = await pool.query(
      `SELECT id FROM athlete WHERE customer_id = $1 LIMIT 1`,
      [id]
    );

    let athleteRes;
    if (athleteCheck.rows.length > 0) {
      athleteRes = await pool.query(
        `UPDATE athlete
         SET sport = $1, age_group = $2, first_name = $3, last_name = $4
         WHERE customer_id = $5
         RETURNING *`,
        [sport, age_group, first_name, last_name, id]
      );
    } else {
      athleteRes = await pool.query(
        `INSERT INTO athlete (customer_id, first_name, last_name, age_group, sport)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [id, first_name, last_name, age_group, sport]
      );
    }

    res.status(200).json({ customer: customerRes.rows[0], athlete: athleteRes.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'That email is already in use. Please use a different email.' });
    }
    console.error('Error updating adult athlete:', err.message);
    res.status(500).json({ error: 'Error updating adult athlete' });
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
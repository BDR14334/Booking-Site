const express = require('express');
const pool = require('../db');
const router = express.Router();

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
  
  

module.exports = router;

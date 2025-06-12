// Import Express and create a router instance
const express = require('express');
const pool = require('../db'); // Import PostgreSQL connection pool
const router = express.Router(); // Creates a new router instance
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { v4: uuidv4 } = require('uuid');
const bodyParser = require('body-parser'); // Add at the top if not already present


// GET availability by package packageId
router.get('/availability/by-package/:packageId', async (req, res) => {
  const { packageId } = req.params;

  try {
    // 1. Get user_ids of coaches assigned to this package
    const coachResult = await pool.query(
      `SELECT c.id AS coach_id, c.user_id, c.first_name, c.last_name
       FROM coaches c
       JOIN coach_packages cp ON c.id = cp.coach_id
       WHERE cp.packages_id = $1`,
      [packageId]
    );

    const coaches = coachResult.rows;
    if (coaches.length === 0) {
      return res.status(404).json({ message: 'No coaches assigned to this package' });
    }

    const coachUserIds = coaches.map(coach => coach.user_id);

    // 2. Get timeslots assigned to these coaches with 'assigned' status
    const timeslotResult = await pool.query(
      `SELECT ts.*, u.first_name, u.last_name,
              ts.date + ts.start_time AS start_datetime,
              ts.date + ts.end_time AS end_datetime,
              COALESCE(b.count, 0) AS booking_count
       FROM timeslots ts
       JOIN timeslot_assignments ta ON ts.id = ta.timeslot_id
       JOIN users u ON ta.coach_user_id = u.id
       JOIN coaches c ON c.user_id = u.id
       LEFT JOIN (
         SELECT timeslot_id, COUNT(*) as count
         FROM booking
         GROUP BY timeslot_id
       ) b ON ts.id = b.timeslot_id
       WHERE ta.coach_user_id = ANY($1)
         AND ta.status = 'assigned'
         AND ts.date + ts.start_time >= NOW()
         AND COALESCE(b.count, 0) < ts.max_capacity
         AND (ts.package_id = $2 OR ts.package_id IS NULL)
       ORDER BY ts.date, ts.start_time`,
      [coachUserIds, packageId]
    );       

    res.status(200).json({
      coaches,
      timeslots: timeslotResult.rows
    });

  } catch (err) {
    console.error('Error fetching package availability:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Gets coaches that are assigned to a timeslot
router.get('/coach-timeslots', async (req, res) => {
  const { packageId } = req.query;

  try {
    // 1. Get coach assigned to the package
    const coachResult = await pool.query(
      `SELECT coach_id, number_of_sessions FROM packages WHERE id = $1`,
      [packageId]
    );

    if (coachResult.rows.length === 0) {
      return res.status(404).json({ error: 'Package not found' });
    }

    const coachId = coachResult.rows[0].coach_id;
    const sessionCount = coachResult.rows[0].number_of_sessions;

    // 2. Get all future timeslots for this coach (based on date + start_time)
    const timeslotResult = await pool.query(
      `SELECT ts.*, 
              COALESCE(b.count, 0) AS current_bookings,
              ts.max_capacity - COALESCE(b.count, 0) AS remaining_capacity
        FROM timeslots ts
        LEFT JOIN (
          SELECT timeslot_id, COUNT(*) as count
          FROM booking
          GROUP BY timeslot_id
        ) b ON ts.id = b.timeslot_id
        WHERE ts.user_id = $1
          AND (ts.date > CURRENT_DATE OR (ts.date = CURRENT_DATE AND ts.start_time > CURRENT_TIME))
        ORDER BY ts.date, ts.start_time`,
      [coachId]
    );

    res.json({
      coachId,
      timeslots: timeslotResult.rows,
      sessionCount,
    });

  } catch (err) {
    console.error('Error fetching coach timeslots:', err.message);
    res.status(500).json({ error: 'Failed to fetch coach timeslots' });
  }
});

// Post all attributes for booking
router.post('/booking', async (req, res) => {
  const { customer_id, athleteIds, timeslot_ids, package_id } = req.body;

  // ✅ Add validation right after destructuring
  if (!Array.isArray(athleteIds) || athleteIds.length === 0) {
      return res.status(400).json({ error: 'No athletes provided' });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get max_capacity of the timeslot
    for (const timeslot_id of timeslot_ids) {
      const timeslot = await client.query(
        'SELECT max_capacity FROM timeslots WHERE id = $1 FOR UPDATE',
        [timeslot_id]
      );
    
      if (timeslot.rows.length === 0) {
        throw new Error('Timeslot not found');
      }
    
      const maxCapacity = timeslot.rows[0].max_capacity;
    
      const bookingCountResult = await client.query(
        'SELECT COUNT(*) FROM booking WHERE timeslot_id = $1',
        [timeslot_id]
      );
      const currentCount = parseInt(bookingCountResult.rows[0].count);
    
      if (currentCount + athleteIds.length > maxCapacity) {
        throw new Error(`Timeslot ${timeslot_id} exceeds capacity`);
      }
    
      for (const athlete_id of athleteIds) {
        const existing = await client.query(
          'SELECT id FROM booking WHERE athlete_id = $1 AND timeslot_id = $2',
          [athlete_id, timeslot_id]
        );
        if (existing.rows.length > 0) continue;
    
        await client.query(
          `INSERT INTO booking (customer_id, athlete_id, timeslot_id, package_id)
            VALUES ($1, $2, $3, $4)`,
          [customer_id, athlete_id, timeslot_id, package_id]
        );
      }
    }      

    await client.query('COMMIT');
    res.status(200).json({ message: 'Booking successful' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Booking error:', err.message);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Post everthing for the checkout session 
router.post('/create-checkout-session', async (req, res) => {
  const { customerId, packageId, timeslotIds, athleteIds } = req.body;

  try {
    console.log("🟡 Incoming payload:", { customerId, packageId, timeslotIds, athleteIds });

    const pkgRes = await pool.query(
      'SELECT id, name, price FROM packages WHERE id = $1',
      [packageId]
    );

    console.log("🟢 Package query result:", pkgRes.rows);

    if (pkgRes.rows.length === 0) {
      console.error("❌ Package not found for ID:", packageId);
      return res.status(400).json({ error: 'Invalid package selected' });
    }

    const pkg = pkgRes.rows[0];
    console.log("📦 Selected package:", pkg);

    const priceRaw = pkg.price;
    const priceCents = Math.round(parseFloat(priceRaw) * 100);

    console.log("💵 Parsed priceCents:", priceCents);

    if (isNaN(priceCents)) {
      console.error("❌ Invalid price (NaN):", priceRaw);
      return res.status(400).json({ error: "Invalid package price" });
    }
    
    // ✅ ADD THE LOG HERE
    console.log("Creating Stripe session with:", {
      name: pkg.name,
      price: pkg.price,
      unit_amount: priceCents
    });

    const orderRes = await pool.query(
      `INSERT INTO orders (customer_id, package_id, status, order_date)
       VALUES ($1, $2, 'pending', NOW())
       RETURNING id`,
      [customerId, packageId]
    );

    const orderId = orderRes.rows[0].id;

    // 2. Create Stripe session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: pkg.name },
          unit_amount: priceCents,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `http://localhost:5000/booking/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `http://localhost:5000/booking.html`,
      metadata: {
        order_id: orderId,
        customer_id: customerId,
        package_id: packageId,
        timeslot_ids: JSON.stringify(timeslotIds),
        athlete_ids: JSON.stringify(athleteIds)
      }
    });

    // 3. Store session ID in the order
    await pool.query(
      'UPDATE orders SET stripe_session_id = $1 WHERE id = $2',
      [session.id, orderId]
    );

    res.json({ id: session.id });

  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    res.status(500).json({ error: 'Stripe checkout failed' });
  }
});

// Post payment intent
router.post('/create-payment-intent', async (req, res) => {
  const { customerId, packageId } = req.body;

  try {
    const pkgRes = await pool.query(
      'SELECT id, name, price FROM packages WHERE id = $1',
      [packageId]
    );

    if (pkgRes.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid package selected' });
    }

    const pkg = pkgRes.rows[0];
    const amountCents = Math.round(parseFloat(pkg.price) * 100);

    // Create a Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      metadata: {
        customer_id: customerId,
        package_id: packageId
        // optionally add timeslotIds or athleteIds if needed
      }
    });

    res.send({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('Error creating PaymentIntent:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Gets data to later be sent to customer
router.get('/payment-success', async (req, res) => {
  const { session_id } = req.query;

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const metadata = session.metadata;

    const orderId = metadata.order_id;
    const customerId = metadata.customer_id;
    const packageId = metadata.package_id;
    const athleteIds = JSON.parse(metadata.athlete_ids);
    const timeslotIds = JSON.parse(metadata.timeslot_ids);

    // 1. Mark order as paid
    await pool.query(
      `UPDATE orders SET status = 'paid' WHERE id = $1`,
      [orderId]
    );

    // 2. Insert into payments table
    await pool.query(
      `INSERT INTO payments (order_id, amount, payment_method, transaction_id, payment_status)
       VALUES ($1, $2, $3, $4, $5)`,
      [orderId, session.amount_total / 100, 'card', session_id, session.payment_status]
    );

    // 3. Insert confirmed bookings
    for (const timeslotId of timeslotIds) {
      for (const athleteId of athleteIds) {
        await pool.query(
          `INSERT INTO booking (customer_id, athlete_id, timeslot_id, package_id, order_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [customerId, athleteId, timeslotId, packageId, orderId]
        );
      }
    }

    // 4. Redirect to thank you or home page
    res.redirect('/ThankYou.html');

  } catch (err) {
    console.error('Payment success handling failed:', err.message);
    res.status(500).send('Booking failed. Please contact support.');
  }
});

// Stripe webhook (must be before express.json() middleware is applied)
router.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ✅ Handle successful payment intent
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const metadata = session.metadata;

    try {
      const orderId = metadata.order_id;
      const customerId = metadata.customer_id;
      const packageId = metadata.package_id;
      const athleteIds = JSON.parse(metadata.athlete_ids);
      const timeslotIds = JSON.parse(metadata.timeslot_ids);

      // 1. Mark order as paid
      await pool.query(
        `UPDATE orders SET status = 'paid' WHERE id = $1`,
        [orderId]
      );

      // 2. Record payment
      await pool.query(
        `INSERT INTO payments (order_id, amount, payment_method, transaction_id, payment_status)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, session.amount_total / 100, 'card', session.id, session.payment_status]
      );

      // 3. Add bookings
      for (const timeslotId of timeslotIds) {
        for (const athleteId of athleteIds) {
          await pool.query(
            `INSERT INTO booking (customer_id, athlete_id, timeslot_id, package_id, order_id)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (athlete_id, timeslot_id) DO NOTHING`, 
            [customerId, athleteId, timeslotId, packageId, orderId]
          );
        }
      }

      console.log(`✅ Booking confirmed for Order #${orderId}`);

    } catch (err) {
      console.error('❌ Error handling webhook booking:', err.message);
      return res.status(500).send('Internal Server Error');
    }
  }

  res.status(200).send('Webhook received');
});




// Export the router to be used in app.js
module.exports = router;
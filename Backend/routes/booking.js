// Import Express and create a router instance
const express = require('express');
const pool = require('../db'); // Import PostgreSQL connection pool
const router = express.Router(); // Creates a new router instance
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { v4: uuidv4 } = require('uuid');
const bodyParser = require('body-parser'); // Add at the top if not already present
const sendEmail = require('../utils/email'); // Add this line
const { siteBaseUrl } = require('../config');

async function getActiveAdminRecipients() {
  // If users.is_active exists, send only to admins.
  try {
    const res = await pool.query(
      `SELECT LOWER(TRIM(email)) AS email
       FROM users
       WHERE role = 'admin'
         AND COALESCE(is_active, true) = true
         AND email IS NOT NULL
         AND TRIM(email) <> ''`
    );
    return Array.from(new Set((res.rows || []).map(r => r.email).filter(Boolean)));
  } catch (err) {
    if (err && err.code === '42703') {
      const res = await pool.query(
        `SELECT LOWER(TRIM(email)) AS email
         FROM users
         WHERE role = 'admin'
           AND email IS NOT NULL
           AND TRIM(email) <> ''`
      );
      return Array.from(new Set((res.rows || []).map(r => r.email).filter(Boolean)));
    }
    throw err;
  }
}

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
              COALESCE(b.count, 0) AS booking_count,
              ts.max_capacity - COALESCE(b.count, 0) AS remaining_capacity
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
          AND (ts.date > CURRENT_DATE OR (ts.date = CURRENT_DATE && ts.start_time > CURRENT_TIME))
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
  const { customer_id, athleteIds, timeslot_ids, package_id, payment } = req.body;

  if (!Array.isArray(athleteIds) || athleteIds.length === 0) {
    return res.status(400).json({ error: 'No athletes provided' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Generate a 6-digit random code for receipt
    const receiptCode = Math.floor(100000 + Math.random() * 900000);

    // Step 1: Create order
    const orderStatus = payment ? 'paid' : 'pending';
    const orderRes = await client.query(
      `INSERT INTO orders (customer_id, package_id, status, order_date, receipt_code)
       VALUES ($1, $2, $3, NOW(), $4)
       RETURNING id, receipt_code`,
      [customer_id, package_id, orderStatus, receiptCode]
    );
    const orderId = orderRes.rows[0].id;
    const receiptCodeStr = `ZSP-${orderRes.rows[0].receipt_code}`;

    // Step 2: Handle timeslot bookings (legacy, if needed)
    if (Array.isArray(timeslot_ids) && timeslot_ids.length > 0) {
      for (const timeslot_id of timeslot_ids) {
        const timeslot = await client.query(
          'SELECT max_capacity FROM timeslots WHERE id = $1 FOR UPDATE',
          [timeslot_id]
        );
        if (timeslot.rows.length === 0) throw new Error('Timeslot not found');

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
            `INSERT INTO booking (customer_id, athlete_id, timeslot_id, package_id, order_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [customer_id, athlete_id, timeslot_id, package_id, orderId]
          );
        }
      }
    }

    // Step 3: Save payment if provided
    if (payment) {
      await client.query(
        `INSERT INTO payments (order_id, amount, payment_method, transaction_id, payment_status)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, payment.amount, payment.method, payment.transaction_id, payment.status]
      );

      // Fetch sessions_included from the package
      const pkgRes = await client.query(
        "SELECT sessions_included FROM packages WHERE id = $1",
        [package_id]
      );
      if (pkgRes.rows.length === 0) throw new Error("Package not found");
      const sessions_included = pkgRes.rows[0].sessions_included;

      // Update package_usage for each athlete
      for (const athlete_id of athleteIds) {
        console.log('Inserting into package_usage:', {
          customer_id,
          athlete_id,
          package_id,
          sessions_included
        });
        await client.query(
          `INSERT INTO package_usage (customer_id, athlete_id, package_id, sessions_remaining, sessions_purchased)
           VALUES ($1, $2, $3, $4, $4)
           ON CONFLICT (customer_id, athlete_id, package_id)
           DO UPDATE SET
             sessions_remaining = package_usage.sessions_remaining + EXCLUDED.sessions_remaining,
             sessions_purchased = package_usage.sessions_purchased + EXCLUDED.sessions_purchased
          `,
          [customer_id, athlete_id, package_id, sessions_included]
        );
      }
    }

    await client.query('COMMIT'); // Only commit if everything above succeeded

    // Now send the email (outside the transaction)
    // Fetch package info
    const pkgRes = await pool.query(
      'SELECT name, price, sessions_included FROM packages WHERE id = $1',
      [package_id]
    );
    const pkg = pkgRes.rows[0];

    // Fetch customer info
    const custRes = await pool.query(`
      SELECT u.email, u.first_name
      FROM customer c
      JOIN users u ON c.user_id = u.id
      WHERE c.id = $1
    `, [customer_id]);
    const customerEmail = custRes.rows[0].email;
    const customerName = custRes.rows[0].first_name;

    // Fetch athlete names
    const athleteNamesRes = await pool.query(
      `SELECT a.id, a.first_name, a.last_name
       FROM athlete a
       WHERE a.id = ANY($1)`,
      [athleteIds]
    );
    const athleteList = athleteNamesRes.rows
      .map(a => `<li>${a.first_name} ${a.last_name}</li>`)
      .join('');
    const athleteCount = athleteNamesRes.rows.length;

    // Fetch user role (example, adjust as needed)
    const userRoleRes = await pool.query(
      `SELECT u.role FROM customer c JOIN users u ON c.user_id = u.id WHERE c.id = $1`,
      [customer_id]
    );
    const userRole = userRoleRes.rows[0]?.role || 'athlete';

    let dashboardPath = '/athlete-dashboard#bookSessions';
    if (userRole === 'adult-athlete') {
      dashboardPath = '/adult-athlete-dashboard#bookSessions';
    }
    const dashboardLink = `${siteBaseUrl}${dashboardPath}`;

    // Send receipt email
    const paymentDate = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });

    await sendEmail(
      customerEmail,
      `Your Receipt – ${pkg.name}`,
      `
        <h2>Payment Receipt</h2>
        <p>Hi ${customerName},</p>
        <p>Thank you for your purchase!</p>
        <ul>
          <li><b>Package:</b> ${pkg.name}</li>
          <li><b>Price per package:</b> $${pkg.price}</li>
          <li><b>Packages purchased:</b> ${athleteCount}</li>
          <li><b>Total:</b> $${pkg.price * athleteCount}</li>
          <li><b>Receipt Number:</b> ${receiptCodeStr}</li>
          <li><b>Status:</b> ${payment.status}</li>
          <li><b>Payment Date:</b> ${paymentDate}</li>
        </ul>
        <b>Athletes assigned to this purchase:</b>
        <ul>
          ${athleteList}
        </ul>
        <p><b>Ready to schedule sessions?</b>
          <a href="${dashboardLink}" target="_blank" style="color:#ff4800;font-weight:bold;">
            Click Here
          </a>
        </p>
        <br/>
        <p>– ZSP Team</p>
      `
    );

    // Admin purchase notification (best-effort)
    try {
      const adminRecipients = await getActiveAdminRecipients();
      if (adminRecipients.length > 0) {
        const adminSubject = `New package purchase: ${pkg.name}`;
        const adminHtml = `
          <div style="font-family:Arial,sans-serif;color:#222;line-height:1.5;max-width:720px;">
            <h2 style="margin:0 0 10px;">New Package Purchase</h2>
            <p style="margin:0 0 12px;"><b>Customer:</b> ${customerName} (${customerEmail})</p>
            <ul style="margin:0 0 12px;">
              <li><b>Package:</b> ${pkg.name}</li>
              <li><b>Price per package:</b> $${pkg.price}</li>
              <li><b>Packages purchased:</b> ${athleteCount}</li>
              <li><b>Total:</b> $${pkg.price * athleteCount}</li>
              <li><b>Receipt Number:</b> ${receiptCodeStr}</li>
              <li><b>Status:</b> ${payment.status}</li>
              <li><b>Payment Date:</b> ${paymentDate}</li>
            </ul>
            <p style="margin:0 0 8px;"><b>Athletes assigned:</b></p>
            <ul>${athleteList}</ul>
          </div>
        `;

        await sendEmail(adminRecipients, adminSubject, adminHtml);
      }
    } catch (adminEmailErr) {
      console.warn('Admin purchase notification failed:', adminEmailErr);
    }

    res.status(200).json({ message: 'Booking successful & receipt sent' });
  } catch (err) {
    await client.query('ROLLBACK'); // Undo all DB changes if any error
    console.error('Booking error:', err.message);
    res.status(400).json({ error: err.message });
  } finally {
    client.release(true);
  }
});

// Post everthing for the checkout session 
router.post('/create-checkout-session', async (req, res) => {
  const { customerId, packageId, athleteIds } = req.body;

  try {
    const packageIdNum = Number(packageId);
    if (!Number.isInteger(packageIdNum) || packageIdNum <= 0) {
      return res.status(400).json({ error: 'Invalid package selected' });
    }

    // 1. Fetch package
    let pkgRes;
    try {
      pkgRes = await pool.query(
        'SELECT id, name, price, calendly_url FROM packages WHERE id = $1 AND COALESCE(is_active, true) = true',
        [packageIdNum]
      );
    } catch (err) {
      // Local DB may not have is_active yet
      if (err && err.code === '42703') {
        pkgRes = await pool.query(
          'SELECT id, name, price, calendly_url FROM packages WHERE id = $1',
          [packageIdNum]
        );
      } else {
        throw err;
      }
    }

    if (pkgRes.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid package selected' });
    }

    const pkg = pkgRes.rows[0];
    const unitPrice = Number(pkg.price);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      return res.status(400).json({ error: 'Invalid package price' });
    }
    const priceCents = Math.round(unitPrice * 100);

    // Generate a 6-digit random code for receipt
    const receiptCode = Math.floor(100000 + Math.random() * 900000);

    // 2. Insert order (pending until payment succeeds)
    const orderRes = await pool.query(
      `INSERT INTO orders (customer_id, package_id, status, order_date, receipt_code)
       VALUES ($1, $2, 'pending', NOW(), $3)
       RETURNING id, receipt_code`,
      [customerId, packageIdNum, receiptCode]
    );
    const orderId = orderRes.rows[0].id;
    const receiptCodeStr = `ZSP-${orderRes.rows[0].receipt_code}`;

    // 3. Create Stripe checkout session
    const athleteCount = Array.isArray(athleteIds) ? athleteIds.length : 1;
    const successUrl = `${siteBaseUrl}/booking/payment-success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${siteBaseUrl}/packages`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: pkg.name },
          unit_amount: priceCents,
        },
        quantity: athleteCount, // <-- FIXED: charge for each athlete
      }],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        order_id: orderId,
        customer_id: customerId,
        package_id: packageIdNum,
        athlete_ids: JSON.stringify(athleteIds),
        receipt_code: receiptCodeStr
      }
    });

    // Save session ID
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
  const { customerId, packageId, athleteIds } = req.body;

  try {
    const packageIdNum = Number(packageId);
    if (!Number.isInteger(packageIdNum) || packageIdNum <= 0) {
      return res.status(400).json({ error: 'Invalid package selected' });
    }

    const athleteCount = Array.isArray(athleteIds) ? athleteIds.length : 0;
    if (!Number.isInteger(athleteCount) || athleteCount <= 0) {
      return res.status(400).json({ error: 'Please select at least one athlete' });
    }

    let pkgRes;
    try {
      pkgRes = await pool.query(
        'SELECT id, name, price FROM packages WHERE id = $1 AND COALESCE(is_active, true) = true',
        [packageIdNum]
      );
    } catch (err) {
      // Local DB may not have is_active yet
      if (err && err.code === '42703') {
        pkgRes = await pool.query(
          'SELECT id, name, price FROM packages WHERE id = $1',
          [packageIdNum]
        );
      } else {
        throw err;
      }
    }

    if (pkgRes.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid package selected' });
    }

    const pkg = pkgRes.rows[0];
    const unitPrice = (() => {
      if (typeof pkg.price === 'number') return pkg.price;
      if (typeof pkg.price === 'string') {
        const normalized = pkg.price.replace(/[^0-9.\-]/g, '');
        return Number.parseFloat(normalized);
      }
      return Number.NaN;
    })();
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      return res.status(400).json({ error: 'Invalid package price' });
    }
    const amountCents = Math.round(unitPrice * 100 * athleteCount);

    // Create a Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      metadata: {
        customer_id: customerId,
        package_id: packageIdNum,
        athlete_count: athleteCount,
        athlete_ids: JSON.stringify(athleteIds)
      }
    });

    res.send({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('Error creating PaymentIntent:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// payment-success (frontend redirect only)
router.get('/payment-success', async (req, res) => {
  // No DB writes here; just redirect to thank-you page
  return res.redirect('/thank-you');
});

// ✅ Step 3: Stripe Webhook (optional safety net)
const rawBodyParser = bodyParser.raw({ type: 'application/json' });

router.post('/webhook', rawBodyParser, async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  async function finalizeCharge({ transactionId, amount, metadata, paymentStatus }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Prevent duplicate processing
      const existing = await client.query(
        `SELECT id FROM payments WHERE transaction_id = $1 LIMIT 1`,
        [transactionId]
      );
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return { alreadyProcessed: true };
      }

      const orderId = metadata.order_id;
      const customerId = metadata.customer_id;
      const packageId = metadata.package_id;
      const receiptCodeStr = metadata.receipt_code || null;
      const athleteIds = metadata.athlete_ids ? JSON.parse(metadata.athlete_ids) : [];

      await client.query(`UPDATE orders SET status = 'paid' WHERE id = $1`, [orderId]);

      await client.query(`
        INSERT INTO payments (order_id, amount, payment_method, transaction_id, payment_status)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (transaction_id) DO NOTHING
      `, [orderId, amount, 'card', transactionId, paymentStatus]);

      const pkgRes = await client.query(
        "SELECT sessions_included, name FROM packages WHERE id = $1",
        [packageId]
      );
      if (pkgRes.rows.length === 0) throw new Error("Package not found");
      const sessions_included = pkgRes.rows[0].sessions_included;
      const packageName = pkgRes.rows[0].name;

      for (const athlete_id of athleteIds) {
        await client.query(
          `INSERT INTO package_usage (customer_id, athlete_id, package_id, sessions_remaining, sessions_purchased)
           VALUES ($1, $2, $3, $4, $4)
           ON CONFLICT (customer_id, athlete_id, package_id)
           DO UPDATE SET
             sessions_remaining = package_usage.sessions_remaining + EXCLUDED.sessions_remaining,
             sessions_purchased = package_usage.sessions_purchased + EXCLUDED.sessions_purchased
          `,
          [customerId, athlete_id, packageId, sessions_included]
        );
      }

      await client.query('COMMIT');

      // Send receipt email (outside transaction)
      try {
        const customerRes = await pool.query(`
          SELECT u.email, u.first_name
          FROM customer c
          JOIN users u ON c.user_id = u.id
          WHERE c.id = $1
        `, [customerId]);
        const customerEmail = customerRes.rows[0]?.email;
        const customerName = customerRes.rows[0]?.first_name || 'Customer';

        const athleteNamesRes = await pool.query(
          `SELECT a.id, a.first_name, a.last_name FROM athlete a WHERE a.id = ANY($1)`,
          [athleteIds]
        );
        const athleteList = athleteNamesRes.rows.map(a => `<li>${a.first_name} ${a.last_name}</li>`).join('');
        const paymentDate = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });

        const htmlReceipt = `
          <h2>Payment Receipt</h2>
          <p>Hi ${customerName},</p>
          <p>Thank you for your purchase! Here are your details:</p>
          <ul>
            <li><b>Package:</b> ${packageName}</li>
            <li><b>Price:</b> $${(amount).toFixed(2)}</li>
            <li><b>Receipt Number:</b> ${receiptCodeStr || 'N/A'}</li>
            <li><b>Payment Date:</b> ${paymentDate}</li>
            <li><b>Status:</b> ${paymentStatus}</li>
          </ul>
          <p><b>Athletes assigned to this purchase:</b></p>
          <ul>${athleteList}</ul>
          <p>
            <b>Ready to schedule sessions?</b><br>
            <a href="${dashboardLink}" target="_blank" style="color:#ff4800;font-weight:bold;">
              Click Here
            </a>
          </p>
          <br/>
          <p>– ZSP Team</p>
        `;

        await sendEmail(
          customerEmail,
          `Your Receipt – ${packageName}`,
          htmlReceipt
        );
      } catch (emailErr) {
        console.error('Failed to send receipt email:', emailErr);
      }

      // Admin purchase notification (best-effort)
      try {
        const adminRecipients = await getActiveAdminRecipients();
        if (adminRecipients.length > 0) {
          const adminSubject = `New package purchase: ${packageName}`;
          const adminHtml = `
            <div style="font-family:Arial,sans-serif;color:#222;line-height:1.5;max-width:720px;">
              <h2 style="margin:0 0 10px;">New Package Purchase</h2>
              <p style="margin:0 0 12px;"><b>Customer:</b> ${customerName} (${customerEmail || '—'})</p>
              <ul style="margin:0 0 12px;">
                <li><b>Package:</b> ${packageName}</li>
                <li><b>Total Charged:</b> $${(amount).toFixed(2)}</li>
                <li><b>Receipt Number:</b> ${receiptCodeStr || 'N/A'}</li>
                <li><b>Status:</b> ${paymentStatus}</li>
                <li><b>Payment Date:</b> ${paymentDate}</li>
                <li><b>Stripe Transaction ID:</b> ${transactionId}</li>
              </ul>
              <p style="margin:0 0 8px;"><b>Athletes assigned:</b></p>
              <ul>${athleteList || ''}</ul>
            </div>
          `;

          await sendEmail(adminRecipients, adminSubject, adminHtml);
        }
      } catch (adminEmailErr) {
        console.warn('Admin purchase notification failed:', adminEmailErr);
      }

      return { alreadyProcessed: false };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
      console.error('Error finalizing charge (transaction):', err.message);
      throw err;
    } finally {
      client.release(true);
    }
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const metadata = session.metadata || {};
        const amount = (session.amount_total || 0) / 100;
        const transactionId = session.id;

        await finalizeCharge({
          transactionId,
          amount,
          metadata,
          paymentStatus: session.payment_status || 'unknown'
        });
        break;
      }
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        const metadata = pi.metadata || {};
        const amount = (pi.amount || 0) / 100;
        const transactionId = pi.id;

        await finalizeCharge({
          transactionId,
          amount,
          metadata,
          paymentStatus: 'succeeded'
        });
        break;
      }
      default:
        break;
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook processing error:', err.message);
    res.status(500).send('Webhook processing failed');
  }
});

// GET Stripe publishable key (for frontend)
router.get('/stripe-publish-key', (req, res) => {
  res.json({ publishKey: process.env.STRIPE_PUBLISH_KEY });
});

// Export the router to be used in app.js
module.exports = router;
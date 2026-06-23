// routes/stripeRoutes.js
// Stripe Payment Integration for Invoice Payments

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// Initialize Stripe with your secret key
if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('⚠️  STRIPE_SECRET_KEY not set — payment endpoints will return errors');
}
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;

// Your frontend URL for redirects
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// Guard: all Stripe routes require configured key
const requireStripe = (req, res, next) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe payments not configured. Set STRIPE_SECRET_KEY.' });
  next();
};

// ==================== CREATE CHECKOUT SESSION ====================
// POST /api/stripe/create-checkout-session
// Creates a Stripe checkout session for an invoice
router.post('/create-checkout-session', auth, requireStripe, async (req, res) => {
  try {
    const { invoiceId } = req.body;

    if (!invoiceId) {
      return res.status(400).json({ error: 'Invoice ID required' });
    }

    // Get invoice details
    const invoiceResult = await db.query(`
      SELECT i.*, c.first_name, c.last_name, c.email as client_email
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      WHERE i.id = $1
    `, [invoiceId]);

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = invoiceResult.rows[0];

    if (invoice.payment_status === 'paid') {
      return res.status(400).json({ error: 'Invoice already paid' });
    }

    // Calculate amount due (total - amount_paid)
    const amountDue = parseFloat(invoice.total) - parseFloat(invoice.amount_paid || 0);
    
    if (amountDue <= 0) {
      return res.status(400).json({ error: 'No amount due' });
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      // Payment methods (card + ACH bank debit) are controlled in the Stripe
      // Dashboard. Omitting payment_method_types lets Checkout show whatever is
      // enabled there — so turning on ACH/us_bank_account in the Dashboard makes
      // bank direct-debit appear here automatically, with no code change and no
      // risk of erroring if it isn't enabled yet.
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Invoice #${invoice.invoice_number || invoice.id.slice(0, 8)}`,
              description: `Home Care Services - ${invoice.first_name} ${invoice.last_name}`,
            },
            unit_amount: Math.round(amountDue * 100), // Stripe uses cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}&invoice_id=${invoiceId}`,
      cancel_url: `${FRONTEND_URL}/payment-cancelled?invoice_id=${invoiceId}`,
      customer_email: invoice.client_email,
      metadata: {
        invoice_id: invoiceId,
        client_name: `${invoice.first_name} ${invoice.last_name}`,
      },
    });

    // Store the session ID on the invoice for tracking
    await db.query(`
      UPDATE invoices 
      SET stripe_session_id = $1, updated_at = NOW()
      WHERE id = $2
    `, [session.id, invoiceId]);

    res.json({ 
      sessionId: session.id, 
      url: session.url 
    });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== CREATE PAYMENT LINK ====================
// POST /api/stripe/create-payment-link
// Creates a shareable payment link for an invoice (no auth required to pay)
router.post('/create-payment-link', auth, requireStripe, async (req, res) => {
  try {
    const { invoiceId } = req.body;

    // Get invoice details
    const invoiceResult = await db.query(`
      SELECT i.*, c.first_name, c.last_name, c.email as client_email
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      WHERE i.id = $1
    `, [invoiceId]);

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = invoiceResult.rows[0];
    const amountDue = parseFloat(invoice.total) - parseFloat(invoice.amount_paid || 0);

    if (amountDue <= 0) {
      return res.status(400).json({ error: 'No amount due' });
    }

    // Create a Stripe Price for this invoice
    const price = await stripe.prices.create({
      currency: 'usd',
      unit_amount: Math.round(amountDue * 100),
      product_data: {
        name: `Invoice #${invoice.invoice_number || invoice.id.slice(0, 8)}`,
      },
    });

    // Create payment link
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: {
        invoice_id: invoiceId,
        client_name: `${invoice.first_name} ${invoice.last_name}`,
      },
      after_completion: {
        type: 'redirect',
        redirect: {
          url: `${FRONTEND_URL}/payment-success?invoice_id=${invoiceId}`,
        },
      },
    });

    // Store the payment link on the invoice
    await db.query(`
      UPDATE invoices 
      SET stripe_payment_link = $1, updated_at = NOW()
      WHERE id = $2
    `, [paymentLink.url, invoiceId]);

    res.json({ 
      paymentLink: paymentLink.url,
      linkId: paymentLink.id
    });
  } catch (error) {
    console.error('Payment link error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== PUBLIC PAYMENT PAGE ====================
// GET /api/stripe/invoice/:invoiceId/pay
// Public endpoint - allows anyone with the link to view and pay
router.get('/invoice/:invoiceId/pay', requireStripe, async (req, res) => {
  try {
    const { invoiceId } = req.params;

    const invoiceResult = await db.query(`
      SELECT 
        i.id, i.invoice_number, i.total, i.amount_paid, i.payment_status,
        i.billing_period_start, i.billing_period_end,
        c.first_name, c.last_name
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      WHERE i.id = $1
    `, [invoiceId]);

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = invoiceResult.rows[0];
    const amountDue = parseFloat(invoice.total) - parseFloat(invoice.amount_paid || 0);

    res.json({
      invoiceNumber: invoice.invoice_number || invoice.id.slice(0, 8),
      clientName: `${invoice.first_name} ${invoice.last_name}`,
      total: invoice.total,
      amountPaid: invoice.amount_paid || 0,
      amountDue,
      status: invoice.payment_status,
      billingPeriod: {
        start: invoice.billing_period_start,
        end: invoice.billing_period_end
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/stripe/invoice/:invoiceId/pay - Create session for public payment
router.post('/invoice/:invoiceId/pay', requireStripe, async (req, res) => {
  try {
    const { invoiceId } = req.params;

    const invoiceResult = await db.query(`
      SELECT i.*, c.first_name, c.last_name, c.email as client_email
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      WHERE i.id = $1
    `, [invoiceId]);

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = invoiceResult.rows[0];

    if (invoice.payment_status === 'paid') {
      return res.status(400).json({ error: 'Invoice already paid' });
    }

    const amountDue = parseFloat(invoice.total) - parseFloat(invoice.amount_paid || 0);

    const session = await stripe.checkout.sessions.create({
      // Payment methods (card + ACH bank debit) are controlled in the Stripe
      // Dashboard. Omitting payment_method_types lets Checkout show whatever is
      // enabled there — so turning on ACH/us_bank_account in the Dashboard makes
      // bank direct-debit appear here automatically, with no code change and no
      // risk of erroring if it isn't enabled yet.
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Invoice #${invoice.invoice_number || invoice.id.slice(0, 8)}`,
              description: `Chippewa Valley Home Care - ${invoice.first_name} ${invoice.last_name}`,
            },
            unit_amount: Math.round(amountDue * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}&invoice_id=${invoiceId}`,
      cancel_url: `${FRONTEND_URL}/pay/${invoiceId}?cancelled=true`,
      customer_email: invoice.client_email,
      metadata: {
        invoice_id: invoiceId,
      },
    });

    await db.query(`
      UPDATE invoices 
      SET stripe_session_id = $1, updated_at = NOW()
      WHERE id = $2
    `, [session.id, invoiceId]);

    res.json({ url: session.url });
  } catch (error) {
    console.error('Public payment error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== STRIPE WEBHOOK ====================
// POST /api/stripe/webhook
// Handles Stripe webhook events (payment success, etc.)
router.post('/webhook', express.raw({ type: 'application/json' }), requireStripe, async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Idempotency: Stripe retries webhooks on any non-2xx response. Without
  // tracking processed event ids, a retry would double-count payments.
  // Track in a small dedicated table; create lazily.
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS stripe_webhook_events (
        event_id VARCHAR(255) PRIMARY KEY,
        event_type VARCHAR(100) NOT NULL,
        processed_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    const dup = await db.query(`SELECT 1 FROM stripe_webhook_events WHERE event_id = $1`, [event.id]);
    if (dup.rows.length > 0) {
      console.log(`Stripe webhook ${event.id} already processed — skipping`);
      return res.json({ received: true, duplicate: true });
    }
    await db.query(
      `INSERT INTO stripe_webhook_events (event_id, event_type) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING`,
      [event.id, event.type]
    );
  } catch (e) {
    console.error('Stripe idempotency check failed:', e.message);
    // Fail closed: refuse to process if we can't track it, so Stripe retries later
    return res.status(500).json({ error: 'idempotency check failed' });
  }

  // Marks an invoice paid/partial from a completed AND settled Checkout session.
  // Used by card (instant) and ACH bank debit (after it clears) alike. Caps
  // amount_paid at total so a payment can't push past the invoice amount.
  const applySessionPayment = async (session) => {
    const invoiceId = session.metadata?.invoice_id;
    if (!invoiceId) return;
    const amountPaid = session.amount_total / 100; // cents -> dollars
    await db.query(`
      UPDATE invoices
      SET
        amount_paid = LEAST(total, COALESCE(amount_paid, 0) + $1),
        payment_status = CASE
          WHEN COALESCE(amount_paid, 0) + $1 >= total THEN 'paid'
          ELSE 'partial'
        END,
        stripe_payment_id = $2,
        paid_at = NOW(),
        updated_at = NOW()
      WHERE id = $3
    `, [amountPaid, session.payment_intent, invoiceId]);
    console.log(`✅ Payment settled for invoice ${invoiceId}: $${amountPaid}`);
  };

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      // Card payments are 'paid' the moment checkout completes. Delayed methods
      // — ACH bank debit — return here 'unpaid'/processing and settle days
      // later, so we must NOT mark those paid yet. We wait for the
      // async_payment_succeeded event below instead.
      if (session.payment_status === 'paid') {
        await applySessionPayment(session);
      } else {
        console.log(`⏳ Checkout completed, payment still processing (e.g. ACH) for invoice ${session.metadata?.invoice_id}`);
      }
      break;
    }

    // ACH/bank debit cleared — fires days after checkout for delayed methods.
    case 'checkout.session.async_payment_succeeded': {
      await applySessionPayment(event.data.object);
      break;
    }

    // ACH/bank debit failed to clear (insufficient funds, closed account, etc.)
    // Leave the invoice unpaid so it still shows as owed.
    case 'checkout.session.async_payment_failed': {
      const session = event.data.object;
      console.log(`❌ Bank payment failed for invoice ${session.metadata?.invoice_id} — invoice left unpaid`);
      break;
    }

    case 'payment_intent.payment_failed': {
      const paymentIntent = event.data.object;
      console.log(`❌ Payment failed: ${paymentIntent.last_payment_error?.message}`);
      break;
    }

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});

// ==================== VERIFY PAYMENT ====================
// GET /api/stripe/verify-payment/:sessionId
// Verify a payment was successful (for success page)
router.get('/verify-payment/:sessionId', requireStripe, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === 'paid') {
      res.json({
        success: true,
        amount: session.amount_total / 100,
        invoiceId: session.metadata?.invoice_id,
        customerEmail: session.customer_email
      });
    } else {
      res.json({
        success: false,
        status: session.payment_status
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== GET PAYMENT HISTORY ====================
// GET /api/stripe/payments/:invoiceId
router.get('/payments/:invoiceId', auth, requireStripe, async (req, res) => {
  try {
    const { invoiceId } = req.params;

    // Get invoice with payment info
    const invoice = await db.query(`
      SELECT 
        i.*,
        c.first_name, c.last_name
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      WHERE i.id = $1
    `, [invoiceId]);

    if (invoice.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // If there's a Stripe payment ID, get details from Stripe
    let stripePayment = null;
    if (invoice.rows[0].stripe_payment_id) {
      try {
        stripePayment = await stripe.paymentIntents.retrieve(invoice.rows[0].stripe_payment_id);
      } catch (e) {
        console.log('Could not retrieve Stripe payment:', e.message);
      }
    }

    res.json({
      invoice: invoice.rows[0],
      stripePayment
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

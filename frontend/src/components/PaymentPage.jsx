// src/components/PaymentPage.jsx
// Public page for clients to pay invoices via Stripe
import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

const PaymentPage = () => {
  const { invoiceId } = useParams();
  const [searchParams] = useSearchParams();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  
  const cancelled = searchParams.get('cancelled') === 'true';

  useEffect(() => {
    loadInvoice();
  }, [invoiceId]);

  const loadInvoice = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/stripe/invoice/${invoiceId}/pay`);
      if (!response.ok) {
        throw new Error('Invoice not found');
      }
      const data = await response.json();
      setInvoice(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePayment = async () => {
    setProcessing(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/stripe/invoice/${invoiceId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await response.json();

      if (data.url) {
        // Redirect to Stripe checkout
        window.location.href = data.url;
      } else {
        throw new Error(data.error || 'Failed to create payment session');
      }
    } catch (err) {
      setError(err.message);
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.spinner}></div>
          <p>Loading invoice...</p>
        </div>
      </div>
    );
  }

  if (error && !invoice) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h2 style={{ color: '#e74c3c' }}>Error</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (invoice?.status === 'paid') {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.successIcon}>✓</div>
          <h2 style={{ color: '#27ae60' }}>Invoice Paid</h2>
          <p>This invoice has already been paid. Thank you!</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <h1 style={{ margin: 0, color: '#2c3e50' }}>Chippewa Valley Home Care</h1>
        </div>

        {cancelled && (
          <div style={styles.cancelledBanner}>
            Payment was cancelled. You can try again below.
          </div>
        )}

        <div style={styles.invoiceHeader}>
          <h2>Invoice #{invoice?.invoiceNumber}</h2>
          <p style={styles.clientName}>{invoice?.clientName}</p>
        </div>

        <div style={styles.details}>
          <div style={styles.detailRow}>
            <span>Billing Period:</span>
            <span>
              {invoice?.billingPeriod?.start && new Date(invoice.billingPeriod.start).toLocaleDateString()} - {' '}
              {invoice?.billingPeriod?.end && new Date(invoice.billingPeriod.end).toLocaleDateString()}
            </span>
          </div>
          <div style={styles.detailRow}>
            <span>Invoice Total:</span>
            <span>${parseFloat(invoice?.total || 0).toFixed(2)}</span>
          </div>
          {parseFloat(invoice?.amountPaid || 0) > 0 && (
            <div style={styles.detailRow}>
              <span>Already Paid:</span>
              <span style={{ color: '#27ae60' }}>-${parseFloat(invoice.amountPaid).toFixed(2)}</span>
            </div>
          )}
          <div style={{ ...styles.detailRow, ...styles.totalRow }}>
            <span><strong>Amount Due:</strong></span>
            <span style={styles.amountDue}>${parseFloat(invoice?.amountDue || 0).toFixed(2)}</span>
          </div>
        </div>

        {error && (
          <div style={styles.errorBanner}>
            {error}
          </div>
        )}

        <button
          onClick={handlePayment}
          disabled={processing}
          style={{
            ...styles.payButton,
            ...(processing ? styles.payButtonDisabled : {})
          }}
        >
          {processing ? 'Processing...' : `Pay $${parseFloat(invoice?.amountDue || 0).toFixed(2)}`}
        </button>

        <div style={styles.secureNotice}>
          <span>🔒</span> Secure payment powered by Stripe
        </div>

        <div style={styles.footer}>
          <p>Questions about this invoice? Contact us at:</p>
          <p><strong>support@chippewavalleyhomecare.com</strong></p>
        </div>
      </div>
    </div>
  );
};

// Payment Success Page
export const PaymentSuccess = () => {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const invoiceId = searchParams.get('invoice_id');
  const [payment, setPayment] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sessionId) {
      verifyPayment();
    } else {
      setLoading(false);
    }
  }, [sessionId]);

  const verifyPayment = async () => {
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/api/stripe/verify-payment/${sessionId}`);
      const data = await response.json();
      setPayment(data);
    } catch (err) {
      console.error('Error verifying payment:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <p>Verifying payment...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.successIcon}>✓</div>
        <h2 style={{ color: '#27ae60' }}>Payment Successful!</h2>
        
        {payment?.success && (
          <div style={styles.details}>
            <p>Amount Paid: <strong>${payment.amount?.toFixed(2)}</strong></p>
            <p>A confirmation email has been sent to {payment.customerEmail}</p>
          </div>
        )}

        <p style={{ marginTop: '2rem', color: '#666' }}>
          Thank you for your payment. You can close this window.
        </p>
      </div>
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f6fa',
    padding: '1rem',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '12px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
    padding: '2rem',
    maxWidth: '480px',
    width: '100%',
    textAlign: 'center'
  },
  logo: {
    marginBottom: '1.5rem',
    paddingBottom: '1.5rem',
    borderBottom: '1px solid #eee'
  },
  invoiceHeader: {
    marginBottom: '1.5rem'
  },
  clientName: {
    color: '#666',
    fontSize: '1.1rem'
  },
  details: {
    backgroundColor: '#f8f9fa',
    borderRadius: '8px',
    padding: '1rem',
    marginBottom: '1.5rem',
    textAlign: 'left'
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0.5rem 0',
    borderBottom: '1px solid #eee'
  },
  totalRow: {
    borderBottom: 'none',
    paddingTop: '1rem',
    marginTop: '0.5rem',
    borderTop: '2px solid #ddd'
  },
  amountDue: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#2c3e50'
  },
  payButton: {
    width: '100%',
    padding: '1rem 2rem',
    fontSize: '1.1rem',
    fontWeight: 'bold',
    color: 'white',
    backgroundColor: '#3498db',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'background-color 0.2s'
  },
  payButtonDisabled: {
    backgroundColor: '#95a5a6',
    cursor: 'not-allowed'
  },
  secureNotice: {
    marginTop: '1rem',
    color: '#666',
    fontSize: '0.875rem'
  },
  footer: {
    marginTop: '2rem',
    paddingTop: '1rem',
    borderTop: '1px solid #eee',
    color: '#666',
    fontSize: '0.875rem'
  },
  successIcon: {
    width: '60px',
    height: '60px',
    borderRadius: '50%',
    backgroundColor: '#27ae60',
    color: 'white',
    fontSize: '2rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 1rem'
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #f3f3f3',
    borderTop: '4px solid #3498db',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    margin: '0 auto 1rem'
  },
  cancelledBanner: {
    backgroundColor: '#fff3cd',
    color: '#856404',
    padding: '0.75rem',
    borderRadius: '8px',
    marginBottom: '1rem'
  },
  errorBanner: {
    backgroundColor: '#f8d7da',
    color: '#721c24',
    padding: '0.75rem',
    borderRadius: '8px',
    marginBottom: '1rem'
  }
};

export default PaymentPage;

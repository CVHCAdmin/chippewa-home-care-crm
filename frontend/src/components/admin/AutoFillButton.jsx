import React, { useState, useCallback } from 'react';
import PropTypes from 'prop-types';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

/**
 * AutoFillButton - Automatically assigns best-fit caregivers to open shifts
 * 
 * @param {string} weekOf - ISO date string for the week start (YYYY-MM-DD)
 * @param {string} token - JWT auth token
 * @param {function} onComplete - Callback fired after successful fill
 */
const AutoFillButton = ({ weekOf, token, onComplete }) => {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState(null);

  const getWeekEnd = useCallback((startDate) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + 6);
    return d.toISOString().split('T')[0];
  }, []);

  const handleAutoFill = useCallback(async (dryRun = true) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/scheduling/auto-fill`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          startDate: weekOf,
          endDate: getWeekEnd(weekOf),
          dryRun
        })
      });

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      const data = await response.json();
      setResults(data);

      if (!dryRun && data.filled > 0 && onComplete) {
        onComplete();
      }
    } catch (err) {
      console.error('Auto-fill error:', err);
      setError(err.message || 'Failed to auto-fill shifts');
    } finally {
      setLoading(false);
    }
  }, [weekOf, token, getWeekEnd, onComplete]);

  const openModal = useCallback(() => {
    setResults(null);
    setError(null);
    setShowModal(true);
    handleAutoFill(true);
  }, [handleAutoFill]);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setResults(null);
    setError(null);
  }, []);

  const confirmFill = useCallback(() => {
    handleAutoFill(false);
  }, [handleAutoFill]);

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        disabled={loading}
        className="btn btn-primary"
        style={{ marginLeft: '1rem' }}
      >
        {loading ? '⏳ Working...' : '🪄 Auto-Fill'}
      </button>

      {showModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="autofill-title"
          onClick={closeModal}
          style={styles.overlay}
        >
          <div onClick={(e) => e.stopPropagation()} style={styles.modal}>
            {/* Header */}
            <div style={styles.header}>
              <h2 id="autofill-title" style={styles.title}>
                🪄 Auto-Fill Open Shifts
              </h2>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close"
                style={styles.closeBtn}
              >
                ×
              </button>
            </div>

            {/* Body */}
            <div style={styles.body}>
              {error && (
                <div style={styles.error}>
                  ❌ {error}
                </div>
              )}

              {loading && !results && (
                <div style={styles.loading}>
                  ⏳ Finding best matches...
                </div>
              )}

              {results && (
                <>
                  {/* Summary */}
                  <div style={styles.summaryGrid}>
                    <SummaryBox
                      value={results.total}
                      label="Open Shifts"
                      color="#0369a1"
                      bg="#f0f9ff"
                    />
                    <SummaryBox
                      value={results.filled}
                      label="Can Fill"
                      color="#15803d"
                      bg="#f0fdf4"
                    />
                    <SummaryBox
                      value={results.failed}
                      label="No Match"
                      color={results.failed > 0 ? '#dc2626' : '#6b7280'}
                      bg={results.failed > 0 ? '#fef2f2' : '#f9fafb'}
                    />
                  </div>

                  {/* Preview notice */}
                  {results.dryRun && results.filled > 0 && (
                    <div style={styles.notice}>
                      ⚠️ <strong>Preview</strong> — Review assignments below, then confirm.
                    </div>
                  )}

                  {/* Success notice */}
                  {!results.dryRun && results.filled > 0 && (
                    <div style={styles.success}>
                      ✅ Successfully filled {results.filled} shift{results.filled !== 1 ? 's' : ''}!
                    </div>
                  )}

                  {/* Results list */}
                  <div style={styles.resultsList}>
                    {results.results?.map((r, i) => (
                      <ResultRow key={r.shiftId || i} result={r} />
                    ))}
                    {results.total === 0 && (
                      <div style={styles.empty}>
                        No open shifts for this week.
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div style={styles.footer}>
              <button
                type="button"
                onClick={closeModal}
                style={styles.cancelBtn}
              >
                {results && !results.dryRun ? 'Close' : 'Cancel'}
              </button>

              {results?.dryRun && results?.filled > 0 && (
                <button
                  type="button"
                  onClick={confirmFill}
                  disabled={loading}
                  style={styles.confirmBtn}
                >
                  {loading ? '⏳ Filling...' : `✓ Fill ${results.filled} Shifts`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// Sub-components
const SummaryBox = ({ value, label, color, bg }) => (
  <div style={{ ...styles.summaryBox, background: bg }}>
    <div style={{ ...styles.summaryValue, color }}>{value}</div>
    <div style={styles.summaryLabel}>{label}</div>
  </div>
);

const ResultRow = ({ result }) => {
  const isFilled = result.status === 'filled';

  return (
    <div style={{
      ...styles.resultRow,
      background: isFilled ? '#f0fdf4' : '#fef2f2',
      borderLeftColor: isFilled ? '#22c55e' : '#ef4444'
    }}>
      <div>
        <strong>{result.client}</strong>
        <div style={styles.resultMeta}>
          {result.date} • {result.time}
        </div>
      </div>
      <div style={styles.resultRight}>
        {isFilled ? (
          <>
            <div style={styles.resultSuccess}>✓ {result.assignedTo}</div>
            <div style={styles.resultDetail}>
              {result.distance} • {result.familiarity}
            </div>
          </>
        ) : (
          <div style={styles.resultFail}>✗ No match</div>
        )}
      </div>
    </div>
  );
};

// Styles
const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  },
  modal: {
    background: 'white',
    borderRadius: '12px',
    width: '90%',
    maxWidth: '550px',
    maxHeight: '80vh',
    overflow: 'hidden',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)'
  },
  header: {
    padding: '1rem 1.5rem',
    borderBottom: '1px solid #e5e7eb',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  title: {
    margin: 0,
    fontSize: '1.25rem'
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: '1.5rem',
    cursor: 'pointer',
    color: '#6b7280',
    padding: '0.25rem'
  },
  body: {
    padding: '1.5rem',
    overflowY: 'auto',
    maxHeight: '55vh'
  },
  loading: {
    textAlign: 'center',
    padding: '2rem',
    color: '#6b7280'
  },
  error: {
    background: '#fef2f2',
    color: '#dc2626',
    padding: '0.75rem 1rem',
    borderRadius: '6px',
    marginBottom: '1rem'
  },
  notice: {
    background: '#fef3c7',
    padding: '0.75rem 1rem',
    borderRadius: '6px',
    marginBottom: '1rem',
    fontSize: '0.9rem'
  },
  success: {
    background: '#f0fdf4',
    color: '#15803d',
    padding: '0.75rem 1rem',
    borderRadius: '6px',
    marginBottom: '1rem',
    fontSize: '0.9rem'
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '1rem',
    marginBottom: '1.5rem'
  },
  summaryBox: {
    padding: '1rem',
    borderRadius: '8px',
    textAlign: 'center'
  },
  summaryValue: {
    fontSize: '1.75rem',
    fontWeight: 'bold'
  },
  summaryLabel: {
    fontSize: '0.8rem',
    color: '#6b7280'
  },
  resultsList: {
    maxHeight: '220px',
    overflowY: 'auto'
  },
  resultRow: {
    padding: '0.75rem',
    marginBottom: '0.5rem',
    borderLeft: '4px solid',
    borderRadius: '4px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start'
  },
  resultMeta: {
    fontSize: '0.85rem',
    color: '#6b7280'
  },
  resultRight: {
    textAlign: 'right'
  },
  resultSuccess: {
    color: '#15803d',
    fontWeight: 500
  },
  resultFail: {
    color: '#dc2626',
    fontWeight: 500
  },
  resultDetail: {
    fontSize: '0.75rem',
    color: '#6b7280'
  },
  empty: {
    textAlign: 'center',
    padding: '2rem',
    color: '#6b7280'
  },
  footer: {
    padding: '1rem 1.5rem',
    borderTop: '1px solid #e5e7eb',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.75rem'
  },
  cancelBtn: {
    padding: '0.5rem 1rem',
    background: '#f3f4f6',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.9rem'
  },
  confirmBtn: {
    padding: '0.5rem 1rem',
    background: '#2563eb',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.9rem'
  }
};

// PropTypes
AutoFillButton.propTypes = {
  weekOf: PropTypes.string.isRequired,
  token: PropTypes.string.isRequired,
  onComplete: PropTypes.func
};

SummaryBox.propTypes = {
  value: PropTypes.number.isRequired,
  label: PropTypes.string.isRequired,
  color: PropTypes.string.isRequired,
  bg: PropTypes.string.isRequired
};

ResultRow.propTypes = {
  result: PropTypes.shape({
    shiftId: PropTypes.string,
    client: PropTypes.string,
    date: PropTypes.string,
    time: PropTypes.string,
    status: PropTypes.string,
    assignedTo: PropTypes.string,
    distance: PropTypes.string,
    familiarity: PropTypes.string
  }).isRequired
};

export default AutoFillButton;

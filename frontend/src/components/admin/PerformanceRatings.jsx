import { confirm } from '../ConfirmModal';
// src/components/admin/PerformanceRatings.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const PerformanceRatings = ({ token }) => {
  const [caregivers, setCaregivers] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState({});
  const [selectedCaregiverId, setSelectedCaregiverId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState('');
  const [expandedCaregiverId, setExpandedCaregiverId] = useState(null);
  const [formData, setFormData] = useState({
    caregiverId: '',
    clientId: '',
    reviewDate: new Date().toISOString().split('T')[0],
    performanceNotes: '',
    strengths: '',
    areasForImprovement: '',
    overallAssessment: 'satisfactory' // excellent, satisfactory, needs_improvement
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [caregiversRes, clientsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/users/caregivers`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/clients`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      const caregiversData = await caregiversRes.json();
      const clientsData = await clientsRes.json();

      setCaregivers(caregiversData);
      setClients(clientsData);
      loadReviews(caregiversData);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadReviews = async (caregiversList) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/performance-reviews`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      
      const reviewsByCaregiver = {};
      caregiversList.forEach(cg => {
        reviewsByCaregiver[cg.id] = [];
      });
      
      data.forEach(review => {
        if (reviewsByCaregiver[review.caregiver_id]) {
          reviewsByCaregiver[review.caregiver_id].push(review);
        }
      });

      setReviews(reviewsByCaregiver);
    } catch (error) {
      console.error('Failed to load reviews:', error);
    }
  };

  const handleSubmitReview = async (e) => {
    e.preventDefault();
    setMessage('');

    if (!formData.caregiverId || !formData.clientId) {
      setMessage('Caregiver and Client are required');
      return;
    }

    if (!formData.performanceNotes.trim()) {
      setMessage('Performance notes are required');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/performance-reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          caregiverId: formData.caregiverId,
          clientId: formData.clientId,
          reviewDate: formData.reviewDate,
          performanceNotes: formData.performanceNotes,
          strengths: formData.strengths,
          areasForImprovement: formData.areasForImprovement,
          overallAssessment: formData.overallAssessment
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to submit review');
      }

      setMessage('Performance review saved successfully!');
      setFormData({
        caregiverId: '',
        clientId: '',
        reviewDate: new Date().toISOString().split('T')[0],
        performanceNotes: '',
        strengths: '',
        areasForImprovement: '',
        overallAssessment: 'satisfactory'
      });
      setShowForm(false);
      loadReviews(caregivers);
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const handleDeleteReview = async (reviewId) => {
    const _cok = await confirm('Delete this review? This cannot be undone.', {danger: true}); if (!_cok) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/performance-reviews/${reviewId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Failed to delete');

      setMessage('Review deleted');
      setTimeout(() => setMessage(''), 2000);
      loadReviews(caregivers);
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const getClientName = (clientId) => {
    const client = clients.find(c => c.id === clientId);
    return client ? `${client.first_name} ${client.last_name}` : 'Unknown Client';
  };

  const getAssessmentColor = (assessment) => {
    switch (assessment) {
      case 'excellent':
        return '#4caf50';
      case 'satisfactory':
        return '#2196f3';
      case 'needs_improvement':
        return '#ff9800';
      default:
        return '#999';
    }
  };

  const getAssessmentLabel = (assessment) => {
    switch (assessment) {
      case 'excellent':
        return 'Excellent';
      case 'satisfactory':
        return 'Satisfactory';
      case 'needs_improvement':
        return 'Needs Improvement';
      default:
        return assessment;
    }
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h2>Performance Reviews</h2>
        <button
          className="btn btn-primary"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? 'Cancel' : 'Add Review'}
        </button>
      </div>

      {message && (
        <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`}>
          {message}
        </div>
      )}

      {/* Review Form */}
      {showForm && (
        <div className="card card-form">
          <h3>Add Performance Review</h3>
          <form onSubmit={handleSubmitReview}>
            <div className="form-grid-2">
              <div className="form-group">
                <label>Caregiver *</label>
                <select
                  value={formData.caregiverId}
                  onChange={(e) => setFormData({ ...formData, caregiverId: e.target.value })}
                  required
                >
                  <option value="">Select caregiver...</option>
                  {caregivers.map(cg => (
                    <option key={cg.id} value={cg.id}>
                      {cg.first_name} {cg.last_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Client *</label>
                <select
                  value={formData.clientId}
                  onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
                  required
                >
                  <option value="">Select client...</option>
                  {clients.map(client => (
                    <option key={client.id} value={client.id}>
                      {client.first_name} {client.last_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Review Date *</label>
                <input
                  type="date"
                  value={formData.reviewDate}
                  onChange={(e) => setFormData({ ...formData, reviewDate: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label>Overall Assessment *</label>
                <select
                  value={formData.overallAssessment}
                  onChange={(e) => setFormData({ ...formData, overallAssessment: e.target.value })}
                >
                  <option value="excellent">Excellent</option>
                  <option value="satisfactory">Satisfactory</option>
                  <option value="needs_improvement">Needs Improvement</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Performance Notes *</label>
              <textarea
                value={formData.performanceNotes}
                onChange={(e) => setFormData({ ...formData, performanceNotes: e.target.value })}
                placeholder="Detailed notes about this caregiver's performance with this client..."
                rows="4"
                required
              ></textarea>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label>Strengths</label>
                <textarea
                  value={formData.strengths}
                  onChange={(e) => setFormData({ ...formData, strengths: e.target.value })}
                  placeholder="What did this caregiver do well?"
                  rows="3"
                ></textarea>
              </div>

              <div className="form-group">
                <label>Areas for Improvement</label>
                <textarea
                  value={formData.areasForImprovement}
                  onChange={(e) => setFormData({ ...formData, areasForImprovement: e.target.value })}
                  placeholder="What could be improved?"
                  rows="3"
                ></textarea>
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">Save Review</button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Caregivers & Reviews */}
      {caregivers.length === 0 ? (
        <div className="card card-centered">
          <p>No caregivers to review.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '1.5rem' }}>
          {caregivers.map(caregiver => {
            const caregiversReviews = reviews[caregiver.id] || [];
            const isExpanded = expandedCaregiverId === caregiver.id;

            return (
              <div key={caregiver.id} className="card">
                <div
                  onClick={() => setExpandedCaregiverId(isExpanded ? null : caregiver.id)}
                  style={{
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingBottom: '1rem',
                    borderBottom: '1px solid #ddd'
                  }}
                >
                  <div>
                    <h3 style={{ margin: 0 }}>{caregiver.first_name} {caregiver.last_name}</h3>
                    <small style={{ color: '#666' }}>
                      {caregiversReviews.length} review{caregiversReviews.length !== 1 ? 's' : ''}
                    </small>
                  </div>
                  <span style={{ fontSize: '1.2rem' }}>
                    {isExpanded ? '▼' : '▶'}
                  </span>
                </div>

                {isExpanded && (
                  <div style={{ paddingTop: '1rem' }}>
                    {caregiversReviews.length === 0 ? (
                      <p style={{ color: '#999', textAlign: 'center', paddingTop: '1rem' }}>
                        No reviews yet for this caregiver.
                      </p>
                    ) : (
                      <div style={{ display: 'grid', gap: '1rem' }}>
                        {caregiversReviews
                          .sort((a, b) => new Date(b.review_date) - new Date(a.review_date))
                          .map(review => (
                            <div
                              key={review.id}
                              style={{
                                padding: '1rem',
                                background: '#f9f9f9',
                                borderLeft: `4px solid ${getAssessmentColor(review.overall_assessment)}`,
                                borderRadius: '4px'
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.5rem' }}>
                                <div>
                                  <strong>{getClientName(review.client_id)}</strong>
                                  <div style={{ fontSize: '0.85rem', color: '#666' }}>
                                    {new Date(review.review_date).toLocaleDateString()}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                  <span
                                    className="badge"
                                    style={{
                                      background: getAssessmentColor(review.overall_assessment),
                                      color: 'white'
                                    }}
                                  >
                                    {getAssessmentLabel(review.overall_assessment)}
                                  </span>
                                  <button
                                    className="btn btn-sm btn-danger"
                                    onClick={() => handleDeleteReview(review.id)}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>

                              <div style={{ marginBottom: '0.75rem' }}>
                                <strong>Notes:</strong>
                                <p style={{ margin: '0.25rem 0', whiteSpace: 'pre-wrap' }}>
                                  {review.performance_notes}
                                </p>
                              </div>

                              {review.strengths && (
                                <div style={{ marginBottom: '0.75rem' }}>
                                  <strong>Strengths:</strong>
                                  <p style={{ margin: '0.25rem 0', whiteSpace: 'pre-wrap' }}>
                                    {review.strengths}
                                  </p>
                                </div>
                              )}

                              {review.areas_for_improvement && (
                                <div>
                                  <strong>Areas for Improvement:</strong>
                                  <p style={{ margin: '0.25rem 0', whiteSpace: 'pre-wrap' }}>
                                    {review.areas_for_improvement}
                                  </p>
                                </div>
                              )}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PerformanceRatings;

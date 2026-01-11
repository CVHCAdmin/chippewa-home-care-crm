// src/components/admin/PerformanceRatings.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const PerformanceRatings = ({ token }) => {
  const [caregivers, setCaregivers] = useState([]);
  const [ratings, setRatings] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedCaregiverId, setSelectedCaregiverId] = useState(null);
  const [formData, setFormData] = useState({
    rating: 5,
    notes: '',
    ratingDate: new Date().toISOString().split('T')[0]
  });

  useEffect(() => {
    loadCaregivers();
  }, []);

  const loadCaregivers = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/users/caregivers`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setCaregivers(data);
      loadRatings(data);
    } catch (error) {
      console.error('Failed to load caregivers:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadRatings = async (caregiverList) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/performance-ratings`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      const ratingsByCaregiver = {};
      data.forEach(r => {
        if (!ratingsByCaregiver[r.caregiver_id]) {
          ratingsByCaregiver[r.caregiver_id] = [];
        }
        ratingsByCaregiver[r.caregiver_id].push(r);
      });
      setRatings(ratingsByCaregiver);
    } catch (error) {
      console.error('Failed to load ratings:', error);
    }
  };

  const handleSubmitRating = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_BASE_URL}/api/performance-ratings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          caregiverId: selectedCaregiverId,
          rating: parseInt(formData.rating),
          notes: formData.notes,
          ratingDate: formData.ratingDate
        })
      });

      if (!response.ok) throw new Error('Failed to submit rating');

      setFormData({ rating: 5, notes: '', ratingDate: new Date().toISOString().split('T')[0] });
      setSelectedCaregiverId(null);
      loadRatings(caregivers);
      alert('Rating submitted successfully!');
    } catch (error) {
      alert('Failed to submit rating: ' + error.message);
    }
  };

  const calculateAverage = (caregiverId) => {
    const caregiversRatings = ratings[caregiverId] || [];
    if (caregiversRatings.length === 0) return 0;
    const avg = caregiversRatings.reduce((sum, r) => sum + r.rating, 0) / caregiversRatings.length;
    return avg.toFixed(1);
  };

  const renderStars = (rating) => {
    return (
      <span className="stars">
        {[1, 2, 3, 4, 5].map(i => (
          <span key={i} className={`star ${i <= rating ? 'filled' : ''}`}>★</span>
        ))}
      </span>
    );
  };

  return (
    <div>
      <div className="page-header">
        <h2>⭐ Performance Ratings</h2>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner"></div></div>
      ) : caregivers.length === 0 ? (
        <div className="card card-centered">
          <p>No caregivers to rate.</p>
        </div>
      ) : (
        <>
          {/* Rating Form */}
          <div className="card card-form">
            <h3>Submit Performance Rating</h3>
            <form onSubmit={handleSubmitRating}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Caregiver *</label>
                  <select
                    value={selectedCaregiverId || ''}
                    onChange={(e) => setSelectedCaregiverId(e.target.value)}
                    required
                  >
                    <option value="">Select a caregiver...</option>
                    {caregivers.map(cg => (
                      <option key={cg.id} value={cg.id}>
                        {cg.first_name} {cg.last_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Rating Date *</label>
                  <input
                    type="date"
                    value={formData.ratingDate}
                    onChange={(e) => setFormData({ ...formData, ratingDate: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Rating (1-5 Stars) *</label>
                  <div className="star-selector">
                    {[1, 2, 3, 4, 5].map(i => (
                      <button
                        key={i}
                        type="button"
                        className={`star-btn ${parseInt(formData.rating) >= i ? 'selected' : ''}`}
                        onClick={() => setFormData({ ...formData, rating: i })}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                  <small>Selected: {formData.rating} stars</small>
                </div>

                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Notes</label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Add comments about performance..."
                    rows="4"
                  ></textarea>
                </div>
              </div>

              <div className="form-actions">
                <button type="submit" className="btn btn-primary">Submit Rating</button>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => {
                    setSelectedCaregiverId(null);
                    setFormData({ rating: 5, notes: '', ratingDate: new Date().toISOString().split('T')[0] });
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>

          {/* Ratings Summary */}
          <div className="ratings-grid">
            {caregivers.map(caregiver => {
              const avgRating = calculateAverage(caregiver.id);
              const caregiversRatings = ratings[caregiver.id] || [];

              return (
                <div key={caregiver.id} className="card ratings-card">
                  <div className="rating-header">
                    <h4>{caregiver.first_name} {caregiver.last_name}</h4>
                    <div className="rating-average">
                      {renderStars(Math.round(avgRating))}
                      <span className="rating-number">{avgRating}</span>
                    </div>
                  </div>

                  <p className="rating-count">
                    {caregiversRatings.length} rating{caregiversRatings.length !== 1 ? 's' : ''}
                  </p>

                  {caregiversRatings.length > 0 && (
                    <div className="rating-history">
                      <small><strong>Recent:</strong></small>
                      {caregiversRatings.slice(0, 3).map((rating, idx) => (
                        <div key={idx} className="rating-entry">
                          <div>{renderStars(rating.rating)}</div>
                          <div className="rating-date">{new Date(rating.rating_date).toLocaleDateString()}</div>
                          {rating.notes && <div className="rating-notes">{rating.notes}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default PerformanceRatings;

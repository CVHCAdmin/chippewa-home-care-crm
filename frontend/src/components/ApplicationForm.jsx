// src/components/ApplicationForm.jsx - PUBLIC (no auth required)
import React, { useState } from 'react';
import { API_BASE_URL } from '../config';

const ApplicationForm = () => {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    // Personal Info
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    address: '',
    city: '',
    state: 'WI',
    zip: '',
    ssn: '',

    // Experience
    yearsOfExperience: '',
    previousEmployer1: '',
    jobTitle1: '',
    employmentDates1: '',
    previousEmployer2: '',
    jobTitle2: '',
    employmentDates2: '',
    previousEmployer3: '',
    jobTitle3: '',
    employmentDates3: '',

    // Certifications
    hasCNA: false,
    hasLPN: false,
    hasRN: false,
    hasCPR: false,
    hasFirstAid: false,
    otherCertifications: '',

    // References
    reference1Name: '',
    reference1Phone: '',
    reference1Relationship: '',
    reference2Name: '',
    reference2Phone: '',
    reference2Relationship: '',
    reference3Name: '',
    reference3Phone: '',
    reference3Relationship: '',

    // Availability
    availableDaysOfWeek: [],
    preferredHours: '',
    canWorkWeekends: false,
    canWorkNights: false,

    // Expectations & Motivation
    expectedHourlyRate: '',
    motivation: '',
    whyChippewa: '',

    // Agreement
    agreeToBackgroundCheck: false,
    agreeToTerms: false
  });

  const dayLabels = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleDayToggle = (dayIndex) => {
    setFormData(prev => {
      const days = [...prev.availableDaysOfWeek];
      if (days.includes(dayIndex)) {
        return { ...prev, availableDaysOfWeek: days.filter(d => d !== dayIndex) };
      } else {
        return { ...prev, availableDaysOfWeek: [...days, dayIndex].sort() };
      }
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Validation
    if (!formData.firstName || !formData.lastName || !formData.email || !formData.phone) {
      setError('Please fill in all required fields');
      setLoading(false);
      return;
    }

    if (!formData.agreeToBackgroundCheck || !formData.agreeToTerms) {
      setError('Please agree to background check and terms');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/applications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit application');
      }

      setSubmitted(true);
      setFormData({
        firstName: '', lastName: '', email: '', phone: '', dateOfBirth: '',
        address: '', city: '', state: 'WI', zip: '', ssn: '',
        yearsOfExperience: '', previousEmployer1: '', jobTitle1: '', employmentDates1: '',
        previousEmployer2: '', jobTitle2: '', employmentDates2: '',
        previousEmployer3: '', jobTitle3: '', employmentDates3: '',
        hasCNA: false, hasLPN: false, hasRN: false, hasCPR: false, hasFirstAid: false,
        otherCertifications: '',
        reference1Name: '', reference1Phone: '', reference1Relationship: '',
        reference2Name: '', reference2Phone: '', reference2Relationship: '',
        reference3Name: '', reference3Phone: '', reference3Relationship: '',
        availableDaysOfWeek: [], preferredHours: '', canWorkWeekends: false, canWorkNights: false,
        expectedHourlyRate: '', motivation: '', whyChippewa: '',
        agreeToBackgroundCheck: false, agreeToTerms: false
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="application-container">
        <div className="success-box">
          <h2>✅ Application Submitted Successfully!</h2>
          <p>Thank you for applying to Chippewa Valley Home Care.</p>
          <p>We will review your application and contact you within 5-7 business days.</p>
          <p>If you have questions, call us at <strong>(715) 491-1254</strong></p>
        </div>
      </div>
    );
  }

  return (
    <div className="application-container">
      <div className="application-form-card">
        <h1>Apply for Employment</h1>
        <p className="subtitle">Chippewa Valley Home Care is hiring compassionate caregivers</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          {/* PERSONAL INFORMATION */}
          <section className="form-section">
            <h2>Personal Information *</h2>

            <div className="form-grid-2">
              <div className="form-group">
                <label>First Name *</label>
                <input
                  type="text"
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleInputChange}
                  required
                />
              </div>
              <div className="form-group">
                <label>Last Name *</label>
                <input
                  type="text"
                  name="lastName"
                  value={formData.lastName}
                  onChange={handleInputChange}
                  required
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label>Email *</label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  required
                />
              </div>
              <div className="form-group">
                <label>Phone *</label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleInputChange}
                  required
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label>Date of Birth</label>
                <input
                  type="date"
                  name="dateOfBirth"
                  value={formData.dateOfBirth}
                  onChange={handleInputChange}
                />
              </div>
              <div className="form-group">
                <label>Social Security Number</label>
                <input
                  type="text"
                  name="ssn"
                  placeholder="XXX-XX-XXXX"
                  value={formData.ssn}
                  onChange={handleInputChange}
                />
              </div>
            </div>

            <div className="form-group">
              <label>Address</label>
              <input
                type="text"
                name="address"
                value={formData.address}
                onChange={handleInputChange}
              />
            </div>

            <div className="form-grid-3">
              <div className="form-group">
                <label>City</label>
                <input
                  type="text"
                  name="city"
                  value={formData.city}
                  onChange={handleInputChange}
                />
              </div>
              <div className="form-group">
                <label>State</label>
                <input
                  type="text"
                  name="state"
                  maxLength="2"
                  value={formData.state}
                  onChange={handleInputChange}
                />
              </div>
              <div className="form-group">
                <label>Zip Code</label>
                <input
                  type="text"
                  name="zip"
                  value={formData.zip}
                  onChange={handleInputChange}
                />
              </div>
            </div>
          </section>

          {/* EXPERIENCE */}
          <section className="form-section">
            <h2>Work Experience</h2>

            <div className="form-group">
              <label>Years of Experience in Home Care</label>
              <input
                type="number"
                name="yearsOfExperience"
                min="0"
                value={formData.yearsOfExperience}
                onChange={handleInputChange}
              />
            </div>

            <h3>Previous Employers</h3>
            {[1, 2, 3].map(num => (
              <div key={num} className="employer-section">
                <div className="form-grid-2">
                  <div className="form-group">
                    <label>Employer {num}</label>
                    <input
                      type="text"
                      name={`previousEmployer${num}`}
                      value={formData[`previousEmployer${num}`]}
                      onChange={handleInputChange}
                    />
                  </div>
                  <div className="form-group">
                    <label>Job Title</label>
                    <input
                      type="text"
                      name={`jobTitle${num}`}
                      value={formData[`jobTitle${num}`]}
                      onChange={handleInputChange}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label>Employment Dates</label>
                  <input
                    type="text"
                    placeholder="e.g., Jan 2020 - Dec 2022"
                    name={`employmentDates${num}`}
                    value={formData[`employmentDates${num}`]}
                    onChange={handleInputChange}
                  />
                </div>
              </div>
            ))}
          </section>

          {/* CERTIFICATIONS */}
          <section className="form-section">
            <h2>Certifications & Licenses</h2>

            <div className="checkbox-grid">
              {[
                { key: 'hasCNA', label: 'Certified Nursing Assistant (CNA)' },
                { key: 'hasLPN', label: 'Licensed Practical Nurse (LPN)' },
                { key: 'hasRN', label: 'Registered Nurse (RN)' },
                { key: 'hasCPR', label: 'CPR Certification' },
                { key: 'hasFirstAid', label: 'First Aid Certification' }
              ].map(cert => (
                <label key={cert.key} className="checkbox-label">
                  <input
                    type="checkbox"
                    name={cert.key}
                    checked={formData[cert.key]}
                    onChange={handleInputChange}
                  />
                  <span>{cert.label}</span>
                </label>
              ))}
            </div>

            <div className="form-group">
              <label>Other Certifications</label>
              <input
                type="text"
                name="otherCertifications"
                placeholder="e.g., Dementia Care, Medication Management..."
                value={formData.otherCertifications}
                onChange={handleInputChange}
              />
            </div>
          </section>

          {/* REFERENCES */}
          <section className="form-section">
            <h2>Professional References</h2>
            <p className="subtitle">Please provide 3 professional references</p>

            {[1, 2, 3].map(num => (
              <div key={num} className="reference-section">
                <h3>Reference {num}</h3>
                <div className="form-grid-2">
                  <div className="form-group">
                    <label>Name</label>
                    <input
                      type="text"
                      name={`reference${num}Name`}
                      value={formData[`reference${num}Name`]}
                      onChange={handleInputChange}
                    />
                  </div>
                  <div className="form-group">
                    <label>Phone</label>
                    <input
                      type="tel"
                      name={`reference${num}Phone`}
                      value={formData[`reference${num}Phone`]}
                      onChange={handleInputChange}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label>Relationship</label>
                  <input
                    type="text"
                    placeholder="e.g., Former Supervisor, Manager..."
                    name={`reference${num}Relationship`}
                    value={formData[`reference${num}Relationship`]}
                    onChange={handleInputChange}
                  />
                </div>
              </div>
            ))}
          </section>

          {/* AVAILABILITY */}
          <section className="form-section">
            <h2>Availability</h2>

            <div className="form-group">
              <label>Days You Can Work *</label>
              <div className="checkbox-grid">
                {dayLabels.map((day, idx) => (
                  <label key={idx} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={formData.availableDaysOfWeek.includes(idx)}
                      onChange={() => handleDayToggle(idx)}
                    />
                    <span>{day}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>Preferred Hours</label>
              <input
                type="text"
                name="preferredHours"
                placeholder="e.g., 8am-5pm, flexible, part-time..."
                value={formData.preferredHours}
                onChange={handleInputChange}
              />
            </div>

            <div className="checkbox-grid">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="canWorkWeekends"
                  checked={formData.canWorkWeekends}
                  onChange={handleInputChange}
                />
                <span>Available for weekend work</span>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="canWorkNights"
                  checked={formData.canWorkNights}
                  onChange={handleInputChange}
                />
                <span>Available for night shifts</span>
              </label>
            </div>
          </section>

          {/* EXPECTATIONS & MOTIVATION */}
          <section className="form-section">
            <h2>Expectations & Motivation</h2>

            <div className="form-group">
              <label>Expected Hourly Rate</label>
              <input
                type="text"
                name="expectedHourlyRate"
                placeholder="e.g., $15/hour, negotiable..."
                value={formData.expectedHourlyRate}
                onChange={handleInputChange}
              />
            </div>

            <div className="form-group">
              <label>Why are you interested in this position?</label>
              <textarea
                name="motivation"
                placeholder="Tell us about your passion for care work..."
                rows="4"
                value={formData.motivation}
                onChange={handleInputChange}
              ></textarea>
            </div>

            <div className="form-group">
              <label>Why Chippewa Valley Home Care?</label>
              <textarea
                name="whyChippewa"
                placeholder="What appeals to you about working with our company?"
                rows="4"
                value={formData.whyChippewa}
                onChange={handleInputChange}
              ></textarea>
            </div>
          </section>

          {/* AGREEMENTS */}
          <section className="form-section">
            <h2>Agreements *</h2>

            <label className="checkbox-label full-width">
              <input
                type="checkbox"
                name="agreeToBackgroundCheck"
                checked={formData.agreeToBackgroundCheck}
                onChange={handleInputChange}
                required
              />
              <span>I agree to a background check and reference verification *</span>
            </label>

            <label className="checkbox-label full-width">
              <input
                type="checkbox"
                name="agreeToTerms"
                checked={formData.agreeToTerms}
                onChange={handleInputChange}
                required
              />
              <span>I certify that the information provided is true and accurate *</span>
            </label>
          </section>

          {/* SUBMIT */}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary btn-large" disabled={loading}>
              {loading ? 'Submitting...' : 'Submit Application'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ApplicationForm;

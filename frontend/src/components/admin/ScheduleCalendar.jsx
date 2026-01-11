// src/components/admin/ScheduleCalendar.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const ScheduleCalendar = ({ token }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [schedules, setSchedules] = useState([]);
  const [clients, setClients] = useState([]);
  const [caregivers, setCaregivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState(null);
  const [daySchedules, setDaySchedules] = useState([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [schedulesRes, clientsRes, caregiversRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/schedules-all`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/clients`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/users/caregivers`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      const schedulesData = await schedulesRes.json();
      const clientsData = await clientsRes.json();
      const caregiversData = await caregiversRes.json();

      setSchedules(schedulesData);
      setClients(clientsData);
      setCaregivers(caregiversData);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getDaysInMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const getSchedulesForDay = (day) => {
    const targetDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    const dateStr = targetDate.toISOString().split('T')[0];

    return schedules.filter(schedule => {
      if (schedule.date) {
        return schedule.date === dateStr;
      } else if (schedule.day_of_week !== null) {
        return schedule.day_of_week === targetDate.getDay();
      }
      return false;
    });
  };

  const handleDayClick = (day) => {
    const dayScheds = getSchedulesForDay(day);
    setDaySchedules(dayScheds);
    setSelectedDay(day);
  };

  const getCaregiverName = (id) => {
    const cg = caregivers.find(c => c.id === id);
    return cg ? `${cg.first_name} ${cg.last_name}` : 'Unknown';
  };

  const getClientName = (id) => {
    const cl = clients.find(c => c.id === id);
    return cl ? `${cl.first_name} ${cl.last_name}` : 'Unknown';
  };

  const previousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1));
  };

  const monthName = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });
  const daysInMonth = getDaysInMonth(currentDate);
  const firstDay = getFirstDayOfMonth(currentDate);
  const days = [];

  // Add empty cells for days before month starts
  for (let i = 0; i < firstDay; i++) {
    days.push(null);
  }

  // Add days of month
  for (let day = 1; day <= daysInMonth; day++) {
    days.push(day);
  }

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
        <h2>📅 Schedule Calendar</h2>
      </div>

      {/* Calendar Navigation */}
      <div className="calendar-nav">
        <button className="btn btn-secondary" onClick={previousMonth}>← Previous</button>
        <h3>{monthName}</h3>
        <button className="btn btn-secondary" onClick={nextMonth}>Next →</button>
      </div>

      {/* Calendar Grid */}
      <div className="calendar-container">
        <div className="calendar-header">
          <div className="calendar-day-name">Sun</div>
          <div className="calendar-day-name">Mon</div>
          <div className="calendar-day-name">Tue</div>
          <div className="calendar-day-name">Wed</div>
          <div className="calendar-day-name">Thu</div>
          <div className="calendar-day-name">Fri</div>
          <div className="calendar-day-name">Sat</div>
        </div>

        <div className="calendar-grid">
          {days.map((day, idx) => {
            if (day === null) {
              return <div key={`empty-${idx}`} className="calendar-cell empty"></div>;
            }

            const daySchedules = getSchedulesForDay(day);
            const hasSchedules = daySchedules.length > 0;

            return (
              <div
                key={day}
                className={`calendar-cell ${hasSchedules ? 'has-schedules' : ''}`}
                onClick={() => handleDayClick(day)}
              >
                <div className="calendar-day-number">{day}</div>
                <div className="calendar-schedules">
                  {daySchedules.slice(0, 2).map((schedule, idx) => (
                    <div key={idx} className="schedule-preview">
                      <small>{getCaregiverName(schedule.caregiver_id).split(' ')[0]}</small>
                    </div>
                  ))}
                  {daySchedules.length > 2 && (
                    <small className="schedule-more">+{daySchedules.length - 2} more</small>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Daily Schedule Modal */}
      {selectedDay && (
        <div className="modal active">
          <div className="modal-content modal-large">
            <div className="modal-header">
              <h2>
                {new Date(currentDate.getFullYear(), currentDate.getMonth(), selectedDay).toLocaleDateString('default', { 
                  weekday: 'long', 
                  month: 'long', 
                  day: 'numeric' 
                })}
              </h2>
              <button className="close-btn" onClick={() => setSelectedDay(null)}>×</button>
            </div>

            {daySchedules.length === 0 ? (
              <p style={{ padding: '2rem', textAlign: 'center' }}>No schedules for this day</p>
            ) : (
              <div className="daily-schedules">
                {daySchedules.map(schedule => (
                  <div key={schedule.id} className="schedule-item">
                    <div className="schedule-time">
                      <strong>{schedule.start_time} - {schedule.end_time}</strong>
                    </div>
                    <div className="schedule-details">
                      <div className="schedule-person">
                        <strong>Caregiver:</strong>
                        <a 
                          href={`#caregiver/${schedule.caregiver_id}`}
                          className="schedule-link"
                          onClick={(e) => {
                            e.preventDefault();
                            // Will be handled by parent component
                          }}
                        >
                          {getCaregiverName(schedule.caregiver_id)}
                        </a>
                      </div>
                      {schedule.client_id && (
                        <div className="schedule-person">
                          <strong>Client:</strong>
                          <a 
                            href={`#client/${schedule.client_id}`}
                            className="schedule-link"
                            onClick={(e) => {
                              e.preventDefault();
                              // Will be handled by parent component
                            }}
                          >
                            {getClientName(schedule.client_id)}
                          </a>
                        </div>
                      )}
                      {schedule.recurring && (
                        <div className="schedule-recurring">
                          <span className="badge badge-info">Recurring</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setSelectedDay(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScheduleCalendar;

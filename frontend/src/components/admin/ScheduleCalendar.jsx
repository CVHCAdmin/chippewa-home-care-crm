// src/components/admin/ScheduleCalendar.jsx
// Professional scheduling calendar modeled after When I Work / Deputy
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

const ScheduleCalendar = ({ token }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState('month'); // 'month' or 'week'
  const [schedules, setSchedules] = useState([]);
  const [clients, setClients] = useState([]);
  const [caregivers, setCaregivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState(null);
  const [daySchedules, setDaySchedules] = useState([]);
  const [filterCaregiver, setFilterCaregiver] = useState('');
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 640);

  useEffect(() => {
    loadData();
    const handleResize = () => setIsMobile(window.innerWidth <= 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
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

      if (schedulesRes.ok) {
        const schedulesData = await schedulesRes.json();
        setSchedules(Array.isArray(schedulesData) ? schedulesData : []);
      }
      if (clientsRes.ok) {
        const clientsData = await clientsRes.json();
        setClients(Array.isArray(clientsData) ? clientsData : []);
      }
      if (caregiversRes.ok) {
        const caregiversData = await caregiversRes.json();
        setCaregivers(Array.isArray(caregiversData) ? caregiversData : []);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Helper functions
  const getDaysInMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const getFirstDayOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1).getDay();

  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':');
    const h = parseInt(hours);
    const ampm = h >= 12 ? 'pm' : 'am';
    const hour12 = h % 12 || 12;
    return `${hour12}:${minutes}${ampm}`;
  };

  const getCaregiverName = (id) => {
    if (!id) return 'Unassigned';
    const cg = caregivers.find(c => c.id === id);
    return cg ? `${cg.first_name} ${cg.last_name}` : 'Unknown';
  };

  const getCaregiverInitials = (id) => {
    if (!id) return '?';
    const cg = caregivers.find(c => c.id === id);
    return cg ? `${cg.first_name?.[0] || ''}${cg.last_name?.[0] || ''}` : '?';
  };

  const getClientName = (id) => {
    if (!id) return 'No Client';
    const cl = clients.find(c => c.id === id);
    return cl ? `${cl.first_name} ${cl.last_name}` : 'Unknown Client';
  };

  // Get color for caregiver (consistent color per person)
  const getCaregiverColor = (id) => {
    const colors = [
      '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
      '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1'
    ];
    if (!id) return '#9CA3AF';
    const index = caregivers.findIndex(c => c.id === id);
    return colors[index % colors.length];
  };

  // Get schedules for a specific day - FIXED logic
  const getSchedulesForDay = (day) => {
    const targetDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    const targetDayOfWeek = targetDate.getDay();
    
    // Format date for comparison (YYYY-MM-DD)
    const year = targetDate.getFullYear();
    const month = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    const dateStr = `${year}-${month}-${dayStr}`;

    let filtered = schedules.filter(schedule => {
      // Check one-time schedules (specific date)
      if (schedule.date) {
        const scheduleDate = schedule.date.split('T')[0]; // Handle ISO format
        return scheduleDate === dateStr;
      }
      // Check recurring schedules (day of week)
      if (schedule.day_of_week !== null && schedule.day_of_week !== undefined) {
        return schedule.day_of_week === targetDayOfWeek;
      }
      return false;
    });

    // Apply caregiver filter if set
    if (filterCaregiver) {
      filtered = filtered.filter(s => s.caregiver_id === filterCaregiver);
    }

    // Sort by start time
    return filtered.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
  };

  const handleDayClick = (day) => {
    const dayScheds = getSchedulesForDay(day);
    setDaySchedules(dayScheds);
    setSelectedDay(day);
  };

  // Navigation
  const previousMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1));
  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1));
  const goToToday = () => setCurrentDate(new Date());

  // Calculate stats
  const getTotalSchedulesToday = () => {
    const today = new Date();
    if (currentDate.getMonth() === today.getMonth() && currentDate.getFullYear() === today.getFullYear()) {
      return getSchedulesForDay(today.getDate()).length;
    }
    return 0;
  };

  const getTotalSchedulesThisMonth = () => {
    let total = 0;
    const daysInMonth = getDaysInMonth(currentDate);
    for (let day = 1; day <= daysInMonth; day++) {
      total += getSchedulesForDay(day).length;
    }
    return total;
  };

  // Build calendar grid
  const monthName = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });
  const daysInMonth = getDaysInMonth(currentDate);
  const firstDay = getFirstDayOfMonth(currentDate);
  const days = [];

  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let day = 1; day <= daysInMonth; day++) days.push(day);

  const today = new Date();
  const isToday = (day) => 
    day === today.getDate() && 
    currentDate.getMonth() === today.getMonth() && 
    currentDate.getFullYear() === today.getFullYear();

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="schedule-calendar">
      {/* Header */}
      <div className="page-header" style={{ marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>📅 Schedule Calendar</h2>
          <p style={{ margin: '0.25rem 0 0 0', color: '#666', fontSize: '0.9rem' }}>
            {getTotalSchedulesThisMonth()} shifts this month • {getTotalSchedulesToday()} today
          </p>
        </div>
      </div>

      {/* Controls Bar */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ 
          display: 'flex', 
          flexWrap: 'wrap',
          gap: '1rem', 
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          {/* Navigation */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button className="btn btn-secondary btn-sm" onClick={previousMonth}>‹</button>
            <button className="btn btn-secondary btn-sm" onClick={goToToday}>Today</button>
            <button className="btn btn-secondary btn-sm" onClick={nextMonth}>›</button>
            <h3 style={{ margin: '0 0.5rem', fontSize: '1.1rem', minWidth: '150px' }}>{monthName}</h3>
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={filterCaregiver}
              onChange={(e) => setFilterCaregiver(e.target.value)}
              style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ddd', fontSize: '0.9rem' }}
            >
              <option value="">All Caregivers</option>
              {caregivers.map(cg => (
                <option key={cg.id} value={cg.id}>{cg.first_name} {cg.last_name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="card" style={{ padding: 0, overflow: 'visible' }}>
        {/* Day Headers */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(7, 1fr)',
          background: '#f8f9fa',
          borderBottom: '1px solid #e5e7eb'
        }}>
          {(isMobile ? ['S', 'M', 'T', 'W', 'T', 'F', 'S'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).map((day, idx) => (
            <div key={idx} style={{ 
              padding: isMobile ? '0.5rem 0.25rem' : '0.75rem 0.5rem', 
              textAlign: 'center', 
              fontWeight: '600',
              fontSize: isMobile ? '0.75rem' : '0.85rem',
              color: '#374151'
            }}>
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Cells */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(7, 1fr)',
          minHeight: isMobile ? '300px' : '500px'
        }}>
          {days.map((day, idx) => {
            if (day === null) {
              return (
                <div key={`empty-${idx}`} style={{ 
                  background: '#f9fafb',
                  borderRight: '1px solid #e5e7eb',
                  borderBottom: '1px solid #e5e7eb'
                }} />
              );
            }

            const dayScheds = getSchedulesForDay(day);
            const hasSchedules = dayScheds.length > 0;

            return (
              <div
                key={day}
                onClick={() => handleDayClick(day)}
                style={{ 
                  minHeight: isMobile ? '60px' : '100px',
                  padding: isMobile ? '0.25rem' : '0.5rem',
                  borderRight: '1px solid #e5e7eb',
                  borderBottom: '1px solid #e5e7eb',
                  cursor: 'pointer',
                  background: isToday(day) ? '#EFF6FF' : '#fff',
                  transition: 'background 0.15s'
                }}
                onMouseEnter={(e) => !isMobile && (e.currentTarget.style.background = isToday(day) ? '#DBEAFE' : '#f3f4f6')}
                onMouseLeave={(e) => !isMobile && (e.currentTarget.style.background = isToday(day) ? '#EFF6FF' : '#fff')}
              >
                {/* Day Number */}
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  marginBottom: isMobile ? '0.125rem' : '0.25rem'
                }}>
                  <span style={{ 
                    fontWeight: isToday(day) ? '700' : '500',
                    fontSize: isMobile ? '0.75rem' : '0.9rem',
                    color: isToday(day) ? '#2563EB' : '#374151',
                    width: isMobile ? '20px' : '24px',
                    height: isMobile ? '20px' : '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '50%',
                    background: isToday(day) ? '#2563EB' : 'transparent',
                    ...(isToday(day) && { color: '#fff' })
                  }}>
                    {day}
                  </span>
                  {hasSchedules && !isMobile && (
                    <span style={{ 
                      fontSize: '0.7rem', 
                      color: '#6B7280',
                      background: '#E5E7EB',
                      padding: '0.125rem 0.375rem',
                      borderRadius: '10px'
                    }}>
                      {dayScheds.length}
                    </span>
                  )}
                </div>

                {/* Schedule Pills - Desktop: show details, Mobile: show dots */}
                {isMobile ? (
                  hasSchedules && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px', justifyContent: 'center' }}>
                      {dayScheds.slice(0, 3).map((schedule, i) => (
                        <div
                          key={schedule.id || i}
                          style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            background: getCaregiverColor(schedule.caregiver_id)
                          }}
                        />
                      ))}
                      {dayScheds.length > 3 && (
                        <span style={{ fontSize: '0.6rem', color: '#6B7280' }}>+{dayScheds.length - 3}</span>
                      )}
                    </div>
                  )
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {dayScheds.slice(0, 4).map((schedule, i) => (
                      <div
                        key={schedule.id || i}
                        style={{
                          background: getCaregiverColor(schedule.caregiver_id),
                          color: '#fff',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.7rem',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}
                      >
                        {formatTime(schedule.start_time)} {getCaregiverInitials(schedule.caregiver_id)}
                      </div>
                    ))}
                    {dayScheds.length > 4 && (
                      <div style={{ 
                        fontSize: '0.7rem', 
                        color: '#6B7280',
                        textAlign: 'center',
                        fontWeight: '500'
                      }}>
                        +{dayScheds.length - 4} more
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Caregiver Legend */}
      {caregivers.length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', color: '#374151' }}>Caregivers</h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            {caregivers.map(cg => (
              <div 
                key={cg.id} 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '0.5rem',
                  cursor: 'pointer',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '6px',
                  background: filterCaregiver === cg.id ? '#E5E7EB' : 'transparent'
                }}
                onClick={() => setFilterCaregiver(filterCaregiver === cg.id ? '' : cg.id)}
              >
                <div style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '3px',
                  background: getCaregiverColor(cg.id)
                }} />
                <span style={{ fontSize: '0.85rem' }}>{cg.first_name} {cg.last_name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Day Detail Modal */}
      {selectedDay && (
        <div 
          className="modal active" 
          onClick={(e) => e.target === e.currentTarget && setSelectedDay(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem'
          }}
        >
          <div style={{
            background: '#fff',
            borderRadius: '12px',
            width: '100%',
            maxWidth: '500px',
            maxHeight: '80vh',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '1rem 1.25rem',
              borderBottom: '1px solid #e5e7eb',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>
                  {new Date(currentDate.getFullYear(), currentDate.getMonth(), selectedDay).toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    month: 'long', 
                    day: 'numeric' 
                  })}
                </h3>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#6B7280' }}>
                  {daySchedules.length} appointment{daySchedules.length !== 1 ? 's' : ''}
                </p>
              </div>
              <button 
                onClick={() => setSelectedDay(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: '#9CA3AF',
                  padding: '0.25rem'
                }}
              >
                ×
              </button>
            </div>

            {/* Schedule List */}
            <div style={{ 
              flex: 1, 
              overflow: 'auto',
              padding: '1rem'
            }}>
              {daySchedules.length === 0 ? (
                <div style={{ 
                  textAlign: 'center', 
                  padding: '3rem 1rem',
                  color: '#6B7280'
                }}>
                  <p style={{ fontSize: '2rem', margin: '0 0 0.5rem 0' }}>📅</p>
                  <p style={{ margin: 0 }}>No appointments scheduled</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {daySchedules.map((schedule, idx) => (
                    <div 
                      key={schedule.id || idx}
                      style={{
                        display: 'flex',
                        gap: '1rem',
                        padding: '1rem',
                        background: '#f9fafb',
                        borderRadius: '8px',
                        borderLeft: `4px solid ${getCaregiverColor(schedule.caregiver_id)}`
                      }}
                    >
                      {/* Time */}
                      <div style={{ 
                        minWidth: '80px',
                        textAlign: 'center'
                      }}>
                        <div style={{ fontWeight: '600', fontSize: '0.95rem' }}>
                          {formatTime(schedule.start_time)}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#6B7280' }}>
                          {formatTime(schedule.end_time)}
                        </div>
                      </div>

                      {/* Details */}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: '600', marginBottom: '0.25rem' }}>
                          {getClientName(schedule.client_id)}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: '#6B7280', marginBottom: '0.25rem' }}>
                          <span style={{
                            display: 'inline-block',
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: getCaregiverColor(schedule.caregiver_id),
                            marginRight: '0.5rem'
                          }} />
                          {getCaregiverName(schedule.caregiver_id)}
                        </div>
                        {schedule.day_of_week !== null && (
                          <span style={{
                            display: 'inline-block',
                            fontSize: '0.7rem',
                            background: '#DBEAFE',
                            color: '#1D4ED8',
                            padding: '0.125rem 0.5rem',
                            borderRadius: '10px',
                            marginRight: '0.5rem'
                          }}>
                            Recurring
                          </span>
                        )}
                        {schedule.notes && (
                          <p style={{ 
                            margin: '0.5rem 0 0 0', 
                            fontSize: '0.8rem', 
                            color: '#6B7280',
                            fontStyle: 'italic'
                          }}>
                            {schedule.notes}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '1rem 1.25rem',
              borderTop: '1px solid #e5e7eb',
              display: 'flex',
              justifyContent: 'flex-end'
            }}>
              <button 
                className="btn btn-secondary"
                onClick={() => setSelectedDay(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Responsive handled via isMobile state */}
    </div>
  );
};

export default ScheduleCalendar;

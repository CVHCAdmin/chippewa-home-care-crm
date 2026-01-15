// src/components/common/AddressLink.jsx
import React from 'react';

/**
 * Clickable address that opens in Google Maps
 * 
 * Usage:
 * <AddressLink 
 *   address="123 Main St"
 *   city="Eau Claire"
 *   state="WI"
 *   zip="54701"
 * />
 * 
 * Or with full address string:
 * <AddressLink fullAddress="123 Main St, Eau Claire, WI 54701" />
 */
const AddressLink = ({ 
  address, 
  city, 
  state, 
  zip, 
  fullAddress,
  showIcon = true,
  style = {}
}) => {
  // Build full address from parts or use fullAddress prop
  const getFullAddress = () => {
    if (fullAddress) return fullAddress;
    
    const parts = [];
    if (address) parts.push(address);
    if (city) parts.push(city);
    if (state && zip) {
      parts.push(`${state} ${zip}`);
    } else if (state) {
      parts.push(state);
    } else if (zip) {
      parts.push(zip);
    }
    return parts.join(', ');
  };

  const addressString = getFullAddress();
  
  if (!addressString) return <span style={{ color: '#999' }}>No address</span>;

  // Encode address for URL
  const encodedAddress = encodeURIComponent(addressString);
  
  // Google Maps URL - works on both desktop and mobile
  // On mobile, it will open the Maps app if installed
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;

  const handleClick = (e) => {
    e.stopPropagation(); // Prevent triggering parent onClick handlers
    window.open(mapsUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <span
      onClick={handleClick}
      style={{
        color: '#1976d2',
        cursor: 'pointer',
        textDecoration: 'underline',
        textDecorationStyle: 'dotted',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.25rem',
        ...style
      }}
      title="Open in Google Maps"
    >
      {showIcon && <span style={{ fontSize: '0.9em' }}>📍</span>}
      {addressString}
    </span>
  );
};

export default AddressLink;


// =====================================================
// ALTERNATIVE: Simple function you can use anywhere
// =====================================================

/**
 * Simple function to open address in Google Maps
 * 
 * Usage:
 * <span onClick={() => openInMaps('123 Main St, Eau Claire, WI')}>
 *   123 Main St
 * </span>
 */
export const openInMaps = (address) => {
  if (!address) return;
  const encodedAddress = encodeURIComponent(address);
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodedAddress}`, '_blank');
};


// =====================================================
// ALTERNATIVE: Get directions from current location
// =====================================================

/**
 * Open directions in Google Maps from current location
 * 
 * Usage:
 * <button onClick={() => getDirections('123 Main St, Eau Claire, WI')}>
 *   Get Directions
 * </button>
 */
export const getDirections = (destinationAddress) => {
  if (!destinationAddress) return;
  const encodedAddress = encodeURIComponent(destinationAddress);
  // This will prompt for starting location or use current location on mobile
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodedAddress}`, '_blank');
};

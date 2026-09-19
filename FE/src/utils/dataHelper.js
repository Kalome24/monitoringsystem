// src/utils/dataHelper.js

/**
 * Safely extract data from API response
 * @param {Object} response - API response object
 * @param {string} fallbackKey - Optional key to look for
 * @returns {Array} Array of data
 */
export const extractData = (response, fallbackKey = 'data') => {
  if (!response || !response.ok) {
    console.warn('⚠️ Invalid response:', response);
    return [];
  }

  const data = response.data;
  
  if (!data) {
    console.warn('⚠️ No data in response');
    return [];
  }

  // Case 1: data is already an array
  if (Array.isArray(data)) {
    return data;
  }

  // Case 2: data.data is an array
  if (data.data && Array.isArray(data.data)) {
    return data.data;
  }

  // Case 3: data[fallbackKey] is an array
  if (data[fallbackKey] && Array.isArray(data[fallbackKey])) {
    return data[fallbackKey];
  }

  // Case 4: data is an object with array values
  const arrayKeys = Object.keys(data).filter(key => Array.isArray(data[key]));
  if (arrayKeys.length > 0) {
    return data[arrayKeys[0]];
  }

  console.warn('⚠️ Could not extract array from response:', data);
  return [];
};

/**
 * Safely extract a single item from API response
 */
export const extractSingle = (response) => {
  if (!response || !response.ok || !response.data) {
    return null;
  }

  const data = response.data;
  
  // If data has a data property, return that
  if (data.data) {
    return data.data;
  }
  
  // Otherwise return the data itself
  return data;
};

export default {
  extractData,
  extractSingle
};
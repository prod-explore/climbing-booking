/**
 * age.js — a person's age in completed years, from their birth date.
 */

/**
 * @param {string|Date} birthDate  an ISO date string or a Date
 * @returns {number|null}  completed years as of today (local time), or null for a missing or invalid date
 */
function calculateAge(birthDate) {
  if (!birthDate) return null;

  const bd = new Date(birthDate);
  if (isNaN(bd.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - bd.getFullYear();
  const m = today.getMonth() - bd.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) {
    age--;
  }
  return age;
}

module.exports = { calculateAge };

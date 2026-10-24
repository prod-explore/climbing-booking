/**
 * siteSettings.js — the facts about the operator and the venue that the public pages state.
 *
 * Who the data controller is, their tax number and where the classes take place are not code: they differ per
 * deployment and change over time, so they live in the database and are edited in the admin panel
 * (/admin/settings). The templates only print what is configured here.
 *
 * `normalize` turns a submitted form into values that are safe to store (or a list of errors).
 * `resolve` turns the stored values into what the templates print, with a visible placeholder for anything
 * that has not been filled in yet, so an unconfigured site shows what is missing instead of a blank.
 */

'use strict';

/** Polish NIP: ten digits whose weighted sum modulo 11 equals the last digit. */
function isValidNip(digits) {
  if (!/^\d{10}$/.test(digits)) return false;
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  const check = sum % 11;
  return check !== 10 && check === Number(digits[9]);
}

const FIELDS = [
  {
    key: 'org_name',
    label: 'Administrator danych osobowych',
    hint: 'Pełna nazwa, tak jak w rejestrze (firma wraz z imieniem i nazwiskiem właściciela, jeśli to jednoosobowa działalność).',
    max: 150,
    required: true,
    placeholder: '[nazwa administratora danych]'
  },
  {
    key: 'org_seat',
    label: 'Siedziba administratora (miejscowość)',
    hint: 'Np. Katowice.',
    max: 80,
    required: true,
    placeholder: '[siedziba administratora]'
  },
  {
    key: 'org_nip',
    label: 'NIP',
    hint: 'Dziesięć cyfr; myślniki i spacje zostaną usunięte. Można zostawić puste.',
    max: 20,
    required: false,
    placeholder: '',
    normalize: value => value.replace(/[\s-]/g, ''),
    validate: value => (isValidNip(value) ? null : 'NIP musi mieć 10 cyfr i poprawną sumę kontrolną.')
  },
  {
    key: 'venue_name',
    label: 'Nazwa obiektu',
    hint: 'Miejsce, w którym odbywają się zajęcia.',
    max: 80,
    required: true,
    placeholder: '[nazwa obiektu]'
  },
  {
    key: 'venue_street',
    label: 'Ulica i numer obiektu',
    hint: 'Np. ul. Przykładowa 1.',
    max: 80,
    required: true,
    placeholder: '[ulica i numer]'
  },
  {
    key: 'venue_city',
    label: 'Miejscowość (dzielnica) obiektu',
    hint: 'Np. Kraków - Podgórze.',
    max: 80,
    required: true,
    placeholder: '[miejscowość]'
  }
];

const FIELD_KEYS = FIELDS.map(f => f.key);

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/**
 * @param {Record<string, unknown>} input  usually req.body
 * @returns {{ values: Record<string, string>, errors: string[] }}  values holds every field ('' when empty)
 */
function normalize(input = {}) {
  const values = {};
  const errors = [];

  for (const field of FIELDS) {
    const raw = input[field.key];
    let value = typeof raw === 'string' ? raw.replace(CONTROL_CHARS, ' ').trim() : '';
    if (field.normalize) value = field.normalize(value);

    if (value.length > field.max) {
      errors.push(`„${field.label}” może mieć najwyżej ${field.max} znaków.`);
      value = value.slice(0, field.max);
    }
    if (value && field.validate) {
      const problem = field.validate(value);
      if (problem) errors.push(`„${field.label}”: ${problem}`);
    }
    values[field.key] = value;
  }

  return { values, errors };
}

/**
 * What the templates print. Anything not configured shows its placeholder.
 * @param {Record<string, string>} stored  rows of site_settings as an object
 */
function resolve(stored = {}) {
  const site = {};
  const missing = [];

  for (const field of FIELDS) {
    const value = (stored[field.key] || '').trim();
    if (!value && field.required) missing.push(field.key);
    site[field.key] = value || field.placeholder;
  }

  const venueConfigured = !missing.includes('venue_name') && !missing.includes('venue_street') && !missing.includes('venue_city');
  const mapQuery = venueConfigured ? [site.venue_name, site.venue_street, site.venue_city].join(', ') : '';

  site.missing = missing;
  site.hasVenue = venueConfigured;
  site.hasNip = Boolean((stored.org_nip || '').trim());
  site.mapEmbedUrl = mapQuery ? `https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}&hl=pl&output=embed` : '';
  site.mapLinkUrl = mapQuery ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}` : '';
  return site;
}

module.exports = { FIELDS, FIELD_KEYS, normalize, resolve, isValidNip };

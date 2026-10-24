/**
 * qrScan.js — visits from the leaflet QR code, with the visitor's IP address stored only as a keyed hash.
 */

const { getDb } = require('./connection');
const { hashIp } = require('../utils/ipHash');

const QrScanModel = {
  /** Stores a keyed hash of the IP address (utils/ipHash.js), never the address itself. */
  record: (ip, userAgent) =>
    getDb().prepare(
      'INSERT INTO qr_scans (ip, user_agent) VALUES (?, ?)'
    ).run(hashIp(ip), String(userAgent || '').slice(0, 300)),

  getCount: () =>
    getDb().prepare('SELECT COUNT(*) as cnt FROM qr_scans').get().cnt
};


module.exports = { QrScanModel };

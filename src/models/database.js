/**
 * database.js — one entry point for the connection and every model (each lives in its own file in this directory).
 * The rest of the app requires this module rather than the individual files.
 */

const { initDatabase, getDb } = require('./connection');
const { UserModel } = require('./user');
const { MagicTokenModel } = require('./magicToken');
const { ClassModel } = require('./class');
const { BookingModel, SpotsError } = require('./booking');
const { WaitingListModel } = require('./waitingList');
const { QrScanModel } = require('./qrScan');
const { SiteSettingsModel } = require('./siteSettings');

module.exports = { initDatabase, getDb, SpotsError, UserModel, MagicTokenModel, ClassModel, BookingModel, QrScanModel, WaitingListModel, SiteSettingsModel };

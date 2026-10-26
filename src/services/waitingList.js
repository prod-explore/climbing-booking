/**
 * waitingList.js — books people from a class's waiting list when places free up.
 *
 * Called after a booking is cancelled, a participant is removed, or an administrator edits a class (a higher limit).
 * Every person who now fits is booked before the first await, so the bookings are in place by the time the calling
 * request answers; only the e-mails outlive it. It is background work: a failure is logged and never reaches the
 * request that triggered it.
 */

'use strict';

const { ClassModel, WaitingListModel } = require('../models/database');
const { sendWaitingListPromotedEmail } = require('./emailService');
const { appUrl } = require('../utils/appUrl');

async function checkAndPromoteWaitingList(classId) {
  try {
    const classData = ClassModel.getById(classId);
    if (!classData || !classData.waiting_list_enabled) return;

    // Each promotion counts the places inside its own booking transaction; the first one that does not fit ends it.
    const promoted = [];
    for (let entry = WaitingListModel.promoteNext(classId); entry; entry = WaitingListModel.promoteNext(classId)) {
      promoted.push(entry);
    }
    if (!promoted.length) return;

    const classDate = new Date(classData.start_time).toLocaleDateString('pl-PL', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    const dashboardLink = `${appUrl()}/dashboard`;
    const sent = await Promise.allSettled(promoted.map(entry =>
      sendWaitingListPromotedEmail(entry.email, entry.first_name, classData.name, classDate, dashboardLink)));
    sent.forEach((result, i) => {
      if (result.status === 'rejected') console.error(`Waiting-list e-mail to ${promoted[i].email} failed:`, result.reason);
      else console.log(`✅ Przeniesiono ${promoted[i].email} z listy rezerwowej na główną (klasa ${classId})`);
    });
  } catch (err) {
    console.error('Błąd checkAndPromoteWaitingList:', err);
  }
}

module.exports = { checkAndPromoteWaitingList };

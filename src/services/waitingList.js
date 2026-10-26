/**
 * waitingList.js — promotes the first person on a class's waiting list when a place frees up.
 *
 * Called after a booking is cancelled or a participant is removed. It is background work: a failure is logged and
 * never reaches the request that triggered it.
 */

'use strict';

const { ClassModel, WaitingListModel } = require('../models/database');
const { sendWaitingListPromotedEmail } = require('./emailService');
const { appUrl } = require('../utils/appUrl');

async function checkAndPromoteWaitingList(classId) {
  try {
    const classData = ClassModel.getById(classId);
    if (!classData || !classData.waiting_list_enabled) return;

    // The places are counted inside the booking transaction: a full pool promotes nobody.
    const first = WaitingListModel.promoteNext(classId);
    if (!first) return;

    const classDate = new Date(classData.start_time).toLocaleDateString('pl-PL', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    const dashboardLink = `${appUrl()}/dashboard`;
    await sendWaitingListPromotedEmail(first.email, first.first_name, classData.name, classDate, dashboardLink);
    console.log(`✅ Przeniesiono ${first.email} z listy rezerwowej na główną (klasa ${classId})`);
  } catch (err) {
    console.error('Błąd checkAndPromoteWaitingList:', err);
  }
}

module.exports = { checkAndPromoteWaitingList };

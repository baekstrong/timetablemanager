/* global require, exports */
const crypto = require('node:crypto');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { ensureAdmin, loadDailySnapshot } = require('./_coachRenewalSource');
const { getDueCoachReminders, getCoachReminderClock, COACH_REMINDER_PERIODS } = require('../../public/shared/coachRenewalReminder.js');

// UTC; production digest deploys must also set function_schedules explicitly.
exports.config = { schedule: '*/10 0,2,8,10,12 * * 1-5' };

function hasReminderWindow(now) {
  const { minutes, weekday } = getCoachReminderClock(now);
  return weekday >= 1 && weekday <= 5 && COACH_REMINDER_PERIODS.some(period => minutes >= period.startMinute - 30 && minutes < period.startMinute);
}

function reminderMessage(reminder) {
  const parts = [];
  if (reminder.lastNames.length) parts.push(`오늘 마지막 수업: ${reminder.lastNames.join(', ')}`);
  if (reminder.delayedNames.length) parts.push(`미재등록: ${reminder.delayedNames.join(', ')}`);
  return {
    title: `${reminder.period}교시 재등록 안내`, body: parts.join('\n').slice(0, 400),
    tag: `coach-renewal-${reminder.date}-${reminder.period}`, url: './?page=today',
  };
}

function deliveryId(reminder, token) {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return `${reminder.date}-${reminder.period}-${hash}`;
}

async function listCoachDevices(db, auth) {
  const snapshot = await db.collection('users').where('isCoach', '==', true).select('isCoach', 'fcmToken').get();
  const eligible = await Promise.all(snapshot.docs.map(async doc => {
    const user = doc.data();
    if (user.isCoach !== true || typeof user.fcmToken !== 'string' || !user.fcmToken) return null;
    const uid = `u_${crypto.createHash('sha1').update(doc.id).digest('hex')}`;
    try {
      const account = await auth.getUser(uid);
      return account.disabled ? null : { name: doc.id, token: user.fcmToken };
    } catch (error) {
      if (error.code === 'auth/user-not-found') return null;
      throw new Error('Coach identity unavailable');
    }
  }));
  return [...new Map(eligible.filter(Boolean).map(item => [item.token, item])).values()];
}

async function claimDelivery(db, reminder, device) {
  const ref = db.collection('coachRenewalDeliveries').doc(deliveryId(reminder, device.token));
  return db.runTransaction(async transaction => {
    const existing = await transaction.get(ref);
    // Claims survive ambiguous transport errors: never repeat a possibly delivered push.
    if (existing.exists) return null;
    transaction.create(ref, {
      date: reminder.date, period: reminder.period, status: 'claimed',
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.parse(`${reminder.date}T00:00:00+09:00`) + 45 * 86400000),
    });
    return ref;
  });
}

// Dependency injection keeps tests entirely offline, including ledger writes.
async function runScheduledReminder({ now = new Date(), loadSnapshot = loadDailySnapshot, devices, claim, send, finish } = {}) {
  if (!hasReminderWindow(now)) return { due: 0, sent: 0, failed: 0 };
  const { date } = getCoachReminderClock(now);
  const snapshot = await loadSnapshot(date, { refresh: true });
  const due = getDueCoachReminders(snapshot, now);
  if (!due.length) return { due: 0, sent: 0, failed: 0 };
  const targets = await devices();
  let sent = 0;
  let failed = 0;
  for (const reminder of due) {
    for (const device of targets) {
      const receipt = await claim(reminder, device);
      if (!receipt) continue;
      let state = 'unknown';
      try {
        await send(device, reminderMessage(reminder), Math.max(1, (reminder.startMinute - getCoachReminderClock(now).minutes) * 60));
        sent += 1;
        state = 'sent';
      } catch (error) {
        failed += 1;
        // Only the code is propagated to cleanup, never provider text or a token.
        state = error.code === 'messaging/registration-token-not-registered' ? 'stale-token' : 'unknown';
      }
      await finish(receipt, state, device);
    }
  }
  return { due: due.length, sent, failed };
}

exports.handler = async () => {
  const now = new Date();
  if (!hasReminderWindow(now)) return { statusCode: 200 };
  try {
    ensureAdmin();
    const db = getFirestore();
    const result = await runScheduledReminder({ now,
      devices: () => listCoachDevices(db, getAuth()),
      claim: (reminder, device) => claimDelivery(db, reminder, device),
      send: (device, data, ttl) => getMessaging().send({ token: device.token, data,
        webpush: { headers: { Urgency: 'high', TTL: String(ttl) } } }),
      finish: async (receipt, state, device) => {
        await receipt.update({ status: state, completedAt: FieldValue.serverTimestamp() });
        if (state === 'stale-token') {
          const userRef = db.collection('users').doc(device.name);
          await db.runTransaction(async transaction => {
            const fresh = await transaction.get(userRef);
            if (fresh.data()?.fcmToken === device.token) transaction.update(userRef, { fcmToken: FieldValue.delete() });
          });
        }
      },
    });
    // Aggregate only. Student names, coach names and device identifiers stay out of logs.
    console.log('coach-renewal reminder complete', result);
    return { statusCode: 200 };
  } catch {
    console.error('coach-renewal reminder unavailable');
    return { statusCode: 500 };
  }
};

exports.hasReminderWindow = hasReminderWindow;
exports.reminderMessage = reminderMessage;
exports.deliveryId = deliveryId;
exports.listCoachDevices = listCoachDevices;
exports.claimDelivery = claimDelivery;
exports.runScheduledReminder = runScheduledReminder;

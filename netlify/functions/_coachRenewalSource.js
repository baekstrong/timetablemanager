/* global require, module, process */
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { sheets: sheetsApi, auth: googleAuth } = require('@googleapis/sheets');
const { PERIODS, KOREAN_HOLIDAYS } = require('../../src/data/mockData.js');
const { registrationRanges, registrationsFromRanges, buildDailySnapshot, addDays, weekday } = require('./_coachRenewalLib');

function ensureAdmin() {
  if (!getApps().length) initializeApp({ credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  }) });
}

let sheetsClient;
function getSheetsClient() {
  if (!sheetsClient) {
    let privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    const rawKey = privateKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s|"/g, '');
    if (rawKey) privateKey = `-----BEGIN PRIVATE KEY-----\n${rawKey.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
    if (!process.env.GOOGLE_CLIENT_EMAIL || !privateKey) throw new Error('Sheets credential unavailable');
    const auth = new googleAuth.GoogleAuth({ credentials: {
      project_id: process.env.GOOGLE_PROJECT_ID, client_email: process.env.GOOGLE_CLIENT_EMAIL, private_key: privateKey,
    }, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
    sheetsClient = sheetsApi({ version: 'v4', auth });
  }
  return sheetsClient;
}

async function readRegistrations(date) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID || process.env.VITE_GOOGLE_SHEETS_ID;
  if (!spreadsheetId) throw new Error('Spreadsheet unavailable');
  const client = getSheetsClient();
  const metadata = await client.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' }, { timeout: 8000 });
  const ranges = registrationRanges((metadata.data.sheets || []).map(sheet => sheet.properties.title), date);
  if (!ranges.some(range => range.recent)) throw new Error('Registration sheets unavailable');
  // B:O excludes contact details; old sheets contribute paused memberships only.
  const response = await client.spreadsheets.values.batchGet({ spreadsheetId, ranges: ranges.map(range => range.range), valueRenderOption: 'FORMATTED_VALUE' }, { timeout: 12000 });
  return registrationsFromRanges(ranges, response.data.valueRanges || []);
}

const rows = snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
async function readDailySource(date) {
  ensureAdmin();
  const db = getFirestore();
  const monday = addDays(date, weekday(date) === 0 ? 1 : 1 - weekday(date));
  const nextFriday = addDays(monday, 11);
  const makeupFields = ['studentName', 'status', 'originalClass', 'makeupClass'];
  const [registrations, destination, original, absences, holidays, disabled, holdings] = await Promise.all([
    readRegistrations(date),
    db.collection('makeupRequests').where('makeupClass.date', '>=', monday).where('makeupClass.date', '<=', nextFriday).select(...makeupFields).get(),
    db.collection('makeupRequests').where('originalClass.date', '>=', monday).where('originalClass.date', '<=', nextFriday).select(...makeupFields).get(),
    db.collection('absenceRequests').where('date', '==', date).where('status', '==', 'active').select('studentName', 'date').get(),
    db.collection('holidays').where('date', '==', date).select('date').get(),
    db.collection('disabledClasses').select('key').get(),
    db.collection('holdingRequests').where('endDate', '>=', date).select('studentName', 'startDate', 'endDate', 'holdingDates', 'status').get(),
  ]);
  return { date, registrations,
    makeups: [...new Map([...rows(destination), ...rows(original)].map(item => [item.id, item])).values()],
    absences: rows(absences), holidays: rows(holidays), disabledClasses: rows(disabled).map(item => item.key),
    holdings: rows(holdings).filter(item => item.status === 'active' && item.startDate <= date), periods: PERIODS, koreanHolidays: KOREAN_HOLIDAYS };
}

function createDailySnapshotLoader({ readSource = readDailySource, now = Date.now, ttlMs = 60000 } = {}) {
  let cached;
  let inFlight;
  return async function load(date, { refresh = false } = {}) {
    if (refresh && cached?.date === date) cached = null;
    if (!refresh && cached?.date === date && now() - cached.at < ttlMs) return cached.value;
    if (inFlight?.date === date) {
      if (!refresh) return inFlight.promise;
      // A renewal may have been saved after this read started. Share one fresh
      // follow-up instead of acknowledging the pre-write result as refreshed.
      if (!inFlight.queued) inFlight.queued = inFlight.promise.catch(() => {}).then(() => load(date, { refresh: true }));
      return inFlight.queued;
    }
    const request = { date };
    request.promise = Promise.resolve().then(() => readSource(date)).then(source => {
      const value = buildDailySnapshot(source);
      cached = { date, value, at: now() };
      return value;
    }).finally(() => { if (inFlight === request) inFlight = null; });
    inFlight = request;
    return request.promise;
  };
}

const loadDailySnapshot = createDailySnapshotLoader();
module.exports = { ensureAdmin, readDailySource, createDailySnapshotLoader, loadDailySnapshot };

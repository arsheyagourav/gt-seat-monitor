const term = '202702';
const courses = {'27944': 'CS 6474 A — Social Computing', '30595': 'CSE 8803 ASI — AI for Social Impact'};
export function parse(html) {
  const result = {};
  for (const label of ['Enrollment Actual', 'Enrollment Maximum', 'Enrollment Seats Available', 'Waitlist Seats Available']) {
    const pattern = new RegExp(label + ':<\\/span>\\s*<span[^>]*>\\s*(-?\\d+)\\s*<\\/span>', 'g');
    const matches = [...html.matchAll(pattern)];
    if (matches.length !== 1) throw new Error('Missing/invalid field: ' + label);
    result[label] = Number(matches[0][1]);
  }
  return result;
}
export function nextState(previous, counts, now, name, crn) {
  const open = counts['Enrollment Seats Available'] > 0;
  const seq = (previous?.seq || 0) + (open && !previous?.open ? 1 : 0);
  let pending = previous?.pending || null;
  if (!open) pending = null;
  else if (!previous?.open) pending = {
    key: `gt-${term}-${crn}-${seq}`, created: now,
    subject: `Seat available: ${name} (CRN ${crn})`,
    body: `${name}\nTerm ${term}, CRN ${crn}\nSeats available: ${counts['Enrollment Seats Available']}\nEnrollment: ${counts['Enrollment Actual']}/${counts['Enrollment Maximum']}\nObserved: ${new Date(now).toISOString()}\n\nRegister: https://oscar.coda.gatech.edu/\nSeats can disappear or be reserved/restricted. This is not a registration guarantee.`
  };
  if (pending && now - pending.created > 600000) pending = null;
  return {open, seq, checked: now, counts, pending};
}
async function check(env, crn, name) {
  const url = `https://registration.banner.gatech.edu/StudentRegistrationSsb/ssb/searchResults/getEnrollmentInfo?term=${term}&courseReferenceNumber=${crn}`;
  const response = await fetch(url, {signal: AbortSignal.timeout(15000), headers: {'Cache-Control': 'no-cache'}});
  if (!response.ok) throw new Error(`Georgia Tech HTTP ${response.status}`);
  const html = await response.text();
  if (html.length > 262144) throw new Error('Oversized response');
  const counts = parse(html);
  const identity = `${term}:${crn}`;
  const row = await env.DB.prepare('SELECT payload FROM states WHERE id=?').bind(identity).first();
  const state = nextState(row ? JSON.parse(row.payload) : null, counts, Date.now(), name, crn);
  // Save before sending so retries reuse the same message and provider idempotency key.
  await env.DB.prepare('INSERT OR REPLACE INTO states(id,payload) VALUES(?,?)').bind(identity, JSON.stringify(state)).run();
  console.log(crn, 'seats', counts['Enrollment Seats Available']);
  if (!state.pending) return;
  const pending = state.pending;
  const sent = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: {'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': pending.key},
    body: JSON.stringify({from: 'Seat Monitor <onboarding@resend.dev>', to: ['arsheya.gourav29@gmail.com'], subject: pending.subject, text: pending.body})
  });
  if (!sent.ok || !(await sent.json()).id) throw new Error(`Email not accepted (HTTP ${sent.status})`);
  state.pending = null;
  await env.DB.prepare('UPDATE states SET payload=? WHERE id=?').bind(JSON.stringify(state), identity).run();
  console.log('Email accepted for', crn);
}
async function deliveryTest(env) {
  const id = 'delivery-test:202702:v1';
  const now = Date.now();
  await env.DB.prepare('INSERT OR IGNORE INTO states(id,payload) VALUES(?,?)').bind(id, JSON.stringify({created: now, sent: false})).run();
  const row = await env.DB.prepare('SELECT payload FROM states WHERE id=?').bind(id).first();
  const state = JSON.parse(row.payload);
  if (state.sent || now - state.created > 600000) return;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: {'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': 'gt-delivery-test-202702-v1'},
    body: JSON.stringify({from: 'Seat Monitor <onboarding@resend.dev>', to: ['arsheya.gourav29@gmail.com'],
      subject: 'Georgia Tech seat monitor — email delivery test',
      text: 'This is a test from your Cloudflare-hosted monitor for Spring 2027: CS 6474 A (27944) and CSE 8803 ASI (30595). This message does not mean a seat is available. The monitor is scheduled to check about once a minute. Successful seat checks must be verified separately in its logs.'})
  });
  if (!response.ok || !(await response.json()).id) throw new Error(`Delivery test HTTP ${response.status}`);
  await env.DB.prepare('UPDATE states SET payload=? WHERE id=?').bind(JSON.stringify({...state, sent: true, accepted: Date.now()}), id).run();
  console.log('Delivery test email accepted');
}
export default {
  async scheduled(event, env) {
    if (!env.RESEND_API_KEY) throw new Error('Missing email API secret');
    // Atomic short lease prevents overlapping invocations from duplicating state transitions.
    const now = Date.now();
    const lock = await env.DB.prepare('UPDATE locks SET until_ms=? WHERE id=1 AND until_ms<?').bind(now + 120000, now).run();
    if (!lock.meta.changes) return;
    for (const [crn, name] of Object.entries(courses)) {
      try { await check(env, crn, name); }
      catch (error) { console.error(crn, error.message); }
    }
    try { await deliveryTest(env); } catch (error) { console.error(error.message); }
    await env.DB.prepare('UPDATE locks SET until_ms=0 WHERE id=1 AND until_ms=?').bind(now + 120000).run();
  },
  fetch() { return new Response('Not found', {status: 404}); }
};

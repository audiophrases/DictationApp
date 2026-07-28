// Self-service links for students who can't get in, shared with pinplay so a
// student meets the same two doors in both apps.
//
// Neither is part of this app: the roster is a Google Sheet, so signing up is a
// Google Form the teacher reads, and the lookup is an Apps Script page that
// identifies the student by the school Google account they are already signed
// into and shows them their own row. That is why "forgot password" needs no
// email sending, no reset tokens and no new endpoints here — the school's
// Google sign-in is the proof of identity.
//
// Same values as pinplay/index.html:39 and pinplay/play.js:6. Set either to ''
// to hide that link.

export const STUDENT_SIGNUP_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSeTNwOWzYnSR6V6fsSghUkyZLvbhnE5vvcxBYxlj0b0FWpY-g/viewform';

// Requires the student to be signed into their school Google account; it looks
// their row up by that address and shows the username and password back.
export const STUDENT_LOGIN_LOOKUP_URL =
  'https://script.google.com/macros/s/AKfycbz5lL1e-bzNT8moViNmCzYEf2tiyCEU_j8BmHlQ_8Lvqhryj7dsoAo8yCiFoS4WWc7mqw/exec';

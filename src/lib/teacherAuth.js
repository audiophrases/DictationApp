// The teacher's password, held in a module variable for the life of the page
// and nowhere else.
//
// Deliberately not in localStorage: this app runs on shared classroom machines,
// and a password sitting in storage on a computer a student will use next is a
// worse outcome than typing it again after a refresh. Same reasoning (and the
// same shape) as pinplay's createSessionPassword.
//
// It travels with every teacher request because the worker has no sessions —
// see the note at the top of cloudflare/worker.js.

let password = '';

export function getTeacherPassword() {
  return password;
}

export function setTeacherPassword(value) {
  password = String(value || '');
}

export function hasTeacherPassword() {
  return password.length > 0;
}

export function clearTeacherPassword() {
  password = '';
}

// Outbound email. Every raw send is gated by assertCanSend (see the gate-coverage probe).
import type { DbRecord } from "./db.js";

/** The send gate. Real code would check consent / suppressions here. */
export function assertCanSend(_r: DbRecord): boolean {
  return true;
}

/** Raw send primitive. Only ever called after assertCanSend, in this file. */
export function sendEmail(_to: string, _body: string): void {
  // ...send (stub)...
}

/** The sanctioned send path: gate first, then send. */
export function notifyCustomer(r: DbRecord): void {
  if (!assertCanSend(r)) return;
  sendEmail(r.id, `status: ${r.status}`);
}

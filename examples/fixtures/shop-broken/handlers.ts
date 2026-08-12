// ⚠️ DEMO: intentionally broken — reaches into db directly (the layer-rules probe flags
// handlers importing persistence), and calls sendEmail without the gate (gate-coverage).
import { placeOrder } from "./domain.js";
import { notifyCustomer, sendEmail } from "./email.js";
import { load } from "./db.js";
import type { Phase } from "./phases.js";

export function checkout(id: string): Phase {
  const rec = placeOrder(id);
  load(id); // ⚠️ handlers should not touch db
  sendEmail(id, "ok"); // ⚠️ raw send, bypasses the gate
  notifyCustomer(rec);
  return "checkout";
}

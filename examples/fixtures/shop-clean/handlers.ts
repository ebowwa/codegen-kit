// Request handlers. Depends on domain + email + the Phase type — never on db, and never
// calls the raw sendEmail primitive directly (it goes through the gated notifyCustomer).
import { placeOrder } from "./domain.js";
import { notifyCustomer } from "./email.js";
import type { Phase } from "./phases.js";

export function checkout(id: string): Phase {
  const rec = placeOrder(id);
  notifyCustomer(rec); // gated send
  return "checkout";
}

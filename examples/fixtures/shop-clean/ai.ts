// Generative layer. May read domain, but must NOT reach into persistence (db) — see the
// symbol-isolation probe (the "generative boundary").
import { placeOrder } from "./domain.js";

export function suggestNextAction(id: string): string {
  placeOrder(id); // exercise domain logic
  return "follow-up";
}

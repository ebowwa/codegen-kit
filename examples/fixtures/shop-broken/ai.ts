// ⚠️ DEMO: intentionally broken — imports db, breaching the generative boundary (the
// symbol-isolation probe flags ai importing persistence), and calls eval() (the custom
// no-eval probe in examples/custom-probe-demo.ts).
import { placeOrder } from "./domain.js";
import { load } from "./db.js";

export function suggestNextAction(id: string): string {
  placeOrder(id);
  load(id); // ⚠️ ai must not touch db
  eval("demo"); // ⚠️ eval forbidden by the custom probe
  return "follow-up";
}

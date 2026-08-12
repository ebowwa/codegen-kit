// ⚠️ DEMO: intentionally broken — imports domain back, creating a domain <-> db cycle
// (the no-cycles probe flags it). In the clean fixture db.ts imports nothing.
import { placeOrder } from "./domain.js";

export interface DbRecord {
  id: string;
  status: string;
}

export function save(_r: DbRecord): void {
  // ...persist (stub for the demo)...
}

export function load(_id: string): DbRecord | undefined {
  return undefined;
}

// Exists only so the back-import is used (the static cycle comes from the import edge itself).
export function _touchDomain(): void {
  placeOrder("demo");
}

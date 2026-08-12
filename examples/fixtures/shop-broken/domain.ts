// Domain logic. Depends on the persistence leaf (domain -> db).
// (In this broken fixture, db.ts imports domain back → a domain <-> db cycle.)
import { save, load, type DbRecord } from "./db.js";

export function placeOrder(id: string): DbRecord {
  const existing = load(id);
  if (existing) return existing;
  const rec: DbRecord = { id, status: "cart" };
  save(rec);
  return rec;
}

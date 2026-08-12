// Domain logic. Depends on the persistence leaf (domain -> db).
import { save, load, type DbRecord } from "./db.js";

export function placeOrder(id: string): DbRecord {
  const existing = load(id);
  if (existing) return existing;
  const rec: DbRecord = { id, status: "cart" };
  save(rec);
  return rec;
}

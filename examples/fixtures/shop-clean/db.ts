// Persistence leaf. Depends on nothing else in this service — everything flows down to it.
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

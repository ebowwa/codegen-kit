// ⚠️ DEMO: intentionally broken — adds "refunded", drifting from the fingerprint baseline
// (the fingerprint probe expects only cart / checkout / fulfilled).
export type Phase = "cart" | "checkout" | "fulfilled" | "refunded";

// Source of truth for the systems demo: a tiny type catalog that generate-types derives from.
export interface Spec {
  name: string;
  kind: "scalar" | "object";
}

export const SPECS: Spec[] = [
  { name: "Order", kind: "object" },
  { name: "OrderId", kind: "scalar" },
];

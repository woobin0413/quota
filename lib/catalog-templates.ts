/**
 * Starter Catalog Templates
 *
 * Industry-standard work items by trade, offered as one-click imports
 * when a contractor's catalog is empty. Prices are conservative
 * defaults — contractors are expected to adjust them to their market.
 */

import type { CreateWorkItemInput } from "@/types/database";

export const TRADES = [
  "general",
  "electrical",
  "plumbing",
  "hvac",
  "carpentry",
  "painting",
  "landscaping",
] as const;

export type Trade = (typeof TRADES)[number];

export const TRADE_LABELS: Record<Trade, string> = {
  general: "General Contracting",
  electrical: "Electrical",
  plumbing: "Plumbing",
  hvac: "HVAC",
  carpentry: "Carpentry",
  painting: "Painting",
  landscaping: "Landscaping",
};

export const CATALOG_TEMPLATES: Record<Trade, CreateWorkItemInput[]> = {
  general: [
    { name: "General labor", unitOfMeasure: "hours", defaultUnitPrice: 75, category: "general" },
    { name: "Demolition", unitOfMeasure: "hours", defaultUnitPrice: 65, category: "general" },
    { name: "Debris removal & disposal", unitOfMeasure: "each", defaultUnitPrice: 350, category: "general" },
    { name: "Drywall installation", unitOfMeasure: "sqft", defaultUnitPrice: 2.5, category: "general" },
    { name: "Drywall repair", unitOfMeasure: "each", defaultUnitPrice: 250, category: "general" },
    { name: "Flooring installation (laminate)", unitOfMeasure: "sqft", defaultUnitPrice: 4, category: "general" },
    { name: "Tile installation", unitOfMeasure: "sqft", defaultUnitPrice: 12, category: "general" },
    { name: "Permit fees", unitOfMeasure: "each", defaultUnitPrice: 500, category: "general" },
  ],
  electrical: [
    { name: "Electrician labor", unitOfMeasure: "hours", defaultUnitPrice: 100, category: "electrical" },
    { name: "Outlet installation", unitOfMeasure: "each", defaultUnitPrice: 150, category: "electrical" },
    { name: "Switch installation", unitOfMeasure: "each", defaultUnitPrice: 125, category: "electrical" },
    { name: "Light fixture installation", unitOfMeasure: "each", defaultUnitPrice: 175, category: "electrical" },
    { name: "Ceiling fan installation", unitOfMeasure: "each", defaultUnitPrice: 250, category: "electrical" },
    { name: "Panel upgrade (200A)", unitOfMeasure: "each", defaultUnitPrice: 2500, category: "electrical" },
    { name: "Circuit installation", unitOfMeasure: "each", defaultUnitPrice: 400, category: "electrical" },
    { name: "EV charger installation", unitOfMeasure: "each", defaultUnitPrice: 850, category: "electrical" },
  ],
  plumbing: [
    { name: "Plumber labor", unitOfMeasure: "hours", defaultUnitPrice: 110, category: "plumbing" },
    { name: "Faucet installation", unitOfMeasure: "each", defaultUnitPrice: 225, category: "plumbing" },
    { name: "Toilet installation", unitOfMeasure: "each", defaultUnitPrice: 350, category: "plumbing" },
    { name: "Water heater installation (tank)", unitOfMeasure: "each", defaultUnitPrice: 1400, category: "plumbing" },
    { name: "Garbage disposal installation", unitOfMeasure: "each", defaultUnitPrice: 275, category: "plumbing" },
    { name: "Drain cleaning", unitOfMeasure: "each", defaultUnitPrice: 250, category: "plumbing" },
    { name: "Pipe repair", unitOfMeasure: "each", defaultUnitPrice: 300, category: "plumbing" },
    { name: "Sump pump installation", unitOfMeasure: "each", defaultUnitPrice: 1100, category: "plumbing" },
  ],
  hvac: [
    { name: "HVAC labor", unitOfMeasure: "hours", defaultUnitPrice: 100, category: "hvac" },
    { name: "AC unit installation", unitOfMeasure: "each", defaultUnitPrice: 4500, category: "hvac" },
    { name: "Furnace installation", unitOfMeasure: "each", defaultUnitPrice: 3800, category: "hvac" },
    { name: "Ductwork installation", unitOfMeasure: "lf", defaultUnitPrice: 35, category: "hvac" },
    { name: "Thermostat installation", unitOfMeasure: "each", defaultUnitPrice: 250, category: "hvac" },
    { name: "Seasonal maintenance / tune-up", unitOfMeasure: "each", defaultUnitPrice: 180, category: "hvac" },
    { name: "Mini-split installation", unitOfMeasure: "each", defaultUnitPrice: 3200, category: "hvac" },
  ],
  carpentry: [
    { name: "Carpenter labor", unitOfMeasure: "hours", defaultUnitPrice: 65, category: "carpentry" },
    { name: "Interior door installation", unitOfMeasure: "each", defaultUnitPrice: 350, category: "carpentry" },
    { name: "Exterior door installation", unitOfMeasure: "each", defaultUnitPrice: 650, category: "carpentry" },
    { name: "Baseboard/trim installation", unitOfMeasure: "lf", defaultUnitPrice: 6, category: "carpentry" },
    { name: "Crown molding installation", unitOfMeasure: "lf", defaultUnitPrice: 9, category: "carpentry" },
    { name: "Custom shelving", unitOfMeasure: "lf", defaultUnitPrice: 85, category: "carpentry" },
    { name: "Deck construction", unitOfMeasure: "sqft", defaultUnitPrice: 45, category: "carpentry" },
    { name: "Framing", unitOfMeasure: "sqft", defaultUnitPrice: 12, category: "carpentry" },
  ],
  painting: [
    { name: "Painter labor", unitOfMeasure: "hours", defaultUnitPrice: 50, category: "painting" },
    { name: "Interior painting (walls)", unitOfMeasure: "sqft", defaultUnitPrice: 2.25, category: "painting" },
    { name: "Ceiling painting", unitOfMeasure: "sqft", defaultUnitPrice: 2.75, category: "painting" },
    { name: "Exterior painting", unitOfMeasure: "sqft", defaultUnitPrice: 3.5, category: "painting" },
    { name: "Cabinet painting/refinishing", unitOfMeasure: "each", defaultUnitPrice: 120, category: "painting" },
    { name: "Trim & door painting", unitOfMeasure: "lf", defaultUnitPrice: 3, category: "painting" },
    { name: "Drywall priming", unitOfMeasure: "sqft", defaultUnitPrice: 1, category: "painting" },
  ],
  landscaping: [
    { name: "Landscaper labor", unitOfMeasure: "hours", defaultUnitPrice: 55, category: "landscaping" },
    { name: "Lawn installation (sod)", unitOfMeasure: "sqft", defaultUnitPrice: 2, category: "landscaping" },
    { name: "Mulch installation", unitOfMeasure: "each", defaultUnitPrice: 85, category: "landscaping" },
    { name: "Tree planting", unitOfMeasure: "each", defaultUnitPrice: 300, category: "landscaping" },
    { name: "Shrub planting", unitOfMeasure: "each", defaultUnitPrice: 95, category: "landscaping" },
    { name: "Paver patio installation", unitOfMeasure: "sqft", defaultUnitPrice: 22, category: "landscaping" },
    { name: "Fence installation (wood)", unitOfMeasure: "lf", defaultUnitPrice: 35, category: "landscaping" },
    { name: "Irrigation system installation", unitOfMeasure: "each", defaultUnitPrice: 3500, category: "landscaping" },
  ],
};

export function isTrade(value: string): value is Trade {
  return (TRADES as readonly string[]).includes(value);
}

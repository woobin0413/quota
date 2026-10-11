/**
 * Quote Calculations
 *
 * Pure functions for calculating quote totals, taxes, and formatting.
 */

// =====================================================
// TYPES
// =====================================================

export interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  total: number; // calculated
}

export interface QuoteCalculations {
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
}

// =====================================================
// LINE ITEM CALCULATIONS
// =====================================================

/**
 * Calculate line item total
 */
export function calculateLineItemTotal(
  quantity: number,
  unitPrice: number
): number {
  return roundCurrency(quantity * unitPrice);
}

/**
 * Calculate line item with total
 */
export function calculateLineItem(
  item: Omit<LineItem, "total">
): LineItem {
  return {
    ...item,
    total: calculateLineItemTotal(item.quantity, item.unitPrice),
  };
}

// =====================================================
// QUOTE CALCULATIONS
// =====================================================

/**
 * Calculate subtotal from line items
 */
export function calculateSubtotal(lineItems: LineItem[]): number {
  const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
  return roundCurrency(subtotal);
}

/**
 * Calculate tax amount
 */
export function calculateTaxAmount(
  subtotal: number,
  taxRate: number
): number {
  return roundCurrency((subtotal * taxRate) / 100);
}

/**
 * Calculate discount amount (can be percentage or fixed)
 */
export function calculateDiscountAmount(
  subtotal: number,
  discount: number,
  isPercentage: boolean = false
): number {
  if (isPercentage) {
    return roundCurrency((subtotal * discount) / 100);
  }
  return roundCurrency(discount);
}

/**
 * Calculate grand total
 */
export function calculateTotal(
  subtotal: number,
  taxAmount: number,
  discountAmount: number
): number {
  const total = subtotal + taxAmount - discountAmount;
  return roundCurrency(Math.max(0, total)); // Never negative
}

/**
 * Calculate all quote totals at once
 */
export function calculateQuoteTotals(
  lineItems: LineItem[],
  taxRate: number,
  discount: number = 0,
  isDiscountPercentage: boolean = false
): QuoteCalculations {
  const subtotal = calculateSubtotal(lineItems);
  const taxAmount = calculateTaxAmount(subtotal, taxRate);
  const discountAmount = calculateDiscountAmount(
    subtotal,
    discount,
    isDiscountPercentage
  );
  const total = calculateTotal(subtotal, taxAmount, discountAmount);

  return {
    subtotal,
    taxAmount,
    discountAmount,
    total,
  };
}

// =====================================================
// CURRENCY UTILITIES
// =====================================================

/**
 * Round to 2 decimal places (currency precision)
 */
export function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Format number as USD currency
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Parse currency string to number
 */
export function parseCurrency(value: string): number {
  // Remove currency symbols, commas, spaces
  const cleaned = value.replace(/[$,\s]/g, "");
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : roundCurrency(parsed);
}

/**
 * Format number as percentage
 */
export function formatPercentage(value: number, decimals: number = 1): string {
  return `${value.toFixed(decimals)}%`;
}

// =====================================================
// UNIT OF MEASURE
// =====================================================

export const UNITS_OF_MEASURE = [
  { value: "ea", label: "Each (ea)" },
  { value: "hr", label: "Hour (hr)" },
  { value: "day", label: "Day" },
  { value: "sq ft", label: "Square Foot (sq ft)" },
  { value: "lf", label: "Linear Foot (lf)" },
  { value: "cf", label: "Cubic Foot (cf)" },
  { value: "sq yd", label: "Square Yard (sq yd)" },
  { value: "lb", label: "Pound (lb)" },
  { value: "ton", label: "Ton" },
  { value: "gal", label: "Gallon (gal)" },
  { value: "lot", label: "Lot" },
] as const;

export type UnitOfMeasure = typeof UNITS_OF_MEASURE[number]["value"];

/**
 * Get unit label from value
 */
export function getUnitLabel(value: string): string {
  const unit = UNITS_OF_MEASURE.find((u) => u.value === value);
  return unit?.label || value;
}

// =====================================================
// LINE ITEM UTILITIES
// =====================================================

/**
 * Generate a temporary ID for new line items
 */
export function generateTempId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a blank line item
 */
export function createBlankLineItem(): LineItem {
  return {
    id: generateTempId(),
    description: "",
    quantity: 1,
    unit: "ea",
    unitPrice: 0,
    total: 0,
  };
}

/**
 * Clone a line item with new ID
 */
export function cloneLineItem(item: LineItem): LineItem {
  return {
    ...item,
    id: generateTempId(),
  };
}

/**
 * Validate line item is complete
 */
export function isLineItemComplete(item: LineItem): boolean {
  return (
    item.description.trim().length > 0 &&
    item.quantity > 0 &&
    item.unitPrice >= 0
  );
}

// =====================================================
// QUOTE UTILITIES
// =====================================================

/**
 * Check if quote has unsaved changes
 */
export function hasUnsavedChanges(
  current: string,
  saved: string
): boolean {
  return current !== saved;
}

/**
 * Create a hash of quote data for change detection
 */
export function hashQuoteData(data: any): string {
  return JSON.stringify(data);
}

/**
 * Calculate labor vs materials breakdown
 */
export function calculateBreakdown(lineItems: LineItem[]): {
  labor: number;
  materials: number;
  other: number;
} {
  let labor = 0;
  let materials = 0;
  let other = 0;

  lineItems.forEach((item) => {
    const desc = item.description.toLowerCase();
    const unit = item.unit.toLowerCase();

    if (unit === "hr" || unit === "day" || desc.includes("labor")) {
      labor += item.total;
    } else if (
      desc.includes("material") ||
      desc.includes("supplies") ||
      desc.includes("parts")
    ) {
      materials += item.total;
    } else {
      other += item.total;
    }
  });

  return {
    labor: roundCurrency(labor),
    materials: roundCurrency(materials),
    other: roundCurrency(other),
  };
}

// =====================================================
// VALIDATION HELPERS
// =====================================================

/**
 * Validate tax rate is within bounds
 */
export function isValidTaxRate(rate: number): boolean {
  return rate >= 0 && rate <= 100;
}

/**
 * Validate discount is valid
 */
export function isValidDiscount(
  discount: number,
  subtotal: number,
  isPercentage: boolean
): boolean {
  if (isPercentage) {
    return discount >= 0 && discount <= 100;
  }
  return discount >= 0 && discount <= subtotal;
}

/**
 * Validate quantity
 */
export function isValidQuantity(quantity: number): boolean {
  return quantity > 0 && quantity <= 999999;
}

/**
 * Validate unit price
 */
export function isValidUnitPrice(price: number): boolean {
  return price >= 0 && price <= 9999999;
}

// =====================================================
// EXCEL/SHEETS IMPORT
// =====================================================

/**
 * Parse clipboard data from Excel/Sheets
 */
export function parseClipboardData(text: string): Partial<LineItem>[] {
  const lines = text.trim().split("\n");
  const items: Partial<LineItem>[] = [];

  lines.forEach((line) => {
    const cells = line.split("\t");

    if (cells.length >= 3) {
      const [description, quantity, unitPrice] = cells;

      items.push({
        description: description.trim(),
        quantity: parseFloat(quantity) || 1,
        unitPrice: parseCurrency(unitPrice),
      });
    }
  });

  return items;
}

/**
 * Convert line items to CSV
 */
export function exportToCSV(lineItems: LineItem[]): string {
  const headers = ["Description", "Quantity", "Unit", "Unit Price", "Total"];
  const rows = lineItems.map((item) => [
    `"${item.description.replace(/"/g, '""')}"`, // Escape quotes
    item.quantity.toString(),
    item.unit,
    item.unitPrice.toFixed(2),
    item.total.toFixed(2),
  ]);

  return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
}

// =====================================================
// PRESET LINE ITEMS (TEMPLATES)
// =====================================================

export const PRESET_LINE_ITEMS: Record<string, Partial<LineItem>[]> = {
  kitchen_remodel: [
    {
      description: "Demolition and removal",
      quantity: 1,
      unit: "lot",
      unitPrice: 1500,
    },
    {
      description: "Cabinet installation",
      quantity: 20,
      unit: "lf",
      unitPrice: 150,
    },
    {
      description: "Countertop installation",
      quantity: 35,
      unit: "sq ft",
      unitPrice: 75,
    },
    { description: "Plumbing labor", quantity: 16, unit: "hr", unitPrice: 110 },
    {
      description: "Electrical labor",
      quantity: 12,
      unit: "hr",
      unitPrice: 100,
    },
  ],
  bathroom_remodel: [
    {
      description: "Demolition and removal",
      quantity: 1,
      unit: "lot",
      unitPrice: 800,
    },
    {
      description: "Tile installation",
      quantity: 120,
      unit: "sq ft",
      unitPrice: 12,
    },
    { description: "Vanity installation", quantity: 1, unit: "ea", unitPrice: 500 },
    {
      description: "Plumbing fixtures",
      quantity: 1,
      unit: "lot",
      unitPrice: 1200,
    },
    { description: "Labor", quantity: 40, unit: "hr", unitPrice: 75 },
  ],
  painting: [
    { description: "Interior painting", quantity: 1200, unit: "sq ft", unitPrice: 2 },
    {
      description: "Trim and baseboards",
      quantity: 200,
      unit: "lf",
      unitPrice: 3,
    },
    {
      description: "Paint materials",
      quantity: 1,
      unit: "lot",
      unitPrice: 450,
    },
  ],
  hvac_install: [
    { description: "HVAC unit", quantity: 1, unit: "ea", unitPrice: 3500 },
    { description: "Ductwork", quantity: 80, unit: "lf", unitPrice: 25 },
    { description: "Installation labor", quantity: 24, unit: "hr", unitPrice: 100 },
    { description: "Electrical work", quantity: 8, unit: "hr", unitPrice: 100 },
  ],
};

/**
 * Get preset line items by template name
 */
export function getPresetLineItems(template: string): LineItem[] {
  const preset = PRESET_LINE_ITEMS[template];
  if (!preset) return [];

  return preset.map((item) => ({
    id: generateTempId(),
    description: item.description || "",
    quantity: item.quantity || 1,
    unit: item.unit || "ea",
    unitPrice: item.unitPrice || 0,
    total: calculateLineItemTotal(item.quantity || 1, item.unitPrice || 0),
  }));
}

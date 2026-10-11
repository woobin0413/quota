/**
 * Work Items Repository
 *
 * Database operations for the per-contractor work catalog.
 * Work items are the contractor-configurable services/materials
 * that quotes are built from.
 *
 * @module lib/db/work-items
 */

import { supabaseAdmin } from "./core";
import type {
  WorkItemRow,
  WorkItem,
  CreateWorkItemInput,
  UpdateWorkItemInput,
} from "@/types/database";
import { NotFoundError, ValidationError } from "@/types/database";

// =====================================================
// TYPE TRANSFORMERS
// =====================================================

function transformWorkItem(row: WorkItemRow): WorkItem {
  return {
    ...row,
    defaultUnitPrice: parseFloat(String(row.default_unit_price)),
  };
}

// =====================================================
// QUERY FUNCTIONS
// =====================================================

/**
 * Get all work items for a user (active only by default)
 */
export async function getWorkItems(
  userId: string,
  options: { includeInactive?: boolean } = {}
): Promise<WorkItem[]> {
  let query = supabaseAdmin
    .from("work_items")
    .select("*")
    .eq("user_id", userId)
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (!options.includeInactive) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;

  if (error) throw error;

  return (data as WorkItemRow[]).map(transformWorkItem);
}

/**
 * Get a single work item (user-scoped)
 */
export async function getWorkItemById(
  userId: string,
  workItemId: string
): Promise<WorkItem | null> {
  const { data, error } = await supabaseAdmin
    .from("work_items")
    .select("*")
    .eq("id", workItemId)
    .eq("user_id", userId)
    .single();

  if (error && error.code !== "PGRST116") throw error;

  return data ? transformWorkItem(data as WorkItemRow) : null;
}

/**
 * Create a work item
 */
export async function createWorkItem(
  userId: string,
  input: CreateWorkItemInput
): Promise<WorkItem> {
  if (!input.name?.trim()) {
    throw new ValidationError("Work item name is required", "name");
  }
  if (input.defaultUnitPrice < 0) {
    throw new ValidationError("Price cannot be negative", "defaultUnitPrice");
  }

  const { data, error } = await supabaseAdmin
    .from("work_items")
    .insert({
      user_id: userId,
      name: input.name.trim(),
      description: input.description ?? null,
      unit_of_measure: input.unitOfMeasure ?? "each",
      default_unit_price: input.defaultUnitPrice,
      category: input.category ?? null,
      sort_order: input.sortOrder ?? 0,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new ValidationError(
        `A work item named "${input.name}" already exists`,
        "name"
      );
    }
    throw error;
  }

  return transformWorkItem(data as WorkItemRow);
}

/**
 * Update a work item (user-scoped)
 */
export async function updateWorkItem(
  userId: string,
  workItemId: string,
  input: UpdateWorkItemInput
): Promise<WorkItem> {
  const updateData: Record<string, unknown> = {};

  if (input.name !== undefined) updateData.name = input.name.trim();
  if (input.description !== undefined) updateData.description = input.description;
  if (input.unitOfMeasure !== undefined) updateData.unit_of_measure = input.unitOfMeasure;
  if (input.defaultUnitPrice !== undefined) {
    if (input.defaultUnitPrice < 0) {
      throw new ValidationError("Price cannot be negative", "defaultUnitPrice");
    }
    updateData.default_unit_price = input.defaultUnitPrice;
  }
  if (input.category !== undefined) updateData.category = input.category;
  if (input.isActive !== undefined) updateData.is_active = input.isActive;
  if (input.sortOrder !== undefined) updateData.sort_order = input.sortOrder;

  const { data, error } = await supabaseAdmin
    .from("work_items")
    .update(updateData)
    .eq("id", workItemId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      throw new NotFoundError("Work item not found", "WorkItem", workItemId);
    }
    if (error.code === "23505") {
      throw new ValidationError(
        `A work item named "${input.name}" already exists`,
        "name"
      );
    }
    throw error;
  }

  return transformWorkItem(data as WorkItemRow);
}

/**
 * Activate/deactivate a work item (soft delete)
 */
export async function setWorkItemActive(
  userId: string,
  workItemId: string,
  active: boolean
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("work_items")
    .update({ is_active: active })
    .eq("id", workItemId)
    .eq("user_id", userId);

  if (error) throw error;
}

/**
 * Bulk create work items (used for starter template import).
 * Skips items whose names already exist for the user.
 *
 * @returns number of items created
 */
export async function bulkCreateWorkItems(
  userId: string,
  inputs: CreateWorkItemInput[]
): Promise<number> {
  if (inputs.length === 0) return 0;

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("work_items")
    .select("name")
    .eq("user_id", userId);

  if (existingError) throw existingError;

  const existingNames = new Set(
    (existing as { name: string }[]).map((r) => r.name.toLowerCase())
  );

  const rows = inputs
    .filter((input) => !existingNames.has(input.name.trim().toLowerCase()))
    .map((input, index) => ({
      user_id: userId,
      name: input.name.trim(),
      description: input.description ?? null,
      unit_of_measure: input.unitOfMeasure ?? "each",
      default_unit_price: input.defaultUnitPrice,
      category: input.category ?? null,
      sort_order: input.sortOrder ?? index,
    }));

  if (rows.length === 0) return 0;

  const { error } = await supabaseAdmin.from("work_items").insert(rows);

  if (error) throw error;

  return rows.length;
}

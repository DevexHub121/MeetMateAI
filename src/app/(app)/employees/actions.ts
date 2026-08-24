"use server";

import { syncEmployeesFromBitrix } from "@/lib/employees";
import { revalidatePath } from "next/cache";

export async function syncEmployees() {
  const { synced } = await syncEmployeesFromBitrix();
  revalidatePath("/employees");
  revalidatePath("/meetings/new");
  return synced;
}

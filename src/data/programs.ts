import { ProgramType, PlanDuration } from "@/lib/alunaTypes";
import { supabase } from "@/integrations/supabase/client";

export interface ProgramOption {
  value: string;
  label: string;
  price: number;
  programa: ProgramType;
  duracao: PlanDuration;
}

function mapProgramRow(row: any): ProgramOption {
  return {
    value: row.value,
    label: row.label,
    price: Number(row.price),
    programa: (row.programa || "consultoria_slim") as ProgramType,
    duracao: (row.duracao || "1") as PlanDuration,
  };
}

export function normalizeProgramValue(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// Fallback list used only if the DB read fails. The source of truth is `custom_programs`.
export const DEFAULT_PROGRAM_OPTIONS: ProgramOption[] = [
  { value: "mgmd-12m", label: "MGMD 12M", price: 997, programa: "menos_gordura", duracao: "12" },
  { value: "elite-6m-default", label: "ELITE 6M", price: 1500, programa: "elite", duracao: "6" },
  { value: "elite-2m", label: "ELITE 2M", price: 1997, programa: "elite", duracao: "2" },
  { value: "plataforma", label: "PLATAFORMA", price: 297, programa: "plataforma_magra", duracao: "12" },
  { value: "mgmd-quadrimestral", label: "MGMD QUADRIMESTRAL", price: 497, programa: "menos_gordura", duracao: "4" },
  { value: "slim-definida-6m", label: "6 MESES 497 - SLIM DEFINIDA", price: 497, programa: "menos_gordura", duracao: "6" },
];

export let PROGRAM_OPTIONS: ProgramOption[] = [...DEFAULT_PROGRAM_OPTIONS];

export async function fetchCustomPrograms(): Promise<ProgramOption[]> {
  const { data, error } = await supabase
    .from("custom_programs")
    .select("*")
    .or("active.is.null,active.eq.true")
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  return data.map(mapProgramRow);
}

export async function updateCustomProgram(
  value: string,
  updates: { label?: string; price?: number; programa?: ProgramType; duracao?: PlanDuration }
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (updates.label !== undefined) payload.label = updates.label;
  if (updates.price !== undefined) payload.price = updates.price;
  if (updates.programa !== undefined) payload.programa = updates.programa;
  if (updates.duracao !== undefined) payload.duracao = updates.duracao;
  const { error } = await supabase.from("custom_programs").update(payload).eq("value", value);
  if (error) throw error;
}

export async function archiveCustomProgram(value: string): Promise<void> {
  const { error } = await supabase
    .from("custom_programs")
    .update({ active: false } as any)
    .eq("value", value);
  if (error) throw error;
}

// All programs live in `custom_programs` now — everything is editable/archivable.
export function isDefaultProgram(_value: string): boolean {
  return false;
}

export async function fetchAllPrograms(): Promise<ProgramOption[]> {
  const custom = await fetchCustomPrograms();
  // If DB returned anything, trust it as source of truth.
  // Only fall back to DEFAULT_PROGRAM_OPTIONS if the read failed/returned empty.
  const merged = custom.length > 0 ? custom : [...DEFAULT_PROGRAM_OPTIONS];
  PROGRAM_OPTIONS = merged;
  return merged;
}

export async function addCustomProgram(program: Omit<ProgramOption, "value">): Promise<ProgramOption> {
  const value = normalizeProgramValue(program.label);
  const row = {
    value,
    label: program.label,
    price: program.price,
    programa: program.programa,
    duracao: program.duracao,
  };

  const { data: existing } = await supabase
    .from("custom_programs")
    .select("*")
    .eq("value", value)
    .maybeSingle();

  if (existing) {
    return mapProgramRow(existing);
  }

  const { data, error } = await supabase
    .from("custom_programs")
    .insert(row)
    .select("*")
    .maybeSingle();

  if (error) {
    if ((error as any)?.code === "23505") {
      const { data: duplicate } = await supabase
        .from("custom_programs")
        .select("*")
        .eq("value", value)
        .maybeSingle();

      if (duplicate) return mapProgramRow(duplicate);
    }

    throw error;
  }

  const opt = data ? mapProgramRow(data) : { ...row, price: Number(row.price) };
  PROGRAM_OPTIONS = PROGRAM_OPTIONS.some((program) => program.value === opt.value)
    ? PROGRAM_OPTIONS
    : [...PROGRAM_OPTIONS, opt];
  return opt;
}

export function getProgramByValue(value: string) {
  return PROGRAM_OPTIONS.find((p) => p.value === value);
}

export function getProgramByPrice(price: number) {
  return PROGRAM_OPTIONS.find((p) => p.price === price);
}

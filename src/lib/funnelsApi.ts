import { supabase } from "@/integrations/supabase/client";

export interface Funnel {
  id: string;
  slug: string;
  name: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  destination_url: string | null;
  tracked_url: string | null;
  parent_id: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FunnelInput {
  name: string;
  tracked_url: string;
  slug?: string;
  parent_id?: string | null;
  notes?: string;
}

export interface FunnelWithChildren extends Funnel {
  children: Funnel[];
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

interface ParsedUrl {
  destination_url: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
}

export function parseTrackedUrl(rawUrl: string): ParsedUrl | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    const utms = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
    const extracted: Record<string, string | null> = {};
    utms.forEach((k) => {
      extracted[k] = url.searchParams.get(k);
    });
    const destinationUrl = `${url.origin}${url.pathname}${url.hash}`;
    return {
      destination_url: destinationUrl,
      utm_source: extracted.utm_source,
      utm_medium: extracted.utm_medium,
      utm_campaign: extracted.utm_campaign,
      utm_term: extracted.utm_term,
      utm_content: extracted.utm_content,
    };
  } catch {
    return null;
  }
}

export function isValidUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    new URL(withProtocol);
    return true;
  } catch {
    return false;
  }
}

export const funnelsApi = {
  async getAll(): Promise<Funnel[]> {
    const { data, error } = await (supabase as any)
      .from("funnels")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async getAllNested(): Promise<FunnelWithChildren[]> {
    const all = await this.getAll();
    const parents = all.filter((f) => !f.parent_id);
    const childrenByParent = new Map<string, Funnel[]>();
    all.forEach((f) => {
      if (f.parent_id) {
        const arr = childrenByParent.get(f.parent_id) || [];
        arr.push(f);
        childrenByParent.set(f.parent_id, arr);
      }
    });
    return parents.map((parent) => ({
      ...parent,
      children: (childrenByParent.get(parent.id) || []).sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      ),
    }));
  },

  async getById(id: string): Promise<Funnel | null> {
    const { data, error } = await (supabase as any)
      .from("funnels")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async create(input: FunnelInput): Promise<Funnel> {
    if (!input.name.trim()) throw new Error("Nome do funil é obrigatório.");
    const parsed = parseTrackedUrl(input.tracked_url);
    if (!parsed) throw new Error("URL inválida. Cole um link completo (ex: https://...).");

    const slug = input.slug?.trim() || slugify(input.name);
    if (!slug) throw new Error("Slug inválido. Use um nome com letras ou números.");

    const payload = {
      name: input.name.trim(),
      slug,
      parent_id: input.parent_id || null,
      tracked_url: input.tracked_url.trim(),
      destination_url: parsed.destination_url,
      utm_source: parsed.utm_source,
      utm_medium: parsed.utm_medium,
      utm_campaign: parsed.utm_campaign,
      utm_term: parsed.utm_term,
      utm_content: parsed.utm_content,
      notes: input.notes?.trim() || null,
    };

    const { data, error } = await (supabase as any)
      .from("funnels")
      .insert(payload)
      .select()
      .single();
    if (error) {
      if (error.code === "23505") {
        throw new Error(`Já existe um funil com o slug "${slug}". Escolha outro nome.`);
      }
      throw error;
    }
    return data;
  },

  async update(
    id: string,
    input: Partial<FunnelInput> & { active?: boolean },
  ): Promise<Funnel> {
    const payload: Record<string, unknown> = {};
    if (input.name !== undefined) payload.name = input.name.trim();
    if (input.slug !== undefined) payload.slug = input.slug.trim();
    if (input.parent_id !== undefined) payload.parent_id = input.parent_id || null;
    if (input.notes !== undefined) payload.notes = input.notes?.trim() || null;
    if (input.active !== undefined) payload.active = input.active;

    if (input.tracked_url !== undefined) {
      const parsed = parseTrackedUrl(input.tracked_url);
      if (!parsed) throw new Error("URL inválida.");
      payload.tracked_url = input.tracked_url.trim();
      payload.destination_url = parsed.destination_url;
      payload.utm_source = parsed.utm_source;
      payload.utm_medium = parsed.utm_medium;
      payload.utm_campaign = parsed.utm_campaign;
      payload.utm_term = parsed.utm_term;
      payload.utm_content = parsed.utm_content;
    }

    const { data, error } = await (supabase as any)
      .from("funnels")
      .update(payload)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id: string): Promise<void> {
    // ON DELETE CASCADE no parent_id remove os sub-funis junto
    const { error } = await (supabase as any).from("funnels").delete().eq("id", id);
    if (error) throw error;
  },
};

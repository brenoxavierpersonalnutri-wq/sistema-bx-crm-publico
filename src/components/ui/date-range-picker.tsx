import { useEffect, useRef, useState } from "react";
import { format, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, X } from "lucide-react";
import { DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getDatePresets } from "@/lib/date-presets";

export interface DateRangePickerProps {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  align?: "start" | "center" | "end";
  numberOfMonths?: number;
  showClear?: boolean;
  size?: "sm" | "default";
  /** Override preset list */
  presets?: { label: string; getValue: () => DateRange }[];
}

/**
 * Meta Ads style date range picker.
 * - 1st click sets start (calendar stays open).
 * - 2nd click sets end and auto-closes (auto-inverts if earlier).
 * - Same day twice = single-day range.
 * - Click outside / ESC discards partial selection, keeps last applied.
 * - Side presets apply on a single click.
 */
export function DateRangePicker({
  value,
  onChange,
  placeholder = "Filtrar período",
  className,
  triggerClassName,
  align = "start",
  numberOfMonths = 2,
  showClear = true,
  size = "sm",
  presets,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  // Buffer state while picking — committed only on second click or preset.
  const [draft, setDraft] = useState<DateRange | undefined>(value);
  // Tracks whether the next click should start a fresh range.
  const resetOnNextClickRef = useRef(true);

  const presetList = presets ?? getDatePresets();

  // Sync draft when popover opens / external value changes.
  useEffect(() => {
    if (open) {
      setDraft(value);
      resetOnNextClickRef.current = true; // first click after open always restarts
    }
  }, [open, value]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      // Closing without committing — discard draft (revert to applied value).
      setDraft(value);
      resetOnNextClickRef.current = true;
    }
    setOpen(next);
  };

  const handleDayClick = (day: Date) => {
    // First click after opening (or after a complete range) → start over.
    if (resetOnNextClickRef.current || (draft?.from && draft?.to)) {
      setDraft({ from: day, to: undefined });
      resetOnNextClickRef.current = false;
      return;
    }

    // Second click → close range.
    if (draft?.from && !draft?.to) {
      const from = draft.from;
      // Same day twice = 1-day range.
      if (isSameDay(day, from)) {
        const range = { from, to: from };
        onChange(range);
        setDraft(range);
        setOpen(false);
        return;
      }
      // Auto-invert if earlier than start.
      const range: DateRange =
        day < from ? { from: day, to: from } : { from, to: day };
      onChange(range);
      setDraft(range);
      setOpen(false);
      return;
    }

    // Fallback (no draft yet).
    setDraft({ from: day, to: undefined });
    resetOnNextClickRef.current = false;
  };

  const handleSelect = (range: DateRange | undefined) => {
    // We drive selection via onDayClick to control the 2-click flow.
    // Keep this for keyboard support — only sync draft when user picks complete range.
    if (range?.from && range?.to) {
      setDraft(range);
    }
  };

  const handlePreset = (preset: { label: string; getValue: () => DateRange }) => {
    const range = preset.getValue();
    onChange(range);
    setDraft(range);
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(undefined);
    setDraft(undefined);
  };

  const label = value?.from
    ? value.to
      ? `${format(value.from, "dd/MM/yyyy", { locale: ptBR })} - ${format(value.to, "dd/MM/yyyy", { locale: ptBR })}`
      : format(value.from, "dd/MM/yyyy", { locale: ptBR })
    : placeholder;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size={size}
            className={cn(
              "justify-start text-left font-normal gap-2 min-w-[240px]",
              !value?.from && "text-muted-foreground",
              triggerClassName,
            )}
          >
            <CalendarIcon className="h-4 w-4" />
            <span className="truncate">{label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-auto p-0 flex flex-col md:flex-row"
          align={align}
          onEscapeKeyDown={() => {
            setDraft(value);
            setOpen(false);
          }}
        >
          <div className="flex flex-col gap-1 border-b md:border-b-0 md:border-r border-border p-3 w-full md:w-[180px] max-h-[350px] overflow-y-auto">
            <span className="text-xs font-semibold text-muted-foreground mb-2 px-2">
              Atalhos
            </span>
            {presetList.map((preset) => (
              <Button
                key={preset.label}
                variant="ghost"
                className="w-full justify-start text-left font-normal text-sm whitespace-normal h-auto py-2"
                onClick={() => handlePreset(preset)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <div className="p-3">
            <Calendar
              mode="range"
              defaultMonth={draft?.from ?? value?.from ?? new Date()}
              selected={draft}
              onSelect={handleSelect}
              onDayClick={handleDayClick}
              numberOfMonths={numberOfMonths}
              locale={ptBR}
              initialFocus
              className="pointer-events-auto"
            />
          </div>
        </PopoverContent>
      </Popover>

      {showClear && value?.from && (
        <Button variant="ghost" size="sm" className="text-xs" onClick={handleClear}>
          <X className="h-3 w-3 mr-1" /> Limpar
        </Button>
      )}
    </div>
  );
}

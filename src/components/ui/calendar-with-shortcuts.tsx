import { Calendar, CalendarProps } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { addDays, isSameDay, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";

// Wrapper do Calendar do shadcn que adiciona atalhos "Hoje" e "Amanhã" no topo.
// Mantém TODA a API do Calendar — só envolve com 2 botões pra acelerar
// seleção dos casos mais comuns (data de cobrança, reavaliação, etc).
// Mode="single" implícito porque os shortcuts só fazem sentido pra UMA data.

interface Props extends Omit<CalendarProps, "mode" | "selected" | "onSelect"> {
  selected?: Date;
  onSelect?: (date: Date | undefined) => void;
  /** Esconde botão "Hoje" (útil se a regra de negócio exige data futura) */
  hideToday?: boolean;
  /** Esconde botão "Amanhã" (raro, mas exposto pra simetria) */
  hideTomorrow?: boolean;
}

export function CalendarWithShortcuts({
  selected,
  onSelect,
  hideToday,
  hideTomorrow,
  ...rest
}: Props) {
  const hoje = startOfDay(new Date());
  const amanha = startOfDay(addDays(new Date(), 1));

  const selectedIsHoje = selected ? isSameDay(selected, hoje) : false;
  const selectedIsAmanha = selected ? isSameDay(selected, amanha) : false;

  return (
    <div>
      {(!hideToday || !hideTomorrow) && (
        <div className="flex items-center gap-2 px-3 pt-3">
          {!hideToday && (
            <Button
              type="button"
              variant={selectedIsHoje ? "default" : "outline"}
              size="sm"
              className="flex-1 h-8 text-xs"
              onClick={() => onSelect?.(hoje)}
            >
              Hoje
            </Button>
          )}
          {!hideTomorrow && (
            <Button
              type="button"
              variant={selectedIsAmanha ? "default" : "outline"}
              size="sm"
              className="flex-1 h-8 text-xs"
              onClick={() => onSelect?.(amanha)}
            >
              Amanhã
            </Button>
          )}
        </div>
      )}
      <Calendar
        mode="single"
        selected={selected}
        onSelect={onSelect}
        locale={ptBR}
        {...rest}
      />
    </div>
  );
}

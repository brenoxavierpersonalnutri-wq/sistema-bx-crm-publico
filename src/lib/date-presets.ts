import {
  addDays,
  subDays,
  startOfMonth,
  endOfMonth,
  subMonths,
} from "date-fns";
import { DateRange } from "react-day-picker";

export const getDatePresets = () => {
  const today = new Date();
  const tomorrow = addDays(today, 1);

  return [
    {
      label: "Hoje",
      getValue: (): DateRange => ({ from: today, to: today }),
    },
    {
      label: "Amanhã",
      getValue: (): DateRange => ({ from: tomorrow, to: tomorrow }),
    },
    {
      label: "Ontem",
      getValue: (): DateRange => ({
        from: subDays(today, 1),
        to: subDays(today, 1),
      }),
    },
    {
      label: "Últimos 7 dias",
      getValue: (): DateRange => ({
        from: subDays(today, 6),
        to: today,
      }),
    },
    {
      label: "Últimos 14 dias",
      getValue: (): DateRange => ({
        from: subDays(today, 13),
        to: today,
      }),
    },
    {
      label: "Últimos 30 dias",
      getValue: (): DateRange => ({
        from: subDays(today, 29),
        to: today,
      }),
    },
    {
      label: "Este mês",
      getValue: (): DateRange => ({
        from: startOfMonth(today),
        to: today,
      }),
    },
    {
      label: "Mês passado",
      getValue: (): DateRange => ({
        from: startOfMonth(subMonths(today, 1)),
        to: endOfMonth(subMonths(today, 1)),
      }),
    },
  ];
};

import { DateRange } from "react-day-picker";
import { DateRangePicker } from "@/components/ui/date-range-picker";

interface DateFilterProps {
  dateRange: DateRange | undefined;
  onDateRangeChange: (range: DateRange | undefined) => void;
}

export function DateFilter({ dateRange, onDateRangeChange }: DateFilterProps) {
  return <DateRangePicker value={dateRange} onChange={onDateRangeChange} />;
}

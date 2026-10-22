import { DateRange } from "react-day-picker";
import { DateRangePicker } from "@/components/ui/date-range-picker";

interface Props {
  dateRange: DateRange | undefined;
  onRangeChange: (range: DateRange | undefined) => void;
  onClear: () => void;
}

export function DateRangeFilter({ dateRange, onRangeChange, onClear }: Props) {
  return (
    <DateRangePicker
      value={dateRange}
      onChange={(r) => {
        if (!r) onClear();
        else onRangeChange(r);
      }}
    />
  );
}

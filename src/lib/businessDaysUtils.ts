import { addDays, isWeekend, isFriday, isSaturday, isSunday } from "date-fns";

/**
 * Calculates a date after a number of business days.
 * @param startDate The starting date
 * @param days Number of business days to add
 * @returns The resulting date
 */
export function addBusinessDays(startDate: Date, days: number): Date {
    let result = new Date(startDate);
    let daysAdded = 0;

    while (daysAdded < days) {
        result = addDays(result, 1);
        if (!isWeekend(result)) {
            daysAdded++;
        }
    }

    return result;
}

/**
 * Specifically for the "2 business days" rule:
 * If sent on Friday, Saturday or Sunday -> Due Tuesday.
 * If sent on Monday -> Due Wednesday.
 * etc.
 */
export function calculateDeliveryDueDate(startDate: Date): Date {
    // If sent late on Friday or on the weekend, we treat as starting Monday
    // But the prompt says "se a pessoa mandou em uma sexta, ele tem ate terçã para enviar"
    // Friday (5) -> Tuesday (2). That's 2 business days (Mon, Tue).
    return addBusinessDays(startDate, 2);
}

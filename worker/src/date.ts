export interface DateParts {
    year: number;
    month: number;
    day: number;
}

const ISO_DATE_RE = /^\\d{4}-\\d{2}-\\d{2}$/;

export function parseDateParts(value: string): DateParts | null {
    if (!ISO_DATE_RE.test(value)) {
        return null;
    }
    const [yearStr, monthStr, dayStr] = value.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        return null;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) {
        return null;
    }
    const dt = new Date(Date.UTC(year, month - 1, day));
    if (
        dt.getUTCFullYear() !== year ||
        dt.getUTCMonth() !== month - 1 ||
        dt.getUTCDate() !== day
    ) {
        return null;
    }
    return { year, month, day };
}

export function datePartsToIndex(parts: DateParts): number {
    return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000);
}

export function dateIndexToString(dayIndex: number): string {
    return new Date(dayIndex * 86400000).toISOString().slice(0, 10);
}

export function getTodayInTimeZone(timeZone: string, now: Date = new Date()): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    return formatter.format(now);
}

export function compareDateStrings(a: string, b: string): number | null {
    const partsA = parseDateParts(a);
    const partsB = parseDateParts(b);
    if (!partsA || !partsB) {
        return null;
    }
    const idxA = datePartsToIndex(partsA);
    const idxB = datePartsToIndex(partsB);
    return idxA - idxB;
}

export function listDateStrings(startDate: string, endDate: string): string[] | null {
    const startParts = parseDateParts(startDate);
    const endParts = parseDateParts(endDate);
    if (!startParts || !endParts) {
        return null;
    }
    const startIndex = datePartsToIndex(startParts);
    const endIndex = datePartsToIndex(endParts);
    if (startIndex > endIndex) {
        return null;
    }
    const dates: string[] = [];
    for (let i = startIndex; i <= endIndex; i += 1) {
        dates.push(dateIndexToString(i));
    }
    return dates;
}

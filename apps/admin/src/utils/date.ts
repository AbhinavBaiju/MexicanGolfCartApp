const DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

interface DateParts {
    year: number;
    month: number;
    day: number;
}

function pad2(value: number): string {
    return String(value).padStart(2, '0');
}

function parseDateParts(dateStr: string): DateParts | null {
    const match = DATE_REGEX.exec(dateStr);
    if (!match) {
        return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        return null;
    }

    const utcDate = new Date(Date.UTC(year, month - 1, day));
    if (
        utcDate.getUTCFullYear() !== year ||
        utcDate.getUTCMonth() !== month - 1 ||
        utcDate.getUTCDate() !== day
    ) {
        return null;
    }

    return { year, month, day };
}

export function formatDateForDisplay(dateStr: string, locale = 'en-US'): string {
    const parts = parseDateParts(dateStr);
    if (!parts) {
        return dateStr;
    }

    // Use local noon to avoid midnight timezone rollover on YYYY-MM-DD values.
    const date = new Date(parts.year, parts.month - 1, parts.day, 12, 0, 0, 0);
    return date.toLocaleDateString(locale, { month: 'long', day: 'numeric', year: 'numeric' });
}

export function toDateIndex(dateStr: string): number | null {
    const parts = parseDateParts(dateStr);
    if (!parts) {
        return null;
    }
    return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS);
}

export function toLocalYyyyMmDd(date: Date): string {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

import { Env } from './types';
import { releaseBooking } from './bookingService';

interface ExpiredBookingRow {
    id: string;
}

export async function handleScheduled(event: ScheduledEvent, env: Env): Promise<void> {
    console.log('Running hold cleanup cron', event.cron);
    const expired = await env.DB.prepare(
        "SELECT id FROM bookings WHERE status = 'HOLD' AND datetime(expires_at) <= datetime('now')"
    ).all();

    for (const row of expired.results ?? []) {
        const bookingId = (row as unknown as ExpiredBookingRow).id;
        if (!bookingId) {
            continue;
        }
        try {
            await releaseBooking(env.DB, bookingId, 'EXPIRED');
        } catch (e) {
            console.error('Failed to expire booking', bookingId, e);
        }
    }
}

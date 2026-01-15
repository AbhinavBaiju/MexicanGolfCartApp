export type ReleaseTargetStatus = 'RELEASED' | 'EXPIRED';

interface BookingDayRow {
    product_id: number;
    date: string;
    qty: number;
}

interface BookingRow {
    shop_id: number;
    status: string;
}

export async function releaseBooking(
    db: D1Database,
    bookingId: string,
    targetStatus: ReleaseTargetStatus
): Promise<void> {
    const booking = (await db
        .prepare('SELECT shop_id, status FROM bookings WHERE id = ?')
        .bind(bookingId)
        .first()) as BookingRow | null;

    if (!booking) {
        throw new Error(`Booking not found: ${bookingId}`);
    }

    if (booking.status !== 'HOLD') {
        return;
    }

    const bookingDays = await db
        .prepare('SELECT product_id, date, qty FROM booking_days WHERE booking_id = ?')
        .bind(bookingId)
        .all();

    const statements: D1PreparedStatement[] = [];
    statements.push(
        db.prepare(
            `UPDATE bookings
             SET status = ?, updated_at = datetime('now')
             WHERE id = ? AND status = 'HOLD'`
        ).bind(targetStatus, bookingId)
    );
    statements.push(db.prepare('SELECT CASE WHEN changes() = 1 THEN 1 ELSE 1/0 END;'));

    for (const row of bookingDays.results ?? []) {
        const bookingDay = row as BookingDayRow;
        const productId = bookingDay.product_id;
        const date = bookingDay.date;
        const qty = bookingDay.qty;
        statements.push(
            db.prepare(
                `UPDATE inventory_day
                 SET reserved_qty = reserved_qty - ?
                 WHERE shop_id = ? AND product_id = ? AND date = ? AND reserved_qty >= ?`
            ).bind(qty, booking.shop_id, productId, date, qty)
        );
        statements.push(db.prepare('SELECT CASE WHEN changes() = 1 THEN 1 ELSE 1/0 END;'));
    }

    await db.batch(statements);
}

export const ROOM_IDLE_MS = 60 * 60 * 1000;
export const PRESENCE_INTERVAL_MS = 60 * 1000;
// Zero is the compatibility default for rooms created by an older app deployment.
export const ROOM_ACTIVITY_SQL = 'COALESCE(NULLIF(last_active_at,0),updated_at)';
export const DELETE_EXPIRED_ROOMS_SQL = `DELETE FROM rooms WHERE ${ROOM_ACTIVITY_SQL} <= ? RETURNING code`;
export class RoomUnavailableError extends Error {
  constructor(message='ห้องหมดอายุหรือไม่พบห้องนี้แล้ว กรุณาตั้งวงใหม่ (ห้องไม่มีผู้ใช้งานครบ 1 ชั่วโมงจะถูกลบ)'){super(message);}
}

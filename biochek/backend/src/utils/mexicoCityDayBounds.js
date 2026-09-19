// A plain YYYY-MM-DD date filter must resolve against Mexico City midnight,
// not UTC midnight, or checadas from ~18:00 local onward on the boundary
// day get silently dropped/included wrong (see docs/ISSUES.md).
export const MEXICO_CITY_TZ = 'America/Mexico_City';

export function mexicoCityDayStartExpr(paramIndex) {
  return `($${paramIndex}::date::timestamp AT TIME ZONE '${MEXICO_CITY_TZ}')`;
}

export function mexicoCityDayEndExclusiveExpr(paramIndex) {
  return `(($${paramIndex}::date + 1)::timestamp AT TIME ZONE '${MEXICO_CITY_TZ}')`;
}

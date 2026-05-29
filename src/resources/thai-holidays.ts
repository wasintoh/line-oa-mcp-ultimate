/**
 * Thai holiday + festival calendar — feeds the line://calendar/thai-holidays
 * resource. AI agents read this to suggest sending times around peak periods.
 *
 * Dates are Bangkok-local (YYYY-MM-DD). Lunar holidays (ตรุษจีน, มาฆบูชา,
 * etc.) shift year-to-year — we list the 2026 dates and let agents/users
 * roll forward.
 */

export interface ThaiHoliday {
  date: string; // YYYY-MM-DD
  name_th: string;
  name_en: string;
  category: "public" | "buddhist" | "royal" | "cultural" | "seasonal" | "international";
  promo_pattern?: string; // marketing angle Thai SMBs use
  prep_lead_days?: number; // how many days before to start campaign
}

export const THAI_HOLIDAYS_2026: ThaiHoliday[] = [
  { date: "2026-01-01", name_th: "วันปีใหม่", name_en: "New Year's Day", category: "public", promo_pattern: "ขอบคุณลูกค้าทั้งปี + โปรปีใหม่", prep_lead_days: 14 },
  { date: "2026-02-14", name_th: "วาเลนไทน์", name_en: "Valentine's Day", category: "international", promo_pattern: "คู่รัก / ของขวัญ / Dating", prep_lead_days: 10 },
  { date: "2026-02-17", name_th: "ตรุษจีน", name_en: "Chinese New Year", category: "cultural", promo_pattern: "อั่งเปา / สินค้ามงคล / สีแดง-ทอง", prep_lead_days: 10 },
  { date: "2026-03-04", name_th: "มาฆบูชา", name_en: "Makha Bucha Day", category: "buddhist" },
  { date: "2026-04-06", name_th: "วันจักรี", name_en: "Chakri Day", category: "royal" },
  { date: "2026-04-13", name_th: "สงกรานต์ (วันแรก)", name_en: "Songkran Day 1", category: "public", promo_pattern: "หยุดยาว / Family / น้ำ / Travel", prep_lead_days: 14 },
  { date: "2026-04-14", name_th: "สงกรานต์", name_en: "Songkran Day 2", category: "public" },
  { date: "2026-04-15", name_th: "สงกรานต์", name_en: "Songkran Day 3", category: "public" },
  { date: "2026-05-01", name_th: "วันแรงงาน", name_en: "Labour Day", category: "public" },
  { date: "2026-05-05", name_th: "วันฉัตรมงคล", name_en: "Coronation Day", category: "royal" },
  { date: "2026-05-31", name_th: "วิสาขบูชา", name_en: "Visakha Bucha Day", category: "buddhist" },
  { date: "2026-06-03", name_th: "วันเฉลิมพระชนมพรรษา ราชินี", name_en: "Queen's Birthday", category: "royal" },
  { date: "2026-07-28", name_th: "วันเฉลิมพระชนมพรรษา ร.10", name_en: "King's Birthday", category: "royal" },
  { date: "2026-07-30", name_th: "อาสาฬหบูชา", name_en: "Asanha Bucha Day", category: "buddhist" },
  { date: "2026-07-31", name_th: "เข้าพรรษา", name_en: "Buddhist Lent (start)", category: "buddhist" },
  { date: "2026-08-12", name_th: "วันแม่", name_en: "Mother's Day", category: "royal", promo_pattern: "แม่ / ดอกมะลิ / สีฟ้า / ของขวัญสำหรับแม่", prep_lead_days: 21 },
  { date: "2026-10-13", name_th: "วันคล้ายวันสวรรคต ร.9", name_en: "Memorial Day (King Rama IX)", category: "royal" },
  { date: "2026-10-23", name_th: "วันปิยมหาราช", name_en: "Chulalongkorn Day", category: "royal" },
  { date: "2026-10-26", name_th: "ออกพรรษา", name_en: "End of Buddhist Lent", category: "buddhist" },
  { date: "2026-11-04", name_th: "วันลอยกระทง", name_en: "Loy Krathong", category: "cultural", promo_pattern: "Festival / กระทง / โคมไฟ / Ambient", prep_lead_days: 10 },
  { date: "2026-12-05", name_th: "วันพ่อ / วันคล้ายวันพระบรมราชสมภพ ร.9", name_en: "Father's Day", category: "royal", promo_pattern: "พ่อ / สีเหลือง / ของขวัญสำหรับพ่อ", prep_lead_days: 21 },
  { date: "2026-12-10", name_th: "วันรัฐธรรมนูญ", name_en: "Constitution Day", category: "public" },
  { date: "2026-12-25", name_th: "คริสต์มาส", name_en: "Christmas Day", category: "international", promo_pattern: "คริสต์มาส / สีแดง-เขียว / Year-end", prep_lead_days: 14 },
  { date: "2026-12-31", name_th: "วันสิ้นปี", name_en: "New Year's Eve", category: "public", promo_pattern: "Year-end clearance / Countdown / Reflection", prep_lead_days: 21 },
];

export function holidaysWithinDays(days: number, today: Date = new Date()): ThaiHoliday[] {
  const todayBkk = new Date(today.getTime() + 7 * 60 * 60 * 1000);
  const horizon = new Date(todayBkk.getTime() + days * 24 * 60 * 60 * 1000);
  return THAI_HOLIDAYS_2026.filter((h) => {
    const d = new Date(`${h.date}T00:00:00Z`);
    return d >= todayBkk && d <= horizon;
  });
}

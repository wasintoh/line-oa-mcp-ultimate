/**
 * Bundled LINE sticker catalog.
 *
 * LINE only allows bots to send a limited, finite set of stickers — those
 * documented in the "List of available stickers" page. This catalog tags
 * each sticker with English + Thai mood keywords so `line_find_sticker` can
 * surface relevant ones via keyword/mood lookup without an external API call.
 *
 * The set below is intentionally compact — well-curated > exhaustive. We pick
 * Brown & Cony stickers (pkg 11537/11538/11539) and the classic LINE Friends
 * (pkg 446/789) because they're the most universally recognized in Thailand.
 *
 * If you want to add stickers, ensure they appear in:
 *   https://developers.line.biz/en/docs/messaging-api/sticker-list/
 */

export interface StickerEntry {
  package_id: string;
  sticker_id: string;
  moods: string[];
  keywords_th: string[];
  keywords_en: string[];
  description: string;
}

export const STICKER_CATALOG: StickerEntry[] = [
  // ---- celebration / yay ----
  {
    package_id: "446",
    sticker_id: "1989",
    moods: ["celebration", "happy"],
    keywords_th: ["ดีใจ", "เย้", "ฉลอง", "สำเร็จ"],
    keywords_en: ["yay", "celebrate", "happy", "success"],
    description: "Cony cheering",
  },
  {
    package_id: "11537",
    sticker_id: "52002744",
    moods: ["celebration", "party"],
    keywords_th: ["ปาร์ตี้", "ฉลอง", "ดีใจ"],
    keywords_en: ["party", "celebration", "happy"],
    description: "Brown & friends partying",
  },
  {
    package_id: "11538",
    sticker_id: "51626501",
    moods: ["celebration"],
    keywords_th: ["ยินดี", "ดี", "เก่งมาก"],
    keywords_en: ["congratulations", "great", "well done"],
    description: "Brown applauding",
  },

  // ---- thanks ----
  {
    package_id: "11537",
    sticker_id: "52002735",
    moods: ["thanks"],
    keywords_th: ["ขอบคุณ", "ขอบคุณค่ะ", "ขอบคุณครับ"],
    keywords_en: ["thank", "thanks", "thank you"],
    description: "Cony saying thanks",
  },
  {
    package_id: "11538",
    sticker_id: "51626502",
    moods: ["thanks", "polite"],
    keywords_th: ["ขอบคุณ", "นอบน้อม"],
    keywords_en: ["thank you", "grateful"],
    description: "Brown bowing thank-you",
  },
  {
    package_id: "789",
    sticker_id: "10855",
    moods: ["thanks"],
    keywords_th: ["ขอบคุณ"],
    keywords_en: ["thanks"],
    description: "Moon thank-you",
  },

  // ---- sorry / apology ----
  {
    package_id: "11537",
    sticker_id: "52002745",
    moods: ["sorry", "apology"],
    keywords_th: ["ขอโทษ", "เสียใจ"],
    keywords_en: ["sorry", "apology", "regret"],
    description: "Brown apologizing",
  },
  {
    package_id: "11538",
    sticker_id: "51626507",
    moods: ["sorry"],
    keywords_th: ["ขอโทษ", "ผิดพลาด"],
    keywords_en: ["sorry", "mistake"],
    description: "Cony shy/sorry",
  },

  // ---- greeting / hello ----
  {
    package_id: "11537",
    sticker_id: "52002734",
    moods: ["greeting", "hello"],
    keywords_th: ["สวัสดี", "ทักทาย", "ไง"],
    keywords_en: ["hello", "hi", "greeting"],
    description: "Brown waving",
  },
  {
    package_id: "446",
    sticker_id: "1988",
    moods: ["greeting", "hello"],
    keywords_th: ["สวัสดี", "หวัดดี"],
    keywords_en: ["hello", "hi"],
    description: "Cony waving",
  },

  // ---- love / heart ----
  {
    package_id: "11537",
    sticker_id: "52002747",
    moods: ["love", "heart"],
    keywords_th: ["รัก", "หัวใจ", "ชอบ"],
    keywords_en: ["love", "heart", "like"],
    description: "Cony hearts",
  },

  // ---- ok / confirm ----
  {
    package_id: "11537",
    sticker_id: "52002740",
    moods: ["ok", "confirm"],
    keywords_th: ["โอเค", "ตกลง", "รับทราบ"],
    keywords_en: ["ok", "okay", "confirm", "got it"],
    description: "Brown OK gesture",
  },
  {
    package_id: "11538",
    sticker_id: "51626496",
    moods: ["ok", "thumbs_up"],
    keywords_th: ["ดี", "เห็นด้วย", "ทำได้"],
    keywords_en: ["good", "thumbs up", "agreed"],
    description: "Brown thumbs up",
  },

  // ---- sad / cry ----
  {
    package_id: "11537",
    sticker_id: "52002738",
    moods: ["sad", "cry"],
    keywords_th: ["เศร้า", "ร้องไห้", "เสียใจ"],
    keywords_en: ["sad", "cry", "upset"],
    description: "Cony crying",
  },

  // ---- excited / surprise ----
  {
    package_id: "11537",
    sticker_id: "52002748",
    moods: ["surprise", "shock"],
    keywords_th: ["ตกใจ", "สุดยอด", "ว้าว"],
    keywords_en: ["wow", "surprise", "shock"],
    description: "Brown surprised",
  },

  // ---- loading / wait ----
  {
    package_id: "11537",
    sticker_id: "52002756",
    moods: ["loading", "wait"],
    keywords_th: ["รอแป๊บ", "กำลังคิด", "รอ"],
    keywords_en: ["thinking", "wait", "loading", "hmm"],
    description: "Brown thinking",
  },

  // ---- sleep / night ----
  {
    package_id: "11537",
    sticker_id: "52002759",
    moods: ["sleep", "night"],
    keywords_th: ["นอน", "ราตรีสวัสดิ์", "ฝันดี"],
    keywords_en: ["sleep", "good night", "tired"],
    description: "Brown sleeping",
  },

  // ---- food / yum ----
  {
    package_id: "11537",
    sticker_id: "52002751",
    moods: ["food", "yum"],
    keywords_th: ["อร่อย", "กิน", "หิว"],
    keywords_en: ["yum", "eat", "delicious", "hungry"],
    description: "Brown eating",
  },
];

export function findStickers(query: string, limit = 5): StickerEntry[] {
  const q = query.toLowerCase().trim();
  if (!q) return STICKER_CATALOG.slice(0, limit);

  const score = (s: StickerEntry): number => {
    let n = 0;
    for (const m of s.moods) if (m === q || m.includes(q)) n += 3;
    for (const k of s.keywords_th) if (k === q || k.includes(q) || q.includes(k)) n += 2;
    for (const k of s.keywords_en) if (k.toLowerCase().includes(q)) n += 2;
    if (s.description.toLowerCase().includes(q)) n += 1;
    return n;
  };

  return [...STICKER_CATALOG]
    .map((s) => [s, score(s)] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([s]) => s);
}

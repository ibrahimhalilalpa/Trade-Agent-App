import trBadWords from './data/tr-badwords.json';
import enBadWords from './data/en-badwords.json';

// Borsa, finans ve genel kullanım için filtreye takılmaması gereken güvenli kelimeler (Whitelist)
const WHITELIST = new Set([
    'hisse', 'hisseni', 'hissenin', 'hisseler', 'hisselere', 'hisselerden', 'hisselerim',
    'risk', 'riski', 'riskleri', 'iskonto', 'iskontolu', 'iskontosuz',
    'bist', 'bist100', 'bist30', 'bist50', 'bist500',
    'teknik', 'analiz', 'analizi', 'analizleri', 'sektör', 'sektörel',
    'kapsam', 'kapsamında', 'amiral', 'fizik', 'fiziksel', 'yani', 'yeni'
]);

// 1. Türkçe ve İngilizce kelime listelerini birleştirip benzersizleştir (Set)
// 2. Whitelist kelimelerini filtre listesinden çıkar
// 3. Uzun kelimeleri önce ele alacak şekilde sırala (RegEx eşleşme önceliği için)
const ALL_BAD_WORDS: string[] = Array.from(
    new Set([...trBadWords, ...enBadWords])
)
    .map((word) => word.toLocaleLowerCase('tr-TR').trim())
    .filter((word) => word.length > 0 && !WHITELIST.has(word))
    .sort((a, b) => b.length - a.length);

const ESCAPED_WORDS = ALL_BAD_WORDS.map((word) =>
    word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
);

// Unicode desteği ile Türkçe harfleri (\p{L}) tam kelime sınırı olarak algılayan dinamik RegEx deseni
const PROFANITY_PATTERN = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${ESCAPED_WORDS.join('|')})(?![\\p{L}\\p{N}_])`,
    'giu'
);

/**
 * Metindeki yasaklı/küfürlü kelimeleri '***' ile sansürler.
 */
export function cleanText(text: string): string {
    if (!text) return '';
    PROFANITY_PATTERN.lastIndex = 0;
    return text.replace(PROFANITY_PATTERN, (match) => {
        // Eğer eşleşen kelime Whitelist içindeyse dokunma
        if (WHITELIST.has(match.toLocaleLowerCase('tr-TR'))) {
            return match;
        }
        return '*'.repeat(match.length);
    });
}

/**
 * Metinde herhangi bir yasaklı/küfürlü kelime olup olmadığını kontrol eder.
 */
export function hasProfanity(text: string): boolean {
    if (!text) return false;

    // Metni kelimelerine ayırıp Whitelist ve RegEx kontrollerinden geçir
    const words = text.toLocaleLowerCase('tr-TR').split(/[^\p{L}\p{N}_]+/u);

    for (const word of words) {
        if (!word || WHITELIST.has(word)) continue;

        PROFANITY_PATTERN.lastIndex = 0;
        if (PROFANITY_PATTERN.test(word)) {
            return true;
        }
    }

    return false;
}
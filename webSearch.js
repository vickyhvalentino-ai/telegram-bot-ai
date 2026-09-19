const TAVILY_API_KEY = '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';
const SERPER_API_KEY = 'e52de145383e7437e28cf88e262a1264f96d1243';

const MIN_SEARCH_RESULTS = 4;
const MAX_SEARCH_RESULTS = 10;
const REQUEST_TIMEOUT = 15000;
const MAX_QUERY_LENGTH = 700;
const SEARCH_CACHE_TTL = 60000;
const MAX_CONTEXT_CHARS = 26000;

const SEARCH_CACHE = new Map();

function cleanQuery(query) {
    return String(query || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_QUERY_LENGTH);
}

function jakartaDate() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

function containsAny(value, list) {
    return list.some(item => value.includes(item));
}

function isSportsQuery(value) {
    const sports = [
        'persija',
        'persib',
        'persita',
        'persik',
        'persebaya',
        'arema',
        'psm',
        'psis',
        'pss',
        'persis',
        'dewa united',
        'bali united',
        'madura united',
        'borneo',
        'malut united',
        'semen padang',
        'psbs',
        'liga 1',
        'liga indonesia',
        'super league',
        'premier league',
        'la liga',
        'serie a',
        'bundesliga',
        'champions league',
        'europa league',
        'nba',
        'nfl',
        'mlb',
        'nhl',
        'motogp',
        'formula 1',
        'formula one',
        'f1',
        'ufc',
        'boxing',
        'tennis',
        'badminton',
        'basketball',
        'sepak bola',
        'football',
        'soccer',
        'olahraga',
        'klasemen',
        'ranking',
        'standings',
        'peringkat',
        'pertandingan',
        'laga',
        'match',
        'tanding',
        'jadwal',
        'skor',
        'score',
        'lawan'
    ];

    return containsAny(value, sports);
}

function isScheduleQuery(value) {
    return containsAny(value, [
        'jadwal',
        'schedule',
        'tanggal',
        'tgl',
        'kapan main',
        'kapan tanding',
        'kapan pertandingan',
        'jam berapa',
        'pukul berapa',
        'lawan siapa',
        'lawan apa',
        'siapa lawannya',
        'besok main',
        'besok lawan',
        'hari apa main',
        'hari apa tanding',
        'fixture',
        'fixtures'
    ]);
}

function isRankingQuery(value) {
    return containsAny(value, [
        'klasemen',
        'standings',
        'ranking',
        'peringkat',
        'posisi',
        'tabel liga',
        'top skor',
        'top assist'
    ]);
}

function isNewsQuery(value) {
    return containsAny(value, [
        'berita',
        'news',
        'kabar',
        'terbaru',
        'terkini',
        'update',
        'breaking',
        'kejadian',
        'peristiwa',
        'perkembangan'
    ]);
}

function isFollowUpQuery(value) {
    return containsAny(value, [
        'lawan apa',
        'lawan siapa',
        'siapa lawannya',
        'tanggal berapa',
        'tanggal berapa main',
        'kapan main',
        'kapan tanding',
        'jam berapa',
        'main dimana',
        'main di mana',
        'stadion apa',
        'yang tadi',
        'yg tadi',
        'itu kapan',
        'itu dimana',
        'itu di mana',
        'terus siapa',
        'terus kapan',
        'abis itu',
        'setelah itu'
    ]);
}

function extractUserHistory(historyContext) {
    const text = String(historyContext || '');

    return text
        .split(/\n+/)
        .filter(line => /^USER\s*:/i.test(line))
        .map(line => line.replace(/^USER\s*:\s*/i, '').trim())
        .filter(Boolean)
        .slice(-4)
        .join(' ');
}

function buildSearchQuery(query, historyContext = '') {
    const original = cleanQuery(query);
    const lower = original.toLowerCase();
    const history = cleanQuery(extractUserHistory(historyContext));
    const followUp = isFollowUpQuery(lower);

    let base = original;

    if (followUp && history) {
        base = `${history} ${original}`;
    }

    const parts = [base];

    if (isSportsQuery(lower) || (followUp && isSportsQuery(history.toLowerCase()))) {
        if (isScheduleQuery(lower) || isScheduleQuery(history.toLowerCase())) {
            parts.push('latest official fixtures schedule');
        } else if (isRankingQuery(lower) || isRankingQuery(history.toLowerCase())) {
            parts.push('latest official standings table');
        } else {
            parts.push('latest official information');
        }

        parts.push(jakartaDate());
    }

    if (isNewsQuery(lower)) {
        parts.push('latest current information');
    }

    if (containsAny(lower, [
        'hari ini',
        'sekarang',
        'saat ini',
        'terbaru',
        'terkini',
        'today',
        'currently',
        'latest',
        'recent',
        'real time',
        'realtime'
    ])) {
        parts.push(`current as of ${jakartaDate()}`);
    }

    return cleanQuery(parts.join(' '));
}

async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();

    const timer = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT
    );

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timer);
    }
}

function normalizeResults(results, provider, maxResults) {
    if (!Array.isArray(results)) {
        return [];
    }

    return results
        .filter(item =>
            item &&
            (
                item.title ||
                item.url ||
                item.link ||
                item.content ||
                item.snippet ||
                item.description
            )
        )
        .map(item => ({
            title: String(
                item.title ||
                'Tanpa judul'
            ).trim(),
            url: String(
                item.url ||
                item.link ||
                ''
            ).trim(),
            content: String(
                item.content ||
                item.snippet ||
                item.description ||
                ''
            )
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 3500),
            provider,
            score:
                typeof item.score === 'number'
                    ? item.score
                    : null
        }))
        .filter(item =>
            /^https?:\/\/\S+$/i.test(item.url)
        )
        .slice(0, maxResults);
}

async function searchTavily(query, maxResults) {
    if (
        !TAVILY_API_KEY ||
        TAVILY_API_KEY === 'PASTE_TAVILY_API_KEY_DI_SINI'
    ) {
        throw new Error('Tavily API key belum diisi.');
    }

    const response = await fetchWithTimeout(
        'https://api.tavily.com/search',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                api_key: TAVILY_API_KEY,
                query,
                search_depth: 'basic',
                topic: 'general',
                max_results: maxResults,
                include_answer: false,
                include_raw_content: false
            })
        }
    );

    const data = await response
        .json()
        .catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            data?.detail ||
            data?.error ||
            `Tavily HTTP ${response.status}`
        );
    }

    return normalizeResults(
        data.results,
        'Tavily',
        maxResults
    );
}

async function searchSerper(query, maxResults) {
    if (
        !SERPER_API_KEY ||
        SERPER_API_KEY === 'PASTE_SERPER_API_KEY_DI_SINI'
    ) {
        throw new Error('Serper API key belum diisi.');
    }

    const response = await fetchWithTimeout(
        'https://google.serper.dev/search',
        {
            method: 'POST',
            headers: {
                'X-API-KEY': SERPER_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                q: query,
                num: maxResults,
                gl: 'id',
                hl: 'id'
            })
        }
    );

    const data = await response
        .json()
        .catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            data?.message ||
            data?.error ||
            `Serper HTTP ${response.status}`
        );
    }

    return normalizeResults(
        data.organic,
        'Serper',
        maxResults
    );
}

function getDomain(url) {
    try {
        return new URL(url)
            .hostname
            .toLowerCase()
            .replace(/^www\./, '');
    } catch {
        return '';
    }
}

function isOfficialSportsDomain(domain) {
    return [
        'ileague.id',
        'ligaindonesiabaru.com',
        'persija.id',
        'liga.id',
        'pssi.org'
    ].some(item =>
        domain === item ||
        domain.endsWith(`.${item}`)
    );
}

function rankResults(results, query) {
    const q = String(query || '').toLowerCase();
    const sports = isSportsQuery(q);
    const schedule = isScheduleQuery(q);
    const ranking = isRankingQuery(q);

    const queryWords = q
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(word => word.length >= 3)
        .slice(0, 25);

    return [...results]
        .map((item, index) => {
            const title =
                String(item.title || '')
                    .toLowerCase();

            const content =
                String(item.content || '')
                    .toLowerCase();

            const domain =
                getDomain(item.url);

            let score = 0;

            for (const word of queryWords) {
                if (title.includes(word)) {
                    score += 5;
                }

                if (content.includes(word)) {
                    score += 2;
                }
            }

            if (
                sports &&
                isOfficialSportsDomain(domain)
            ) {
                score += 25;
            }

            if (
                schedule &&
                (
                    title.includes('jadwal') ||
                    title.includes('fixture') ||
                    title.includes('match')
                )
            ) {
                score += 12;
            }

            if (
                ranking &&
                (
                    title.includes('klasemen') ||
                    title.includes('standings') ||
                    title.includes('ranking')
                )
            ) {
                score += 12;
            }

            if (
                item.provider === 'Serper'
            ) {
                score += 1;
            }

            return {
                ...item,
                relevanceScore: score,
                originalIndex: index
            };
        })
        .sort((a, b) => {
            if (
                b.relevanceScore !==
                a.relevanceScore
            ) {
                return (
                    b.relevanceScore -
                    a.relevanceScore
                );
            }

            return (
                a.originalIndex -
                b.originalIndex
            );
        });
}

function dedupeResults(results) {
    const seen = new Set();
    const output = [];

    for (const item of results) {
        const key =
            String(item.url || '')
                .trim()
                .toLowerCase();

        if (!key || seen.has(key)) {
            continue;
        }

        seen.add(key);
        output.push(item);
    }

    return output;
}

function randomSearchResultLimit() {
    return Math.floor(
        Math.random() *
        (
            MAX_SEARCH_RESULTS -
            MIN_SEARCH_RESULTS +
            1
        )
    ) + MIN_SEARCH_RESULTS;
}

function isSearchCached(query, historyContext = '') {
    const searchQuery =
        buildSearchQuery(
            query,
            historyContext
        );

    if (!searchQuery) {
        return false;
    }

    const cached =
        SEARCH_CACHE.get(
            searchQuery.toLowerCase()
        );

    return Boolean(
        cached &&
        Date.now() - cached.timestamp <
            SEARCH_CACHE_TTL
    );
}

async function searchWeb(
    query,
    historyContext = ''
) {
    const searchQuery =
        buildSearchQuery(
            query,
            historyContext
        );

    if (!searchQuery) {
        throw new Error(
            'Query web search kosong.'
        );
    }

    const cacheKey =
        searchQuery.toLowerCase();

    const cached =
        SEARCH_CACHE.get(cacheKey);

    if (
        cached &&
        Date.now() - cached.timestamp <
            SEARCH_CACHE_TTL
    ) {
        console.log(
            `[WEB SEARCH] Cache: ${searchQuery}`
        );

        return cached.data;
    }

    const resultLimit =
    randomSearchResultLimit();

const errors = [];
let tavilyResults = [];
let serperResults = [];

const lowerSearchQuery =
    searchQuery.toLowerCase();

const sports =
    isSportsQuery(
        lowerSearchQuery
    );

const schedule =
    isScheduleQuery(
        lowerSearchQuery
    );

const ranking =
    isRankingQuery(
        lowerSearchQuery
    );

const news =
    isNewsQuery(
        lowerSearchQuery
    );

const validation =
    isValidationQuery(
        lowerSearchQuery
    );

const highConfidenceSearch =
    sports ||
    schedule ||
    ranking ||
    news ||
    validation;

if (highConfidenceSearch) {

    const [tavily, serper] =
        await Promise.allSettled([
            searchTavily(
                searchQuery,
                resultLimit
            ),
            searchSerper(
                searchQuery,
                resultLimit
            )
        ]);

    if (tavily.status === 'fulfilled') {
        tavilyResults =
            tavily.value;
    } else {
        errors.push(
            `Tavily: ${tavily.reason?.message || 'Request gagal'}`
        );
    }

    if (serper.status === 'fulfilled') {
        serperResults =
            serper.value;
    } else {
        errors.push(
            `Serper: ${serper.reason?.message || 'Request gagal'}`
        );
    }

} else {

    try {
        tavilyResults =
            await searchTavily(
                searchQuery,
                resultLimit
            );
    } catch (error) {
        errors.push(
            `Tavily: ${error.message}`
        );
    }

    const tavilyNeedsBackup =
        tavilyResults.length < 3;

    if (
        tavilyNeedsBackup ||
        tavilyResults.length === 0
    ) {
        try {
            serperResults =
                await searchSerper(
                    searchQuery,
                    resultLimit
                );
        } catch (error) {
            errors.push(
                `Serper: ${error.message}`
            );
        }
    }
}

    let combined =
        dedupeResults([
            ...tavilyResults,
            ...serperResults
        ]);

    combined =
        rankResults(
            combined,
            searchQuery
        ).slice(
            0,
            resultLimit
        );

    if (combined.length === 0) {
        throw new Error(
            errors.length
                ? `Tidak ada hasil. ${errors.join(' | ')}`
                : 'Tidak ada hasil web.'
        );
    }

    const data = {
        provider:
            tavilyResults.length > 0 &&
            serperResults.length > 0
                ? 'Tavily + Serper'
                : tavilyResults.length > 0
                    ? 'Tavily'
                    : 'Serper',
        searchQuery,
        resultLimit,
        results: combined
    };

    SEARCH_CACHE.set(
        cacheKey,
        {
            timestamp: Date.now(),
            data
        }
    );

    console.log(
        `[WEB SEARCH] ${data.provider} | ${combined.length} hasil | ${searchQuery}`
    );

    return data;
}

function formatWebResultsForAI(searchData) {
    if (
        !searchData ||
        !Array.isArray(searchData.results) ||
        searchData.results.length === 0
    ) {
        return '';
    }

    const header = [
        '[WEB SEARCH EVIDENCE]',
        `Search query: ${searchData.searchQuery || ''}`,
        `Provider: ${searchData.provider || 'Web'}`,
        '',
        'Gunakan sumber di bawah sebagai bukti utama untuk fakta yang berubah.',
        'Jika sumber langsung menjawab pertanyaan, gunakan informasinya.',
        'Jangan mengatakan tidak tahu jika jawaban tersedia jelas di sumber.',
        'Jika sumber berbeda, jelaskan perbedaannya dan jangan mengarang.',
        ''
    ].join('\n');

    const sources =
        searchData.results
            .slice(0, MAX_SEARCH_RESULTS)
            .map((item, index) => {
                return [
                    `[SUMBER ${index + 1}]`,
                    `Judul: ${item.title}`,
                    `URL: ${item.url}`,
                    `Isi: ${item.content}`
                ].join('\n');
            })
            .join('\n\n');

    return `${header}${sources}`
        .slice(0, MAX_CONTEXT_CHARS);
}

function isValidationQuery(value) {
    const q = String(value || '')
        .toLowerCase()
        .trim();

    if (
        /\b(apakah|benarkah)\b[\s\S]{0,100}\b(benar|bener|valid)\b/i.test(q)
    ) {
        return true;
    }

    return containsAny(
        q,
        [
            'cek fakta',
            'cek kebenaran',
            'cek apakah benar',
            'cek apakah bener',
            'verifikasi',
            'fact check',
            'bener ga',
            'bener gak',
            'bener nggak',
            'benar ga',
            'benar gak',
            'benar nggak',
            'valid ga',
            'valid gak',
            'valid nggak',
            'hoaks',
            'hoax'
        ]
    );
}

function shouldSearchWeb(
    text,
    historyContext = ''
) {
    const current =
        String(text || '')
            .replace(/\[INFO SISTEM:[\s\S]*?\]/gi, ' ')
            .replace(/Permintaan pengguna dari tombol\s*:/gi, ' ')
            .replace(/WEB SEARCH AKTIF[\s\S]*/gi, ' ')
            .replace(/<<<BUTTONS:[\s\S]*?>>>/gi, ' ')
            .replace(/\s+/g, ' ')
            .toLowerCase()
            .trim();

    const history =
        extractUserHistory(
            historyContext
        ).toLowerCase();

    if (!current) {
        return false;
    }

    const combined =
        `${history} ${current}`;

    const explicitSearch = containsAny(
        current,
        [
            'cari',
            'carikan',
            'cariin',
            'cek online',
            'cek internet',
            'cek web',
            'cari di internet',
            'cari online',
            'search',
            'browse',
            'browsing',
            'look up',
            'lookup',
            'google it'
        ]
    );

    const validation =
        isValidationQuery(current);

    const currentIntent = containsAny(
        current,
        [
            'terbaru',
            'terkini',
            'sekarang',
            'saat ini',
            'hari ini',
            'besok',
            'kemarin',
            'latest',
            'recent',
            'currently',
            'today',
            'tomorrow',
            'yesterday',
            'right now',
            'real time',
            'realtime'
        ]
    );

    const questionIntent =
        /\b(?:siapa|kapan|dimana|di mana|berapa|who|when|where|how many)\b/i.test(current) ||
        /\bapa\s+(?:itu|arti|maksud|yang|saja|sih)\b/i.test(current) ||
        /\b(?:lu|lo)\s+tau(?:\s+ga)?\b/i.test(current) ||
        /\b(?:lu|lo)\s+tahu(?:\s+ga)?\b/i.test(current);

    const sports =
        isSportsQuery(combined);

    const schedule =
        isScheduleQuery(combined);

    const ranking =
        isRankingQuery(combined);

    const news =
        isNewsQuery(current);

    const followUp =
        isFollowUpQuery(current);

    const historyFresh =
        isSportsQuery(history) ||
        isScheduleQuery(history) ||
        isRankingQuery(history) ||
        isNewsQuery(history) ||
        containsAny(
            history,
            [
                'terbaru',
                'terkini',
                'hari ini',
                'sekarang',
                'besok',
                'kemarin',
                'latest',
                'recent'
            ]
        );

    const datePattern =
        /\b(?:tanggal|tgl)?\s*\d{1,2}\b/i.test(current) ||
        /\b\d{1,2}\s+(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\b/i.test(current) ||
        /\b(?:19|20)\d{2}\b/.test(current);

    if (explicitSearch) {
        return true;
    }

    if (validation) {
        return true;
    }

    if (news) {
        return true;
    }

    if (
        sports &&
        (
            schedule ||
            ranking ||
            currentIntent ||
            questionIntent ||
            datePattern ||
            followUp
        )
    ) {
        return true;
    }

    if (
        followUp &&
        historyFresh
    ) {
        return true;
    }

    if (
        currentIntent &&
        questionIntent
    ) {
        return true;
    }

    if (
        datePattern &&
        (
            questionIntent ||
            schedule
        )
    ) {
        return true;
    }

    return false;
}

module.exports = {
    searchWeb,
    formatWebResultsForAI,
    shouldSearchWeb,
    isSearchCached
};
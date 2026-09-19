/**
 * VGEN AI - TELEGRAM BOT EDITION
 * Engine Telegram Bot API + Fix HTML Parser & Formatting Security
 * Node.js 22+.
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const {
    searchWeb,
    formatWebResultsForAI,
    shouldSearchWeb,
    shouldShowWebSearchStatus,
    isSearchCached
} = require('./webSearch');

// ============================================================
// FIX RAILWAY CRASH (ANTI LOG SPAM)
// ============================================================
process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION]', err ? (err.message || err) : 'Unknown Error');
});

process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED REJECTION]', reason ? (reason.message || reason) : 'Unknown Rejection');
});

let vgenPrompt = '';
try {
    vgenPrompt = require('./prompt.js');
} catch (e) {
    vgenPrompt = 'Kamu adalah VGen AI, asisten yang cerdas dan efisien.';
}

// ============================================================
// KONFIGURASI
// ============================================================
const TELEGRAM_BOT_TOKEN = process.env.VICKYYVALL || 'PASTE_BOT_TOKEN_DI_SINI';
const PORT = process.env.PORT || 8080;
const MAX_HISTORY = 15;
const MAX_TEXT_FILE = 12000;

if (TELEGRAM_BOT_TOKEN === 'PASTE_BOT_TOKEN_DI_SINI') {
    console.error('❌ TELEGRAM_BOT_TOKEN belum diisi. Set environment variable TELEGRAM_BOT_TOKEN.');
    process.exit(1);
}

// ============================================================
// DATABASE API CONFIG
// ============================================================
const dbFile = path.join(__dirname, 'database.json');
let db = { apiConfig: {} };

if (fs.existsSync(dbFile)) {
    try {
        db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    } catch (e) {
        console.error('❌ Gagal membaca database.json:', e.message);
    }
}

function saveDb() {
    fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}

let activeProvider = db.apiConfig?.provider || null;
let activeKeys = db.apiConfig?.keys || []; // Nampung semua key dari HTML
let currentKeyIndex = db.apiConfig?.currentKeyIndex || 0;
let currentModelIndex = db.apiConfig?.currentModelIndex || 0;

// MUTLAK: MODEL YANG LU CIPTAIN GA DIUBAH!
const ROTATION_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-3.5-flash'];

// ============================================================
// 👑 USER ACCESS / VIP / AI LIMIT SYSTEM
// ============================================================

// Owner utama bot.
// Username dipakai untuk identitas tampilan.
// Nanti kita tambahkan verifikasi Telegram user ID juga.
const OWNER_USERNAME = 'vickyyvall';

// Limit AI.
const NON_VIP_LIMIT = 10;
const VIP_BASE_LIMIT = 50;
const VIP_BONUS_LIMIT = 25;
const VIP_TOTAL_LIMIT = VIP_BASE_LIMIT + VIP_BONUS_LIMIT;

// Harga VIP.
const VIP_PRICE = 25900;
const VIP_NORMAL_PRICE = 39900;

// Pastikan database user tersedia tanpa merusak data API lama.
if (!db.users || typeof db.users !== 'object' || Array.isArray(db.users)) {
    db.users = {};
}

function normalizeUsername(username) {
    return String(username || '')
        .trim()
        .replace(/^@+/, '')
        .toLowerCase();
}

function getUserKey(userId) {
    return String(userId || '').trim();
}

function isOwner(msgOrUser) {
    const user = msgOrUser?.from || msgOrUser || {};
    const username = normalizeUsername(user.username);

    return username === OWNER_USERNAME;
}

function getDateWIB() {
    return new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' });
}

function getUserRecord(msg) {
    const user = msg?.from || {};
    const userId = getUserKey(user.id);

    if (!userId) return null;

    const todayWIB = getDateWIB();

    if (!db.users[userId]) {
        db.users[userId] = {
            userId,
            username: normalizeUsername(user.username),
            firstName: String(user.first_name || ''),
            lastName: String(user.last_name || ''),
            status: isOwner(msg) ? 'OWNER' : 'NONVIP',
            vip: isOwner(msg),
            aiLimit: isOwner(msg) ? null : NON_VIP_LIMIT,
            limitBonus: 0,
            aiUsed: 0,
            lastResetDate: todayWIB,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        saveDb();
    } else {
        const record = db.users[userId];

        // 🔥 LOGIKA RESET HARIAN OTOMATIS JAM 00:00 WIB 🔥
        if (record.lastResetDate !== todayWIB) {
    record.aiUsed = 0;
    record.limitBonus = 0;
    record.lastResetDate = todayWIB;
}

if (!Number.isFinite(Number(record.limitBonus))) {
    record.limitBonus = 0;
}

        record.username = normalizeUsername(user.username);
        record.firstName = String(user.first_name || '');
        record.lastName = String(user.last_name || '');
        record.updatedAt = new Date().toISOString();

        if (isOwner(msg)) {
            record.status = 'OWNER';
            record.vip = true;
            record.aiLimit = null;
        }
        saveDb();
    }
    return db.users[userId];
}

function getUserLimitInfo(msg) {
    const user = getUserRecord(msg);

    if (!user) {
        return {
            status: 'NONVIP',
            total: NON_VIP_LIMIT,
            used: 0,
            remaining: NON_VIP_LIMIT,
            unlimited: false
        };
    }

    if (user.status === 'OWNER') {
        return {
            status: 'OWNER',
            total: null,
            used: Number(user.aiUsed || 0),
            remaining: null,
            unlimited: true
        };
    }

    const bonus = Math.max(
        0,
        Number(user.limitBonus || 0)
    );

    const total =
        user.status === 'VIP' || user.vip === true
            ? VIP_TOTAL_LIMIT + bonus
            : NON_VIP_LIMIT + bonus;

    return {
        status:
            user.status === 'VIP' || user.vip === true
                ? 'VIP'
                : 'NONVIP',
        total,
        used: Number(user.aiUsed || 0),
        remaining: Math.max(
            0,
            total - Number(user.aiUsed || 0)
        ),
        unlimited: false
    };
}

function formatRupiah(number) {
    return new Intl.NumberFormat('id-ID').format(Number(number || 0));
}

function getStatusLabel(status) {
    if (status === 'OWNER') return '👑 OWNER';
    if (status === 'VIP') return '🏆 VIP';
    return '👤 NON-VIP';
}

function getLimitLabel(info) {
    if (info.unlimited) return 'Unlimited ∞';

    return `${info.remaining} / ${info.total}`;
}

function getStatusLabel(status) {
    if (status === 'OWNER') return '👑 OWNER';
    if (status === 'VIP') return '🏆 VIP';
    return '👤 NON-VIP';
}

function getLimitLabel(info) {
    if (info.unlimited) return 'Unlimited ∞';

    return `${info.remaining} / ${info.total}`;
}

// Memori per chat Telegram.
const userHistory = new Map();
const aiMutedChats = new Set();
const latestWebSearchByChat = new Map();

// ============================================================
// 🧠 AI RESPONSE ANTI-SPAM
// ============================================================
const aiBusyChats = new Set();

function historyFor(chatId) {
    const key = String(chatId);
    if (!userHistory.has(key)) userHistory.set(key, []);
    return userHistory.get(key);
}

function pushHistory(chatId, role, content) {
    const history = historyFor(chatId);
    history.push({ role, content });
    if (history.length > MAX_HISTORY) {
        history.splice(0, history.length - MAX_HISTORY);
    }
}

function cleanText(value) {
    return String(value || '').trim();
}

function nowWIB() {
    return new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
}

function displayName(msg) {
    const u = msg.from || {};
    return [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || 'Telegram User';
}

function isCommand(text) {
    return /^(?:\/(?:start|help|mute|unmute|status|reset|addvip|addlimit|ceklimit)(?:@\w+)?(?:\s|$))/i.test(
        String(text || '').trim()
    );
}

function normalizeTelegramStructure(text) {
    const lines = String(text || '')
        .replace(/\r/g, '')
        .split('\n');

    const output = [];

    let inCodeBlock = false;
    let keepNextLineSeparate = false;

    const headingRegex =
        /^(?:\*\*[^*\n]+\*\*|<b>[^<\n]+<\/b>)$/;

    const pushBlankOnce = () => {
        if (
            output.length &&
            output[output.length - 1] !== ''
        ) {
            output.push('');
        }
    };

    for (const rawLine of lines) {
        const trimmed =
            String(rawLine || '')
                .replace(/\s+$/g, '')
                .trim();

        if (/^```/.test(trimmed)) {
            inCodeBlock = !inCodeBlock;

            output.push(
                rawLine.replace(/\s+$/g, '')
            );

            keepNextLineSeparate = false;
            continue;
        }

        if (inCodeBlock) {
            output.push(
                rawLine.replace(/\s+$/g, '')
            );
            continue;
        }

        if (!trimmed) {
            if (keepNextLineSeparate) {
                continue;
            }

            pushBlankOnce();
            continue;
        }

        if (/^>{2,}\s*$/.test(trimmed)) {
            continue;
        }

        if (headingRegex.test(trimmed)) {
            if (output.length) {
                pushBlankOnce();
            }

            output.push(trimmed);
            keepNextLineSeparate = true;
            continue;
        }

        const mainPoint =
            trimmed.match(/^(\d+)\s*\.\s*(.*)$/);

        if (mainPoint) {
            if (output.length) {
                pushBlankOnce();
            }

            const number = mainPoint[1];
            const body = mainPoint[2].trim();

            const boldTitle =
                body.match(/^\*\*(.+?)\*\*(?:\s*[:：]\s*(.*))?$/);

            if (boldTitle) {
                const title =
                    boldTitle[1].trim();

                const continuation =
                    String(
                        boldTitle[2] || ''
                    ).trim();

                output.push(
                    `${number}. **${title}**`
                );

                if (continuation) {
                    output.push(
                        continuation
                    );
                }

                keepNextLineSeparate =
                    !continuation;

                continue;
            }

            output.push(
                `${number}. ${body}`
            );

            keepNextLineSeparate = false;
            continue;
        }

        const dashPoint =
            trimmed.match(
                /^(?:[–—-])\s*(.+)$/
            );

        if (dashPoint) {
            output.push(
                `– ${dashPoint[1].trim()}`
            );

            keepNextLineSeparate = false;
            continue;
        }

        if (keepNextLineSeparate) {
            output.push(trimmed);
            keepNextLineSeparate = false;
            continue;
        }

        if (
            output.length &&
            output[output.length - 1] !== ''
        ) {
            output.push(trimmed);
        } else {
            output.push(trimmed);
        }
    }

    return output
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trimEnd();
}

// ============================================================
// AUTO CONVERT MARKDOWN TO TELEGRAM HTML & SANITIZER
// ============================================================
function convertMarkdownToHTML(text) {
    if (!text) return '';

    let formatted = String(text);
    const codeBlocks = [];
    const inlineCodes = [];

    // AMANKAN CODE BLOCK TERLEBIH DAHULU
    // agar HTML/JS/CSS di dalam kode tetap plain text dan bisa disalin.
    formatted = formatted.replace(/```(?:([a-zA-Z0-9_+#.-]+)\s*)?\n?([\s\S]*?)```/g, (match, language, code) => {
        const index = codeBlocks.length;
        const safeCode = String(code || '').replace(/^\n|\n$/g, '');

        codeBlocks.push(
            `<pre><code>${escapeHTML(safeCode)}</code></pre>`
        );

        return `\uE000CODEBLOCK${index}\uE000`;
    });

    // AMANKAN INLINE CODE
    formatted = formatted.replace(/`([^`]+)`/g, (match, code) => {
        const index = inlineCodes.length;

        inlineCodes.push(
            `<code>${escapeHTML(String(code))}</code>`
        );

        return `\uE000INLINECODE${index}\uE000`;
    });

    // MARKDOWN BIASA
    formatted = formatted.replace(/^\s*\*\s+/gm, '– ');
    formatted = formatted.replace(/\*\*([\s\S]*?)\*\*/g, '<b>$1</b>');
    formatted = formatted.replace(/\*([^*\n]+)\*/g, '<i>$1</i>');
    formatted = formatted.replace(/[\uFFFD]/g, '•');

    // KEMBALIKAN CODE BLOCK
    formatted = formatted.replace(
        /\uE000CODEBLOCK(\d+)\uE000/g,
        (_, index) => codeBlocks[Number(index)] || ''
    );

    // KEMBALIKAN INLINE CODE
    formatted = formatted.replace(
        /\uE000INLINECODE(\d+)\uE000/g,
        (_, index) => inlineCodes[Number(index)] || ''
    );

    return formatted;
}

function splitForTelegram(text, max = 4000) {
    const out = [];
    let rest = String(text || '');
    while (rest.length > max) {
        let cut = rest.lastIndexOf('\n', max);
        if (cut < 500) cut = max;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut).trimStart();
    }
    if (rest) out.push(rest);
    return out.length ? out : [''];
}

async function sendReply(bot, chatId, text, extra = {}) {
    if (!text) return;

    let safeText = String(text).trim();

    // ============================================================
    // 🔒 MUTLAK 1 GELEMBUNG TELEGRAM
    // Maksimum dibuat sedikit di bawah batas Telegram
    // agar tidak pernah masuk sistem split menjadi beberapa pesan.
    // ============================================================
    const MAX_ONE_BUBBLE = 3500;

    if (safeText.length > MAX_ONE_BUBBLE) {
        let cut = safeText.lastIndexOf('\n', MAX_ONE_BUBBLE);

        if (cut < 1000) {
            cut = MAX_ONE_BUBBLE;
        }

        safeText = safeText.slice(0, cut).trimEnd();

        safeText += '\n\n…';
    }

const structuredText =
    normalizeTelegramStructure(safeText);
const htmlText =
    convertMarkdownToHTML(structuredText);

    try {
        await bot.sendMessage(
            chatId,
            htmlText,
            {
                parse_mode: 'HTML',
                ...extra
            }
        );
    } catch (error) {
        console.error(
            '[SEND REPLY HTML ERROR, FALLBACK TO PLAIN TEXT]',
            error.message
        );

        const plainText = htmlText
            .replace(/<[^>]*>?/gm, '')
            .slice(0, MAX_ONE_BUBBLE)
            .trim();

        try {
            await bot.sendMessage(
                chatId,
                plainText,
                {
                    ...extra,
                    parse_mode: undefined
                }
            );
        } catch (fallbackError) {
            console.error(
                '[SEND REPLY FALLBACK ERROR]',
                fallbackError.message
            );
        }
    }
}

// ============================================================
// LONG-RUNNING TELEGRAM "RECORDING" PRESENCE
// ============================================================
function startRecordingPresence(chatId) {
    let stopped = false;
    const sendPresence = async () => {
        if (stopped) return;
        try {
            await bot.sendChatAction(chatId, 'typing'); 
        } catch (e) {}
    };
    sendPresence();
    const timer = setInterval(sendPresence, 4000);
    return () => {
        stopped = true;
        clearInterval(timer);
    };
}

// ============================================================
// TELEGRAM BOT
// ============================================================
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

bot.on('polling_error', (err) => console.error('[TELEGRAM POLLING ERROR]', err ? (err.message || err.code || 'Unknown Error') : 'Unknown'));
bot.on('webhook_error', (err) => console.error('[TELEGRAM WEBHOOK ERROR]', err ? (err.message || err.code || 'Unknown Error') : 'Unknown'));

// ============================================================
// PREMIUM START MENU
// ============================================================
const START_BUTTON_POOL = [
    { text: '🧠 Jelasin sesuatu', callback_data: 'ask|jelasin satu hal menarik hari ini' },
    { text: '😂 Bikin aku ketawa', callback_data: 'ask|bikin aku ketawa dengan jokes singkat' },
    { text: '💡 Fakta random', callback_data: 'ask|kasih satu fakta random yang menarik' },
    { text: '⚽ Bahas bola', callback_data: 'ask|bahas sepak bola yang menarik' },
    { text: '🎵 Rekomendasi musik', callback_data: 'ask|rekomendasikan musik terkenal berdasarkan mood' },
    { text: '🧑🏻‍🏫 Trik hp', callback_data: 'ask|kasih trik hp android yang berguna' },
    { text: '💻 Tips coding', callback_data: 'ask|kasih tips coding yang praktis' },
    { text: '🗣️ Ngobrol ai', callback_data: 'ask|jelasin sesuatu yang menarik tentang ai' }
];

function randomStartButtons() {
    return [...START_BUTTON_POOL].sort(() => Math.random() - 0.5).slice(0, 2);
}

bot.onText(/^\/(start|help)(?:@\w+)?$/i, async (msg) => {
    const user = getUserRecord(msg);
    const info = getUserLimitInfo(msg);

    const username = user?.username
        ? `@${user.username}`
        : 'Tidak ada username';

    const statusText =
        getStatusLabel(info.status);

    const limitText =
        info.unlimited
            ? 'Unlimited ∞'
            : `${info.remaining} / ${info.total}`;

    const usedText =
        `${info.used} penggunaan`;

    const text =
        `<b>✦ VICKYYVALL - AI ✦</b>\n` +
        `<i>YOUR AI • YOUR SPACE • YOUR VIBE</i>\n\n` +

        `<blockquote>` +
        `<b>👤 PROFILE</b>\n` +
        `› Username : <b>${username}</b>\n` +
        `› Status   : <b>${statusText}</b>\n` +
        `› AI Limit : <b>${limitText}</b>\n` +
        `› Terpakai : <b>${usedText}</b>` +
        `</blockquote>\n\n` +

        `<blockquote>` +
        `<b>💎 VIP ACCESS</b>\n` +
        `› Limit utama : <b>50</b>\n` +
        `› Bonus       : <b>+25</b>\n` +
        `› Total       : <b>75 AI / hari</b>\n` +
        `› Reset       : <b>00.00 WIB</b>\n` +
        `› Harga VIP   : <b>Rp25.900</b>` +
        `</blockquote>\n\n` +

        `<blockquote>` +
        `<b>✍🏻COMMAND BOT</b>\n` +
        `› <code>/start</code> — menu utama\n` +
        `› <code>/help</code> — bantuan & menu\n` +
        `› <code>/ceklimit</code> — cek limit AI\n` +
        `› <code>/mute</code> — matikan respons AI\n` +
        `› <code>/unmute</code> — aktifkan respons AI\n` +
        `› <code>/reset</code> — reset memori chat\n` +
        `› <code>/addvip @username</code> — owner\n` +
        `› <code>/addlimit @username jumlah</code> — owner` +
        `</blockquote>\n\n` +

        `<b>vickyyvall - AI multifungsi</b>\n` +
        `ngobrol, belajar, coding, cari ide, bahas bola, ` +
        `atau random juga boleh.`;

    const keyboard = [
        [
            {
                text: '💎 Upgrade AI',
                callback_data: 'ui|vip'
            },
            {
                text: '📊 Cek Limit',
                callback_data: 'ui|limit'
            }
        ],
        [
            {
                text: '🏆 Info VIP',
                callback_data: 'ui|vip'
            }
        ],
        [
            {
                text: '🎵 TikTok @vickyyvall',
                url: 'https://www.tiktok.com/@vickyyvall'
            }
        ],
        [
            {
                text: '📸 Instagram @vickyhx013_',
                url: 'https://www.instagram.com/vickyhx013_'
            }
        ],
        randomStartButtons()
    ];

    const mediaUrl =
        'https://ibb.co.com/s9tq563Y';

    try {
        await bot.sendPhoto(
            msg.chat.id,
            mediaUrl,
            {
                caption: text,
                parse_mode: 'HTML',
                reply_to_message_id:
                    msg.message_id,
                reply_markup: {
                    inline_keyboard:
                        keyboard
                }
            }
        );
    } catch (error) {
        await sendReply(
            bot,
            msg.chat.id,
            text,
            {
                reply_to_message_id:
                    msg.message_id,
                reply_markup: {
                    inline_keyboard:
                        keyboard
                }
            }
        );
    }
});

// ============================================================
// 👑 VIP COMMAND SYSTEM
// ============================================================

function findUserByUsername(username) {
    const target = normalizeUsername(username);

    if (!target) return null;

    for (const userId of Object.keys(db.users || {})) {
        const user = db.users[userId];

        if (normalizeUsername(user.username) === target) {
            return user;
        }
    }

    return null;
}

function getPrettyUserName(user) {
    if (!user) return 'User';

    if (user.username) {
        return `@${user.username}`;
    }

    return user.firstName || 'User';
}



bot.onText(/^\/mute(?:@\w+)?$/i, async (msg) => {

    aiMutedChats.add(String(msg.chat.id));
    userHistory.delete(String(msg.chat.id));

    await sendReply(
        bot,
        msg.chat.id,
        'Respon AI dimatikan untuk chat ini. Pakai /unmute kalau mau mengaktifkannya lagi.',
        {
            reply_to_message_id: msg.message_id
        }
    );
});


bot.onText(/^\/unmute(?:@\w+)?$/i, async (msg) => {

    aiMutedChats.delete(String(msg.chat.id));

    await sendReply(
        bot,
        msg.chat.id,
        'Respon AI diaktifkan lagi.',
        {
            reply_to_message_id: msg.message_id
        }
    );
});


bot.onText(/^\/reset(?:@\w+)?$/i, async (msg) => {

    userHistory.delete(String(msg.chat.id));

    await sendReply(
        bot,
        msg.chat.id,
        'Memori percakapan chat ini sudah direset.',
        {
            reply_to_message_id: msg.message_id
        }
    );
});

// ============================================================
// 💎 VIP MANAGEMENT COMMANDS
// ============================================================

// Escape HTML agar username tidak bisa merusak format Telegram.
function escapeHTML(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Cari user berdasarkan username yang sudah pernah berinteraksi
// dengan bot dan tersimpan di database.json.
function findUserByUsername(username) {
    const target = normalizeUsername(username);

    if (!target) return null;

    for (const userId of Object.keys(db.users || {})) {
        const user = db.users[userId];

        if (normalizeUsername(user.username) === target) {
            return user;
        }
    }

    return null;
}


// ============================================================
// .ADDVIP @USERNAME
// OWNER ONLY
// ============================================================

bot.onText(/^\/addvip(?:\s+(.+))?$/i, async (msg, match) => {

    if (!isOwner(msg)) {
        await sendReply(
            bot,
            msg.chat.id,
            `<blockquote>` +
            `<b>⛔ AKSES DITOLAK</b>\n\n` +
            `Perintah <code>/addvip</code> hanya bisa digunakan oleh owner bot.` +
            `</blockquote>`
        );
        return;
    }

    const argument = String(match?.[1] || '').trim();

    // WAJIB @username
    if (!/^@[A-Za-z0-9_]{5,32}$/.test(argument)) {
        await sendReply(
            bot,
            msg.chat.id,
            `<blockquote>` +
            `<b>⚠️ FORMAT SALAH</b>\n\n` +
            `Gunakan format:\n\n` +
            `<code>/addvip @username</code>\n\n` +
            `Contoh:\n` +
            `<code>/addvip @contohuser</code>\n\n` +
            `Jangan lupa tanda <b>@</b>.` +
            `</blockquote>`
        );
        return;
    }

    const username = normalizeUsername(argument);
    const target = findUserByUsername(username);

    if (!target) {
        await sendReply(
            bot,
            msg.chat.id,
            `<blockquote>` +
            `<b>🔎 USER BELUM DITEMUKAN</b>\n\n` +
            `Username <b>@${escapeHTML(username)}</b> belum ditemukan di database bot.\n\n` +
            `Minta user tersebut chat bot minimal sekali terlebih dahulu.` +
            `</blockquote>`
        );
        return;
    }

if (!normalizeUsername(target.username)) {
    await sendReply(
        bot,
        msg.chat.id,
        `<blockquote>` +
        `<b>⚠️ USERNAME TIDAK TERSEDIA</b>\n\n` +
        `Akun ini wajib memiliki username Telegram aktif agar bisa dikelola oleh <code>/addvip @username</code>.` +
        `</blockquote>`,
        {
            reply_to_message_id: msg.message_id
        }
    );

    return;
}

    target.status = 'VIP';
    target.vip = true;
    target.aiLimit = VIP_TOTAL_LIMIT;

    // Reset limit menjadi 75 ketika diberikan VIP.
    target.aiUsed = 0;
    target.vipGrantedAt = new Date().toISOString();
    target.updatedAt = new Date().toISOString();

    saveDb();

    await sendReply(
        bot,
        msg.chat.id,
        `<blockquote>` +
        `<b>🏆 VIP BERHASIL DIAKTIFKAN</b>\n\n` +
        `👤 User : <b>@${escapeHTML(username)}</b>\n` +
        `🏷️ Status : <b>VIP</b>\n` +
        `📊 Limit : <b>75</b>\n` +
        `├ Limit utama : 50\n` +
        `└ Bonus : +25\n\n` +
        `💎 Harga : <b>Rp25.900</b>` +
                `</blockquote>`,
        {
            reply_to_message_id: msg.message_id
        }
    );
}); 

// ============================================================
// /ADDLIMIT @USERNAME JUMLAH
// OWNER ONLY
// ============================================================

bot.onText(/^\/addlimit(?:@\w+)?(?:\s+(.+))?$/i, async (msg, match) => {

    if (!isOwner(msg)) {
        await sendReply(
            bot,
            msg.chat.id,
            `<blockquote>` +
            `<b>⛔ AKSES DITOLAK</b>\n\n` +
            `Perintah <code>/addlimit</code> hanya bisa digunakan oleh owner bot.` +
            `</blockquote>`,
            {
                reply_to_message_id: msg.message_id
            }
        );
        return;
    }

    const parts = String(match?.[1] || '')
        .trim()
        .split(/\s+/);

    const argument = parts[0] || '';
    const amount = Number(parts[1]);

    if (
        !/^@[A-Za-z0-9_]{5,32}$/.test(argument) ||
        !Number.isInteger(amount) ||
        amount < 1 ||
        amount > 1000
    ) {
        await sendReply(
            bot,
            msg.chat.id,
            `<blockquote>` +
            `<b>⚠️ FORMAT SALAH</b>\n\n` +
            `Gunakan:\n` +
            `<code>/addlimit @username jumlah</code>\n\n` +
            `Contoh:\n` +
            `<code>/addlimit @contohuser 5</code>\n\n` +
            `Jumlah tambahan: <b>1–1000</b> chat.` +
            `</blockquote>`,
            {
                reply_to_message_id: msg.message_id
            }
        );
        return;
    }

    const username = normalizeUsername(argument);
    const target = findUserByUsername(username);

    if (!target) {
        await sendReply(
            bot,
            msg.chat.id,
            `<blockquote>` +
            `<b>🔎 USER TIDAK DITEMUKAN</b>\n\n` +
            `@${escapeHTML(username)} belum tercatat di database bot.\n\n` +
            `Minta user tersebut chat bot minimal sekali terlebih dahulu.` +
            `</blockquote>`,
            {
                reply_to_message_id: msg.message_id
            }
        );
        return;
    }

    if (!normalizeUsername(target.username)) {
        await sendReply(
            bot,
            msg.chat.id,
            `<blockquote>` +
            `<b>⚠️ USERNAME TIDAK TERSEDIA</b>\n\n` +
            `User ini wajib memiliki username Telegram aktif.` +
            `</blockquote>`,
            {
                reply_to_message_id: msg.message_id
            }
        );
        return;
    }

    target.limitBonus =
        Math.max(
            0,
            Number(target.limitBonus || 0)
        ) + amount;

    target.updatedAt =
        new Date().toISOString();

    saveDb();

    const info = getUserLimitInfo({
        from: target
    });

    await sendReply(
        bot,
        msg.chat.id,
        `<blockquote>` +
        `<b>✅ LIMIT BERHASIL DITAMBAHKAN</b>\n\n` +
        `👤 User : <b>@${escapeHTML(username)}</b>\n` +
        `➕ Bonus : <b>+${amount}</b> chat\n` +
        `📦 Total hari ini : <b>${info.total}</b>\n` +
        `📈 Terpakai : <b>${info.used}</b>\n` +
        `⚡ Sisa : <b>${info.remaining}</b>\n\n` +
        `Bonus akan otomatis kembali ke <b>0</b> saat reset 00.00 WIB.` +
        `</blockquote>`,
        {
            reply_to_message_id: msg.message_id
        }
    );
});

// ============================================================
// 📊 .CEKLIMIT
// SUPPORT:
// /ceklimit
// /ceklimit @username
// ============================================================

bot.onText(/^\/ceklimit(?:@\w+)?(?:\s+(.+))?$/i, async (msg, match) => {

    const argument = String(match?.[1] || '').trim();

    // ========================================================
    // CEK DIRI SENDIRI
    // ========================================================

    if (!argument) {

        const info = getUserLimitInfo(msg);
        const username = normalizeUsername(msg.from?.username);

        const status = getStatusLabel(info.status);
        const limit = getLimitLabel(info);

        const explanation = info.unlimited
    ? `👑 Lu adalah owner, jadi akses vickyyvall  - AI lu unlimited.`
    : info.status === 'VIP'
        ? `💎 akun VIP punya 75 chat AI. setiap kali lu ngobrol langsung dengan AI, 1 limit terpakai.`
        : `ℹ️ limit cuma kepotong saat lu memakai AI. /start, command, cek limit, dan menu biasa nggak mengurangi limit.`;

        await sendReply(
            bot,
            msg.chat.id,
            `<b>📊 STATUS LIMIT AI</b>\n\n` +

            `<blockquote>` +
            `👤 Username : <b>@${escapeHTML(username || 'tidak tersedia')}</b>\n` +
            `🏷️ Status : <b>${status}</b>\n` +
            `💬 Limit : <b>${limit}</b>\n` +
            `📈 Terpakai : <b>${info.used}</b>` +
            `</blockquote>\n\n` +

            `${explanation}\n\n` +

            `<blockquote>` +
            `<b>💡 Gampangnya:</b>\n` +
            `${info.unlimited
                ? `lu bebas ngobrol dengan AI tanpa potongan limit.`
                : `yang dihitung cuma percakapan AI, bukan semua aktivitas lu di bot.`}` +
            `</blockquote>`,

            {
                reply_to_message_id: msg.message_id
            }
        );

        return;
    }


    // ========================================================
    // USERNAME HARUS @USERNAME
    // ========================================================

    if (!argument.startsWith('@')) {

        await sendReply(
            bot,
            msg.chat.id,

            `<blockquote>` +
            `<b>⚠️ FORMAT SALAH</b>\n\n` +
            `Gunakan:\n` +
            `<code>/ceklimit @username</code>\n\n` +
            `Contoh:\n` +
            `<code>/ceklimit @vickyyvall</code>` +
            `</blockquote>`,

            {
                reply_to_message_id: msg.message_id
            }
        );

        return;
    }


    // ========================================================
    // CARI USER
    // ========================================================

    const username = normalizeUsername(argument);
    const target = findUserByUsername(username);

    if (!target) {

        await sendReply(
            bot,
            msg.chat.id,

            `<blockquote>` +
            `<b>🔎 USER TIDAK DITEMUKAN</b>\n\n` +
            `@${escapeHTML(username)} belum tercatat di database bot.\n\n` +
            `Minta user tersebut chat bot minimal sekali terlebih dahulu.` +
            `</blockquote>`,

            {
                reply_to_message_id: msg.message_id
            }
        );

        return;
    }


    // ========================================================
    // HITUNG LIMIT USER
    // ========================================================

    const isTargetOwner = target.status === 'OWNER';

    const bonus = Math.max(
    0,
    Number(target.limitBonus || 0)
);

const total = isTargetOwner
    ? 'Unlimited ∞'
    : target.status === 'VIP'
        ? VIP_TOTAL_LIMIT + bonus
        : NON_VIP_LIMIT + bonus;

    const used = Number(target.aiUsed || 0);

    const remaining = isTargetOwner
        ? 'Unlimited ∞'
        : Math.max(0, Number(total) - used);

    const status =
        target.status === 'OWNER'
            ? '👑 OWNER'
            : target.status === 'VIP'
                ? '🏆 VIP'
                : '👤 NON-VIP';


    // ========================================================
    // HASIL
    // ========================================================

    await sendReply(
        bot,
        msg.chat.id,

        `<b>📊 CEK LIMIT USER</b>\n\n` +

        `<blockquote>` +
        `👤 Username : <b>@${escapeHTML(username)}</b>\n` +
        `🏷️ Status : <b>${status}</b>\n` +
        `📦 Total : <b>${total}</b>\n` +
        `📉 Terpakai : <b>${used}</b>\n` +
        `⚡ Sisa : <b>${remaining}</b>` +
        `</blockquote>\n\n` +

        `<blockquote>` +
        `<b>💡 Keterangan:</b>\n` +
        `${
            isTargetOwner
                ? `Akun ini memiliki akses AI <b>Unlimited</b>.`
                : target.status === 'VIP'
                    ? `Akun VIP memiliki paket limit AI khusus. Limit berkurang hanya saat fitur AI digunakan.`
                    : `Akun NON-VIP menggunakan limit AI standar.`
        }` +
        `</blockquote>`,

        {
            reply_to_message_id: msg.message_id
        }
    );
});

// ============================================================
// 🔐 AI LIMIT GATE
// ============================================================

function consumeAiLimit(msg) {
    const info = getUserLimitInfo(msg);
    const user = getUserRecord(msg);

    if (!user) return { allowed: false, info };

    // 🔥 LIMIT HABIS DITOLAK MENTAH-MENTAH 🔥
    if (!info.unlimited && info.remaining <= 0) {
        return { allowed: false, info };
    }

    // 🔥 SEMUA PENGGUNAAN (TERMASUK OWNER) DICATAT! 🔥
    user.aiUsed = Number(user.aiUsed || 0) + 1;
    user.updatedAt = new Date().toISOString();
    saveDb();

    return { allowed: true, info: getUserLimitInfo(msg) };
}

function buildLimitExpiredMessage(info) {
    const isVip = info?.status === 'VIP';
    const limitText = Number(info?.total || 0);

    if (isVip) {
        return {
            text:
                `<blockquote>` +
                `<b>🏷️ BLACKTICK AI NOTICE</b>\n\n` +
                `<b>🚫 LIMIT VIP HABIS</b>\n\n` +
                `Sisa limit AI VIP lu sekarang <b>0</b> dari ${limitText} chat hari ini.\n\n` +
                `Tenang, limit harian otomatis direset setiap <b>00.00 WIB (12 malam)</b>.\n` +
                `Setelah reset, akses VIP lu balik lagi sesuai paket.` +
                `</blockquote>`,
            keyboard: buildMembershipKeyboard()
        };
    }

    return {
        text:
            `<blockquote>` +
            `<b>🏷️ BLACKTICK AI NOTICE</b>\n\n` +
            `<b>🚫 AI LIMIT HABIS</b>\n\n` +
            `Limit AI NON-VIP lu sudah mencapai batas <b>${limitText}</b> chat hari ini.\n\n` +
            `Limit otomatis direset setiap <b>00.00 WIB (12 malam)</b>.\n` +
            `Kalau mau akses lebih banyak, upgrade ke <b>VIP</b> dengan total <b>75 chat AI / hari</b>.\n\n` +
            `<s>Rp39.900</s> → <b>Rp25.900</b>` +
            `</blockquote>`,
        keyboard: [
            [
                { text: '💎 Keanggotaan / Upgrade VIP', callback_data: 'ui|vip' }
            ],
            [
                { text: '📱 Telegram', url: TELEGRAM_OWNER_URL },
                { text: '💬 WhatsApp', url: WHATSAPP_OWNER_URL }
            ]
        ]
    };
}

// ============================================================
// 📎 TELEGRAM MEDIA HANDLER
// ============================================================

async function downloadTelegramFile(fileId) {
    try {
        const file = await bot.getFile(fileId);

        if (!file?.file_path) {
            return null;
        }

        const url =
            `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;

        const res = await fetch(url);

        if (!res.ok) {
            throw new Error(`Download Telegram gagal (${res.status})`);
        }

        const buffer = Buffer.from(await res.arrayBuffer());

        return {
            buffer,
            filePath: file.file_path
        };

    } catch (error) {
        console.error('[MEDIA DOWNLOAD]', error.message);
        return null;
    }
}


function getMediaFromMessage(msg) {

    // FOTO TELEGRAM
    if (msg.photo?.length) {
        return {
            fileId: msg.photo[msg.photo.length - 1].file_id,
            mediaType: 'image',
            mimeType: 'image/jpeg',
            fileName: 'telegram-photo.jpg'
        };
    }

    // DOKUMEN / FILE
    if (msg.document) {
        return {
            fileId: msg.document.file_id,
            mediaType: 'document',
            mimeType: msg.document.mime_type || 'application/octet-stream',
            fileName: msg.document.file_name || 'document'
        };
    }

    return null;
}


async function buildMediaPrompt(msg, basePrompt) {

    const media = getMediaFromMessage(msg);

    // Pesan biasa tanpa media
    if (!media) {
        return {
            finalPrompt: basePrompt,
            base64Media: null,
            mimeTypeMedia: null
        };
    }

    const downloaded = await downloadTelegramFile(media.fileId);

    if (!downloaded) {
        return {
            finalPrompt:
                `[Sistem: Lampiran Telegram tidak berhasil diunduh.]\n\n${basePrompt}`,
            base64Media: null,
            mimeTypeMedia: null
        };
    }


    // =========================================================
    // 📄 FILE / DOKUMEN
    // =========================================================

    if (media.mediaType === 'document') {

        const lowerName = media.fileName.toLowerCase();

        const readable =
            media.mimeType.includes('text') ||
            media.mimeType.includes('json') ||
            media.mimeType.includes('javascript') ||
            media.mimeType.includes('xml') ||
            media.mimeType.includes('yaml') ||
            media.mimeType.includes('x-yaml') ||
            /\.(html?|css|scss|sass|less|js|jsx|mjs|cjs|ts|tsx|json|jsonc|xml|svg|php|py|pyw|java|kt|kts|c|h|cc|cpp|cxx|hpp|cs|go|rs|swift|dart|rb|pl|pm|lua|r|sql|sh|bash|zsh|fish|ps1|bat|cmd|yaml|yml|toml|ini|conf|config|env|md|markdown|txt|csv|tsv|graphql|gql|proto|regex|dockerfile|makefile|mk|cmake|gitignore|gitattributes|editorconfig|prettierrc|eslintrc|lock)$/i.test(lowerName) ||
            /^(readme(?:\..*)?|prompt(?:\..*)?|dockerfile|makefile|gemfile|rakefile|procfile|license|\.env(?:\..*)?)$/i.test(lowerName);

        // File teks yang bisa langsung dibaca AI
        if (readable) {

            const fileText =
                downloaded.buffer
                    .toString('utf8')
                    .slice(0, MAX_TEXT_FILE);

            return {
                finalPrompt:
                    `[Sistem: Pengguna mengirim dokumen "${media.fileName}".]\n` +
                    `Isi Dokumen:\n` +
                    '```\n' +
                    fileText +
                    '\n```\n\n' +
                    `Pesan pengguna:\n${basePrompt}`,

                base64Media: null,
                mimeTypeMedia: null
            };
        }

        // File binary / dokumen yang tidak dibaca sebagai teks
        return {
            finalPrompt:
                `[Sistem: Pengguna mengirim lampiran dokumen "${media.fileName}".]\n\n` +
                basePrompt,

            base64Media: null,
            mimeTypeMedia: media.mimeType
        };
    }


    // =========================================================
    // 🖼️ GAMBAR
    // =========================================================

    return {
        finalPrompt:
            `[Sistem: Pengguna mengirim gambar. Analisa gambar tersebut.]\n\n` +
            basePrompt,

        base64Media: downloaded.buffer.toString('base64'),
        mimeTypeMedia: 'image/jpeg'
    };
}

const delay = ms => new Promise(res => setTimeout(res, ms));

const SEARCH_STATUS_TOPICS = [
    'Scanning relevant sources',
    'Reviewing relevant pages',
    'Checking source details',
    'Comparing source references',
    'Filtering useful results',
    'Verifying source information',
    'Reading relevant passages',
    'Connecting related information',
    'Narrowing relevant results',
    'Checking fresh signals',
    'Reviewing supporting details',
    'Comparing matching results',
    'Checking live web sources',
    'Scanning current references',
    'Reviewing recent information',
    'Cross-checking source details',
    'Checking related pages',
    'Matching relevant findings',
    'Reviewing available sources',
    'Checking additional references',
    'Comparing recent findings',
    'Verifying matching information',
    'Checking source consistency',
    'Reviewing relevant records',
    'Scanning current information',
    'Checking related results',
    'Comparing useful references',
    'Reviewing source coverage',
    'Checking supporting sources',
    'Verifying recent details',
    'Scanning relevant pages',
    'Reviewing current findings',
    'Checking matching sources',
    'Comparing available data',
    'Reviewing source context',
    'Checking additional results',
    'Verifying current references',
    'Scanning related information',
    'Reviewing matching pages',
    'Checking relevant records',
    'Comparing source details',
    'Reviewing current sources',
    'Checking fresh references',
    'Verifying useful findings',
    'Scanning supporting information',
    'Reviewing related sources',
    'Checking recent references',
    'Comparing relevant pages',
    'Verifying source coverage',
    'Scanning matching results',
    'Reviewing available findings',
    'Checking source signals',
    'Comparing current references',
    'Reviewing relevant details',
    'Checking supporting pages',
    'Verifying matching results',
    'Scanning recent sources',
    'Reviewing source findings',
    'Checking related references',
    'Comparing fresh information',
    'Verifying current details',
    'Scanning available sources',
    'Reviewing matching references',
    'Checking relevant findings',
    'Comparing supporting sources',
    'Reviewing recent pages',
    'Verifying source information',
    'Scanning current references',
    'Checking matching pages',
    'Reviewing additional sources',
    'Comparing related findings',
    'Checking source details',
    'Verifying recent references',
    'Scanning relevant information',
    'Reviewing current pages',
    'Checking supporting findings',
    'Comparing matching references',
    'Verifying available information',
    'Scanning related pages',
    'Reviewing source details',
    'Checking fresh findings',
    'Comparing current sources',
    'Verifying relevant references',
    'Scanning recent information',
    'Reviewing matching sources',
    'Checking available references',
    'Comparing source findings',
    'Verifying related information',
    'Scanning supporting references',
    'Reviewing fresh sources',
    'Checking current details',
    'Comparing relevant findings',
    'Verifying matching pages',
    'Scanning source references',
    'Reviewing related details',
    'Checking recent findings',
    'Comparing available sources',
    'Reviewing current references',
    'Checking relevant sources',
    'Verifying supporting details'
];

function randomSearchStatusDuration() {
    const u = Math.random();
    const v = Math.random();

    const wave =
        (Math.sin(
            u * Math.PI * 2
        ) + 1) / 2;

    return Math.round(
        2300 +
        Math.pow(v, 0.72) * 3000 +
        wave * 700
    );
}

function shuffleSearchTopics() {
    const topics = [
        ...SEARCH_STATUS_TOPICS
    ];

    for (
        let i = topics.length - 1;
        i > 0;
        i--
    ) {
        const j = Math.floor(
            Math.random() * (i + 1)
        );

        [
            topics[i],
            topics[j]
        ] = [
            topics[j],
            topics[i]
        ];
    }

    return topics;
}

async function startWebSearchStatusBubble(
    chatId,
    replyToId,
    query
) {
    let stopped = false;
    let statusMessage = null;
    let timer = null;
    let wake = null;

    let dotIndex = 0;
    let topicIndex = 0;
    let mode = 'searching';
    let currentTopic = '';
    let stageEndsAt = 0;
    let editing = false;

    const stop = () => {
        stopped = true;

        if (timer) {
            clearTimeout(timer);
            timer = null;
        }

        if (wake) {
            const resolve = wake;
            wake = null;
            resolve();
        }
    };

    const waitOrStop = ms =>
        new Promise(resolve => {
            if (stopped) {
                resolve();
                return;
            }

            wake = resolve;

            timer = setTimeout(() => {
                timer = null;
                wake = null;
                resolve();
            }, ms);
        });

    const dots = [
        '.',
        '..',
        '...'
    ];

    const getSubject = value => {
        let cleaned = String(value || '');

        cleaned = cleaned
            .replace(/\[INFO SISTEM:[\s\S]*?\]/gi, ' ')
            .replace(/Permintaan pengguna dari tombol\s*:/gi, ' ')
            .replace(/Waktu sekarang[^.\n]*/gi, ' ')
            .replace(/User ini statusnya[^.\n]*/gi, ' ')
            .replace(/Limit hanya berlaku[^.\n]*/gi, ' ')
            .replace(/WEB SEARCH AKTIF[\s\S]*/gi, ' ')
            .replace(/<<<BUTTONS:[\s\S]*?>>>/gi, ' ')
            .replace(/https?:\/\/\S+/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const stopWords = new Set([
            'apa',
            'apakah',
            'siapa',
            'kapan',
            'dimana',
            'di',
            'mana',
            'yang',
            'dan',
            'atau',
            'itu',
            'ini',
            'tadi',
            'sekarang',
            'terbaru',
            'terkini',
            'dong',
            'sih',
            'ga',
            'gak',
            'nggak',
            'enggak',
            'tau',
            'tahu',
            'lu',
            'lo',
            'gue',
            'gw',
            'aku',
            'kamu',
            'tolong',
            'coba',
            'carikan',
            'cari',
            'cek',
            'online',
            'web',
            'search',
            'jadwal',
            'tanggal',
            'lawan',
            'main',
            'tanding',
            'pertandingan',
            'besok',
            'hari',
            'jam',
            'berapa'
        ]);

        const words = cleaned
            .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
            .split(/\s+/)
            .filter(Boolean)
            .filter(word => !stopWords.has(word.toLowerCase()))
            .slice(0, 5);

        return words.join(' ').trim();
    };

    const subject = getSubject(query);

    const topics = [
        'Checking the main result',
        'Reviewing relevant pages',
        'Comparing source details',
        'Checking fresh information',
        'Verifying useful findings',
        'Scanning matching results',
        'Reviewing current references',
        'Checking supporting sources',
        'Comparing available data',
        'Verifying source details',
        'Scanning related pages',
        'Reviewing search findings',
        'Checking recent references',
        'Comparing relevant sources',
        'Verifying matching results',
        'Scanning source coverage',
        'Reviewing useful pages',
        'Checking current details',
        'Comparing search results',
        'Verifying recent findings',
        'Scanning relevant information',
        'Reviewing source context',
        'Checking matching references',
        'Comparing current findings',
        'Verifying supporting details',
        'Scanning available sources',
        'Reviewing related information',
        'Checking fresh references',
        'Comparing source signals',
        'Verifying relevant findings',
        'Scanning matching pages',
        'Reviewing current sources',
        'Checking useful references',
        'Comparing recent information',
        'Verifying source coverage',
        'Scanning supporting pages',
        'Reviewing matching details',
        'Checking relevant records',
        'Comparing fresh sources',
        'Verifying current information',
        'Scanning recent pages',
        'Reviewing available findings',
        'Checking source signals',
        'Comparing related sources',
        'Verifying matching details',
        'Scanning current references',
        'Reviewing supporting information',
        'Checking fresh findings',
        'Comparing relevant pages',
        'Verifying available sources',
        'Scanning source details',
        'Reviewing recent references',
        'Checking matching information',
        'Comparing current sources',
        'Verifying useful details',
        'Scanning related references',
        'Reviewing fresh sources',
        'Checking source findings',
        'Comparing supporting pages',
        'Verifying recent information',
        'Scanning available references',
        'Reviewing relevant details',
        'Checking current findings',
        'Comparing matching sources',
        'Verifying fresh details',
        'Scanning supporting references',
        'Reviewing source information',
        'Checking recent details',
        'Comparing available pages',
        'Verifying related findings',
        'Scanning current information',
        'Reviewing matching references',
        'Checking relevant sources',
        'Comparing fresh findings',
        'Verifying source context',
        'Scanning useful results',
        'Reviewing current details',
        'Checking supporting findings',
        'Comparing recent sources',
        'Verifying matching pages',
        'Scanning fresh information',
        'Reviewing related sources',
        'Checking available details',
        'Comparing source findings',
        'Verifying current references',
        'Checking the latest signals',
        'Reviewing the strongest matches',
        'Comparing source coverage',
        'Verifying the latest details',
        'Scanning the newest results',
        'Reviewing relevant records',
        'Checking the latest references',
        'Comparing matching details',
        'Verifying supporting sources',
        'Scanning the current results',
        'Reviewing fresh findings',
        'Checking related details',
        'Comparing current pages',
        'Verifying useful references',
        'Scanning the latest information'
    ];

    const shuffled = [...topics];

    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const getTopicDuration = () =>
    Math.floor(
        Math.random() * 201
    ) + 300;

    const editStatus = async () => {
        if (
            !statusMessage ||
            stopped ||
            editing
        ) {
            return;
        }

        editing = true;

        try {
            const currentText =
                mode === 'searching'
                    ? '🔍Searching'
                    : `⏳${currentTopic}`;

            const text =
                `${currentText}${dots[dotIndex]}`;

            dotIndex =
                (dotIndex + 1) %
                dots.length;

            await bot.editMessageText(
                text,
                {
                    chat_id: chatId,
                    message_id:
                        statusMessage.message_id
                }
            );
        } catch (error) {
        } finally {
            editing = false;
        }
    };

    try {
        statusMessage =
            await bot.sendMessage(
                chatId,
                '🔍Searching.',
                {
                    reply_to_message_id:
                        replyToId ||
                        undefined
                }
            );

        mode = 'searching';

        stageEndsAt =
    Date.now() +
    Math.floor(
        Math.random() * 3000
    ) +
    1; 

        const loop = async () => {
            while (!stopped) {
                const now = Date.now();

                if (now >= stageEndsAt) {
                    mode = 'topic';

                    currentTopic =
                        shuffled[
                            topicIndex %
                            shuffled.length
                        ];

                    topicIndex++;

                    if (subject) {
                        currentTopic =
                            `${currentTopic} for ${subject}`;
                    }

                    stageEndsAt =
                        Date.now() +
                        getTopicDuration();
                }

                await editStatus();

                await waitOrStop(300);
            }
        };

        loop();

        return stop;
    } catch (error) {
        console.warn(
            '[SEARCH STATUS ERROR]',
            error.message
        );

        return stop;
    }
}

async function _askAILogic(
    chatId,
    finalPrompt,
    base64Media,
    mimeTypeMedia,
    currentKey,
    currentModel,
    replyToId = null
) {

    // ============================================================
    // 🌐 WEB SEARCH
    //
    // Hanya mencari web kalau pertanyaan membutuhkan
    // informasi yang kemungkinan terbaru.
    //
    // Gambar/media TIDAK memicu web search.
    // ============================================================

    let webContext = '';

latestWebSearchByChat.set(
    String(chatId),
    []
);

const searchHistoryContext =
    historyFor(chatId)
        .filter(
            item =>
                item &&
                typeof item.content === 'string'
        )
        .slice(-6)
        .map(
            item =>
                `${item.role === 'assistant' ? 'AI' : 'USER'}: ${item.content}`
        )
        .join('\n');

const cleanSearchIntent = String(finalPrompt)
    .replace(/\[INFO SISTEM:[\s\S]*?\]/gi, ' ')
    .replace(/Permintaan pengguna dari tombol\s*:/gi, ' ')
    .replace(/WEB SEARCH AKTIF[\s\S]*/gi, ' ')
    .replace(/<<<BUTTONS:[\s\S]*?>>>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const needsWebSearch =
    !base64Media &&
    shouldSearchWeb(
        cleanSearchIntent,
        searchHistoryContext
    );

const showWebSearchStatus =
    needsWebSearch &&
    shouldShowWebSearchStatus(
        cleanSearchIntent,
        searchHistoryContext
    );

if (needsWebSearch) {
    let stopSearchStatus = null;

    try {
        console.log(
            `[WEB SEARCH] Query user: ${cleanSearchIntent.slice(0, 200)}`
        );

        console.log(
            `[WEB SEARCH] Context: ${String(searchHistoryContext).slice(0, 500)}`
        );

        if (
            !isSearchCached(
                cleanSearchIntent,
                searchHistoryContext
            )
        ) {

            if (showWebSearchStatus) {
                stopSearchStatus =
                    await startWebSearchStatusBubble(
                        chatId,
                        replyToId,
                        cleanSearchIntent
                    );
            }

            const webData =
                await searchWeb(
                    cleanSearchIntent,
                    searchHistoryContext
                );

            latestWebSearchByChat.set(
                String(chatId),
                Array.isArray(webData.results)
                    ? webData.results.slice(0, 10)
                    : []
            );

            webContext =
                formatWebResultsForAI(
                    webData
                );

            console.log(
                `[WEB SEARCH] Provider: ${webData.provider} | Hasil: ${webData.results.length}`
            );

            console.log(
                `[WEB SEARCH] Query aktual: ${webData.searchQuery}`
            );
        }

    } catch (webError) {

        console.error(
            '[WEB SEARCH FAILED]',
            webError.message
        );

    } finally {

        if (stopSearchStatus) {
            stopSearchStatus();
        }
    }
}

const history = historyFor(chatId);
    const contents = history.map(h => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }]
    }));

const rankingRequest =
    /(?:klasemen|standings|ranking|peringkat|posisi|tabel liga|top skor|top assist)/i
        .test(cleanSearchIntent);

const rankingReminder =
    rankingRequest
        ? `
[SISTEM FORMAT RANKING MUTLAK]

Jawaban ini membahas klasemen/ranking.

WAJIB:
- Maksimal 10 posisi.
- Gunakan nomor emoji Telegram:
1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟
- Jangan gunakan "1." "2." "3." untuk posisi ranking.
- Jangan menggunakan bullet • sebagai pengganti nomor ranking.
- Pertahankan urutan hasil WEB SEARCH.
- Jangan mengarang poin.
- Jika poin tersedia, gunakan:
1️⃣ Nama Tim 🏆 • (42) Point.
- Jika poin tidak tersedia, gunakan:
1️⃣ Nama Tim
- Gunakan blockquote untuk seluruh daftar ranking.
- Jangan membuat tabel ASCII atau Markdown.
- Jangan menaruh penjelasan di tengah daftar.
`
        : '';
        
    const parts = [{
    text: webContext
        ? `${finalPrompt}

${rankingReminder}

[SISTEM WEB SEARCH]

WEB SEARCH AKTIF.

Gunakan hasil web sebagai evidence utama untuk fakta yang dapat berubah.

Jika hasil web memiliki jawaban yang jelas:
→ jawab langsung berdasarkan hasil tersebut.
→ jangan mengaku tidak tahu.
→ jangan kembali ke tebakan dari memori lama.

Jika pertanyaan meminta jadwal, tanggal, jam, lawan, skor, klasemen, harga, status, berita, atau informasi terkini:
→ prioritaskan data dari hasil WEB SEARCH.

Jika ada sumber resmi klub, liga, organisasi, sekolah, perusahaan, atau instansi:
→ prioritaskan sumber resmi tersebut jika relevan.

Jika beberapa sumber memberikan informasi yang sama:
→ gunakan informasi tersebut secara langsung.

Jika sumber berbeda:
→ jelaskan perbedaannya secara singkat.

Jika hasil web benar-benar tidak cukup:
→ katakan data yang ditemukan belum cukup.
→ jangan mengarang bagian yang kosong.

HASIL WEB:

${webContext}`
        : finalPrompt
}];

    if (base64Media) {
        parts.push({ inline_data: { mime_type: mimeTypeMedia || 'image/jpeg', data: base64Media } });
    }
    contents.push({ role: 'user', parts });

    const systemInstructionText = typeof vgenPrompt === 'string' ? vgenPrompt : JSON.stringify(vgenPrompt);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(currentModel)}:generateContent?key=${encodeURIComponent(currentKey)}`;
    
    const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        system_instruction: {
            parts: [{ text: systemInstructionText }]
        },
        contents
    })
});

const data = await res.json();
    if (!res.ok || data.error) {
        const errMsg = data.error?.message || `Gemini HTTP ${res.status}`;
        // Deteksi Limit 429 atau kuota meluap
        if (res.status === 429 || res.status === 503 || errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('limit')) {
            throw new Error('LIMIT_REACHED');
        }
        throw new Error(errMsg);
    }
    return data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || 'Model tidak mengembalikan jawaban.';
}

async function askAI(chatId, finalPrompt, base64Media, mimeTypeMedia, replyToId = null) {
    if (!activeKeys || activeKeys.length === 0) {
        throw new Error('API key belum dikonfigurasi. Aktifin/Deploy dari HTML lu dulu ngab!');
    }

    let attempts = 0;
    let maxAttempts = activeKeys.length * ROTATION_MODELS.length; // Siklus mutlak tak terbatas

    while (attempts < maxAttempts) {
        const currentKey = activeKeys[currentKeyIndex].key || activeKeys[currentKeyIndex];
        const currentModel = ROTATION_MODELS[currentModelIndex];
        
        try {
            return await _askAILogic(
    chatId,
    finalPrompt,
    base64Media,
    mimeTypeMedia,
    currentKey,
    currentModel,
    replyToId
);
        } catch (error) {
            if (error.message === 'LIMIT_REACHED') {
                attempts++;
                
               // CUMA SPAM DI PERCOBAAN PERTAMA BIAR LAWAN BICARA GA KABUR
                if (attempts === 1 && replyToId) {
                    try {
                        // 1. BUBBLE PERTAMA (Loading, nge-quote pesan user)
                        const loadMsg = await bot.sendMessage(chatId, "⏳ Loading", { reply_to_message_id: replyToId });
                        
                        // DELAY RANDOM 2-3 DETIK BUAT LOADING PERTAMA! 🔥
                        const loadingDelay = Math.floor(Math.random() * 1000) + 2000; // 2000ms - 3000ms
                        await delay(loadingDelay);

                        // 2. BUBBLE KEDUA (Server Penuh + Animasi Titik)
                        const animMsg = await bot.sendMessage(chatId, "Server penuh, Tunggu sebentar.");
                        
                        let baseText = "Server penuh, Tunggu sebentar";
                        const frames = [".", "..", "..."];
                        const totalAnimationTime = Math.floor(Math.random() * 4000) + 5000; // 5-9 detik random
                        const interval = 400; // Animasi titik lebih cepat dan smooth!
                        const steps = Math.floor(totalAnimationTime / interval);

                        for (let i = 0; i < steps; i++) {
                            const frame = frames[i % frames.length];
                            await bot.editMessageText(baseText + frame, { 
                                chat_id: chatId, 
                                message_id: animMsg.message_id 
                            }).catch(() => {});
                            await delay(interval);
                        }

                        // 3. Pesan final berevolusi (di bubble kedua)
                        await bot.editMessageText("AI Berevolusi kembali ✅", { 
                            chat_id: chatId, 
                            message_id: animMsg.message_id 
                        }).catch(() => {});
                        await delay(1000);
                    } catch (e) {}
                }

                // ROTASI SIKLUS BERULANG!
                console.log(`[LIMIT] ${currentModel} di email ${activeKeys[currentKeyIndex].email} HABIS. Berevolusi!`);
                currentModelIndex++;
                
                if (currentModelIndex >= ROTATION_MODELS.length) {
                    // Pindah ke email selanjutnya, model balik ke Lite
                    currentModelIndex = 0;
                    currentKeyIndex++;
                    if (currentKeyIndex >= activeKeys.length) {
                        currentKeyIndex = 0; // Balik ke email pertama njir immortal
                    }
                }
                
                // Simpan state memori rotasi
                db.apiConfig.currentKeyIndex = currentKeyIndex;
                db.apiConfig.currentModelIndex = currentModelIndex;
                saveDb();
                continue; // Gas loop lagi!
            }
            throw error; // Kalo error lain murni dari syntax, biarin aja
        }
    }
    throw new Error('Waduh, semua API Key dan model lagi ngadet parah 😭 coba hitungan menit lagi yaa!');
}


// ============================================================
// 🧠 BLACKTICK / BUSINESS / LIMIT SAFETY HELPERS
// ============================================================
function stripInternalLeakage(value) {
    let text = String(value || '');
    
    // Hapus pola meta-response yang sering muncul ketika model
// mencoba menjelaskan instruksi internalnya sendiri.
text = text.replace(
    /^\s*(?:\d+\.\s*)?(?:identify the character|identify the series|provide context|tone|buttons|constraint check|response strategy|instruction check|system check)\s*:.*$/gim,
    ''
);

    // Hapus blok thought yang punya penutup.
    text = text.replace(/\[(?:THINK|THOUGHT|REASONING|ANALYSIS)\][\s\S]*?\[\/(?:THINK|THOUGHT|REASONING|ANALYSIS)\]/gi, '');

    // Hapus tag internal satu baris.
    text = text.replace(/^\s*\[(?:INFO SISTEM|INTERNAL|HIDDEN|SYSTEM|DEVELOPER)\].*$/gim, '');

    // Jika model menulis reasoning tanpa tag penutup, buang baris-baris meta.
    const metaLine =
        /^(?:the user is\b|this is\b|i should\b|i need to\b|i need\b|we need to\b|response strategy:|suggested response:|analysis:|reasoning:|chain[- ]of[- ]thought:|let me think\b|i will respond\b|i'll respond\b|instructions?:|pronouns?:|reinforce:|image:|thought:)/i;

    const lines = text.split('\n');
    const cleaned = [];
    let skippingThought = false;

    for (const line of lines) {
        const trimmed = line.trim();

        if (/^\[(?:THINK|THOUGHT|REASONING|ANALYSIS)\]\s*$/i.test(trimmed)) {
            skippingThought = true;
            continue;
        }

        if (skippingThought) {
            // Heuristik pemulihan: ketika model mulai mengeluarkan jawaban user-facing,
            // kembali ke mode normal. Jangan membuang jawaban yang valid.
            if (
                /^(?:wkwk|awokawok|anjir|anjg|jir|cuy|bray|iya|iyaa|nah|oke|okeey|ya|jadi|sip|bisa|tentu|tentunya|berdasarkan|untuk|kalau|kalau mau|here's|sure|yes|no)\b/i.test(trimmed)
                && !metaLine.test(trimmed)
            ) {
                skippingThought = false;
            } else if (metaLine.test(trimmed) || !trimmed) {
                continue;
            } else {
                // Baris biasa setelah thought tanpa marker jelas dianggap sebagai jawaban.
                skippingThought = false;
            }
        }

        if (!metaLine.test(trimmed)) cleaned.push(line);
    }

    text = cleaned.join('\n');

    // Bersihkan marker thought yang tersisa di tengah teks.
    text = text.replace(/\[(?:THINK|THOUGHT|REASONING|ANALYSIS)\]\s*/gi, '');
    text = text.replace(/\[\/(?:THINK|THOUGHT|REASONING|ANALYSIS)\]\s*/gi, '');

    return text.trim();
}

const TELEGRAM_OWNER_URL = 'https://t.me/vickyyvall';
const WHATSAPP_OWNER_URL = 'https://wa.me/62895410975149';
const AM_PREM_IMAGE_URL = 'https://ibb.co.com/Tx5ND8rF';

function isAlightMotionTopic(text) {
    const value = String(text || '').toLowerCase();
    return /\b(?:alight\s*motion|am\s*prem(?:ium)?|am\s*premium|am\s*prem|alightmotion)\b|premium\s+1\s+tahun|prem\s+1\s+tahun/.test(value);
}

function buildAMPremButtons() {
    return [
        [
            { text: '🛒 Order AM Prem', url: TELEGRAM_OWNER_URL },
            { text: '💬 WhatsApp', url: WHATSAPP_OWNER_URL }
        ]
    ];
}

function buildLimitWarning(info) {
    if (!info || info.unlimited) return '';

    if (
        info.status === 'NONVIP' &&
        Number(info.remaining) === 3
    ) {
        return (
            `\n\n<blockquote>` +
            `<b>⚠️ LIMIT AI MENIPIS</b>\n` +
            `Sisa <b>3 chat</b> AI hari ini.\n` +
            `Reset otomatis <b>00.00 WIB</b>.\n` +
            `Kalau butuh lebih banyak, VIP tersedia.` +
            `</blockquote>`
        );
    }

    if (
        info.status === 'NONVIP' &&
        Number(info.remaining) === 1
    ) {
        return (
            `\n\n<blockquote>` +
            `<b>🚨 LIMIT AI DARURAT</b>\n` +
            `Sisa <b>1 chat</b> AI hari ini.\n` +
            `Setelah habis, tunggu reset <b>00.00 WIB</b> atau upgrade VIP.` +
            `</blockquote>`
        );
    }

    return '';
}

function buildMembershipKeyboard() {
    return [
        [
            { text: '📱 Telegram vickyyvall', url: TELEGRAM_OWNER_URL }
        ],
        [
            { text: '💬 WhatsApp vickyyvall', url: WHATSAPP_OWNER_URL }
        ]
    ];
}

function buildMembershipText() {
    return (
        `<b>💎 KEANGGOTAAN vickyyvall - AI.</b>\n\n` +
        `<blockquote>` +
        `<b>🏆 VIP AI</b>\n\n` +
        `💬 Total: <b>75 chat AI / hari</b>\n` +
        `├ Limit utama: 50\n` +
        `├ Bonus: +25\n` +
        `└ Reset: <b>00.00 WIB (12 malam)</b>\n\n` +
        `💸 Harga normal: <s>Rp39.900</s>\n` +
        `🔥 Harga VIP: <b>Rp25.900</b>\n\n` +
        `⚠️ <b>Syarat wajib:</b> lu harus punya <b>username Telegram (@username)</b> yang aktif dan bisa dicari.\n` +
`Tanpa username, akun lu tidak bisa diproses lewat <code>/addvip @username</code>.` +
        `VIP cocok buat lu yang sering ngobrol, coding, belajar, cari ide, atau butuh AI lebih sering tanpa cepat mentok limit NON-VIP.` +
        `</blockquote>\n\n` +
        `<b>💎 Mau upgrade?</b>\n` +
        `👇🏻Klik Telegram atau WhatsApp di bawah buat tanya dan order.`
    );
}

// ============================================================
// CORE MESSAGE & CALLBACK PARSER
// ============================================================
async function processAIResponse(
    chatId,
    rawResponse,
    replyToId,
    sourcePrompt = '',
    limitInfo = null,
    replyOptions = null
) {
	
    let text = String(rawResponse || '').trim();
text = stripInternalLeakage(text);

const normalizeCasualParagraphs = (
    value,
    prompt
) => {
    const source =
        String(prompt || '').toLowerCase();

    const structural =
        /(?:^|\n)\s*(?:\d+\.\s+|[–—-]\s+)/m.test(value) ||
        /<blockquote>|<pre>|```/i.test(value);

    const technical =
        /\b(?:coding|code|kode|script|javascript|typescript|html|css|json|config|debug|error|bug|tutorial|tugas|kuliah|sekolah|laporan|makalah|dokumentasi|analisis|program|fungsi|function|api|telegram|railway|node\.js)\b/i.test(
            source
        );

    if (structural || technical) {
        return value;
    }

    if (value.includes('\n\n')) {
        return value
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    if (value.length < 220) {
        return value;
    }

    const sentences =
        value
            .split(/(?<=[.!?])\s+/u)
            .map(part => part.trim())
            .filter(Boolean);

    if (sentences.length < 3) {
        return value;
    }

    const paragraphs = [];
    let current = [];

    for (const sentence of sentences) {
        current.push(sentence);

        if (current.length >= 2) {
            paragraphs.push(
                current.join(' ')
            );

            current = [];
        }
    }

    if (current.length) {
        paragraphs.push(
            current.join(' ')
        );
    }

    return paragraphs.join('\n\n');
};

text = normalizeCasualParagraphs(
    text,
    sourcePrompt
);
text = text
    .replace(
        /<<<BUTTONS:[\s\S]*?>>>/gi,
        ''
    )
    .replace(
        /^\s*>{2,}\s*$/gm,
        ''
    )
    .replace(
        /\s+$/gm,
        ''
    )
    .replace(
        /\n{3,}/g,
        '\n\n'
    )
    .trimEnd();
    
text = text
    .replace(/^\s*>{2,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

text = text
    .replace(
        /<blockquote>[\s\S]*?BLACKTICK AI NOTICE[\s\S]*?<\/blockquote>/gi,
        ''
    )
    .trim();

text = text
    .replace(
        /(?:^|\n)\s*BLACKTICK AI NOTICE[\s\S]*?(?=\n\n|$)/gi,
        ''
    )
    .trim();

    // 1. EXTRACT IMAGE (NEW SAFE SYNTAX <<<IMAGE: ...>>>)

    let imageToSent = null;
    const imageRegex = /<<<IMAGE:\s*(https?:\/\/[^\s>]+)\s*>>>/is;
    const imgMatch = text.match(imageRegex);
    if (imgMatch) {
        imageToSent = imgMatch[1];
        text = text.replace(imageRegex, '').trim();
    }

    // 2. EXTRACT FILE (NEW SAFE SYNTAX <<<FILE: filename.ext|content>>>)
    let fileToSend = null;
    const fileRegex = /<<<FILE:\s*([^|]+)\|([\s\S]*?)>>>/is;
    const fileMatch = text.match(fileRegex);
    if (fileMatch) {
        fileToSend = {
            name: fileMatch[1].trim(),
            content: fileMatch[2].trim()
        };
        text = text.replace(fileRegex, '').trim();
    }

    // 3. EXTRACT BUTTONS (NEW SAFE SYNTAX <<<BUTTONS: [...]>>>)

let inline_keyboard = [];

const extractButtonJson = source => {
    const marker =
        '<<<BUTTONS:';

    const markerStart =
        source.indexOf(marker);

    if (markerStart < 0) {
        return null;
    }

    const arrayStart =
        source.indexOf(
            '[',
            markerStart + marker.length
        );

    if (arrayStart < 0) {
        return null;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (
        let i = arrayStart;
        i < source.length;
        i++
    ) {
        const char = source[i];

        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }

            if (char === '\\') {
                escaped = true;
                continue;
            }

            if (char === '"') {
                inString = false;
            }

            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }

        if (char === '[') {
            depth++;
        }

        if (char === ']') {
            depth--;
        }

        if (depth === 0) {
            return {
                json:
                    source.slice(
                        arrayStart,
                        i + 1
                    ),

                start:
                    markerStart,

                end:
                    i + 1
            };
        }
    }

    return null;
};

const buttonMatch =
    extractButtonJson(text);

if (buttonMatch) {
    try {
        const aiButtons =
            JSON.parse(
                buttonMatch.json
            );

        const validButtons = [];

        if (Array.isArray(aiButtons)) {
            for (
                const original
                of aiButtons
            ) {
                if (
                    !original ||
                    typeof original !== 'object'
                ) {
                    continue;
                }

                const btnText =
                    String(
                        original.text || ''
                    ).trim();

                const url =
                    String(
                        original.url || ''
                    ).trim();

                const callbackData =
                    String(
                        original.callback_data || ''
                    ).trim();

                if (!btnText) {
                    continue;
                }

                if (
                    callbackData &&
                    callbackData.startsWith('ask|')
                ) {
                    let safeCallback =
                        callbackData;

                    if (
                        Buffer.byteLength(
                            safeCallback,
                            'utf8'
                        ) > 64
                    ) {
                        safeCallback =
                            Buffer.from(
                                safeCallback,
                                'utf8'
                            )
                                .subarray(0, 64)
                                .toString('utf8');
                    }

                    validButtons.push({
                        text: btnText,
                        callback_data:
                            safeCallback
                    });

                } else if (
                    url &&
                    /^https?:\/\/\S+$/i.test(url)
                ) {
                    validButtons.push({
                        text: btnText,
                        url
                    });
                }

                if (
                    validButtons.length >= 3
                ) {
                    break;
                }
            }
        }

        if (
            validButtons.length > 0
        ) {
            inline_keyboard = [
                validButtons.slice(0, 3)
            ];
        }

    } catch (error) {
        console.error(
            '[BUTTON PARSER ERROR]',
            error.message
        );
    }

    text =
        text.slice(
            0,
            buttonMatch.start
        ) +
        text.slice(
            buttonMatch.end
        );

    text =
        text.trim();
}

// ============================================================
// FIX BUTTON AM PREM + AI-GENERATED BUTTONS
// ============================================================

// AM PREM hanya dipicu jika pesan user memang membahas Alight Motion.
// Backend memaksa gambar + tombol agar AI tidak bisa lupa.
if (isAlightMotionTopic(sourcePrompt)) {
    imageToSent = AM_PREM_IMAGE_URL;
    inline_keyboard = buildAMPremButtons();
}

const limitWarning = buildLimitWarning(limitInfo);

if (limitWarning) {
    text += limitWarning;
}

const hasSubstantialAnswer =
    String(text || '').trim().length >= 80;

const isSimpleChat =
    /^(?:hai|halo|hi|hello|iya|iyaaa|oke|ok|siap|yaa|ya|makasih|terima kasih|thanks|thx)\b/i
        .test(
            String(sourcePrompt || '').trim()
        );

if (
    inline_keyboard.length < 2 &&
    hasSubstantialAnswer &&
    !isSimpleChat &&
    !isAlightMotionTopic(sourcePrompt)
) {
    const cleanTopic =
        String(sourcePrompt || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 42);

    const fallbackButtons = [
        {
            text: '🧠 Bahas lebih lanjut',
            callback_data:
                `ask|bahas lebih lanjut tentang ${cleanTopic}`
        },
        {
            text: '💡 Kasih contoh',
            callback_data:
                `ask|kasih contoh yang relevan dengan ${cleanTopic}`
        },
        {
            text: '🔎 Cek detail',
            callback_data:
                `ask|jelaskan detail penting tentang ${cleanTopic}`
        }
    ];

    while (inline_keyboard.length < 2) {
        const nextButton =
            fallbackButtons[inline_keyboard.length];

        if (!nextButton) break;

        inline_keyboard.push(
            nextButton
        );
    }

    inline_keyboard =
        inline_keyboard.slice(0, 3);
}

if (!text && !imageToSent && !fileToSend) {
    text = '😭 AI nggak menghasilkan jawaban kali ini.';
}

    // Kirim Media
    if (imageToSent) {
        try {
            await bot.sendPhoto(chatId, imageToSent);
        } catch (e) {
            console.error('[GAMBAR CHAT GAGAL]', e.message);
        }
    }

    if (fileToSend) {
        try {
            const fileBuffer = Buffer.from(fileToSend.content, 'utf8');
            await bot.sendDocument(chatId, fileBuffer, {}, { filename: fileToSend.name, contentType: 'text/plain' });
        } catch (e) {
            console.error('[FILE SEND ERROR]', e.message);
        }
    }

    // Kirim Teks + Tombol
    let extraOptions = replyOptions && typeof replyOptions === 'object'
    ? { ...replyOptions }
    : { reply_to_message_id: replyToId };

if (inline_keyboard.length > 0) {
    extraOptions.reply_markup = {
        inline_keyboard
    };
}

await sendReply(
    bot,
    chatId,
    text,
    extraOptions
);

latestWebSearchByChat.delete(String(chatId));

return text;
}

// ============================================================
// CALLBACK BUTTON ENGINE
// ============================================================
bot.on('callback_query', async (query) => {
    const data = String(query.data || '');
    const chatId = String(query.message?.chat?.id || '');

// ============================================================
// 🛒 ORDER AM PREM
// NON-AI / TIDAK MEMOTONG LIMIT
// ============================================================

if (data === 'order_am_prem') {
    await bot.answerCallbackQuery(query.id);

    try {
        await bot.sendPhoto(chatId, AM_PREM_IMAGE_URL, {
            caption:
                `<b>🛒 ALIGHT MOTION PREMIUM 1 TAHUN</b>\n\n` +
                `💎 Durasi: <b>1 Tahun</b>\n` +
                `🛡️ Garansi: <b>1 Bulan</b>\n` +
                `✨ Kualitas: premium dan siap dipakai.\n\n` +
                `Produk AM Prem vickyyvall sudah banyak dibeli lewat TikTok dan platform lainnya.\n` +
                `Kalau mau order, langsung chat vickyyvall.`,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: buildAMPremButtons() }
        });
    } catch (e) {
        await sendReply(
            bot,
            chatId,
            `<b>🛒 ALIGHT MOTION PREMIUM 1 TAHUN</b>\n\n` +
            `💎 Durasi: <b>1 Tahun</b>\n` +
            `🛡️ Garansi: <b>1 Bulan</b>\n` +
            `✨ Kualitas premium.\n\n` +
            `AM Prem vickyyvall sudah banyak dibeli lewat TikTok dan platform lainnya.`,
            {
                reply_markup: { inline_keyboard: buildAMPremButtons() }
            }
        );
    }

    return;
}

if (data === 'order_am_later') {

    await bot.answerCallbackQuery(query.id);

    await sendReply(
        bot,
        chatId,
        `<blockquote>` +
        `<b>⏳ OKE, SANTAI.</b>\n\n` +
        `Kalau belum mau order sekarang, gapapa.\n\n` +
        `Tapi kalau lu mau akses AI lebih banyak,\n` +
        `lu tetap bisa upgrade ke VIP kapan aja. 😝\n\n` +
        `💎 <b>VIP AI</b>\n` +
        `├ 50 Limit utama\n` +
        `├ +25 Bonus\n` +
        `└ Total 75 Limit\n\n` +
        `<s>Rp3̶9̶.̶9̶0̶0̶</s> → <b>Rp25.900</b>` +
        `</blockquote>`,
        {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '💎 Upgrade VIP',
                            url: 'https://t.me/vickyyvall'
                        }
                    ]
                ]
            }
        }
    );

    return;
}
    try {
        if (!chatId) {
    await bot.answerCallbackQuery(query.id);
    return;
}

// ============================================================
// UI BUTTONS
// ============================================================

if (data === 'ui|limit') {

    await bot.answerCallbackQuery(query.id);

    const fakeMsg = {
        from: query.from || {}
    };

    const info = getUserLimitInfo(fakeMsg);

    await sendReply(
        bot,
        chatId,
        `<b>📊 LIMIT AI KAMU</b>\n\n` +
        `╭━━━━━━━━━━━━━━━━━━╮\n` +
        `┃ 👤 Status : <b>${getStatusLabel(info.status)}</b>\n` +
        `┃ 💬 Limit  : <b>${getLimitLabel(info)}</b>\n` +
        `┃ 📈 Terpakai : <b>${info.used}</b>\n` +
        `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
        (info.unlimited
            ? `👑 Owner mode aktif.\n<b>Unlimited ∞</b>`
            : `ℹ️ Limit ini hanya digunakan untuk <b>obrolan AI</b>.\n` +
              `Chat bot non-AI tidak mengurangi limit.`),
        {
            reply_to_message_id: query.message?.message_id
        }
    );
    return;
}


if (data === 'ui|vip') {
    await bot.answerCallbackQuery(query.id);

    await sendReply(
        bot,
        chatId,
        buildMembershipText(),
        {
            reply_to_message_id: query.message?.message_id,
            reply_markup: {
                inline_keyboard: buildMembershipKeyboard()
            }
        }
    );

    return;
}

// ============================================================
// AI CALLBACK
// ============================================================

if (!data.startsWith('ask|')) {
    await bot.answerCallbackQuery(query.id);
    return;
}

const action = data.slice(4).trim();

if (!action) {
    await bot.answerCallbackQuery(query.id);
    return;
}

const buttonMessageId =
    query.message?.message_id;

if (!buttonMessageId) {
    await bot.answerCallbackQuery(
        query.id,
        {
            text: 'Tombol ini sudah tidak aktif.',
            show_alert: false
        }
    );
    return;
}

if (aiBusyChats.has(chatId)) {
    await bot.answerCallbackQuery(
        query.id,
        {
            text: 'AI masih memproses tombol sebelumnya.',
            show_alert: false
        }
    );
    return;
}

aiBusyChats.add(chatId);

await bot.answerCallbackQuery(
    query.id,
    {
        text: 'Lagi diproses bentar...',
        show_alert: false
    }
);

try {

    const finalPrompt =
        `[INFO SISTEM: Pengguna menekan tombol interaktif.]\n` +
        `[INFO SISTEM: Perlakukan instruksi tombol sebagai permintaan pengguna.]\n` +
        `[INFO SISTEM: Waktu sekarang ${nowWIB()} WIB.]\n\n` +
        `Permintaan pengguna dari tombol:\n${action}`;

    const callbackMsg = {
        from: query.from || {},
        chat: query.message?.chat || {},
        message_id: buttonMessageId
    };

    const limitCheck =
        consumeAiLimit(callbackMsg);

    if (!limitCheck.allowed) {

        const expired =
            buildLimitExpiredMessage(
                limitCheck.info
            );

        await sendReply(
            bot,
            chatId,
            expired.text,
            {
                reply_to_message_id:
                    buttonMessageId,
                reply_markup: {
                    inline_keyboard:
                        expired.keyboard
                }
            }
        );

        return;
    }

    const stopRecordingPresence =
        startRecordingPresence(chatId);

    let response;

    try {
        response = await askAI(
            chatId,
            finalPrompt,
            null,
            null,
            buttonMessageId
        );
    } finally {
        stopRecordingPresence();
    }

    const finalSavedText =
        await processAIResponse(
            chatId,
            response,
            buttonMessageId,
            action,
            limitCheck.info
        );

    pushHistory(
        chatId,
        'user',
        action
    );

    pushHistory(
        chatId,
        'assistant',
        finalSavedText
    );

} catch (error) {

    console.error(
        '[AI BUTTON ERROR]',
        error
    );

    try {
        await sendReply(
            bot,
            chatId,
            '😭 tombol sudah diproses, tapi AI lagi bermasalah. coba kirim pertanyaannya langsung.',
            {
                reply_to_message_id:
                    buttonMessageId
            }
        );
    } catch {}

} finally {

    await new Promise(resolve =>
        setTimeout(resolve, 3000)
    );

    aiBusyChats.delete(chatId);
}

} catch (error) {
    console.error('[CALLBACK ENGINE ERROR]', error?.message || error);

    try {
        await bot.answerCallbackQuery(query.id, {
            text: 'Terjadi kendala. Coba lagi sebentar.',
            show_alert: false
        });
    } catch (e) {}
}
});

// ============================================================
// CHAT LISTENER
// ============================================================
bot.on('message', async (msg) => {
    const text = cleanText(msg.text || msg.caption || '');
    if (!text && !getMediaFromMessage(msg)) return;
    if (isCommand(text)) return;
    
if (/^\/addvip(?:\s|$)/i.test(text)) return;
if (/^\/ceklimit(?:\s|$)/i.test(text)) return;
const chatId = String(msg.chat.id);

if (aiMutedChats.has(chatId)) return;
if (msg.date && Math.floor(Date.now() / 1000) - msg.date > 120) return;

// ============================================================
// 🚫 ANTI-SPAM AI RESPONSE
// ============================================================
if (aiBusyChats.has(chatId)) {
    return;
}

aiBusyChats.add(chatId);

// ============================================================
// 🔐 LIMIT HANYA UNTUK AI CHAT
// ============================================================
const limitCheck = consumeAiLimit(msg);

if (!limitCheck.allowed) {
    const expired = buildLimitExpiredMessage(limitCheck.info);

    await sendReply(
    bot,
    chatId,
    expired.text,
    {
        reply_to_message_id: msg.message_id,
        reply_markup: {
            inline_keyboard: expired.keyboard
        }
    }
);

aiBusyChats.delete(chatId);
    return;
}

try {
        const stopRecordingPresence = startRecordingPresence(chatId);
        const mediaResult = await buildMediaPrompt(msg, text);
        let response;
                try {
            const currentTimeInstruction = `[INFO SISTEM: Waktu sekarang ${nowWIB()} WIB.]`;
            const userStatusInstruction =
    `[INFO SISTEM: User ini statusnya ${limitCheck.info.status}. ` +
    `Total limit hariannya: ${limitCheck.info.unlimited ? 'Unlimited' : limitCheck.info.total}. ` +
    `Sisa limit setelah pesan ini: ${limitCheck.info.unlimited ? 'Unlimited' : limitCheck.info.remaining}. ` +
    `Limit hanya berlaku untuk chat AI dan reset otomatis setiap 00.00 WIB Asia/Jakarta. ` +
    `Notifikasi limit ditangani backend; jangan membuat notifikasi limit sendiri.]`;
            // INJEKSI RAHASIA BIAR FORMAT LIST RAPI & BUTTON MUNCUL
            const formatReminder =
    `[INFO SISTEM: FORMAT TELEGRAM MUTLAK. ` +
    `Judul berdiri sendiri lalu langsung lanjut ke main point pada baris berikutnya. ` +
    `JANGAN membuat baris kosong setelah judul. ` +
    `Main point boleh menggunakan nomor 1., 2., 3. dan tetap rata kiri. ` +
    `Sub-point hanya gunakan jika memang ada sub-point. ` +
    `Sub-point WAJIB menggunakan simbol –. ` +
    `Tidak ada batas jumlah sub-point dalam satu main point jika memang semuanya relevan. ` +
    `Jangan membuat – pada setiap kalimat. ` +
    `Sub-point adalah satu paragraf logis. ` +
    `Jangan mengatur wrapping menggunakan spasi manual. ` +
    `Jangan memecah satu sub-point menjadi beberapa paragraf hanya karena panjang. ` +
    `Backend akan menangani hanging indent agar baris lanjutan sub-point tetap masuk dan tidak jatuh ke margin kiri. ` +
    `Gunakan ENTER hanya untuk main point baru, sub-point baru, judul baru, atau pergantian bait yang benar-benar diperlukan. ` +
    `Setelah main point selesai, gunakan tepat 1 baris kosong sebelum main point berikutnya. ` +
    `Jangan gunakan 2 baris kosong. ` +
    `Awal main point atau sub-point sebaiknya memiliki kata penting yang BOLD. ` +
    `Jangan menampilkan marker internal, simbol >>, atau marker backend.]`;
            const aiButtonCount =
    Math.random() < 0.55
        ? 2
        : 3;

const buttonReminder =
    `[INFO SISTEM: Tentukan sendiri apakah keyboard akan membantu user. ` +
    `Untuk pertanyaan yang punya lanjutan jelas, BUAT tepat ${aiButtonCount} tombol. ` +
    `Untuk obrolan yang kosong, gabut, bosen, random, atau user terlihat ingin ditemani ngobrol, ` +
    `AI BOLEH dan dianjurkan membuat tepat 2 tombol yang terasa relate meskipun belum ada tugas spesifik. ` +
    `AI sendiri yang menentukan teks tombol, emoji, callback_data, URL, dan topiknya berdasarkan konteks terbaru. ` +
    `Jangan membuat tombol generik yang terasa dipaksakan. ` +
    `Jika tombol benar-benar tidak membantu, jangan membuat tombol.]`;

const finalPrompt = `${currentTimeInstruction}\n${userStatusInstruction}\n${formatReminder}\n${buttonReminder}\n\n${mediaResult.finalPrompt}`;
            response = await askAI(chatId, finalPrompt, mediaResult.base64Media, mediaResult.mimeTypeMedia, msg.message_id);
        } finally {
            stopRecordingPresence();
        }

        if (aiMutedChats.has(chatId)) {
    aiBusyChats.delete(chatId);
    return;
}

         const finalSavedText = await processAIResponse(chatId, response, msg.message_id, text || '', limitCheck.info);

        pushHistory(chatId, 'user', text || '[Media]');
        pushHistory(chatId, 'assistant', finalSavedText);

        // EFEK "LINGER TYPING" DIPANJANGIN! 🔥
        bot.sendChatAction(chatId, 'typing').catch(() => {});
        // Tembak lagi 2 detik kemudian biar ngetiknya mutlak stay 3-5 detik di atas layar!
        setTimeout(() => bot.sendChatAction(chatId, 'typing').catch(() => {}), 2000);

       aiBusyChats.delete(chatId);

    } catch (error) {
    	aiBusyChats.delete(chatId);
        const realError = String(error.message || error).replace(/\n/g, ' ').slice(0, 500);
        console.error('[AI CORE ERROR]', realError);
        await sendReply(
    bot,
    msg.chat.id,
    `VGen Engine terkendala.\n\nDetail: ${realError}`,
    {
        reply_to_message_id: msg.message_id
    }
);
    }
});

// ============================================================
// EXPRESS DEPLOYMENT API
// ============================================================
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/', (req, res) => {
    res.json({ ok: true, service: 'vìckyyvall - AI Telegram Bot', provider: activeProvider, model: ROTATION_MODELS[currentModelIndex], timeWIB: nowWIB() });
});

app.post('/deploy-key', (req, res) => {
    const { keys, provider, model } = req.body || {};
    if (!keys || !keys.length || !model) {
        return res.status(400).json({ error: 'Keys array atau Model tidak boleh kosong!' });
    }
    activeKeys = keys;
    activeProvider = String(provider || 'GEMINI').toUpperCase();
    
    // Set rotasi awal sesuai pilihan lu di HTML
    currentModelIndex = Math.max(0, ROTATION_MODELS.indexOf(model));
    currentKeyIndex = 0; // Mulai dari email pertama

    db.apiConfig = { keys: activeKeys, provider: activeProvider, currentKeyIndex, currentModelIndex };
    saveDb();
    res.json({ success: true, message: `Sukses deploy ${keys.length} API Keys! Start: ${ROTATION_MODELS[currentModelIndex]}` });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ vickyyvall - AI. TELEGRAM ONLINE di port ${PORT}`);
});

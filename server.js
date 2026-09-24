const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.warn('BOT_TOKEN is not set: the website will run, but Telegram features are disabled.');
}
const bot = BOT_TOKEN ? new Telegraf(BOT_TOKEN) : null;
const db = new sqlite3.Database('./shop.db');

app.use(bodyParser.json());
app.use(express.static('public'));

// Расширенная БД
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT, price REAL, image TEXT, category TEXT, description TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, customer_name TEXT, phone TEXT, ozon_info TEXT, total REAL, status TEXT DEFAULT 'pending')");
    db.run("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)");
    db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('payment_info', 'Номер: +79000000000 (Сбербанк)')");
});

// API
app.get('/api/products', (req, res) => {
    const category = req.query.category;
    let sql = "SELECT * FROM products";
    if (category && category !== 'Все') sql += ` WHERE category = '${category}'`;
    db.all(sql, [], (err, rows) => res.json(rows));
});

app.post('/api/order', (req, res) => {
    const { items, total, customerName, phone, ozonInfo } = req.body;
    db.run("INSERT INTO orders (customer_name, phone, ozon_info, total) VALUES (?, ?, ?, ?)", 
        [customerName, phone, ozonInfo, total], function(err) {
        const orderId = this.lastID;
        db.get("SELECT value FROM settings WHERE key = 'admin_id'", (err, row) => {
            if (bot && row) {
                const msg = `📦 *НОВЫЙ ЗАКАЗ №${orderId}*\n\n👤 Клиент: ${customerName}\n📞 Тел: ${phone}\n📍 Ozon: ${ozonInfo}\n🛒 Товары: ${items.map(i => i.name).join(', ')}\n💰 Сумма: ${total} руб.`;
                bot.telegram.sendMessage(row.value, msg, {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('✅ Подтвердить', `conf_${orderId}`)],
                        [Markup.button.callback('❌ Отклонить', `rej_${orderId}`)]
                    ])
                });
            }
        });
        res.json({ success: true, orderId });
    });
});

app.get('/api/order-status/:id', (req, res) => {
    db.get("SELECT status FROM orders WHERE id = ?", [req.params.id], (err, order) => {
        db.get("SELECT value FROM settings WHERE key = 'payment_info'", (err, setting) => {
            res.json({ status: order.status, payment: setting.value });
        });
    });
});

// Telegram Бот - Админка
if (bot) bot.start((ctx) => {
    db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_id', ?)", [ctx.chat.id]);
    ctx.reply('888SHOP ADMIN LOADED', Markup.keyboard([
        ['📦 Товары', '📝 Реквизиты'],
        ['➕ Добавить товар']
    ]).resize());
});

// Добавление товара через фото
let tempProduct = {};
if (bot) {
    bot.hears('➕ Добавить товар', (ctx) => {
        ctx.reply('Пришлите фото товара');
    });

    bot.on('photo', (ctx) => {
        const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        bot.telegram.getFileLink(fileId).then(link => {
            tempProduct.image = link.href;
            ctx.reply('Введите название, цену и категорию через запятую\nПример: Jordan 4, 15000, Обувь');
        });
    });

    bot.on('text', (ctx) => {
        if (ctx.message.text.includes(',')) {
            const [name, price, cat] = ctx.message.text.split(',');
            db.run("INSERT INTO products (name, price, image, category) VALUES (?, ?, ?, ?)", [name.trim(), price.trim(), tempProduct.image, cat.trim()]);
            ctx.reply('✅ Товар добавлен в каталог!');
        }
        if (ctx.message.text.startsWith('Реквизиты:')) {
            db.run("UPDATE settings SET value = ? WHERE key = 'payment_info'", [ctx.message.text]);
            ctx.reply('✅ Реквизиты обновлены!');
        }
    });

    bot.action(/conf_(.+)/, (ctx) => {
        const id = ctx.match[1];
        db.run("UPDATE orders SET status = 'confirmed' WHERE id = ?", [id]);
        ctx.editMessageText(`✅ Заказ №${id} подтвержден! Реквизиты отправлены клиенту.`);
    });

    bot.launch();
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`888shop listening on ${PORT}`));

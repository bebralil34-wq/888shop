const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
// Токен от пользователя
const BOT_TOKEN = '8626170046:AAH5qelrYeRVzlWRKySJpQ5t04NFRKrc5yU';
const bot = new Telegraf(BOT_TOKEN);
const db = new sqlite3.Database('./shop.db');

app.use(bodyParser.json());
app.use(express.static('public'));

// База данных
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT, price REAL, image TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)");
    db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('payment_info', 'Номер: +79000000000 (Сбербанк)')");
    
    // Демо-данные
    db.get("SELECT count(*) as count FROM products", (err, row) => {
        if (row.count === 0) {
            db.run("INSERT INTO products (name, price, image) VALUES ('Пуховик 888 Star Black', 2500, 'https://sc04.alicdn.com/kf/Afd4c970baa1847a4b161a45259004779C.jpg')");
            db.run("INSERT INTO products (name, price, image) VALUES ('Оверсайз Худи Black', 3500, 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?q=80&w=600')");
            db.run("INSERT INTO products (name, price, image) VALUES ('Футболка Basic White', 1200, 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?q=80&w=600')");
        }
    });
});

// API
app.get('/api/products', (req, res) => {
    db.all("SELECT * FROM products", [], (err, rows) => {
        res.json(rows);
    });
});

app.post('/api/order', (req, res) => {
    const { items, total, customerName } = req.body;
    db.get("SELECT value FROM settings WHERE key = 'admin_id'", (err, row) => {
        const adminId = row ? row.value : null;
        if (!adminId) return res.status(500).json({ error: "Админ не инициализирован. Напишите /start боту." });

        const orderText = `📦 *Новый заказ!*\n\n👤 Клиент: ${customerName}\n🛒 Товары: ${items.map(i => i.name).join(', ')}\n💰 Сумма: ${total} руб.`;
        
        bot.telegram.sendMessage(adminId, orderText, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('✅ Подтвердить', `confirm_${customerName}`)],
                [Markup.button.callback('❌ Отклонить', 'reject')]
            ])
        });
        
        res.json({ success: true, message: "Заказ отправлен продавцу на подтверждение. Ожидайте уведомления!" });
    });
});

// Бот
bot.start((ctx) => {
    db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_id', ?)", [ctx.chat.id]);
    ctx.reply('👋 Добро пожаловать в панель управления 888shop!\n\nВы зарегистрированы как администратор.', Markup.keyboard([
        ['➕ Добавить товар', '📝 Изменить реквизиты'],
        ['📊 Статистика', '⚙️ Настройки']
    ]).resize());
});

bot.hears('📝 Изменить реквизиты', (ctx) => {
    ctx.reply('Пришлите новые реквизиты в формате: \nНомер: XXXX, Банк: XXXX');
});

bot.on('text', (ctx) => {
    if (ctx.message.text.includes('Номер:')) {
        db.run("UPDATE settings SET value = ? WHERE key = 'payment_info'", [ctx.message.text]);
        ctx.reply('✅ Реквизиты успешно обновлены!');
    }
});

bot.action(/confirm_(.+)/, (ctx) => {
    const customer = ctx.match[1];
    db.get("SELECT value FROM settings WHERE key = 'payment_info'", (err, row) => {
        ctx.reply(`✅ Заказ подтвержден для ${customer}.\nРеквизиты для оплаты:\n${row.value}\n\nПожалуйста, свяжитесь с клиентом.`);
    });
});

bot.launch();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер 888shop запущен на порту ${PORT}`));

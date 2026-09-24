const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '';
const DATA_FILE = path.join(__dirname, 'shop-data.json');

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/shop-data.json', (_req, res) => res.status(404).json({ error: 'Not found' }));

const seedProducts = [
    {
        id: 1,
        name: 'Пуховик 888 Star Black',
        price: 2500,
        image: 'https://sc04.alicdn.com/kf/Afd4c970baa1847a4b161a45259004779C.jpg',
        category: 'Верхняя одежда',
        description: 'Чёрный утеплённый пуховик с капюшоном и логотипом на рукаве.',
        sizes: ['S', 'M', 'L', 'XL'],
        stock: 10
    },
    {
        id: 2,
        name: 'Оверсайз Худи Black',
        price: 3500,
        image: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?q=80&w=600',
        category: 'Худи',
        description: 'Худи свободного кроя из плотного хлопка.',
        sizes: ['S', 'M', 'L', 'XL'],
        stock: 8
    },
    {
        id: 3,
        name: 'Футболка Basic White',
        price: 1200,
        image: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?q=80&w=600',
        category: 'Футболки',
        description: 'Базовая белая футболка прямого кроя.',
        sizes: ['S', 'M', 'L', 'XL'],
        stock: 15
    }
];

function initialData() {
    return {
        products: seedProducts,
        orders: [],
        settings: { payment_info: 'Реквизиты ещё не добавлены продавцом' },
        nextOrderId: 1,
        nextProductId: 4
    };
}

function loadData() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            const data = initialData();
            saveData(data);
            return data;
        }
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        return {
            ...initialData(),
            ...data,
            products: Array.isArray(data.products) ? data.products : seedProducts,
            orders: Array.isArray(data.orders) ? data.orders : [],
            settings: { ...initialData().settings, ...(data.settings || {}) }
        };
    } catch (error) {
        console.error('Cannot read data file:', error.message);
        return initialData();
    }
}

function saveData(data) {
    const tempFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
    fs.renameSync(tempFile, DATA_FILE);
}

let data = loadData();
let bot = null;

function sendNewOrder(order) {
    if (!bot) return;
    const adminId = ADMIN_CHAT_ID || data.settings.admin_id;
    if (!adminId) {
        console.error('Order saved but not sent: ADMIN_CHAT_ID is not configured and /start has not been used.');
        return;
    }
    const items = order.items.map(item => `${item.name}${item.size ? ` (${item.size})` : ''}`).join(', ');
    const message = [
        `НОВЫЙ ЗАКАЗ №${order.id}`,
        `Клиент: ${order.customerName}`,
        `Телефон: ${order.phone}`,
        `Ozon: ${order.ozonInfo}`,
        `Товары: ${items}`,
        `Сумма: ${order.total} ₽`
    ].join('\n');

    bot.telegram.sendMessage(adminId, message, Markup.inlineKeyboard([
        [Markup.button.callback('✅ Подтвердить', `confirm_${order.id}`)],
        [Markup.button.callback('❌ Отклонить', `reject_${order.id}`)]
    ])).catch(error => console.error('Telegram send error:', error.message));
}

app.get('/api/products', (req, res) => {
    const category = req.query.category;
    const visibleProducts = data.products.filter(product => Number(product.stock ?? 1) > 0);
    const products = category && category !== 'Все'
        ? visibleProducts.filter(product => product.category === category)
        : visibleProducts;
    res.json(products);
});

app.post('/api/order', (req, res) => {
    const { items, customerName, phone, ozonInfo } = req.body || {};
    if (!customerName || !phone || !ozonInfo || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Заполните данные получателя и добавьте товар в корзину' });
    }

    const requested = items.map(item => ({
        productId: Number(item.id),
        size: item.size || ''
    }));
    const counts = new Map();
    for (const item of requested) counts.set(item.productId, (counts.get(item.productId) || 0) + 1);

    for (const [productId, quantity] of counts) {
        const product = data.products.find(item => item.id === productId);
        const stock = Number(product?.stock ?? 0);
        if (!product || stock < quantity) {
            return res.status(409).json({ error: 'Один из товаров уже закончился. Обновите каталог и попробуйте снова.' });
        }
    }

    const orderItems = requested.map(item => {
        const product = data.products.find(product => product.id === item.productId);
        return { productId: product.id, name: product.name, price: Number(product.price) || 0, size: item.size };
    });
    const orderTotal = orderItems.reduce((sum, item) => sum + item.price, 0);

    for (const [productId, quantity] of counts) {
        const product = data.products.find(item => item.id === productId);
        product.stock = Number(product.stock ?? 0) - quantity;
    }

    const order = {
        id: data.nextOrderId++,
        customerName: String(customerName).slice(0, 200),
        phone: String(phone).slice(0, 80),
        ozonInfo: String(ozonInfo).slice(0, 500),
        items: orderItems,
        total: orderTotal,
        status: 'pending',
        stockRestored: false,
        createdAt: new Date().toISOString()
    };

    data.orders.push(order);
    saveData(data);
    sendNewOrder(order);
    res.json({ success: true, orderId: order.id, status: order.status });
});

app.get('/api/order-status/:id', (req, res) => {
    const order = data.orders.find(item => item.id === Number(req.params.id));
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    res.json({ status: order.status, payment: order.status === 'confirmed' ? data.settings.payment_info : null });
});

if (BOT_TOKEN) {
    bot = new Telegraf(BOT_TOKEN);

    bot.start(ctx => {
        if (!ADMIN_CHAT_ID) {
            data.settings.admin_id = String(ctx.chat.id);
            saveData(data);
        }
        ctx.reply('Панель управления 8ATE STUDIO готова.', Markup.keyboard([
            ['➕ Добавить товар', '📝 Реквизиты'],
            ['📦 Заказы', '📊 Товары']
        ]).resize());
    });

    const isAdmin = ctx => {
        const configuredAdmin = ADMIN_CHAT_ID || data.settings.admin_id;
        return !configuredAdmin || String(ctx.chat.id) === String(configuredAdmin);
    };
    let awaitingPaymentChatId = null;

    bot.hears('📝 Реквизиты', ctx => {
        if (!isAdmin(ctx)) return ctx.reply('Доступ разрешён только продавцу.');
        awaitingPaymentChatId = String(ctx.chat.id);
        return ctx.reply('Пришлите следующим сообщением реквизиты в любом формате. Например: Номер карты — ..., Банк — ...');
    });
    bot.hears('📦 Заказы', ctx => {
        const pending = data.orders.filter(order => order.status === 'pending');
        ctx.reply(pending.length ? pending.map(order => `№${order.id} — ${order.total} ₽ — ${order.customerName}`).join('\n') : 'Новых заказов нет.');
    });
    bot.hears('📊 Товары', ctx => {
        if (!isAdmin(ctx)) return ctx.reply('Доступ разрешён только продавцу.');
        if (!data.products.length) return ctx.reply('Каталог пуст.');
        const rows = data.products.map(product => [
            Markup.button.callback(`🗑 Удалить #${product.id} · ${product.name}`, `delete_product_${product.id}`)
        ]);
        return ctx.reply(
            data.products.map(product => `#${product.id} ${product.name} — ${product.price} ₽ · остаток: ${product.stock ?? 0}`).join('\n'),
            Markup.inlineKeyboard(rows)
        );
    });

    bot.action(/delete_product_(\d+)/, async ctx => {
        if (!isAdmin(ctx)) return ctx.answerCbQuery('Нет доступа');
        const product = data.products.find(item => item.id === Number(ctx.match[1]));
        if (!product) return ctx.answerCbQuery('Товар уже удалён');
        await ctx.answerCbQuery('Нажмите подтверждение');
        return ctx.reply(`Удалить товар «${product.name}»?`, Markup.inlineKeyboard([
            [Markup.button.callback('Да, удалить', `delete_confirm_${product.id}`)],
            [Markup.button.callback('Отмена', 'delete_cancel')]
        ]));
    });

    bot.action(/delete_confirm_(\d+)/, async ctx => {
        if (!isAdmin(ctx)) return ctx.answerCbQuery('Нет доступа');
        const productId = Number(ctx.match[1]);
        const index = data.products.findIndex(item => item.id === productId);
        if (index === -1) return ctx.answerCbQuery('Товар уже удалён');
        const [removed] = data.products.splice(index, 1);
        saveData(data);
        await ctx.answerCbQuery('Товар удалён');
        return ctx.editMessageText(`✅ Товар «${removed.name}» удалён из каталога.`);
    });

    bot.action('delete_cancel', ctx => ctx.editMessageText('Удаление отменено.'));

    let draft = {};
    bot.hears('➕ Добавить товар', ctx => {
        draft = {};
        ctx.reply('Пришлите фото товара. Затем отправьте: название, цена, категория');
    });

    bot.on('photo', async ctx => {
        try {
            const photo = ctx.message.photo.at(-1);
            draft.image = (await bot.telegram.getFileLink(photo.file_id)).href;
            await ctx.reply('Фото получено. Теперь отправьте: название, цена, категория\nНапример: Куртка, 2500, Верхняя одежда');
        } catch (error) {
            console.error('Telegram photo error:', error.message);
            await ctx.reply('Не удалось получить фото. Попробуйте отправить его ещё раз.');
        }
    });

    bot.on('text', ctx => {
        const text = ctx.message.text.trim();
        if (awaitingPaymentChatId && String(ctx.chat.id) === awaitingPaymentChatId && !['📝 Реквизиты', '➕ Добавить товар', '📦 Заказы', '📊 Товары'].includes(text)) {
            const paymentInfo = text.replace(/^Реквизиты:\s*/i, '').trim();
            if (paymentInfo.length < 3) return ctx.reply('Реквизиты слишком короткие. Пришлите номер и название банка.');
            data.settings.payment_info = paymentInfo;
            awaitingPaymentChatId = null;
            saveData(data);
            return ctx.reply('✅ Реквизиты сохранены и будут показаны покупателю после подтверждения заказа.');
        }
        if (draft.image && text.split(',').length >= 3) {
            const [name, priceText, category] = text.split(',').map(value => value.trim());
            const price = Number(priceText.replace(/[^0-9.]/g, ''));
            if (!name || !category || !Number.isFinite(price) || price <= 0) {
                return ctx.reply('Проверьте формат: название, цена, категория');
            }
            data.products.push({
                id: data.nextProductId++, name, price,
                category, image: draft.image, description: '', sizes: ['S', 'M', 'L', 'XL'], stock: 1
            });
            draft = {};
            saveData(data);
            return ctx.reply(`Товар «${name}» добавлен в каталог.`);
        }
    });

    bot.action(/confirm_(\d+)/, async ctx => {
        const order = data.orders.find(item => item.id === Number(ctx.match[1]));
        if (!order) return ctx.answerCbQuery('Заказ не найден');
        order.status = 'confirmed';
        saveData(data);
        await ctx.answerCbQuery('Заказ подтверждён');
        await ctx.editMessageText(`Заказ №${order.id} подтверждён. Реквизиты показаны покупателю.`);
    });

    bot.action(/reject_(\d+)/, async ctx => {
        const order = data.orders.find(item => item.id === Number(ctx.match[1]));
        if (!order) return ctx.answerCbQuery('Заказ не найден');
        order.status = 'rejected';
        if (!order.stockRestored) {
            for (const item of order.items) {
                const product = data.products.find(product => product.id === item.productId);
                if (product) product.stock = Number(product.stock ?? 0) + 1;
            }
            order.stockRestored = true;
        }
        saveData(data);
        await ctx.answerCbQuery('Заказ отклонён, остаток восстановлен');
        await ctx.editMessageText(`Заказ №${order.id} отклонён. Товар снова доступен в каталоге.`);
    });

    bot.launch().then(() => console.log('Telegram bot polling started')).catch(error => console.error('Telegram bot error:', error.message));
} else {
    console.warn('BOT_TOKEN is not set. Website is running; Telegram features are disabled.');
}

app.listen(PORT, () => console.log(`888shop listening on port ${PORT}`));

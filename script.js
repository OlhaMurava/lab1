require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const validator = require('validator');
const path = require('path');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10kb' }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error('❌ ПОМИЛКА: Змінна середовища MONGO_URI не задана!');
    process.exit(1);
}

// Моделі MongoDB
const productSchema = new mongoose.Schema({
    name: { type: String, required: true },
    category: { type: String, required: true },
    price: { type: Number, required: true },
    inStock: { type: Boolean, default: true },
    image: { type: String }
});
const Product = mongoose.model('Product', productSchema);

const orderSchema = new mongoose.Schema({
    customerName: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    paymentMethod: { type: String, enum: ['card', 'apple_pay', 'cash'], default: 'apple_pay' },
    comment: { type: String, default: '' },
    items: [{ name: String, price: Number, quantity: Number }],
    totalAmount: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', orderSchema);

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Успішно підключено до MongoDB Atlas'))
    .catch(err => console.error('Помилка підключення до БД:', err));

function sanitizeInput(str) {
    if (typeof str !== 'string') return '';
    return validator.escape(str.trim());
}

// Ендпоінт моніторингу продуктивності сервісу
app.get('/api/health', (req, res) => {
    const memory = process.memoryUsage();
    const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    res.status(200).json({
        status: 'OK',
        environment: process.env.NODE_ENV || 'development',
        aiServiceConfigured: Boolean(process.env.GEMINI_API_KEY),
        uptimeSeconds: Math.round(process.uptime()),
        databaseStatus: dbStates[mongoose.connection.readyState] || 'unknown',
        memoryUsageMB: {
            rss: (memory.rss / 1024 / 1024).toFixed(2),
            heapTotal: (memory.heapTotal / 1024 / 1024).toFixed(2),
            heapUsed: (memory.heapUsed / 1024 / 1024).toFixed(2)
        },
        timestamp: new Date().toISOString()
    });
});

// REST API: Отримання товарів
app.get('/api/products', async (req, res) => {
    try {
        const products = await Product.find();
        res.status(200).json(products);
    } catch (err) {
        res.status(500).json({ error: 'Помилка отримання товарів' });
    }
});

// REST API: Оформлення замовлення
app.post('/api/orders', async (req, res) => {
    try {
        const { customerName, email, phone, paymentMethod, comment, items } = req.body;
        const errors = [];

        if (!customerName || customerName.trim().length < 2) {
            errors.push("Ім'я повинно містити щонайменше 2 символи.");
        }
        if (!email || !validator.isEmail(email)) {
            errors.push('Вкажіть коректну адресу електронної пошти (Email).');
        }
        if (!phone || !/^\+?[0-9]{10,13}$/.test(phone.replace(/[\s()-]/g, ''))) {
            errors.push('Вкажіть коректний номер телефону (10–13 цифр).');
        }
        if (!Array.isArray(items) || items.length === 0) {
            errors.push('Кошик порожній. Додайте хоча б один товар.');
        }

        if (errors.length > 0) {
            return res.status(400).json({ error: 'Помилка валідації даних', details: errors });
        }

        const newOrder = new Order({
            customerName: sanitizeInput(customerName),
            email: validator.normalizeEmail(email),
            phone: sanitizeInput(phone),
            paymentMethod: ['card', 'apple_pay', 'cash'].includes(paymentMethod) ? paymentMethod : 'apple_pay',
            comment: sanitizeInput(comment || ''),
            items,
            totalAmount: items.reduce((sum, item) => sum + (Number(item.price) * Number(item.quantity || 1)), 0)
        });

        const savedOrder = await newOrder.save();
        res.status(201).json({
            message: 'Замовлення успішно оформлено та збережено в базі даних!',
            orderId: savedOrder._id,
            customerName: savedOrder.customerName,
            totalAmount: savedOrder.totalAmount
        });
    } catch (err) {
        res.status(500).json({ error: 'Внутрішня помилка сервера' });
    }
});

// AI-сервіс: Інтелектуальний чат-консультант (Hugging Face AI API через GEMINI_API_KEY + NLP-аналіз)
app.post('/api/ai-chat', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            return res.status(400).json({ error: 'Введіть запитання для AI-консультанта.' });
        }

        const products = await Product.find();
        const catalogContext = products.map(p =>
            `- ${p.name} (${p.category}): ${p.price} грн, ${p.inStock ? 'в наявності' : 'немає в наявності'}`
        ).join('\n');

        const API_TOKEN = process.env.GEMINI_API_KEY;

        // 1. Спроба запиту до Hugging Face Inference API
        if (API_TOKEN) {
            const hfResponse = await fetch('https://router.huggingface.co/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${API_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'Qwen/Qwen2.5-7B-Instruct',
                    messages: [
                        {
                            role: 'system',
                            content: `Ти — професійний AI-консультант інтернет-магазину Apple Store UA. Актуальний каталог:\n${catalogContext}\nВідповідай українською мовою стисло (3–4 речення) та рекомендуй товари лише з каталогу.`
                        },
                        { role: 'user', content: message.trim() }
                    ],
                    max_tokens: 300
                })
            });

            if (hfResponse.ok) {
                const hfData = await hfResponse.json();
                const aiReply = hfData.choices?.[0]?.message?.content;
                if (aiReply) {
                    return res.status(200).json({ reply: aiReply.trim(), provider: 'Hugging Face AI' });
                }
            }
        }

        // 2. Резервний NLP-аналізатор запиту по базі товарів (якщо зовнішній API недоступний)
        const q = message.toLowerCase();
        const budgetMatch = q.match(/(\d[\d\s]{3,})/);
        const maxBudget = budgetMatch ? Number(budgetMatch[1].replace(/\s/g, '')) : null;

        let matched = products.filter(p => p.inStock);
        if (maxBudget) matched = matched.filter(p => p.price <= maxBudget);
        if (q.includes('ноутбук') || q.includes('mac') || q.includes('програмуван')) {
            matched = products.filter(p => p.category.toLowerCase().includes('mac'));
        } else if (q.includes('телефон') || q.includes('iphone')) {
            matched = products.filter(p => p.category.toLowerCase().includes('iphone'));
        } else if (q.includes('навушник') || q.includes('годинник') || q.includes('аксесуар')) {
            matched = products.filter(p => ['audio', 'watch', 'accessories'].includes(p.category.toLowerCase()));
        }

        const listText = matched.length > 0
            ? matched.map(p => `• ${p.name} — ${p.price.toLocaleString()} ₴ (${p.inStock ? 'є в наявності' : 'очікується'})`).join('\n')
            : products.filter(p => p.inStock).map(p => `• ${p.name} — ${p.price.toLocaleString()} ₴`).join('\n');

        return res.status(200).json({
            reply: `На основі аналізу вашого запиту та актуального складу Apple Store UA рекомендую звернути увагу на такі моделі:\n\n${listText}\n\nВи можете додати обраний пристрій до кошика нижче та оформити замовлення онлайн!`,
            provider: 'Smart Catalog NLP'
        });
    } catch (err) {
        console.error('Помилка AI-сервісу:', err);
        res.status(500).json({ error: 'Внутрішня помилка AI-сервісу.' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Сервер запущено на порту ${PORT} (${process.env.NODE_ENV || 'dev'})`);
});
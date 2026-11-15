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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

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
        aiServiceConfigured: Boolean(GEMINI_API_KEY),
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

// AI-сервіс: Інтелектуальний чат-консультант на базі Google Gemini API
app.post('/api/ai-chat', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            return res.status(400).json({ error: 'Введіть запитання для AI-консультанта.' });
        }
        if (!GEMINI_API_KEY) {
            return res.status(500).json({ error: 'Не налаштовано ключ GEMINI_API_KEY у змінних середовища.' });
        }

        // Отримуємо актуальний каталог з MongoDB для контексту AI
        const products = await Product.find();
        const catalogContext = products.map(p =>
            `- ${p.name} (${p.category}): ${p.price} грн, ${p.inStock ? 'в наявності' : 'немає в наявності'}`
        ).join('\n');

        const prompt = `Ти — дружній та професійний AI-консультант інтернет-магазину техніки Apple Store UA.
Ось актуальний асортимент нашого магазину:
${catalogContext}

Відповідай українською мовою стисло (3–5 речень), чітко та по суті, допомагаючи клієнту обрати товар із нашого списку.
Запитання клієнта: ${message.trim()}`;

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }]
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data.error?.message || 'Помилка виклику Google Gemini API'
            });
        }

        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Не вдалося сформувати відповідь.';
        res.status(200).json({
            reply,
            model: 'gemini-2.5-flash'
        });
    } catch (err) {
        console.error('Помилка AI-сервісу:', err);
        res.status(500).json({ error: 'Внутрішня помилка при зверненні до інтелектуального сервісу.' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Сервер запущено на порту ${PORT} (${process.env.NODE_ENV || 'dev'})`);
});